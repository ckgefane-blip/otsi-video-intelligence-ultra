# ADR-069: Work context bar Project ▸ Match ▸ Player (v3 Phase A.1, S01)

Status: accepted. The owner said "Yes, start Phase A", then on 2026-11-06 "continue with planned work".

## Decision
- **The bar.** A bar under the navigation names what the page is about: `Project ▸ Match ▸ Player`, plus the open reel.
  - It appears on the work pages: Processing, Analysis, Tactical, Reel Builder, Clip Studio, Player Report and Export.
  - It shows only what is recorded. A match is named "Home v Away · competition · date" from the linked match. A video without a match shows its title.
- **One API call.** `GET /v1/context?reel=&video=&player=&project=` (any member) resolves the page's subject:
  - a reel gives its video and player;
  - a video gives its project and match;
  - a player is given by internal id or OTSI Player ID.
  It also lists the choices for each chip: the visible projects, the project's videos, the players a person confirmed in the video, and the video's reels.
- **Who sees what.** The organization's rows only, with project access applied. Nothing of a hidden project is named, not even through a reel id.
  - A player is named only if the organization created him or confirmed him on a video it can see.
  - A merged player resolves to the survivor.
  - Unknown or invisible means null, never an error, so the bar cannot break a page.
- **Carried across pages.** The context is kept per browser (localStorage, `lib/workContext.ts`). Each navigation tab opens on it:
  - Processing, Analysis and Tactical open `?video=`;
  - Reel Builder, Clip Studio and Export open the reel;
  - Player Report opens the player's report.
  Opening another match drops a reel of the old one.
- **Click a chip to change it.**
  - **Project:** lists the projects, then that project's matches.
  - **Match:** opens the same page on that match. On a reel page it opens that match's reel, the same player's if there is one. If the match has no reel yet, it opens Analysis with a note saying so: a reel is made there, from a confirmed player.
  - **Player:** lists the confirmed players of the match. On the Player Report it opens his report. On a reel page it opens his reel in this match, or says there is none.
- **Also in this block** (owner 2026-11-06, "Why is the AI feature not working?"):
  - The Clip Studio ribbon's Suggestions button now says its state: "Suggestions (N)" when there are moments to add, "Suggestions ✓" when every suggested moment is in the reel. A dimmed button alone looked broken.
  - The ribbon buttons carry `data-tool`.

## Alternatives
- **The context in the URL of every page:** rejected. Each page already has its own subject parameter; a second, competing set would drift.
- **A context per user, on the server:** deferred. A per-browser context is enough, and it needs no table.

## Tests
- API `access.api.test.ts` "the work context bar": resolution from a reel; the choices; nothing of a locked project; the player via an open project; another organization gets nothing; bad ids give 200; not signed in gives 401.
- Web `test/workContext.test.ts` (4): page subjects, the merge rule, the navigation targets, the same page on another subject.
- Browser check: on the owner's reel, the bar names the project, match, player and reel; the tabs carry them; the Match menu lists the project's matches.
