# ADR-067 Draft reels, template slots, one asset browser (editor stage E4)

**Date:** 2026-11-06. **Status:** accepted (owner: "Approve editor stages E1–E5", "Yes, start E4"). **Migration:** none (templates keep their structure in `effect_presets.config`).
Source: docs/research/filmora/11-lessons-and-roadmap-for-otsi.md, stage E4 "Faster assembly".

## Decision
**Key time of a moment.** `ReelMoment.key_at_us` is when his best event in the moment happens:
- the start of a pass, shot, ball won or pressure;
- the kick of a set piece;
- for a goal: his shot inside it when there is one, else the middle of the goal's span.
A clip cut shorter is cut around it (55 % before, 45 % after, kept inside the moment). A freeze or ramp is set there.

**Draft reels** (Reel Builder › Suggested Key Moments › "Build a draft", `DraftDialog.tsx`):
- Plain inputs: length (30 s to 3 min), what it is about, and frame.
  - About: best actions, attacking, defending, set pieces, or everything (also on camera without an action).
- `POST /v1/reels/:id/candidates` returns up to three drafts and changes nothing:
  - **Best moments**: his highest-ranked moments, clips up to 15 s, shown in match order. The best one gets a hero ramp (0.35x at its key time) if it still fits.
  - **Match story**: the best moment of each stretch of the match (3 to 12 stretches), then the rest by rank; clips up to 10 s.
  - **Every touch**: as many of his actions as fit, clips up to 5 s.
- Every draft is in match order and never more than 10 % over the length. Identical drafts are shown once.
- Each draft says what it holds ("6 clips: 1 goal, 2 shots, …") and why. A draft too short for the length says so.
- Only EVENT moments are used, except for "everything". With no moment of his, there is no draft (unknown beats wrong).
- `POST /v1/reels/:id/assemble {key, target_s, theme, version, replace}`:
  - The server computes the draft again from the same choice, so the page cannot inject clips.
  - It replaces the clips, with their speed effects, in one audited change (`reel.assembled`).
  - A reel with clips needs `replace: true`, which the page asks for with a second click; otherwise 409 `REEL_NOT_EMPTY`.
  - Version-checked (409 `STALE_VERSION`). Writers only.
- After use: **Edit in Clip Studio**.
- The rules are pure functions in `packages/contracts/src/assembly.ts` (`buildCandidates`, `fitMoment`, `summarise`), shared by the API and the web tests.

**Template slots** (Clip Studio › Media Bin › Templates):
- "Also keep its clips as slots" saves, per clip in order:
  - the kind of moment, from the moment it overlaps most: goal, shot, key pass, defending, set piece, pass, on camera, or any action;
  - its length, as at most so many seconds;
  - its speed effect.
- The look is saved as before (`with_structure`; `ReelTemplate.structure`). Update keeps whether a template has slots.
- **Fill** (`apply-template` with `clips: "FILL"`):
  - Applies the look, then fills each slot with this reel's player's best unused moment of that kind, in the template's order.
  - A slot with none of that kind is left out and named: "slot 1 (a goal): none of his in this match". It is never filled with another kind of moment.
  - A freeze or ramp without its key time in the clip stays at normal speed, and the page says so.
  - With no slot filled, the reel's clips are kept.
- Fill replaces the clips after a second click and is not on the editor's undo list, which it clears (its steps name clips that are gone).
- A look-only template refuses Fill (422 `TEMPLATE_HAS_NO_SLOTS`). Saving slots from an empty reel is refused (422 `REEL_EMPTY`).

**One asset browser:** the Media Bin search box sits above every tab and filters all of them at once:
- moments by label;
- graphics and music by name and kind;
- templates by name.
While searching, each tab shows how many items match.

## Alternatives
- Generative or model-based "AI edit": rejected (paid, unexplainable). The drafts are readable rules over the engine's recorded moments.
- Sending the chosen clips from the page to `assemble`: rejected, since the server would trust client clips. It recomputes them instead.
- Undo for Fill: it would need a bulk restore of clips and transitions. Asked first and documented instead.

## Not covered
- Transitions are not part of slots. The drafts add no music or graphics (the reel's look is kept).
- No draft from several matches. A draft is one video's reel, as reels are.

## Tests
- Web: `test/assembly.test.ts` covers the cut around the key time, the three drafts, the 10 % limit, match order, the hero ramp, the match story's reach, themes, no draft without an action, de-duplication, summary words, slots from clips, filling another player's moments with a named left-out slot, and an effect without its key time.
- API: `reels.api.test.ts` "draft reels and template slots" covers:
  - key times and drafts (viewer may look, other organization 404, length 422);
  - assemble (role, stale version, recomputed clips, REEL_NOT_EMPTY, replace, audit);
  - templates with slots (REEL_EMPTY, look-only) and Fill on another player's match (every slot filled, in order);
  - a player with no events (each slot named, clips kept).
