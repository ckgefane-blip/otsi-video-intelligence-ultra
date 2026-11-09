"""ADR-044: the Reel Builder's overlay and branding switches, and target-lock sensitivity, in the renderer."""
from __future__ import annotations

import numpy as np

from vie_worker.render.overlays import END_S, Overlays, lower_third_alpha, match_clock
from vie_worker.render.reel import ON_PATH, MAX_INTERP_S, PathPoint, lock_rules, on_path

W, H = 640, 360
PERIODS = {"first": [100_000_000, 2_800_000_000], "second": [3_700_000_000, 6_400_000_000]}
OFF = {"vignette": 0, "score_bug": False, "lower_third": False, "watermark": False, "end_screen": False, "competition_logo_id": None, "custom_logo_id": None}


def grey() -> np.ndarray:
    return np.full((H, W, 3), 128, np.uint8)


def test_the_clock_counts_from_the_confirmed_halves_and_is_absent_outside_them():
    assert match_clock(100_000_000, PERIODS) == "00:00"
    assert match_clock(100_000_000 + 754_000_000, PERIODS) == "12:34"
    assert match_clock(3_700_000_000 + 61_000_000, PERIODS) == "46:01"           # the second half counts on from 45:00
    assert match_clock(3_000_000_000, PERIODS) is None                           # half time: no clock
    assert match_clock(500_000_000, None) is None                                # halves not confirmed: no clock


def test_the_lower_third_slides_in_holds_and_fades_out():
    assert lower_third_alpha(0.0) == (0.0, 0.0)
    slide, fade = lower_third_alpha(0.4)
    assert 0 < slide < 1 and fade == 1.0
    assert lower_third_alpha(2.0) == (1.0, 1.0)
    assert lower_third_alpha(10.0) == (0.0, 0.0)


def test_target_lock_half_way_is_the_old_rule_and_the_ends_are_strict_and_tolerant():
    assert lock_rules(0.5) == (MAX_INTERP_S, ON_PATH)
    strict, tolerant = lock_rules(0.0), lock_rules(1.0)
    assert strict[0] < MAX_INTERP_S < tolerant[0] and strict[1] < ON_PATH < tolerant[1]
    assert lock_rules(0.0, auto_track=False)[0] >= 0.6                          # the analysis's own positions are always joined
    a = [PathPoint(0, (0.5, 0.5, 0.02, 0.1), "analysis"), PathPoint(250_000, (0.5, 0.5, 0.02, 0.1), "analysis")]
    beside = PathPoint(125_000, (0.5 + 0.05, 0.5, 0.02, 0.1), "dense")            # half a body height off his line
    assert on_path(beside, a, *lock_rules(0.5)) and on_path(beside, a, *lock_rules(1.0))
    assert not on_path(beside, a, *lock_rules(0.0))


def test_with_every_switch_off_the_frame_is_untouched():
    f = grey()
    assert Overlays(W, H, OFF, {}, "A Player", None, str).apply(f, 0, 0) is f


def test_the_vignette_darkens_the_corners_not_the_middle():
    out = Overlays(W, H, {**OFF, "vignette": 1.0}, {}, None, None, str).apply(grey(), 0, 0)
    assert out[H // 2, W // 2, 0] == 128 and out[2, 2, 0] < 60


def test_score_and_time_draw_team_names_and_the_clock_but_never_a_score():
    ov = Overlays(W, H, {**OFF, "score_bug": True}, {"home": "Home FC", "away": "Away FC", "periods": PERIODS}, None, None, str)
    out = ov.apply(grey(), 100_000_000 + 5_000_000, 0)
    assert (out[10:40, W // 2 - 60:W // 2 + 60] != 128).any() and (out[:, :W // 4] == 128).all()   # drawn top-centre, not over a broadcast scoreboard top-left
    assert (out[H - 60:, :] == 128).all()                                        # nothing else
    assert set(ov._bug) == {"00:05"}
    assert not Overlays(W, H, {**OFF, "score_bug": True}, {}, None, None, str).score_bug   # nothing known: nothing drawn


def test_the_lower_third_watermark_and_logos_go_where_the_layout_says(tmp_path):
    from PIL import Image
    logo = tmp_path / "logo.png"
    Image.new("RGBA", (200, 100), (255, 0, 0, 255)).save(logo)
    s = {**OFF, "lower_third": True, "watermark": True, "competition_logo_id": "x", "custom_logo_id": "y"}
    ov = Overlays(W, H, s, {"player_club": "Club", "competition_logo_key": "c", "custom_logo_key": "u"}, "A Player", "OTSI-NGA-2026-000001", lambda k: str(logo))
    out = ov.apply(grey(), 0, 2.0).astype(int)
    red = (out[..., 0] > 200) & (out[..., 1] < 60)
    assert red[: H // 4, W * 3 // 4:].any()                                      # competition logo top-right
    assert red[H * 3 // 4:, W * 3 // 4:].any()                                   # custom logo bottom-right
    assert (out[H * 2 // 3:, : W // 3] != 128).any()                             # lower third bottom-left
    assert ov.summary()["competition_logo"] and ov.summary()["custom_logo"]
    early = ov.apply(grey(), 0, 0.0)
    assert (early[H * 2 // 3:, : W // 4] == 128).all()                           # not yet slid in


def test_the_end_screen_is_a_fading_card_of_the_given_length():
    ov = Overlays(W, H, {**OFF, "end_screen": True}, {"player_club": "Club"}, "A Player", None, str)
    frames = list(ov.end_frames(int(END_S * 25), "A Player - highlights"))
    assert len(frames) == 75 and frames[0].shape == (H, W, 3)
    assert frames[0].mean() < frames[-1].mean()
