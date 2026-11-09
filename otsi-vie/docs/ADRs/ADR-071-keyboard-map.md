# ADR-071: One keyboard map for the app (v3 Phase A.9, S14)

Status: accepted. The owner said "Yes, start A.9" on 2026-11-06.

## Decision
- **One table.** `lib/keymap.ts` lists every key, in three groups: Everywhere, Clip Studio and Analysis. Each key is still handled where its tool lives. Clip Studio's E5 list (ADR-068) is now part of this table; `components/studio/shortcuts.ts` re-exports it.
- **The "?" map** (`components/shell/KeyboardMap.tsx`):
  - "?" opens it on any page, unless a field or a dialog has the keys.
  - It also opens from Clip Studio's "?" button and from the palette's "Keyboard shortcuts" command (ADR-070).
  - It lists this page's keys first, then the keys that work everywhere, then the other pages' keys.
  - The search finds a command by its words, or a key by its letter ("S" finds Split).
- **The spec's keys:**
  - **J K L** in Clip Studio and on Analysis: K pauses (and returns to 1×); L plays, and pressing it again goes to 1.5× then 2×; J pauses and goes back one second each press. Browsers cannot play video backwards smoothly, so J steps back instead of playing in reverse.
  - **I O** marks, **S** split, **C** cut and **M** marker, as before in Clip Studio.
  - **Ctrl + K** opens the palette.
  - **Analysis** also gets Space, and ← / → for one analysed frame (Shift for one second).
- **N, "next unidentified", is scoped to the reel's player.** The owner's rule (2026-11-02) is that people name a player only for the reel they make, never in a "name everyone" queue. So N is the "Is this him?" key: it moves to the next possible moment of that one player, the same as Can't tell / Next.
  - N never records an answer. Yes and No stay as clicks, because unknown beats wrong.
- **Line drawing moves from L to D**, so that L is play. Arrow is still A and circle is still R.

## Not in this block
- **Rebinding keys, NLE presets and an on-screen keyboard** (Filmora research, 02 §12): later, with A.7 Guided/Pro. The table is ready for them.

## Tests
- Web `test/keymap.test.ts` (4):
  - the spec's keys exist, each listed once per page;
  - no letter does two things on one page;
  - the order (this page, everywhere, the other pages);
  - finding a key by letter and a command by words;
  - J K L from each state.
- `test/shell.test.tsx`: "?" opens the map but not while typing in a field; finding "n"; Escape closes it; the palette's command opens the map.
- `test/commands.test.ts` and `test/look.test.ts` updated for the new command and the D key.
- Browser check:
  - **Clip Studio:** "?" lists Clip Studio (18 keys), then Everywhere, then Analysis. L plays, L again gives 1.5×, K pauses at 1×, and J goes back 1 s each press.
  - **Analysis:** L, L, K, → (one frame), Shift + → (one second), J and Space work, and "?" lists Analysis first.
  - **"Is this him?":** N moves on from 6 moments left to 5 and sends no identity decision.
  - The browser test tool's "type" sends no key events, so the keys were fired as keyboard events in the page.
