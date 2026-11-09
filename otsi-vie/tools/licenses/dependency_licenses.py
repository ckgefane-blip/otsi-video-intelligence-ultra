"""Dependency licence inventory (Block 00, docs/legal/LICENSE_REGISTER.md).

Reads the licences of what is ACTUALLY installed — every package in the pnpm virtual store (otsi-vie/node_modules/.pnpm) and every
distribution in the project virtualenv (.venv) — and writes docs/legal/DEPENDENCY_LICENSES.md. Each package is classified:
  permissive   MIT, ISC, BSD-*, Apache-2.0, 0BSD, BlueOak, Unlicense, CC0, Python-2.0, PSF, Zlib, MPL-2.0 (file-level copyleft, allowed)
  review       LGPL / copyleft-weak, dual licences containing GPL, CC-BY*, anything unrecognised
  blocked      GPL / AGPL / SSPL / non-commercial / no licence declared
`--check` exits non-zero when any package is not `permissive` and is not listed in the reviewed exceptions file.
Usage: python otsi-vie/tools/licenses/dependency_licenses.py [--check]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from importlib import metadata
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
OUT = APP / "docs" / "legal" / "DEPENDENCY_LICENSES.md"
EXCEPTIONS = APP / "docs" / "legal" / "reviewed_license_exceptions.json"

PERMISSIVE = re.compile(r"^(MIT|MIT-0|MIT-CMU|HPND|ISC|BSD-2-Clause|BSD-3-Clause|0BSD|Apache-2\.0|BlueOak-1\.0\.0|Unlicense|CC0-1\.0|Python-2\.0|PSF-2\.0|CNRI-Python|Zlib|MPL-2\.0)$", re.I)
BLOCKED = re.compile(r"\b(A?GPL|SSPL|BUSL|Commons-Clause|NonCommercial|CC-BY-NC)", re.I)
ALIASES = {"apache": "Apache-2.0", "apache 2.0 license": "Apache-2.0", "apache license, version 2.0": "Apache-2.0", "apache 2.0": "Apache-2.0", "apache license 2.0": "Apache-2.0", "apache software license": "Apache-2.0", "apache-2": "Apache-2.0",
           "bsd": "BSD-3-Clause", "bsd license": "BSD-3-Clause", "new bsd": "BSD-3-Clause", "mit license": "MIT", "the mit license": "MIT",
           "isc license (iscl)": "ISC", "python software foundation license": "PSF-2.0", "mozilla public license 2.0 (mpl 2.0)": "MPL-2.0"}


def norm(lic: str) -> str:
    lic = (lic or "").strip().strip("()")
    lic = re.sub(r"^(License\s*::\s*)?OSI Approved\s*::\s*", "", lic, flags=re.I)   # trove classifier prefix
    return ALIASES.get(lic.lower(), lic)


def classify(expr: str) -> str:
    if not expr:
        return "blocked"
    if BLOCKED.search(expr) and not re.search(r"\bOR\b", expr, re.I):
        return "blocked"
    # SPDX expression: "A OR B" is fine if ANY option is permissive; "A AND B" needs all permissive
    if re.search(r"\bOR\b", expr, re.I):
        return "permissive" if any(PERMISSIVE.match(norm(p)) for p in re.split(r"\s+OR\s+", expr.strip("()"), flags=re.I)) else "review"
    if re.search(r"\bAND\b", expr, re.I):
        return "permissive" if all(PERMISSIVE.match(norm(p)) for p in re.split(r"\s+AND\s+", expr.strip("()"), flags=re.I)) else "review"
    return "permissive" if PERMISSIVE.match(norm(expr)) else "review"


def license_file_guess(pkg_dir: Path) -> str:
    """No `license` field: read the package's LICENSE file and recognise only unambiguous standard texts (marked as file-derived)."""
    for f in sorted(pkg_dir.glob("LICEN[CS]E*")) + sorted(pkg_dir.glob("COPYING*")):
        head = f.read_text(encoding="utf-8", errors="replace")[:600].lower()
        if "mit license" in head or "permission is hereby granted, free of charge" in head:
            return "MIT"
        if "isc license" in head:
            return "ISC"
        if "apache license" in head and "version 2.0" in head:
            return "Apache-2.0"
    return ""


def node_packages() -> list[dict]:
    store = APP / "node_modules" / ".pnpm"
    seen: dict[tuple[str, str], dict] = {}
    for pj in store.glob("*/node_modules/**/package.json"):
        rel = pj.relative_to(store).parts
        # only the package's own manifest: <entry>/node_modules/<name>/package.json or <entry>/node_modules/@scope/<name>/package.json
        depth = len(rel) - 3
        if depth not in (1, 2) or (depth == 2 and not rel[2].startswith("@")):
            continue
        try:
            d = json.loads(pj.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not d.get("name") or not d.get("version") or d["name"].startswith("@otsi-vie/"):
            continue
        lic = d.get("license")
        if isinstance(lic, dict):
            lic = lic.get("type")
        if not lic and isinstance(d.get("licenses"), list):
            lic = " OR ".join(x.get("type", "") for x in d["licenses"] if isinstance(x, dict))
        if not lic:
            lic = license_file_guess(pj.parent)
        seen[(d["name"], d["version"])] = {"ecosystem": "npm", "name": d["name"], "version": d["version"], "license": norm(str(lic or ""))}
    return sorted(seen.values(), key=lambda x: (x["name"], x["version"]))


def python_packages() -> list[dict]:
    out = []
    for dist in metadata.distributions():
        m = dist.metadata
        lic = m.get("License-Expression") or ""
        if not lic and m.get("License") and len(m.get("License")) <= 40:
            lic = norm(m.get("License"))
        if not lic:
            classifiers = [c.split("::")[-1].strip() for c in (m.get_all("Classifier") or []) if c.startswith("License ::")]
            lic = " OR ".join(norm(c) for c in classifiers) if classifiers else norm(m.get("License") or "")
        if len(lic) > 60:                       # some packages paste the whole licence text into the field
            lic = norm(lic.splitlines()[0][:60])
        out.append({"ecosystem": "pypi", "name": m["Name"], "version": dist.version, "license": norm(lic)})
    return sorted({(p["name"].lower(), p["version"]): p for p in out}.values(), key=lambda x: x["name"].lower())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    exceptions = json.loads(EXCEPTIONS.read_text(encoding="utf-8")) if EXCEPTIONS.exists() else {}
    pkgs = node_packages() + python_packages()
    for p in pkgs:
        p["class"] = classify(p["license"])
        p["reviewed"] = exceptions.get(f'{p["ecosystem"]}:{p["name"]}')
    counts = {c: sum(1 for p in pkgs if p["class"] == c) for c in ("permissive", "review", "blocked")}
    open_items = [p for p in pkgs if p["class"] != "permissive" and not p["reviewed"]]
    lines = [
        "# Dependency licences (generated — do not edit)", "",
        "Generated by `python otsi-vie/tools/licenses/dependency_licenses.py` from the INSTALLED pnpm store and project virtualenv.",
        "Covers source dependencies only; model weights, datasets, codecs, fonts and media are in `LICENSE_REGISTER.md`.", "",
        f"Packages: {len(pkgs)} — permissive {counts['permissive']}, needs review {counts['review']}, blocked {counts['blocked']}; "
        f"unreviewed non-permissive: {len(open_items)}.", "",
        "## Not permissive, or reviewed for another reason (each needs a recorded review decision)", "",
        "| Ecosystem | Package | Version | Licence | Class | Review decision |", "|---|---|---|---|---|---|",
    ]
    lines += [f'| {p["ecosystem"]} | {p["name"]} | {p["version"]} | {p["license"] or "(none declared)"} | {p["class"]} | {p["reviewed"] or "OPEN"} |'
              for p in pkgs if p["class"] != "permissive" or p["reviewed"]] or ["| — | none | | | | |"]
    lines += ["", "## All packages", "", "| Ecosystem | Package | Version | Licence |", "|---|---|---|---|"]
    lines += [f'| {p["ecosystem"]} | {p["name"]} | {p["version"]} | {p["license"] or "(none declared)"} |' for p in pkgs]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(pkgs)} packages: {counts}; unreviewed non-permissive: {len(open_items)}")
    for p in open_items:
        print(f'  OPEN {p["ecosystem"]}:{p["name"]}@{p["version"]} [{p["license"] or "none"}] -> {p["class"]}')
    return 1 if (args.check and open_items) else 0


if __name__ == "__main__":
    sys.exit(main())
