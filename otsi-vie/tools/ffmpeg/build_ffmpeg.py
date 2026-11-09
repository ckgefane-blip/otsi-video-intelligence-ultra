"""Build the LGPL FFmpeg for Windows reproducibly (ADR-029).

  python otsi-vie/tools/ffmpeg/build_ffmpeg.py            fetch (cached) + verify sources, build in Docker, install, verify
  python otsi-vie/tools/ffmpeg/build_ffmpeg.py --lock     first time only: record the SHA-256 of each source archive (trust on first use)

Sources are archived under .local/ffmpeg-src/ (kept: they are the corresponding source the LGPL requires us to be able to provide).
The result goes to .local/ffmpeg-lgpl/<build id>/{main,openh264}/ with BUILD_MANIFEST.json (versions, configure lines, file hashes,
licence). The worker finds it through OTSI_VIE_FFMPEG_DIR (default: .local/ffmpeg-lgpl/current.txt -> build id).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SRC = ROOT / ".local" / "ffmpeg-src"
OUT = ROOT / ".local" / "ffmpeg-lgpl"
LOCK = HERE / "sources.lock.json"
IMAGE = "otsi-vie-ffmpeg-build:1"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while c := f.read(1 << 20):
            h.update(c)
    return h.hexdigest()


def fetch(lock: dict, record: bool) -> None:
    SRC.mkdir(parents=True, exist_ok=True)
    for s in lock["sources"]:
        dest = SRC / s["file"]
        if not dest.exists():
            print("fetch", s["url"])
            req = urllib.request.Request(s["url"], headers={"User-Agent": "OTSI-VIE-build/1"})
            with urllib.request.urlopen(req, timeout=120) as r, open(str(dest) + ".part", "wb") as f:
                shutil.copyfileobj(r, f)
            Path(str(dest) + ".part").replace(dest)
        got = sha256(dest)
        if record:
            s["sha256"] = got
        elif got != s["sha256"]:
            sys.exit(f"{s['file']}: SHA-256 {got} does not match the lock {s['sha256']}; refusing to build")
    if record:
        lock["locked_at"] = dt.date.today().isoformat()
        LOCK.write_text(json.dumps(lock, indent=1) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lock", action="store_true")
    a = ap.parse_args()
    lock = json.loads(LOCK.read_text(encoding="utf-8"))
    fetch(lock, a.lock)
    if a.lock:
        print("locked", LOCK)
        return 0
    subprocess.run(["docker", "build", "-t", IMAGE, str(HERE)], check=True)
    build_id = f"ffmpeg-{lock['ffmpeg_version']}-lgpl-{dt.datetime.now():%Y%m%d%H%M}"
    stage = OUT / (build_id + ".partial")
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    log = stage / "build.log"
    with open(log, "w", encoding="utf-8") as lf:
        r = subprocess.run(["docker", "run", "--rm", "-v", f"{SRC}:/src:ro", "-v", f"{stage}:/out", IMAGE, "bash", "/build/build.sh"],
                           stdout=lf, stderr=subprocess.STDOUT)
    tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-15:]
    if r.returncode != 0 or "BUILD_OK" not in tail:
        print("\n".join(tail))
        return 1
    files = {str(p.relative_to(stage)).replace("\\", "/"): sha256(p) for p in sorted(stage.rglob("*")) if p.is_file() and p.suffix.lower() in (".exe", ".dll")}
    manifest = {
        "build_id": build_id, "built_at": dt.datetime.now().isoformat(timespec="seconds"), "licence": "LGPL-2.1-or-later (checked: no --enable-gpl/--enable-nonfree/--enable-version3)",
        "image": IMAGE, "base_image": "ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac",
        "sources": lock["sources"], "configure": {d: (stage / d / "CONFIGURATION.txt").read_text().strip() for d in ("main", "openh264")},
        "binaries_sha256": files,
        "openh264_runtime": "NOT INCLUDED. Place Cisco's prebuilt openh264-2.5.0-win64.dll (from ciscobinary.openh264.org, as Cisco requires) next to "
                            "openh264/bin/ffmpeg.exe under the import name the build expects; a self-built OpenH264 is not covered by Cisco's patent licence.",
    }
    (stage / "BUILD_MANIFEST.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    final = OUT / build_id
    stage.rename(final)
    (OUT / "current.txt").write_text(build_id + "\n", encoding="utf-8")
    print("installed", final)
    return 0


if __name__ == "__main__":
    sys.exit(main())
