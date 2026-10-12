"""
Privacy + integrity gate for the published data bundle.

Fails (exit 1) if dashboard/data/dashboard-data.js:
  * is missing or not valid JSON after the `window.DASHBOARD_DATA =` prefix,
  * lacks the expected top-level sections,
  * contains anything that looks like an e-mail address or phone number
    (image URLs are ignored - their UUIDs contain long digit runs).

Runs in CI before every deploy, and can be run locally:  python etl/check_bundle.py
Standard library only.
"""
from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE = os.path.join(ROOT, "dashboard", "data", "dashboard-data.js")

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
# 10+ digits, optionally with +, spaces or dashes (Indian & international numbers).
PHONE_RE = re.compile(r"(?<![\w/-])\+?\d[\d \-]{8,}\d(?![\w-])")
URL_RE = re.compile(r"https?://[^\"\s]+")
DATETIME_RE = re.compile(r"\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?")


def walk_strings(node, path="$"):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from walk_strings(k, f"{path}.<key>")
            yield from walk_strings(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk_strings(v, f"{path}[{i}]")


def main() -> int:
    if not os.path.exists(BUNDLE):
        print(f"FAIL: bundle not found: {BUNDLE}")
        return 1
    text = open(BUNDLE, encoding="utf-8").read()
    try:
        payload = text[text.index("=") + 1:].strip().rstrip(";")
        data = json.loads(payload)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL: bundle is not valid JSON: {exc}")
        return 1

    problems = []
    for key in ("apps", "feedback", "generatedAt"):
        if key not in data:
            problems.append(f"missing top-level key '{key}'")
    for app in ("tradeRoute", "tradeWall"):
        if not data.get("apps", {}).get(app, {}).get("weeks"):
            problems.append(f"apps.{app}.weeks is empty")

    for path, value in walk_strings(data):
        scrubbed = DATETIME_RE.sub("", URL_RE.sub("", value))
        if EMAIL_RE.search(scrubbed):
            problems.append(f"possible e-mail at {path}")
        # Dates/timestamps are stripped above; still require 10+ real digits for a phone.
        if any(sum(c.isdigit() for c in m.group()) >= 10 for m in PHONE_RE.finditer(scrubbed)):
            problems.append(f"possible phone number at {path}")

    if problems:
        print("FAIL: bundle check found problems:")
        for p in problems[:50]:
            print("  -", p)
        return 1
    print(f"OK: bundle valid, no e-mails/phone numbers found ({os.path.getsize(BUNDLE) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
