#!/usr/bin/env python3
"""Insert the 4 Library audit-fix keys after lbEventsMany (last key of body.library)
in the type block and all 6 locale blocks, bottom-to-top so line numbers stay valid.
Reads library-access-i18n-data.txt (key | en | ru | es | de | fr | pt)."""
import re

PATH = "src/lib/i18n/dictionaries.ts"
DATA = "scripts/library-access-i18n-data.txt"

rows = []
for line in open(DATA, encoding="utf-8"):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = [p.strip() for p in line.split(" | ")]
    assert len(parts) == 7, f"bad row: {line}"
    rows.append(parts)  # key, en, ru, es, de, fr, pt

s = open(PATH, encoding="utf-8").read()
lines = s.split("\n")

# Anchor: the line containing lbEventsMany in each of the 7 blocks.
# The type block ends with ';' (string;), locales end with ',' except pt which has no trailing comma.
anchors = [i for i, ln in enumerate(lines) if "lbEventsMany" in ln]
assert len(anchors) == 7, f"expected 7 anchors, found {len(anchors)}: {anchors}"
print("anchors:", anchors)

# Insert bottom-to-top. Block order in file: type, en, ru, es, de, fr, pt.
# rows give values in that same order (index 0 = key/type, 1 = en, 2 = ru, 3 = es, 4 = de, 5 = fr, 6 = pt).
for bi, ai in enumerate(reversed(anchors)):
    block_idx = 6 - bi  # anchors reversed: pt first
    new_lines = []
    for key, en, ru, es, de, fr, pt in rows:
        vals = [key, en, ru, es, de, fr, pt]
        v = vals[block_idx]
        if block_idx == 0:
            new_lines.append(f"      {key}: string;")
        elif block_idx == 6:
            new_lines.append(f'      "{key}": "{v}",')
        else:
            new_lines.append(f'      {key}: "{v}",')
    # pt's last key has no trailing comma; add one to the anchor line before inserting after it.
    anchor_line = lines[ai]
    if block_idx == 6 and not anchor_line.rstrip().endswith(","):
        lines[ai] = anchor_line.rstrip() + ","
    lines[ai + 1:ai + 1] = new_lines
    print(f"block {block_idx} (anchor line {ai + 1}): inserted {len(new_lines)} keys")

open(PATH, "w", encoding="utf-8").write("\n".join(lines))
print("done")
