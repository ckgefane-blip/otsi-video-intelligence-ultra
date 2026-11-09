# ADR-076: Upload's analysis profile card (v3 Phase A.10)

Status: accepted. The owner said "Yes, start A.10" on 2026-11-06.

## Decision
- **Where.** A card on the **AI Tools** tab of Upload's left panel, below Ingest Options. The drop zone has a line, "Analysis:
  Recommended · Change", which opens that tab. The approved panels are unchanged: the tab already existed and only its free space is used.
- **The choice** (kept in the browser with the other switches, sent with each upload or link import, saved with the video in
  `video_ingest_options.analysis_profile`, migration 0050):
  - **Recommended (the default):** when the video is verified, the server first runs the footage check (an ASSESS job, ADR-034). When
    the check finishes (the worker's new `video.assessed` event, subscriber `jobs.auto_analysis_checked`), the analysis starts with the
    recommended profile. With Stabilize Video on, it never goes below High accuracy. If the check fails, it uses Standard (High accuracy
    with Stabilize on) and says so.
  - **Standard / High accuracy / Ultra-sensitive grassroots:** that profile starts as soon as the video is verified. No footage check is run.
- **Stabilize Video agrees with the profile.**
  - Choosing a profile sets Stabilize: Standard turns it off; High accuracy and Ultra-sensitive turn it on.
  - Switching Stabilize on lifts Standard to High accuracy; switching it off brings a stabilising profile back to Standard.
  - The server saves the same rule, so the row never disagrees with itself.
  - Rows saved before this ADR (`analysis_profile` NULL) keep the old rule: the profile follows Stabilize.
- **The reason and the estimate** for the selected video:
  - **Profile used and why** (`auto_profile`, `auto_detail`), for example "The footage check recommended Ultra-sensitive grassroots."
  - **The check's recommendation and reason:** up to three measured issues, or "no problem found".
  - **The estimate:** time and peak memory for that profile, from the detector cost measured on this footage, labelled "(estimate)".
    When the cost could not be measured, the card says so and shows no estimate.
  - A writer can run the check on a verified video that has none ("Check footage"); a viewer is told why they cannot.
- **API:** `IngestOptions.analysis_profile`, `SavedIngestOptions.analysis_profile`, and `analysis.profile`. Older rows report the
  profile the old rule used.

## Alternatives
- **Always run the footage check on every upload:** rejected. A chosen profile does not need it, and the check competes with the
  analysis for the GPU.
- **Replace the Stabilize Video switch with the profile:** rejected. The switch is in the approved design.

## Tests
- **API `ingestOptions.api.test.ts` (+4, 16 in total):**
  - a chosen profile runs at once, decides Stabilize, and an unknown profile gives 422;
  - Recommended queues one ASSESS job and no run, then runs the recommended profile once;
  - with Stabilize on, Standard becomes High accuracy;
  - a failed check falls back and says so;
  - no analysis asked means no check.
- **Web `test/profileCard.test.tsx` (4):**
  - the default and what is sent with the upload;
  - the duration and estimate text;
  - a choice sets Stabilize;
  - the selected video's profile, reason, issue and estimate;
  - Check footage for a writer, and the reason for a viewer.
- API 220, web 132 pass. The worker module imports; its `video.assessed` publish is the same call the analysis uses.
- **Browser (live, view only):**
  - the drop zone line opens AI Tools;
  - the card shows the four choices and fits inside the panel;
  - the owner's video reads "Analysed with High accuracy" and "Footage not checked yet". The check was not started on the owner's video.
- **Not checked live:** an upload with Recommended running a real footage check end to end. That needs a new upload in the owner's account.
