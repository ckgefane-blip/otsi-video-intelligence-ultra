# Legal review package — OTSI VIE v2 (owner decision E3, 2026-10-27)

**Prepared by:** the development team, for independent counsel. **This document is not legal advice and states no legal conclusions.**
Every statement below is either a *fact we measured or read* (with its source) or a *question for counsel*. Until counsel answers and the
owner approves, nothing here counts as clearance: the status of every item is **technically implemented / tested — NOT legally reviewed —
NOT commercially approved.**

Repository state: branch `main`, local only (never pushed or deployed). Engineering decisions: ADR-024 (detector), ADR-026 (GPU), ADR-027
(link import), ADR-029 (LGPL FFmpeg and encoders). Licence register: `docs/legal/LICENSE_REGISTER.md`; generated dependency inventory:
`docs/legal/DEPENDENCY_LICENSES.md`.

## 0. Information the owner must supply before counsel can answer
| # | Needed | Why |
|---|---|---|
| O1 | **Target markets** (countries/regions where customers and end viewers are, and where servers run) | Patent coverage is territorial; privacy law (biometric data, minors) differs by jurisdiction |
| O2 | **Delivery model**: hosted service only (customers use the web app; we render on our servers) or also software installed by customers (desktop/on-premise) | Copyleft obligations (LGPL/GPL) attach to *distribution* of software; hosted use differs |
| O3 | **Business model of exports**: paid per reel/export, subscription, free tier; do exported MP4 files go to the public (social media) or private recipients | AVC/AAC pool terms distinguish encoders vs content and free vs paid content |
| O4 | Expected volumes (renders/year, units if installed software) | Pool royalty caps and thresholds |
| O5 | Who the customers are (clubs, agents, scouts, players; minors involved) | Rights to footage, image rights, consent |

## 1. Video encoding and decoding
### 1.1 Facts
- The product's media processing now runs only through an **FFmpeg 7.1.1 build we compile ourselves** (`tools/ffmpeg/`, reproducible:
  pinned sources with SHA-256, pinned build image). Configure flags contain **no `--enable-gpl`, `--enable-nonfree` or `--enable-version3`**;
  FFmpeg reports itself as *LGPL version 2.1 or later*. It is run as **separate processes** (`ffmpeg`, `ffprobe`), not linked into our code.
  The worker refuses to run with a GPL or nonfree build (automated test).
- Components inside that build: FFmpeg (LGPL-2.1+), Intel oneVPL dispatcher (MIT), libvpx (BSD-3), dav1d (BSD-2), Opus (BSD-3),
  SVT-AV1 (BSD-3-Clause-Clear + AOMedia Patent License 1.0), zlib (zlib), mingw-w64 winpthreads (MIT/BSD), and the GCC runtime
  libraries libstdc++/libgcc (GPL-3.0 WITH GCC Runtime Library Exception 3.1). Build `ffmpeg-7.1.1-lgpl-202610270133`; its
  `BUILD_MANIFEST.json` lists configure lines and the SHA-256 of every binary. Windows Media Foundation and
  Direct3D 11 video APIs are operating-system components, called at run time.
- The previously used PyAV wheels contain a **GPL-3.0** FFmpeg with libx264/libx265. They are no longer used by the product's worker code
  (automated check); they remain installed for two developer measurement tools only and are not part of any product.
- **H.264 encoding options implemented** (all optional backends behind one interface, none enabled for paid export):
  1. Intel Quick Sync hardware encoder through oneVPL (`h264_qsv`) or Windows Media Foundation (`h264_mf`, which uses Intel's
     "Quick Sync Video H.264 Encoder MFT" from the Intel graphics driver, or Microsoft's own encoder when no Intel GPU is present).
  2. Cisco OpenH264 (`libopenh264`), in a separate minimal FFmpeg tree, using **only Cisco's prebuilt binary** (Cisco states it covers
     the AVC patent royalties for its binary; a self-built OpenH264 is not covered). Installed 2026-10-27 for local testing (owner consent):
     MD5 matches Cisco's published value, Authenticode signature valid (Cisco), version 2.5.0.2411. Its licence limits patent coverage to
     non-remunerated use (L4a).
- **Royalty-free alternatives implemented:** VP9 (libvpx) in WebM; AV1 (SVT-AV1 software, Intel QSV hardware).
- **Audio:** MP4 output uses FFmpeg's native **AAC** encoder (LGPL); WebM uses **Opus** (BSD).
- **Decoding:** customers' uploads are decoded with FFmpeg's native decoders (H.264, HEVC, MPEG-2/4, …) and dav1d/libvpx; hardware decode
  (D3D11VA/DXVA2) is available in the build.

### 1.2 Questions for counsel
| # | Question |
|---|---|
| L1 | For the delivery model in O2 and markets in O1: does producing and delivering **H.264 MP4 files** (for paid reels/exports, O3) require a licence from the AVC patent pool (Via LA) or independent licensors, and on what terms (encoder vs content; free-to-view vs paid; caps)? |
| L2 | Does using an encoder **implemented in Intel's hardware/driver** (Quick Sync) or **Microsoft's Windows** encoder change the answer to L1 (i.e. is our use covered by Intel's/Microsoft's own licences, or are we the licensee as the service provider)? |
| L3 | Intel graphics driver licence and Microsoft Windows licence: do they permit **commercial server-side encoding for third parties** (render-as-a-service)? Any restriction for Windows Server or virtualised GPUs? |
| L4a | Cisco's BINARY_LICENSE.txt grants its AVC patent coverage only "FOR THE PERSONAL USE OF A CONSUMER OR OTHER USES IN WHICH IT DOES NOT RECEIVE REMUNERATION" and says content providers may need a separate licence. Does a paid reel/export service therefore fall outside Cisco's coverage (so OpenH264 is free software-wise but not patent-cleared for paid use)? |
| L4 | Cisco OpenH264 binary: do its licence and Cisco's patent coverage apply to **server-side encoding for customers**, given each installation downloads the binary from Cisco? Are there conditions (e.g. user download, no bundling) we must implement? |
| L5 | **AAC**: does encoding/delivering AAC audio in MP4 require an AAC patent licence (Via LA AAC) for our model? Is using Opus in MP4/WebM instead an acceptable risk reduction? |
| L6 | **Decoding** uploaded H.264/HEVC/AAC files on our servers: any patent licence needed for decoding as part of the service? |
| L7 | **AV1/VP9**: given the AOMedia and WebM patent licences and third-party pool claims (e.g. Sisvel's announced AV1/VP9 programmes), what is the risk of offering AV1/VP9 exports? |
| L8 | **LGPL-2.1 compliance** for FFmpeg as we use it: (a) hosted only; (b) if installed by customers — confirm our plan suffices: ship as separate DLLs/executables, provide the exact corresponding source (we archive all source tarballs + build scripts), licence texts, allow replacement/relinking, no contractual prohibition of reverse engineering for that purpose. |
| L9b | The GCC Runtime Library Exception for libstdc++/libgcc shipped next to FFmpeg: confirm it permits distribution with our proprietary software (our reading: that is its purpose). |
| L9 | SVT-AV1's **BSD-3-Clause-Clear** (no patent grant in the copyright licence) together with the **AOMedia Patent License 1.0** (defensive termination): any concern for a commercial service? |

## 2. Computer-vision models and data
### 2.1 Facts
- Detector: **RT-DETRv2-R18** (`PekingU/rtdetr_v2_r18vd`, revision `5650961…`, weights SHA-256 `d18309d0…7115`), code and weights
  declared **Apache-2.0** by the publishers; trained on **COCO 2017** (annotations CC BY 4.0; images are Flickr photos under their owners'
  licences, some non-commercial). Runtime: Intel OpenVINO (Apache-2.0), PyTorch (BSD-3), Hugging Face transformers (Apache-2.0).
- No Ultralytics/AGPL model, no Objects365-trained weights, no SoccerNet data are used (owner decision 2026-10-26).
- Evaluation footage: three Wikimedia Commons clips (public domain, CC BY 3.0, CC BY-SA 4.0) used only for local evaluation, not training,
  not shipped (`.local/eval-footage/SOURCES.json`).
### 2.2 Questions
| # | Question |
|---|---|
| L10 | May Apache-2.0 weights trained on COCO images be used in a **commercial** service, given some COCO images carry non-commercial licences? If not, is fine-tuning/retraining on owner-licensed footage a sufficient remedy? |
| L11 | Apache-2.0 obligations for weights and code used in a hosted service vs distributed software (NOTICE files, attribution in the product). |
| L12 | Using CC BY / CC BY-SA evaluation footage internally (no distribution): any obligation (e.g. share-alike) triggered by publishing benchmark numbers or screenshots? |

## 3. Footage, players and privacy
| # | Question |
|---|---|
| L13 | Customers upload match footage: what **rights warranty** must they give (broadcast rights, league/club rights), and what must the platform do on takedown? |
| L14 | Tracking identifiable players and confirming their identity (permanent OTSI Player ID): is this **biometric/special-category** processing in O1 jurisdictions (e.g. GDPR Art. 9 if face/appearance matching is added later)? Consent, legitimate interest, **minors and guardian consent**? |
| L15 | Retention and erasure obligations for videos, detections, identity decisions (the audit history is append-only by design). |
| L16 | Importing from third-party platforms with the **user's own access token** (Vimeo API, Google Drive API): any issue with the platforms' API terms for a commercial service; does the user authorisation suffice? (YouTube and other download-prohibiting platforms are refused by design.) |

## 4. Third-party software (general)
- All JavaScript/Python dependencies are inventoried with licences (`DEPENDENCY_LICENSES.md`); CI fails on an unreviewed non-permissive
  licence. Reviewed exceptions: `reviewed_license_exceptions.json`. **MySQL Community Server** (GPL-2.0) runs as a separate network service.
| # | Question |
|---|---|
| L17 | Confirm that using MySQL Community Server over the network (not modified, not distributed) needs no commercial licence for our model (O2). |
| L18 | Fonts/icons (Inter OFL-1.1, Lucide ISC) embedded in a web app and in rendered videos: obligations. |

## 5. What will NOT happen before counsel's answers and the owner's approval
No paid exports; no distribution of installers or binaries; no download of Cisco's binary without the owner's consent; no purchase of
licences (e.g. libx264 commercial, patent pools); no production deployment.

## 6. Status table (kept current)
| Item | Technically implemented | Tested | Legally reviewed | Commercially approved |
|---|---|---|---|---|
| LGPL FFmpeg build (separate processes) | yes | yes — worker suite on real footage, frame/timestamp parity with the old path (ADR-029) | no | no |
| Intel QSV / Media Foundation H.264 | yes | yes — `release-evidence/encoder-benchmark/20261027/`, `test_render.py` | no | no |
| OpenH264 (Cisco binary 2.5.0, verified) | yes | yes — benchmark + browser playback + test_render.py | no (L4, L4a) | no |
| VP9 / AV1 alternatives (libvpx, SVT-AV1, Intel QSV AV1) | yes | yes — same evidence | no | no |
| AAC in MP4 (FFmpeg native encoder) | yes | encoder present; audio paths not yet benchmarked (no renderer audio yet) | no | no |
| RT-DETRv2 weights | yes | functional; accuracy not measured | no | no |
