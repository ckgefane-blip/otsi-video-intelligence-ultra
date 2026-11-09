# ADR-075: The notifications bell (v3 Phase A.15, S13)

Status: accepted. The owner said "Yes, start A.15" and "Yes, resume A.15" on 2026-11-06.

## Decision
- **Where.** A bell in the header between search and the job tray. To make room, the three buttons are 46 px each and 6 px apart
  (2064, 2116, 2168), the divider is gone, and the display chip is 38 px wide with a 14 px label (it still says QHD in full).
- **What it lists.** The last 14 days, newest first, at most 30. Each item is read from a recorded row of the organization; nothing is
  stored twice and nothing is made up (`GET /v1/notifications`):
  - **Job done / failed:** an analysis run finished, failed or needs a review (-> Processing of the video); a reel render finished or
    failed (-> Export).
  - **Review:** "Is this him?" moments: the reel's own player suggested on tracks of its video, not decided yet (-> Analysis). Only the
    reel's player, never everyone in the video (naming is per reel player). Team sheets read from a video waiting for approval (-> Analysis).
  - **Comment:** a comment left through a share link, with the guest's name and the start of the text (-> Export).
  - **Rights:** the current rights of a video end within 14 days ("Rights end in 5 days"), and again when they have ended (-> Export).
- **New or read.** A new table, `notification_reads` (migration 0049): when each person last opened the bell, per organization.
  Anything recorded after that is new; the badge shows how many (up to "9+"). Opening the bell marks everything read
  (`POST /v1/notifications/read`); the rows keep their "new" dot while the panel stays open. Each person has their own read state.
- **Access.** The caller's organization only. Projects hidden from the person and removed items are left out.
- **Refresh.** Once a minute while the tab is visible, and on every open.

## Alternatives
- **Store a notification row per event:** rejected for now. It would copy what is already recorded and could drift from it. A stored
  feed is needed only for e-mail or push delivery, which is not in this phase.
- **Every engine job (proxy, footage check, …):** rejected. Too noisy; the job tray already lists them.
- **Every identity suggestion in the video:** rejected (naming is per reel player).

## Tests
- **API `notifications.api.test.ts` (2):**
  - empty for a new organization; sign-in required;
  - all six kinds with their titles and pages;
  - a suggestion for another player is not listed;
  - opening reads them for that person only, with one row per person, and a later comment is new again;
  - a restricted project hides everything from a viewer outside it;
  - another organization sees nothing.
- **Web `test/notificationBell.test.tsx` (3):**
  - the badge;
  - the open list, its links and new marks;
  - read on open clears the number;
  - the empty, failed and signed-out states.
- API 216, web 128 pass.
- **Browser (live):**
  - the bell showed 14 new, all real renders and analyses of the owner's match, each opening its page;
  - opening it set the count to 0;
  - the bell, job tray and chip fit in the header.
