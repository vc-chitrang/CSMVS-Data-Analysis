# CSMVS Gallery Insights

[![CI / Deploy to GitHub Pages](../../actions/workflows/deploy.yml/badge.svg)](../../actions/workflows/deploy.yml)

Single-page analytics dashboard for the **Chhatrapati Shivaji Maharaj Vastu Sangrahalaya (CSMVS)**
exhibition. It turns raw kiosk logs and visitor feedback forms into clear charts, key findings and
recommended actions for the museum team.

**Live site:** https://vc-chitrang.github.io/CSMVS-Data-Analysis/

## What's inside

| Tab | What it shows |
|---|---|
| **Overview** | Headline KPIs, auto-computed key findings with suggested actions, weekly trend for both kiosks |
| **Trade Route kiosk** | Route opens & time per visit, total time per route, weekly taps (gaps marked), top/least-tapped artefacts with thumbnails, language, idle time |
| **Interactive Trade Wall** | Material popularity, reading time, weekly taps & active hours, language split |
| **Visitor feedback** | Monthly volume, age, companions, learning sources, themes of what visitors learned / want to keep, places of origin (city/state/country cloud), one-word sentiment & word cloud, visitor quotes |
| **Data health** | Missing weeks, undelivered report e-mails, log errors, test rows, data-collection fixes |

Every tab ends with a highlighted **✦ AI key insights** panel — patterns found by AI-assisted
analysis (Claude) across kiosk + feedback data, each with evidence and a "Do this" action. The
wording was written once; every number is recomputed from the data, so the panels stay correct
after each refresh. No AI service is called at runtime (works offline; visitor text never leaves
the machine).

Light & dark mode, mobile-friendly, every chart has hover tooltips and a "Show as table" view.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| ETL | Python 3.9+ standard library (`etl/build_data.py`) | ~1 MB input; zero installs on museum PCs; parses `.xlsx` with `zipfile` |
| Front end | Vanilla HTML / CSS / JS, hand-built SVG charts | No build step, no CDN; works from `file://`, offline |
| Hosting | GitHub Pages (static) | Free, versioned, deploys from CI |
| CI/CD | GitHub Actions (`.github/workflows/deploy.yml`) | Lint + privacy gate on every push/PR, auto-deploy on `main` |

## Run locally

Requirements: Python 3.9+ (Node.js only needed for the optional JS syntax check).

```bash
python etl/build_data.py
```

```bash
python serve.py
```

Open http://127.0.0.1:8080 (set the `PORT` environment variable to use another port).
You can also double-click `dashboard/index.html` — the data loads as a plain script, so `file://` works.

## Refreshing the data

1. Copy the latest kiosk folders (`Trade Route/`, `Interactive Trade Wall/`) and the newest
   `feedback_export_all_*.xlsx` into `Data/` (git-ignored, stays on your machine).
2. Rebuild and verify the bundle:
   ```bash
   python etl/build_data.py
   ```
   ```bash
   python etl/check_bundle.py
   ```
3. Bump the `?v=` number on the asset links in `dashboard/index.html` (cache-busting), then commit
   `dashboard/data/dashboard-data.js` and push to `main` — CI verifies and redeploys automatically.

## CI/CD

`.github/workflows/deploy.yml`:

- **On every push and pull request** — Python + JS syntax checks, the **privacy & integrity gate**
  (`etl/check_bundle.py`: bundle must be valid and contain no e-mail addresses or phone numbers),
  a check that no raw data files are tracked, and a smoke test that serves the site.
- **On push to `main`** — if verification passes, publishes `dashboard/` to GitHub Pages.

## Deployment

One-time setup in the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The live URL is shown in the workflow run summary and under **Settings → Pages**
(format: `https://<owner>.github.io/<repo>/`).

## Privacy & security

- `Data/` holds the raw feedback export with **visitor names, e-mails and phone numbers**. It is
  git-ignored and must never be committed; CI fails if raw data files are tracked.
- The published bundle contains only aggregates, keyword themes and short quotes scrubbed of
  anything that looks like contact details — enforced by `etl/check_bundle.py` in CI.
- GitHub Pages sites are **publicly reachable** unless the repo belongs to GitHub Enterprise Cloud
  with private Pages enabled. Confirm the client has approved sharing before making the URL known.
- All visitor text is HTML-escaped before rendering; the dashboard has no inputs, cookies or tracking.

## Design decisions

| Decision | Why | Revisit when |
|---|---|---|
| Python stdlib ETL → static JS bundle | Small data, one audience; no server/DB to run or secure | Data must update live from kiosks → small API + scheduled ETL |
| Aggregate in ETL, never ship raw rows | Feedback export contains PII | — keep this |
| Commit the bundle, not raw data | CI can't (and shouldn't) see PII | Data moves to a secure store CI can read |
| Keep latest `lastSavedAt` snapshot per week | Kiosks sometimes archive a Monday stub **and** the full week (`_1`); summing would double-count | Kiosk app fixes archiving |
| Route charts use route-screen visits/time, not taps | Artefacts appear on several routes; taps are logged by title only | Kiosk logs route with each tap |
| Keyword themes for open answers | Transparent, reproducible, offline | Richer topic analysis needed |

## Known data caveats

- Missing archive weeks: Trade Route 14 Sep & 5 Oct 2026; Trade Wall 10 Aug 2026 (dashed boxes in charts).
- Weekly e-mail reports on both kiosks are stuck as Pending/Failed.
- "Screen time" and "idle time" are separate kiosk counters and may overlap — read shares as rough indicators.
- Feedback: ~39 rows look like staff tests; ~11% of one-word answers aren't real answers; themes are keyword-based (approximate).
- Feedback volume is used as a proxy for footfall (it is not ticket data).

## Project structure

```
.github/workflows/deploy.yml   CI (lint + privacy gate) and CD (GitHub Pages)
Data/                          raw exports - git-ignored, contains PII
etl/build_data.py              ETL: Data/ -> dashboard/data/dashboard-data.js
etl/check_bundle.py            privacy & integrity gate (used by CI)
dashboard/index.html           single-page app shell (5 tabs)
dashboard/app.js               rendering, charts, findings, AI insight panels
dashboard/styles.css           light/dark theme, validated colour palette, responsive layout
dashboard/data/                generated, PII-free data bundle (committed)
serve.py                       local static server (127.0.0.1, PORT env)
```
