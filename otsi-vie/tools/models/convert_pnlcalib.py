"""Convert the registered PnLCalib keypoint weights (pnlcalib_sv_kp, CC BY 4.0) once into an OpenVINO model for the workers (ADR-036).

  python otsi-vie/tools/models/fetch_url_models.py pnlcalib_sv_kp     download and verify the weights against the registry pin
  python otsi-vie/tools/models/convert_pnlcalib.py                     build VIE-Engine-v2/.local/models/pnlcalib_sv_kp/openvino/<sha16>/model.xml

The network is HRNetV2-W48 (tools/models/third_party/hrnet_cls.py, Microsoft, MIT) with 58 heatmap channels at half the 960 x 540 input.
The weights are loaded with weights_only=True (no code in the file can run). PnLCalib's own code is not used. Run time needs only OpenVINO.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
MODELS = APP.parent / ".local" / "models" / "pnlcalib_sv_kp"
REGISTRY = APP / "services" / "worker" / "vie_worker" / "models" / "registry.json"
sys.path.insert(0, str(Path(__file__).resolve().parent / "third_party"))

# HRNetV2-W48 as trained (the published config): four stages, 58 output channels (57 pitch keypoints + background)
CONFIG = {"MODEL": {"IMAGE_SIZE": [960, 540], "NUM_JOINTS": 58, "PRETRAIN": "", "EXTRA": {
    "FINAL_CONV_KERNEL": 1,
    "STAGE1": {"NUM_MODULES": 1, "NUM_BRANCHES": 1, "BLOCK": "BOTTLENECK", "NUM_BLOCKS": [4], "NUM_CHANNELS": [64], "FUSE_METHOD": "SUM"},
    "STAGE2": {"NUM_MODULES": 1, "NUM_BRANCHES": 2, "BLOCK": "BASIC", "NUM_BLOCKS": [4, 4], "NUM_CHANNELS": [48, 96], "FUSE_METHOD": "SUM"},
    "STAGE3": {"NUM_MODULES": 4, "NUM_BRANCHES": 3, "BLOCK": "BASIC", "NUM_BLOCKS": [4, 4, 4], "NUM_CHANNELS": [48, 96, 192], "FUSE_METHOD": "SUM"},
    "STAGE4": {"NUM_MODULES": 3, "NUM_BRANCHES": 4, "BLOCK": "BASIC", "NUM_BLOCKS": [4, 4, 4, 4], "NUM_CHANNELS": [48, 96, 192, 384], "FUSE_METHOD": "SUM"}}}}


def main() -> int:
    import openvino as ov
    import torch
    from hrnet_cls import get_cls_net
    entry = next(m for m in json.loads(REGISTRY.read_text(encoding="utf-8"))["models"] if m["key"] == "pnlcalib_sv_kp")
    weights = MODELS / "SV_kp"
    sha = hashlib.sha256(weights.read_bytes()).hexdigest() if weights.exists() else None
    if sha != entry["url_files"]["SV_kp"]["sha256"]:
        sys.exit(f"{weights}: missing or not the registered file; run tools/models/fetch_url_models.py pnlcalib_sv_kp")
    net = get_cls_net(CONFIG)
    net.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
    net.eval()
    out = MODELS / "openvino" / sha[:16]
    out.mkdir(parents=True, exist_ok=True)
    ov.save_model(ov.convert_model(net, example_input=torch.zeros(1, 3, 540, 960)), out / "model.xml", compress_to_fp16=False)
    print(f"converted: {out / 'model.xml'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
