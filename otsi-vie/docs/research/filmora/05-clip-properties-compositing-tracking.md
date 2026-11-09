# 05 · Clip properties, compositing, keyframes and tracking

## 5.1 How the property panel is organised (the "inspector")

Selecting a clip fills the right-hand panel. Its structure is consistent:

- **Tabs by media nature:** Video · Audio · Color · Speed (and Animation, Mask, AI tools, depending on the clip). A text clip shows Text · Animation, and a shape shows Shape.
- Within a tab, **collapsible sections**. Each section has an **on/off switch**, a **reset**, and a **keyframe diamond** per parameter or per section.
- At the foot: **Save as custom** (stores the tab's settings as a reusable preset) and **Reset** (restores defaults).
- Every slider has a numeric field, so typed values and dragged values agree.

The Video → Basic tab, in order:

1. Transform
2. Compositing
3. Track matte
4. Background
5. Auto-enhance
6. Drop shadow
7. Motion blur
8. Stabilisation
9. Lens correction
10. Chroma key and AI matting
11. Denoise
12. Motion tracking
13. Camera tracking
14. Retouch

These are toggles in one long, ordered list. They are not separate dialogs.

**The design principle.** *Every effect is a switchable section of one inspector.* The user never "opens a tool"; they switch a section on. Turning a section off keeps its settings, so A/B comparison is free.

**Lesson for OTSI.** Our spotlight, ring, name strap, freeze, slow motion and zoom should be **switchable sections of the selected clip's inspector**, each with its own keyframes. They should not be global render options.

## 5.2 Transform and compositing

- **Transform:** scale (width and height, linked or free), position, rotation, flip, **anchor point** and *path curve* (whether position animates on a straight line or a Bézier path).
- **Compositing:** **blend mode** (normal, multiply, screen, overlay, darken, colour burn …) plus **opacity**. Keyframes can be set *per section* (one diamond keys every parameter in the section) or *per parameter*.
- **Picture-in-picture** is just a clip on a higher track with transform, blend, mask, border and an in/out animation. It is not a separate feature, only a recipe.
- **Split screen:** either a *template* (cells that clips are dropped into; borders; per-cell transform, animation and colour) or a *multi-frame effect*.
- **Track matte:** the selected clip is revealed by **another track's alpha or luma**, with a *reverse* option. A matte comes from a clip, not a hand-drawn mask.
- **Background:** when a clip doesn't fill the frame (for example 9:16 in 16:9), fill the bars with **blur** (a blurred copy of itself), a colour or a pattern.
- **Crop and Zoom / Pan and Zoom:** crop to a preset ratio; pan and zoom ("Ken Burns") between a green *start* rectangle and a red *end* rectangle. Presets include zoom in, zoom out, pan left, pan right and swap.

## 5.3 Keyframes: the animation system

- **Keyframe = (time, parameter, value, interpolation).** A diamond next to any parameter records one. Moving the playhead and changing the value records the next.
- **Interpolation types** (right-click a key): linear, curve (Bézier), continuous curve, **freeze** (hold), **ease in** and **ease out**.
- **Path curve:** for position, the motion path is drawn *in the player* as a curve with handles.
- **Keyframe graph editor:** a value-against-time graph under the clip on the timeline (*Show keyframe animation*), with Bézier handles. It shows timing and easing visually.
- **Navigation:** [ and ] jump to the previous or next key, and Alt+click adds one. Keys can be deleted one at a time or all at once.
- **Motion blur from keyframes:** shutter angle, shutter phase and samples. It blurs along the *keyframed* motion, so a fast zoom looks filmed rather than digital.

**Technique.** The renderer evaluates every animated parameter at each output frame by interpolating between keys (piecewise cubic Bézier or linear). The same evaluation runs in the preview and in the export, which is why the preview matches.

**Lesson for OTSI.** Our spotlight already follows *track boxes per frame* (dense data). The missing layer is **sparse user keyframes on top**: ring size, darkness and zoom level, with ease in and out. One evaluator, used by both browser preview and server render, removes "the preview lies" bugs.

## 5.4 Masks

- **Shape masks:** rectangle, circle, star, heart and others, plus a **custom drawn path** or an *imported* mask. Each mask is a **layer**, and several mask layers combine (add, subtract or intersect).
- **Mask settings:** position, scale, rotation, **feather/blur strength**, opacity, **invert** and **mask stroke** (an outline glow along the mask edge).
- **AI mask:** *Smart brush* (paint roughly over the subject), *Select character* (people detected automatically) and *Select subject* (any salient object). Then **Expand**, **blur strength** and opacity. **Path tracking** keeps the mask on the subject over time.
- **Colour mask** (in the Color tab): a mask by colour range, so a grade affects only matching pixels.

**Technique.** The AI mask is *interactive segmentation*: a click or brush prompt goes to a segmentation network that returns a matte. *Mask propagation* then carries that matte frame to frame using motion and appearance, and re-segments when confidence drops.

**Lesson for OTSI (spotlight).** This is our flagship effect seen from the editor's side. A *player spotlight* is:

- a soft elliptical (or person-shaped) mask around one player;
- inverted, with darkening outside it;
- a ring as a stroke;
- the shape driven by the track box.

The Filmora UI teaches the controls users already understand: **feather, expand, opacity (darkness), invert, stroke**. We should name our spotlight controls with these same generic words.

## 5.5 Tracking: three different technologies

| Kind | What it tracks | Use | Technique |
|---|---|---|---|
| **Motion tracking** | A user-drawn box (a point or region) | Pin text, an image or a mosaic to a moving thing. A *Link element* dropdown chooses what follows. | Template or feature tracking (correlation filters or optical flow) of a small region. It drifts when the subject turns or is occluded. |
| **Planar tracking** | A flat surface defined by 4 corners | Replace a billboard or screen; blur a number plate. *Auto* or *Advanced* modes; accuracy against time; track whole clip or frame by frame; correct single frames; link element (background, file or mosaic). | Homography estimation from many features on a plane; robust to perspective change. |
| **Camera tracking** | Head, body or a custom target | *Reframe* the shot to follow the person, a virtual camera move. | Person detection plus a smoothing filter on the crop window. |

There is also a third-party **pro planar tracker** (Mocha), offered as a plug-in with its own window. It adds spline masks driven by tracking, mesh tracking of bending surfaces, stabilisation, lens calibration and *insert* layers. The editor's own trackers are the *easy* path, and the plug-in is the *expert* path.

The guide itself states the limitation: simple tracking "jitters" on twisting bodies. That is why the planar and mesh tools exist.

**Lessons for OTSI.**

- Our engine tracker (detection + association + re-ID) is a *fourth* kind: **multi-object tracking with identity**. It is stronger than any single-target tracker, because it re-acquires after occlusion and cuts. This is our genuine moat, and the UI should *show that strength*, for example "followed through 3 occlusions".
- The **Link element** pattern (choose what follows the track: ring, name tag, arrow, blur) is exactly the UI we need on a player track.
- **Single-frame correction** of a track (nudge the box on one frame and re-propagate) is the pro escape hatch. It corresponds to our human-review identity confirmations.

## 5.6 Corrective tools (one-switch fixes)

Each tool is one toggle plus one or two sliders:

| Tool | Controls | Technique |
|---|---|---|
| Stabilisation | strength / smoothing | Estimate camera motion, smooth the path, warp and crop. |
| Lens correction | camera model and resolution presets | Inverse barrel/fisheye distortion from a camera profile. |
| Denoise | weak / normal / strong | Temporal or AI denoising. |
| Auto enhance | one strength slider | Automatic levels, contrast and sharpness. |
| Flicker removal | (cloud) | Temporal exposure equalisation. |
| AI matting / chroma key | key colour, tolerance, edge feather and thickness, spill suppression, alpha, pedestal | Colour-distance keying plus spill suppression, or an AI matte with no green screen. |
| Retouch (faces) | skin, face shape, eyes, nose, mouth and brows sliders, single or multiple faces, makeup presets | Face landmarks drive local warps and skin smoothing. |

**The pattern.** The hard algorithm is hidden behind **one switch and one strength slider**, with sensible defaults. The power user gets the detail sliders after expanding the section.

## 5.7 Layers that aren't media

- **Adjustment layer:** an empty clip on an upper track. Every effect or grade on it applies to everything *below* it for its duration. It is non-destructive and reusable as a preset.
- **Custom colour layer:** a solid or gradient colour clip, used as a background, a tint (with a blend mode) or a separator, and saved as a preset.
- **Drawing tools:** rectangle, oval, arrow, line (with start and end styles) and a **pen** for Bézier paths. Shapes have fill, stroke, animation and **trim path**: a keyframed 0–100 % "draw on" of the stroke.

**Lesson for OTSI.** The **animated arrow with trim path** is the tactics-telestration primitive: draw a run or pass line that *draws itself on*. It is the most-requested analyst graphic in football video. An adjustment layer is the natural way to apply a club look to a whole reel.

## 5.8 Reframing and scene tools

- **Auto Reframe:** choose a target ratio (9:16, 1:1 …) and a *motion speed* (how quickly the virtual camera may move), then *Analyze*. The crop follows the main subject. It is available as a tool, from the timeline, and *at export*.
- **360 reframing:** drag in the player to choose the view direction and FOV, and keyframe camera moves.
- **Scene detection:** detects shot changes, lists the segments, lets the user delete unwanted ones, and then either *import* them as clips or *add* them to the timeline.
- **Smart Scene Cut:** the user picks up to 10 *objects* to look for; it then extracts *highlight scenes*, *character scenes* and *custom-object* scenes from a long video. It runs as a **background AI task** with a task list, and the results open in a pick-and-add page, then go to "edit in main timeline".

**Lesson for OTSI.** Smart Scene Cut is the consumer cousin of our engine:

- long video → AI finds moments by category → the user ticks the ones they want → they land on the timeline.
- The UX loop of **background task → results page with categories → tick → "edit in timeline"** is exactly our Analysis → Reel Builder handoff and should feel this direct.
- **Auto Reframe with a motion-speed control** is how we should make 9:16 player reels: the crop follows *the identified player*, not "the main subject". We have the identity, and they do not.
