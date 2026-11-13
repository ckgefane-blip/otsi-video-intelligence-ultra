"""Insert the payment-circle i18n keys into dictionaries.ts and update the free-grant 25 -> 100 values.
Runs the value updates first (they sit above the insertion point, so line numbers stay valid), then
inserts the new keys bottom-to-top so the anchor line numbers stay valid."""
import re
import importlib.util

_spec = importlib.util.spec_from_file_location("pc_i18n_data", "scripts/payment-circle-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
BILLING_KEYS, FREE_GRANT_UPDATES = _mod.BILLING_KEYS, _mod.FREE_GRANT_UPDATES

P = "src/lib/i18n/dictionaries.ts"
lines = open(P, encoding="utf-8").read().splitlines()
LOCALES = ["en", "ru", "es", "de", "fr", "pt"]


def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


# --- 1. Free-grant value updates: each key occurs 7 times (type + 6 locales, in file order type, en,
# ru, es, de, fr, pt). The type occurrence is `key: string;` (no value); occurrences 1..6 are the values.
for key, values in FREE_GRANT_UPDATES.items():
    occ = [i for i, ln in enumerate(lines) if re.search(rf'^\s*"?{re.escape(key)}"?\s*:', ln)]
    assert len(occ) == 7, f"{key}: expected 7 occurrences, got {len(occ)}"
    assert lines[occ[0]].strip().endswith("string;"), f"{key}: type line is not a string declaration"
    for j, lang in enumerate(LOCALES):
        idx = occ[j + 1]
        old = lines[idx]
        assert "25" in old, f"{key} ({lang}): expected the old 25 value on line {idx + 1}: {old}"
        m = re.match(r'^(\s*"?\w+"?\s*:\s*").*(",\s*)$', old)
        assert m, f"{key} ({lang}): could not parse value line {idx + 1}: {old}"
        lines[idx] = f"{m.group(1)}{esc(values[lang])}{m.group(2)}"
        print(f"updated {key} ({lang})")

# --- 2. Insert the new keys after the wallet group's last key (wlNoLedgerHint), bottom-to-top.
ANCHORS = [
    ("type", 6361, False),
    ("en", 13194, False),
    ("ru", 20023, False),
    ("es", 26852, False),
    ("de", 33681, False),
    ("fr", 40510, False),
    ("pt", 47349, True),
]


def indent_of(line: str) -> str:
    m = re.match(r"^(\s*)", line)
    return m.group(1) if m else "      "


for locale, last_line, quoted in sorted(ANCHORS, key=lambda a: -a[1]):
    idx = last_line - 1  # 0-based index of the last key line
    old = lines[idx]
    assert "wlNoLedgerHint" in old, f"{locale}: anchor line {last_line} is not wlNoLedgerHint: {old}"
    ind = indent_of(old)
    if locale == "type":
        assert old.strip().endswith(";"), old
        new_lines = [f"{ind}{k}: string;" for k in BILLING_KEYS]
    else:
        if not old.rstrip().endswith(","):
            lines[idx] = old.rstrip() + ","
        if quoted:
            new_lines = [f'{ind}"{k}": "{esc(BILLING_KEYS[k][locale])}",' for k in BILLING_KEYS]
        else:
            new_lines = [f'{ind}{k}: "{esc(BILLING_KEYS[k][locale])}",' for k in BILLING_KEYS]
    lines[idx + 1:idx + 1] = new_lines
    print(f"inserted {len(new_lines)} wallet keys after line {last_line} ({locale})")

open(P, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("done")
