# ADR-139: Interface language — English, Russian, Spanish, German, French (DRAFT, owner approval pending, ultra-only)

- **Status:** Draft. This ADR records the interface-language build on `muse/ultra-main`; it needs owner approval before it is
  presented as accepted. It changes no accepted ADR. **Ultra-only:** the number 139 is chosen so it does not collide with
  Antigravity's ADR-135 (Russian only, in their repo) or their ADR-138 — ultra is at ADR-131, so 132–138 are left free and this
  build takes 139. The two repos' ADR series are independent and must not be merged (see the migration collision recorded in
  ADR-130 §1 for the same reason).
- **Date:** 2026-11-11 (Muse, `muse/ultra-main`)
- **Decides:** which languages the web interface speaks, how the person's language is chosen and remembered, what is
  translated, and what is deliberately left in English.

## Context

The owner asked (2026-11-11) for interface translations in Russian (RU), Spanish (ES), German (DE) and French (FR) — not only
Russian. Antigravity built Russian only (their ADR-135, in their repo). This build does all four, plus English as the default
and the fallback, and it is built from scratch in ultra: their i18n file was read as a reference for the approach (React
context + a switcher + dictionaries, persisted per browser) but no code was copied — the two builds must stay separate, and
theirs is a single-language implementation while this one is a five-language system with a completeness guarantee (see §3).

The product is a professional scouting tool. Its people are clubs, academies and scouts in Russia, Spain, Germany, France and
English-speaking markets (Nigeria is the initial market). The interface language is a per-person preference: it changes the
words around the data, never the data — player and club names, league names, OTSI PINs and measured numbers are never
translated, and the language choice is never sent to the API.

## Decision

### 1. Five languages, English first

| Code | Language | Native name shown in the switcher |
|---|---|---|
| en | English | English |
| ru | Russian | Русский |
| es | Spanish | Español |
| de | German | Deutsch |
| fr | French | Français |

English is the default and the fallback: a person who has never chosen a language sees English; a string with no translation
in the chosen language shows its English text, never a blank and never a key. English is also the source of truth — every
dictionary key exists in English first, and the other four are partial dictionaries merged over it.

### 2. Choice and persistence

- The language is a **client-side, per-browser** preference, kept in `localStorage` under `otsi-vie.locale`. It is not in the
  database, not in the session, and not sent to the API: two people on one account can each read the app in their own
  language, and the choice survives sign-out.
- On first visit the browser's language is used when the app supports it (`navigator.language`, e.g. `ru-RU` → `ru`,
  `es-MX` → `es`); anything unsupported, or no language at all, is English. The choice is applied in an effect after first
  paint — the same pattern as the Guided / Pro preference (`lib/uiMode.tsx`) — so the server render (always English) and the
  first client render never disagree and there is no hydration mismatch. The cost is one re-render when the stored language
  is not English.
- The provider also sets `document.documentElement.lang` to the current locale, so screen readers pronounce the interface in
  the right language and the browser knows what language the page is.
- A missing or corrupt stored value is English; a private window (localStorage unavailable) keeps the choice for that visit
  only. Nothing in the language system can throw: every read and write is guarded.

### 3. Dictionaries, and the completeness guarantee

- One dictionary per language in `apps/web/src/lib/i18n/dictionaries.ts`: `en` is the complete dictionary; `ru`, `es`, `de`
  and `fr` are `DeepPartial<Dictionary>` — they only carry the strings they translate. `getDictionary(locale)` merges the
  partial over English, so a missing key is English by construction.
- **The guarantee is tested, not trusted:** `test/i18n.test.ts` resolves every locale's dictionary and asserts that every leaf
  in the English dictionary is present as a non-empty string in every locale, and that a synthetic partial falls back to
  English for the keys it omits. If a future string is added in English and not yet translated, the test still passes (the
  fallback is English) — the gap is visible in the UI as an English string, never as a blank.
- 251 strings per language, in five groups: `nav` (the 10 navigation labels), `common` (10 actions: Search, Sign out, Save,
  Cancel, Close, Back, Continue, Loading…, Try again, Language), `pages` (the 10 page titles + subtitles, taken verbatim from
  `lib/pages.ts` — the same strings the app already shows, translated, not reworded), `shell` (the 3 header strings: the search
  button's label and hint, and "Language"), and `body` (the 208 page-body strings added 2026-11-11 — see the follow-up at the
  end of this ADR).
- **Proper nouns stay untranslated:** OTSI VIE, Spotlight Composer, player names, club names, league names, OTSI PINs, and
  measured numbers. "Reels" stays "Reels" in Spanish, German and French (the standard product term in those markets) and is
  "Ролики" in Russian. "Ctrl+K" is not translated (it is a key name).

### 4. Where the switcher lives, and what it translates today

- The switcher is a fieldset of five radio buttons in the **account menu** (`ProfileChip`), beside the Guided / Pro fieldset —
  the same shape, because it is the same kind of thing: a per-person preference, remembered in this browser. It is not a
  button in the header bar: the approved 2560-px header design is full and has no free pixel, and a button there would move
  the approved layout. Each option shows the language's own name plus its code.
- **Translated today:** the navigation labels in the header (the English label stays the key into the tab layout and the link
  identity — only the text the person reads changes, so the approved tab positions never move), the search button's label and
  hint, and the switcher itself (its legend and the "Language" label). A longer translated label cannot overlap the next tab:
  `.tab` now clips with an ellipsis; in English every label fits its cell, so there is no visual change. The page bodies of
  the eight in-scope pages are translated too (2026-11-11 follow-up at the end of this ADR).
- **Not translated yet (deliberate, recorded):** the bodies of Upload, AI Processing and Tactical Intelligence — their
  headings, buttons, tables, dialogs and empty states are still English — and the deeper strings listed as known gaps in the
  2026-11-11 follow-up below. The dictionary is built so a page body adopts it one string at a time (import `useLocale`,
  read `t`, replace the literal) without any change to the provider, the switcher or the fallback. Page bodies are the
  follow-up, in the same pattern, not half-built here.
- The provider wraps the app layout (`app/(app)/layout.tsx`), outside the Guided / Pro provider, so the whole app — header
  included — reads its language from one place. The sign-in page and the public pages are outside that layout and stay
  English for now (a person signs in before choosing a language; localising the sign-in page is follow-up).

### 5. What this is not

- **Not a translation service:** there is no machine translation, no translation API call and no network request — the
  dictionaries are hand-written strings in the repo, reviewed as code. A translation the author is unsure of is not
  invented; the standard, correct term in each language is used, and anything genuinely uncertain stays English until a
  native speaker checks it.
- **Not a content language:** match data, player data, reports, exports and the reel itself are not translated. A reel's
  on-screen labels (match, minute, reason) stay in the language they were built with — a reel is a finished artefact, and
  re-rendering it in another language is a separate decision.
- **Not Antigravity's i18n:** their ADR-135 (Russian only) was the reference for the approach, not the source. No file was
  copied, no dependency was added, and this system does not read or write anything theirs does.

## Consequences

- A person can read the navigation and the shell in Russian, Spanish, German or French from the account menu, and the choice
  is remembered in their browser. Everything else is English until the page bodies adopt the dictionaries.
- Adding a string is a three-step change: add it to the English dictionary (and to the other four, or leave it English by
  omission), use it through `useLocale().t`, and the completeness test covers it. Adding a sixth language is a partial
  dictionary plus one entry in `LOCALE_NAMES` and `SUPPORTED_LOCALES` — no provider or component change.
- The header layout is unchanged in English and cannot be broken by a longer translation (ellipsis clip). The account menu
  gains one fieldset; nothing else moves.
- The language choice is invisible to the API and to other people: it cannot leak a person's language into shared data, and
  it cannot change what anyone else sees.

## Verification

- Web vitest: `test/i18n.test.ts` (dictionary completeness for all five locales, English fallback, native names, detection
  mapping, unsupported-tag fallback) and `test/LanguageSwitcher.test.tsx` (all five languages offered, choosing Russian
  applies it at once and persists it, choosing English again restores the English labels) — 8 tests, all passing.
- Web typecheck clean apart from the 1 pre-existing `formationsPanel.test.tsx` error; `next build` succeeds 25/25 pages.
- Not verified here: a click-through of the switcher in a running browser (no running engine here) — visual confirmation on
  the owner's host is the honest last step, as with every UI pass. The dictionaries were written by the author, not checked
  by a native speaker of each language; a native-speaker review of the four translations is follow-up, not a blocker — any
  string that reads wrong is one line in `dictionaries.ts`.

## Follow-up (not this build)

- Page bodies adopting the dictionaries, one page at a time (same pattern, no infrastructure change).
- The sign-in page in the five languages.
- A native-speaker review of the Russian, Spanish, German and French strings.
- A sixth language, if the owner asks — the system takes one partial dictionary.

## Follow-up done 2026-11-11: page bodies (Muse, `muse/ultra-main`)

The eight in-scope pages now read their core body strings from the dictionaries — 208 new `body` strings per language
(251 strings per language in total: home 43, analysis 13, reels 26, studio 17, reports 17, library 25, exports 23,
players 44), all four translations written by hand in the same pattern as the original 43, English still the fallback.
`mergeDictionary` merges `body` group by group, so a missing body key is English by construction, and the completeness
test (`test/i18n.test.ts`, now also asserting the per-group counts and body spot checks) covers every new leaf.
`test/i18nBody.test.tsx` proves the wiring through the provider: a component reads Russian/Spanish body strings from a
stored locale and English with none stored; the TrustStrip renders its translated heading in Russian.

What is wired, per page (headings, primary buttons, empty states and the main table/filter labels; the dictionary key
is the string the person reads):

- **Home** — hero (eyebrow, title, subtitle, Upload Video, Paste Link), the five How It Works steps, Featured Reel,
  Recent Matches, Sample Reels, Trust Strip, Platform Capabilities heading, Review inbox / Active jobs headings.
  The four home sections that were server components (HeroSection, TrustStrip, HowItWorks, Capabilities) are now
  client components (`"use client"` added; they render only presentational markup, Link and already-client children,
  so nothing else changes) so they can read the locale.
- **Analysis** — Match, Visual Overlays, Team Filter, Time Range, "Choose a match video first.", Players-tab
  empty state, "Click a box…", Create Highlight Reel, Open in Reel Builder, All Events, Lineups heading.
- **Reel Builder** — Reel Info (title, description, duration, music, matches, aspect ratio), Back to Reels,
  Spotlight Controls, Player Targeting, Branding, Preview Render, Save Project, History, Video Clips,
  "Add moments to build the reel", the render dialog, the reel picker ("Open a reel", "Reels could not be loaded."),
  "Project saved." / "The project was not saved." / "Unsaved changes".
- **Clip Studio** — reel picker ("Choose a reel", "No reels yet.", "Make one in the Reel Builder",
  "The reels could not be loaded."), header (Back to the Reel Builder, Save Project, Undo, Redo, History,
  Keyboard shortcuts), media bin (Assets, search, Suggested moments, Templates), Clip Details,
  "Select a clip to see what the engine found in it.", reel preview, timeline zoom.
- **Player Reports** — player picker (Choose a player, search, "No player found.", "The players could not be
  loaded.", "Players list: enter their profiles ›"), Identity & Evidence, Key metrics, Player Role & Summary,
  "Not measured", "No traits recorded", "Edit profile ›", Heatmap, Action Map, Event Timeline, Scouting Report,
  "No scout notes recorded.", "View Full Report".
- **Library** — New Project, search, All assets, Competition / Created By filters, Clear Filters, "No saved
  searches yet", Save Current Search, "Loading the Library…", Trash dialog ("The Trash is empty.",
  "Deleted items"), "Create folder", Match / Events / Team Filter / Time Range / Visual Overlays in the left
  panel, "Select an asset with a video in the table.", Open in Analysis, Download, Rename, Share, Send to
  Client, Smart Bins / New Smart Bin.
- **Export** — Project Summary, "Open a reel to export", "Reels could not be loaded.", "No reels yet.",
  Export Settings (Output Preset, Resolution, Frame Rate, Aspect Ratio, File Format, Quality, Include Branding),
  Render Progress, "No render jobs queued", "The render queue could not be loaded.", Download All,
  Deliver to Client (dialog title, client name/email, message, "None yet."), Shareable Link, "No links yet.",
  Export presets / New preset / Save preset.
- **Players** — the whole list page: heading, subtitle, All positions, Confirmed roles only, search, loading /
  load-failed / no-match / no-players empty states, the row labels (Position, Nationality, Preferred foot,
  Birth date, Team · No.), Provisional / Confirmed / Confirm, Save / Saving… / "Saved & confirmed." /
  "Could not save. Try again.", the profile-details form for the intro (all field labels, height/weight
  validation, photo, "Save profile details", read-only note), "Open report ›", "Provisional: no OTSI Player
  ID yet", "Not recorded". Position and preferred-foot *names* in the dropdowns stay English (see gaps).

Deliberately left untranslated (known gaps, not half-wired — the English string stays where the dictionary has no
key, and the fallback guarantees no blank):

- The bodies of **Upload, AI Processing and Tactical Intelligence** (not in this piece's scope).
- **Home:** the six Platform Capabilities tiles (title + two lines each), the Review inbox "to do / All clear /
  Nothing waits…" lines and the Active jobs status lines, the How It Works placeholder labels ("Player name",
  "Position • Team") inside the aria-hidden illustrations, "MP4, MOV, up to …" and "YouTube, Hudl, Wyscout…"
  format notes, save/bookmark tooltips ("Save reel (not available yet)"), playback/copy flash notes.
- **Analysis:** the Players-tab search placeholder, the "Tracks & Presence" section (no such literal exists in
  the UI text — only in a code comment), the Lineups dialog table (Use / No. / Name / Role, Home/Away team,
  Starter / Substitute), Identify/Properties dialogs, event-kind chips.
- **Reel Builder:** the inspector tabs (Spotlight / Overlays / Branding), MusicPicker and ReelExtras dialogs,
  WhoQueue ("This is him" / "Not him"), DraftDialog, the History dialog, moment/clip menus ("Move earlier",
  "Remove clip", "Trim"), "View All Moments".
- **Clip Studio:** the Media Bin tabs (Media Bin / Graphics / Audio / Templates), Templates dialog copy,
  EditPanels (blocks), Scopes/Adjustments panels, "Select a clip" fallbacks in the inspector.
- **Player Reports:** the report dialogs (Dossier, Notes, Tags, Traits, Share link, PDF reports), "Role not
  assessed", "Confirmed / Unverified", "Load failed", "could not be loaded", the rail labels (Overview /
  Performance / Attacking Analysis), comparison and insights sections.
- **Library:** the asset-table column headers (Title / Type / Rights / Evidence / Profile / Device / Updated /
  Status), the Delete / Move / Archive dialogs, AccessDialog, "New folder" dialog title, "Manage Access".
- **Export:** the Export & Delivery hero subtitle (it repeats the already-translated page subtitle), the
  workflow step labels and reasons, Share dialog rights/roles copy, ExportPreflight / ArchiveBundle /
  Interchange dialogs, "Record the video's rights" copy.
- **Players:** position names (Goalkeeper, Right back, …) and foot names (Left / Right / Both / Unknown) in the
  dropdowns, "Role confirmed." / "Could not confirm role." / "Profile details saved." / "The upload failed."
  status lines, photo rights-holder copy, "Height/Weight" placeholder examples.
- The **sign-in page and public pages** stay English (outside the app layout, as before).

Verification (2026-11-11): web typecheck clean apart from the 1 pre-existing
`test/formationsPanel.test.tsx` `assigned_by` error; full web vitest 73 files / 333 tests, all passing (was 72 / 326:
+3 tests in `test/i18n.test.ts`, +4 in the new `test/i18nBody.test.tsx`); `next build` succeeds 25/25 pages.
Line endings preserved on every edited file (all 22 CRLF files still CRLF). Not verified: a click-through of a
translated page in a running browser (no running engine here) — visual confirmation on the owner's host is the
honest last step, as with every UI pass. The four translations were written by the author, not checked by a native
speaker; a native-speaker review is still follow-up.

## Follow-up done 2026-11-11: Upload + AI Processing bodies — Group A (Muse, `muse/ultra-main`)

Every visible string on the Upload page (page 02) and the AI Processing page (page 03) was audited
file by file, word by word, and wired to the dictionary. Two new `body` subsections:
`body.upload` (435 leaves) and `body.processing` (255 leaves) — 690 new leaves, each with a real
RU/ES/DE/FR hand translation in `otsi-vie/apps/web/src/lib/i18n/dictionaries.ts` (interface +
`en` + four partials + `mergeDictionary` lines). The four in-scope pages
(`(app)/upload`, `(app)/processing`, `videos/[videoId]/analyze`, `videos/[videoId]/processing`)
contain no body strings at all — only `metadata` titles (`"Upload & Ingest"`, `"AI Processing"`,
`"Analysis Workspace"`), which stay English: they are browser-tab text and the locale lives
client-side in localStorage.

Files wired (distinct capital-letter English literals removed from each file by the diff;
some literals occur in several files, so the per-file sum exceeds the 324 unique literals removed
overall — see the before/after count below):

- **Upload:** `DropZoneSection` 26, `IngestConfigPanel` 25, `MatchContextSection` 15,
  `PipelinePreviewSection` 50, `ProfileCard` 23, `RecentUploadsSection` 45, `RightsDialog` 21,
  `SelectedPreviewSection` 24, `SupportedFormatsSection` 3, `UploadHeaderSection` 3,
  `UploadWorkspace` 34 (incl. the provider's error strings and a localised twin of
  `videoStatusLabel`, `videoStatusText(v, d)`), `UrlInputSection` 12, `page02` 6. `layout.ts`
  has no UI strings.
- **Processing:** `DetectionTiles` 40, `JobCard` 10, `JobTable` 33, `LogPanel` 50,
  `PipelineStages` 4, `PreviewPanel` 32, `RunDialog` 9, `TimelineSummary` 15, `VideoPicker` 3,
  `model.ts` 36 (English defaults kept for the unit tests: `stageView`/`runLabel`/`ribbon`
  return the exact English strings when called with no dictionary).
- `PipelineStages.tsx` and `TimelineSummary.tsx` gained `"use client"` (safe: their imports are
  already client components); `ProcessingStage` passes the dict into `ribbon()`.

Bugs found and fixed while wiring (not just translation):

- The previous session's wiring aliased the upload dictionary as `u` in `JobCard`, `JobTable`,
  `PreviewPanel` and `DetectionTiles`, shadowing DesignStage's pixel function `u()` — every
  `u(…)` layout call in those files failed typecheck. Renamed the alias to `up`; the upload
  dict is now `up` in those four files.
- `JobCard` read `d.noVideoSelected` from the *processing* dictionary, which has no such key;
  it now reads `up.noVideoSelected` from the upload dictionary.
- `RecentUploadsSection` coloured a bar blue by comparing its label to the English string
  `"Analysis"` — wrong in every other locale, since the label is now translated. It compares
  against `d.analysisWord` instead.
- `.replace()` calls passed possibly-null/undefined contract fields (`provider.reason`,
  `provider.alternative`, `assessment.failure_code`); they now fall back to `""`.
- Dead English labels removed: `JobTable`'s `FILTERS` and `LogPanel`'s `LOG_STEPS` carried
  English label strings that were never rendered (only the keys were used); both are now plain
  key arrays.
- Four duplicate dictionary keys found and removed (the original inventory already had them):
  `theVideo` and `viewVideosNoImport` (upload), `dragDropMatch` (upload) and `followBallEvents`
  (processing). The kept copies are the originals, which were already the effective values.

Deliberately left untranslated (residual English on these pages, and why):

- **Metadata titles** (see above) and **format/codec names** (MP4, H.264/H.265, VP9, …).
- **Server-provided text:** stage messages, failure details, issue text, `takes.blocked`,
  job kind/stage/error labels, `playback.reason`, club/league/player names, OTSI PINs.
- **Contract data:** `PROFILES[k].label`/`.summary` (ProfileCard, JobCard, RunDialog),
  `IMPORT_PROVIDERS` name/method/reason/alternative (only the sentence frames around them are
  translated); `"YouTube / URL"` tab label stays (product name).
- **Dev-mode strings** from `src/lib/devMode.ts`: the Indexing stage status and the
  `PipelineStrip` "not built yet (Block 07/08)" note.
- **Shared lib helpers** (outside this scope): `JobTable` duration values ("3 s" / "5 min" /
  "1.5 h") from `src/lib/jobs.ts`; `videoStatusLabel`/`duration()`/`ago()` from `src/lib/format.ts`
  (the upload components now use the localised `videoStatusText` instead).
- **Components outside Group A** that these pages open: `MediaInfoDialog`, `FullscreenBar`,
  `MatchLinker`, `SourceModeTabs` (its labels/notes are re-mapped to dict keys in
  `UploadHeaderSection`), `TrackOverlay`. The per-video pages (`videos/[videoId]/analyze`,
  `videos/[videoId]/processing`) render `AnalysisWorkspace` / `ProcessingView` components,
  which are outside Group A and stay English.
- **English fallbacks in pure helpers:** `model.ts`, `LogPanel`'s `stepName`/`lines`,
  `PipelinePreviewSection`'s `stepStage`, `ProfileCard`'s `PROFILE_CHOICES` /
  `profileLabel`/`duration`/`estimateText`, `RightsDialog`'s `rightsSummary`/`questions`/
  `minors` keep their English defaults when called with no dictionary — the unit tests assert
  those defaults, and the running app always passes the dictionary. `data-stage` keys
  (`"Upload"`, `"Verify & inspect"`, `"Detection & tracking"`, `"Identity"`, `"Indexing"`,
  `"Uploading"`) stay English: they are test hooks, not rendered text.

Verification (2026-11-11): web typecheck clean apart from the 1 pre-existing
`test/formationsPanel.test.tsx` `assigned_by` error; full web vitest 78 files / 378 tests, all
passing; `next build` succeeds 27/27 pages. Tests extended: `test/i18n.test.ts` now asserts the
upload (435) and processing (255) key counts plus upload/processing spot checks in all four
translations; `test/i18nBody.test.tsx`'s Probe now renders `t.body.upload.recentUploads` and
`t.body.processing.jobs`. Before/after hardcoded-string count (distinct double-quoted literals
starting with a capital letter across the in-scope files): 476 before, 153 after — 324 unique
literals removed; the 153 that remain are the categories above (codes, proper nouns, format
names, comments, data-stage keys, English fallback defaults). Line endings preserved on every
edited file. Not verified: a click-through of a translated page in a running browser (no running
engine here) — visual confirmation on the owner's host is the honest last step, as with every UI
pass. The four translations were written by the author, not checked by a native speaker; a
native-speaker review is still follow-up. Only **Tactical Intelligence** bodies remain of the
original page-bodies gap.

## Follow-up done 2026-11-11: Analysis workspace, Tactical pages, Clip Studio bodies — Group B (Muse, `muse/ultra-main`)

Scope: `components/analysis/` (AnalysisWorkspace, IdentityEvidence, SamePerson, ProcessingView,
Events/HeatPitch helpers, TrackOverlay), `components/workspace/` (the whole workspace shell:
LeftRail, CentreVideo, TimelinePanel, PlayersPanel, PropertiesCard, WhoIsThis, NamePlayers,
Lineups, PitchCalibration, PitchLayers, PlayerTools, BallMarks, EngineLanes, IdentifyDialog,
Periods), `components/tactics/` (Panels, TacticsHeader, TransitionsPanel, PressingPanel,
SyncedPreview, PlayerComparison), `components/studio/` (Adjustments, Inspector, EditPanels,
BeatGridInfo, DualTimeline, Scopes, Preview, StudioHeader, Timeline, MediaBin, ProjectInfo,
useStudio, spotlight, StudioStage), plus the four app pages
`analysis/page.tsx`, `tactics/page.tsx`, `studio/page.tsx`,
`videos/[videoId]/tactics/page.tsx` — which are pure wrappers (Stage component + metadata
title, or a redirect) and carry no UI strings of their own.

Dictionary: `body.analysis` 208 keys, `body.processing` 302 keys (ProcessingView's strings live
there, not in `body.analysis`), `body.workspace` 729 keys (new subsection), `body.tactics` 164
keys (new subsection), `body.studio` 723 keys. New keys added in Group B (vs the Group A
commit fd339b7: analysis 13, studio 17, processing 255, no workspace/tactics sections):
analysis 195, processing 47, workspace 729, tactics 164, studio 706 — of the studio keys,
196 landed in the final studio pass (527 → 723: 189 + freezeBtn + 9 Timeline keys − 3
removed); the rest came from the earlier Group B wiring pass. Every key has a real RU/ES/DE/FR
translation (hand-written, not
machine placeholders); the completeness test asserts every leaf is a non-empty string in every
locale, with one deliberate exception — `body.workspace.eventSingularSuffix` is the empty
string in en/es/de/fr (the singular takes no suffix) and "и" in ru.

Wiring: every component reads via `useLocale()` / `dict.body.<section>.<key>`. Plain functions
and hooks that return UI strings take an optional `d?: Dictionary` parameter with an English
fallback via `getDictionary("en")` — never `useLocale()` inside a plain function (it throws
outside render). Contracts-package labels are NOT edited: `PROFILES`/`LOOK_PRESETS`/
`LOUDNESS_TARGETS` labels, `describeBeatGrid`/`BEAT_LIBRARY_NOTE`, and `computeCutDiff`'s
summary are mapped at the render site by local helpers (`lookLabelOf`, `loudnessLabelOf`/
`loudnessNoteOf`, `beatDesc`, `cutDiffSummary`, `transitionKindName`) that mirror the
contracts branches exactly. Composed messages use `{a}`/`{b}`/`{c}` placeholders; plurals use
separate one/many keys (RU uses the genitive plural for all counts — imperfect for 2–4,
accepted shorthand). Label-vs-label comparisons translate both sides consistently; code
values (kind codes, LaneMode, keyboard key names, codec/format labels, resolution badges,
"FRZ"/"RAMP", vectorscope letters, channel codes) are never translated.

Fixes found while wiring (all in the Group B files, all fixed in this commit):
- Two TS1005 syntax corruptions from the earlier wiring pass — a JSX expression wrapped in an
  extra pair of braces in `PitchCalibration.tsx` (`clickYellowDot` ternary branch) and
  `PlayerTools.tsx` (snapshot button label). Both were parse errors, not runtime issues.
- `useLocale()` had been inserted inside the plain async `confirm()`/`rejectFor()` functions in
  `NamePlayers.tsx` — a hook called from an event handler would have crashed naming a player
  at runtime. Converted to optional-dict parameters, threaded through `confirmAll`.
- `renderedState`/`reviewTime` (spotlight.ts / useStudio.ts) called `useLocale()` in plain
  functions — 8 test failures. Same optional-dict fix.
- Three dictionary keys translated sentences that do not exist in the source (the snap toggle
  titles were paraphrased, not quoted): `snapOnBeats`, `snapOnPlain`, `snapOffLabel` were
  removed and replaced by `snapTitleOnBeats`/`snapTitleOnPlain`/`snapTitleOff` with the real
  "Snapping on: dragged edges jump to …" text. Nine further Timeline keys were added after
  reading the real source (transition button aria-label/title, clip aria-label, clipWord,
  renderedWord). `unmuteLabel` lives in `body.workspace`, not `body.studio` (Preview fix);
  `notATeam` for the PlayersPanel team-name fallback is reused from `body.processing`
  ("Not a team", Title Case — the `body.tactics` one is lowercase).
- `transitionKindName` was first inserted inside the `useStudio` hook body (`export` inside a
  function, TS1184); moved to module level.
- TimelinePanel CHIPS/LEGEND/KIND are now functions of the dictionary (kind codes kept for
  lookup, labels translated); the shared `KIND` export forced a 1-line change in
  `components/library/LeftPanel.tsx:66` (`KIND(dict)[k].color`) — outside the file scope, a
  forced consequence, flagged in the report.
- MediaBin kind badges and filter pills rendered the raw kind codes (SPOTLIGHT/STYLE/BRANDING/
  FULL); they now render the translated labels (EN changes "SPOTLIGHT" → "Spotlight" etc. —
  no test asserts the raw code). Template/history messages use curly quotes “{a}” per existing
  dictionary style where the source used straight quotes; Inspector's line-2 " · at playhead"
  becomes " · at the playhead" via the shared `atPlayheadSuffix` key.
- Two strings found by the final distinct-literal rescan and wired late: PlayersPanel's
  disabled-chip reason "Assign this team to a kit colour first (Analysis, Teams)" (key
  `assignTeamKitFirst` already existed — LeftRail uses it) and the "Players (n)" tab label
  (now reuses `body.analysis.players`).

Deliberately left untranslated (residual English on these pages, and why):
- `NOT_YET` (`src/lib/devMode.ts`, outside scope) — "not built yet"/"not available yet" in
  LeftRail and Inspector (via `tabNotYet` = "{a} are {b}", identical in all five locales
  because the tail is English); the same dev-mode helper feeds `notBuilt("season statistics")`
  in PlayersPanel. Translating it needs a locale-aware refactor of a module-level const.
- Kind/status codes everywhere (TransitionKind, LaneMode `"tall"`/`"normal"`, OrgTemplateKind
  in `saveOrgTemplate`/`applyOrgTemplate` messages, beat-grid statuses, `data-stage` keys);
  only their display labels are translated.
- Keyboard key names (`Escape`, `Home`, `End`, `Enter`, `Alt+[`, `Alt+]`, `M`, `S`, `C`),
  codec/format labels ("MP4 · H.264" / "MP4 · AV1" / "WebM · VP9"), resolution badges
  ("4K"/"QHD"/"HD"/"SD"), clip badge abbreviations ("FRZ"/"RAMP"), vectorscope graticule
  letters ("R"/"B"/"G") and channel codes ("LUMA"/"RGB").
- "PRO" in "DUAL TIMELINE (PRO)" is the free UI mode (ADR-072), not a paid plan — kept as
  "(Pro)".
- `useStudio.ts` LAYOUTS labels/hints stay English literals by design: `test/look.test.ts`
  asserts `LAYOUTS.COLOUR.open` / `LAYOUTS.REVIEW.open`, and the rendered layout switcher
  uses the translated `layoutText` map in StudioHeader — LAYOUTS itself is never rendered.
- `components/library/LeftPanel.tsx` (outside Group B scope) still carries English UI
  strings — "Ball Tracking", "All Players", "Home team"/"Away team", Match/Browse switch and
  titles, "Analysis available"/"No analysis available", "Clip Studio (this reel) →" /
  "Make a reel →" — for the Library group, not this one. `MatchLinker` lives in
  `components/matches/MatchPanels.tsx` (not in scope) — referenced from AnalysisWorkspace.
- English fallbacks remain in pure helpers called with no dictionary (the unit tests assert
  those defaults; the running app always passes the dictionary).

Verification (2026-11-11): web typecheck clean apart from the 1 pre-existing
`test/formationsPanel.test.tsx` `assigned_by` error; full web vitest 78 files / 378 tests, all
passing; `next build` succeeds. Tests extended: `test/i18n.test.ts` now asserts the analysis
(208), processing (302), workspace (729), tactics (164) and studio (723) key counts, the
COGNATES allowlist for words legitimately shared with English (differ-test cap raised 60 →
100 — the allowlist is the binding check), and the `EMPTY_OK` exception for
`eventSingularSuffix`; `test/i18nBody.test.tsx` gains a ProbeB rendering Group B studio /
tactics / workspace strings in Russian and Spanish. Before/after hardcoded-string count
(distinct double-quoted literals starting with a capital letter across the in-scope files,
same method as Group A): 1,092 before, 219 after — 882 removed; the 219 that remain are the
categories above (codes, proper nouns, format names, comments, data-stage keys, English
fallback defaults, LAYOUTS data, library strings). Line endings preserved on every edited
file (one CRLF file, Preview.tsx, was briefly flattened by a fix script and restored — diff
checked). Not verified: a click-through of a translated page in a running browser (no running
engine here) — visual confirmation on the owner's host is the honest last step, as with every
UI pass. The four translations were written by the author, not checked by a native speaker; a
native-speaker review is still follow-up. With Group B done, no page-body gap remains from
the original audit — the remaining English on these pages is the deliberate list above.
