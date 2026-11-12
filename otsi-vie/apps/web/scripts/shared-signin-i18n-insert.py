"""Insert the Pages 25-28 i18n keys (Shared link x2, Sign in) into dictionaries.ts (bottom-to-top so line numbers stay valid)."""
import re
import importlib.util
_spec = importlib.util.spec_from_file_location("shared_signin_i18n_data", "scripts/shared-signin-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
AUTH_KEYS, WEBAUTHN_KEYS = _mod.AUTH_KEYS, _mod.WEBAUTHN_KEYS

P = "src/lib/i18n/dictionaries.ts"
lines = open(P, encoding="utf-8").read().splitlines()

# (locale, group, last-key 1-based line, quoted?)
# quoted=True for pt (keys are "key": "value"); type uses `key: string;`
ANCHORS = [
    ("type", "auth", 6644, False),
    ("type", "webauthn", 6674, False),
    ("en", "auth", 13311, False),
    ("en", "webauthn", 13340, False),
    ("ru", "auth", 19974, False),
    ("ru", "webauthn", 20003, False),
    ("es", "auth", 26637, False),
    ("es", "webauthn", 26666, False),
    ("de", "auth", 33300, False),
    ("de", "webauthn", 33329, False),
    ("fr", "auth", 39963, False),
    ("fr", "webauthn", 39992, False),
    ("pt", "auth", 46636, True),
    ("pt", "webauthn", 46665, True),
]

LOCALE = {"type": "en", "en": "en", "ru": "ru", "es": "es", "de": "de", "fr": "fr", "pt": "pt"}

def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')

def indent_of(line: str) -> str:
    m = re.match(r"^(\s*)", line)
    return m.group(1) if m else "      "

# bottom-to-top
for locale, group, last_line, quoted in sorted(ANCHORS, key=lambda a: -a[2]):
    data = AUTH_KEYS if group == "auth" else WEBAUTHN_KEYS
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
