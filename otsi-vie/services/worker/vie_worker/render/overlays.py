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
PROFILE_S = 6.0                # ADR-130: the Player Profile Intro runs this long, at the very beginning of the reel
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


def profile_intro_on(settings: dict, profile: dict | None) -> bool:
    """ADR-130: the intro runs when the setting is on (default true, per the contracts) and the snapshot carries a profile dict; an older
    snapshot without one renders nothing and never fails the render. A non-dict (the export profile REEL / SCOUT / … lives under
    `profile`, not here) is not a snapshot."""
    return bool((settings or {}).get("profile_intro", True)) and isinstance(profile, dict)


def profile_stat_text(value) -> str:
    """A measured stat, or 'Not measured' where the snapshot holds null (ADR-124: unknown beats wrong). A measured 0 is '0', not
    'Not measured'. Assists are always null in the snapshot, so they always read 'Not measured'."""
    return "Not measured" if value is None else f"{int(value):,}"


def profile_stat_lines(p: dict) -> list[tuple[str, str]]:
    """The Key Performance Stats the intro draws, in order: games analysed, total minutes seen, goals, assists."""
    p = p or {}
    return [("Games analysed", profile_stat_text(p.get("games_analysed"))),
            ("Minutes seen", profile_stat_text(p.get("minutes_seen"))),
            ("Goals", profile_stat_text(p.get("goals"))),
            ("Assists", profile_stat_text(p.get("assists")))]


def profile_detail_lines(p: dict) -> list[tuple[str, str]]:
    """The identity rows the intro draws (label, value), row-major for a two-column grid; a null reads 'Not measured' (ADR-124)."""
    p = p or {}
    dob = p.get("birth_date")
    dob_s = "Not measured"
    if dob:
        try:
            y_, m_, d_ = (int(x) for x in str(dob)[:10].split("-"))
            dob_s = f"{d_} {MONTHS[m_ - 1]} {y_}"
        except Exception:                                             # noqa: BLE001 — an odd date is shown as recorded, not dropped
            dob_s = str(dob)
    age, h, wgt = p.get("age"), p.get("height_cm"), p.get("weight_kg")
    return [("Nationality", p.get("nationality") or "Not measured"),
            ("Date of birth", dob_s),
            ("Age", f"{int(age)} years" if age is not None else "Not measured"),
            ("Weight", f"{wgt:g} kg" if wgt is not None else "Not measured"),
            ("Height", f"{int(h)} cm" if h is not None else "Not measured"),
            ("Preferred foot", p.get("foot") or "Not measured")]


def _wrap_text(s: str, size: int, max_w: int, bold: bool = False) -> list[str]:
    """Word-wrap s to lines no wider than max_w (a single long word stays whole on its own line)."""
    lines, cur = [], ""
    for wd in s.split():
        t = f"{cur} {wd}".strip()
        if text_size(t, size, bold)[0] <= max_w or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = wd
    if cur:
        lines.append(cur)
    return lines


def _fit_text(s: str, size: int, max_w: int, bold: bool = False) -> str:
    """s shortened with an ellipsis until it fits max_w (a name or club never runs off the frame)."""
    if text_size(s, size, bold)[0] <= max_w:
        return s
    while s and text_size(s + "…", size, bold)[0] > max_w:
        s = s[:-1]
    return s + "…"


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

    def __init__(self, w: int, h: int, settings: dict, overlay: dict, name: str | None, otsi_id: str | None, resolve: Callable[[str], str],
                 profile_intro: dict | None = None):
        self.w, self.h = w, h
        self.overlay = overlay or {}
        self.name, self.otsi_id = name, otsi_id
        self._resolve = resolve
        # ADR-130: the Player Profile Intro snapshot (cfg["profile_intro"]); the export profile (REEL / SCOUT / …) lives under cfg["profile"]
        self.profile_intro_data = profile_intro if isinstance(profile_intro, dict) else None
        self._profile_setting = bool((settings or {}).get("profile_intro", True))
        self.profile_intro = self._profile_setting and self.profile_intro_data is not None
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
                "match_card": self.match_card, "match_card_s": CARD_S if self.match_card else 0,
                "profile_intro": self.profile_intro, "profile_intro_s": PROFILE_S if self.profile_intro else 0}

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

    def profile_frames(self, n: int, profile: dict | None = None):
        """ADR-130: the Player Profile Intro — the selected player's ACTUAL profile (the snapshot the API fixed into the render), drawn
        16:9 at the output frame size: photo or a plain silhouette (never a stock face), name and shirt number, position, OTSI PIN, club
        and league, nationality, age / date of birth, height / weight, preferred foot, the measured Key Performance Stats, his strengths
        and summary, Club & League, International Career, and a small pitch heatmap from his measured positions. Anything the snapshot
        holds as null reads 'Not measured' — never invented. The 'Player Identity Verified' badge is drawn ONLY when the snapshot says
        verified; otherwise the words 'Identity unconfirmed' (this method never decides identity itself). Fades in and out, like the
        match card. A photo key that does not resolve draws the placeholder, it never fails the render."""
        from PIL import Image, ImageDraw
        w, h, m = self.w, self.h, self.m
        p = profile if isinstance(profile, dict) else self.profile_intro_data
        if p is not None:
            self.profile_intro_data = p
            self.profile_intro = self._profile_setting
        p = p or {}
        # the photo, resolved the same way as the logos (load_logo-style, fitted); an unreadable key draws the placeholder
        px, py, pw, ph = m, int(h * 0.09), int(w * 0.20), int(h * 0.30)
        photo = None
        key = p.get("photo_key")
        if key:
            try:
                photo = load_logo(self._resolve(key), pw, ph)
            except Exception:                                             # noqa: BLE001 — an unresolvable photo draws the placeholder
                photo = None
        yy = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
        base = (np.array([10, 32, 64], np.float32) * (1 - yy) + np.array([3, 10, 22], np.float32) * yy) * np.ones((1, w, 1), np.float32)
        im = Image.fromarray(base.astype(np.uint8))
        dr = ImageDraw.Draw(im)
        muted = (150, 175, 205)
        bright, soft = (244, 248, 255), (180, 205, 235)
        draw_text(dr, (m, m), "PLAYER PROFILE", h // 45, ACCENT, True)
        # the badge: a green pill only when the snapshot says verified, else the words 'Identity unconfirmed'
        if p.get("verified"):
            bs = max(8, h // 42)
            label = "Player Identity Verified"
            tw, th = text_size(label, bs, True)
            pad = max(6, h // 90)
            bw, bh = th + pad * 3 + tw, th + pad * 2
            bx, by = w - m - bw, m
            dr.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2, fill=(22, 163, 74))
            cx, cy, r = bx + pad + th // 2, by + bh // 2, th // 2
            dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255), width=max(1, th // 8))
            dr.line([(cx - r // 2, cy), (cx - r // 6, cy + r // 3), (cx + r // 2, cy - r // 3)], fill=(255, 255, 255), width=max(1, th // 8))
            draw_text(dr, (bx + pad + th + pad, by + pad), label, bs, (255, 255, 255), True)
        else:
            s, sz = "Identity unconfirmed", max(8, h // 42)
            tw, _ = text_size(s, sz)
            draw_text(dr, (w - m - tw, m + max(6, h // 90)), s, sz, muted)
        # photo (or the plain silhouette placeholder) on the left
        if photo is None:
            cx, cy = px + pw // 2, py + int(ph * 0.32)
            r = int(pw * 0.20)
            dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(96, 116, 140))
            dr.pieslice([cx - int(pw * 0.32), py + int(ph * 0.52), cx + int(pw * 0.32), py + int(ph * 1.15)], 180, 360, fill=(96, 116, 140))
            s = "No photo"
            tw, th = text_size(s, h // 48)
            draw_text(dr, (cx - tw // 2, py + ph - th - max(4, h // 120)), s, h // 48, muted)
        # name (+ shirt number), position and OTSI PIN
        x0 = px + pw + int(w * 0.02)
        num = p.get("number")
        title = _fit_text(f"{p.get('name') or ''}  #{num}" if num is not None else (p.get("name") or ""), h // 12, w - m - x0, True)
        if title:
            draw_text(dr, (x0, int(h * 0.075)), title, h // 12, bright, True)
        sub = "  ·  ".join(x for x in (p.get("position"), f"OTSI PIN {p['otsi_id']}" if p.get("otsi_id") else "OTSI PIN: Not measured") if x)
        sub = _fit_text(sub, h // 32, w - m - x0)
        if sub:
            draw_text(dr, (x0, int(h * 0.175)), sub, h // 32, soft)
        # identity details, two columns
        rows = profile_detail_lines(p)
        col_w = int((w - m - x0) * 0.48)
        row_h = text_size("X", h // 52)[1] + text_size("X", h // 34)[1] + max(4, h // 120)
        for i, (lab, val) in enumerate(rows):
            cx = x0 + (i % 2) * int((w - m - x0) * 0.52)
            cy = int(h * 0.235) + (i // 2) * row_h
            draw_text(dr, (cx, cy), lab.upper(), h // 52, muted)
            draw_text(dr, (cx, cy + text_size("X", h // 52)[1] + max(2, h // 360)), _fit_text(val, h // 34, col_w), h // 34, bright)
        # Key Performance Stats: four boxes across the frame
        sy, sh = int(h * 0.43), int(h * 0.13)
        gap = m // 2
        bw = (w - 2 * m - 3 * gap) // 4
        for i, (lab, val) in enumerate(profile_stat_lines(p)):
            x = m + i * (bw + gap)
            dr.rounded_rectangle([x, sy, x + bw, sy + sh], radius=max(4, h // 120), fill=(8, 26, 52))
            dr.line([(x, sy), (x + bw, sy)], fill=ACCENT, width=max(2, h // 360))
            tw, th = text_size(lab, h // 48)
            draw_text(dr, (x + (bw - tw) // 2, sy + int(sh * 0.16)), lab, h // 48, muted)
            v = _fit_text(val, h // 26, bw - int(w * 0.01), True)
            tw, th = text_size(v, h // 26, True)
            draw_text(dr, (x + (bw - tw) // 2, sy + int(sh * 0.52)), v, h // 26, bright, True)
        # strengths (at most 6) and the summary, side by side
        hy = int(h * 0.585)
        sw_col = int(w * 0.40)
        draw_text(dr, (m, hy), "PLAYER STRENGTHS", h // 44, ACCENT, True)
        strengths = (p.get("strengths") or [])[:6]
        ssz, step = h // 42, int(text_size("X", h // 42)[1] * 1.12)
        if strengths:
            for j, s in enumerate(strengths):
                draw_text(dr, (m, hy + int(h * 0.032) + j * step), "• " + _fit_text(s, ssz, sw_col), ssz, bright)
        else:
            draw_text(dr, (m, hy + int(h * 0.032)), "Not measured", ssz, muted)
        sum_x, sum_w = m + int(w * 0.46), w - m - (m + int(w * 0.46))
        draw_text(dr, (sum_x, hy), "PLAYER SUMMARY", h // 44, ACCENT, True)
        summary = p.get("summary")
        if summary:
            lines = _wrap_text(summary, h // 38, sum_w)[:3]
            if len(_wrap_text(summary, h // 38, sum_w)) > 3:
                lines[-1] = _fit_text(lines[-1], h // 38, sum_w)
            for j, ln in enumerate(lines):
                draw_text(dr, (sum_x, hy + int(h * 0.032) + j * int(text_size("X", h // 38)[1] * 1.2)), ln, h // 38, bright)
        else:
            draw_text(dr, (sum_x, hy + int(h * 0.032)), "Not measured", h // 38, muted)
        # bottom band: the pitch heatmap, Club & League, International Career (only when entered)
        by0 = int(h * 0.79)
        heat = p.get("heat")
        try:
            cols, rws, secs = int(heat["cols"]), int(heat["rows"]), heat["seconds"]
            if cols <= 0 or rws <= 0 or not isinstance(secs, list) or len(secs) != cols * rws:
                heat = None
        except Exception:                                                 # noqa: BLE001 — a malformed grid draws the outline, not heat
            heat = None
        draw_text(dr, (m, by0), "POSITION HEATMAP", h // 48, ACCENT, True)
        hpy = by0 + int(h * 0.032)
        hph = h - m - hpy
        hpw = int(hph * 105 / 68)
        dr.rectangle([m, hpy, m + hpw, hpy + hph], fill=(16, 80, 50))
        if heat:
            mx = max(secs) or 0
            cw, ch = hpw / cols, hph / rws
            for r in range(rws):
                for c in range(cols):
                    f = (secs[r * cols + c] / mx) if mx > 0 else 0
                    col = tuple(int(a + (b - a) * f) for a, b in zip((16, 80, 50), (74, 222, 128)))
                    dr.rectangle([m + c * cw + 1, hpy + r * ch + 1, m + (c + 1) * cw - 1, hpy + (r + 1) * ch - 1], fill=col)
        lw = max(1, h // 540)
        line_c = (220, 235, 220)
        dr.rectangle([m, hpy, m + hpw, hpy + hph], outline=line_c, width=lw)
        dr.line([(m + hpw // 2, hpy), (m + hpw // 2, hpy + hph)], fill=line_c, width=lw)
        cr = int(hph * 0.18)
        dr.ellipse([m + hpw // 2 - cr, hpy + hph // 2 - cr, m + hpw // 2 + cr, hpy + hph // 2 + cr], outline=line_c, width=lw)
        bb_w, bb_h = int(hpw * 0.14), int(hph * 0.55)
        dr.rectangle([m, hpy + (hph - bb_h) // 2, m + bb_w, hpy + (hph + bb_h) // 2], outline=line_c, width=lw)
        dr.rectangle([m + hpw - bb_w, hpy + (hph - bb_h) // 2, m + hpw, hpy + (hph + bb_h) // 2], outline=line_c, width=lw)
        if not heat:
            s = "Not measured"
            tw, th = text_size(s, h // 48)
            draw_text(dr, (m + (hpw - tw) // 2, hpy + (hph - th) // 2), s, h // 48, line_c)
        club_x = m + hpw + int(w * 0.03)
        draw_text(dr, (club_x, by0), "CLUB & LEAGUE", h // 48, ACCENT, True)
        club_y = by0 + int(h * 0.032)
        draw_text(dr, (club_x, club_y), _fit_text(p.get("club") or "Not measured", h // 34, int(w * 0.28), True), h // 34, bright, True)
        draw_text(dr, (club_x, club_y + text_size("X", h // 34, True)[1] + max(2, h // 360)),
                  _fit_text(p.get("league") or "Not measured", h // 38, int(w * 0.28)), h // 38, soft)
        inter = p.get("international")
        if isinstance(inter, dict) and inter.get("country"):
            ix = club_x + int(w * 0.30)
            draw_text(dr, (ix, by0), "INTERNATIONAL CAREER", h // 48, ACCENT, True)
            draw_text(dr, (ix, club_y), _fit_text(inter["country"], h // 34, w - m - ix, True), h // 34, bright, True)
            caps = f"Caps {profile_stat_text(inter.get('caps'))}  ·  Goals {profile_stat_text(inter.get('goals'))}"
            draw_text(dr, (ix, club_y + text_size("X", h // 34, True)[1] + max(2, h // 360)),
                      _fit_text(caps, h // 38, w - m - ix), h // 38, soft)
        card = np.asarray(im, np.float32)
        if photo is not None:
            _paste(card, photo, px + (pw - photo.shape[1]) // 2, py + (ph - photo.shape[0]) // 2, 1.0)
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
