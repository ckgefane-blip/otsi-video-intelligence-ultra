"""Generate apps/web/src/lib/page-specs.generated.json from the ten approved page specifications.

For every page: its title and, for every section in the spec's "Section inventory", the section number, title, one-line visual summary and
the spec's "Proposed service contract". The web shell renders sections from this file, so the shell cannot silently drop or rename a
section, and each section shows the contract that will connect it (traceability: UI section -> API -> block).
Usage: python otsi-vie/tools/web/extract_page_specs.py [--check]   (--check: fail if the committed JSON is stale)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
SPECS = APP.parent / "blueprint" / "OTSI-Owner Developer Handoff" / "02_APPROVED_UI_IMPLEMENTATION"
OUT = APP / "apps" / "web" / "src" / "lib" / "page-specs.generated.json"


def parse(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    title = re.search(r"^# OTSI VIE — Page (\d+): (.+)$", text, re.M)
    inventory = re.findall(r"^(\d+)\. \*\*(.+?)\*\* — (.+)$", text, re.M)
    contracts = {}
    for m in re.finditer(r"^### (\d+)\. (.+?)\n(.*?)(?=^### |\Z)", text, re.M | re.S):
        c = re.search(r"\*\*Proposed service contract\.\*\* `([^`]+)`", m.group(3))
        contracts[int(m.group(1))] = c.group(1).strip() if c else None
    sections = [{"n": int(n), "title": t.strip(), "summary": s.strip(), "contract": contracts.get(int(n))} for n, t, s in inventory]
    if not title or not sections:
        raise SystemExit(f"cannot parse {path.name}")
    return {"page": int(title.group(1)), "file": path.name, "title": title.group(2).strip(), "sections": sections}


def build() -> str:
    pages = [parse(p) for p in sorted(SPECS.glob("[01][0-9]_*.md"))]
    if len(pages) != 10:
        raise SystemExit(f"expected 10 page specs, found {len(pages)}")
    return json.dumps({"source": "blueprint/OTSI-Owner Developer Handoff/02_APPROVED_UI_IMPLEMENTATION", "pages": pages}, indent=1, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    out = build()
    if "--check" in sys.argv:
        ok = OUT.exists() and OUT.read_text(encoding="utf-8") == out
        print("page specs up to date" if ok else "page-specs.generated.json is stale: re-run tools/web/extract_page_specs.py")
        sys.exit(0 if ok else 1)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(out, encoding="utf-8")
    data = json.loads(out)
    print(f"{len(data['pages'])} pages, {sum(len(p['sections']) for p in data['pages'])} sections, "
          f"{sum(1 for p in data['pages'] for s in p['sections'] if s['contract'])} with a contract -> {OUT.relative_to(APP)}")
