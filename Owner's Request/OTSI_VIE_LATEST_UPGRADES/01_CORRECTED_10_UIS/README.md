# OTSI VIE — ten corrected clean-state UIs

Ten standalone HTML pages, corrected from `OTSI_VIE_INDEPENDENT_10_PAGE_VISUAL_IMPLEMENTATION_CONTRACTS.zip` using the defects in `OTSI_VIE_FOUR_WAY_DEEP_COMPARISON.zip`. The approved composition, typography, colours and panel geometry are preserved. **No fabricated operational data is shown:** no players, clubs, matches, scores, statistics, detections, tracks, jobs, telemetry, reels, reports, assets, collaborators or deliveries. Each affected component shows a short, truthful empty state inside its existing frame.

| Item | |
|---|---|
| `01_…html` – `10_…html` | Corrected pages. Self-contained: inline CSS/JS/SVG, no external resources. Open at 16:9; best at 2560 × 1440 (fixed QHD stage, scale-to-fit). |
| `INDEX.html` | Links to all ten pages |
| `screenshots_2560x1440/` | Actual Chromium captures of the corrected pages |
| `CORRECTION_REGISTER.md` | Every change, page by page |
| `VERIFICATION_RESULTS.md` | JS errors, navigation, overlap/clipping checks, mock-data scan, geometry and pixel comparison |
| `verification/` | Machine-readable results (corrected run, original-file baseline, pixel diffs) |
| `tools/` | `fix_pages.py` re-applies every correction to the original HTML; `verify.js` re-runs the checks (playwright-core + Chrome) |

The pages remain **visual references only**: controls are not wired to any backend. Nothing in the live OTSI engine, frontend, API, database or workers was touched.
