#!/usr/bin/env python3
"""Invite label fix (SOT audit 2026-11-13, Page 1): yourName -> 'Full name', choosePassword -> 'Password'
in all 6 locales. Replaces each key's value in file order (en, ru, es, de, fr, pt)."""
import re, sys

PATH = "src/lib/i18n/dictionaries.ts"
s = open(PATH, encoding="utf-8").read()

NEW = {
    "yourName": ["Full name", "Полное имя", "Nombre completo", "Vollständiger Name", "Nom complet", "Nome completo"],
    "choosePassword": ["Password", "Пароль", "Contraseña", "Passwort", "Mot de passe", "Senha"],
}

for key, vals in NEW.items():
    # en/ru/es/de/fr use: key: "value",   pt uses: "key": "value"
    # Find all occurrences in file order and replace with the matching locale's value.
    pat = re.compile(r'("?)' + re.escape(key) + r'\1: "([^"]*)"')
    matches = list(pat.finditer(s))
    assert len(matches) == 6, f"{key}: expected 6 occurrences, found {len(matches)}"
    out, pos = [], 0
    for i, m in enumerate(matches):
        out.append(s[pos:m.start()])
        q = m.group(1)
        out.append(f'{q}{key}{q}: "{vals[i]}"')
        pos = m.end()
    out.append(s[pos:])
    s = "".join(out)
    print(f"{key}: replaced 6 values")

open(PATH, "w", encoding="utf-8").write(s)
print("done")
