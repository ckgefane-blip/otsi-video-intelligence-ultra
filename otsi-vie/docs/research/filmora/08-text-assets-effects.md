# 08 · Text, captions, assets, effects, transitions and templates

## 8.1 Text and titles

- **Ways to add text:**
  - a *Titles* library preset (+ or drag);
  - **Quick Text** (the T on the timeline toolbar drops a plain title at the playhead);
  - *Add Text*;
  - captions from speech.
- **Basic text panel:**
  - text box, font, size, colour, alignment, case, bold, italic and underline;
  - **preset styles**;
  - **bubble** (speech or callout backgrounds);
  - **shadow** (opacity, blur, distance) and **glow** (type, colour, intensity);
  - **shape** (curved or circular text along an arc with amount, direction and spacing);
  - **Bézier path** (text moves along a drawn path, with offset, duration and loop);
  - **perspective text** (X/Y/Z position, perspective strength, or pinned to a planar-tracked surface so text appears painted on a wall or pitch).
- **Advanced text edit** is a separate window with *Customize*, *Animation* and *Bubble* tabs:
  - fill type (solid or gradient), outline, background;
  - **In / Out / Loop** animation presets (fade and blur, zoom, typing …, about 80 in all).
- **Apply to All** pushes a style or animation onto every title of the same kind. **Save as custom** turns a style into a preset.
- **Audio-driven text:** title styles that shake, glitch or jump with the music, with a *sensitivity* slider.

## 8.2 Captions

- **Speech to text** → a subtitle track (SRT), with a language, optional translation, and **smart text correction**: suspected recognition errors are *highlighted with suggestions*.
- **Dynamic captions:** word-by-word highlight of the *active word* and *key words*, with an emphasis button per word.
- **Editing:**
  - double-click the subtitle track to edit text and time code;
  - add, delete and *merge* strips;
  - *Export subtitle file* (an SRT sidecar);
  - *Apply to All* for the style.
- **TTS:** text becomes a narration voice (several voices; voice clone in the cloud).

**Lesson for OTSI.** **Name straps and event captions** ("⚽ 23' Goal: OTSI-NGA-2026-000123") are our "titles". They should be *data-bound titles*: the text comes from the engine and the registry (player name, minute, event type), and the style is a preset. *Smart text correction* has a direct analogue: *highlight low-confidence OCR or identity values* in the caption editor before they are burned in.

## 8.3 The asset browser (one pattern for everything)

Audio, Titles, Transitions, Effects, Filters, Stickers and Templates all share **one browser pattern**:

- **Category tree** on the left: *Mine* (favourites, tag groups, downloads, custom), then themed categories (Trending, Cinematic, Mono, Vintage …).
- **Grid** of animated thumbnails. **Hover plays a preview**, and with the source monitor the preview plays there.
- **Search** box (and the smart search).
- On each tile:
  - **download** (if the asset is remote);
  - **+** (add at the playhead);
  - **star** (favourite);
  - a **premium badge** on paid stock;
  - drag to the timeline or onto a clip.
- **Favourites with tags:** *Recently used*, *Commonly used*, plus user-defined tags shown as chips above the grid.
- **Asset Center:** a marketplace window with banners, top lists and themed categories.

**Lesson.** One browser component, reused for every asset class, is what makes the product feel coherent and cheap to extend. For OTSI the "asset classes" are moments, looks (templates), transitions, graphics (straps, score bugs, arrows), music and branding. They should share one tile/grid/tree component with hover preview, +, star and drag.

## 8.4 Effects

- **Kinds:**
  - video effects (blur and mosaic, distortion, light leaks, glitch, frames …);
  - **face-off** (an overlay that follows a face, unlike a static mosaic);
  - **body effects** (AI outline, glow and particle trails that track a person);
  - audio-driven effects;
  - audio visualisers;
  - **multi-frame** (split-screen) effects;
  - third-party OFX packs.
- **Two ways to apply an effect:**
  1. **On a clip** (drag onto the clip): it becomes a section of that clip's inspector and lasts as long as the clip.
  2. **As an effect clip on its own track** (drag to the track above): it has its own duration (default 5 s, drag the edges), affects everything below for that span, and can be **masked** to a region.
- Common controls: strength, opacity, a mask tab, keyframes, and favourite or tag.

**Lesson.** The *effect-as-a-clip-on-a-track* model is how we should treat the **spotlight**. It is an effect clip spanning the moments where the player is shown, linked to a player track. Its start and end can be dragged independently of the video cut.

## 8.5 Filters

- Looks (LUT-like colour presets) in themed categories, with **strength** and *enhance* sliders, an optional mask, and a 5 s default when used as a track clip.
- **Background-blur filter** fills the bars of a 9:16 clip inside 16:9.

## 8.6 Transitions

- A library of transitions placed **between two clips** (or at a clip's head or tail). The duration is set in the panel or by dragging the transition's edges on the timeline. Delete, favourite.
- Many are Lottie/Skottie vector animations and alpha transitions (see 01 §1.6).

## 8.7 Animation presets for clips

- **Motion presets:** *In* and *Out* animations with a duration slider, plus *Combo* presets (one predefined in-then-out move).
- **Keyframe presets:** a ready-made animation applied to a *section* of a clip.
- These sit alongside hand-made keyframes (05 §5.3).

## 8.8 Templates

- A template drops a **complete multi-track setup** on the timeline: sample clips, titles, stickers, music and effects.
- The inspector shows **Screen 1, Screen 2 …**, one section per placeholder. Each section has a *Media* box to replace the sample, transform controls and an audio on/off switch. *Advanced* opens a detailed layout editor.
- **Instant mode:** pick a template → add media to its slots → it builds the video → light tweaks (effects, music) → export.
- Template categories include multi-frame layout, split screen and community picks.

**Lesson for OTSI.** A **reel template = slots + rules**: *intro sting → 6–10 moment slots → outro with crest*. Each slot has a rule ("a moment of type X for the reel's player"), and the Reel Builder fills the slots from engine moments. The user swaps any slot by dragging another moment onto it. This is Filmora's placeholder model with *engine-filled* placeholders instead of empty ones, which is far more powerful for our use.

## 8.9 Stickers and elements

More than 1000 static, animated and audio-synced stickers, AI-generated stickers, and AR stickers that track faces. Added with + or by drag; transform, animation and favourite.

**Lesson.** The football equivalent is a small **graphics kit**: player marker arrow, ring, distance line, offside line and zone box, each a vector element with trim-path draw-on (05 §5.7).
