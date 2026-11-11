"""Download models that are published as plain weight files outside Hugging Face (OpenVINO Open Model Zoo IR, PaddleOCR inference models)
into VIE-Engine-v2/.local/models/<key>/, pinned by SHA-256 in the registry (`url_files`: name -> {url, sha256}). Archives (.tar) are
unpacked after verification; only weight / graph / dictionary files are kept. No third-party code is downloaded or run (ADR-033).

  python otsi-vie/tools/models/fetch_url_models.py [key ...]            verify against the pins (refuse on mismatch)
  python otsi-vie/tools/models/fetch_url_models.py --lock [key ...]     first download: record the SHA-256 pins
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
REGISTRY = APP / "services" / "worker" / "vie_worker" / "models" / "registry.json"
# The desktop app sets OTSI_VIE_MODELS_DIR to the data folder's models
# directory (ADR-144 §1.3); the worker reads the same variable
# (services/worker/vie_worker/detect/base.py). Default is the dev checkout.
MODELS = Path(os.environ.get("OTSI_VIE_MODELS_DIR", str(APP.parent / ".local" / "models")))
KEEP = (".xml", ".bin", ".pdmodel", ".pdiparams", ".txt", ".json", ".onnx")


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while c := f.read(1 << 20):
            h.update(c)
    return h.hexdigest()


def main() -> int:
    lock = "--lock" in sys.argv
    keys = [a for a in sys.argv[1:] if not a.startswith("--")]
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for m in reg["models"]:
        if "url_files" not in m or (keys and m["key"] not in keys):
            continue
        dest = MODELS / m["key"]
        dest.mkdir(parents=True, exist_ok=True)
        for name, spec in m["url_files"].items():
            target = dest / name
            if not target.exists():
                req = urllib.request.Request(spec["url"], headers={"User-Agent": "OTSI-VIE-model-fetch/1"})
                with urllib.request.urlopen(req, timeout=180) as r, open(str(target) + ".part", "wb") as f:
                    shutil.copyfileobj(r, f)
                Path(str(target) + ".part").replace(target)
            got = sha256(target)
            if lock:
                spec["sha256"] = got
            elif got != spec.get("sha256"):
                target.unlink()
                sys.exit(f"{m['key']}/{name}: SHA-256 {got} does not match the registry pin; deleted")
            if name.endswith(".tar"):
                with tarfile.open(target) as t:
                    for member in t.getmembers():
                        base = Path(member.name).name
                        if member.isfile() and base.endswith(KEEP) and ".." not in member.name:
                            with t.extractfile(member) as src, open(dest / base, "wb") as out:
                                shutil.copyfileobj(src, out)
        print(f"{m['key']}: {'locked' if lock else 'verified'} at {dest}")
    if lock:
        REGISTRY.write_text(json.dumps(reg, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
