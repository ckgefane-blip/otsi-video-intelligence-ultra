"""Rebuild the SHA-256 manifest of the extracted owner handoff and compare it with the manifest the package shipped with.

Writes (never touching the extracted package itself):
  blueprint/SHA256_MANIFEST.as-delivered.txt  one line per file actually present as delivered (default mode)
  blueprint/SHA256_MANIFEST.corrected.txt     the same after the MySQL corrections (--corrected): "<sha256>  <path>"
  blueprint/MANIFEST_AUDIT.md              the original manifest's discrepancies: matching, changed, missing, unlisted

Usage: python otsi-vie/tools/handoff_manifest.py   (run from D:\\OTSI-Workspace\\VIE-Engine-v2)
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "blueprint" / "OTSI-Owner Developer Handoff"
ORIGINAL = PKG / "SHA256_MANIFEST.txt"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def corrected() -> None:
    """After the MySQL corrections: write blueprint/SHA256_MANIFEST.corrected.txt of the ACTIVE blueprint. The as-delivered audit stays untouched."""
    files = {p.relative_to(PKG).as_posix(): sha256(p) for p in sorted(PKG.rglob("*")) if p.is_file() and p != ORIGINAL}
    out = ROOT / "blueprint" / "SHA256_MANIFEST.corrected.txt"
    header = "# Active blueprint after the corrections in blueprint/CORRECTIONS.md (the shipped SHA256_MANIFEST.txt is kept as delivered)\n"
    out.write_text(header + "".join(f"{h}  {p}\n" for p, h in files.items()), encoding="utf-8")
    print(f"corrected manifest: {len(files)} files -> {out}")


def main() -> None:
    present = {p.relative_to(PKG).as_posix(): sha256(p) for p in sorted(PKG.rglob("*")) if p.is_file() and p != ORIGINAL}
    listed = {}
    for line in ORIGINAL.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([0-9a-fA-F]{64})\s+\*?(.+)$", line.strip())
        if m:
            listed[m.group(2).strip()] = m.group(1).lower()
    same = sorted(p for p in listed if p in present and present[p] == listed[p])
    changed = sorted(p for p in listed if p in present and present[p] != listed[p])
    missing = sorted(p for p in listed if p not in present)
    unlisted = sorted(p for p in present if p not in listed)

    (ROOT / "blueprint" / "SHA256_MANIFEST.as-delivered.txt").write_text(
        "".join(f"{h}  {p}\n" for p, h in present.items()), encoding="utf-8")
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    sec = lambda title, items: f"\n## {title} ({len(items)})\n" + ("".join(f"- `{i}`\n" for i in items) or "- none\n")
    (ROOT / "blueprint" / "MANIFEST_AUDIT.md").write_text(
        f"# Handoff manifest audit\n\nGenerated {now} by `otsi-vie/tools/handoff_manifest.py` from the extracted package "
        f"`blueprint/OTSI-Owner Developer Handoff/`.\n\n"
        f"The shipped `SHA256_MANIFEST.txt` is kept unchanged as delivered. It lists {len(listed)} files; the package holds {len(present)} files "
        f"besides it. The rebuilt manifest of what was actually delivered is `blueprint/SHA256_MANIFEST.as-delivered.txt`; after the MySQL corrections see `blueprint/SHA256_MANIFEST.corrected.txt` and `blueprint/CORRECTIONS.md`.\n"
        f"No missing file was recreated and no obsolete PostgreSQL migration was restored (owner instruction, 2026-10-26).\n"
        + sec("Listed and identical", same) + sec("Listed but changed since the manifest was made", changed)
        + sec("Listed but not in the package (not recreated)", missing) + sec("In the package but not listed", unlisted),
        encoding="utf-8")
    print(f"present {len(present)}  listed {len(listed)}  same {len(same)}  changed {len(changed)}  missing {len(missing)}  unlisted {len(unlisted)}")


if __name__ == "__main__":
    import sys
    corrected() if "--corrected" in sys.argv else main()
