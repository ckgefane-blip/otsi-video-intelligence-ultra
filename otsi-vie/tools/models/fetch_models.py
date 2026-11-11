"""Download the registered detection models (services/worker/vie_worker/models/registry.json) at their pinned revisions into
VIE-Engine-v2/.local/models/<key>/ and verify every pinned SHA-256. A mismatch deletes the file and fails. Caches stay on D:.

  python otsi-vie/tools/models/fetch_models.py [model key ...]      (default: all registered models)
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
REGISTRY = APP / "services" / "worker" / "vie_worker" / "models" / "registry.json"
# The desktop app sets OTSI_VIE_MODELS_DIR to the data folder's models
# directory (ADR-144 §1.3); the worker reads the same variable
# (services/worker/vie_worker/detect/base.py). Default is the dev checkout.
MODELS = Path(os.environ.get("OTSI_VIE_MODELS_DIR", str(ROOT / ".local" / "models")))
os.environ.setdefault("HF_HOME", str(ROOT / ".local" / "hf"))           # never the C: drive
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

from huggingface_hub import hf_hub_download  # noqa: E402


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def fetch(model: dict) -> Path:
    dest = MODELS / model["key"]
    dest.mkdir(parents=True, exist_ok=True)
    for name, expected in model["files"].items():
        target = dest / name
        if not target.exists() or (expected and sha256(target) != expected):
            got = Path(hf_hub_download(model["repo_id"], name, revision=model["revision"]))
            shutil.copyfile(got, target)
        if expected and (actual := sha256(target)) != expected:
            target.unlink()
            raise SystemExit(f"{model['key']}/{name}: SHA-256 {actual} does not match the registry ({expected}); file deleted")
    (dest / "REGISTRY_ENTRY.json").write_text(json.dumps(model, indent=1), encoding="utf-8")
    return dest


if __name__ == "__main__":
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    wanted = set(sys.argv[1:]) or {m["key"] for m in reg["models"]}
    for m in reg["models"]:
        if m["key"] in wanted and "repo_id" in m:                  # trained here (ball_net): nothing to download
            print(f"{m['key']}: verified at {fetch(m)}")
