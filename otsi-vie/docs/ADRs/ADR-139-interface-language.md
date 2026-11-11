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
- 43 strings per language, in four groups: `nav` (the 10 navigation labels), `common` (10 actions: Search, Sign out, Save,
  Cancel, Close, Back, Continue, Loading…, Try again, Language), `pages` (the 10 page titles + subtitles, taken verbatim from
  `lib/pages.ts` — the same strings the app already shows, translated, not reworded), `shell` (the 3 header strings: the search
  button's label and hint, and "Language").
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
  `.tab` now clips with an ellipsis; in English every label fits its cell, so there is no visual change.
- **Not translated yet (deliberate, recorded):** the bodies of the ten pages — their headings, buttons, tables, dialogs and
  empty states are still English. The dictionary is built so a page body adopts it one string at a time (import `useLocale`,
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
