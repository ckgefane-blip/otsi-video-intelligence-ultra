# 01 · Technology: how a desktop NLE like Filmora is built

**Method.** This chapter draws on two things only:

- The public user guide and system requirements.
- The *names* of the components in the install folder (16.0.12, about 1.8 GB). File and folder names are visible to anyone in Explorer.

Nothing was decompiled, unpacked, disassembled or run outside normal use. The architecture below is *inferred* from those names and the documented behaviour. Read it as an informed model, not as fact.

## 1.1 The big picture: six layers

```
┌──────────────────────────────────────────────────────────────┐
│ 6  Shell & services: login, cloud drive, stock store, update, │
│    telemetry/crash reports, AI credits                        │
├──────────────────────────────────────────────────────────────┤
│ 5  UI: native widget toolkit (Qt 5) + embedded web views (CEF) │
│    for store/home/AI panels; dark & light skins, 1x/2x assets │
├──────────────────────────────────────────────────────────────┤
│ 4  Editing model: project ⇄ data model ⇄ timeline engine,     │
│    undo manager, presets, SQLite catalogues, preferences      │
├──────────────────────────────────────────────────────────────┤
│ 3  Effects host: own effect plug-in format (.wfx), OpenFX host│
│    (3rd-party video FX), VST3 (audio FX), particles, Lottie   │
├──────────────────────────────────────────────────────────────┤
│ 2  Media engine: demux/decode → GPU compositor → encode/mux;  │
│    separate play-server process; proxy & background cache     │
├──────────────────────────────────────────────────────────────┤
│ 1  AI runtime: many small single-purpose models run through   │
│    several inference back-ends (ONNX Runtime, OpenVINO, MNN,  │
│    ncnn, TNN, TensorRT, XNN) + a small local LLM runtime      │
└──────────────────────────────────────────────────────────────┘
```

## 1.2 Layer 5: the UI toolkit

- **A native toolkit with web islands.** The core editor (timeline, player, property panel, media library and export dialog) is native widgets. The home page, the asset store and the AI panels are embedded Chromium views (CEF).
  - **Why:** the timeline and player need native speed and GPU surfaces. The store and marketing panels change weekly and are cheaper to ship as web pages.
- **One view module per zone.** The view modules are timeline view, property-panel view, media-library view, media-player view, export view, template view and product home page. Each zone of the screen is its own component with its own state. That is why the zones can be undocked, rearranged and saved as *layouts* (Default, Organize, Edit, Short Video, Classic, Dual, Timeline, Color Grading and Audio Mixing).
- **Skins.** Dark and Light resource bundles, each at 1x and 2x, plus a text stylesheet per theme. The whole look is a themable resource layer, not hard-coded colours.

**Lesson for OTSI.** We are a web app, so every zone is already a component. What we lack is *saved layouts per task* (Analyse, Edit, Review, Colour). Filmora shows that a "workspace preset" is cheap once zones are components. It is a big usability win for people who do one job at a time.

## 1.3 Layer 4: the editing model

The component names show these pieces:

- **Project editor**
- **Project serialiser**
- **Data model**
- **Timeline editor and timeline UX**
- **Undo manager:** every edit is a command that can be reversed.
- **SQLite catalogues:** media index, favourites, downloaded assets and recent projects.
- **Preference manager**
- **Preset store:** user presets for colour, text, compound clips, layouts and shortcuts.

**The pattern.** This is the textbook NLE core: **document → commands → views**.

- The document (the project) is a tree of tracks → clips → effects → keyframes.
- Every user action is a *command object* with do and undo. Undo and redo are free, and so are *Copy Effects* and *Paste Effects*.
- Views subscribe to the document. The timeline, player and property panel are three views of one selection.

**Lesson.** Our Clip Studio already has undo and redo. The *single selection drives every panel* rule matters: select a clip on the timeline, and the property panel, preview and media info all follow it. That is the main feeling of a mature editor.

## 1.4 Layer 2: the media engine

| Stage | Evidence | What it does |
|---|---|---|
| Demux, decode | Decode, demux and encode managers. A VLC-based decoder. dav1d (AV1). AVIF, HEIF and JPEG-XL image codecs. Codec plug-ins for Intel Media (QSV), AMD AMF, NVIDIA CUDA, ProRes, CineForm, AAC and AC-3. | Hardware decode where the GPU allows, software otherwise. |
| Colour | lcms2 (ICC colour management), libyuv (fast YUV↔RGB), ProRes RAW via OpenCL. | Colour-space conversion. Rec.709 SDR vs Rec.2100 HLG/PQ HDR (guide: HDR export only when GPU acceleration is on, and about 4× slower). |
| Composite | A video compositor, plus DirectX, OpenGL and OpenCL effect managers, ANGLE (GL on DirectX) and a SwiftShader software fallback. | Layers, blend modes, effects and transforms are composited **on the GPU**, with a guaranteed CPU path. |
| Playback | A separate *play server* process and a *core media server* process. | Preview runs out-of-process, so a crashing codec does not kill the editor. The player is a client of the media server. |
| Cache | Background task manager, background-cache service, proxy detector and proxy converter. | Builds proxies, preview renders and thumbnails in the background (see §1.5). |
| Audio | fftw3 (FFT), an audio plug-in folder with about 25 DSP blocks (EQ 3/10-band, compressor, limiter, gate, expander, ducker, reverb, pitch shift, denoise, surround panner, up-mixer, peak meter), and a VST3 host. | A real mixer graph. Each track is a chain of DSP nodes. |
| Encode | Windows Media Foundation encoder and muxer. Intel/AMD/NVIDIA hardware encoders. AV1 (aom). | Export uses hardware H.264/HEVC/AV1 when available. |

### 1.5 Three tricks that make editing feel fast

1. **Proxy media.** A low-resolution copy is used for playback; the original is used for export.
   - Created automatically above a resolution threshold (Preferences → Performance), or by hand (right-click → Create Proxy).
   - A badge on the thumbnail shows that a proxy exists.
2. **Preview render (render cache).** A strip above the ruler is **red** where the timeline is too heavy to play in real time and **green** where a cached render exists.
   - *Render Preview* (Enter) renders the red parts. *Background render* does it automatically after a period of inactivity.
   - Editing a green part turns it red again. This is cache invalidation shown to the user.
3. **Playback quality.** Full, ½ or ¼ preview resolution. The app *detects lag and suggests* lowering it. This affects only the preview, never the export.

**The principle.** The preview is *allowed to be approximate*, and the export is always exact. The user always knows which state they are in, because a red or green line and a proxy badge show it.

**Lesson for OTSI.** This is the single most important technical idea for us. Our spotlight and overlays exist only in the final MP4 render, so the user edits blind. The Filmora model says:

- Draw a **cheap live preview** in the browser (canvas overlay of the spotlight and ring over the `<video>`, driven by the same keyframes the renderer uses).
- Keep the **exact render** server-side.
- Show a **"preview vs rendered" state** per clip (red/green).

## 1.6 Layer 3: the effects host

- **Own effect format.** A folder of `.wfx` effect plug-ins: colour adjust, LUT, chroma key, AI filter, alpha and Skottie (Lottie) transitions, object tracking, planar tracking, video background fill and video merge. Each effect family is a plug-in with GPU (OpenGL, OpenCL) and pure-C variants.
- **OpenFX host.** Third-party video effects use the industry-standard OFX API (Boris FX, NewBlue FX, Mocha).
- **VST3.** Third-party audio effects.
- **Motion graphics.** A Lottie renderer (rlottie) and a Skottie transition plug-in mean many titles, stickers and transitions are *vector animations described in JSON*, rendered at any resolution. A particle engine (Effekseer) handles sparks, confetti and the like.
- **Configuration as data.** The `configs` folder holds preset definitions: keyframe animation, text styles, text shapes, transitions, motion (lower thirds), pan-and-zoom, speed curves, masks and colour/3D-LUT presets. Most "features" are data files read by a few generic engines.

**Lesson.** Our templates (looks), transitions and branding should be **data-driven presets** (JSON) read by one generic renderer, not code per look. Our render pipeline already leans this way, and it should become an explicit rule. Lottie is free (MIT-licensed renderers exist) and is the right format for animated football graphics: score bugs, player name straps and "goal" stings.

## 1.7 Layer 1: the AI runtime, many small models

The striking finding is not one big AI. It is **about 80 small, single-purpose models** behind a common wrapper, each doing one job. Grouped by job:

| Family | Single-purpose models (names paraphrased) |
|---|---|
| People | face detection, face landmarks (several versions), face pose, face visibility, face-ID tracking, face clustering, eye landmarks, human body and head detection, body landmarks, human segmentation, clothes segmentation, portrait/skin |
| Objects and scene | object segmentation, *interactive* segmentation (click to select), panoptic and semantic segmentation, object tracking, mask propagation and mask tracking, plane tracking, camera tracking, depth estimation, normal-map generation, scene-cut detection, keyframe extraction, low-quality and blur detection, logo removal, smart mosaic |
| Video enhancement | denoise, frame interpolation (slow motion), stabilisation (several versions), motion blur, relighting, quality enhancement, flicker removal |
| Audio | speech detection, voice-activity detection, speech enhancement (four generations), noise, hiss, hum and wind removal, loudness normalisation, source separation (vocal remover), beat and tempo tracking, BPM, music segmentation, peak detection, MIDI detection, voice change and beautify |
| Language and search | speech-to-text, captions and subtitles, a small text tokenizer and embedding model (smart search by meaning), vision embeddings (search video by content), a local LLM runtime (ggml) and a copilot |
| Editing intelligence | auto-highlight montage, highlight generator, auto-reframe, template matching, media analysis, a strategy engine |

**Runtime design.**

- Several inference back-ends sit side by side: ONNX Runtime, **OpenVINO with Intel CPU, GPU and NPU plug-ins**, MNN, ncnn, TNN, TensorRT and XNNPACK. This suggests each model ships in whichever format runs best, and a dispatcher picks a back-end by hardware: NVIDIA → TensorRT/CUDA, **Intel → OpenVINO**, otherwise CPU.
- **Local first, cloud for generative work.** The analysis models (detection, segmentation, tracking, STT and beats) run on the PC. Generative features (text-to-video, image generation, voice cloning) appear as cloud services that cost credits.
- Each AI feature is a **service** (camera track, frame interpolation, intelligent segment, object remove, video analysis, caption, subtitle, realtime and thumbnail) called by the editor. Results are cached with the media.

**Lessons for OTSI (important).**

1. **Many small models beat one big model** for an editor. Our engine already does this (detector, tracker, re-ID, OCR, pitch). Filmora confirms it is the commercial norm.
2. **OpenVINO on Intel GPU and NPU** is what a commercial editor uses on Intel hardware. It is free (Apache-2.0), and it is exactly our Arc GPU path (ADR-030, zero cost).
3. **Analysis is cached with the media** and shown as an index. Analysis runs once, and the editor reads the results many times. This is our engine → library model.
4. **Interactive segmentation and mask propagation** are the "click the subject, it follows him" pattern, which is our spotlight-on-player. Filmora sells it as *AI Smart Masking*. The free equivalent is a SAM-family model plus propagation.

## 1.8 Layer 6: shell and services

- An account and licence check (watermark on export until signed in with a paid licence).
- A vendor cloud drive (1 GB free) for projects, templates and finished videos, with share links (password, expiry, download and comment permissions, time-coded review comments).
- A built-in stock and asset store (partner libraries for GIFs, photos and video).
- Auto-update (daily or weekly, or manual), crash reporting and usage telemetry.
- A system-compatibility check on start: OS, RAM and VRAM thresholds, and a GPU driver check.

## 1.9 Hardware envelope (from the published requirements)

- 64-bit Windows, a 2 GHz multi-core CPU, and 8 GB RAM (16 GB for HD/4K).
- A GPU from 2015 or later with 2 GB VRAM (4 GB for HD/4K).
- An SSD recommended.
- Inputs: the common consumer containers. Outputs: MP4, MOV, MKV, AVI, TS, GIF, ProRes, device and social presets, and DVD.

**Takeaway.** A mature NLE is not one clever algorithm. It has:

- a strict document/command core;
- a GPU compositor with honest approximate previews;
- a library of data-driven presets;
- a fleet of small local models whose results are cached and browsable.

Every one of these is achievable for OTSI with free software.
