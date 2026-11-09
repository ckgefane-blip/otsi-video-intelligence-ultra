# Third-party licence register — OTSI VIE v2 (Block 00)

Living register of everything the commercial product uses that someone else owns: source dependencies, runtime services, codecs, model weights, datasets, fonts, media and brand marks. ADR-009: **no model weights without a documented commercial licence.** Nothing here is legal advice; every row marked *owner/legal* needs the owner's (or counsel's) decision before release (QUALITY_GATE_MANIFEST sign-off `model_licenses`, `legal_privacy_and_terms`).

Statuses: **CLEARED** (permissive / reviewed, in use) · **REVIEWED-LIMITED** (allowed only in the stated scope) · **CANDIDATE** (not in use; licence to be confirmed against the exact release at selection) · **BLOCKED** (cannot ship as-is) · **OWNER** (needs an owner-supplied asset or decision).

_Last updated: 2026-10-26 (RT-DETRv2 adopted for evaluation; codecs for playback)_

## 1. Source dependencies (installed today)

Generated inventory: [`DEPENDENCY_LICENSES.md`](DEPENDENCY_LICENSES.md), produced by `tools/licenses/dependency_licenses.py` from the installed pnpm store and virtualenv; `--check` fails the build on any unreviewed non-permissive licence (step 2 of `tools/ci/run_ci.py`).

| Scope | Result 2026-10-26 | Status |
|---|---|---|
| npm (API, web, contracts) + PyPI (workers, tooling, tests) | 396 packages; non-permissive or specially reviewed ones listed with their decision in the generated file | CLEARED (with the PyAV limitation below) |
| `pycountry` 24.6.1 (LGPL-2.1-only) | developer tool only (`tools/db/gen_countries.py`), never imported at runtime or distributed | REVIEWED-LIMITED |

## 2. Runtime services

| Component | Licence | Use | Status / condition |
|---|---|---|---|
| MySQL 8.4 Community Server | GPL-2.0 (with FOSS exception for client libraries) | Separate database service reached over the network; not linked into or distributed with OTSI code. Production uses a managed MySQL 8.4 service | CLEARED for network use. Distributing a modified server, or embedding it, would need Oracle commercial terms — not planned |
| `mysql2` Node driver | MIT | API database driver | CLEARED |
| Redis 7.2.x (if self-hosted) | BSD-3-Clause up to 7.2; 7.4+ changed to RSALv2/SSPL; 8.x adds AGPLv3 option | Cache / rate limits (blueprint) | CANDIDATE — pin a BSD-licensed release or use Valkey (BSD-3) / a managed service; decide at block 15 |
| Temporal (server) | MIT | Durable workflows (blueprint preference) | CANDIDATE — confirm at block 03/05 |
| S3-compatible object storage | service terms | Media and artifacts | OWNER — provider and region (cost + data residency) |

## 3. Video codecs and tooling (Blocks 03, 04, 11)

| Component | Licence | Status / condition |
|---|---|---|
| VP9 (libvpx, BSD-3) + Opus (BSD-3) in WebM | playback copies for the browser (Block 04): royalty-free codecs | IN USE (inside the PyAV build noted below) |
| FFmpeg / ffprobe | LGPL-2.1+ by default; **GPL** when built with `--enable-gpl` (e.g. libx264, libx265); `--enable-nonfree` builds are not redistributable | IMPLEMENTED as our own LGPL build run as separate processes (ADR-029); build flags and binary hashes in `BUILD_MANIFEST.json`. Legal review pending |
| libx264 (H.264 encoder) | GPL-2.0 (commercial licence available from its maintainers) | **BLOCKED** inside a distributed product without that commercial licence. Server-side SaaS use without distribution must still be confirmed by counsel. Alternatives: OpenH264 (BSD-2, Cisco binary), hardware encoders (NVENC / QSV / VAAPI via LGPL FFmpeg) |
| H.264 / AAC / HEVC patent pools | patent licences (e.g. Via LA, Access Advance), separate from copyright | OWNER/legal — commercial MP4 export needs a decision on patent licensing (or royalty-free codecs such as AV1/VP9 + Opus where clients allow) |
| PyAV 13.1.0 wheels (`av`) | PyAV BSD-3; the bundled FFmpeg 7.0 libraries are built **with libx264/libx265 → GPL-3.0** | **No longer used by the product** (ADR-029; test `test_media_licensing.py`). Kept installed for one developer tool (`tools/models/sampling_study.py`). Never distributed |
| **OTSI LGPL FFmpeg build** `ffmpeg-7.1.1-lgpl-202610270133` (`tools/ffmpeg/`) | FFmpeg LGPL-2.1+ (no gpl/nonfree/version3) + oneVPL (MIT), libvpx (BSD-3), dav1d (BSD-2), SVT-AV1 (BSD-3-Clause-Clear + AOMedia patent licence), Opus (BSD-3), zlib (zlib), winpthreads (MIT/BSD), libstdc++/libgcc (GPL-3 WITH GCC Runtime Library Exception) | IN USE for development and testing as separate processes. Corresponding source archived (`.local/ffmpeg-src/`), build reproducible. **Legal review pending (E3)** before any distribution |
| Cisco OpenH264 binary 2.5.0 (`openh264-2.5.0-win64.dll`, SHA-256 `bf91c488…fb2b`) | BSD-2 + Cisco's AVC patent licence "at no cost", which its BINARY_LICENSE.txt limits to **personal use / uses that receive no remuneration**; content providers may need their own licence | INSTALLED for local development/testing (owner consent 2026-10-27; free of charge; MD5 matches Cisco's published value; Authenticode valid, signed by Cisco). Never bundled or redistributed. **Commercial (paid) use: counsel (L4)** |
| OpenCV | Apache-2.0 (4.5+) | CANDIDATE |
| PyAV | BSD-3-Clause (wraps the FFmpeg build above; inherits its licence) | CANDIDATE |

## 4. Computer-vision models and weights (Blocks 05-08)

Owner decision 2026-10-26: Apache-licensed detection path (RT-DETR / RT-DETRv2 first), no purchases, nothing AGPL in the product, model
replaceable without rebuilding the application. Every model the workers may load is pinned in
`services/worker/vie_worker/models/registry.json` (source, revision, SHA-256 per weight file); `tools/models/fetch_models.py` downloads
and verifies; the worker refuses any file whose hash differs and never downloads at run time.

| Model (registry key) | Exact source and version | Weights SHA-256 | Code licence | Weights licence | Training data | Status |
|---|---|---|---|---|---|---|
| `rtdetr_v2_r18vd` (default) | huggingface.co/PekingU/rtdetr_v2_r18vd @ `5650961749fa93567c0d46fc7f43ea4f9e914107`, safetensors | `d18309d0d7ea57048138885c4c6ecfcb1e24506fc6153b94ad484f8ab62c7115` | Apache-2.0 (transformers 4.49.0 `RTDetrV2ForObjectDetection`; reference lyuwenyu/RT-DETR Apache-2.0) | Apache-2.0, declared on the model card by the publishers (PekingU = the RT-DETR authors' organisation) | COCO 2017 | IN USE for development and evaluation; football accuracy NOT yet measured (needs labelled footage) |
| `rtdetr_v2_r50vd` | huggingface.co/PekingU/rtdetr_v2_r50vd @ `282494075698cab9faa1096ae26856890030c817` | `3331d977dbc0c7a6cdae9ec0b0b6ad156eb6720d65b7cf0fa710dcc541d88d71` | as above | as above | COCO 2017 | evaluated: slower, not better on our footage (benchmark) |
| `dinov2_small` (default appearance embedder), `dinov2_base` (evaluated) | huggingface.co/facebook/dinov2-small, -base, revisions pinned in the registry | SHA-256 pinned | Apache-2.0 (transformers) | Apache-2.0 (model card) | LVD-142M (curated images, Meta) | IN USE (appearance evidence only, ADR-031) |
| `siglip_base_224` | huggingface.co/google/siglip-base-patch16-224, revision pinned | SHA-256 pinned | Apache-2.0 | Apache-2.0 (model card) | WebLI (Google) | OPTIONAL appearance embedder (ADR-031) |
| `ppocr_v4_det` (shirt-number text detector) | github.com/PaddlePaddle/PaddleOCR PP-OCRv4 `ch_PP-OCRv4_det_infer.tar` (paddleocr.bj.bcebos.com) | `5f7217e0a89612e2f80d62f3c99a8bf5f7ae9cdc1ffd706be7dde07765627edf` | none needed (Paddle inference graph read by OpenVINO; no Paddle runtime) | Apache-2.0 (PaddleOCR repository) | PaddleOCR training sets (Baidu; see PaddleOCR documentation) | IN USE (shirt-number evidence only, ADR-033) |
| `ppocr_v4_en_rec` (shirt-number recogniser) + `en_dict.txt` | PaddleOCR PP-OCRv4 `en_PP-OCRv4_rec_infer.tar`; dictionary from PaddleOCR release/2.7 | `d5ae153a6fbdacd5776543d3194c4258154ed6f83467d55de1cc345f7dd20322`; dict `5662df9d2d03f0e8ca0d3b0649d6acbab904b6a14b3d3521463c71c37c668ce3` | as above | Apache-2.0 (PaddleOCR repository) | as above | IN USE (ADR-033) |
| `omz_text_recognition_0014` | Open Model Zoo 2023.0 text-recognition-0014 | SHA-256 pinned | Apache-2.0 | Apache-2.0 | Intel (undisclosed scene-text sets) | REJECTED (0 of 11 shirt numbers read) |
| Florence-2 | not used | — | MIT | MIT | — | NOT USED (requires running downloaded model code, `trust_remote_code`) |
| OpenAI CLIP ViT-B/32 | not used | — | MIT (code) | no licence declared on the model card | undisclosed web data | NOT USED (licence unclear) |
| RT-DETR `_coco_o365` variants | not used | — | Apache-2.0 | Apache-2.0 | COCO + **Objects365** (terms unclear for commercial use) | NOT USED |
| Ultralytics YOLOv5/v8/11 | not used | — | **AGPL-3.0** | AGPL-3.0 | — | **BLOCKED** (owner: no purchase, no AGPL in the product) |
| `pnlcalib_sv_kp` (pitch keypoints, automatic calibration) | github.com/mguti97/PnLCalib release v1.0.0 `SV_kp` (HRNetV2-W48, 57 pitch keypoints), converted once to OpenVINO IR by `tools/models/convert_pnlcalib.py` | `7ea78fa76aaf94976a8eca428d6e3c59697a93430cba1a4603e20284b61f5113` | Run time: none (OpenVINO IR + our own decoding and camera fit, `vie_worker/pitch_auto.py`). Conversion only: HRNet architecture `tools/models/third_party/hrnet_cls.py` (Microsoft, MIT). PnLCalib's own code (GPL-2.0-or-later) is neither copied nor shipped | **CC BY 4.0** (README "License": any purpose including commercial, with attribution; preferred attribution: Gutiérrez-Pérez & Agudo, "PnLCalib: Sports Field Registration Via Points and Lines Optimization", SSRN 4998149) | SoccerNet-Calibration; the authors state it was used under a research agreement that has since expired and that the weights contain no footage and carry no further restrictions | IN USE for development and evaluation (ADR-036). Obligations: attribution in the app's licences page and docs; state that the weights were converted (not retrained). **Counsel (L5): confirm the authors' statement on the expired SoccerNet agreement before commercial release** |
| `ppocr_v5_cyrillic_rec`, `ppocr_v5_latin_rec` (lineup-card text readers) | huggingface.co/PaddlePaddle/{cyrillic,latin}_PP-OCRv5_mobile_rec (revisions pinned in the model registry: inference.json, inference.pdiparams, inference.yml) | cyrillic pdiparams `434dc9fa2a99fa3653e08f8cf793ae56be7dd41c35c4980e6255147cc02bbc80`, latin pdiparams `53cdc8b481a7394bb108f96d0fb3432b0a8f392e22c7d18f06dbb2d42b8b25f9` (all files pinned in registry.json) | Run time: **paddlepaddle 3.3.1** (Apache-2.0), Paddle Inference on the CPU (OpenVINO cannot read the PP-OCRv5 PIR format) | Apache-2.0 (model cards) | PaddleOCR PP-OCRv5 multilingual training sets (Baidu; see PaddleOCR documentation) | IN USE for development (ADR-039): reading broadcast lineup cards; evidence for a person to approve |
| `ball_net` (ball heat-map network) | trained locally by `tools/models/ball_train.py` (own architecture) | `55f11bf9e55f72370f6aaf90ef00b8e4b60c4fa917447a7e76dc5e645ac57153` | none (own code; OpenVINO at run time). Training only: PyTorch 2.15 XPU (BSD-3) and onnx (Apache-2.0) in a separate `.venv-train` | Own work | The owner's own match footage only (labels: the engine's sure detections) | IN USE for development (ADR-038); trained on one match: validate on other footage before release |

Obligations (Apache-2.0): keep licence and NOTICE texts for transformers / RT-DETR when distributing, state changes. COCO annotations are
CC BY 4.0 (attribution). **Open legal question for counsel before commercial release:** the COCO *images* are Flickr photos under their
owners' licences (some non-commercial); whether weights trained on them may be used commercially is unsettled industry-wide. The weights'
own licence (Apache-2.0) is clear. Mitigation path if counsel objects: fine-tune / retrain on footage the owner holds rights to (the
detector adapter and registry already allow swapping weights without application changes).

Inference runtime: **Intel OpenVINO 2025.3.0** (Apache-2.0) runs the same weights on the Intel Arc iGPU (default) or CPU (ADR-026); `openvino-telemetry` (Apache-2.0) is opt-in and consent is never given. Other model-side dependencies: PyTorch 2.6.0 CPU (BSD-3), transformers 4.49.0 (Apache-2.0), safetensors (Apache-2.0), SciPy 1.14.1 (BSD-3;
tracker assignment), pyarrow 18.1.0 (Apache-2.0; evidence files), Pillow (MIT-CMU; benchmark images), psutil (BSD-3; benchmark, and the worker's CPU / memory status for Page 03 System Resources).

Evaluation footage (not training data, not shipped): `release-evidence/model-benchmarks/20261026-rtdetr-v2-cpu/` with attribution in
its NOTICE.md (CC BY 3.0, CC BY-SA 4.0 numbers only, public domain).

## 5. Datasets and footage

| Item | Concern | Status |
|---|---|---|
| Authorised football footage for development, holdout evaluation and the owner walkthrough | Broadcast rights belong to leagues / broadcasters; players are identifiable people (biometric data in some jurisdictions; minors) | **OWNER** — required for Block 05 onward (`rights_to_source_footage`) |
| SoccerNet (tracking, re-ID, calibration, jersey, ...) | Access under an NDA with research / non-commercial terms | **BLOCKED** for commercial training or product use without a written agreement |
| COCO, Objects365, CrowdHuman, MOT17/20 | mixed image licences; several research-only | CANDIDATE only for research comparisons; commercial use per dataset review |
| Own labelled holdout set (lighting / weather / leagues / angles) | must be built from authorised footage; labelling vendor terms | OWNER — prerequisite of `measured_tracking_accuracy` |

## 6. Fonts, icons, media and brand

| Item | Status / condition |
|---|---|
| UI font | CLEARED — **Inter** variable (SIL Open Font License 1.1) from the `@fontsource-variable/inter` npm package, bundled and self-hosted (no request to Google at build or run time), with tabular numerals. OFL allows commercial use and embedding |
| Reel caption font | Pillow 11.1's built-in scalable default font (`ImageFont.load_default(size=...)`) | IN USE for development renders; confirm the embedded font's licence in the E3 review before commercial export (an OFL font such as Inter can replace it) |
| Icons | CLEARED — **Lucide** (`lucide-react`, ISC); no proprietary icon sets |
| OTSI logo / wordmark | **OWNER** — the approved images are the branding authority (circular OTSI emblem + "OTSI VIE" wordmark). Files in `logos/` (blue disc / green wedge, 2026-10-27) are NOT used: the owner ruled they must not replace the approved emblem until the exact original asset is confirmed. The shell keeps the text wordmark in the approved position; the emblem slot stays reserved |
| Production palette | OWNER approval pending — the shell uses the spec's proposed tokens (`#06111F`, `#0C1D30`, `#10243A`, `#1B3C56`, `#079BFF`, `#17D1F8`, `#F1A824`, `#F4F8FF`, `#9CB1C5`) exactly |
| Hero / marketing imagery, stadium photos | **OWNER** — the approved images are design references, not licensed artwork. Shipped imagery must be licensed or owner-produced |
| League / association / club logos ("trust strip", overlays) | **BLOCKED** without contractual permission (blueprint: no UEFA/FIFA/league marks implying endorsement). The shell leaves the trust strip empty with an explicit owner placeholder |
| Music / audio beds for reels (Block 11 F43) | OWNER — licensed library or user-supplied with rights attestation |
| Player photos / names in reports | rights + privacy (consent, minors / guardian consent) — enforced by the rights block (12) |

## 7. Commercial services (Block 13+)

| Service | Status |
|---|---|
| Payment provider (Stripe per blueprint, behind `BillingProvider`) | OWNER — merchant account and jurisdiction (`billing_merchant_account`) |
| OIDC identity provider | OWNER — provider choice and its terms (Block 02) |
| Email / delivery providers, CDN | OWNER — choose at Block 12 |

## Review rule
A new dependency, model, dataset, font, codec build or media asset is added here (or appears in the generated inventory) **before** it ships. The CI pipeline (`tools/ci/run_ci.py`) fails on an unreviewed non-permissive source licence. Model/dataset rows move to CLEARED only with the manifest and a recorded owner/legal decision.
