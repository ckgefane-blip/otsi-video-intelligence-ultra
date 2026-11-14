"""Insert the offline-wallet i18n keys into dictionaries.ts (wallet group).
Inserts the new keys after the wallet group's last key (cpRenderBatchMany), bottom-to-top
so the anchor line numbers stay valid. Run from apps/web: python3 scripts/offline-wallet-i18n-insert.py
"""
import importlib.util
import re

_spec = importlib.util.spec_from_file_location("ow_i18n_data", "scripts/offline-wallet-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
KEYS = _mod.OFFLINE_WALLET_KEYS

P = "src/lib/i18n/dictionaries.ts"
lines = open(P, encoding="utf-8").read().splitlines()

# Anchors: the wallet group's last key (cpRenderBatchMany) in each locale, verified by content.
ANCHORS = [
    ("type", 6690, False),
    ("en", 13852, False),
    ("ru", 21010, False),
    ("es", 28168, False),
    ("de", 35326, False),
    ("fr", 42484, False),
    ("pt", 49652, True),
]


def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


def indent_of(line: str) -> str:
    m = re.match(r"^(\s*)", line)
    return m.group(1) if m else "      "


for locale, last_line, quoted in sorted(ANCHORS, key=lambda a: -a[1]):
    idx = last_line - 1  # 0-based index of the last key line
    old = lines[idx]
    assert "cpRenderBatchMany" in old, f"{locale}: anchor line {last_line} is not cpRenderBatchMany: {old}"
    ind = indent_of(old)
    if locale == "type":
        assert old.strip().endswith(";"), old
        new_lines = [f"{ind}{k}: string;" for k in KEYS]
    else:
        assert old.rstrip().endswith(","), f"{locale}: anchor line {last_line} has no trailing comma: {old}"
        if quoted:
            new_lines = [f'{ind}"{k}": "{esc(KEYS[k][locale])}",' for k in KEYS]
        else:
            new_lines = [f'{ind}{k}: "{esc(KEYS[k][locale])}",' for k in KEYS]
    lines[idx + 1:idx + 1] = new_lines
    print(f"inserted {len(new_lines)} wallet keys after line {last_line} ({locale})")

open(P, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("done")
