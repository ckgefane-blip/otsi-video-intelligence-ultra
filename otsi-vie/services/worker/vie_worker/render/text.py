"""Text for rendered reels in any script (ADR-044): team and player names are Cyrillic, Greek, Vietnamese or Latin, so the renderer draws
with Inter (SIL Open Font License, the app's own font, fonts/OFL.txt), which ships split by script. Each character is drawn with the subset
whose unicode range claims it (fonts/subsets.json, from the font package's CSS); anything unclaimed falls back to the Latin subset."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

FONTS = Path(__file__).parent / "fonts"


@lru_cache(maxsize=1)
def _subsets() -> list[tuple[str, list[tuple[int, int]]]]:
    d = json.loads((FONTS / "subsets.json").read_text(encoding="utf-8"))
    return [(s["file"], [(lo, hi) for lo, hi in s["ranges"]]) for s in d["subsets"]]


@lru_cache(maxsize=4096)
def _subset_of(ch: str) -> int:
    c = ord(ch)
    for i, (_, ranges) in enumerate(_subsets()):
        if any(lo <= c <= hi for lo, hi in ranges):
            return i
    return 0


@lru_cache(maxsize=256)
def _font(i: int, size: int, bold: bool):
    from PIL import ImageFont
    f = ImageFont.truetype(str(FONTS / _subsets()[i][0]), max(8, int(size)))
    try:
        f.set_variation_by_axes([700 if bold else 450])
    except Exception:                                               # noqa: BLE001 — a FreeType without variations keeps the default weight
        pass
    return f


def _runs(s: str) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    for ch in s:
        i = out[-1][0] if ch.isspace() and out else _subset_of(ch)          # a space stays in the run it is in
        if out and out[-1][0] == i:
            out[-1] = (i, out[-1][1] + ch)
        else:
            out.append((i, ch))
    return out


def text_size(s: str, size: int, bold: bool = False) -> tuple[int, int]:
    """(width, line height) in pixels"""
    w = sum(_font(i, size, bold).getlength(part) for i, part in _runs(s))
    asc, desc = _font(0, size, bold).getmetrics()
    return int(round(w)), asc + desc


def draw_text(dr, xy: tuple[float, float], s: str, size: int, fill, bold: bool = False) -> None:
    """Draw s with its top-left at xy (the line's ascender), script by script."""
    x, y = xy
    for i, part in _runs(s):
        f = _font(i, size, bold)
        dr.text((x, y), part, font=f, fill=fill)
        x += f.getlength(part)
