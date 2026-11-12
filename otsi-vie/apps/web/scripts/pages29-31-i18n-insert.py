"""Insert the Pages 29-31 i18n keys (Tactical, Token counter, Welcome tour) into dictionaries.ts (bottom-to-top so line numbers stay valid)."""
import re
import importlib.util
_spec = importlib.util.spec_from_file_location("pages29_31_i18n_data", "scripts/pages29-31-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
DESKTOP_KEYS, TACTICS_KEYS, TOUR_KEYS = _mod.DESKTOP_KEYS, _mod.TACTICS_KEYS, _mod.TOUR_KEYS

P = "src/lib/i18n/dictionaries.ts"
lines = open(P, encoding="utf-8").read().splitlines()

# (locale, group, last-key 1-based line, quoted?)
# quoted=True for pt (keys are "key": "value"); type uses `key: string;`
ANCHORS = [
    ("type", "desktop", 92, False),
    ("type", "tactics", 4979, False),
    ("type", "auth", 6672, False),
    ("en", "desktop", 6778, False),
    ("en", "tactics", 11676, False),
    ("en", "auth", 13369, False),
    ("ru", "desktop", 13471, False),
    ("ru", "tactics", 18369, False),
    ("ru", "auth", 20062, False),
    ("es", "desktop", 20164, False),
    ("es", "tactics", 25062, False),
    ("es", "auth", 26755, False),
    ("de", "desktop", 26857, False),
    ("de", "tactics", 31755, False),
    ("de", "auth", 33448, False),
    ("fr", "desktop", 33550, False),
    ("fr", "tactics", 38448, False),
    ("fr", "auth", 40141, False),
    ("pt", "desktop", 40244, True),
    ("pt", "tactics", 45151, True),
    ("pt", "auth", 46844, True),
]

LOCALE = {"type": "en", "en": "en", "ru": "ru", "es": "es", "de": "de", "fr": "fr", "pt": "pt"}
DATA = {"desktop": DESKTOP_KEYS, "tactics": TACTICS_KEYS, "auth": TOUR_KEYS}

def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')

def indent_of(line: str) -> str:
    m = re.match(r"^(\s*)", line)
    return m.group(1) if m else "      "

# bottom-to-top
for locale, group, last_line, quoted in sorted(ANCHORS, key=lambda a: -a[2]):
    data = DATA[group]
    lang = LOCALE[locale]
    idx = last_line - 1  # 0-based index of the last key line
    old = lines[idx]
    ind = indent_of(old)
    # the old last key must end with a comma before we append after it (pt omits it)
    if locale == "type":
        assert old.strip().endswith(";"), old
        new_lines = [f'{ind}{k}: string;' for k in data]
    else:
        if not old.rstrip().endswith(","):
            lines[idx] = old.rstrip() + ","
        if quoted:
            new_lines = [f'{ind}"{k}": "{esc(data[k][lang])}",' for k in data]
        else:
            new_lines = [f'{ind}{k}: "{esc(data[k][lang])}",' for k in data]
    lines[idx + 1:idx + 1] = new_lines
    print(f"inserted {len(new_lines)} {group} keys after line {last_line} ({locale})")

open(P, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("done")
