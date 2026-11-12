"""Insert the Settings pages 21-24 i18n keys into dictionaries.ts (bottom-to-top so line numbers stay valid)."""
import re
import importlib.util
_spec = importlib.util.spec_from_file_location("settings_i18n_data", "scripts/settings-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
SETTINGS_KEYS, WALLET_KEYS = _mod.SETTINGS_KEYS, _mod.WALLET_KEYS

P = "src/lib/i18n/dictionaries.ts"
lines = open(P, encoding="utf-8").read().splitlines()

# (locale, group, last-key 1-based line, quoted?)
# quoted=True for pt (keys are "key": "value"); type uses `key: string;`
ANCHORS = [
    ("type", "settings", 6062, False),
    ("type", "wallet", 6154, False),
    ("en", "settings", 12625, False),
    ("en", "wallet", 12717, False),
    ("ru", "settings", 19184, False),
    ("ru", "wallet", 19276, False),
    ("es", "settings", 25743, False),
    ("es", "wallet", 25835, False),
    ("de", "settings", 32302, False),
    ("de", "wallet", 32394, False),
    ("fr", "settings", 38861, False),
    ("fr", "wallet", 38953, False),
    ("pt", "settings", 45430, True),
    ("pt", "wallet", 45522, True),
]

LOCALE = {"type": "en", "en": "en", "ru": "ru", "es": "es", "de": "de", "fr": "fr", "pt": "pt"}

def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')

def indent_of(line: str) -> str:
    m = re.match(r"^(\s*)", line)
    return m.group(1) if m else "      "

# bottom-to-top
for locale, group, last_line, quoted in sorted(ANCHORS, key=lambda a: -a[2]):
    data = SETTINGS_KEYS if group == "settings" else WALLET_KEYS
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
