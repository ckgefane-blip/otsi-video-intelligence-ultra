"""Regenerates the country list used in 0006_countries.sql (documentation of its origin; a deployed migration is never rewritten).
pip install pycountry==24.6.1, then compare: python otsi-vie/tools/db/gen_countries.py"""
import pycountry
for c in sorted(pycountry.countries, key=lambda c: c.alpha_3):
    print(c.alpha_3, c.name)
