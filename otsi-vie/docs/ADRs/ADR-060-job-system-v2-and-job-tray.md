# ADR-060 Job system v2 and the top-bar job tray (v3 Phase A.2 / A.3)

**Date:** 2026-11-06. **Status:** accepted (owner: "Yes, start Phase A"). **Migration:** 0045.
Source: OTSI_VIE_v3_Complete_Phase_Plan.md, Phase A items A.2 and A.3 (S02).

## Decision
Every engine job stays one `worker_jobs` row (ADR-022). Migration 0045 adds:
- `priority` 1..9 (default 5). The worker claims the highest priority first, then the oldest job.
- the `PAUSED` state, with `paused_at` / `paused_by`. A paused job is never claimed; Resume puts it back in the queue.
- the indexes `idx_worker_jobs_queue` (state, priority, created_at) and `idx_worker_jobs_org_state`.

The worker's claim also holds an organization at `OTSI_VIE_ORG_MAX_RUNNING` running jobs (default 4), so one club's long queue does not take every worker. The cap is checked inside the claim transaction. Two workers claiming at the same moment may go one over it: it is a soft cap, and no job is ever lost.

API `/v1/jobs` (module `jobs`):
- **The list** covers jobs that are waiting, running or paused, plus those finished in the last 24 hours. Each job shows its video or reel, the page with its result, its state, step and progress (the worker's own values), and the actions possible now.
- **Pause / resume** work on a waiting job only. A running job cannot be paused: the work would have to start again.
- **Priority** (High, Normal, Low) can be set on a waiting or paused job.
- **Cancel** goes through each job's own module, so the run, render or video says "cancelled" too. Analysis, render and playback copy can be cancelled while running. Shorter jobs (footage check, ball, pitch, lineups) can be cancelled only while they wait, and their row is closed as FAILED with the code CANCELLED, because those tables have no cancelled state. An ingest is never cancelled here: removing the video does that.
- **Retry** works on the latest failed or cancelled attempt. It goes through the job's own start, which makes a NEW run, render, check or read; the old one is kept as it was. A playback copy re-queues its own job. A pitch calibration is restarted on its page, because it needs the person's input.
- **Access:** jobs in a project hidden from the person are left out. A change needs a writing role (`PROJECT_WRITERS`) and the Editor permission in a restricted project. A viewer sees the jobs with no actions.

Existing cancel paths (analysis, render, playback copy, Trash) also close PAUSED jobs.

Web: `JobTray` sits in the top bar between the divider and the display chip, on every page.
- The icon shows the number of active jobs, or "!" when a job failed today.
- It opens a list with state, step, progress bar, who asked for the job, Pause/Resume, Priority, Cancel (asks first for a running job), Retry and Open.
- It reads the list every 3 s while a job is active or the tray is open, every 20 s otherwise, and never in a hidden tab.
- The display chip is 58 px wide instead of 100 px so the tray fits; the account block is unchanged.

## Alternatives
- Pausing running jobs: rejected for now. Every handler would need a resumable checkpoint, and without one a "pause" is a cancel that starts again from zero.
- A hard cap through a counter row per organization: it would mean a lock per claim. The soft cap is enough for fairness.
- A `requested_by` column on worker_jobs: dropped. The outbox event carries no actor. The person is read from the job's own row (render, assessment, ball, lineups, pitch: `requested_by`; video: `created_by`). An analysis run has no requester recorded, so none is shown.

## Tests
- API `test/jobs.api.test.ts` (5):
  - the list and isolation between organizations
  - pause, priority and resume (with 409 / 422 errors)
  - cancel through the run, then retry as a new run with the old run kept
  - a short running job cannot be stopped, and a waiting one closes its row
  - a viewer has no actions (403)
- Worker `tests/test_job_lease.py`: priority order, a paused job skipped, and the per-organization cap.
- Web `test/jobs.test.ts`: poll timing, counter and age text.
- Totals: API 200, web 62, DB 88.

## Not done in this block (Phase A, next)
- A.4: the Processing ribbon and job table, built on the same API.
- A.13: the Home Active jobs card.
- A.1 and A.5–A.15.
