# ADR-072: Guided / Pro per person and per page (v3 Phase A.7, S05)

Status: accepted. The owner said "Yes, start A.7" on 2026-11-06.

## Decision
- **Where.** The account menu has a "<page>: how much to show" switch with two choices:
  - **Guided:** the main actions.
  - **Pro:** every control.
  The switch says what Guided hides on that page. On a page with nothing to hide yet, it says the page looks the same in both modes.
- **Remembered per person and per page.**
  - Stored in a new table, `user_page_modes` (migration 0048): user, page and mode, removed with the user.
  - API: `GET /v1/me/page-modes` and `PUT /v1/me/page-modes/:page {mode}`. These are the person's own setting, account-level and not tied to an organization, so they follow the person across organizations and devices.
  - Each browser keeps a copy per person, so a page opens in its mode at once.
  - **No choice means Pro**, which is the approved design. The approved images stay what everyone sees until they choose otherwise.
- **How Guided hides.** The page's mode is set on `<html data-ui-mode>`, and `globals.css` hides every element marked `data-pro` in Guided.
  - Guided hides controls only. Results, numbers, warnings and evidence stay, so the same page shows the same data. The spec says: "Same page, same data."
  - Guided always shows a "Guided · show all controls" chip, so nothing is hidden without saying so. One click on it returns the page to Pro.
- **What Guided hides, first set:**
  - **Clip Studio:** the Edit / Colour / Review layouts; Colour and Transform on the ribbon; and Look, Zoom (keyframes), Draw, Review and Reframe in Adjustments. It keeps play, the Media Bin, split / cut / delete / marker, Suggestions, speed, strap, spotlight, sound and Export.
  - **Analysis:** re-tracking, pitch calibration, ball marks and the identity review link. It keeps "Is this him?", team sheets, Processing and Tactical.
  - **Processing:** the step log and the job table. It keeps the steps, preview, detection tiles and timeline.
  - **The other seven pages:** the same in both modes for now. More controls are marked as their pages are worked on; this needs no schema or API change.

## Alternatives
- **Guided as the default:** rejected for now. It would change the approved screens for every existing user without them choosing it. It can be made the default for new accounts later, with the owner's yes.
- **Per browser only (localStorage):** rejected. The spec says "per user", and a person's choice should follow them to another computer.
- **Separate Guided pages:** rejected. Two versions of each page would drift apart; one page with marked controls cannot.

## Tests
- **API, `account.api.test.ts` "Guided / Pro per page" (2):**
  - no choice gives `{}`;
  - setting and changing pages;
  - another person is untouched;
  - one row per page;
  - an unknown page gives 404 and a bad or missing mode gives 422;
  - not signed in gives 401.
- **Web, `test/uiMode.test.tsx` (4):**
  - route to page mapping;
  - the saved mode is applied to `<html>` and cached;
  - the chip puts the page back to Pro through the API;
  - the cached mode is used at once, then the server's;
  - a failed save keeps the old mode;
  - a page with nothing hidden shows no chip.
- **Browser check (owner's account, then reset to Pro):**
  - Clip Studio in Guided hides the 5 marked controls; the ribbon keeps split, cut, delete, marker, graphics, Suggestions, speed, music and fit; the chip shows; a reload keeps Guided.
  - Processing stayed Pro until switched itself; in Guided its log and job table are gone and the layout is clean.
  - Both pages were switched back to Pro afterwards; their rows read PRO, the same as the default.
