/* CSMVS Gallery Insights - zero-dependency dashboard.
 * Reads window.DASHBOARD_DATA (built by etl/build_data.py) and renders five tabs.
 * All values come from the bundle; text is inserted with textContent / escaped
 * strings only, so free-text visitor answers can never inject markup. */
(function () {
  "use strict";
  const D = window.DASHBOARD_DATA;
  if (!D) {
    document.getElementById("app").innerHTML =
      '<div class="card"><h3>No data bundle found</h3><p>Run <code>python etl/build_data.py</code> from the project root, then reload.</p></div>';
    return;
  }

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Math.round(n).toLocaleString("en-IN");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const hours = (s) => (s / 3600).toFixed(s >= 36000 ? 0 : 1);
  const mins = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
  const shortDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const monthLabel = (ym) => new Date(ym + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  const safeUrl = (u) => (/^https:\/\//.test(u || "") ? u : "");

  // ---------- tooltip ----------
  const tip = document.getElementById("tooltip");
  document.addEventListener("mousemove", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute("data-tip");
    tip.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    tip.style.left = x + "px";
    tip.style.top = e.clientY + 14 + "px";
  });

  // ---------- components ----------
  const kpi = (label, value, note) =>
    `<div class="card kpi"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${note ? `<div class="note">${esc(note)}</div>` : ""}</div>`;

  const card = (title, why, body, cls = "") =>
    `<div class="card ${cls}"><h3>${esc(title)}</h3>${why ? `<p class="why">${esc(why)}</p>` : ""}${body}</div>`;

  /** Table fallback for every chart (accessibility + exact numbers). */
  function tableView(headers, rows) {
    return `<details class="table-view"><summary>Show as table</summary><table><thead><tr>${headers
      .map((h, i) => `<th class="${i ? "n" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "n" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
  }

  /** Horizontal bars. items: [{label, value, display?, img?, tip?, cls?}] */
  function hbars(items, opts = {}) {
    const max = Math.max(1, ...items.map((i) => i.value));
    const total = opts.total || sum(items.map((i) => i.value));
    return `<div class="hbars">${items.map((i) => {
      const img = safeUrl(i.img);
      const t = i.tip || `${i.label}: ${fmt(i.value)}${opts.showPct !== false ? ` (${pct(i.value, total)}%)` : ""}`;
      return `<div class="hbar" data-tip="${esc(t)}">
        <div class="name">${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}<span title="${esc(i.label)}">${esc(i.label)}</span></div>
        <div class="track"><div class="fill ${i.cls || ""}" style="width:${(i.value / max) * 100}%"></div></div>
        <div class="val">${esc(i.display ?? fmt(i.value))}</div></div>`;
    }).join("")}</div>`;
  }

  /** Vertical column chart in SVG. points: [{label, value, tip, missing?}] */
  function columns(points, opts = {}) {
    const W = 720, H = opts.height || 220, pad = { l: 44, r: 8, t: 12, b: 34 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const vals = points.filter((p) => !p.missing).map((p) => p.value);
    const max = niceMax(Math.max(1, ...vals));
    const step = iw / points.length, bw = Math.max(4, Math.min(42, step - 6));
    const y = (v) => pad.t + ih - (v / max) * ih;
    let g = "";
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k, yy = y(v);
      g += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${esc(opts.yFmt ? opts.yFmt(v) : fmt(v))}</text>`;
    }
    const every = Math.ceil(points.length / 12);
    points.forEach((p, i) => {
      const cx = pad.l + step * i + step / 2, x = cx - bw / 2;
      if (p.missing) {
        g += `<rect class="gap-mark" x="${x}" y="${pad.t + ih - 30}" width="${bw}" height="30" rx="4" data-tip="${esc(p.tip)}"/>`;
      } else {
        const yy = y(p.value), h = Math.max(1, pad.t + ih - yy);
        // Rounded top only: draw path with 4px radius at data end.
        const r = Math.min(4, bw / 2, h);
        g += `<path class="bar ${p.cls || opts.cls || ""}" d="M${x},${pad.t + ih} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${pad.t + ih} Z"/>`;
        g += `<rect class="hit" x="${pad.l + step * i}" y="${pad.t}" width="${step}" height="${ih}" data-tip="${esc(p.tip)}"/>`;
      }
      if (i % every === 0) g += `<text x="${cx}" y="${H - 14}" text-anchor="middle">${esc(p.label)}</text>`;
    });
    if (opts.avg) {
      const ay = y(opts.avg);
      g += `<line class="avgline" x1="${pad.l}" x2="${W - pad.r}" y1="${ay}" y2="${ay}"/><text x="${W - pad.r}" y="${ay - 5}" text-anchor="end">avg ${esc(opts.yFmt ? opts.yFmt(opts.avg) : fmt(opts.avg))}</text>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || "column chart")}">${g}</svg>`;
  }
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => m <= s) * p;
  }

  /** 100% split bar with legend. parts: [{label, value, color}] */
  function split(parts) {
    const total = sum(parts.map((p) => p.value)) || 1;
    return `<div class="split">${parts.map((p) => {
      const w = (p.value / total) * 100;
      return `<div class="${p.color.includes("neutral") ? "on-light" : ""}" style="width:${w}%;background:${p.color}" data-tip="${esc(`${p.label}: ${fmt(p.value)} (${pct(p.value, total)}%)`)}">${w > 12 ? pct(p.value, total) + "%" : ""}</div>`;
    }).join("")}</div><div class="legend">${parts.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)} · ${fmt(p.value)} (${pct(p.value, total)}%)</span>`).join("")}</div>`;
  }

  /** Chip cloud: font size scales with frequency (sqrt so big values don't swamp the rest).
   *  entries: [[label, count]]; items below `minShown` go into a collapsible "show all". */
  function chipCloud(entries, opts = {}) {
    const max = Math.max(1, ...entries.map((e) => e[1]));
    const chip = ([w, n]) => `<span class="chip" style="--s:${Math.sqrt(n / max).toFixed(3)}" data-tip="${esc(`${w}: ${n} ${opts.unit || ""}`.trim())}">${esc(w)}<small>${n}</small></span>`;
    const min = opts.minShown || 0;
    const main = entries.filter((e) => e[1] >= min), rest = entries.filter((e) => e[1] < min);
    return `<div class="chips">${main.map(chip).join("")}</div>` + (rest.length
      ? `<details class="table-view"><summary>Show ${rest.length} more named only once</summary><div class="chips" style="margin-top:8px">${rest.map(chip).join("")}</div></details>` : "");
  }

  const insightList = (items) =>
    `<ul class="insights">${items.map((i) => `<li><span class="ico" aria-hidden="true">${i.icon}</span><div><b>${esc(i.title)}</b> ${esc(i.text)}${i.action ? `<span class="act">→ ${esc(i.action)}</span>` : ""}</div></li>`).join("")}</ul>`;

  // ---------- derived metrics per kiosk ----------
  function appStats(app) {
    const weeks = app.weeks;
    const items = app.content.items;
    const products = {};
    weeks.forEach((w) => Object.entries(w.products).forEach(([k, v]) => (products[k] = (products[k] || 0) + v)));
    // Include artefacts never tapped so gaps are visible.
    Object.keys(items).forEach((k) => (products[k] = products[k] || 0));
    const screens = {}, langs = {};
    weeks.forEach((w) => {
      Object.entries(w.screens).forEach(([k, v]) => {
        screens[k] = screens[k] || { visits: 0, seconds: 0 };
        screens[k].visits += v.visits; screens[k].seconds += v.seconds;
      });
      Object.entries(w.languages).forEach(([k, v]) => {
        langs[k] = langs[k] || { selections: 0, seconds: 0 };
        langs[k].selections += v.selections; langs[k].seconds += v.seconds;
      });
    });
    const clicks = sum(weeks.map((w) => w.clicks));
    const active = sum(weeks.map((w) => w.activeSeconds));
    const idle = sum(weeks.map((w) => w.idleSeconds));
    const best = weeks.reduce((a, b) => (b.clicks > a.clicks ? b : a), weeks[0]);
    const worst = weeks.reduce((a, b) => (b.clicks < a.clicks ? b : a), weeks[0]);
    const ranked = Object.entries(products).sort((a, b) => b[1] - a[1]);
    // Trend: last 4 weeks vs previous 4.
    const last4 = sum(weeks.slice(-4).map((w) => w.clicks)) / Math.min(4, weeks.length);
    const prev = weeks.slice(-8, -4);
    const prev4 = prev.length ? sum(prev.map((w) => w.clicks)) / prev.length : null;
    return { weeks, items, products, ranked, screens, langs, clicks, active, idle, best, worst,
      avgWeek: clicks / weeks.length, last4, prev4,
      marathi: langs.Marathi || { selections: 0, seconds: 0 }, english: langs.English || { selections: 0, seconds: 0 } };
  }

  /** Weekly series including missing weeks as gap markers. */
  function weeklyPoints(app, valueFn, tipFn) {
    const all = app.weeks.map((w) => ({ week: w.week, w }))
      .concat(app.missingWeeks.map((m) => ({ week: m, missing: true })))
      .sort((a, b) => a.week.localeCompare(b.week));
    return all.map((p) => p.missing
      ? { label: shortDate(p.week), missing: true, tip: `Week of ${shortDate(p.week)}: no data saved (kiosk file missing)` }
      : { label: shortDate(p.week), value: valueFn(p.w), tip: tipFn(p.w) });
  }

  const RT = appStats(D.apps.tradeRoute);
  const TW = appStats(D.apps.tradeWall);
  const FB = D.feedback;

  // ---------- OVERVIEW ----------
  function renderOverview() {
    const fbPositive = FB.wordBuckets.Positive || 0;
    const fbAnswered = FB.total - (FB.wordBuckets["No real answer"] || 0);
    const mumbai = FB.cities["Mumbai metro region"] || 0;
    const topWall = TW.ranked[0], lowWall = TW.ranked[TW.ranked.length - 1];
    const routeAgg = routeAggregates();
    const byOpens = routeAgg.slice().sort((a, b) => b.visits - a.visits), bestRoute = byOpens[0], lowRoute = byOpens[byOpens.length - 1];
    const youth = sum(["11-14", "15-18", "19-25"].map((k) => FB.age[k] || 0));
    const months = Object.entries(FB.monthly);
    const peakMonth = months.reduce((a, b) => (b[1] > a[1] ? b : a));
    const tw = TW.weeks.length, rt = RT.weeks.length;

    const insights = [
      { icon: "🏺", title: `“${topWall[0].trim()}” is the Trade Wall favourite`,
        text: `with ${fmt(topWall[1])} taps — ${(topWall[1] / Math.max(1, lowWall[1])).toFixed(1)}× more than “${lowWall[0].trim()}” (${fmt(lowWall[1])}).`,
        action: "Use the favourite in signage/social posts; refresh the image & story for the least-tapped material." },
      { icon: "🧭", title: `${bestRoute.name} is the most explored route`,
        text: `— opened ${fmt(bestRoute.visits)} times with ${mins(bestRoute.avgVisit)} per visit, vs ${lowRoute.name} at ${fmt(lowRoute.visits)} opens (${mins(lowRoute.avgVisit)}).`,
        action: `Review ${lowRoute.name}'s home-screen tile and story; it has only ${lowRoute.artefacts} artefacts.` },
      { icon: "⏱️", title: `Kiosks wait idle for a large share of the day`,
        text: `Idle time is ${pct(TW.idle, TW.active + TW.idle)}% of logged time on the Trade Wall (${fmt(TW.idle / 3600)} h) and ${pct(RT.idle, RT.active + RT.idle)}% on Trade Route (${fmt(RT.idle / 3600)} h).`,
        action: "Add an attract-loop / call-to-action on the idle screen and test kiosk placement near gallery entrance." },
      { icon: "🗣️", title: "Marathi is used heavily on the Trade Wall",
        text: `${pct(TW.marathi.selections, TW.marathi.selections + TW.english.selections)}% of language choices there are Marathi (Trade Route: ${pct(RT.marathi.selections, RT.marathi.selections + RT.english.selections)}%).`,
        action: "Keep Marathi content at full parity; consider Hindi as a third language." },
      { icon: "💬", title: `Almost no negative reviews`,
        text: `— only ${FB.wordBuckets.Negative || 0} of ${fmt(fbAnswered)} meaningful one-word descriptions are negative, while ${pct(fbPositive, fbAnswered)}% are clearly positive (“good”, “amazing”, “great”); the rest are mostly descriptive (“ancient”, “historic”).`,
        action: "Quote these words in marketing; read the few negatives in the Feedback tab." },
      { icon: "🎓", title: `Young audience: ${pct(youth, FB.total)}% of respondents are 11–25`,
        text: `and school textbooks are the #1 place visitors learned about the ancient world (${fmt(FB.sources["School textbooks"] || 0)} mentions).`,
        action: "Build school-trip packs and short-form social video — documentaries & social media are #2/#3." },
      { icon: "📍", title: `${pct(FB.total - mumbai, FB.total)}% of respondents come from outside Mumbai region`,
        text: `— ${fmt(FB.distinctCities)} distinct places named (${Object.keys(FB.cities).filter((k) => k !== "Mumbai metro region").slice(0, 3).join(", ")} lead). Peak month: ${monthLabel(peakMonth[0])} (${fmt(peakMonth[1])} responses).`,
        action: "Tourist-facing promotion (travel sites, hotels) is worth investing in." },
    ];

    document.getElementById("tab-overview").innerHTML = `
      <div class="tab-head"><h2>At a glance</h2>
        <p>Two touch-screen kiosks (Trade Route: ${rt} weeks, Interactive Trade Wall: ${tw} weeks of logs) and ${fmt(FB.total)} visitor feedback forms (${monthLabel(months[0][0])} – ${monthLabel(months[months.length - 1][0])}). Start with the key findings, then open each tab for detail.</p></div>
      <div class="grid kpis">
        ${kpi("Artefact taps · both kiosks", fmt(RT.clicks + TW.clicks), "every tap opens an artefact/material story")}
        ${kpi("Feedback responses", fmt(FB.total), `${fmt(Math.round(FB.total / months.length))} per month on average`)}
        ${kpi("Positive one-word reviews", pct(fbPositive, fbAnswered) + "%", "of meaningful answers")}
        ${kpi("Kiosk screen-time hours", fmt((RT.active + TW.active) / 3600), "visitor time on content screens, both kiosks")}
        ${kpi("Visitors from outside Mumbai", pct(FB.total - mumbai, FB.total) + "%", "self-reported city")}
      </div>
      <div class="grid cols-2">
        ${card("Key findings & suggested actions", "Computed automatically from the data below.", insightList(insights), "span-all")}
        ${card("Weekly artefact taps — Trade Wall", "Taps per week. Dashed boxes = week with no saved data.",
          columns(weeklyPoints(D.apps.tradeWall, (w) => w.clicks, (w) => `Week of ${shortDate(w.week)}: ${fmt(w.clicks)} taps`), { avg: TW.avgWeek, aria: "Trade Wall weekly taps" }))}
        ${card("Weekly artefact taps — Trade Route", "Taps per week. Dashed boxes = week with no saved data.",
          columns(weeklyPoints(D.apps.tradeRoute, (w) => w.clicks, (w) => `Week of ${shortDate(w.week)}: ${fmt(w.clicks)} taps`), { avg: RT.avgWeek, aria: "Trade Route weekly taps", cls: "alt" }))}
      </div>`;
  }

  // ---------- TRADE ROUTE ----------
  function routeAggregates() {
    return D.apps.tradeRoute.content.groups.map((g) => {
      const sc = RT.screens[g.name] || { visits: 0, seconds: 0 };
      return { ...g, visits: sc.visits, seconds: sc.seconds, avgVisit: sc.visits ? sc.seconds / sc.visits : 0 };
    });
  }

  function renderRoute() {
    const s = RT, routes = routeAggregates();
    const home = s.screens["Home Screen"] || { visits: 0, seconds: 0 };
    const routeVisits = sum(routes.map((r) => r.visits));
    const top = s.ranked.slice(0, 12), bottom = s.ranked.slice(-8).reverse();
    const trend = s.prev4 ? Math.round(((s.last4 - s.prev4) / s.prev4) * 100) : null;
    const itemRow = ([k, v]) => ({ label: k, value: v, img: s.items[k]?.thumb, tip: `${k} — on ${(s.items[k]?.groups || []).join(", ") || "?"}: ${fmt(v)} taps` });

    document.getElementById("tab-route").innerHTML = `
      <div class="tab-head"><h2>Trade Route kiosk</h2>
        <p>Visitors pick one of ${routes.length} ancient trade routes on the home screen, then tap artefacts to read their stories. Data: ${s.weeks.length} weeks from ${shortDate(s.weeks[0].week)} to ${shortDate(s.weeks[s.weeks.length - 1].week)}.</p></div>
      <div class="grid kpis">
        ${kpi("Artefact taps", fmt(s.clicks), `${fmt(s.avgWeek)} per week on average`)}
        ${kpi("Route opens", fmt(routeVisits), `from ${fmt(home.visits)} home-screen visits`)}
        ${kpi("Best week", fmt(s.best.clicks), "week of " + shortDate(s.best.week))}
        ${kpi("Last 4 weeks vs previous 4", trend === null ? "—" : (trend > 0 ? "+" : "") + trend + "%", "change in average weekly taps")}
        ${kpi("Screen time share", pct(s.active, s.active + s.idle) + "%", `${hours(s.active)} h screen time · ${hours(s.idle)} h idle`)}
      </div>
      <div class="grid cols-2">
        ${card("Which route do visitors open?", "Number of times each route screen was opened.",
          hbars(routes.slice().sort((a, b) => b.visits - a.visits).map((r) => ({ label: r.name, value: r.visits, tip: `${r.name} (${r.period}): ${fmt(r.visits)} opens, avg ${mins(r.avgVisit)} per visit` })))
          + tableView(["Route", "Opens", "Avg time / visit", "Artefacts"], routes.map((r) => [r.name, fmt(r.visits), mins(r.avgVisit), r.artefacts])))}
        ${card("Total time spent on each route", "Hours visitors spent inside each route (opens × time per visit). Number in brackets = artefacts on that route.",
          hbars(routes.slice().sort((a, b) => b.seconds - a.seconds).map((r) => ({ label: `${r.name} (${r.artefacts})`, value: r.seconds, display: hours(r.seconds) + " h", cls: "alt", tip: `${r.name}: ${hours(r.seconds)} h in total` })), { showPct: false }))}
        ${card("Weekly artefact taps", "Dashed boxes = week with no saved data.",
          columns(weeklyPoints(D.apps.tradeRoute, (w) => w.clicks, (w) => `Week of ${shortDate(w.week)}: ${fmt(w.clicks)} taps, ${fmt(w.screenVisits)} screen visits`), { avg: s.avgWeek, aria: "weekly taps" })
          + tableView(["Week", "Taps", "Screen visits", "Active h", "Idle h"], s.weeks.map((w) => [w.week, fmt(w.clicks), fmt(w.screenVisits), hours(w.activeSeconds), hours(w.idleSeconds)])))}
        ${card("Average time spent per route visit", "How long people stay once they open a route — a proxy for how engaging its content is.",
          hbars(routes.slice().sort((a, b) => b.avgVisit - a.avgVisit).map((r) => ({ label: r.name, value: Math.round(r.avgVisit), display: mins(r.avgVisit), tip: `${r.name}: ${mins(r.avgVisit)} per visit` })), { showPct: false }))}
        ${card("Most-tapped artefacts (top 12)", "Hover to see which route(s) show it. Many artefacts appear on more than one route. Thumbnails load from the kiosk content server when online.",
          hbars(top.map(itemRow)))}
        ${card("Least-tapped artefacts", "Candidates for better thumbnails, titles or placement on the route screen.",
          hbars(bottom.map(itemRow).map((r) => ({ ...r, cls: "muted" })))
          + tableView(["Artefact", "Appears on route(s)", "Taps"], s.ranked.map(([k, v]) => [k, (s.items[k]?.groups || []).join(", "), fmt(v)])))}
        ${card("Language chosen", "How often visitors switched the kiosk to each language.",
          split([{ label: "English", value: s.english.selections, color: "var(--series-1)" }, { label: "Marathi", value: s.marathi.selections, color: "var(--series-2)" }]))}
        ${card("Kiosk in use vs idle", "Share of logged time someone was interacting vs the screen waiting.",
          split([{ label: "Screen time (h)", value: Math.round(s.active / 3600), color: "var(--series-1)" }, { label: "Idle (h)", value: Math.round(s.idle / 3600), color: "var(--neutral-mark)" }]))}
      </div>`;
  }

  // ---------- TRADE WALL ----------
  function renderWall() {
    const s = TW;
    const opt = s.screens["Material Option Screen"] || { visits: 0, seconds: 0 };
    const info = s.screens["Material Information Screen"] || { visits: 0, seconds: 0 };
    const trend = s.prev4 ? Math.round(((s.last4 - s.prev4) / s.prev4) * 100) : null;
    const itemRow = ([k, v]) => ({ label: k.trim(), value: v, img: s.items[k]?.thumb, tip: `${k.trim()}: ${fmt(v)} taps (${pct(v, s.clicks)}% of all)` });

    document.getElementById("tab-wall").innerHTML = `
      <div class="tab-head"><h2>Interactive Trade Wall</h2>
        <p>Visitors choose one of ${Object.keys(s.items).length} Harappan trade materials, then explore its gallery of sites and objects. Data: ${s.weeks.length} weeks from ${shortDate(s.weeks[0].week)} to ${shortDate(s.weeks[s.weeks.length - 1].week)}.</p></div>
      <div class="grid kpis">
        ${kpi("Material taps", fmt(s.clicks), `${fmt(s.avgWeek)} per week on average`)}
        ${kpi("Avg time reading a material", mins(info.seconds / Math.max(1, info.visits)), "per information-screen visit")}
        ${kpi("Best week", fmt(s.best.clicks), "week of " + shortDate(s.best.week))}
        ${kpi("Last 4 weeks vs previous 4", trend === null ? "—" : (trend > 0 ? "+" : "") + trend + "%", "change in average weekly taps")}
        ${kpi("Marathi share", pct(s.marathi.selections, s.marathi.selections + s.english.selections) + "%", "of language selections")}
      </div>
      <div class="grid cols-2">
        ${card("Material popularity", "Share of all taps per material.", hbars(s.ranked.map(itemRow))
          + tableView(["Material", "Taps", "Share"], s.ranked.map(([k, v]) => [k.trim(), fmt(v), pct(v, s.clicks) + "%"])))}
        ${card("Weekly material taps", "Dashed boxes = week with no saved data.",
          columns(weeklyPoints(D.apps.tradeWall, (w) => w.clicks, (w) => `Week of ${shortDate(w.week)}: ${fmt(w.clicks)} taps`), { avg: s.avgWeek, aria: "weekly taps" })
          + tableView(["Week", "Taps", "Screen visits", "Active h", "Idle h"], s.weeks.map((w) => [w.week, fmt(w.clicks), fmt(w.screenVisits), hours(w.activeSeconds), hours(w.idleSeconds)])))}
        ${card("Where visitors spend their time", "Total hours on each screen. The information screen holds attention ~2× longer than the menu.",
          hbars([{ label: "Material Information", value: Math.round(info.seconds / 3600), display: hours(info.seconds) + " h", tip: `${fmt(info.visits)} visits, avg ${mins(info.seconds / Math.max(1, info.visits))}` },
                 { label: "Material Options (menu)", value: Math.round(opt.seconds / 3600), display: hours(opt.seconds) + " h", cls: "alt", tip: `${fmt(opt.visits)} visits, avg ${mins(opt.seconds / Math.max(1, opt.visits))}` }], { showPct: false }))}
        ${card("Hours in active use per week", "Screen time with a visitor interacting.",
          columns(weeklyPoints(D.apps.tradeWall, (w) => w.activeSeconds / 3600, (w) => `Week of ${shortDate(w.week)}: ${hours(w.activeSeconds)} h active, ${hours(w.idleSeconds)} h idle`),
            { avg: s.active / 3600 / s.weeks.length, yFmt: (v) => v.toFixed(0) + "h", aria: "active hours per week", cls: "alt" }))}
        ${card("Language chosen", "Near even split — Marathi content is clearly valued here.",
          split([{ label: "English", value: s.english.selections, color: "var(--series-1)" }, { label: "Marathi", value: s.marathi.selections, color: "var(--series-2)" }]))}
        ${card("Kiosk in use vs idle", "Share of logged time someone was interacting vs the screen waiting.",
          split([{ label: "Screen time (h)", value: Math.round(s.active / 3600), color: "var(--series-1)" }, { label: "Idle (h)", value: Math.round(s.idle / 3600), color: "var(--neutral-mark)" }]))}
      </div>`;
  }

  // ---------- FEEDBACK ----------
  function placeGroups(places) {
    const groups = [
      ["International", "Countries & cities abroad"],
      ["Indian state / region", "Indian states / regions (no city given)"],
      ["Indian city / town", "Indian cities, towns & Mumbai neighbourhoods"],
    ];
    return groups.map(([type, title]) => {
      const list = places.filter((p) => p.type === type);
      if (!list.length) return "";
      const people = sum(list.map((p) => p.count));
      return `<div class="group-label">${esc(title)} · ${fmt(list.length)} places · ${fmt(people)} visitors</div>`
        + chipCloud(list.map((p) => [p.name, p.count]), { unit: "visitors", minShown: list.length > 60 ? 2 : 0 });
    }).join("");
  }

  function renderFeedback() {
    const f = FB;
    const toItems = (obj, opts = {}) => Object.entries(obj).filter(([k]) => opts.keepEmpty || k !== "Not given").map(([k, v]) => ({ label: k, value: v, cls: opts.cls }));
    const months = Object.entries(f.monthly);
    const answered = f.total - (f.wordBuckets["No real answer"] || 0);
    const colorFor = { Positive: "var(--good)", "Neutral / other": "var(--series-1)", Negative: "var(--critical)", "No real answer": "var(--neutral-mark)" };
    const words = f.topWords.slice(0, 45);

    document.getElementById("tab-feedback").innerHTML = `
      <div class="tab-head"><h2>Visitor feedback</h2>
        <p>${fmt(f.total)} feedback forms collected at the exhibition screen, ${monthLabel(months[0][0])} – ${monthLabel(months[months.length - 1][0])}. Names and contact details are excluded from this dashboard; open answers are grouped into themes by keyword.</p></div>
      <div class="grid kpis">
        ${kpi("Responses", fmt(f.total), `${fmt(f.testRows)} look like staff tests`)}
        ${kpi("Positive one-word reviews", pct(f.wordBuckets.Positive || 0, answered) + "%", "of meaningful answers")}
        ${kpi("Came with family", pct(f.company.Family || 0, f.total) + "%", `friends ${pct(f.company.Friends || 0, f.total)}%`)}
        ${kpi("Aged 19–25", pct(f.age["19-25"] || 0, f.total) + "%", "largest single age group")}
        ${kpi("Places represented", fmt(f.distinctCities), `incl. ${f.places.filter((p) => p.type === "International").length} abroad`)}
      </div>
      <div class="grid cols-2">
        ${card("Responses per month", "Volume of feedback — a proxy for footfall at the exhibition.",
          columns(months.map(([m, v]) => ({ label: monthLabel(m), value: v, tip: `${monthLabel(m)}: ${fmt(v)} responses` })), { avg: f.total / months.length, aria: "responses per month" })
          + tableView(["Month", "Responses"], months.map(([m, v]) => [monthLabel(m), fmt(v)])))}
        ${card("Age of respondents", "Ordered youngest to oldest.", hbars(toItems(f.age).filter((i) => i.value > 0), { total: f.total }))}
        ${card("How visitors describe the exhibition (one word)", "Each word classified as positive, negative, other, or no real answer (e.g. “no”, “ok”, “abc”).",
          split(Object.entries(f.wordBuckets).map(([k, v]) => ({ label: k, value: v, color: colorFor[k] || "var(--series-3)" })))
          + `<div class="group-label">Most used words (size = frequency)</div>` + chipCloud(words, { unit: "times" }))}
        ${card("Who they visit with", "Visitors could pick more than one option.", hbars(toItems(f.company), { total: f.total }))}
        ${card("Where they usually learn about the ancient world", "Multi-select. School textbooks dominate → strong case for school & youth programmes.", hbars(toItems(f.sources, { cls: "alt" }), { total: f.total }))}
        ${card("What they learned / found surprising — themes", "Keyword themes in the two “what did you learn” answers.", hbars(toItems(f.learnThemes), { total: f.total }))}
        ${card("Artefacts they'd like to keep — themes", "Keyword themes in “Is there one artefact you would like to keep?”.", hbars(toItems(f.keepThemes, { cls: "alt" }), { total: f.total }))}
        ${card("Where respondents come from (top 15)", "Mumbai, Navi Mumbai, Thane & Kalyan grouped as Mumbai metro region.", hbars(toItems(f.cities), { total: f.total }))}
        ${card("Every place visitors named (size = frequency)",
          `Each city, state and country shown separately after fixing spellings (e.g. “Bombay”, “Mumbia” → Mumbai; “Gujrat” → Gujarat). ${fmt(f.unusablePlaces)} answers that weren't a real place (“abc”, “Mars”) are left out. Hover for counts.`,
          placeGroups(f.places), "span-all")}
        ${card("Gender", "", split(Object.entries(f.gender).map(([k, v], i) => ({ label: k, value: v, color: ["var(--series-1)", "var(--series-2)", "var(--neutral-mark)", "var(--series-3)", "#4a3aa7"][i] || "var(--neutral-mark)" }))))}
        ${card("In visitors' own words", "What surprised them most — a sample of answers.", `<div class="quotes">${f.quotes.slice(0, 12).map((q) => `<blockquote class="quote">“${esc(q)}”</blockquote>`).join("")}</div>`, "span-all")}
      </div>`;
  }

  // ---------- DATA HEALTH ----------
  function renderHealth() {
    const appRow = (key) => {
      const a = D.apps[key];
      const q = a.health.emailQueue || {};
      const pending = (q.Pending || 0) + (q.Failed || 0);
      const st = (cond, good, bad, lvl = "critical") => `<span class="status ${cond ? "good" : lvl}">${esc(cond ? good : bad)}</span>`;
      return card(a.name, "", `<table><tbody>
        <tr><th>Weeks archived</th><td>${a.weeks.length} (${shortDate(a.weeks[0].week)} – ${shortDate(a.weeks[a.weeks.length - 1].week)})</td></tr>
        <tr><th>Missing weeks</th><td>${st(!a.missingWeeks.length, "None", a.missingWeeks.map(shortDate).join(", "), "warning")}</td></tr>
        <tr><th>Weekly e-mail reports</th><td>${st(!pending, "All sent", `${q.Pending || 0} pending · ${q.Failed || 0} failed — never delivered`)}</td></tr>
        <tr><th>Errors in kiosk log</th><td>${st(!a.health.logErrors.length, "None", a.health.logErrors.length + " found", "warning")}${a.health.logErrors.map((e) => `<div class="pill">${esc(e)}</div>`).join("")}</td></tr>
      </tbody></table>`);
    };
    const items = [
      { icon: "⚠️", title: "Weekly report e-mails are not being delivered.", text: "Both kiosks queue a CSV every Monday 10:00, but the queue shows only Pending/Failed entries.", action: "Check SMTP/network config on the kiosk PCs; until fixed, use this dashboard (re-run the ETL weekly)." },
      { icon: "📅", title: "Some weeks have no archive file.", text: "Usually the kiosk PC was off/rebooted at the Monday roll-over, or the file was not copied.", action: "Copy the full DataAnalytics folder from each kiosk every week; keep the kiosk on during roll-over." },
      { icon: "♻️", title: "Duplicate week snapshots are handled.", text: "The app sometimes saves a near-empty Monday stub plus the real week (_1 file). The dashboard keeps the most complete one per week.", action: "" },
      { icon: "🧪", title: `${FB.testRows} feedback rows look like staff tests`, text: `and ${fmt(FB.wordBuckets["No real answer"] || 0)} one-word answers are not real answers (“no”, “ok”, “abc”).`, action: "Add a 'test mode' flag or delete test rows at source; consider making key fields required." },
      { icon: "🔒", title: "Feedback export contains personal data (names, e-mails, phones).", text: "This dashboard never loads those columns.", action: "Store the raw export securely and limit who can access it." },
    ];
    document.getElementById("tab-health").innerHTML = `
      <div class="tab-head"><h2>Data health</h2><p>How complete and trustworthy the data is, and what to fix so future reports are better.</p></div>
      <div class="grid cols-2">${appRow("tradeRoute")}${appRow("tradeWall")}
        ${card("Issues & recommendations", "", insightList(items), "span-all")}
        ${D.warnings.length ? card("ETL warnings", "", `<ul>${D.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`, "span-all") : ""}
      </div>`;
  }

  // ---------- AI KEY INSIGHTS ----------
  // Patterns were found by AI-assisted analysis (Claude) of the raw data; every number
  // below is recomputed from the current data bundle, so the panels stay correct after
  // each ETL refresh. Text in **double stars** is rendered highlighted.
  const hl = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<mark>$1</mark>");
  const JEWEL_RE = /earring|bracelet|necklace|hair|ring|pin|ornament|bead|gold|jewel|pendant/i;

  function aiPanel(intro, items) {
    return `<section class="ai-panel" aria-label="AI key insights">
      <div class="ai-head"><span class="ai-badge">✦ AI key insights</span><p>${hl(intro)}</p></div>
      <ol class="ai-list">${items.map((i) => `<li>
        <div class="ai-title">${hl(i.title)}<span class="ai-tag">${esc(i.tag)}</span></div>
        <p class="ai-evidence">${hl(i.evidence)}</p>
        <p class="ai-action"><b>Do this:</b> ${hl(i.action)}</p></li>`).join("")}</ol>
      <p class="ai-foot">Patterns found by AI-assisted analysis of the kiosk logs and feedback forms; numbers recalculate automatically when the data is refreshed. Patterns show where to act, not proof of cause — trial big changes on a small scale first.</p>
    </section>`;
  }

  function aiData() {
    const P = FB.patterns, seg = P.segments;
    const dow = P.dayOfWeek;
    const wkend = (dow.Sat + dow.Sun) / 2, wkday = (dow.Mon + dow.Tue + dow.Wed + dow.Thu + dow.Fri) / 5;
    const negRate = (g) => ((g.sentiment.Negative || 0) / g.n * 100).toFixed(1);
    const posRate = (o) => pct(o.Positive || 0, sum(Object.values(o)) - (o["No real answer"] || 0));
    const months = Object.keys(FB.monthly);
    const intlShare = (m) => (FB.monthly[m] ? (P.monthInternational[m] || 0) / FB.monthly[m] : 0);
    const peakIntl = months.reduce((a, b) => (intlShare(b) > intlShare(a) ? b : a), months[0]);
    const avgIntl = sum(Object.values(P.monthInternational)) / FB.total;
    const keepTop = Object.values(seg).filter((g) => g.keep && Object.keys(g.keep)[0] === "Jewellery & ornaments").length;
    const rtTop10 = RT.ranked.slice(0, 10);
    const rtJewel = rtTop10.filter(([k]) => JEWEL_RE.test(k));
    const routes = routeAggregates().slice().sort((a, b) => b.avgVisit - a.avgVisit);
    const coinItems = RT.ranked.filter(([k]) => /tiberius|nero|justinian|heraclius|aureus|coin/i.test(k));
    const coinAvg = coinItems.length ? sum(coinItems.map((c) => c[1])) / coinItems.length : 0;
    const rtAvg = RT.clicks / Math.max(1, RT.ranked.length);
    const twTop2 = TW.ranked.slice(0, 2);
    const info = TW.screens["Material Information Screen"] || { visits: 1, seconds: 0 };
    const menu = TW.screens["Material Option Screen"] || { visits: 1, seconds: 1 };
    const trendTW = TW.prev4 ? Math.round(((TW.last4 - TW.prev4) / TW.prev4) * 100) : 0;
    const peakMonth = Object.entries(FB.monthly).reduce((x, y) => (y[1] > x[1] ? y : x))[0];
    return { seg, dow, wkend, wkday, negRate, posRate, os: P.originSentiment, peakIntl, intlShare, avgIntl, keepTop,
      rtTop10, rtJewel, routes, coinAvg, rtAvg, twTop2, info, menu, trendTW, peakMonth,
      young: seg["Young adults 19-30"], teens: seg["Teens 11-18"], seniors: seg["Seniors 66+"],
      dates: FB.company["Partner / date"] || 0 };
  }
  const trendText = (t) => (t < 0 ? `down ${Math.abs(t)}%` : `up ${t}%`);

  function aiOverview() {
    const a = aiData();
    return aiPanel("The five biggest growth levers in your data — each one confirmed by **more than one data source**.", [
      { tag: "Brand & revenue", title: "**Jewellery & adornment** is what visitors love most — everywhere",
        evidence: `“${TW.ranked[0][0].trim()}” is the #1 material on the Trade Wall (**${pct(TW.ranked[0][1], TW.clicks)}% of taps**), **${a.rtJewel.length} of the top 10** Trade Route artefacts are jewellery, and jewellery is the #1 “artefact I'd like to keep” in **${a.keepTop} of ${Object.keys(a.seg).length} age groups**.`,
        action: "Create a **“Jewels of the Ancient World” trail** and campaign; stock **replica-jewellery merchandise** in the shop; lead social posts with these objects." },
      { tag: "Attract visitors", title: `Weekend days are **${(a.wkend / a.wkday).toFixed(1)}× busier** than weekdays`,
        evidence: `Saturday + Sunday bring **${pct(a.dow.Sat + a.dow.Sun, FB.total)}%** of all feedback (2 of 7 days); a weekday averages only ${fmt(a.wkday)}.`,
        action: "Fill weekdays with **school-group slots, senior mornings and corporate visits** plus weekday-only offers; add floor staff on weekends." },
      { tag: "New audience", title: `Young adults 19–30 are your **largest audience (${pct(a.young.n, FB.total)}%)**`,
        evidence: `They come mostly **with friends** (${fmt(a.young.company.Friends || 0)}), make up ${pct(a.young.company["Partner / date"] || 0, a.dates)}% of all **“on a date”** visits, and **${pct(a.young.source["Social media"] || 0, a.young.n)}%** learn history on social media.`,
        action: "Run **evening “museum after dark” / date-night events** and Instagram reels or creator collaborations featuring the top artefacts." },
      { tag: "Education", title: `**School trips are a missed opportunity** — only ${pct(FB.company["School / college trip"] || 0, FB.total)}% of visits`,
        evidence: `Yet **${pct(a.teens.source["School textbooks"] || 0, a.teens.n)}% of teens** say textbooks are where they learn about the ancient world.`,
        action: "Package **curriculum-linked school programmes** (Harappan trade, Silk Route) with worksheets and kiosk challenges; offer them on quiet weekdays." },
      { tag: "Engagement", title: `Trade Wall use is **${trendText(a.trendTW)}** over the last 4 weeks`,
        evidence: `Both kiosks also sit **idle ${pct(TW.idle + RT.idle, TW.idle + RT.idle + TW.active + RT.active)}%** of logged time.`,
        action: "Add an **attract-mode video loop** with a “Touch to explore” prompt; trial moving one kiosk nearer the gallery entrance for 2 weeks and compare." },
    ]);
  }

  function aiRoute() {
    const a = aiData(), deep = a.routes[0], shallow = a.routes[a.routes.length - 1];
    return aiPanel("What the Trade Route kiosk tells us about **what makes content engaging**.", [
      { tag: "Content", title: `**More stories = more time**: ${deep.name} holds visitors ${(deep.avgVisit / Math.max(1, shallow.avgVisit)).toFixed(1)}× longer than ${shallow.name}`,
        evidence: `${deep.name} has **${deep.artefacts} artefacts** and keeps visitors **${mins(deep.avgVisit)}** per visit; ${shallow.name} has only **${shallow.artefacts}** and holds **${mins(shallow.avgVisit)}**.`,
        action: `**Add more artefacts and stories to ${shallow.name}** (and other small routes) — content depth goes hand in hand with time spent.` },
      { tag: "Brand & revenue", title: `**Personal adornment** dominates: ${a.rtJewel.length} of the top 10 artefacts are jewellery`,
        evidence: `Top three: ${a.rtTop10.slice(0, 3).map(([k, v]) => `**${k}** (${fmt(v)})`).join(", ")}.`,
        action: "Build a cross-route **“Fashion across empires”** story (Roman, Persian and Indian jewellery side by side) — a natural exhibition spin-off and shop theme." },
      { tag: "Quick win", title: "**Coins are wanted but not found**",
        evidence: `“Coins” is the **#2 artefact visitors want to keep** (${fmt(FB.keepThemes.Coins || 0)} mentions), yet emperor/coin items on the kiosk average only **${fmt(a.coinAvg)} taps** vs **${fmt(a.rtAvg)}** for a typical artefact.`,
        action: "Retitle these so the coin is obvious (e.g. **“Gold coin of Emperor Tiberius”**) and use a close-up thumbnail; re-check taps after 4 weeks." },
      { tag: "Accessibility", title: `**${pct(RT.marathi.selections, RT.marathi.selections + RT.english.selections)}%** of language switches are to Marathi`,
        evidence: "Many visitors actively choose Marathi even though English is the default.",
        action: "Keep Marathi complete for every new artefact; trial **Hindi** as a third language." },
    ]);
  }

  function aiWall() {
    const a = aiData(), last = TW.ranked[TW.ranked.length - 1];
    return aiPanel("What the Interactive Trade Wall reveals about **Harappan stories that resonate**.", [
      { tag: "Content", title: `**Luxury materials win**: ${a.twTop2.map(([k]) => k.trim()).join(" & ")} take **${pct(a.twTop2[0][1] + a.twTop2[1][1], TW.clicks)}%** of taps`,
        evidence: `“${last[0].trim()}” gets the fewest (**${fmt(last[1])}**) — ${(TW.ranked[0][1] / Math.max(1, last[1])).toFixed(1)}× fewer than the leader.`,
        action: `Re-frame low performers through what people love: present **${last[0].trim()} & Carnelian as “the beads in Harappan jewellery”** and refresh their thumbnails.` },
      { tag: "Engagement", title: `Visitors **read deeply — ${mins(a.info.seconds / Math.max(1, a.info.visits))}** per material`,
        evidence: `In total, people spend **${(a.info.seconds / Math.max(1, a.menu.seconds)).toFixed(1)}×** more time on material stories than on the menu.`,
        action: "Add **more gallery images, “Did you know?” facts and a short quiz** per material — this audience has the attention span for it." },
      { tag: "Attract visitors", title: `Best week was **${shortDate(TW.best.week)}** (${fmt(TW.best.clicks)} taps, ${(TW.best.clicks / TW.avgWeek).toFixed(1)}× average)`,
        evidence: `Use is **${trendText(a.trendTW)}** in the last 4 weeks vs the 4 before.`,
        action: "Find what drove the peak (holiday, event, promotion) and **put it back on the calendar**; check the recent drop for placement, crowding or kiosk faults." },
      { tag: "Accessibility", title: `**Marathi nearly equals English** (${pct(TW.marathi.selections, TW.marathi.selections + TW.english.selections)}% of choices)`,
        evidence: "The Trade Wall audience is strongly local and Marathi-speaking.",
        action: "Promote the exhibition in **Marathi media and Maharashtra schools**; keep bilingual signage beside the wall." },
    ]);
  }

  function aiFeedback() {
    const a = aiData(), os = a.os;
    return aiPanel("Who your visitors are, when they come, and **what would bring more of them**.", [
      { tag: "Attract visitors", title: `**${pct(a.dow.Sat + a.dow.Sun, FB.total)}% of feedback arrives on weekends**`,
        evidence: `Sunday is the busiest day (**${fmt(a.dow.Sun)}** responses), Wednesday the quietest (**${fmt(a.dow.Wed)}**).`,
        action: "Put workshops and tours on weekends; use **weekday discounts and school bookings** to spread demand." },
      { tag: "Tourism", title: `**${monthLabel(a.peakIntl)}** is the international-visitor season`,
        evidence: `Foreign visitors were **${Math.round(a.intlShare(a.peakIntl) * 100)}%** of responses that month vs **${(a.avgIntl * 100).toFixed(1)}%** on average. They are also less enthusiastic: **${a.posRate(os.International || {})}%** clearly positive vs **${a.posRate(os["Mumbai region"] || {})}%** for Mumbai locals.`,
        action: "Before winter, partner with **hotels, travel platforms and tour operators**; add context labels or an **audio guide for visitors new to Indian history**." },
      { tag: "Inclusion", title: "**Seniors are the least satisfied** group",
        evidence: `**${a.negRate(a.seniors)}%** of seniors give a negative one-word review vs ${a.negRate(a.young)}% of young adults; seniors most often visit **with a partner** (${fmt(a.seniors.company["Partner / date"] || 0)}).`,
        action: "Add **seating, larger text and quieter senior-morning slots**, plus a slower guided tour for couples." },
      { tag: "Marketing", title: "**Family is the core**, with friends & couples close behind",
        evidence: `Family ${pct(FB.company.Family || 0, FB.total)}%, friends ${pct(FB.company.Friends || 0, FB.total)}%, **dates ${pct(a.dates, FB.total)}%**. The busiest month was **${monthLabel(a.peakMonth)}**, in the summer school holidays.`,
        action: "Offer **family tickets and kids' activity sheets** in holidays, and **couple/friends bundles** (museum + café) on weekend evenings." },
    ]);
  }

  function aiHealth() {
    const age85 = FB.age["85+"] || 0, age66to84 = (FB.age["66-74"] || 0) + (FB.age["75-84"] || 0);
    return aiPanel("Small changes in **how data is collected** would unlock much better decisions.", [
      { tag: "Data", title: "**Add 2 questions** to the feedback form",
        evidence: "Today there is no way to tell how people heard about the museum, or whether they'd recommend it.",
        action: "Add **“How did you hear about us?”** (measures marketing) and **“How likely are you to recommend us? (0–10)”** — one score to track every month." },
      { tag: "Data", title: `**${fmt(age85)} people chose “85+”** — more than ages 66–84 combined (${fmt(age66to84)})`,
        evidence: `And **${pct(FB.wordBuckets["No real answer"] || 0, FB.total)}%** of one-word answers are “no”, “ok” or “abc” — likely jokes or a pre-selected option.`,
        action: "Start the age list empty (no default) and make the one-word question **required, minimum 3 letters**." },
      { tag: "Data", title: "Kiosks don't record **time of day** or **route per tap**",
        evidence: "So we can't see the busiest hours, or which route an artefact was opened from.",
        action: "Ask the developer to log **a timestamp and route name with every tap** — enables hourly staffing plans and true route comparisons." },
      { tag: "Operations", title: "**Weekly reports never reached your inbox**",
        evidence: "Every queued e-mail report is Pending or Failed on both kiosks.",
        action: "Fix the kiosk e-mail settings, or **refresh this dashboard weekly** and share it with the team." },
    ]);
  }

  // ---------- tabs, theme, boot ----------
  const tabs = document.querySelectorAll('[role="tab"]');
  function show(name) {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.setAttribute("aria-selected", String(on));
      // Keep the active tab visible when the tab bar scrolls sideways on phones.
      if (on) t.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + name));
    try { localStorage.setItem("csmvs-tab", name); } catch (e) { /* storage unavailable */ }
    window.scrollTo({ top: 0 });
  }
  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.tab)));

  const themeBtn = document.getElementById("themeToggle");
  const isDark = () => {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };
  // Button names the mode it switches TO.
  const syncThemeBtn = () => {
    themeBtn.textContent = isDark() ? "☀ Light mode" : "☾ Dark mode";
    themeBtn.setAttribute("aria-label", isDark() ? "Switch to light mode" : "Switch to dark mode");
  };
  themeBtn.addEventListener("click", () => {
    document.documentElement.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("csmvs-theme", document.documentElement.dataset.theme); } catch (e) { /* ignore */ }
    syncThemeBtn();
  });
  try {
    const th = localStorage.getItem("csmvs-theme");
    if (th) document.documentElement.dataset.theme = th;
  } catch (e) { /* ignore */ }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeBtn);
  syncThemeBtn();

  const renderers = [renderOverview, renderRoute, renderWall, renderFeedback, renderHealth];
  renderers.forEach((fn) => {
    try { fn(); } catch (err) {
      console.error(fn.name, err); // keep other tabs working if one fails
    }
  });
  // AI insight panel appended to the end of each tab.
  [["overview", aiOverview], ["route", aiRoute], ["wall", aiWall], ["feedback", aiFeedback], ["health", aiHealth]].forEach(([tab, fn]) => {
    try { document.getElementById("tab-" + tab).insertAdjacentHTML("beforeend", fn()); } catch (err) {
      console.error("AI insights", tab, err);
    }
  });
  document.getElementById("foot").textContent =
    `Data bundle generated ${D.generatedAt} by etl/build_data.py · Refresh: copy new kiosk/feedback exports into Data/ and re-run the script.`;

  let start = "overview";
  try { start = localStorage.getItem("csmvs-tab") || start; } catch (e) { /* ignore */ }
  show(document.getElementById("tab-" + start) ? start : "overview");
})();
