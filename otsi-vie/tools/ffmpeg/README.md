# LGPL FFmpeg build (ADR-029)

The product's only FFmpeg. Built reproducibly in Docker (mingw-w64 cross-compile for Windows x64), installed under
`.local/ffmpeg-lgpl/<build id>/` and found by the worker through `.local/ffmpeg-lgpl/current.txt` (or `OTSI_VIE_FFMPEG_DIR`).

```
.venv\Scripts\python.exe otsi-vie\tools\ffmpeg\build_ffmpeg.py
```

| File | Purpose |
|---|---|
| `sources.lock.json` | exact source versions, URLs and SHA-256 (recorded once with `--lock`; every build verifies them) |
| `Dockerfile` | build image, base image pinned by digest |
| `build.sh` | dependency builds + two FFmpeg configure/make runs + licence check (fails on any GPL/nonfree/version3 flag) |
| `build_ffmpeg.py` | fetch + verify sources (archived in `.local/ffmpeg-src/` = the corresponding source), run the build, install, write `BUILD_MANIFEST.json` |
| `install_cisco_openh264.py` | **only with the owner's consent**: installs Cisco's OpenH264 binary for the OpenH264 tree |

Trees:
- `main/` — FFmpeg 7.1.1 LGPL-2.1+ with Intel oneVPL (QSV encode/decode), Media Foundation, D3D11VA/DXVA2, libvpx, dav1d, SVT-AV1, Opus,
  native AAC/MJPEG/PNG/H.264-HEVC decoders. Used by probe, frame decoding, proxy and the encoder backends.
- `openh264/` — minimal FFmpeg that only encodes H.264 with OpenH264 (raw video in, MP4 out). Needs `libopenh264.dll` = **Cisco's binary**
  (never a self-built one, never committed or bundled). Separate so that a missing DLL cannot break the main tree.

Licence: no `--enable-gpl`, `--enable-nonfree` or `--enable-version3`; the worker additionally refuses any FFmpeg whose `-L` or `-buildconf`
reports GPL/nonfree (`vie_worker/ff.py`, test `tests/test_media_licensing.py`). Status: technically implemented and tested; **not legally
reviewed, not commercially approved** (`docs/legal/review-package/LEGAL_REVIEW_PACKAGE.md`).
