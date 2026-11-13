"""Insert the SOT rebuild i18n keys into dictionaries.ts (bottom-to-top so line
numbers stay valid), then apply the staged value changes.

Data: scripts/sot-rebuild-i18n-data.py (generated from the staging files in
workspace/goals/otsi-video-intelligence-engine/hidden_files/sot-rebuild-i18n/
chrome.json + pages-a/b/c/d.json). Value changes: pages-a/b.json + reconciliation.json.

Rules (proven pattern, bitten before):
- new keys go in ALL 6 locales + the type, with matching {placeholders};
- insert before each group's closing brace (== after its last key), bottom-to-top;
- pt uses quoted keys and omits the last key's trailing comma — add one first;
- value changes replace the whole value on the key's line, scoped to the
  right group inside the right locale section.
"""
import importlib.util
import json
import re

_spec = importlib.util.spec_from_file_location("sot_rebuild_i18n_data", "scripts/sot-rebuild-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

GROUP_DATA = {
    "desktop": _mod.DESKTOP_KEYS,
    "body.studio": _mod.STUDIO_KEYS,
    "body.upload": _mod.UPLOAD_KEYS,
    "body.library": _mod.LIBRARY_KEYS,
    "body.admin": _mod.ADMIN_KEYS,
    "body.players": _mod.PLAYERS_KEYS,
    "body.shell": _mod.SHELL_KEYS,
    "body.auth": _mod.AUTH_KEYS,
    "body.tactics": _mod.TACTICS_KEYS,
    "body.settings": _mod.SETTINGS_KEYS,
    "body.home": _mod.HOME_KEYS,
}

STAGE = "/home/hatch/workspace/goals/otsi-video-intelligence-engine/hidden_files/sot-rebuild-i18n/"
_recon = json.load(open(STAGE + "reconciliation.json", encoding="utf-8"))

# (group, key, {locale: new_value}) — whole-value replacement.
# pages-a: accessEveryone is en-only; ioMarkHint is NOT listed here — it is
# handled by the I/O -> I/P swap below, which produces the pages-a en value
# exactly and swaps the same letters in the other five locales.
# pages-b: inPossessionTitle / outOfPossessionTitle are en-only (the file
# says the other locales are already sentence case).
VALUE_CHANGES = [
    ("body.library", "accessEveryone", {"en": "Everyone in the organisation"}),
    ("body.tactics", "inPossessionTitle", {"en": "In possession"}),
    ("body.tactics", "outOfPossessionTitle", {"en": "Out of possession"}),
]
for vc in _recon.get("valueChanges", []):
    VALUE_CHANGES.append((vc["group"], vc["key"], vc["values"]))
# CORRECTION (2026-11-13, found by test/i18nPortuguese.test.ts): reconciliation.json
# gives pt ioMark the English wording ("I / P: mark the part to add") on the
# claim that pt had no value — but pt DID have one ("I / O: marque a parte a
# adicionar"). The English copy breaks the "leaves no value in English" rule,
# so pt takes its own wording with the same I/O -> I/P swap instead.
VALUE_CHANGES.append(("body.studio", "ioMark", {"pt": "I / P: marque a parte a adicionar"}))
# pages-a ioMarkHint is en-only in the file, but every locale's existing value
# says "I / O" — the same I/O -> I/P swap as ioMark, so swap it in all 6.
IOMARKHINT_SWAP_LOCALES = ["en", "ru", "es", "de", "fr", "pt"]

P = "src/lib/i18n/dictionaries.ts"
raw = open(P, encoding="utf-8").read()
assert "\r" not in raw, "dictionaries.ts has CR line endings — aborting"
assert raw.endswith("\n"), "dictionaries.ts has no trailing newline — aborting"
lines = raw.splitlines()

SECTIONS = [
    ("type", re.compile(r"^export interface Dictionary \{$")),
    ("en", re.compile(r"^export const en: Dictionary = \{$")),
    ("ru", re.compile(r"^export const ru: DeepPartial<Dictionary> = \{$")),
    ("es", re.compile(r"^export const es: DeepPartial<Dictionary> = \{$")),
    ("de", re.compile(r"^export const de: DeepPartial<Dictionary> = \{$")),
    ("fr", re.compile(r"^export const fr: DeepPartial<Dictionary> = \{$")),
    ("pt", re.compile(r"^export const pt: DeepPartial<Dictionary> = \{$")),
]


def section_bounds():
    starts = {}
    for name, pat in SECTIONS:
        hits = [i for i, ln in enumerate(lines) if pat.match(ln)]
        assert len(hits) == 1, (name, hits)
        starts[name] = hits[0]
    order = [n for n, _ in SECTIONS]
    bounds = {}
    for j, name in enumerate(order):
        end = starts[order[j + 1]] if j + 1 < len(order) else len(lines)
        bounds[name] = (starts[name], end)
    return bounds


BOUNDS = section_bounds()


def group_range(section, group):
    """(header_idx, close_idx) of the group block inside the section."""
    start, end = BOUNDS[section]
    if group == "desktop":
        header_re = re.compile(r'^  "?desktop"?: \{$')
        close_re = re.compile(r"^  \}[,;]$")
        search_from = start
    else:
        _, gname = group.split(".")
        body_re = re.compile(r'^  "?body"?: \{$')
        body_hits = [i for i in range(start, end) if body_re.match(lines[i])]
        assert len(body_hits) == 1, (section, "body", body_hits)
        header_re = re.compile(r'^    "?' + re.escape(gname) + r'"?: \{$')
        # NOTE: pt omits the comma on the last group's close (body.auth ends
        # with a bare `    }`), so the comma is optional here. A bare `}` at
        # indent 4 can only be this group's own close: children sit at indent 6.
        close_re = re.compile(r"^    \}[,;]?$")
        search_from = body_hits[0]
    headers = [i for i in range(search_from, end) if header_re.match(lines[i])]
    assert len(headers) == 1, (section, group, headers)
    h = headers[0]
    closes = [i for i in range(h + 1, end) if close_re.match(lines[i])]
    assert closes, (section, group, "no close")
    return h, closes[0]


def esc(v):
    return v.replace("\\", "\\\\").replace('"', '\\"')


# ---- 1. insert new keys, bottom-to-top -------------------------------------
anchors = []  # (close_idx, section, group)
for section, _ in SECTIONS:
    for group in GROUP_DATA:
        _, close = group_range(section, group)
        anchors.append((close, section, group))
anchors.sort(key=lambda a: -a[0])

for close, section, group in anchors:
    data = GROUP_DATA[group]
    lang = "en" if section == "type" else section
    ind = "    " if group == "desktop" else "      "
    prev = lines[close - 1]
    if section == "type":
        assert prev.rstrip().endswith(";"), (section, group, prev)
        new_lines = [f"{ind}{k}: string;" for k in data]
    else:
        if not prev.rstrip().endswith(","):
            lines[close - 1] = prev.rstrip() + ","
            print(f"added missing trailing comma: {section}/{group} line {close}")
        quoted = section == "pt"
        if quoted:
            new_lines = [f'{ind}"{k}": "{esc(data[k][lang])}",' for k in data]
        else:
            new_lines = [f'{ind}{k}: "{esc(data[k][lang])}",' for k in data]
    lines[close:close] = new_lines
    print(f"inserted {len(new_lines)} {group} keys before line {close + 1} ({section})")

# re-derive bounds: insertions shifted everything below the first anchor
BOUNDS = section_bounds()


def key_line(section, group, key):
    header, close = group_range(section, group)
    pat = re.compile(r'^(\s*)"?(' + re.escape(key) + r')"?\s*:\s*"((?:[^"\\]|\\.)*)"(,?)\s*$')
    hits = [i for i in range(header, close) if pat.match(lines[i])]
    assert len(hits) == 1, (section, group, key, hits)
    return hits[0], pat.match(lines[hits[0]])


def set_value(section, group, key, new_value):
    idx, m = key_line(section, group, key)
    old = m.group(3)
    # group(3) is the value WITHOUT its quotes: keep the quotes by splicing
    # exactly at its start/end.
    lines[idx] = lines[idx][: m.start(3)] + esc(new_value) + lines[idx][m.end(3):]
    print(f"value {section}/{group}.{key}: {old!r} -> {new_value!r}")


# ---- 2. value changes -------------------------------------------------------
for group, key, values in VALUE_CHANGES:
    for locale, new_value in values.items():
        section = locale  # type has no values
        set_value(section, group, key, new_value)

# ioMarkHint: I/O -> I/P in every locale's existing wording.
for locale in IOMARKHINT_SWAP_LOCALES:
    idx, m = key_line(locale, "body.studio", "ioMarkHint")
    old = m.group(3)
    assert "I / O" in old, (locale, old)
    assert "I / P" not in old, (locale, old)
    new_value = old.replace("I / O", "I / P")
    lines[idx] = lines[idx][: m.start(3)] + esc(new_value) + lines[idx][m.end(3):]
    print(f"value {locale}/body.studio.ioMarkHint: {old!r} -> {new_value!r}")

open(P, "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
print("done")
