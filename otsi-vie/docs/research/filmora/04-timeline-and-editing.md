# 04 · Timeline and core editing

## 4.1 Anatomy of the timeline

From top to bottom:

1. **Toolbar.** Select tool (V) with its sub-modes, which are *Quick Split* (C, a razor cursor) and *Select all forward or backward*. Then undo, redo, delete, split, crop, speed, *more tools*, marker, voice-over, AI tools, render preview, the zoom slider and *zoom to fit*.
2. **Render strip.** A red or green line above the ruler showing which parts have a preview render (see 01 §1.5).
3. **Ruler and playhead.** The playhead carries its own **split button**, which can be turned on in Preferences. Clicking the playhead's scissors splits under the playhead.
4. **Track headers** (left). Per track: *toggle output* (an eye for video, a speaker for audio), *lock*, and track height. The global switches **Magnetic main track** and **Auto Ripple** sit next to **Track Manager** (add or remove tracks and set where they go).
5. **Tracks.** Video tracks are stacked; a higher track composites *over* a lower one. Audio tracks sit below. A **subtitle track** is a special track type made of caption strips. Dropping media into empty space below or above the tracks *creates* a new track.
6. **Timeline tabs.** When a compound clip is opened, its inside appears as a *new tab*. Tabs can be dragged apart so two timelines show at once. Each tab can be exported on its own (*Export Current Timeline*).

## 4.2 Editing operations, as a vocabulary

| Operation | Gesture / key | What actually happens |
|---|---|---|
| Split | Ctrl+B, the scissors, the playhead button, or right-click | Cuts the clips under the playhead into two. **If no track is selected, it cuts every track**, which is a deliberate default. |
| Quick split | C, then click anywhere on a clip | A razor tool: no playhead needed. V returns to select. |
| Trim | Drag a clip edge; Alt+[ / Alt+] trims start or end to the playhead | Changes the in or out point within the source. |
| Mark in / out | I / O (or { } in the player), Ctrl+Shift+X clears | Defines a *range* in the source monitor before placing it on the timeline. Only the range is inserted. |
| Select range | X / Shift+X | Selects a time range across tracks, for range delete or range export. |
| Insert / overwrite / replace | Shift+I / Shift+O / Alt+drag | Three-point edit modes: push later clips right, write over them, or swap a clip keeping its length. |
| Delete / ripple delete / close gap | Del / Shift+Del / Alt+Del | Leave a hole, remove and pull later clips left, or remove only the hole. A gap also shows an **×** on hover. |
| Nudge | Alt+arrows | Move one frame (or one track up/down). |
| Duplicate | Ctrl+D | |
| Copy / paste effects | Ctrl+Alt+C / V | Copies only the *attributes* (effects, colour, transform), not the clip. |
| Group / ungroup | Ctrl+G / Ctrl+Alt+G | Clips move together and keep their relative offsets. |
| Colour labels | Alt+1…8 | Eight colour marks on a clip. *Select all with the same colour* (Alt+Shift+`) gives a quick ad-hoc selection set. |
| Enable / disable clip | Right-click, or the eye | The clip stays but is skipped in playback and export. |
| Compound clip | Tools → Create Compound Clip | Nests several clips as one; it can be opened (new tab), *saved as a custom compound* for reuse, or *detached* (unnested). |
| Multi-clip editing | Ctrl-select several, then edit in the property panel | One property-panel edit applies to all selected clips. Effects that are inherently per-clip (masks, tracking, stabilisation, cutout) are excluded. |
| Freeze frame | Alt+F, or right-click → Speed → Add Freeze Frame | Splits at the playhead and inserts a still of that frame (default 5 s), and the duration is editable. |
| Snapshot | Ctrl+Alt+S, the camera under the player | Saves the current frame at full resolution as an image in the bin. It can also *become the project thumbnail*. |
| Markers | M adds, Shift+M edits; Shift+↑/↓ jumps | Two kinds: **media markers** (on a source clip, travelling with it) and **timeline markers** (on the sequence). Each has a name, colour and comment. Right-click to delete one or all. |
| Multicam | Right-click → Create Multi-Camera Clip | Syncs angles by **audio waveform**, first frame or markers. During playback, clicking an angle in the preview *cuts live* to it. |

## 4.3 Speed, as a family of tools

- **Uniform speed** (Ctrl+R): one rate for the clip, plus **Reverse** and **AI frame interpolation**. Interpolation modes are frame sampling, frame blending or **optical flow**; optical flow synthesises new in-between frames, so slow motion stays smooth.
- **Segmented speed:** add *speed points*. Each segment gets its own rate (slow, normal, fast or a custom value), *Freeze* inserts a hold, and *Clear clip speed* returns to 1×.
- **Speed ramping:** ready-made curves (Montage, Hero moment, Bullet time, Jumper, Flash in/out) plus a custom curve editor. The curve is speed against time, and the clip length follows.

**Technique.** Optical-flow slow motion estimates per-pixel motion between two frames and warps both towards the midpoint. The AI version uses a learned interpolation network (the frame-interpolation model in the install). Its quality depends on motion size and occlusion.

**Lesson for OTSI.** A *Hero moment* ramp (normal → slow at the touch → normal) is the signature football highlight move. Our renderer can do this with ffmpeg `setpts` plus `minterpolate`, or with a free interpolation model (RIFE, MIT-licensed). The *freeze at the key frame + spotlight ring* is the classic scouting reel shot.

## 4.4 The magnetic main track and auto ripple

- **Magnetic main track:** clips on the main track always butt together. Moving a clip *reorders* rather than leaving gaps, and trimming pulls neighbours along. Upper tracks stay free-floating, *anchored* to their position.
- **Auto ripple** (a switch): delete and trim close gaps automatically on every track.
- With both off, the timeline behaves like a classic free-placement NLE.

**Why both exist.** Beginners make gap-free stories (magnetic). Pros want overlap and free layering. The switch lets one product serve both, which mirrors our planned **Guided / Pro** split (Phase A.7).

## 4.5 The player (preview) zone

- Play/pause (Space), frame step (← →), edit-point jumps (↑ ↓), ±1 s (Shift+← →), marker jumps, Home/End, and full screen (Alt+Enter).
- **Quality menu** (Full, ½, ¼), with an automatic lag hint.
- **Snapshot**, **mark in / mark out**, **safe-zone** and **rulers and guides** (Ctrl+P). Guides are coloured reference lines that can be added, hidden or locked.
- **Aspect switch** and **video scopes** (Parade, Waveform, Vectorscope and Histogram, in several layouts and channel modes).
- **Source and Timeline monitors.** Two independent players. The *source* plays a bin item or a library effect before use; the *timeline* plays the edit. Either can be torn off to a second screen (Dual layout).

**Lesson for OTSI.**

- **Source / Timeline dual monitor** is exactly what scouting needs: *the engine's moment* (source) on one side, *the reel being built* (timeline) on the other.
- **Edit-point jumps and moment jumps** (↑ ↓ and Shift+↑ ↓) are the keyboard spine of a fast reviewer. We should map ↑ ↓ to *next or previous engine moment*.

## 4.6 Keyboard design (the whole map, summarised)

The shortcut set is **grouped by menu**: File, Edit, Tools, View, Marker and Misc. About 100 commands are bound. The design rules visible in it:

- **Single letters for modes and marks:** V select, C razor, S audio-remix mode, I/O in/out, X range, M marker.
- **Ctrl = document operations** (save, undo, split, group). **Alt = clip tools** (freeze, stabilise, trim to playhead). **Shift = the ripple or reverse variant** (Shift+Del ripple, Shift+X clear range).
- Arrow-key navigation is layered: bare arrows step a frame or edit point, Shift steps a second or marker, Ctrl steps the selection, Alt nudges.
- **Rebinding:** an on-screen keyboard map shows bound keys. Conflicts are refused. There are presets imitating two well-known pro NLEs, and *Restore defaults*.

**Lesson.** We should publish one *coherent* map (A.9) using the same layering logic. A familiar convention (J/K/L shuttle, I/O, M, Space) lowers the learning cost for anyone who has used any editor.
