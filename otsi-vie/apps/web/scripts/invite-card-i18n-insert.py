"""Insert the Invite-card i18n keys into dictionaries.ts (body.invite group).

Inserts the new keys after setupCodePlaceholder (the group's last key) in the
type block and in all 6 locales. Anchors are located by their exact text (each
is unique in the file), not by line number, so the script is safe against
drift. Portuguese uses quoted keys and omits the trailing comma on the last
key, so that block is handled specially. Run from apps/web:
python3 scripts/invite-card-i18n-insert.py
"""
import importlib.util

_spec = importlib.util.spec_from_file_location("ic_i18n_data", "scripts/invite-card-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
KEYS = _mod.INVITE_CARD_KEYS
ORDER = _mod.INVITE_CARD_ORDER

P = "src/lib/i18n/dictionaries.ts"
text = open(P, encoding="utf-8").read()

# (locale, anchor text, quoted keys?)
ANCHORS = [
    ("type", "      setupCodePlaceholder: string;", False),
    ("en", '      setupCodePlaceholder: "Paste the code from your invite link",', False),
    ("ru", '      setupCodePlaceholder: "Вставьте код из ссылки-приглашения",', False),
    ("de", '      setupCodePlaceholder: "Code aus deinem Einladungslink einfügen",', False),
    ("es", '      setupCodePlaceholder: "Pega el código de tu enlace de invitación",', False),
    ("fr", '      setupCodePlaceholder: "Collez le code de votre lien d’invitation",', False),
    ("pt", '      "setupCodePlaceholder": "Cole o código do seu link de convite"', True),
]


def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


# Process in reverse file order (pt first, type last) so earlier inserts never
# shift a later anchor. The anchor texts are unique, so order only matters for
# the line positions, which we re-resolve from the text each time.
for locale, anchor, quoted in reversed(ANCHORS):
    count = text.count(anchor)
    assert count == 1, f"{locale}: anchor found {count} times, expected 1: {anchor}"
    idx = text.index(anchor)
    end = idx + len(anchor)
    if locale == "type":
        new_lines = "".join(f'\n      {k}: string;' for k in ORDER)
        text = text[:end] + new_lines + text[end:]
    elif quoted:
        # pt: the anchor line has no trailing comma (it was the last key).
        # Give it one, then add the new keys with no comma on the last.
        new_lines = "".join(
            f'\n      "{k}": "{esc(KEYS[k][locale])}"' + ("," if k != ORDER[-1] else "")
            for k in ORDER
        )
        text = text[:end] + "," + new_lines + text[end:]
    else:
        new_lines = "".join(f'\n      {k}: "{esc(KEYS[k][locale])}",' for k in ORDER)
        text = text[:end] + new_lines + text[end:]

open(P, "w", encoding="utf-8").write(text)
print("inserted invite-card keys into type + 6 locales")
