"""Reel overlays and branding (ADR-044): Page 06's vignette, match score / time, competition logo, animated lower third, watermark, custom
logo and end screen, drawn on the output frames after the spotlight.

Everything drawn comes from the render's snapshot (`overlay`, fixed by the API when the render was requested): the match's team names, the
match halves a person CONFIRMED (the clock is shown only then), the player's club in the match roster, the reel's title and the logo files
whose rights declaration was checked. Nothing is measured from the picture and the score is never drawn (the engine does not measure it).

Layout: score / time top-centre (broadcasts usually carry their own scoreboard top-left), competition logo top-right, lower third bottom-left (slides in at the start of each clip), custom logo and
watermark bottom-right. The end screen is a closing card of END_S seconds after the last clip.
ADR-050: the event tag (the clip's moment, as the person added it: "Free-kick goal", "Tackle (possible)") slides in above the lower third
at the start of each clip; the match card (clubs, competition, date, venue from the match record) opens the reel for CARD_S seconds.
"""
from __future__ import annotations

from typing import Callable

import numpy as np

from .text import draw_text, text_size

END_S = 3.0
CARD_S = 3.0
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")
LOWER_IN_S, LOWER_HOLD_S, LOWER_SLIDE_S = 0.3, 3.5, 0.45
NAVY = (6, 17, 31)
ACCENT = (23, 209, 248)


def match_clock(t_us: float, periods: dict | None) -> str | None:
    """'MM:SS' of match time at source time t, from the confirmed halves (second half counts on from 45:00); None outside them."""
    if not periods:
        return None
    for k, base in (("first", 0), ("second", 45 * 60)):
        p = periods.get(k)
        if p and p[0] <= t_us <= p[1]:
            s = int(base + (t_us - p[0]) / 1e6)
            return f"{s // 60:02d}:{s % 60:02d}"
    return None


def lower_third_alpha(clip_t_s: float) -> tuple[float, float]:
    """(slide 0..1, opacity 0..1) of the lower third, seconds after the clip starts: slides in, holds, fades out."""
    t = clip_t_s - LOWER_IN_S
    if t < 0 or t > LOWER_HOLD_S:
        return 0.0, 0.0
    slide = min(1.0, t / LOWER_SLIDE_S)
    slide = 1 - (1 - slide) ** 3                                   # ease-out
    fade = min(1.0, (LOWER_HOLD_S - t) / 0.4)
    return slide, max(0.0, fade)


def _panel(lines: list[tuple[str, int, tuple[int, int, int]]], pad: int, bg=NAVY, bg_alpha=225, accent: bool = False, bold_first: bool = False) -> np.ndarray:
    """An RGBA panel with lines of (text, font size, colour), left-aligned; an accent bar on the left when asked."""
    from PIL import Image, ImageDraw
    sizes = [text_size(s, sz, bold_first and i == 0) for i, (s, sz, _) in enumerate(lines)]
    bar = max(4, pad // 2) if accent else 0
    w = bar + pad * 2 + max(sw for sw, _ in sizes)
    h = pad * 2 + sum(sh for _, sh in sizes) + pad // 3 * (len(lines) - 1)
    im = Image.new("RGBA", (int(w), int(h)), (*bg, bg_alpha))
    dr = ImageDraw.Draw(im)
    if accent:
        dr.rectangle((0, 0, bar - 1, h), fill=(*ACCENT, 255))
    y = pad
    for i, ((s, sz, c), (_, sh)) in enumerate(zip(lines, sizes)):
        draw_text(dr, (bar + pad, y), s, sz, (*c, 255), bold_first and i == 0)
        y += sh + pad // 3
    return np.asarray(im, np.float32)


def _centred_panel(lines: list[tuple[str, int, tuple[int, int, int]]], pad: int) -> np.ndarray:
    """One line of panels side by side would not centre two lines; this centres each line in the panel."""
    from PIL import Image, ImageDraw
    sizes = [text_size(s, sz, i == 0) for i, (s, sz, _) in enumerate(lines)]
    w = pad * 2 + max(sw for sw, _ in sizes)
    h = pad * 2 + sum(sh for _, sh in sizes) + pad // 3 * (len(lines) - 1)
    im = Image.new("RGBA", (int(w), int(h)), (*NAVY, 225))
    dr = ImageDraw.Draw(im)
    y = pad
    for i, ((s, sz, c), (sw, sh)) in enumerate(zip(lines, sizes)):
        draw_text(dr, ((w - sw) / 2, y), s, sz, (*c, 255), i == 0)
        y += sh + pad // 3
    return np.asarray(im, np.float32)


def _paste(out: np.ndarray, rgba: np.ndarray, x: int, y: int, alpha: float = 1.0) -> None:
    """Alpha-blend an RGBA float array onto out (float RGB) at (x, y), clipped to the frame."""
    h, w = out.shape[:2]
    ph, pw = rgba.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(w, x + pw), min(h, y + ph)
    if x1 <= x0 or y1 <= y0 or alpha <= 0:
        return
    src = rgba[y0 - y:y1 - y, x0 - x:x1 - x]
    a = src[..., 3:4] / 255 * alpha
    out[y0:y1, x0:x1] = out[y0:y1, x0:x1] * (1 - a) + src[..., :3] * a


def load_logo(path: str, max_w: int, max_h: int) -> np.ndarray | None:
    from PIL import Image
    try:
        im = Image.open(path).convert("RGBA")
    except Exception:                                             # noqa: BLE001 — an unreadable file draws nothing (recorded in the manifest)
        return None
    k = min(max_w / im.width, max_h / im.height)
    im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)
    return np.asarray(im, np.float32)


class Overlays:
    """Per-frame compositor for everything but the spotlight. `resolve` maps a storage key to a file path."""

    def __init__(self, w: int, h: int, settings: dict, overlay: dict, name: str | None, otsi_id: str | None, resolve: Callable[[str], str]):
        self.w, self.h = w, h
        self.overlay = overlay or {}
        self.name, self.otsi_id = name, otsi_id
        v = float(min(1.0, max(0.0, settings.get("vignette", 0) or 0)))
        self.vignette = None
        if v > 0:
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
            r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
            self.vignette = (1 - v * 0.85 * np.clip((r - 0.35) / 0.65, 0, 1) ** 1.6)[..., None]
        self.periods = self.overlay.get("periods")
        teams = [x for x in (self.overlay.get("home"), self.overlay.get("away")) if x]
        self.teams = "  v  ".join(teams) if len(teams) == 2 else (teams[0] if teams else None)
        self.score_bug = bool(settings.get("score_bug")) and bool(self.teams or self.periods)
        self.lower = None
        if settings.get("lower_third") and name:
            # E2 (ADR-065): the strap is bound to recorded data only: shirt number and position from the team sheet, the OTSI Player ID, the club
            num = self.overlay.get("player_number")
            sub = "  ·  ".join(x for x in (f"#{num}" if num is not None else None, self.overlay.get("player_position"), otsi_id, self.overlay.get("player_club")) if x)
            lines = [(name, h // 22, (244, 248, 255))] + ([(sub, h // 38, (180, 205, 235))] if sub else [])
            self.lower = _panel(lines, pad=max(6, h // 70), accent=True, bold_first=True)
        self.watermark = _panel([("OTSI VIE", h // 40, (255, 255, 255))], pad=max(4, h // 120), bg_alpha=0) if settings.get("watermark") else None
        key = self.overlay.get("competition_logo_key") if settings.get("competition_logo_id") else None
        self.comp_logo = load_logo(resolve(key), int(w * 0.16), int(h * 0.11)) if key else None
        key = self.overlay.get("custom_logo_key") if settings.get("custom_logo_id") else None
        self.custom_logo = load_logo(resolve(key), int(w * 0.14), int(h * 0.09)) if key else None
        self.end_screen = bool(settings.get("end_screen"))
        self.event_tags = bool(settings.get("event_tags"))          # the API always sends both; an older snapshot without them: off
        self._tags: dict[str, np.ndarray] = {}
        home, away = self.overlay.get("home_name") or self.overlay.get("home"), self.overlay.get("away_name") or self.overlay.get("away")
        self.match_card = bool(settings.get("match_card")) and bool(home and away)
        self._bug: dict[str, np.ndarray] = {}
        self.m = max(8, h // 36)                                   # margin

    def summary(self) -> dict:
        """what this render draws (for the manifest)"""
        return {"vignette": self.vignette is not None, "score_bug": self.score_bug, "clock": bool(self.periods), "lower_third": self.lower is not None,
                "watermark": self.watermark is not None, "competition_logo": self.comp_logo is not None, "custom_logo": self.custom_logo is not None,
                "end_screen": self.end_screen, "end_screen_s": END_S if self.end_screen else 0, "event_tags": self.event_tags,
                "match_card": self.match_card, "match_card_s": CARD_S if self.match_card else 0}

    @property
    def active(self) -> bool:
        return any(x is not None for x in (self.vignette, self.lower, self.watermark, self.comp_logo, self.custom_logo)) or self.score_bug

    def _bug_panel(self, clock: str | None) -> np.ndarray:
        k = clock or ""
        if k not in self._bug:
            lines = ([(self.teams, self.h // 34, (244, 248, 255))] if self.teams else []) + ([(clock, self.h // 34, ACCENT)] if clock else [])
            self._bug[k] = _centred_panel(lines, pad=max(5, self.h // 90)) if lines else np.zeros((1, 1, 4), np.float32)
        return self._bug[k]

    def _tag_panel(self, tag: str) -> np.ndarray:
        if tag not in self._tags:
            self._tags[tag] = _panel([(tag.upper(), self.h // 30, (255, 255, 255))], pad=max(5, self.h // 90), bg=(10, 60, 120), bg_alpha=235, accent=True)
        return self._tags[tag]

    def apply(self, rgb: np.ndarray, t_us: float, clip_t_s: float, tag: str | None = None) -> np.ndarray:
        tag = tag if self.event_tags and tag else None
        if not self.active and not tag:
            return rgb
        out = rgb.astype(np.float32)
        if self.vignette is not None:
            out *= self.vignette
        m = self.m
        if self.score_bug:
            bug = self._bug_panel(match_clock(t_us, self.periods))
            _paste(out, bug, (self.w - bug.shape[1]) // 2, m)
        if self.comp_logo is not None:
            _paste(out, self.comp_logo, self.w - m - self.comp_logo.shape[1], m, 0.92)
        y = self.h - m
        if self.watermark is not None:
            y -= self.watermark.shape[0]
            _paste(out, self.watermark, self.w - m - self.watermark.shape[1], y, 0.6)
        if self.custom_logo is not None:
            y -= self.custom_logo.shape[0] + m // 2
            _paste(out, self.custom_logo, self.w - m - self.custom_logo.shape[1], y, 0.92)
        if self.lower is not None:
            slide, fade = lower_third_alpha(clip_t_s)
            if fade > 0:
                lw = self.lower.shape[1]
                _paste(out, self.lower, int(-lw + (m + lw) * slide), self.h - m * 3 - self.lower.shape[0], fade)
        if tag:
            slide, fade = lower_third_alpha(clip_t_s)
            if fade > 0:
                p = self._tag_panel(tag)
                above = self.lower.shape[0] + m if self.lower is not None else 0
                _paste(out, p, int(-p.shape[1] + (m + p.shape[1]) * slide), self.h - m * 3 - above - p.shape[0], fade)
        return np.clip(out, 0, 255).astype(np.uint8)

    def card_frames(self, n: int):
        """ADR-050: the opening match card - the competition, the two clubs, the date and the venue (what the match record holds); fades in
        and out."""
        from PIL import Image, ImageDraw
        w, h, o = self.w, self.h, self.overlay
        yy = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
        base = (np.array([10, 32, 64], np.float32) * (1 - yy) + np.array([3, 10, 22], np.float32) * yy) * np.ones((1, w, 1), np.float32)
        im = Image.fromarray(base.astype(np.uint8))
        dr = ImageDraw.Draw(im)
        when = None
        if o.get("date"):
            y_, m_, d_ = (int(x) for x in str(o["date"])[:10].split("-"))
            when = f"{d_} {MONTHS[m_ - 1]} {y_}"
        rows = [(o.get("competition") or "", h // 26, ACCENT, False),
                (f"{o.get('home_name') or o.get('home')}   v   {o.get('away_name') or o.get('away')}", h // 14, (244, 248, 255), True),
                ("  ·  ".join(x for x in (when, o.get("venue")) if x), h // 28, (180, 205, 235), False)]
        heights = [text_size(s, sz, b)[1] for s, sz, _, b in rows if s]
        y = int(h / 2 - sum(heights) * 1.25 / 2)
        for s, sz, c, b in rows:
            if not s:
                continue
            tw, th = text_size(s, sz, b)
            draw_text(dr, ((w - tw) / 2, y), s, sz, c, b)
            y += int(th * 1.25)
        card = np.asarray(im, np.float32)
        if self.comp_logo is not None:
            _paste(card, self.comp_logo, (w - self.comp_logo.shape[1]) // 2, int(h * 0.30) - self.comp_logo.shape[0], 1.0)
        fade_n = max(1, int(n * 0.15))
        for i in range(n):
            yield np.clip(card * min(1.0, (i + 1) / fade_n, (n - i) / fade_n), 0, 255).astype(np.uint8)

    def end_frames(self, n: int, title: str | None):
        """The closing card: the player, his ID and club, the reel's title, the logos; fades in from black."""
        from PIL import Image, ImageDraw
        w, h = self.w, self.h
        yy = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
        base = (np.array([10, 32, 64], np.float32) * (1 - yy) + np.array([3, 10, 22], np.float32) * yy) * np.ones((1, w, 1), np.float32)
        im = Image.fromarray(base.astype(np.uint8))
        dr = ImageDraw.Draw(im)
        rows = [(self.name or "", h // 13, (244, 248, 255)),
                ("  ·  ".join(x for x in (self.otsi_id, self.overlay.get("player_club")) if x), h // 28, (180, 205, 235)),
                (title or "", h // 32, ACCENT)]
        y = int(h * 0.42)
        for i, (s, sz, c) in enumerate(rows):
            if not s:
                continue
            tw, th = text_size(s, sz, i == 0)
            draw_text(dr, ((w - tw) / 2, y), s, sz, c, i == 0)
            y += int(th * 1.25)
        if self.watermark is not None:
            s = "Made with OTSI VIE"
            tw, th = text_size(s, h // 40)
            draw_text(dr, ((w - tw) / 2, h - self.m * 2 - th), s, h // 40, (150, 175, 205))
        card = np.asarray(im, np.float32)
        logos = [x for x in (self.comp_logo, self.custom_logo) if x is not None]
        if logos:
            gap = self.m * 2
            total = sum(x.shape[1] for x in logos) + gap * (len(logos) - 1)
            x = (w - total) // 2
            for lg in logos:
                _paste(card, lg, x, int(h * 0.38) - lg.shape[0] - self.m, 1.0)
                x += lg.shape[1] + gap
        fade_n = max(1, int(n * 0.18))
        for i in range(n):
            yield np.clip(card * min(1.0, (i + 1) / fade_n), 0, 255).astype(np.uint8)
