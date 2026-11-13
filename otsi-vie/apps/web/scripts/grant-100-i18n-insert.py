"""Replace the three free-grant i18n values (25 -> 100) in dictionaries.ts (wallet group).

Value changes to existing keys, not new keys: each key is replaced in place at its
known line, after verifying the old value is still the 25-token wording. The type
lines (freeAdded / wlFreeOnce / wlFreeCovers: string;) are unchanged.
Run from apps/web: python3 scripts/grant-100-i18n-insert.py
"""
import importlib.util

_spec = importlib.util.spec_from_file_location("g100_i18n_data", "scripts/grant-100-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
KEYS = _mod.GRANT_100_KEYS

P = "src/lib/i18n/dictionaries.ts"
lines = open(P, encoding="utf-8").read().splitlines()

# (key, locale, 1-based line, quoted-key?) — lines verified by grep before the change.
# Old values all say 25 (freeAdded "25 ...", wlFreeOnce "25 ...", freeTitle "25 ...",
# freeDesc "25 tokens ... first 25 minutes ...", claim "Claim 25 ...").
# wlFreeCovers has no number in it; the 25-era wording is "a first try / a short analysis".
TARGETS = [
    ("freeAdded", "en", 13571, False),
    ("wlFreeOnce", "en", 13655, False),
    ("wlFreeCovers", "en", 13686, False),
    ("freeTitle", "en", 13567, False),
    ("freeDesc", "en", 13568, False),
    ("claim", "en", 13570, False),
    ("freeAdded", "ru", 20729, False),
    ("wlFreeOnce", "ru", 20813, False),
    ("wlFreeCovers", "ru", 20844, False),
    ("freeTitle", "ru", 20725, False),
    ("freeDesc", "ru", 20726, False),
    ("claim", "ru", 20728, False),
    ("freeAdded", "es", 27887, False),
    ("wlFreeOnce", "es", 27971, False),
    ("wlFreeCovers", "es", 28002, False),
    ("freeTitle", "es", 27883, False),
    ("freeDesc", "es", 27884, False),
    ("claim", "es", 27886, False),
    ("freeAdded", "de", 35045, False),
    ("wlFreeOnce", "de", 35129, False),
    ("wlFreeCovers", "de", 35160, False),
    ("freeTitle", "de", 35041, False),
    ("freeDesc", "de", 35042, False),
    ("claim", "de", 35044, False),
    ("freeAdded", "fr", 42203, False),
    ("wlFreeOnce", "fr", 42287, False),
    ("wlFreeCovers", "fr", 42318, False),
    ("freeTitle", "fr", 42199, False),
    ("freeDesc", "fr", 42200, False),
    ("claim", "fr", 42202, False),
    ("freeAdded", "pt", 49371, True),
    ("wlFreeOnce", "pt", 49455, True),
    ("wlFreeCovers", "pt", 49486, True),
    ("freeTitle", "pt", 49367, True),
    ("freeDesc", "pt", 49368, True),
    ("claim", "pt", 49370, True),
]


def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


for key, locale, line_no, quoted in TARGETS:
    idx = line_no - 1
    old = lines[idx]
    assert key in old, f"{locale} {key}: line {line_no} is not {key}: {old}"
    indent = old[: len(old) - len(old.lstrip())]
    new_val = KEYS[key][locale]
    if quoted:
        new_line = f'{indent}"{key}": "{esc(new_val)}",'
    else:
        new_line = f'{indent}{key}: "{esc(new_val)}",'
    if old == new_line:
        continue  # already at 100 (idempotent: the script ran before for the first three keys)
    if key in ("freeAdded", "wlFreeOnce", "freeTitle", "freeDesc", "claim"):
        # the 25-era value names the number; the new value names 100
        assert "25" in old, f"{locale} {key}: line {line_no} no longer says 25: {old}"
    else:
        # wlFreeCovers has no number in it; the 25-era wording is "a first try / a short analysis"
        assert "100" not in old, f"{locale} {key}: line {line_no} already says 100: {old}"
    lines[idx] = new_line

open(P, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"replaced {len(TARGETS)} grant values (25 -> 100) in dictionaries.ts")
