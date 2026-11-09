# Verification results

Renderer: Google Chrome 155.0.8059.84 headless, 2560 × 1440, deviceScaleFactor 1, Windows Segoe UI. Harness: `tools/verify.js` (DOM geometry + computed styles, original vs corrected).

| page | JS errors | 10 nav items | overlap / overflow / clipping / occlusion findings | mock-name / mark / file hits | DOM elements orig → corrected | pixel change vs unmodified (same environment) | header band change | contract PNG vs our render of UNMODIFIED HTML |
|---|---|---|---|---|---|---|---|---|
| 01 | 0 | yes | 0 | 0 | 487 → 481 | 1.39 % | 0.0 % | 6.064 % |
| 02 | 0 | yes | 0 | 0 | 533 → 495 | 2.155 % | 0.0 % | 4.934 % |
| 03 | 0 | yes | 0 | 0 | 345 → 212 | 5.003 % | 0.0 % | 5.591 % |
| 04 | 0 | yes | 0 | 0 | 631 → 285 | 8.728 % | 0.0 % | 3.719 % |
| 05 | 0 | yes | 0 | 0 | 435 → 357 | 6.059 % | 0.0 % | 5.0 % |
| 06 | 0 | yes | 0 | 0 | 585 → 380 | 4.525 % | 0.0 % | 3.873 % |
| 07 | 0 | yes | 0 | 0 | 1150 → 384 | 22.455 % | 0.0 % | 3.382 % |
| 08 | 0 | yes | 0 | 0 | 657 → 412 | 6.974 % | 0.0 % | 5.2 % |
| 09 | 0 | yes | 0 | 0 | 761 → 393 | 9.139 % | 0.0 % | 5.506 % |
| 10 | 0 | yes | 0 | 0 | 552 → 439 | 6.514 % | 0.0 % | 5.351 % |

**Notes**
- The same harness run on the original files found 65 overlap/overflow/clipping/occlusion items (01: 5, 02: 11, 03: 2, 04: 5, 05: 5, 06: 3, 07: 9, 08: 2, 09: 15, 10: 8); see `verification/baseline.json`.
- Page 01 has one excluded item: "Professional Football" over "Video Intelligence" is an intersection of the two 80 px headline line boxes. There is no glyph collision, and it is unchanged from the approved design.
- **Numeric text:** "TS" / "MPEG-TS" on page 02 are format names, not data. Every remaining numeric string was reviewed and allowed: format codecs, the "50 GB" limit, setting defaults (slider %, 60 fps), legend buckets, zero timecodes, the 0–90 match axis, "/ 10" and "0/300".
- **Geometry preserved:** every panel, the header, navigation, controls, tables, lanes, legends and chart frames keep their position and size. Only these structural elements of 20 000 px² or more changed:
  - **03:** the Output Summary panel was widened 291→839 px so it contains its own cards (a defect fix), and detection boxes were removed.
  - **04 and 09:** the fictional "selected row" highlight was removed.
  - **06 and 10:** the wizard current-step band moved to step 1. In 06 the selected-moment frame was also removed.
  - **07:** fictional clips and media were removed, and eight empty lane guides were added (one per track).
  - **08:** heat blobs were removed.
  - **10:** the chapter selection and queue rows were removed.
  - Full list: `verification/verification.json` (`structural.removed` / `structural.added`).
- **Pixel comparison:**
  - The contract screenshots were captured in a different rendering environment. Even the UNMODIFIED HTML differs from them by 3.4–6.1 % of pixels, all from text anti-aliasing and font rasterisation.
  - Changes were therefore measured in one environment, unmodified versus corrected. The header band is 0.0 % changed on every page, and all other change lies in the corrected data regions.
  - This is **not** a claim of pixel-perfect identity with the contract PNGs: content was deliberately removed, and the environment difference above remains.
- **Visual review:** a review of all ten screenshots also caught defects the geometry checks cannot see. These were chip labels truncated by count badges (04), tab count chips covering labels (09), a label touching its button edge (08), stray dots on empty ring gauges (03, 08), and "Auto Chapters" touching its toggle (10). All were fixed.
- **Not verified:** rendering with fonts other than Segoe UI, other browsers, and device pixel ratios other than 1.