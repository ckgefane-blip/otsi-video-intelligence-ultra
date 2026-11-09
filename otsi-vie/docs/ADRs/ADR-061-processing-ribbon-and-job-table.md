# ADR-061 Processing page: engine-step ribbon, job table, log filters, estimate vs actual (v3 Phase A.4)

**Date:** 2026-11-06. **Status:** accepted (owner: "Yes, do A.4"). **Migration:** none. Builds on ADR-060.
Source: OTSI_VIE_v3_Complete_Phase_Plan.md A.4; Screen-Level Upgrade Blueprint, Page 03 (Ribbon, Job table, Log, Estimate vs actual).

## Decision
**Ribbon.** The five pictured stages became the engine's eight real steps for the video, in one row inside the same box:
1. Shot cuts
2. Detection
3. Tracking
4. Identity evidence ("No identity assigned")
5. Ball
6. Pitch
7. Team sheets
8. Football facts

Each step shows one of these states:
- waiting
- running
- done
- **not run** (never asked for this video)
- failed
- cancelled
- **out of date**: the ball was followed on an older analysis than the newest finished one, so the ball and the football facts read from it may not match the tracks shown.

The state comes from what is recorded:
- steps 1–4: the run's own steps;
- Ball: the video's ball track;
- Pitch: a waiting or running calibration job, else any finished calibration;
- Team sheets: the newest READ_LINEUPS job;
- Football facts: the events' state, together with the ball.

Clicking a step filters the log to that step; clicking again clears the filter.

**Job table** (new, below the timeline; the page grows 450 design px, `DesignStage extra`):
- **Rows:** every engine job of the video, read from `GET /v1/jobs?video_id=`, with no 24-hour window: ingest, playback copy, footage check, analyses, ball, pitch, team sheets, and its reels' renders.
- **Columns:** state, progress, the worker's step, the machine that ran it (from the worker's own id), start time, duration, and for an analysis the footage check's estimate for its profile. The estimate is labelled as an estimate; the real duration sits next to it.
- **Filters:** All, Active, Failed and Finished, plus a filter by kind of job.
- **Actions:** Pause, Resume, Priority, Cancel and Retry. These are the server's own actions, the same as the top-bar tray.

**Log:**
- The log also lists the video's other jobs.
- New filters: one step (or a click on the ribbon), Errors only, and "Newest run" (older runs folded, with the number of lines hidden) or "All runs".
- Copy puts the shown lines on the clipboard.

## Deviations, recorded
- The Blueprint asks for the job table "below the ribbon". It is placed below the timeline instead: moving the approved Preview, tiles, Log and Timeline down would change the approved composition, and placing it below them only adds room under it.
- "Device" is the worker's machine name. Whether a job used the GPU or the CPU is not recorded per job, so it is not shown; GPU use stays in System Resources.
- "Output size" is not shown: a job does not record its output size. A render's file size is on the Export page.

## Tests
- Web `test/processing-model.test.ts`:
  - the eight steps, with "Not run" for steps never asked for;
  - ball and facts out of date when they come from an older run;
  - pitch and team sheets read from their records;
  - the log filters: older runs folded, step, errors, other jobs.
- API `test/jobs.api.test.ts`: per-video list (old jobs kept, other videos left out, the machine name); a bad id gives 404.
- Totals: API 201, web 66.
