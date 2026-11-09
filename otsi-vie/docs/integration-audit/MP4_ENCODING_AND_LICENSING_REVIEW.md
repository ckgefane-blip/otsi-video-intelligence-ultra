# MP4 encoding and licensing review

**Commit:** `d3ef2f5` · 2026-10-27 · **Status:** review only. Nothing was purchased, no encoder was enabled in the product, nothing is distributed.
This is an engineering review, **not legal advice**; points marked *counsel* need a lawyer's answer before commercial MP4 export.
Evidence: `release-evidence/encoder-review/20261027/` (build configuration, benchmark script and results).

## 1. What is actually installed (inspected)
| Component | Where | Build / version | Licence facts found |
|---|---|---|---|
| FFmpeg 7.0 libraries inside **PyAV 13.1.0** wheels | `.venv\Lib\site-packages\av.libs` | libavcodec 61.3.100; configure: `--enable-gpl --enable-version3 --enable-libx264 --enable-libx265 --enable-mediafoundation --enable-libvpx --enable-libaom --enable-libdav1d --enable-libopus --disable-libopenh264 …` | Reports **"GPL version 3 or later"**. Contains libx264 and libx265 (GPL). Used today by probe, proxy (VP9/Opus) and the analysis decoder |
| Video encoders in that build | — | `libx264`, `libx265`, `h264_mf`, `hevc_mf` (Windows Media Foundation), `libvpx-vp9`, `libaom-av1`, `mpeg4`, … ; **no** `h264_qsv`/`hevc_qsv`/`av1_qsv`, **no** OpenH264, no `av1_mf` | — |
| Windows Media Foundation H.264 encoder (software) | `C:\Windows\System32\mfh264enc.dll` | 10.0.26100.9549 | Part of Windows; Microsoft's licence terms |
| **Intel Quick Sync Video H.264 Encoder MFT** (hardware) | Intel graphics driver package `iigd_dch…\mfx_mft_h264ve_64.dll` | 21.0.2.16 | Part of the Intel driver (driver licence). The same package has HEVC (`h265ve`), **AV1** (`av1ve`, `av1hve`) and VP9 (`vp9ve`) hardware encoder MFTs, plus oneVPL (`libvpl.dll`, `vpl_dispatcher_64.dll`) |
| Standalone `ffmpeg.exe` | — | none on PATH | — |

## 2. Measurements on this machine (real 1080p football, 300 frames, same frames for every encoder)
Throughput includes the Python-side frame conversion, so it is a lower bound of encoder speed. PSNR-Y against the decoded source.

| Encoder | Settings | fps | Bitrate | PSNR-Y | Profile out |
|---|---|---|---|---|---|
| libx264 (GPL) | preset medium, CRF 20 | 43.9 | 11.5 Mbit/s | 41.49 dB | High |
| libx264 (GPL) | preset veryfast, CRF 20 | 90.1 | 9.4 Mbit/s | 40.26 dB | High |
| h264_mf → Intel QSV MFT (hardware) | quality 70 | 80.6 | 14.2 Mbit/s | 41.79 dB | Constrained Baseline |
| h264_mf → Intel QSV MFT (hardware) | CBR 12 Mbit/s | 98.1 | 12.0 Mbit/s | 41.05 dB | Constrained Baseline |
| hevc_mf → Intel QSV MFT (hardware) | quality 70 | 96.2 | 10.7 Mbit/s | 41.69 dB | Main |

- **Hardware use confirmed:** while `h264_mf` encoded, Windows reported the Python process at **67 % on the Arc's media engine** (Intel exposes
  its VDBox, which encodes and decodes, as the "VideoDecode" engine type) and 22 % on 3D.
- At similar quality the hardware H.264 stream is ~20-25 % larger than x264 medium, mainly because PyAV 13 cannot select the profile and the
  MF encoder defaulted to **Constrained Baseline**. FFmpeg exposes `-profile:v high` for `h264_mf`; PyAV ≥ 14 or the FFmpeg CLI can set it —
  **not yet verified**.
- A 3-minute 1080p30 reel (5,400 frames) encodes in roughly 1 minute with either hardware or x264 veryfast; encoding is not the bottleneck
  (detection and compositing are).

## 3. Licence obligations by option
| Option | Software licence | Patent position (H.264) | Distributable in a commercial product? |
|---|---|---|---|
| **libx264** | GPL-2.0-or-later; a separate commercial licence is sold by its maintainers | Encoder patents not covered by the software licence | Not without the commercial licence (or full GPL compliance of what is distributed). SaaS-only use without distribution: *counsel* |
| **libx265** | GPL-2.0-or-later (commercial licence available) | HEVC: several pools + independent holders | Same as x264; HEVC output also has weaker browser support — not recommended |
| **FFmpeg, as bundled in PyAV today** | GPL-3.0-or-later (because of `--enable-gpl --enable-version3`) | — | **No** for distribution. Must be replaced by an LGPL build (no `--enable-gpl`, no `--enable-nonfree`), dynamically linked or run as a separate process, with its source offer |
| **FFmpeg LGPL build + Intel QSV/oneVPL** (`h264_qsv`, `hevc_qsv`, `av1_qsv`) | LGPL-2.1+ (oneVPL dispatcher is MIT) | Encoder implemented by Intel hardware/driver; whether the hardware vendor's licensing covers our commercial encoding: *counsel* | Yes for the software side |
| **Windows Media Foundation** (`h264_mf`, Microsoft or Intel MFT) via an LGPL FFmpeg | Windows / Intel driver terms | Microsoft and Intel terms for server-side commercial encoding: *counsel* | Software side yes (we ship no encoder); Windows-only |
| **OpenH264 (Cisco)** | BSD-2-Clause source | Cisco covers the patent royalties **only for its own prebuilt binary**, downloaded separately; a self-built copy is not covered | Yes, if the Cisco binary is used as Cisco requires; mainly Constrained Baseline, lower efficiency |
| **VP9 / AV1 + Opus (WebM or MP4)** | libvpx BSD-3, libaom/SVT-AV1 BSD-2/3; Intel AV1 hardware via QSV | Royalty-free licences from Google/AOMedia; third-party pool claims exist for AV1 (*counsel* for risk) | Yes; but not universally accepted where "MP4" means H.264 (older iOS devices, some social platforms, many editing tools) |

**H.264 patents (*counsel*):** H.264 is covered by patent pools (the AVC pool now administered by Via LA) and some independent holders.
The pool terms distinguish encoders/decoders and content distribution (free-to-view internet video vs paid/subscription content). Many early
patents have expired, but whether active patents remain in the owner's target countries, and whether OTSI's paid reel/export service needs
a licence, must be answered by counsel. **AAC audio** inside MP4 has its own patent licensing (also Via LA) — the same question applies.

## 4. Output compatibility
| Output | Plays on |
|---|---|
| H.264 High or Constrained Baseline, yuv420p, AAC-LC, MP4 with `moov` at the front (faststart) | Every current browser, iOS/Android, WhatsApp, Instagram, X, TikTok upload, video editors — **the universal "MP4"** |
| HEVC MP4 | Safari/Apple, Edge with HEVC extension, recent Chrome on hardware with HEVC; poor elsewhere |
| AV1 MP4/WebM | Chrome, Firefox, Edge, Android; Safari only on devices with AV1 hardware decode |
| VP9 + Opus WebM | Browsers (not older Safari); not accepted by many social uploads |

## 5. Recommended architecture (for owner approval)
1. **Encoder adapter, like the detector registry:** the render worker writes frames to an `Encoder` interface; each backend is a registry entry
   with its licence status, and the render manifest records encoder, build hash and settings. Nothing encoder-specific leaks into the compositor.
2. **Replace the GPL FFmpeg** (PyAV wheels) in all product code paths with an **LGPL FFmpeg build** we build reproducibly (no `--enable-gpl`,
   no `--enable-nonfree`), with Intel **oneVPL/QSV** and Media Foundation enabled, run as a separate process or dynamically linked.
3. **Default H.264 path: Intel hardware** — `h264_qsv` (oneVPL; Windows and Linux) or `h264_mf` (Windows), High profile, yuv420p, MP4
   faststart. On this laptop that is ~80-100 fps at 1080p. Production servers need an Intel GPU (Arc/Flex/iGPU) for this path.
4. **Software fallback without GPL:** Cisco's OpenH264 binary (Constrained Baseline) where no Intel GPU is present.
5. **Royalty-free alternative export:** VP9/Opus WebM (already used for playback copies) and AV1 (Arc hardware) as optional formats.
6. **libx264 only if the owner buys its commercial licence** — not enabled.
7. **Render validation (F45):** after every render, probe and fully decode the output; check profile/level, frame count against the timeline,
   duration, A/V sync, faststart, and store the checksum; a failed check never reaches delivery.

## 6. Decisions requested from the owner
| # | Decision | Recommended |
|---|---|---|
| E1 | Approve building and vendoring an LGPL FFmpeg (with oneVPL/QSV + Media Foundation) to replace the GPL PyAV build in product code | Yes |
| E2 | Hardware H.264 (Intel QSV/MF) as the default MP4 path, OpenH264 binary as fallback, VP9/AV1 as royalty-free options | Yes |
| E3 | Ask counsel: (a) H.264 + AAC patent licensing for paid reels/exports in the target markets; (b) Microsoft/Intel encoder terms for server use; (c) COCO-trained weights | Yes, before commercial export |
| E4 | Buy a libx264 commercial licence | Not now (not needed for the recommended path) |
| E5 | Where production rendering runs (Windows + Intel GPU, Linux + Intel GPU, or cloud) | Decide with the deployment plan (Block 15) |

## 7. Owner decisions recorded (2026-10-27) — addendum, the review above is unchanged
- **E1 approved for development:** reproducible LGPL FFmpeg, GPL PyAV removed from all intended product paths → done, see ADR-029.
- **E2 approved provisionally:** replaceable encoders (Intel hardware H.264 preferred, commercially permissible software fallback, VP9/AV1),
  each benchmarked and verified before production use → implemented and benchmarked (ADR-029); OpenH264 awaits the owner's consent to obtain
  Cisco's binary.
- **E3 approved:** legal review package → `docs/legal/review-package/LEGAL_REVIEW_PACKAGE.md`.
- Not authorised: commercial distribution, paid exports, purchases, production deployment, treating assumptions as clearance.
- **Zero-cost directive (ADR-030):** E4 (buying a libx264 commercial licence) is withdrawn; no paid licence or patent-pool purchase is an option.
- **OpenH264 tested (owner consent 2026-10-27):** works as the fallback; at 6 Mbit/s it is 2.3-3.8 dB below Intel QSV H.264 (ADR-029).
  Cisco's free patent coverage is limited to non-remunerated use — recorded for counsel (L4a).

