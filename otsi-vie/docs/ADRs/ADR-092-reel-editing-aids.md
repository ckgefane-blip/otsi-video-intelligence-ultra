# ADR-092: Reel Builder timeline zoom and list, spotlight presets, music licence note (v3 Phase B.16)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
With dozens of clips the timeline's blocks were too small to read or hit; there was no list of the clips; every spotlight look started
from sliders; the music picker showed who holds the rights but not what the declared right still requires when publishing.

## Decision
- **Timeline zoom** (− / + at the ruler's right end; 1×, 2×, 4×, 8×, 16×): the lanes show a window of the reel, the ruler shows that
  window's times and a thin blue bar shows where the window is; the mouse wheel over the lanes pans it; zooming centres on the selected
  clip and a newly selected clip is scrolled into view. Drag and drop works the same at any zoom. Not remembered between visits.
- **List view** (☰): the clips as rows (number, label, source in–out, length on screen, speed effect); a click selects as in the lanes,
  and the clip editor (trim, move, remove) works the same. The clip editor box is narrower (560) to leave room for the controls.
- **Spotlight presets** (`contracts/reel-editing.ts`): Subtle, Standard (= the defaults), Strong, Cinematic, in a select beside Reset All;
  they set intensity, width, vignette and glow (Target Lock is about following, so it is left). Any slider change shows "Custom".
  Organization templates of looks stay for Phase C.10.
- **Music licence note**: under each usable music in the picker, what the declared basis still asks: own music none; licensed, check the
  licence covers where and how long; free licence, credit the author where published; permission, keep it on file. Music still comes only
  from the organization's brand assets with a rights declaration (ADR-047).

## Tests
- `apps/web/test/reelEditing.test.ts`: Standard equals the defaults, every preset is within the slider ranges and is recognised, a moved
  slider is Custom; the licence notes; the zoom window stays inside the reel.
- Web suite 177 passed; type check clean. Browser (owner's reel, view only): 58 clips, 4× shows 15 readable clips (03:46–05:33) with the
  window bar; the list shows 58 rows; the owner's saved look shows "Custom". The organization has no music uploaded, so the note was not
  seen on screen (unit test only); nothing was uploaded or changed.
