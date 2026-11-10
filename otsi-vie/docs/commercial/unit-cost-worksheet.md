# Option B Managed Service — Unit-Cost Worksheet (Phase 0 Gate)

- **Status:** Draft — owner approval pending. No price is stated in this worksheet until the measured cost exists.
- **Scope:** the Phase 0 gate for the Option B Managed Service. It turns measured compute minutes and analyst minutes per match into a per-match and per-package unit cost.
- **Companion documents:** `spotlight-sop.md` (the SOP this worksheet costs) and `unit-cost-worksheet.csv` (the same tables in spreadsheet form, with formulas — fill the input cells and the totals follow).
- **Blueprint:** `otsi-vie/docs/ULTRA_ENHANCEMENT_BLUEPRINT.md` §7 (Option B — Commercial SOP) and §8 P4.

## How to use this worksheet

1. **Fill only the input cells.** Every input cell is marked `[input]` and is blank. Nothing in this worksheet is a measured number yet: there is no real footage in the repo, no host cost figure in the repo, and no timed run on the owner's host. Do not copy a number from a synthetic test (Track U compare scripts, stub-model timings) into an input cell — those measure logic, not cost.
2. **Totals follow from inputs.** Each cost line is `minutes ÷ 60 × rate`. The per-match total is the sum of its lines. The per-package totals are the per-match total plus the package's extra lines. The CSV carries the same formulas.
3. **Measure, then price.** Phase 0 is complete when the input cells hold measured numbers from real runs (the Phase 2 dry-run, `spotlight-sop.md` §11, is the first source). Price is set from the measured unit cost plus the owner's margin — the margin is an owner decision and is an input, not a formula in this sheet.
4. **Re-measure when the engine changes.** A Track U feature that changes minutes per step, a model change, or a host change means re-timing the affected lines. Record the run id and date with every measurement so a cost can be traced to the run that produced it.

## 1. Global inputs — fill once, reuse everywhere

| # | Input | Value | Source / note |
|---|---|---|---|
| G1 | Host compute rate (GPU node, per hour) `[input]` | | Owner's host cost. Currency: `[input]`. If the host is billed per minute, convert to an hourly rate and note the basis here. |
| G2 | Analyst rate (per hour) `[input]` | | Owner's analyst cost. Currency: same as G1. |
| G3 | Currency `[input]` | | One currency for the whole sheet. |
| G4 | Margin / markup on unit cost `[input]` | | Owner decision. Applied after the unit cost, not inside it. |
| G5 | Match measured (run id, date, match) `[input]` | | The run the numbers below were timed on. One worksheet per measured match until the numbers are stable, then a reference run. |

## 2. Match inputs — the drivers of every line

| # | Input | Value | Note |
|---|---|---|---|
| M1 | Match length (minutes) `[input]` | | Full match duration as ingested. |
| M2 | Resolution (e.g. 1080p / 4K) `[input]` | | Drives DETECT and render minutes. |
| M3 | Frame rate (fps) `[input]` | | Drives DETECT minutes. |
| M4 | Number of shots / camera cuts `[input]` | | Drives SHOTS and calibration work. |
| M5 | Players in scope (Scouting Pack) `[input]` | | Drives IDENTIFY and report analyst time. 1 for a Single Match Spotlight. |
| M6 | Events in scope for review `[input]` | | Count of event candidates the analyst reviews (§7.1). Drives review time. |

## 3. Per-match compute cost

One line per pipeline step (`spotlight-sop.md` §5). Minutes are wall-clock minutes on the owner's host for the match in §2. Rate is G1 for every line unless a step runs on different hardware — if it does, note it in the line.

| # | Step (SOP §) | Driver | Minutes `[input]` | Rate | Cost |
|---|---|---|---|---|---|
| C1 | Ingest (§5.1) | File size / link fetch | | G1 | `= minutes ÷ 60 × G1` |
| C2 | SHOTS + kickoff scan (§5.2) | M1, M4 | | G1 | `= minutes ÷ 60 × G1` |
| C3 | DETECT (§5.3) | M1, M2, M3, tiling (U.7) | | G1 | `= minutes ÷ 60 × G1` |
| C4 | TRACK (§5.4) | M1, track count | | G1 | `= minutes ÷ 60 × G1` |
| C5 | IDENTIFY — appearance / Re-ID (§5.5) | M5, crops | | G1 | `= minutes ÷ 60 × G1` |
| C6 | IDENTIFY — jersey OCR (§5.5) | M5, crops | | G1 | `= minutes ÷ 60 × G1` |
| C7 | Ball tracking (§5.6) | M1 | | G1 | `= minutes ÷ 60 × G1` |
| C8 | Pitch calibration (§5.7) | M4, shots | | G1 | `= minutes ÷ 60 × G1` |
| C9 | Events (§5.8) | M1, M6 | | G1 | `= minutes ÷ 60 × G1` |
| C10 | Rendering — Spotlight reel (§8.4) | M1, M2, reel length | | G1 | `= minutes ÷ 60 × G1` |
| C11 | Rendering — extra renders / re-renders (§8.4) | Re-render count | | G1 | `= minutes ÷ 60 × G1` |
| C12 | Storage — raw footage + renders (per match, per retention period) | File sizes, retention days (§12) | — | — | `[input]` — storage is not per-minute; enter the match's storage cost for its retention period, or `0` if storage is unmetered on the host and note that. |
| **C-TOTAL** | **Per-match compute cost** | | **sum of minutes** | | **sum of C1–C12** |

Notes:

- **Async inference (U.8)** changes C3/C5/C6 minutes; re-time those lines after it is enabled on the host. Do not carry the stub-model timing (sync 0.403 s vs async 0.103 s on a fake model) into this sheet — it is scheduling overlap, not a device result.
- **Horizon tiling (U.7)** changes C3: 6 passes vs 14 for blind grids on the same frame. The minutes saved are whatever the host measures, entered in C3.
- **Re-renders (C11):** a review decision that changes a reel forces a new render (ADR-003 — renders are immutable). Count re-renders per match from the dry-run, not from a guess.
- **Failed runs:** a run that fails part-way still consumed the minutes of the steps that ran. Failed-run cost is recorded separately (see §6) and is not hidden inside the per-match total.

## 4. Per-match analyst cost

One line per SOP step the analyst performs. Minutes are timed analyst minutes for the match in §2. Rate is G2 for every line.

| # | Step (SOP §) | Driver | Minutes `[input]` | Rate | Cost |
|---|---|---|---|---|---|
| A1 | Intake + rights confirmation (§3, §4) | Client, rights check | | G2 | `= minutes ÷ 60 × G2` |
| A2 | Ingest check + run monitoring (§5) | M1, failures | | G2 | `= minutes ÷ 60 × G2` |
| A3 | Event review — accept/reject/edit (§7.1) | M6 | | G2 | `= minutes ÷ 60 × G2` |
| A4 | Identity + role confirmation (§7.2) | M5 | | G2 | `= minutes ÷ 60 × G2` |
| A5 | Evidence audit — unmeasured labelling (§7.3) | Metrics in scope | | G2 | `= minutes ÷ 60 × G2` |
| A6 | Delivery preparation + delivery gate (§8) | Pack(s) | | G2 | `= minutes ÷ 60 × G2` |
| A7 | Client communication (questions, corrections) | Per match | | G2 | `= minutes ÷ 60 × G2` |
| **A-TOTAL** | **Per-match analyst cost** | | **sum of minutes** | | **sum of A1–A7** |

Notes:

- A3 is the largest analyst line on a first match and the one that falls fastest as the engine improves — re-time it per pilot, do not freeze the first measurement.
- A7 is real work. If the first pilots show it dominating, that is a finding for the SOP, not a reason to drop the line.

## 5. Per-match and per-package unit costs

| # | Total | Formula | Value |
|---|---|---|---|
| T1 | Per-match unit cost (compute + analyst) | C-TOTAL + A-TOTAL | |
| T2 | Single Match Spotlight — unit cost | T1 + any Spotlight-only extra (none identified yet; add a line if one appears) | |
| T3 | Scouting Pack — unit cost | T1 + extra report time per player in scope (A4/A5 scale with M5 — already in A-TOTAL; add a line here only if a Scouting-only step appears) | |
| T4 | Price basis (before margin) | T2 / T3 as applicable | |
| T5 | Client price (with margin G4) | T4 × (1 + G4) | |

Team Tactical has no line in this worksheet: it is held back (§8.3 of the SOP) and is not costed until G08 passes.

## 6. What is not in the unit cost (record separately)

| Item | Why separate | Where it is recorded |
|---|---|---|
| Failed / re-run compute | A failed run's consumed minutes are waste, not part of a good match's cost; hiding them flatters the unit cost. | Dry-run / pilot log: run id, step failed at, minutes consumed. |
| Phase 0 benchmark cost | Labelling ground truth and running the Track G harness is a one-off gate cost, not a per-match cost. | Track G evidence bundle + labelling log. |
| Host fixed cost (if any) | A monthly host fee does not scale per match; allocate it only by an owner decision, recorded here. | Owner decision note: allocation basis, or `not allocated`. |
| Owner time (approvals, invoicing, pilot sales) | Owner time is not analyst time; mixing them hides the analyst cost. | Owner log, if tracked. |

## 7. Open inputs for the owner

1. Host compute rate G1 and its basis (per-hour GPU node, or other) — no host cost figure exists in the repo.
2. Analyst rate G2 and currency G3.
3. Margin G4.
4. Storage cost basis for C12 (metered or unmetered on the host).
5. The measured match (G5) — needs the Sukhum footage pick; no footage is in the repo at the time of writing.
6. Whether failed-run cost and host fixed cost are allocated into the price or absorbed — see §6.
