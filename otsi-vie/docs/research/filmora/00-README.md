# Filmora 16: a scholarly study of the technology, UI, features and functions

**Date:** 2026-11-06. **Subject:** Wondershare Filmora 16 for Windows (installed build 16.0.12).
**Requested by the owner:** "study the technology/UI, features and functions … we are not thieves but scholars."

## Method and ethics

- **Hands-on use** as an ordinary user: no login, a test clip only, nothing exported, closed without saving.
- **The public user guide.** 171 pages, read in full. Every chapter here is written **in our own words**; nothing is reproduced.
- **The install folder.** We looked only at the *names* of files and folders, the way anyone can in Explorer, to infer the architecture.
- **Not done:**
  - No decompiling, disassembly or unpacking.
  - No reading of the vendor's code, stylesheets or resource packs.
  - No copying of design, icons, assets or text.
  - No sign-in to vendor accounts.
- Statements about internals are **inferences**, marked as such.

## Chapters

| # | Chapter | What it answers |
|---|---|---|
| 01 | [Technology](01-technology.md) | How it is built: UI toolkit, editing core, media engine, effects host, about 80 small AI models, services |
| 02 | [UI anatomy and design system](02-ui-anatomy-and-design-system.md) | Screen map, layouts, home screen, interaction grammar, visual principles |
| 03 | [Projects, media, import](03-projects-media-import.md) | Project model, relink and archive, import routes, media panel, smart bins |
| 04 | [Timeline and editing](04-timeline-and-editing.md) | Timeline anatomy, the editing vocabulary, speed, magnetic/ripple, player, keyboard design |
| 05 | [Clip properties, compositing, tracking](05-clip-properties-compositing-tracking.md) | Inspector, transform, blend, keyframes, masks, three kinds of tracking, corrective tools, reframing |
| 06 | [AI features](06-ai-features.md) | Four kinds of AI (analyse, transform, assemble, generate), UX patterns, techniques |
| 07 | [Audio](07-audio.md) | Audio model, mixing, loudness, ducking, audio-driven video |
| 08 | [Text, assets, effects, templates](08-text-assets-effects.md) | Titles, captions, the uniform asset browser, effects, transitions, templates |
| 09 | [Colour](09-colour.md) | The colour pipeline, scopes, match, masks |
| 10 | [Export, delivery, cloud](10-export-delivery-cloud.md) | Export window, partial exports, sharing and review, licence gating |
| 11 | [Lessons and roadmap for OTSI](11-lessons-and-roadmap-for-otsi.md) | The ten ideas, where we lead, gap table, recommended build order, owner decisions |

Each chapter ends with **Lessons for OTSI**. Chapter 11 brings them together.

## One-paragraph conclusion

Filmora's maturity does not come from any single clever algorithm. It comes from a strict editing core (a non-destructive edit list, a command stack, and views driven by one selection), and from a fast, *honest* preview: proxies and a render cache with a red/green indicator. On top of that sit three things:

- **Effects as uniform, switchable, keyframable inspector sections.**
- **A fleet of small local AI models** whose results are cached and browsable.
- **Automatic tools that always hand back an editable timeline.**

OTSI already leads on what Filmora cannot do: identity-aware tracking, football events, evidence levels and rights. What we lack is the editor maturity around them, above all **a live preview of the spotlight and graphics**, edge trimming, highlight grammar (freeze, slow motion, name strap) and a player-following vertical reframe. All of it can be built with free, local tools.
