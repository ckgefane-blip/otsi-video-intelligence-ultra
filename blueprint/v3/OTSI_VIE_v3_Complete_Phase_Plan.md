# OTSI VIE v3 — Complete Phase Plan (all phases, one document)

*Companion to `OTSI_VIE_v3_Screen_Level_Upgrade_Blueprint.md`. Built from your v2 engine blueprint (2026-11-06) and the 10 screenshots. Everything here is a proposal; nothing is built.*

**How to read it.** Each phase lists its items with an ID, what it delivers, what it depends on, and a "done when" test. **Size:** S = small change to one page, M = touches several pages or adds a table or job, L = new subsystem. Sizes are relative, not time estimates; I have not seen your code. **P1–P18** are the screen problems and **S01–S14** the shell upgrades from the screen-level blueprint.

**Order at a glance**

| Phase | Name | Type | Starts when |
|---|---|---|---|
| 0 | Truth and polish | Fixes only | Now |
| A | Shell and trust | UI + small engine | After 0 |
| B | Editing and discovery | UI + engine | After A |
| C | Depth | UI + engine | After B |
| D | Commercial readiness | Operations, legal, billing | Starts in parallel with A, gates the release |
| E | Football features not yet built | Engine + UI | Can start after A; feeds B and C |
| Track G | Accuracy measurement (G01) | Data and testing | Now, in parallel with everything |

**The rule across all phases:** no interface may make a number look more certain than it is. While accuracy is unmeasured, every value keeps its evidence badge and "accuracy not yet measured".

---

## Phase 0 · Truth and polish (no new features)

Goal: the screens tell the truth and match the engine. Nothing new is added.

| ID | Item | Fixes | Size | Depends on |
|---|---|---|---|---|
| 0.1 | Processing page reads one run: Preview tiles, Output Summary and Timeline use the same data; fix "Loading…" and the black preview | P1 | M | — |
| 0.2 | Rename pipeline steps to the engine's jobs; remove "Event Detection: Not built" and "Indexing: Not built"; rename step 3 to "Identity evidence (no identity assigned)" | P2, P3 | S | — |
| 0.3 | Export: rename "AI-generated tactical analysis" to "Rule-built analysis"; Home and Report: "Generated Insights" to "Rule-built insights" | P4 | S | — |
| 0.4 | Clip Studio: rename or hide AI Edit, AI Highlights, AI Insights, Auto Captions, Voiceover until each exists | P5 | S | Decision 4 |
| 0.5 | Upload: remove Stabilize, Enhance Quality, Remove Crowd Noise, Correct Aspect Ratio from the analysis path (or move to "Playback copy only", default OFF) | P6 | S | Decision 2 |
| 0.6 | One upload limit (64 GB or 50 GB) on Home and Upload, read from config | P7 | S | — |
| 0.7 | Single summary service for Home totals, Library counts, Recent Matches (S10) | P8 | M | — |
| 0.8 | Carry the selected match across pages (first version of S01) | P9 | M | — |
| 0.9 | Empty-state component; remove raw IDs as titles, blank "—" rows and empty placeholder cards (S08) | P10 | S | — |
| 0.10 | Library left panel: remove overlay, team-filter and time-range controls | P11 | S | — |
| 0.11 | Home hero: bind to the latest confirmed player or a neutral sample, with badges; hide Trusted Partners until licensing is confirmed | P12, P13 | S | Decision 5 |
| 0.12 | Preview flag: "Not built" and "delivery is not built yet" show only in Dev mode (S09); fix Export stepper states | P14 | S | — |
| 0.13 | Reel Builder: wrap the truncated overlay note; four aspect ratios everywhere including 4:5 | P15 | S | — |
| 0.14 | Clip Studio: carry Player, Match, Event Type, Timestamp from the moment into the clip inspector | P16 | M | — |
| 0.15 | Player Report: replace "Tracking Confidence" with "Identity: Confirmed/Unverified" plus "Evidence coverage" | P17 | S | — |
| 0.16 | Audit every tile and panel against what the engine computes; hide those not built (xG, xA, Sprints, Carry, Tackles, Interceptions, Off-Ball Runs, PPDA, Formation Stability and similar) | P18 | M | Decision 3 |
| 0.17 | Explain or rename the "QHD" badge (S04); check "Everyone" in Library collaborators against project access | — | S | Decisions 6, 7 |

**Done when:** every item in the P1–P18 list is closed, nothing on a page contradicts the engine, and no internal message reaches a customer.

---

## Phase A · Shell and trust

Goal: the structure every page shares, and the trust components.

| ID | Item | Size | Depends on |
|---|---|---|---|
| A.1 | Persistent context bar Project ▸ Match ▸ Player (full S01) | M | 0.8 |
| A.2 | Job system v2 in the engine: states pending, running, finished, failed, cancelled, paused; priority; concurrency cap; owner grouping; retry; rerun keeping the old run (migration 0044+) | L | — |
| A.3 | Job tray in the top bar (S02) | M | A.2 |
| A.4 | Processing page: engine-step ribbon with waiting/running/done/skipped/failed/stale, job table, pause/retry/priority, log filters, estimate vs actual | M | A.2 |
| A.5 | Evidence badge component used on every value and overlay (S06) | M | — |
| A.6 | Accuracy banner tied to release-gate status | S | A.5 |
| A.7 | Guided/Pro toggle with per-user, per-page memory (S05) | M | — |
| A.8 | Global search field and command palette (S03), role-checked | M | — |
| A.9 | Keyboard map overlay (S14) | S | — |
| A.10 | Upload: analysis profile card (Standard / High accuracy / Ultra-sensitive) with reason and estimate | M | Quality-check estimates [V2] |
| A.11 | Upload: rights block (analyse, share, download, guardian consent) required before Analyse | M | Rights tables [V2] |
| A.12 | Media Info panel on Upload and Library (probe, codecs, scan and decode results, evidence summary) | M | — |
| A.13 | Home: state-aware primary action, Review inbox, Active jobs card | M | A.3 |
| A.14 | Library left tree with folders, Trash, Shared With Me (Smart Bins arrive in B) | S | — |
| A.15 | Notifications (S13) | M | Outbox [V2] |

**Done when:** a new user is guided through upload, estimate, rights and analysis; a job can be watched, paused and retried from any page; every value carries a badge.

---

## Phase B · Editing and discovery

Goal: Filmora-level editing ease and Kdenlive-level control, plus finding content by meaning.

| ID | Item | Size | Depends on |
|---|---|---|---|
| B.1 | Edit log table and History panel with compensating undo for reels and Clip Studio (S11) | L | A.2 |
| B.2 | Workspace presets: Review, Track, Assemble, Export; saved layouts; resizable panels; Dual mode with pop-out player; light and dark (S12) | L | A.7 |
| B.3 | Analysis timeline lanes: shots/cuts, ball found, calibration coverage, selected player's visibility; markers and notes | M | — |
| B.4 | Analysis: player panel upgrades (frame-step, loop span, I/O marks, zoom, per-overlay opacity, Snapshot) | M | — |
| B.5 | Snapshot asset type and `SNAPSHOT` job | M | — |
| B.6 | Analysis: Properties card with OTSI Player ID, confirmed by/when, evidence, linked tracks, look-alikes | M | A.5 |
| B.7 | Identity impact preview: lists reels and reports that become stale before commit | M | — |
| B.8 | Centre tabs on Analysis link to Tactical with the same context; remove duplicate views | S | A.1 |
| B.9 | Tactical: tabs that switch to one focused view, coverage banner, layers panel with opacity and badges, "show these moments" | L | A.5 |
| B.10 | Search index (read model fed by outbox events) and global Smart Search | L | A.8 |
| B.11 | Smart Bins (saved queries) in Library and Clip Studio Media Bin | M | B.10 |
| B.12 | Library table: Rights, Evidence, Profile, Device columns; lock icon; bulk actions; card/table toggle | M | B.10 |
| B.13 | Reel Builder: confirmation gates with summary and estimate; reopen at last stage | M | A.2 |
| B.14 | Reel Builder: live spotlight preview and coverage bar (solid Detected, hatched Interpolated, empty unseen) | L | — |
| B.15 | Reel Builder: moment cards with badge and coverage %, accept/reject/swap/reorder; "Is this him?" inline queue | M | — |
| B.16 | Reel Builder: timeline zoom and list view, spotlight presets, music from brand assets with licence note | M | — |
| B.17 | Overlay and template definitions as data, so controls are generated (audit ADR-044, 054, 055 first) | L | Decision on audit |
| B.18 | Spotlight keyframe model and editor: human nudges stored as Confirmed (by hand), originals kept, none where unseen | L | B.1, B.14 |
| B.19 | Clip Studio: property panel default (project info), slip, spacer, snap, lane solo and height | M | — |
| B.20 | Clip Studio: audio mixer, per-clip gain, loudness target (offline FFmpeg) | M | — |
| B.21 | Clip Studio: transitions picker, marker list, compound clips (reusable intro block) | M | — |
| B.22 | Export: preset library (org and user), batch fan-out to several aspects, preflight panel, loudness per preset | L | A.2 |
| B.23 | Export: chapters filter ("hide no-action"), rule-built analysis PDF preview, inline rights capture | M | A.11 |
| B.24 | Player Report: player picker landing, header with OTSI Player ID, KPI tiles with badge and coverage, comparison group shown, report designer with live preview, publish blocked while identity unconfirmed | L | A.5 |
| B.25 | Moment boundary suggestions around events, labelled Inferred | M | Ball and period data [V2] |

**Done when:** a user can find a moment by player and event without opening a video, edit a reel with undo and history, see and correct the spotlight path, and export several outputs in one action.

---

## Phase C · Depth

Goal: the advanced, optional and expert capabilities.

| ID | Item | Size | Depends on |
|---|---|---|---|
| C.1 | Local assistant: Guide cards plus Plan preview commands. Rules only. It calls approved actions under the user's own role, never confirms identity, changes evidence, grants rights or approves exports; plan approval is audited | L | A.2, B.10 |
| C.2 | Optional small local model to interpret requests (never to write facts or report text) | L | Decision 10, C.1 |
| C.3 | OpenTimelineIO export and `.otsi-reel` manifest carrying evidence flags; import later | L | B.22 |
| C.4 | Archive bundle with manifest and audit extract; rights re-checked at pack and open | M | B.12 |
| C.5 | Beat grid and beat-aware cut snap (offline analysis; licence noted for counsel) | M | B.16 |
| C.6 | Scopes in the player (waveform, histogram, vectorscope, audio meter) and QC checks in render validation (loudness, black frames) | M | B.20 |
| C.7 | Optional local captions on commentary audio, shown as Detected text, off by default; licence and accuracy unmeasured | L | Decision 4, counsel |
| C.8 | Headless render command `vie-render <manifest>` for batch and recovery | M | B.22 |
| C.9 | Dual timeline comparison of two cuts (Pro) | M | B.21 |
| C.10 | Save and share Spotlight, Style and Branding as org templates | M | B.17 |

**Done when:** an expert can drive the engine by command, hand a reel to another editor with its evidence intact, and rebuild or archive a match without the web app.

---

## Phase D · Commercial readiness

Goal: what your engine blueprint lists as blocking a commercial release. Starts in parallel with Phase A because several items have long lead times.

| ID | Item | Size | Notes |
|---|---|---|---|
| D.1 | **Legal:** model and dataset licences (COCO-trained weights), FFmpeg and codec patents, privacy policy, terms, rights to source footage; licence notes for each new optional component (beat library, captions model) | L | Needs counsel; your blueprint already records licence terms for them |
| D.2 | **Billing:** plans, prices, usage, quotas, invoices (tables exist, nothing built). Usage shown as time and compute, billing separate | L | Needs a merchant account (your decision) |
| D.3 | **Admin console:** members and roles, organizations, model registry view, job concurrency settings, export presets, audit viewer | L | Uses roles and audit [V2] |
| D.4 | **Retention and erasure:** retention per asset type, subject erasure, Trash retention shown to users | L | Interacts with append-only history; needs an ADR |
| D.5 | **Backups and disaster recovery:** scheduled backups of MySQL and storage, restore tests, recovery runbook | L | — |
| D.6 | **Monitoring and alerts:** worker health, queue depth, disk, GPU; alert routing | M | Builds on `worker_status` [V2] |
| D.7 | **Load tests:** many uploads, long matches, concurrent renders | M | After A.2 |
| D.8 | **Penetration test** and fixes | L | External |
| D.9 | **Production deployment checks:** config review, secrets, tunnel hardening, upgrade and rollback procedure | M | — |
| D.10 | **Release gates G01–G15** status page for the owner | M | Gate contents are in your repository; I have not seen them |

**Done when:** all release gates are closed or consciously waived by you, and the blockers in section 10 of your engine blueprint are cleared.

---

## Phase E · Football features not yet built

Goal: the engine capabilities your blueprint says are missing, which several tiles on your screens already hint at.

| ID | Item | Size | Depends on |
|---|---|---|---|
| E.1 | **Event accept/reject:** a person confirms or rejects each detected event; rejected events disappear from reels and reports; audit entries | L | A.5, B.7 |
| E.2 | **Export bundles and Deliver to Client** (in progress in your blueprint): files, manifest, report, recipient, expiry, password, comments, access log; rights re-checked at every open | L | A.11, B.22 |
| E.3 | **Formations by name:** from calibrated positions, labelled Inferred, person can confirm | L | Track G, Pitch coverage |
| E.4 | **Transitions analysis:** win and loss of the ball to next action, labelled Inferred | L | E.1 |
| E.5 | **Cross-match search:** by player, event, period across matches (extends B.10) | M | B.10 |
| E.6 | **Event types currently shown but unconfirmed in the engine:** tackles, interceptions, offside line, chances created, progressive passes, xG, xA, sprints, carry, PPDA, off-ball runs. For each: build with evidence rules, or remove from the UI | L each | Decision 3 |
| E.7 | **Pressing metrics** that match the screens (High Press Success, Final Third Regains, Avg Press Height) computed from existing pressing events | M | Pressing [V2] |
| E.8 | **Roles confirmed by a person** so role filters ("Attacking Midfielder") only use confirmed roles | M | — |

**Done when:** every tile on Analysis, Tactical and Player Report either has an engine-backed value with evidence or is not shown.

---

## Track G · Accuracy measurement (runs the whole time)

| ID | Item | Size |
|---|---|---|
| G.1 | Build a labelled football test set (clips, boxes, identities, ball, events) | L |
| G.2 | Measure detection precision and recall, tracking HOTA and IDF1, identity switches, ball, pitch calibration error | L |
| G.3 | Measure event accuracy per event type | L |
| G.4 | Measure identity-suggestion accuracy (number plus roster, look-alikes, "Who is this?") | M |
| G.5 | Regression run on every model or threshold change; results stored per model version | M |
| G.6 | Replace "accuracy not yet measured" with the measured figure and its test set, per value type | S |

**Done when:** each kind of value shows either a measured figure with its source or the "not measured" badge.

---

## Dependencies in one view

```
Phase 0  ──►  A (job system A.2, badges A.5, context A.1)  ──►  B  ──►  C
                │                                              │
                ├──► E (events, bundles, formations) ──────────┤
                └──► D (legal, billing, ops, gates)  ──────────┴──► Release
Track G (accuracy) runs through all; E.3, E.4, D.10 and the final badges depend on it.
```

Critical path to a commercial release: **0 → A.2 job system → B (editing and discovery) → E.1/E.2 (events, delivery) → D (legal, billing, ops) → Track G measurements → gates**.

---

## Decisions needed (all in one place)

1. Approve Phase 0 now.
2. Stabilize, Enhance Quality, Remove Crowd Noise: remove, or keep as "playback copy only, off by default"?
3. Which metrics are truly built (xG, xA, Sprints, Carry, Tackles, Interceptions, Off-Ball Runs, PPDA, Formation Stability, Chances Created, Progressive Passes)? Build or hide the rest.
4. Which of AI Edit, AI Highlights, AI Insights, Auto Captions, Voiceover exist? Rename, build locally, or remove.
5. Home hero: real data or demo?
6. Library "Everyone": accurate, or should it say Restricted where the project lock applies?
7. What does the QHD badge control?
8. Tactical tabs: switch views (recommended) or keep the scrolling grid?
9. May a human edit the spotlight path (stored as Confirmed by hand)?
10. Assistant: rules only, or a small local model to interpret requests?
11. Billing: merchant account decision and timing (Phase D.2).
12. Start Phase D legal and operations work in parallel with Phase A?

---

## Evidence limits

Built from your v2 engine blueprint and 10 screenshots of a dev build. I have not seen your code, ADR text, the wiring document for pages 07–10, or the contents of gates G01–G15, so sizes and some dependencies are estimates to check against your repository. Many panels were empty in the screenshots, so populated layouts are unverified. Nothing in this plan is implemented.
