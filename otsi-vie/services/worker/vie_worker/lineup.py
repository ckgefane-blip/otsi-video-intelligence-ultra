"""Broadcast lineup cards (ADR-039): before kick-off (and often at half-time) broadcasters show each team's sheet: team name, shirt number and
name of every starter and substitute, the head coach. Read once, it tells the engine who wears which number, so a shirt number read on a
player during the match can propose his name - and, through the player registry, his OTSI Player ID.

  PageReader       whole-frame text: PaddleOCR PP-OCRv4 detection (OpenVINO) + PP-OCRv5 recognition (Paddle Inference on the CPU: OpenVINO
                   cannot read the v5 format), a Cyrillic and a Latin reader; the one more confident over the whole card reads it. Apache-2.0
  parse_card       text lines -> a card: rows "number name" (one or two columns), the substitutes section after its heading, the coach after
                   his heading, the team name (the largest line above the rows). Headings are matched against word lists in several
                   languages; nothing here names a club, a broadcaster or a match
  is_card          a frame is a lineup card when it carries enough "number name" rows

A read card is EVIDENCE for a person to approve, never a roster by itself.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .ocr import BOX_THRESHOLD, DET_THRESHOLD, _compile, _model_dir

READ_KEYS = ("ppocr_v5_cyrillic_rec", "ppocr_v5_latin_rec")
DET_WIDTH = 1280                 # detection canvas width (frames are scaled to it; text on cards is 12-30 px high at 720 p)
MIN_ROWS = 8                     # a card has at least this many "number name" rows
ROW = re.compile(r"^\s*(\d{1,2})[\s.\-:)]*([^\d].{1,})$")
SUBS_WORDS = ("замены", "запасные", "substitutes", "subs", "bench", "reserves", "suplentes", "remplaçants", "remplacants", "ersatz",
              "ersatzbank", "panchina", "riserve", "reservas", "yedekler", "rezerwowi", "náhradníci", "zamjene", "rezerve", "αναπληρωματικοί")
COACH_WORDS = ("главный тренер", "старший тренер", "head coach", "chief coach", "primer entrenador", "cheftrainer", "тренер", "coach", "manager", "entrenador", "entraîneur", "entraineur", "trainer", "allenatore", "treinador", "técnico",
               "tecnico", "teknik direktör", "trener", "προπονητής", "head coach")


@dataclass
class Line:
    text: str
    conf: float
    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def h(self) -> int: return self.y1 - self.y0

    @property
    def cy(self) -> float: return (self.y0 + self.y1) / 2


@dataclass
class Entry:
    number: str
    name: str
    role: str                    # STARTER | SUBSTITUTE
    confidence: float


@dataclass
class Card:
    team: str | None
    coach: str | None
    entries: list[Entry] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)       # every line read (evidence)


def norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s).strip()


class PageReader:
    def __init__(self, device: str | None = None):
        import openvino as ov
        core = ov.Core()
        dd = _model_dir("ppocr_v4_det")
        self.det, self.runtime = _compile(core, core.read_model(str(dd / "inference.pdmodel")), device)
        self.recs = []
        import paddle.inference as pi
        import yaml
        for key in READ_KEYS:
            rd = _model_dir(key)
            chars = yaml.safe_load((rd / "inference.yml").read_text(encoding="utf-8"))["PostProcess"]["character_dict"]
            cfg = pi.Config(str(rd / "inference.json"), str(rd / "inference.pdiparams"))
            cfg.disable_gpu(); cfg.disable_glog_info(); cfg.set_cpu_math_library_num_threads(4)
            pred = pi.create_predictor(cfg)
            self.recs.append((pred, ["<blank>"] + [str(c) for c in chars] + [" "]))
        self.model_version = "ppocr_v4_det+" + "+".join(READ_KEYS)

    def regions(self, rgb: np.ndarray) -> list[tuple[int, int, int, int, float]]:
        """Text regions of a whole frame (DB detection on a DET_WIDTH-wide canvas; one compiled shape per frame size)."""
        from PIL import Image
        from scipy import ndimage
        h, w = rgb.shape[:2]
        s = DET_WIDTH / w
        nh, nw = int(round(h * s / 32)) * 32, DET_WIDTH
        a = np.asarray(Image.fromarray(rgb).resize((nw, nh), Image.BICUBIC), np.float32)[..., ::-1] / 255.0
        a = (a - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
        prob = self.det(a.transpose(2, 0, 1)[None])[0][0, 0]
        lab, _ = ndimage.label(prob > DET_THRESHOLD)
        out = []
        for i, sl in enumerate(ndimage.find_objects(lab), 1):
            if sl is None:
                continue
            ys, xs = sl
            score = float(prob[sl][lab[sl] == i].mean())
            bh, bw = ys.stop - ys.start, xs.stop - xs.start
            if score < BOX_THRESHOLD or bh < 4 or bw < 4:
                continue
            pad = int(round(0.5 * min(bh, bw) * 1.5 / 2 + 2))
            y0, y1, x0, x1 = max(0, ys.start - pad), min(nh, ys.stop + pad), max(0, xs.start - pad), min(nw, xs.stop + pad)
            out.append((int(x0 / nw * w), int(y0 / nh * h), int(np.ceil(x1 / nw * w)), int(np.ceil(y1 / nh * h)), score))
        return out

    def _ctc(self, pred, alphabet: list[str], crops: list[np.ndarray]) -> list[tuple[str, float]]:
        from PIL import Image
        out = []
        inp, outp = pred.get_input_handle(pred.get_input_names()[0]), pred.get_output_handle(pred.get_output_names()[0])
        for im in crops:
            cw = int(min(1600, max(16, round(im.shape[1] * 48 / max(1, im.shape[0])))))
            a = np.asarray(Image.fromarray(im).resize((cw, 48), Image.BICUBIC), np.float32)[..., ::-1] / 255.0
            x = np.ascontiguousarray(((a - 0.5) / 0.5).transpose(2, 0, 1)[None])
            inp.reshape(x.shape); inp.copy_from_cpu(x); pred.run()
            for p in outp.copy_to_cpu():
                best = p.argmax(1)
                text, confs, prev = [], [], -1
                for t, c in enumerate(best):
                    if c != prev and c != 0 and c < len(alphabet):
                        text.append(alphabet[c]); confs.append(float(p[t, c]))
                    prev = c
                out.append(("".join(text), float(np.mean(confs)) if confs else 0.0))
        return out

    def read(self, rgb: np.ndarray, regions: list | None = None) -> list[Line]:
        """Every text line of the frame, read by each recogniser; per line the more confident reading wins."""
        regions = self.regions(rgb) if regions is None else regions
        crops = [rgb[y0:y1, x0:x1] for x0, y0, x1, y1, _ in regions]
        if not crops:
            return []
        reads = [self._ctc(rec, alpha, crops) for rec, alpha in self.recs]
        # a card is written in one script: the reader that is more confident over ALL its lines reads every line (line by line, a Latin
        # reader confidently misreads Cyrillic capitals: ФК "ЕРЦАХУ" -> QK "EPUAXy")
        best = max(reads, key=lambda r: sum(c for _, c in r))
        lines = []
        for k, (x0, y0, x1, y1, _) in enumerate(regions):
            text, conf = best[k]
            if text.strip():
                lines.append(Line(norm(text), conf, x0, y0, x1, y1))
        return lines


    def read_card(self, rgb: np.ndarray) -> Card | None:
        """The frame's lineup card, or None. A shirt number the detector missed is read from the space left of its name (digits only)."""
        lines = self.read(rgb)

        def digits(ln: Line) -> str | None:
            x0, x1 = max(0, int(ln.x0 - 3.2 * ln.h)), max(0, int(ln.x0 - 0.1 * ln.h))
            if x1 - x0 < 4:
                return None
            reads = [self._ctc(pred, alpha, [rgb[ln.y0:ln.y1, x0:x1]])[0] for pred, alpha in self.recs]
            text, conf = max(reads, key=lambda r: r[1])
            text = text.strip().replace("O", "0").replace("I", "1").replace("l", "1")
            return text.lstrip("0") or "0" if re.fullmatch(r"\d{1,2}", text) and conf >= 0.6 else None
        return parse_card(lines, digits)


def rows_of(lines: list[Line]) -> list[list[Line]]:
    """Lines grouped into visual rows (vertical centres within half a line height), each row left to right."""
    rows: list[list[Line]] = []
    for ln in sorted(lines, key=lambda l: l.cy):
        if rows and abs(rows[-1][0].cy - ln.cy) <= 0.5 * max(ln.h, rows[-1][0].h):
            rows[-1].append(ln)
        else:
            rows.append([ln])
    return [sorted(r, key=lambda l: l.x0) for r in rows]


def _entries_in(row: list[Line]) -> list[tuple[str, str, float, int, Line]]:
    """'number name' entries of one visual row (a number may be its own text region, followed by the name): (number, name, conf, x, name line)."""
    out, k = [], 0
    while k < len(row):
        ln = row[k]
        m = ROW.match(ln.text)
        if m and any(ch.isalpha() for ch in m.group(2)):
            out.append((m.group(1), m.group(2).strip(), ln.conf, ln.x0, ln)); k += 1; continue
        if re.fullmatch(r"\d{1,2}", ln.text.strip()) and k + 1 < len(row) and any(ch.isalpha() for ch in row[k + 1].text) \
                and row[k + 1].x0 - ln.x1 < 4 * ln.h and not re.match(r"^\d", row[k + 1].text):
            out.append((ln.text.strip(), row[k + 1].text.strip(), min(ln.conf, row[k + 1].conf), ln.x0, row[k + 1])); k += 2; continue
        k += 1
    return out


def _has(text: str, words: tuple[str, ...]) -> bool:
    t = text.lower()
    return any(w in t for w in words)


QUALIFIERS = ("главный", "старший", "head", "chief", "primer", "first")


def parse_card(lines: list[Line], digits: "Callable[[Line], str | None] | None" = None) -> Card | None:
    """A lineup card from a frame's text lines, or None when the frame is not one. `digits` reads the shirt number printed left of a name
    line when the detector missed it (a thin "1" often is): names standing in a numbered column without a number get one that way."""
    rows = rows_of(lines)
    found = [(ri, e) for ri, r in enumerate(rows) for e in _entries_in(r)]
    if len(found) < MIN_ROWS:
        return None
    if digits:
        used = {id(e[4]) for _, e in found}
        cols = [e[4].x0 for _, e in found]
        lo = min(rows[ri][0].y0 for ri, _ in found) - 2 * max(l.h for l in lines)
        hi = max(rows[ri][0].y1 for ri, _ in found) + 2 * max(l.h for l in lines)
        for ri, r in enumerate(rows):
            for ln in r:
                if id(ln) in used or any(ch.isdigit() for ch in ln.text) or sum(ch.isalpha() for ch in ln.text) < 4 \
                        or _has(ln.text, SUBS_WORDS + COACH_WORDS) or not lo <= ln.cy <= hi or not any(abs(ln.x0 - c) <= 0.8 * ln.h for c in cols):
                    continue
                num = digits(ln)
                if num:
                    found.append((ri, (num, ln.text, ln.conf, ln.x0 - 2 * ln.h, ln)))
    # the substitutes section: entries right of / below a substitutes heading (same column or lower rows)
    subs_h = next((l for l in lines if _has(l.text, SUBS_WORDS)), None)
    coach_h = next((l for l in lines if _has(l.text, COACH_WORDS)), None)
    top_entry = min(rows[ri][0].y0 for ri, _ in found)
    entries: list[Entry] = []
    seen = set()
    for ri, (num, name, conf, x, _) in found:
        y = rows[ri][0].cy
        if coach_h and y > coach_h.cy and abs(x - coach_h.x0) < 3 * coach_h.h:
            continue                                                    # under the coach heading: not a player row
        sub = bool(subs_h and y > subs_h.cy - subs_h.h and x >= subs_h.x0 - 3 * subs_h.h)
        key = (num, sub)
        if key in seen:
            continue
        seen.add(key)
        entries.append(Entry(num.lstrip("0") or "0", re.sub(r"\s+", " ", name), "SUBSTITUTE" if sub else "STARTER", round(conf, 3)))
    coach = None
    if coach_h:
        below = sorted((l for l in lines if l.y0 >= coach_h.y1 - 2 and abs(l.x0 - coach_h.x0) < 4 * coach_h.h), key=lambda l: l.y0)
        rest = coach_h.text
        for w in sorted(COACH_WORDS + QUALIFIERS, key=len, reverse=True):
            rest = re.sub(re.escape(w), "", rest, flags=re.I)
        rest = rest.strip(" :-")
        coach = rest if sum(ch.isalpha() for ch in rest) >= 3 else (below[0].text if below else None)
    above = [l for l in lines if l.y1 <= top_entry and any(ch.isalpha() for ch in l.text) and not _has(l.text, SUBS_WORDS + COACH_WORDS)]
    team = max(above, key=lambda l: (l.h, len(l.text))).text if above else None
    return Card(team, coach, entries, [l.text for l in lines])
