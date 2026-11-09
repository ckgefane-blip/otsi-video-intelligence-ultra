# ADR-026: Detection on the Intel Arc integrated GPU with OpenVINO; verified fallbacks

Status: accepted (2026-10-27; owner directive: investigate the Intel Arc GPU, verify by measurement, keep a CPU fallback)

## Hardware and software found (this machine)
- CPU: Intel Core Ultra 7 155H (Meteor Lake), 16 cores / 22 threads; 31.5 GB RAM.
- GPU: **Intel Arc Graphics (integrated, Xe-LPG, PCI 8086:7D55)**, driver **32.0.101.8860** (2026-06-25); DirectX 12, feature level 12_2; **128 MB dedicated + 18.4 GB shared** system memory (dxdiag); OpenVINO reports 17.7 GB usable, FP32/FP16/INT8. No CUDA (not an NVIDIA GPU) — the earlier "no GPU" wording meant no CUDA and was corrected.
- NPU: **Intel AI Boost** (OpenVINO architecture 3720, FP16/INT8).
- APIs: OpenVINO 2025.3 (CPU, GPU via oneAPI Level Zero/OpenCL, NPU). The FFmpeg build inside PyAV 13.1 has **no Quick Sync / D3D11VA decode path**; it has Windows Media Foundation encoders `h264_mf` / `hevc_mf` (hardware encoding on the Arc media engine) — candidate for MP4 export (Block 11, licence review pending). Hardware decode therefore needs a different FFmpeg build (LGPL with QSV/D3D11VA) — tracked.
- ONNX Runtime: not adopted — OpenVINO runs the same graph directly on all three Intel devices; the DirectML/OpenVINO execution providers would add a second runtime without a measured benefit.

## Measurements (`release-evidence/model-benchmarks/20261027-devices/`, 60 frames from 2 real matches, same weights and settings)
| Runtime | Tiled ms/frame | Agreement with PyTorch | 90-min match at 2 fps |
|---|---|---|---|
| PyTorch CPU | 1058 | reference | ~190 min |
| OpenVINO CPU | 897 | 100 % (IoU 0.9), ball 42/42 | ~161 min |
| **OpenVINO GPU FP32** | **462** | **100 % (IoU 0.9), ball 42/42** | **~83 min** |
| OpenVINO GPU FP16 | 308 | 99.1 % (5 missing, 2 extra) | ~55 min |
| NPU | — | does not compile (Level Zero `ZE_RESULT_ERROR_UNKNOWN`) | — |
Untiled: 281 / 203 / 105 / 83 ms. No errors, no latency growth over 120 continuous frames. OpenVINO **2025.0** lost detections on this GPU in batches (fixed in 2025.3) — the reason for the self-check below.

## Decision
1. Default inference device: **OpenVINO GPU at FP32** (registry `default_device`; overridable with `OTSI_VIE_INFERENCE_DEVICE`). FP16 is rejected: faster but changes results.
2. **Parity self-check** whenever an OpenVINO device is opened: a fixed seeded batch of 2 through PyTorch and the device; top-50 scores within 0.02 and their boxes within 0.01 or the device is refused. It automatically refuses FP16 here.
3. **Fallback chain**: requested device → OpenVINO CPU → PyTorch CPU, each failure logged; the runtime actually used is recorded in the model version and the run result (`runtime`).
4. The same verified safetensors weights are converted once to OpenVINO IR, cached under the weights directory keyed by their SHA-256. No new model, no new licence (OpenVINO: Apache-2.0; its telemetry package is opt-in and never accepted here).

## Not yet
NPU (driver/compiler error; re-test with a newer NPU driver — no purchase needed), INT8 quantisation (needs a calibration set and an accuracy check on labelled footage), hardware video decode.
