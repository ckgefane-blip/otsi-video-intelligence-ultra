"""Insert the live-token i18n keys into dictionaries.ts (wallet group).
Inserts the new keys after the wallet group's last key (blNoProof), bottom-to-top
so the anchor line numbers stay valid."""
import importlib.util
import re

_spec = importlib.util.spec_from_file_location("lt_i18n_data", "scripts/live-token-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
KEYS = _mod.LIVE_TOKEN_KEYS

P = "src/lib/i18n/dictionaries.ts"
lines = open(P, encoding="utf-8").read().splitlines()
LOCALES = ["en", "ru", "es", "de", "fr", "pt"]

# Anchors: the wallet group's last key (blNoProof) in each locale, verified by content.
ANCHORS = [
    ("type", 6470, False),
    ("en", 13412, False),
    ("ru", 20350, False),
    ("es", 27288, False),
    ("de", 34226, False),
    ("fr", 41164, False),
    ("pt", 48112, True),
]


def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


def indent_of(line: str) -> str:
    m = re.match(r"^(\s*)", line)
    return m.group(1) if m else "      "


for locale, last_line, quoted in sorted(ANCHORS, key=lambda a: -a[1]):
    idx = last_line - 1  # 0-based index of the last key line
    old = lines[idx]
    assert "blNoProof" in old, f"{locale}: anchor line {last_line} is not blNoProof: {old}"
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
