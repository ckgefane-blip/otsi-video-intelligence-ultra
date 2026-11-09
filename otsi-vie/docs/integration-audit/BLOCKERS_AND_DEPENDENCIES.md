# Blockers and dependencies

**Commit:** `d3ef2f5` · 2026-10-27. "Owner" = needs the owner's decision, data, account or approval. Nothing here has been purchased or activated.

## A. Owner decisions and inputs (blocking)
| # | Blocker | Blocks | What is needed | Cost/risk note |
|---|---|---|---|---|
| A1 | **MP4/H.264 encoder and patent position** | Block 11 render, Block 12 export, acceptance steps 12-13 | Choose the encoder architecture (recommendation in `MP4_ENCODING_AND_LICENSING_REVIEW.md`) and obtain counsel's view on H.264 patent licensing for the business model | Possible patent-pool licence; no purchase made |
| A2 | **Labelled football footage** (rights cleared, with box/identity annotations, or permission to annotate) | Accuracy of detection/tracking (F11, F12, F14), model approval thresholds (F56), "production-ready" claim | 3-10 matches of the target footage types, or a licensed dataset | Annotation effort or dataset licence |
| A3 | Counsel review of COCO-trained weights (RT-DETRv2 Apache-2.0 code/weights; COCO image licences) | Commercial model release | Legal opinion | — |
| A4 | Production FFmpeg build | Distribution of probe/proxy/render (F08, F09) | Approve swapping the bundled GPL PyAV FFmpeg for an LGPL build (we build/vendor it) | Engineering time, no fee |
| A5 | Approved logo, palette, trust-strip marks | Home §5, branding in exports | Owner assets with licences | — |
| A6 | Merchant/payment account | Billing (Block 13) | Owner account + terms | Fees per provider |
| A7 | Hosting database (MySQL version, credentials) | Deployment, the pending read-only version check | An authorised connection | — |
| A8 | Real Vimeo / Google Drive credentials (test accounts) | Live verification of authorised imports | Owner's own tokens, or OAuth apps registered under the owner's accounts | Provider terms |
| A9 | Figma Make output for review | Frontend completion of pages 01, 05-10 | Export per `FIGMA_INTEGRATION_REQUIREMENTS.md` | — |

## B. Engineering dependencies (no owner action; in build order)
| # | Dependency | Unblocks |
|---|---|---|
| B1 | Matches (teams, competition, date, score) as an entity linked to videos | Home recent matches, match rail, rosters, reports, library |
| B2 | Per-match rosters + role/team classification (player/goalkeeper/referee; kit clustering) | 22-person roster panel, team lanes, tactics |
| B3 | Jersey OCR + identity candidate generation (always human-confirmed) | Faster identity review (F19, F20) |
| B4 | Cross-shot candidate linking (proposals only, reviewed) | Player selection across tracks (step 9), reels |
| B5 | Reel model + editor API (segments, versions, pinned targets) | Pages 06, 07 |
| B6 | Dense target re-analysis of reel windows + spotlight trajectory with `INTERPOLATED` labelling | Spotlight (step 11) |
| B7 | Compositor + encoder pipeline (after A1) | MP4 render (steps 12-13), export |
| B8 | Events, pitch calibration, metrics | Pages 05, 08; event ribbon |
| B9 | Object storage (S3 adapter), retention, backups | Deployment, Block 15 |
| B10 | Admin console, invitations, MFA | Commercial onboarding |

## C. Known technical limitations (not blockers, documented)
- Detection ≈ 0.4-0.5 s per tiled 1080p frame on the Arc iGPU → a 90-minute match at 2 fps takes ~71-88 min; 3 fps ~107-132 min.
- The NPU does not compile the model (driver error); FP16 on the GPU is rejected by the parity check (detections differ).
- PyAV's FFmpeg has no hardware *decode* path; hardware *encode* is available through Windows Media Foundation (measured, see review).
- Tracks end at every cut and after 1 s unseen; one player therefore appears as several tracks until cross-track linking exists.
- One older API concurrency test (`identity.api.test.ts`, test 4) failed once while the GPU/CPU were saturated by a parallel study and
  passed on every rerun and in the full CI; to be watched for flakiness under load.
- The URL tab note on page 02 still says platform pages "need a licensed integration" (copy predates ADR-027); copy-only fix pending.
