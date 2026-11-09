# 09 · Colour

The **Color tab** of the inspector is a pipeline of switchable stages. Their order is roughly the order a colourist works in:

| Stage | Controls | What it is |
|---|---|---|
| **Auto colour** | one click | Automatic exposure and white-balance correction |
| **LUT** | built-in or *load .cube*, **strength**, **protect skin tones**; export the current grade *as a .cube LUT*; manage LUTs under Editing Presets | A 3D look-up table (input RGB → output RGB), blended by strength |
| **Colour (white balance)** | auto, **eyedropper** (click something neutral), temperature, tint | Gains per channel |
| **Light** | exposure, brightness, contrast, highlights, shadows | Tone mapping |
| Detail and vignette | sharpen, vignette | |
| **HSL** | choose a hue band → hue, saturation, luminance | Secondary correction by hue range |
| **Curves** | Y/R/G/B curves, plus *Hue vs Sat*, *Hue vs Hue* … | Per-channel transfer curves |
| **Colour wheels** | shadows, midtones and highlights wheels; **HDR wheels** (blacks, shadows, highlights, specular) | Lift, gamma and gain (and zone-based HDR grading) |
| **AI colour palette** (colour match) | a reference frame from the **timeline** or a **local file** → Generate → *save & apply*; strength; protect skin tones | Transfers colour statistics from the reference to the clip |
| **Colour mask** (a separate tab) | grading **layers**, each with its own curves plus a mask (rectangle, circle, pen, AI) with blur, opacity and invert | Local (windowed) grading |

**Tools around the tab:**

- **Video scopes:** parade (RGB, YRGB, YCbCr), waveform, vectorscope (skin-tone line) and histogram, in single or multi layouts.
- **Before/after comparison:** side by side, or a split left/right or top/bottom (View menu or the colour-match icon).
- **The Color-grading workspace layout** gives the colour tab and scopes more room.
- **Save as custom** stores the whole tab as a preset. **Reset** clears it. Parameters can be keyframed.
- Project **colour space** (Rec.709 SDR, Rec.2100 HLG/PQ) and **high-precision processing** in project settings.

**Technique notes:**

- Each stage is a GPU shader. The ordered stack is applied per pixel, in a linear or log working space at high precision.
- *Protect skin tones* = a skin-probability mask (from a segmentation model) that limits how far the LUT moves skin pixels.
- *Colour match* = matching the mean and variance (or a learned palette) of the reference in a perceptual colour space such as Lab.

## Lessons for OTSI

1. **Match-to-reference is the useful colour tool for football.** Broadcast feeds, phone footage and drone clips of the *same* match look different. *AI colour palette* (pick one good frame, then match every clip to it) gives a reel one look in one click. The free technique is Reinhard Lab statistics transfer, a few lines of numpy or an ffmpeg `lut3d` from a generated cube.
2. **Grade by look preset + strength**, not by a slider wall. Our *templates (looks)* should be `.cube` LUTs with a strength slider. ffmpeg's `lut3d` is free and exact.
3. **A before/after split** in the preview is the cheapest way to make any look or enhancement *trustworthy* to a non-expert.
4. **The pitch is a colour mask.** Football footage benefits from a *grass-only* saturation and contrast lift (a hue-range mask on green). It is a "pro look" that costs one HSL stage.
5. Scopes and HDR wheels are expert tools. Leave them out of Guided mode.
