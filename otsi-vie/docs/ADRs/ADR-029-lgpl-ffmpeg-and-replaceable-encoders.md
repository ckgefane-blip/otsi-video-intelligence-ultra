# ADR-029: LGPL FFmpeg in separate processes; replaceable, validated encoders

Status: accepted for **development and local testing** (owner decisions 2026-10-27: E1 approved for development, E2 approved provisionally,
E3 legal package approved). Not legally reviewed, not commercially approved, not deployed.

## Context
PyAV's wheels bundle FFmpeg built with `--enable-gpl --enable-version3 --enable-libx264 --enable-libx265` (GPL-3.0-or-later). The worker
used them for probing, decoding, the playback copy and thumbnails. That build cannot be part of a proprietary product
(`MP4_ENCODING_AND_LICENSING_REVIEW.md`).

## Decision
1. **Own LGPL FFmpeg build** (`tools/ffmpeg/`): FFmpeg 7.1.1 cross-compiled for Windows x64 with mingw-w64 in Docker; base image pinned by
   digest; every source archive pinned by SHA-256 (`sources.lock.json`) and archived in `.local/ffmpeg-src/` (the corresponding source).
   Components: Intel oneVPL (MIT; QSV encode/decode), Media Foundation, D3D11VA/DXVA2, libvpx, dav1d, SVT-AV1, Opus, zlib, native
   AAC/MJPEG and decoders. No `--enable-gpl`, `--enable-nonfree`, `--enable-version3`; the build fails if one appears and checks that every
   imported DLL is shipped or is a Windows system DLL. Result: `.local/ffmpeg-lgpl/<build id>/` + `BUILD_MANIFEST.json` (configure lines,
   SHA-256 of every binary). Current: `ffmpeg-7.1.1-lgpl-202610270133`.
2. **Separate processes only** (`vie_worker/ff.py`): probe = `ffprobe` JSON; decoding = `ffmpeg` → raw RGB pipe; thumbnail and playback
   copy = `ffmpeg`. Nothing links FFmpeg into Python. `ff.tool()` refuses any FFmpeg whose `-L`/`-buildconf` reports GPL or nonfree
   (override only for developers: `OTSI_VIE_ALLOW_GPL_FFMPEG=1`). A test fails if any worker module imports PyAV.
3. **Frame-exact decoding preserved:** filter chain `showinfo, select, showinfo` with `-copyts` pairs every yielded frame with its source
   display index and raw presentation time; measured against the previous PyAV path on three real clips (30 fps Theora, 29.97 fps AV1 with
   an audio-first start, 60 fps 4K VP9): **identical frame indices and timestamps (0 µs difference), identical pixels at 1080p**; 4K→1080p
   downscaling now uses area filtering (mean pixel difference 2.4/255 vs the old bilinear). Speed: 9.7 s vs 8.7 s for 20 s of 4K60
   (showinfo checksums disabled).
4. **Replaceable encoders** (`vie_worker/render/encoders.py`): registry of backends, each with family, FFmpeg tree, container, hardware,
   licence note; `available()` proves a backend with a real test encode; `choose()` picks the first available in preference order;
   `encode()` takes RGB frames (BT.709 conversion, tagged BT.709), MP4 with faststart or WebM.
   - H.264: `intel-qsv-h264` (oneVPL) → `mf-h264` (Media Foundation; Intel MFT or Microsoft) → `openh264` (separate minimal FFmpeg tree;
     runs only with **Cisco's binary**, installed by `install_cisco_openh264.py` (owner consent 2026-10-27; installed and verified).
   - AV1: `intel-qsv-av1`, `svt-av1`. VP9: `libvpx-vp9`.
5. **Render validation** (`vie_worker/render/validate.py`): codec, profile, 4:2:0 8-bit, size, exact decoded frame count, duration, audio,
   MP4 faststart, full decode with errors fatal. Tested to reject a wrong frame count, a missing faststart and a damaged file.

## Measurements (`release-evidence/encoder-benchmark/20261027/`; 10 s of real 1080p football; the same decoded frames for every encoder)
**Equal bitrate, 6 Mbit/s target** (the fair comparison; `bitrate6M/`). CPU = encoder process CPU time / wall time, in cores (machine: 22 logical
cores); it includes FFmpeg's RGB→YUV conversion, which runs on the CPU for every backend.

| Backend | France–Germany (wide, 30 fps) | Naples (29.97 fps) | Profile | Validated | Plays in desktop Chromium |
|---|---|---|---|---|---|
| intel-qsv-h264 | 137 fps · 1.8 cores · 6.07 Mbit/s · PSNR-Y 39.5 dB · SSIM 0.982 | 119 fps · 1.6 cores · 47.7 dB · 0.994 | High | yes | yes |
| mf-h264 | 148 fps · 2.0 cores · 6.11 Mbit/s · 39.0 dB · 0.979 | 151 fps · 2.3 cores · 46.7 dB · 0.992 | High | yes | yes |
| **openh264** (Cisco binary) | 110 fps · 2.1 cores · 5.99 Mbit/s · 37.2 dB · 0.970 | 135 fps · 3.0 cores · 43.9 dB · 0.987 | Constrained Baseline | yes | yes |
| intel-qsv-av1 | 140 fps · 2.1 cores · 5.93 Mbit/s · 39.6 dB · 0.983 | 128 fps · 2.0 cores · 48.3 dB · 0.994 | Main | yes | yes |
| svt-av1 | 59 fps · 11.4 cores · 4.81 Mbit/s · 39.9 dB · 0.985 | 58 fps · 10.8 cores · 48.3 dB · 0.995 | Main | yes | yes |
| libvpx-vp9 | 23 fps · 10.5 cores · 6.37 Mbit/s · 38.9 dB · 0.981 | 26 fps · 9.5 cores · 47.9 dB · 0.994 | Profile 0 | yes | yes |

Quality-setting runs (`quality70/`) are kept for reference; each encoder maps a quality level to its own rate control, so they are not an
equal-bitrate comparison (OpenH264 settled at ~2 Mbit/s there).

**Playback compatibility:** every file plays (1920×1080, frames presented, 0 dropped) in a desktop Chromium 152 build with platform
decoders (`playback_desktop_chromium.json`). Playwright's open-source Chromium plays AV1 and VP9 but has no H.264 decoder
(`playback_playwright_chromium.json`) — a property of that browser build, not of the files. Microsoft Edge could not be automated here
(it exits at once when launched by Playwright alongside the running Edge); not tested.

**Reading:** Intel QSV H.264 is the best H.264 path on this machine (highest quality per bit, lowest CPU, High profile) — it stays the
preferred configuration. OpenH264 works as the no-hardware fallback: 2.3-3.8 dB lower PSNR than Intel QSV H.264 at the same bitrate (Baseline profile only),
still real-time on this CPU. AV1 (QSV) matches or beats H.264 per bit; SVT-AV1/VP9 are CPU-heavy software alternatives.

## Status (kept separate on purpose)
| Item | Implemented | Tested | Legally reviewed | Commercially approved |
|---|---|---|---|---|
| LGPL FFmpeg build + separate-process media path | yes | yes (worker suite incl. real footage, parity check) | no | no |
| intel-qsv-h264, mf-h264, intel-qsv-av1, svt-av1, libvpx-vp9 | yes | yes (above + test_render.py) | no | no |
| openh264 (Cisco binary 2.5.0, MD5 matches Cisco's published value, Authenticode valid: Cisco) | yes | yes (above + test_render.py) | no | no |
| Render validator | yes | yes | n/a | n/a |

## Consequences
- PyAV stays installed only for one developer measurement tool (`tools/models/sampling_study.py`); it is not a product dependency.
- Production servers without Intel graphics have no QSV/MF hardware path: OpenH264 (Cisco binary), AV1/VP9 software, or another
  hardware encoder added as a new backend after its own licence review (deployment decision E5).
- The compositor (Block 11) only calls `encoders.encode()` and `validate()`.
