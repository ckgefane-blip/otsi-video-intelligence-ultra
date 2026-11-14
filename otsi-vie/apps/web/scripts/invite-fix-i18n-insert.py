"""Insert the Invite-fix i18n keys into dictionaries.ts (invite + wallet groups).
Inserts the new keys after each group's last key, processing anchors in descending line
order so earlier inserts never shift a later anchor. Run from apps/web:
python3 scripts/invite-fix-i18n-insert.py
"""
import importlib.util
import re

_spec = importlib.util.spec_from_file_location("if_i18n_data", "scripts/invite-fix-i18n-data.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
KEYS = _mod.INVITE_FIX_KEYS

P = "src/lib/i18n/dictionaries.ts"
lines = open(P, encoding="utf-8").read().splitlines()

# (locale, group, anchor line, anchor key, quoted keys?)
ANCHORS = [
    ("pt", "invite", 50232, "signupBonus", True),
    ("pt", "wallet", 49771, "kindInviteReward", True),
    ("fr", "invite", 43045, "signupBonus", False),
    ("fr", "wallet", 42584, "kindInviteReward", False),
    ("de", "invite", 35868, "signupBonus", False),
    ("de", "wallet", 35407, "kindInviteReward", False),
    ("es", "invite", 28691, "signupBonus", False),
    ("es", "wallet", 28230, "kindInviteReward", False),
    ("ru", "invite", 21514, "signupBonus", False),
    ("ru", "wallet", 21053, "kindInviteReward", False),
    ("en", "invite", 14337, "signupBonus", False),
    ("en", "wallet", 13876, "kindInviteReward", False),
    ("type", "invite", 7156, "signupBonus", False),
    ("type", "wallet", 6695, "kindInviteReward", False),
]


def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


def indent_of(line: str) -> str:
    m = re.match(r"^(\s*)", line)
    return m.group(1) if m else "      "


for locale, group, last_line, anchor, quoted in ANCHORS:
    idx = last_line - 1  # 0-based index of the last key line
    old = lines[idx]
    assert anchor in old, f"{locale}/{group}: anchor line {last_line} is not {anchor}: {old}"
    ind = indent_of(old)
    group_keys = KEYS[group]
    if locale == "type":
        assert old.strip().endswith(";"), old
        new_lines = [f"{ind}{k}: string;" for k in group_keys]
    else:
        # pt omits the trailing comma on a group's last key: the anchor gains one, and the
        # new last key takes its place without one.
        if quoted:
            if not old.rstrip().endswith(","):
                lines[idx] = old + ","
                new_lines = [f'{ind}"{k}": "{esc(group_keys[k][locale])}",' for k in list(group_keys)[:-1]]
                last_key = list(group_keys)[-1]
                new_lines.append(f'{ind}"{last_key}": "{esc(group_keys[last_key][locale])}"')
            else:
                new_lines = [f'{ind}"{k}": "{esc(group_keys[k][locale])}",' for k in group_keys]
        else:
            assert old.rstrip().endswith(","), f"{locale}/{group}: anchor line {last_line} has no trailing comma: {old}"
            new_lines = [f'{ind}{k}: "{esc(group_keys[k][locale])}",' for k in group_keys]
    lines[idx + 1:idx + 1] = new_lines
    print(f"inserted {len(new_lines)} {group} keys after line {last_line} ({locale})")

open(P, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("done")
