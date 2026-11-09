# 06 · AI features: what they do, how they likely work, and where they sit in the UI

Filmora presents about 60 AI features. They fall into **four kinds**, and the kind decides where the feature lives in the UI, whether it runs locally or in the cloud, and whether it costs credits.

| Kind | Examples | Where it runs (inferred) | UI home |
|---|---|---|---|
| **A · Analyse** (understand media) | media analysis, smart search, scene detection, beat detection, silence detection, speech-to-text, face detection | Local models (see 01 §1.7) | Right-click on media; results become *tags, markers or bins* |
| **B · Transform** (change pixels or sound) | masks, cutout, object remover, denoise, stabilise, enhance, relight, eye contact, face mosaic, frame interpolation, vocal remover | Mostly local; heavy ones in the cloud | A **switch inside the clip inspector** |
| **C · Assemble** (make edit decisions) | smart scene cut, auto highlight, smart short clips, auto beat sync, auto reframe, text-based editing, instant mode | Local analysis plus rules | A **dedicated window or wizard**, then *"Edit in timeline"* |
| **D · Generate** (create new media) | text/image-to-video, AI extend, AI image, music, sound effects, voice clone, TTS, copywriting, stickers, thumbnails | Cloud (third-party generative models), **paid credits** | The **Stock Media → AI Media** panel, or a prompt box |

Kinds A–C are what matter to OTSI. Kind D is out of scope: it is paid cloud generation, it conflicts with ADR-030, and "unknown beats wrong" forbids invented footage.

## 6.1 A · Analysis features

| Feature | User flow | Output | Technique (likely) |
|---|---|---|---|
| **AI Media Analysis** | Right-click a clip → AI Media Analysis → see the credit cost → Generate | **Keywords** per clip in a *Media Analysis Results* node of the media tree | Vision-language tagging over sampled keyframes |
| **AI Smart Search** | A search box in the media panel, with a *Character* toggle to search **visuals and dialogue** | Matching clips | Text and image **embeddings**: clip frames and transcript are embedded once; the query is embedded and compared by cosine similarity (the MiniLM/vision-embedding components in 01 §1.7) |
| **Scene detection** | Tools → Scene Detection → a list of segments → delete unwanted → *Import* or *Add to timeline* | Shot segments | Frame-difference or learned shot-boundary detector |
| **Beat detection** | Right-click music → Beat Detection → a beat icon on the thumbnail → markers appear on the timeline; *Beat options* chooses beat density; manual M markers too | Beat markers | Onset and tempo tracking on a spectral flux curve |
| **Silence detection** | Tools → Audio → Silence Detection; **volume threshold** and **minimum duration** sliders → Analyze → *Finish and replace* | Silent spans removed | RMS energy below a threshold for at least N ms |
| **Speech to text** | Tools → Audio → STT; language; output as SRT | A subtitle track | Local ASR model |

**The UX pattern behind every analysis feature:**

1. **Explicit trigger.** The user asks for analysis; it doesn't run unasked. The *cost* (credits or time) is shown first.
2. **Background task.** A progress indicator in a task list (*AI Creations Tasks*). It can be hidden and the user keeps editing.
3. **A durable result attached to the media:** tags, markers, a beat icon, a result folder. The analysis is never thrown away.
4. **A review step before anything changes the edit:** delete unwanted segments, then add to the timeline.

**Lesson for OTSI.** This is precisely our engine's contract:

- explicit *Analyse*;
- background job;
- a durable run attached to the video;
- review before the reel.

Filmora confirms it is the right pattern. Two things we should copy:

- **A results node inside the media browser**, so engine moments are browsable where clips are picked.
- **Show the cost before starting.** For us that is the *time and GPU estimate*, not money.

## 6.2 B · Transform features (inspector switches)

All of these follow the **switch + strength + Generate** pattern in the clip inspector:

| Feature | Controls | Technique |
|---|---|---|
| AI mask (smart brush, select character, select subject) | expand, blur, opacity, invert, *path tracking* | Prompted segmentation + propagation |
| AI smart cutout | brush and eraser, invert, Apply | Interactive matting |
| AI portrait cutout | quick or advanced mode, plus body effects | Person segmentation |
| AI object remover | **magic box**, smart brush, eraser → Remove | Segmentation + video inpainting |
| AI face mosaic | detect faces → *tick which faces* → strength, feather, opacity, **reverse** (blur everything except the faces) | Face detection + face-ID tracking + mosaic |
| AI video enhancer | enhance, generative enhance, dark-night, bright-night | Super-resolution and low-light enhancement networks |
| AI relight | facial or ambient presets; up to 8 **draggable light orbs in the player**; save as preset | Depth and normal estimation + relighting shader |
| AI eye contact | one switch → Generate (clips ≤ 3 min) | Gaze-redirection network |
| Skin-tone protection | one slider under LUT | Skin segmentation that limits a LUT's effect on skin |
| AI frame interpolation | in Speed → optical flow | Learned interpolation |
| Vocal remover, voice enhancer, denoise | see chapter 07 | Source separation, speech enhancement |

**Design notes worth keeping:**

- **"Select which detected faces."** After detection the user *ticks* faces in a list. Detection proposes; the human decides. This is our identity-review principle in miniature.
- **Reverse / invert** appears everywhere, because one control doubles the use cases. *Blur everyone except my player* is the face-mosaic "reverse" applied to people.
- **Direct manipulation in the player.** Light orbs, mask shapes, crop frames and the tracker box are all dragged *on the video*, with numbers mirrored in the panel.
- **Length limits are stated in the UI** (eye contact ≤ 3 min, lip sync ≤ 5 min). This is honest about capability.

## 6.3 C · Assemble features (AI makes an edit, the human approves)

| Feature | Input | What the user decides | Output |
|---|---|---|---|
| **Smart Scene Cut** | long video + up to **10 object types** to look for | ticks clips in three result groups: *highlight scenes*, *character scenes*, *custom object* | the ticked clips on the main timeline |
| **Auto Highlight** (at export) | the finished timeline | Auto, or a target length (15 s, 60 s, or custom) | a cut-down highlight export |
| **Smart Short Clips** | long video (file, own channel link or cloud) + language + **duration** + **theme** + main-topic keywords + aspect ratio + optional generated music | picks among several scored results; edits captions (select mode or time-code mode), thumbnail and font "apply to all" | vertical shorts. *AI recognises characters and places them centrally with a split-screen layout.* It can publish and schedule to social networks, and shows views, likes and comments for 7 or 30 days |
| **Auto Beat Sync** | clips + music + target duration + effect style | order and removal of clips | clips cut on beats → *Export to timeline* |
| **Auto Reframe** | clip + target ratio + **motion speed** | — | the crop follows the subject → Export or *Add to timeline* |
| **Text-based editing** | clip → transcribe (language) | delete words in the transcript to cut the video; *delete all silent clips*; search words | the trimmed clip → *Export to timeline* |
| **Instant Mode / templates** | media + a template | replace placeholder media | a finished video |
| **AI Mate (copilot)** | a chat prompt | choose a mode: **Action** (does the edit), **Guide** (explains and *walks the user through the UI* with a "Start guide" coach overlay), AIGC (generates), story agent | edits or guidance |

**The common pattern of every Assemble feature:**

1. A **wizard window** with few, plain inputs (duration, theme, ratio, what to look for).
2. **Several candidate results, scored.** The human picks, never one take-it-or-leave-it result.
3. **"Edit in timeline" / "Export to timeline"** is always the exit. The AI output becomes an ordinary, fully editable edit, never a locked artefact.
4. Long jobs run **offline/background** with a notification.

**Lessons for OTSI (the most important chapter for our product).**

- **Our Reel Builder is an Assemble feature.** Its inputs should be just as plain:
  - the player (identity confirmed);
  - duration (30 s / 60 s / 90 s);
  - theme (all-round, attacking, defending, set pieces);
  - ratio (16:9 or 9:16).
- **It should produce 2–3 candidate reels with a score**, for example coverage of moment types and share of confirmed-identity moments.
- **"Edit in Clip Studio" is the exit.** The generated reel lands on the timeline as ordinary clips.
- **Smart Scene Cut's three groups** map onto ours: *highlight moments* (goals, shots, key passes), *player moments* (every touch of the reel's player), and *custom* (an event type the user picks).
- **AI Mate's Guide mode**, an assistant that *points at the UI* ("Start guide"), is a strong idea for our non-developer users and fits our tutorial material. It needs no paid LLM: a scripted coach-mark tour per task gets most of the value.
- **Auto Reframe's motion-speed control** is a good, simple parameter for our 9:16 player-follow crop (how smoothly the virtual camera follows).

## 6.4 D · Generate features (studied, out of scope for OTSI)

For completeness, the generative family:

- text, image, audio and *idea/script* → video (several third-party cloud models, chosen per job);
- **AI Extend** (5–8 s of new footage before or after a clip, *marked as AI content* on the timeline);
- AI image and sticker (four variants, style choice);
- AI music (modes, mood and duration) and AI sound effects (prompt + category tags);
- voice cloning and TTS, translation with optional lip sync;
- copywriting (titles and descriptions, also at export);
- thumbnail creator (AI picks the best frames, then a template);
- image-to-prompt; animated charts from a data file; logo reveal.

**Two design details are relevant even though we won't generate media:**

1. **AI-generated content is labelled.** Placeholder "generating" clips sit on the timeline, the finished clip carries a visible AI identifier, and the user must accept an AI-content usage agreement. This is the same honesty principle as our *detected / inferred / confirmed / not measured* badges.
2. **The AI thumbnail picker** ("the best frames from your video") is cheap for us. Rank frames by sharpness, the player's box size and spotlight centring, then let the user pick one for the reel cover.

**Video chapters at export** (named timestamps → a styled progress bar burned into the video) is directly useful for long match reports: *1st half · 2nd half · Set pieces*.
