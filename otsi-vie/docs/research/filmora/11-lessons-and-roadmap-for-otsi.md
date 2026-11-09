# 11 · What we learned, and what it means for OTSI

## 11.1 The ten ideas that make Filmora mature

1. **The edit decision list over immutable media.** Everything is non-destructive. Effects, grades, speed and masks are *parameters*, never baked pixels (03, 04).
2. **One document, one command stack, many views.** Undo is free, selection drives every panel, and copy/paste of attributes works (01 §1.3).
3. **An approximate live preview plus an exact export,** with an honest indicator of which one the user is seeing: proxies, render cache, quality menu (01 §1.5).
4. **Every effect is a switchable, keyframable inspector section** with the same anatomy (05 §5.1, 02 §2.3).
5. **Many small local models,** each doing one job, with results cached on the media as tags, markers and bins (01 §1.7, 06 §6.1).
6. **Analyse → review → assemble → "Edit in timeline".** Automatic tools never lock their output (06 §6.3).
7. **Data-driven presets** (looks, titles, transitions, templates, layouts, shortcuts), read by a few generic engines (01 §1.6, 08).
8. **One asset browser** for every library (08 §8.3).
9. **Direct manipulation on the video** for anything spatial (02 §2.3).
10. **Honest states and stated limits** (greyed-out with a reason, AI-content labels, length limits, "cannot be synchronised").

## 11.2 Where OTSI already stands above it

| OTSI strength | Filmora's nearest equivalent | Why ours is stronger |
|---|---|---|
| Multi-object tracking with **identity** (re-acquired through occlusions and cuts) | single-target motion, planar and camera tracking (box drawn by hand, drifts on twisting bodies) | It follows *a known player* for a whole match. |
| **Football event moments** ranked per player | generic "highlight" and "character scenes" | Domain events (shot, pass, duel …) beat visual saliency. |
| Evidence levels (detected / inferred / confirmed / not measured) and accuracy gates | an AI-content label only | Honest about *how much to trust* each number. |
| Canonical Player ID, rights split (produce vs deliver), tenant isolation | a licence watermark | A commercial rights model, which Filmora lacks. |

Filmora is a *general* editor with *generic* AI. OTSI is a *football* editor with *domain* AI. The plan is **not** to become Filmora. It is to give our domain AI an editor that feels as mature as Filmora's.

## 11.3 Gap table: OTSI Clip Studio / Reel Builder against the mature-editor bar

Status as of 2026-11-06 (from the first study, f61978f): **Have**, **Partly**, **Missing**.

| Mature-editor capability | OTSI today | Status | Free way to build it |
|---|---|---|---|
| Live preview of spotlight, ring and graphics | only in the rendered MP4 | **Missing (biggest gap)** | A canvas overlay over `<video>` from the same track data and keyframes the renderer uses |
| Preview-vs-rendered indicator | — | Missing | Per-clip state from the render job |
| Edge-drag trim, I/O, trim to playhead | in/out typed in the inspector | **Missing** | Front-end only |
| Selection-driven inspector with switchable sections | partly | Partly | Front-end restructure |
| Speed: freeze, slow motion, hero-moment ramp | — | **Missing** | ffmpeg `setpts`/`tpad`/`minterpolate`, or RIFE (MIT) |
| User keyframes (zoom, ring size, darkness) with easing | — | Missing | Shared JSON keyframe evaluator (TypeScript and Python) |
| Data-bound text (name strap, minute, event) | — | **Missing** | Lottie/ASS/drawtext presets fed from confirmed data only |
| Subject-aware 9:16 / 1:1 reframe on the *identified player* | — | **Missing** | Crop window from the track box, smoothed (one "motion speed" parameter) |
| Telestration (arrow, line, zone with draw-on) | — | Missing | SVG/Lottie trim-path, burned by the renderer |
| Template = slots + rules, engine-filled | saved looks | Partly | Template JSON with slot rules, filled by Reel Builder |
| 2–3 candidate reels, scored → "Edit in Clip Studio" | single build | Partly | Reel Builder variants |
| Loudness normalisation, ducking, beat snap | music with rights declaration | Partly | ffmpeg `loudnorm`, `sidechaincompress`; librosa beats |
| Colour: match-to-reference, look LUT + strength, pitch lift | — | Missing | Lab statistics transfer → `.cube`; ffmpeg `lut3d` |
| Before/after split preview | — | Missing | CSS clip on two layers |
| Uniform asset browser (moments, looks, music, graphics) | separate lists | Partly | One React grid/tree component |
| Saved-query bins ("Player X · final-third touches") | — | Missing | Saved filter over moments |
| Engine results as a node in the media browser | separate Analysis page | Partly | Tree node in the Clip Studio media bin |
| Keyboard map: one coherent set, shown in tooltips | a few keys | Partly (A.9) | Front-end |
| Task layouts (Analyse · Edit · Review) | — | Missing (fits A.7) | Saved panel layouts |
| Time-coded review comments on shared reels | delivery links exist | Partly | Comments table keyed by reel and time |
| Export switches: 16:9 + 9:16 from one edit, chapters | single render | Partly | Render variants per output profile |
| Background tasks with a task centre | job tray | Have | — |
| Undo/redo, split, ripple delete, transitions | yes | Have | — |
| Fast "download this moment raw" | — | Missing | ffmpeg stream copy on keyframes |

## 11.4 Recommended build order (for the owner to approve)

Ordered by *value to a football reel* ÷ *cost*. All of it is zero-cost (ADR-030) and local (engine-local-only).

**Stage E1: "See what you get"** (the editor stops being blind)

1. A live spotlight and ring preview in Clip Studio (canvas over the playback copy, from engine tracks).
2. A preview-vs-rendered indicator per clip.
3. Edge-drag trim, I/O marks, Alt+[ / Alt+].

**Stage E2: "Highlight grammar"**

4. Freeze frame and slow motion / hero ramp at the key moment, with the ring held on the player.
5. A data-bound name strap and event caption (confirmed identity only; unknown → no name).
6. A selection-driven inspector with switchable sections (spotlight, ring, strap, speed, zoom, look).

**Stage E3: "One edit, every format"**

7. Subject-aware 9:16 / 1:1 reframe following the identified player (one motion-speed control).
8. Export profiles: 16:9 scout cut + 9:16 social cut from one edit; loudness normalisation and ducking.

**Stage E4: "Faster assembly"**

9. Reel Builder: plain inputs (player, length, theme, ratio) → 2–3 scored candidates → *Edit in Clip Studio*.
10. Slot-and-rule templates filled from engine moments; one asset browser for moments, looks, music and graphics.

**Stage E5: "Pro polish"**

11. Keyframes with easing; telestration arrows and lines with draw-on; colour match-to-reference and look LUTs.
12. Task layouts (ties into A.7 Guided/Pro); the full shortcut map (A.9); time-coded review comments.

Phase A items that this study *reinforces* and that could be folded in:

- A.7 Guided/Pro → task layouts.
- A.8 search/palette → smart search over moments.
- A.9 keyboard map.
- A.11 rights block in the export window.
- A.12 Media Info panel → the inspector's empty-selection state.
- A.14 Library tree → saved-query bins.

## 11.5 What we will deliberately *not* take

- **Generative media** (text/image-to-video, AI extend, voice clone). It is paid cloud, conflicts with "unknown beats wrong", and is not football truth.
- **Beauty, retouch, AR stickers, body effects.** Not our audience.
- **Cloud storage and social auto-posting.** Our delivery is rights-gated links. Social posting would need external accounts (owner approval).
- **Any of Filmora's artwork, icons, text, preset content or file formats.** We learn the ideas only.

## 11.6 Decisions the owner needs to make

1. Approve the E1–E5 editor stages (a product-scope addition to Clip Studio's approved behaviour), or choose to resume Phase A first.
2. If approved: do E1 before or after the remaining Phase A items?
