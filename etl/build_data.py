"""
CSMVS kiosk + visitor-feedback ETL.

Reads the raw exports under ../Data and writes one aggregated, PII-free bundle
to ../dashboard/data/dashboard-data.js (a plain <script> so the dashboard also
works when opened straight from disk via file://).

Dependencies: Python 3.9+ standard library only (no pandas/openpyxl needed).
Run:  python etl/build_data.py            (from the project root)

Privacy: the feedback sheet holds names, emails and phone numbers. Those
columns are never read into the output; free-text answers are reduced to
counts/themes, and only short "voice of visitor" quotes are kept after a
scrub that drops anything looking like an email or phone number.
"""
from __future__ import annotations

import collections
import glob
import html
import json
import os
import re
import sys
import zipfile
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "Data")
OUT = os.path.join(ROOT, "dashboard", "data", "dashboard-data.js")

warnings: list[str] = []


def load_json(path: str):
    # Unity writes UTF-8, sometimes with BOM.
    with open(path, encoding="utf-8-sig") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------- #
# Kiosk analytics
# --------------------------------------------------------------------------- #
def load_weeks(app_dir: str) -> tuple[list[dict], dict | None]:
    """Return (complete weeks, current partial week).

    The app sometimes archives the same week twice: a near-empty stub saved at
    ~10:00 Monday plus the real file (suffix _1). Keep, per weekStartDate, the
    snapshot with the latest lastSavedAt - that is the most complete one.
    """
    best: dict[str, dict] = {}
    for f in glob.glob(os.path.join(app_dir, "DataAnalytics", "Archive", "*.json")):
        try:
            d = load_json(f)
        except (OSError, ValueError) as exc:
            warnings.append(f"Skipped unreadable archive {os.path.basename(f)}: {exc}")
            continue
        wk = d.get("weekStartDate")
        if not wk:
            continue
        if wk not in best or d.get("lastSavedAt", "") > best[wk].get("lastSavedAt", ""):
            best[wk] = d
    current = None
    cur_path = os.path.join(app_dir, "DataAnalytics", "analytics_current.json")
    if os.path.exists(cur_path):
        try:
            current = load_json(cur_path)
        except ValueError as exc:
            warnings.append(f"Current analytics unreadable: {exc}")
    return [best[k] for k in sorted(best)], current


def week_summary(d: dict, product_name) -> dict:
    screens = {s["screenName"]: {"visits": s["visitCount"], "seconds": round(s["totalSeconds"])}
               for s in d.get("screens", [])}
    langs = {l["languageName"]: {"selections": l["selectionCount"], "seconds": round(l["totalSeconds"])}
             for l in d.get("languages", [])}
    products = collections.Counter()
    for p in d.get("products", []):
        products[product_name(p["productName"])] += p.get("clickCount", 0)
    active = sum(s["seconds"] for s in screens.values())
    idle = round(d.get("idle", {}).get("totalIdleSeconds", 0))
    return {
        "week": d["weekStartDate"],
        "clicks": sum(products.values()),
        "screenVisits": sum(s["visits"] for s in screens.values()),
        "activeSeconds": active,
        "idleSeconds": idle,
        "screens": screens,
        "languages": langs,
        "products": dict(products),
    }


def missing_weeks(weeks: list[str]) -> list[str]:
    if not weeks:
        return []
    from datetime import timedelta
    have = set(weeks)
    d = datetime.strptime(weeks[0], "%Y-%m-%d")
    end = datetime.strptime(weeks[-1], "%Y-%m-%d")
    gaps = []
    while d <= end:
        k = d.strftime("%Y-%m-%d")
        if k not in have:
            gaps.append(k)
        d += timedelta(days=7)
    return gaps


def queue_status(app_dir: str) -> dict:
    p = os.path.join(app_dir, "DataAnalytics", "Queue", "email_queue.json")
    if not os.path.exists(p):
        return {}
    q = load_json(p).get("queue", [])
    return dict(collections.Counter(x.get("status", "?") for x in q))


def log_errors(app_dir: str) -> list[str]:
    errs = []
    for name in ("Player.log", "Player-prev.log"):
        p = os.path.join(app_dir, name)
        if os.path.exists(p):
            with open(p, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if "Exception" in line and line.strip() not in errs:
                        errs.append(line.strip()[:200])
    return errs


def build_app(app: str, content: dict) -> dict:
    app_dir = os.path.join(DATA, app)
    known = {k.strip(): v for k, v in content["items"].items()}
    by_id = {v["id"]: k for k, v in known.items()}

    def product_name(raw: str) -> str:
        raw = raw.strip()
        if raw in by_id:  # some weeks log a UUID instead of a title
            return by_id[raw]
        if raw not in known and f"{raw} 1" in known:  # item later renamed "<name> 1"
            return f"{raw} 1"
        return raw

    weeks_raw, current = load_weeks(app_dir)
    weeks = [week_summary(w, product_name) for w in weeks_raw]
    totals = collections.Counter()
    for w in weeks:
        for k, v in w["products"].items():
            totals[k] += v
    unknown = [k for k in totals if k not in known]
    if unknown:
        warnings.append(f"{app}: products not in content file: {unknown}")

    return {
        "name": app,
        "weeks": weeks,
        "current": week_summary(current, product_name) if current else None,
        "missingWeeks": [k for k in missing_weeks([w["week"] for w in weeks] + ([current["weekStartDate"]] if current else []))
                         if not current or k != current["weekStartDate"]],
        "content": content,
        "health": {"emailQueue": queue_status(app_dir), "logErrors": log_errors(app_dir)},
    }


def trade_route_content() -> dict:
    d = load_json(os.path.join(DATA, "Trade Route", "TradeRouteData.json"))
    routes, items = [], {}
    for r in d["tradeRoutes"]:
        routes.append({"name": r["Name"], "period": r["duration"].rstrip("."),
                       "description": r["description"], "artefacts": len(r["materials"])})
        for m in r["materials"]:
            # The same artefact can appear on several routes; analytics logs taps by
            # title only, so taps cannot be attributed to a single route.
            it = items.setdefault(m["title"].strip(), {"id": m["uniqueId"], "groups": [],
                                                       "thumb": m.get("thumbNailImagePath", "")})
            if r["Name"] not in it["groups"]:
                it["groups"].append(r["Name"])
    return {"groups": routes, "items": items}


def trade_wall_content() -> dict:
    d = load_json(os.path.join(DATA, "Interactive Trade Wall", "TradeMapData.json"))
    items = {}
    for b in d["bookmarks"]:
        for it in b.get("items", []):
            imgs = it.get("bookmarkMetadata", {}).get("images", [])
            items[it["title"].strip()] = {"id": it["uuid"], "groups": [b["title"]],
                                          "thumb": it.get("thumbnailPath", ""),
                                          "galleryImages": len(imgs)}
    return {"groups": [], "items": items}


# --------------------------------------------------------------------------- #
# Visitor feedback (xlsx, parsed with zipfile - inline strings, no sharedStrings)
# --------------------------------------------------------------------------- #
DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")


def read_xlsx_rows(path: str) -> list[list[str]]:
    with zipfile.ZipFile(path) as z:
        xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    rows = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
        cells: dict[int, str] = {}
        # Self-closing <c .../> cells are empty; they must still occupy their column.
        for m in re.finditer(r'<c r="([A-Z]+)\d+"[^>]*?(?:/>|>(.*?)</c>)', row, re.S):
            letters = m.group(1)
            idx = 0
            for ch in letters:
                idx = idx * 26 + (ord(ch) - 64)
            cells[idx - 1] = html.unescape(re.sub(r"<[^>]+>", "", m.group(2) or "")).strip()
        width = max(cells) + 1 if cells else 0
        rows.append([cells.get(i, "") for i in range(width)])
    return rows


AGE_GROUP = {"0-5": "Children 0-10", "6-10": "Children 0-10", "11-14": "Teens 11-18", "15-18": "Teens 11-18",
             "19-25": "Young adults 19-30", "26-30": "Young adults 19-30", "31-40": "Adults 31-65", "41-65": "Adults 31-65"}
AGE_GROUP_ORDER = ["Children 0-10", "Teens 11-18", "Young adults 19-30", "Adults 31-65", "Seniors 66+"]
AGE_ORDER = ["0-5", "6-10", "11-14", "15-18", "19-25", "26-30", "31-40", "41-65", "66-74", "75-84", "85+"]


def norm_age(v: str) -> str:
    v = v.translate(DEVANAGARI_DIGITS)
    if "85" in v:
        return "85+"
    nums = re.findall(r"\d+", v)
    if len(nums) >= 2:
        k = f"{nums[0]}-{nums[1]}"
        if k in AGE_ORDER:
            return k
    return "Not given"


GENDER_MAP = {"male": "Male", "पुरुष": "Male", "female": "Female", "महिला": "Female", "स्त्री": "Female",
              "trans": "Trans", "ट्रान्स": "Trans", "ट्रांस": "Trans", "non-binary": "Non-binary",
              "would not like to disclose": "Prefer not to say", "बताना नहीं चाहते": "Prefer not to say"}

COMPANY_MAP = [("family", "Family"), ("कुटुंब", "Family"), ("परिवार", "Family"),
               ("friend", "Friends"), ("मित्र", "Friends"), ("दोस्त", "Friends"),
               ("date", "Partner / date"), ("school", "School / college trip"), ("शाळ", "School / college trip"),
               ("tour", "Tour group"), ("colleague", "Colleagues"), ("सहकारी", "Colleagues")]

SOURCE_MAP = [("textbook", "School textbooks"), ("पाठ्यपुस्तक", "School textbooks"), ("शालेय", "School textbooks"),
              ("documentar", "Documentaries & films"), ("माहितीपट", "Documentaries & films"),
              ("social media", "Social media"), ("सोशल", "Social media"),
              ("books about", "Books"), ("पुस्तक", "Books"), ("other source", "Other sources"), ("इतर", "Other sources")]


def multi(v: str, mapping) -> list[str]:
    low = v.lower()
    out = []
    for key, label in mapping:
        if key in low and label not in out:
            out.append(label)
    return out


# Keyword themes for open answers. Order = display order; a response may hit several.
LEARN_THEMES = {
    "Trade & commerce": ["trade", "trading", "merchant", "commerce", "export", "import", "barter", "व्यापार"],
    "Town planning & drainage": ["drain", "planning", "planned", "city", "cities", "town", "sewage", "grid", "street", "नियोजन", "गटार"],
    "Water management": ["water", "well", "bath", "reservoir", "पाणी", "पानी"],
    "Seals & script": ["seal", "script", "writing", "unicorn", "symbol", "लिपी", "मुद्रा"],
    "Jewellery & beads": ["jewel", "bead", "ornament", "necklace", "bangle", "gold", "carnelian", "agate", "दागिने"],
    "Pottery & crafts": ["pot", "pottery", "craft", "toy", "terracotta", "भांडी", "मातीची"],
    "Agriculture & cotton": ["cotton", "farm", "agricultur", "crop", "grain", "wheat", "शेती", "कापूस"],
    "Rosetta / Egypt & other civilisations": ["rosetta", "egypt", "mesopotam", "sumer", "hieroglyph", "persia", "roman", "greek"],
}

KEEP_THEMES = {
    "Jewellery & ornaments": ["jewel", "necklace", "earring", "bangle", "bracelet", "ornament", "bead", "gold", "ring", "दागिने"],
    "Seals": ["seal", "unicorn"],
    "Rosetta Stone": ["rosetta"],
    "Dancing Girl / figurines": ["dancing", "dancer", "figurine", "statue", "sculpture", "idol", "priest king", "priest-king"],
    "Pottery & vessels": ["pot", "vessel", "jar", "bowl", "भांडी"],
    "Coins": ["coin"],
    "Toys & games": ["toy", "game", "dice"],
    "Weapons & tools": ["sword", "weapon", "tool", "axe"],
    "Mummy / Egyptian items": ["mummy", "egypt", "sarcophag"],
}

POSITIVE = set("""amazing good great excellent awesome nice unique fantastic fabulous wonderful wow beautiful
informative creative mesmerizing mesmerising superb fascinating best cool interesting extraordinary marvelous
marvellous incredible fun exquisite enlightening mindblowing mind-blowing outstanding wonderfull astonishing
supercalifragilisticexpialidocious fantabulous intriguing super insightful spectacular impressive immersive
awsome excelent brilliant loved love lovely magnificent stunning splendid knowledgeable educational
historic historical ancient phenomenal perfect remarkable breathtaking magical engaging inspiring
enriching captivating majestic mind amazed enjoyable epic legendary gorgeous glorious divine mast
छान सुंदर अप्रतिम उत्तम भारी अद्भुत""".split())
NEGATIVE = set("boring bad worst poor dull crowded meh confusing small hot".split())
JUNK = set("no yes na n/a nothing abc m nn idk ok okay none - . test testing xyz".split())


def one_word_bucket(w: str) -> str:
    w = w.lower().strip(" .!")
    if not w or w in JUNK or len(w) <= 1:
        return "No real answer"
    words = re.findall(r"[\w\-]+", w)
    if any(x in NEGATIVE for x in words):
        return "Negative"
    if any(x in POSITIVE for x in words) or w.startswith("very"):
        return "Positive"
    return "Neutral / other"


# Mumbai city, suburbs and the immediate metro region (for the grouped bar chart only).
MUMBAI_REGION = {
    "Mumbai", "Navi Mumbai", "Thane", "Kalyan", "Dombivli", "Vasai", "Virar", "Nallasopara", "Mira Road",
    "Bhayander", "Panvel", "Kharghar", "Nerul", "Airoli", "Ulwe Bamandongri", "Badlapur", "Ambarnath",
    "Ulhasnagar", "Bhiwandi", "Mumbra", "Diva", "Shahad", "Chembur", "Sion", "Dadar", "Andheri", "Malad",
    "Mulund", "Ghatkopar", "Borivali", "Kurla", "Bandra", "Vikhroli", "Wadala", "Colaba", "Bhandup", "Mahim",
    "Matunga", "Powai", "Dharavi", "Csmt", "Santacruz", "Vileparle",
}


# --- Place normalisation ---------------------------------------------------- #
# Spelling variants / abbreviations -> canonical name (keys are lower-case).
PLACE_ALIAS = {
    "bombay": "Mumbai", "mum": "Mumbai", "mumbia": "Mumbai", "mumba": "Mumbai", "mumbao": "Mumbai",
    "mumbaii": "Mumbai", "mumbi": "Mumbai", "mubai": "Mumbai", "bom": "Mumbai", "मुबई": "Mumbai",
    "मुंबई": "Mumbai", "mumbai mh": "Mumbai", "new mumbai": "Navi Mumbai", "ठाणे": "Thane",
    "bangalore": "Bengaluru", "banglore": "Bengaluru", "bengalore": "Bengaluru", "blr": "Bengaluru",
    "gujrat": "Gujarat", "guj": "Gujarat", "tamilnadu": "Tamil Nadu", "keralam": "Kerala", "kerla": "Kerala",
    "mp": "Madhya Pradesh", "up": "Uttar Pradesh", "uttarpradesh": "Uttar Pradesh", "ap": "Andhra Pradesh",
    "andhra": "Andhra Pradesh", "andhrapradesh": "Andhra Pradesh", "himachal": "Himachal Pradesh",
    "hp": "Himachal Pradesh", "wb": "West Bengal", "hr": "Haryana", "harayana": "Haryana",
    "uttrakhand": "Uttarakhand", "rajsthan": "Rajasthan", "chhatisgarh": "Chhattisgarh",
    "chattisgarh": "Chhattisgarh", "chattishgarh": "Chhattisgarh", "j&k": "Jammu & Kashmir",
    "pondicherry": "Puducherry", "hydrabad": "Hyderabad", "hyd": "Hyderabad", "ahemdabad": "Ahmedabad",
    "ahemadabad": "Ahmedabad", "vadodra": "Vadodara", "vizag": "Visakhapatnam", "cochin": "Kochi",
    "calicut": "Kozhikode", "manglore": "Mangaluru", "mangalore": "Mangaluru", "mysore": "Mysuru",
    "trivandrum": "Thiruvananthapuram", "gurgaon": "Gurugram", "allahabad": "Prayagraj", "bnaras": "Varanasi",
    "delli": "Delhi", "new delhi": "Delhi", "dombivali": "Dombivli", "nalasopara": "Nallasopara",
    "jalgoan": "Jalgaon", "buldana": "Buldhana", "sangali": "Sangli", "kslyan": "Kalyan",
    "chh sambhajinagar": "Chhatrapati Sambhajinagar", "sambhajinagar": "Chhatrapati Sambhajinagar",
    "aurangabad": "Chhatrapati Sambhajinagar", "जालना": "Jalna", "idr": "Indore",
    "usa": "USA", "us": "USA", "the usa": "USA", "america": "USA", "uk": "UK", "england": "UK",
    "brasil": "Brazil", "pakisthan": "Pakistan", "austrilla": "Australia", "egylt": "Egypt",
    "nyc": "New York", "new york city": "New York", "seatle": "Seattle", "callifornia": "California",
    "masseuchussetes": "Massachusetts", "dubai fata": "Dubai", "navi mumbai": "Navi Mumbai",
    "kashmir": "Jammu & Kashmir", "कोकण": "Konkan", "mumbai india": "Mumbai",
}
INDIAN_STATES = {
    "Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
    "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Mizoram", "Nagaland",
    "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Uttar Pradesh", "Uttarakhand",
    "West Bengal", "Jammu & Kashmir", "Kashmir", "Puducherry", "India", "Konkan", "कोकण",
}
# Countries and well-known foreign cities/states (anything here counts as international).
INTERNATIONAL = {
    "USA", "UK", "Dubai", "China", "Australia", "Canada", "Japan", "Italy", "Thailand", "Germany", "Berlin",
    "Malaysia", "New York", "Egypt", "Singapore", "Sweden", "France", "Spain", "North Korea", "Ohio", "Nepal",
    "Russia", "Pakistan", "Sydney", "Netherlands", "Greece", "Melbourne", "Brazil", "Switzerland", "Ireland",
    "Africa", "Chicago", "New Zealand", "Boston", "Romania", "Denmark", "Taiwan", "Indonesia", "Hungary",
    "Toronto", "Mongolia", "Portugal", "Mexico", "Greenland", "Dagestan", "Norway", "London", "Karachi",
    "Kazakhstan", "Sundsvall", "Klang", "Mauritius", "Fremont", "Seattle", "Florida", "Los Angeles", "California",
    "Arizona", "Muscat", "Washington Dc", "San Francisco", "Massachusetts", "Bali", "Ottawa",
}
# Not a real place, or not a place at all.
PLACE_JUNK = {"abc", "mars", "earth", "yes", "good", "very good", "dholakpur", "cybertron", "jungles",
              "instagram", "asa", "asd", "abd", "cz", "n", "j", "f", "vyygju", "raj", "camp", "na", "-"}


def norm_place(raw: str) -> tuple[str, str] | None:
    """Return (canonical place, type) or None when the answer isn't a usable place."""
    v = raw.strip().lower()
    if not v or v in PLACE_JUNK or PII_RE.search(v) or len(v.split()) > 4:
        return None
    if v in PLACE_ALIAS:
        name = PLACE_ALIAS[v]
    else:
        # "Pune, Maharashtra" / "Hyderabad and Los Angeles" / "Sikar Rajasthan" -> first place named.
        v = re.split(r",| and | - ", v)[0].strip()
        words = v.split()
        if len(words) > 1 and v not in PLACE_ALIAS and words[-1] in {"maharashtra", "gujarat", "gujrat", "rajasthan", "bihar", "india",
                                            "mumbai", "tamilnadu", "uttarakhand", "canada", "indonesia", "mh",
                                            "east", "west", "kutch"}:
            v = " ".join(words[:-1])
        if v in ("mumbai mulund",):
            v = "mulund"
        name = PLACE_ALIAS.get(v, v.title())
    if name in INTERNATIONAL:
        kind = "International"
    elif name in INDIAN_STATES:
        kind = "Indian state / region"
    else:
        kind = "Indian city / town"
    return name, kind


PII_RE = re.compile(r"@|\d{6,}|\+?\d[\d\s\-]{8,}")
TEST_RE = re.compile(r"^(test|testing|abc|xyz|asdf|qwerty)\b", re.I)


def build_feedback() -> dict:
    path = glob.glob(os.path.join(DATA, "feedback_export_all_*.xlsx"))
    if not path:
        warnings.append("No feedback export found")
        return {}
    rows = read_xlsx_rows(sorted(path)[-1])
    header, data = rows[0], [r + [""] * (15 - len(r)) for r in rows[1:] if any(r)]
    # Column positions (verified against the header row; see README).
    C_AGE, C_GENDER, C_CITY, C_WITH, C_SRC, C_LEARN, C_SURPRISE, C_TODAY, C_KEEP, C_WORD, C_MORE, C_DATE = \
        2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14

    age, gender, city, company, source = (collections.Counter() for _ in range(5))
    monthly = collections.Counter()
    learn, keep, word_bucket, words = (collections.Counter() for _ in range(4))
    langs = collections.Counter()
    test_rows = 0
    unusable_places = 0
    # Cross-tabs used by the "AI key insights" panels.
    dow = collections.Counter()
    seg_n = collections.Counter()
    seg = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    month_company = collections.defaultdict(collections.Counter)
    month_intl = collections.Counter()
    origin_sent = collections.defaultdict(collections.Counter)
    quotes = []
    for r in data:
        if TEST_RE.match(r[C_LEARN]) or TEST_RE.match(r[C_SURPRISE]):
            test_rows += 1
        age[norm_age(r[C_AGE])] += 1
        gender[GENDER_MAP.get(r[C_GENDER].strip().lower(), "Not given")] += 1
        place = norm_place(r[C_CITY])
        if place:
            city[place] += 1
        else:
            unusable_places += 1
        for x in multi(r[C_WITH], COMPANY_MAP) or ["Not given"]:
            company[x] += 1
        for x in multi(r[C_SRC], SOURCE_MAP) or ["Not given"]:
            source[x] += 1
        g = AGE_GROUP.get(norm_age(r[C_AGE]), "Seniors 66+")
        seg_n[g] += 1
        comp = multi(r[C_WITH], COMPANY_MAP)
        for x in comp:
            seg[g]["company"][x] += 1
        for x in multi(r[C_SRC], SOURCE_MAP):
            seg[g]["source"][x] += 1
        for theme, keys in KEEP_THEMES.items():
            if any(k in r[C_KEEP].lower() for k in keys):
                seg[g]["keep"][theme] += 1
        bucket = one_word_bucket(r[C_WORD])
        seg[g]["sentiment"][bucket] += 1
        origin = ("International" if place and place[1] == "International"
                  else "Mumbai region" if place and place[0] in MUMBAI_REGION else "Rest of India")
        origin_sent[origin][bucket] += 1
        try:
            dt = datetime.strptime(r[C_DATE], "%d/%m/%Y")
            ym = dt.strftime("%Y-%m")
            monthly[ym] += 1
            dow[dt.strftime("%a")] += 1
            for x in comp:
                month_company[ym][x] += 1
            if place and place[1] == "International":
                month_intl[ym] += 1
        except ValueError:
            pass
        text = " ".join(r[i] for i in (C_LEARN, C_SURPRISE, C_TODAY, C_KEEP, C_WORD, C_MORE))
        langs["Devanagari (Marathi/Hindi)" if re.search(r"[ऀ-ॿ]", text) else "English"] += 1
        lt = (r[C_LEARN] + " " + r[C_SURPRISE]).lower()
        for theme, keys in LEARN_THEMES.items():
            if any(k in lt for k in keys):
                learn[theme] += 1
        kt = r[C_KEEP].lower()
        for theme, keys in KEEP_THEMES.items():
            if any(k in kt for k in keys):
                keep[theme] += 1
        b = one_word_bucket(r[C_WORD])
        word_bucket[b] += 1
        if b in ("Positive", "Negative", "Neutral / other"):
            words[r[C_WORD].strip().lower().rstrip(".!")] += 1
        q = r[C_SURPRISE].strip()
        if 60 <= len(q) <= 220 and not PII_RE.search(q) and not TEST_RE.match(q):
            quotes.append(q)

    # Bar chart groups Mumbai + its suburbs; the place cloud keeps every place separate.
    region = collections.Counter()
    for (name, _kind), v in city.items():
        region["Mumbai metro region" if name in MUMBAI_REGION else name] += v

    # Spread quotes over the file (newest rows last) for variety.
    step = max(1, len(quotes) // 40)
    return {
        "total": len(data),
        "testRows": test_rows,
        "dated": sum(monthly.values()),
        "monthly": dict(sorted(monthly.items())),
        "age": {k: age.get(k, 0) for k in AGE_ORDER + ["Not given"]},
        "gender": dict(gender.most_common()),
        "cities": dict(region.most_common(15)),
        "distinctCities": len(city),
        "places": [{"name": n, "type": k, "count": v} for (n, k), v in city.most_common()],
        "unusablePlaces": unusable_places,
        "company": dict(company.most_common()),
        "sources": dict(source.most_common()),
        "learnThemes": dict(learn.most_common()),
        "keepThemes": dict(keep.most_common()),
        "wordBuckets": dict(word_bucket.most_common()),
        "topWords": words.most_common(60),
        "answerLanguage": dict(langs),
        "patterns": {
            "dayOfWeek": {d: dow.get(d, 0) for d in ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")},
            "segments": {g: {"n": seg_n[g], **{k: dict(v.most_common()) for k, v in seg[g].items()}}
                         for g in AGE_GROUP_ORDER if seg_n[g]},
            "monthCompany": {m: dict(v) for m, v in sorted(month_company.items())},
            "monthInternational": dict(sorted(month_intl.items())),
            "originSentiment": {k: dict(v) for k, v in origin_sent.items()},
        },
        "quotes": quotes[::step][:40],
        "columns": [h.split("\n")[0] for h in header if h not in ("Name", "Email or Contact")],
    }


def main() -> int:
    if not os.path.isdir(DATA):
        print(f"Data folder not found: {DATA}", file=sys.stderr)
        return 1
    bundle = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "apps": {
            "tradeRoute": build_app("Trade Route", trade_route_content()),
            "tradeWall": build_app("Interactive Trade Wall", trade_wall_content()),
        },
        "feedback": build_feedback(),
    }
    bundle["warnings"] = warnings
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// Generated by etl/build_data.py - do not edit by hand.\n")
        fh.write("window.DASHBOARD_DATA = ")
        json.dump(bundle, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    print(f"Wrote {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    for w in warnings:
        print("WARN:", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
