"""Insert the app-wide ActivityLine i18n keys into dictionaries.ts (wallet group).
Inserts the new keys after the wallet group's last key (uhAiAnalysis), bottom-to-top
so the anchor line numbers stay valid. The pt override's last key omits its trailing
comma, so the anchor there gains one and the last inserted pt key omits its own."""
import importlib.util
import re

_spec = importlib.util.spec_from_file_location("al_i18n_data", "scripts/activityline-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
KEYS = _mod.ACTIVITYLINE_KEYS

P = "src/lib/i18n/dictionaries.ts"
lines = open(P, encoding="utf-8").read().splitlines()

# Anchors: the wallet group's last key (uhAiAnalysis) in each locale, verified by content.
# (type, en, ru, es, de, fr) end with a comma; pt's last key here also ends with one
# (checked on disk — the no-trailing-comma shape does not hold for this group).
ANCHORS = [
    ("type", 6497, False, True),
    ("en", 13466, False, False),
    ("ru", 20431, False, False),
    ("es", 27396, False, False),
    ("de", 34361, False, False),
    ("fr", 41326, False, False),
    ("pt", 48301, True, False),
]


def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


def indent_of(line: str) -> str:
    m = re.match(r"^(\s*)", line)
    return m.group(1) if m else "      "


for locale, last_line, quoted, is_type in sorted(ANCHORS, key=lambda a: -a[1]):
    idx = last_line - 1  # 0-based index of the last key line
    old = lines[idx]
    assert "uhAiAnalysis" in old, f"{locale}: anchor line {last_line} is not uhAiAnalysis: {old}"
    ind = indent_of(old)
    if is_type:
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
