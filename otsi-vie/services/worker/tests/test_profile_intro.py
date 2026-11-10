"""Player Profile Intro (ADR-130): the 16:9 opening segment, rendered first in vie-render from the snapshot the API fixes into the
render as `profile_intro` (cfg["profile"] is the export profile REEL / SCOUT / …, not this).

No fixtures and no pytest import, so the same file runs under the repo's pytest on the owner's host and under a direct-import runner
here (pytest cannot run here: tests/conftest.py needs .local/mysql-lint.env + MySQL 3507 on the owner's host)."""
from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np

from vie_worker.render.headless import resolve_manifest
from vie_worker.render.overlays import PROFILE_S, Overlays, profile_detail_lines, profile_intro_on, profile_stat_lines, profile_stat_text
from vie_worker.render.reel import opening_frames

W, H = 640, 360
OFF = {"vignette": 0, "score_bug": False, "lower_third": False, "watermark": False, "end_screen": False,
       "competition_logo_id": None, "custom_logo_id": None}
ON = {**OFF, "match_card": True}

FULL = {
    "name": "Chinazom Godwin", "number": 9, "position": "Forward", "otsi_id": "OTSI-NGA-2026-000001",
    "club": "FC Ercakhu", "club_source": "ROSTER", "nationality": "Nigeria", "age": 24, "birth_date": "2002-03-12",
    "height_cm": 182, "weight_kg": 78, "foot": "Right",
    "games_analysed": 12, "minutes_seen": 1040, "goals": 5, "assists": None,
    "strengths": ["Pace", "Finishing", "Movement", "Pressing", "Aerial duels", "Work rate", "A seventh strength, dropped"],
    "summary": "A quick forward who stretches defences in behind and finishes calmly inside the box.",
    "league": "Abkhazia Premier League",
    "international": {"country": "Nigeria", "caps": 3, "goals": 1},
    "verified": True, "photo_key": None,
    "heat": {"cols": 4, "rows": 3, "seconds": [0, 5, 40, 120, 10, 60, 200, 90, 0, 20, 80, 30], "length_m": 105, "width_m": 68},
}
MINIMAL = {
    "name": "Unnamed Player", "number": None, "position": None, "otsi_id": None,
    "club": None, "club_source": None, "nationality": None, "age": None, "birth_date": None,
    "height_cm": None, "weight_kg": None, "foot": None,
    "games_analysed": None, "minutes_seen": None, "goals": None, "assists": None,
    "strengths": [], "summary": None, "league": None, "international": None,
    "verified": False, "photo_key": None, "heat": None,
}


def _ov(settings=None, profile=None, w=W, h=H, resolve=str):
    return Overlays(w, h, settings if settings is not None else OFF, {}, None, None, resolve, profile_intro=profile)


def test_profile_frames_yields_n_frames_of_the_right_shape_and_dtype():
    assert PROFILE_S == 6.0 and int(round(PROFILE_S * 25)) == 150
    for w, h, prof, n in ((1920, 1080, FULL, 150), (W, H, FULL, 12), (W, H, MINIMAL, 12), (720, 1280, FULL, 6)):
        frames = list(_ov(profile=prof, w=w, h=h).profile_frames(n, prof))
        assert len(frames) == n
        assert frames[0].shape == (h, w, 3) and frames[0].dtype == np.uint8
        if n >= 20:                                                   # a short run has fade_n == 1: no ramp to check
            assert frames[0].mean() < frames[n // 2].mean()          # fades in, like the match card
        assert frames[n // 2].std() > 0                               # something was drawn, not a flat card
    # a photo key that does not resolve draws the placeholder, it never crashes
    frames = list(_ov(profile={**FULL, "photo_key": "org/x/players/missing.jpg"}, resolve=lambda k: "/nonexistent/" + k)
                  .profile_frames(6, {**FULL, "photo_key": "org/x/players/missing.jpg"}))
    assert len(frames) == 6 and frames[0].shape == (H, W, 3)
    # a photo key that does resolve is drawn in the photo box (left, top)
    with tempfile.TemporaryDirectory() as d:
        photo = Path(d) / "photo.png"
        from PIL import Image
        Image.new("RGBA", (400, 400), (255, 0, 0, 255)).save(photo)
        prof = {**FULL, "photo_key": "players/p.png"}
        frame = list(_ov(profile=prof, resolve=lambda k: str(photo)).profile_frames(2, prof))[1].astype(int)
        red = (frame[..., 0] > 200) & (frame[..., 1] < 60) & (frame[..., 2] < 60)
        assert red[: H // 2, : W // 3].any()                          # the red photo is in the photo box


def test_the_intro_runs_only_with_the_setting_on_and_a_profile_snapshot():
    assert profile_intro_on({}, FULL)                                # the setting defaults on (contracts)
    assert profile_intro_on({"profile_intro": True}, FULL)
    assert not profile_intro_on({"profile_intro": False}, FULL)
    assert not profile_intro_on({"profile_intro": True}, None)        # an older snapshot without one: nothing, no failure
    assert not profile_intro_on({}, "REEL")                           # cfg["profile"] is the export profile, not a snapshot
    assert _ov(ON, FULL).summary()["profile_intro"] is True
    assert _ov(ON, FULL).summary()["profile_intro_s"] == PROFILE_S
    assert _ov({**ON, "profile_intro": False}, FULL).summary()["profile_intro"] is False
    assert _ov(ON, None).summary()["profile_intro"] is False
    assert _ov(ON, None).summary()["profile_intro_s"] == 0


def test_opening_frames_puts_the_profile_first_then_the_match_card():
    ov = Overlays(W, H, ON, {"home": "Home FC", "away": "Away FC"}, None, None, str, profile_intro=FULL)
    prof = list(ov.profile_frames(6, FULL))
    card = list(ov.card_frames(3))
    frames = list(opening_frames(ov, 6, FULL, None, 3))
    assert len(frames) == 9
    assert np.array_equal(frames[0], prof[0])                        # the intro is first
    assert np.array_equal(frames[6], card[0])                        # the match card follows it
    assert np.array_equal(list(opening_frames(ov, 0, None, None, 3))[0], card[0])   # no profile: the card is first, as before
    assert len(list(opening_frames(ov, 0, None, None, 0))) == 0


def test_the_verified_badge_is_drawn_only_when_the_snapshot_says_so():
    # What this checks, honestly: the badge-green pill pixels in the top-right corner exist on the verified frame and not on the
    # unverified one (same profile otherwise). The badge rule itself (registered + confirmed + reel current) lives in the contracts'
    # introVerified(); the worker only reads snapshot["verified"].
    def badge_pixels(verified: bool) -> bool:
        prof = {**FULL, "verified": verified}
        frame = list(_ov(profile=prof).profile_frames(10, prof))[5].astype(int)
        strip = frame[: H // 7, W * 3 // 5:]                          # top-right corner, where the badge sits
        return bool(((strip[..., 1] > 150) & (strip[..., 0] < 110) & (strip[..., 2] < 130)).any())
    assert badge_pixels(True)
    assert not badge_pixels(False)
    v = list(_ov(profile=FULL).profile_frames(10, FULL))[5]
    u = list(_ov(profile={**FULL, "verified": False}).profile_frames(10, {**FULL, "verified": False}))[5]
    assert not np.array_equal(v, u)                                   # the two frames differ only by the badge


def test_unmeasured_stats_render_as_not_measured():
    assert profile_stat_text(None) == "Not measured"
    assert profile_stat_text(0) == "0"                                # a measured 0 is 0, not 'Not measured'
    assert profile_stat_text(1040) == "1,040"
    assert profile_stat_text(12) == "12"
    assert profile_stat_lines(FULL) == [("Games analysed", "12"), ("Minutes seen", "1,040"),
                                        ("Goals", "5"), ("Assists", "Not measured")]
    assert profile_stat_lines(MINIMAL) == [("Games analysed", "Not measured"), ("Minutes seen", "Not measured"),
                                           ("Goals", "Not measured"), ("Assists", "Not measured")]
    assert all(v == "Not measured" for _, v in profile_detail_lines(MINIMAL))
    assert profile_detail_lines(FULL) == [("Nationality", "Nigeria"), ("Date of birth", "12 March 2002"),
                                          ("Age", "24 years"), ("Weight", "78 kg"),
                                          ("Height", "182 cm"), ("Preferred foot", "Right")]


def test_resolve_manifest_carries_profile_intro_through_unchanged():
    snap = {"name": "A Player", "verified": True}
    plan = resolve_manifest({"source": "/tmp/match.mp4", "clips": [{"in_s": 0, "out_s": 1}],
                             "settings": {"profile_intro": False}, "profile_intro": snap}, base_dir=Path("/tmp"))
    assert plan["profile_intro"] == snap and plan["profile_intro"] is snap
    assert plan["settings"] == {"profile_intro": False}
    assert plan["source"] == "/tmp/match.mp4" and len(plan["clips"]) == 1
    plan = resolve_manifest({"source": "/tmp/match.mp4", "clips": [{"in_s": 0, "out_s": 1}]}, base_dir=Path("/tmp"))
    assert plan["profile_intro"] is None and plan["settings"] == {}
