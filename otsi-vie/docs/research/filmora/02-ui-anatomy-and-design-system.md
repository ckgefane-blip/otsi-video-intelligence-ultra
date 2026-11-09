# 02 · UI anatomy and design system

This chapter is from hands-on use of the installed app (no login, a test clip only) and the guide's descriptions of panels and layouts.
It describes **design principles**. It copies no artwork, icons, colours or wording.

## 2.1 Screen map

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Menu: File Edit Tools View Extended Help │  Project name  │ Save ☁ Login [Export ▾] │
├──────────────────────────┬────────────────────────────┬──────────────────┤
│ RESOURCE PANEL           │ PLAYER                     │ PROPERTY PANEL   │
│ category tabs ──────────▶│ [Timeline|Source] quality ▾│ (inspector)      │
│ tree │ grid of tiles     │                            │ tabs by media    │
│      │ (hover-preview,   │        the picture         │ sections with    │
│      │  +, ★, download)  │                            │ ☐ enable ▸ fold ◆ key│
│ search · view · sort     │ ⏮ ▶ ⏹ { } 📷 🔊 ⛶  TC      │ Reset · Save custom│
├──────────────────────────┴────────────────────────────┴──────────────────┤
│ TIMELINE TOOLBAR  select▾ ↶ ↷ 🗑 ✂ crop T draw speed … AI ◇marker 🎙 render  zoom ─○─ fit│
│ render strip ███████░░░░ (red = needs render, green = cached)            │
│ ruler 00:00 ──────────▼ playhead (with ✂)                                 │
│ track headers  │ V3  ▭▭    title                                           │
│ 👁 🔒 🔊 magnet │ V2     ▭▭▭  overlay                                        │
│ ripple · tracks│ V1 ▭▭▭▭▭▭▭▭▭▭▭ main (magnetic)                             │
│                │ A1 ≈≈≈≈≈≈≈≈≈ music                     │ meter L▮ R▮       │
└──────────────────────────────────────────────────────────────────────────┘
```

**Four permanent zones**: resource, player, inspector and timeline. **Saved layouts** rearrange them for a task:

| Layout | Bias |
|---|---|
| Default | balanced |
| Organize | media panel big |
| Edit | timeline and player big |
| Short video | vertical player |
| Classic | older arrangement |
| Dual | source and timeline players side by side, or on two monitors |
| Timeline | timeline-dominant |
| Colour grading | inspector colour tab and scopes |
| Audio mixing | audio sections and meters |

Panels can be resized by dragging their borders and **torn off** (for example the player onto a second screen).

## 2.2 The home (start) screen

- **Aspect ratio first** (16:9, 9:16, 1:1, 4:3, 4:5, 21:9, 3:4), then **Create project**. Format is the one decision made before editing.
- A **quick-tool row**: shortcuts into the most-used one-shot tools.
- A **recent projects** grid (thumbnail or list view, search).
- Left navigation:
  - Create project, Cloud, Creator Hub (tutorials), **Toolbox** (about 40 tool tiles grouped by job: cutting, framing, image, audio, text, generation, utility);
  - the account area with AI credits.
- **Short video project** is a separate entry with a vertical workspace (reframe or scene cut first).

**Principle.** The home screen is a *router by intent*: "what do you want to make?" It is not a file manager. Every Toolbox tile is a focused mini-workflow that ends in the editor or in an export.

## 2.3 Interaction grammar (the rules that make it feel mature)

1. **Selection drives every panel.** Click a clip and the inspector, player and media info follow it. Click empty timeline and the inspector shows *Project info* (resolution, fps, colour space, sample rate, duration) and *Media info*.
2. **Every command three ways**: toolbar icon, menu item (with its shortcut shown), and clip right-click. Discoverability for beginners, speed for experts.
3. **Direct manipulation in the player** for anything spatial: transform handles, crop frames, mask shapes, tracker boxes, light orbs, motion paths, guides. The inspector mirrors the numbers.
4. **Uniform section anatomy** in the inspector: *☐ enable · ▸ fold · ◆ keyframe · ⟲ reset*, plus a tab-level *Save as custom*. Learn it once and it works for every effect.
5. **One asset-browser component** for every library (08 §8.3): tree with "Mine" first, grid, hover preview, + / ★ / download, drag.
6. **Drag is universal.** Media → timeline, effect → clip, effect → track, template → timeline, transition → cut, clip → template slot.
7. **Honest state indicators:**
   - the red/green render strip;
   - a proxy badge on thumbnails;
   - a "used" tick on media tiles;
   - a beat icon on analysed music;
   - a "generating…" placeholder clip;
   - an AI-content label;
   - greyed-out options *with the reason* (HDR needs GPU acceleration);
   - lag detection that suggests lower preview quality.
8. **Background tasks with a task list.** Long AI jobs, renders and uploads go to a task centre. The user keeps editing and is notified on completion.
9. **Wizards end in "Edit in timeline".** Every automatic tool hands back an ordinary, editable result.
10. **Defaults that "just work", depth on demand.** One switch plus one strength slider; detail controls hidden under a fold; expert tools (scopes, graph editor, the third-party tracker) in their own windows.
11. **Coach and help built in:**
    - hover tooltips naming the shortcut;
    - an empty-state drop zone with two "make something" shortcuts;
    - Creator Hub tutorials;
    - an AI assistant *Guide mode* that walks the user through the actual UI.
12. **Keyboard map as a first-class screen:**
    - an on-screen keyboard showing bound keys;
    - search by command or by key;
    - categories;
    - rebinding with conflict refusal;
    - presets imitating other NLEs;
    - restore defaults.

## 2.4 Visual design system (principles observed)

- **Dark-first, light optional.** A dark neutral theme is the default; a light theme exists. Both are resource packs at 1× and 2× (see 01 §1.2), so the look is themable tokens, not hard-coded.
- **Elevation by lightness.** About 3–4 neutral grey steps separate the background, panel, raised control and hover. There are almost no borders: separation comes from tone and spacing.
- **One accent colour** marks the primary action (Export), selection, active tab and toggles. Everything else stays neutral, so the eye goes to the accent. Status uses its own reserved hues: render red/green, warning amber, premium/AI badges.
- **Clip colour by type** on the timeline. Video, audio, titles, effects and transitions each have a distinct hue, so a timeline reads at a glance. User colour labels (8 colours) override this when set.
- **Thumbnail-heavy browsing.** Asset tiles are animated previews, not names. A label sits under or over the tile, and small corner badges show duration, premium, downloaded and used.
- **Compact, dense controls.** Small type (about 12–13 px), compact sliders with numeric fields, and icon buttons with tooltips. It is a pro-tool density softened by large thumbnails.
- **Consistent iconography.** One line-icon family. The same icon means the same command everywhere (scissors = split, diamond = keyframe, eye = enable).
- **Motion used sparingly**: hover previews, panel folds and progress. The UI itself doesn't animate for decoration.

## 2.5 Lessons for OTSI's UI

Our approved designs already follow most of the static rules (four zones, dark theme, one accent). What to *adopt in behaviour*:

1. **Selection-driven inspector** in Clip Studio: reel settings when nothing is selected, clip settings when a clip is.
2. **Uniform section anatomy** (enable · fold · key · reset · save as preset) for spotlight, ring, name strap, speed, zoom and look.
3. **Honest state indicators** extended to our domain:
   - preview vs rendered;
   - evidence level (badge, ADR-063);
   - identity confirmed or not;
   - rights cleared or not;
   - "used in reel" ticks on moments.
4. **Task-based layouts** (Analyse · Edit · Review): a cheap, high-impact change that fits our Guided/Pro plan (A.7).
5. **Every command three ways**, with the shortcut shown in tooltips and menus (A.9).
6. **Wizard → "Edit in Clip Studio"** for every automatic reel feature.
