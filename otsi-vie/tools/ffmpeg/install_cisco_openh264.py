"""Install Cisco's prebuilt OpenH264 binary next to the OpenH264-only FFmpeg tree (ADR-029). RUN ONLY WITH THE OWNER'S CONSENT:
obtaining the binary means accepting Cisco's binary licence, and Cisco covers the H.264 patent royalties only for its own binary, obtained
from Cisco (a self-built OpenH264 is not covered). The binary is never committed to the repository or bundled into an installer.

  python otsi-vie/tools/ffmpeg/install_cisco_openh264.py --i-accept-cisco-binary-licence

Downloads the DLL over HTTPS from ciscobinary.openh264.org (the source listed in Cisco's v2.5.0 GitHub release), checks it against
Cisco's published MD5, its Authenticode signature (must be valid and signed by Cisco) and its version resource (2.5.0, matching the
headers the tree was built with), records its SHA-256 (checked on every later use), installs it as libopenh264.dll (the import name the
FFmpeg tree was linked against) and writes cisco_openh264.json beside it. Free of charge: Cisco provides it under BSD terms and covers
its AVC patent licence "at no cost" — for uses that receive no remuneration (see the licence; commercial use is a counsel question).
"""
from __future__ import annotations

import argparse
import bz2
import datetime as dt
import hashlib
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "worker"))
from vie_worker import ff  # noqa: E402

URL = "https://ciscobinary.openh264.org/openh264-2.5.0-win64.dll.bz2"
MD5_URL = "https://ciscobinary.openh264.org/openh264-2.5.0-win64.dll.signed.md5.txt"   # Cisco's published checksum
LICENCE = "https://www.openh264.org/BINARY_LICENSE.txt"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-accept-cisco-binary-licence", action="store_true", required=True)
    ap.parse_args()
    d = ff.bin_dir("openh264")
    with urllib.request.urlopen(URL, timeout=60) as r:
        data = bz2.decompress(r.read())
    if data[:2] != b"MZ":
        sys.exit("the download is not a Windows DLL")
    with urllib.request.urlopen(MD5_URL, timeout=60) as r:
        published_md5 = r.read().decode().split()[0].lower()
    if hashlib.md5(data).hexdigest() != published_md5:
        sys.exit(f"MD5 {hashlib.md5(data).hexdigest()} does not match Cisco's published {published_md5}")
    dll = d / "libopenh264.dll"
    dll.write_bytes(data)
    ps = ("$s = Get-AuthenticodeSignature -LiteralPath '{p}'; $v = (Get-Item -LiteralPath '{p}').VersionInfo; "
          "[pscustomobject]@{{status=[string]$s.Status; signer=$s.SignerCertificate.Subject; version=$v.FileVersion; product=$v.ProductName}} | ConvertTo-Json").format(p=dll)
    sig = json.loads(subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, check=True).stdout)
    if sig["status"] != "Valid" or "Cisco" not in (sig["signer"] or "") or not str(sig["version"]).startswith("2.5.0"):
        dll.unlink()
        sys.exit(f"Authenticode check failed: {sig}")
    rec = {"source": URL, "licence": LICENCE, "version": "2.5.0", "file_version": sig["version"], "authenticode": sig["status"],
           "signer": sig["signer"], "md5_matches_cisco_published": published_md5, "installed_as": "libopenh264.dll", "sha256": hashlib.sha256(data).hexdigest(),
           "bytes": len(data), "installed_at": dt.datetime.now().isoformat(timespec="seconds"),
           "note": "Cisco's binary: not redistributed by OTSI; each installation obtains it from Cisco."}
    (d / "cisco_openh264.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")
    print(json.dumps(rec, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
