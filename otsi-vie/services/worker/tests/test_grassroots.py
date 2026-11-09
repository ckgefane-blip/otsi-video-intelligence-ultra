"""Ultra-Sensitive Grassroots analysis (ADR-034): multi-scale tiles, temporal confirmation, the touchline-aware pitch filter, footage
measurements, and the ASSESS job + an ULTRA_SENSITIVE analysis on real match footage."""
from __future__ import annotations

import json
import uuid

import numpy as np
import pytest

from vie_worker.analyze import _confirm
from vie_worker.detect.base import Detection
from vie_worker.detect.hf_rtdetr import HfRtDetr
from vie_worker.detect.pitch import classify
from vie_worker.quality import blockiness, phase_shift, sharpness
from vie_worker.tracker import Observation, Track

from test_analyze import FOOTAGE, ingest, needs_real, run_all


def detector_with(grids):
    d = HfRtDetr.__new__(HfRtDetr)            # only the tiling logic, no model
    d.grids = grids
    return d


def test_multi_scale_tiles_cover_the_frame_at_each_scale():
    assert detector_with([]).passes_per_frame() == 1
    assert detector_with([2]).passes_per_frame() == 5
    d = detector_with([2, 3])
    assert d.passes_per_frame() == 14
    wins = d._windows(1080, 1920)
    assert len(wins) == 14 and wins[0] == (0, 0, 1920, 1080)
    small = wins[5:]                           # the 3x3 tiles: each about a third of the frame plus overlap, together covering it
    assert all(abs(w - 716) <= 1 and abs(h - 403) <= 1 for _, _, w, h in small)
    assert min(x for x, *_ in small) == 0 and max(x + w for x, _, w, _ in small) == 1920
    assert max(y + h for _, y, _, h in small) == 1080


def track(label, scores):
    t = Track(1, label, 0)
    t.observations = [Observation(i, i * 100_000, 0.1, 0.1, 0.01, 0.03, s, 1.0) for i, s in enumerate(scores)]
    return t


def test_temporal_confirmation_keeps_only_tracks_with_enough_hits_and_a_confident_detection():
    tracks = [track("PERSON", [0.45, 0.2, 0.15, 0.3]),      # 4 hits, one confident: kept
              track("PERSON", [0.3, 0.25, 0.2, 0.35, 0.3]),  # many weak hits, never confident: a candidate, rejected
              track("PERSON", [0.9, 0.8]),                   # confident but too short for this profile
              track("BALL", [0.31, 0.3])]                    # the ball has its own rules
    kept, rejected = _confirm(tracks, {"min_hits": 4, "min_peak": 0.4})
    assert [t.label for t in kept] == ["PERSON", "BALL"] and [t.number for t in kept] == [1, 2]
    assert rejected == {"too_few_detections": 1, "no_confident_detection": 1}


def test_touchline_filter_keeps_feet_beside_the_grass_but_not_the_stands():
    mask = np.zeros((135, 240), bool)
    mask[60:, :200] = True                     # grass: lower part of the picture, up to x = 200/240
    on_line = Detection("PERSON", 0.8, 0.84, 0.30, 0.02, 0.15)       # feet at x 0.85, y 0.45: just right of the grass edge
    stands = Detection("PERSON", 0.8, 0.40, 0.05, 0.02, 0.10)        # feet at y 0.15: far above the grass
    on_grass = Detection("PERSON", 0.8, 0.40, 0.60, 0.02, 0.10)
    assert classify([on_line, stands, on_grass], mask) == [False, False, True]
    assert classify([on_line, stands, on_grass], mask, touchline=True) == [True, False, True]


def test_footage_measures_respond_to_motion_blur_and_blocks():
    rng = np.random.default_rng(1)
    img = (rng.random((360, 640, 3)) * 255).astype(np.uint8)
    moved = np.roll(img, (6, -14), axis=(0, 1))
    dx, dy = phase_shift(img, moved)
    assert abs(dx + 14) <= 2 and abs(dy - 6) <= 2
    blurred = ((img.astype(np.float32) + np.roll(img, 1, 1) + np.roll(img, 2, 1) + np.roll(img, 1, 0)) / 4).astype(np.uint8)
    assert sharpness(blurred) < sharpness(img) / 2
    blocks = np.repeat(np.kron(rng.random((45, 80, 1)) * 255, np.ones((8, 8, 1))), 3, axis=2).astype(np.uint8)
    assert blockiness(blocks) > 1.3 > blockiness(img)


@needs_real
def test_assessment_and_ultra_sensitive_analysis_on_real_footage(stack, root, seed):
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    with root.cursor() as cur:
        cur.execute("SELECT organization_id, created_by FROM video_sources WHERE id = %s", (s["video"],))
        v = cur.fetchone()
        aid = str(uuid.uuid4())
        cur.execute("INSERT INTO video_quality_assessments (id, organization_id, video_id, requested_by) VALUES (%s, %s, %s, %s)", (aid, v["organization_id"], s["video"], v["created_by"]))
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (UUID(), %s, 'ASSESS', 'quality_assessment', %s, %s, %s)",
                    (v["organization_id"], aid, f"assess:{aid}", json.dumps({"assessment_id": aid})))
    assert run_all(stack, ["ASSESS"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT status, recommended_profile, metrics FROM video_quality_assessments WHERE id = %s", (aid,))
        a = cur.fetchone()
    m = json.loads(a["metrics"])
    assert a["status"] == "SUCCEEDED" and a["recommended_profile"] in ("STANDARD", "HIGH_ACCURACY", "ULTRA_SENSITIVE")
    assert m["resolution"] == {"width": 1920, "height": 1080} and m["frames_examined"] >= 6
    assert m["people"]["measured"] and m["people"]["people_per_frame"] > 3 and 10 < m["people"]["median_height_px"] < 200
    assert m["cost"]["seconds_per_pass"] > 0 and m["cost"]["passes_per_frame_measured"] == 5
    assert m["camera_speed_widths_per_s"] is not None and 0 < m["pitch_share"] < 1

    # the ULTRA_SENSITIVE settings (at 2 frames/s to keep the test short): every kept person track is temporally confirmed
    run = str(uuid.uuid4())
    cfg = {"profile": "ULTRA_SENSITIVE", "sample_fps": 2, "grids": [2, 3], "tiles": 3, "detector": None, "score_floor": 0.1,
           "tracker": {"high": 0.4, "low": 0.1, "min_hits": 3, "distance_weight": 0.4}, "confirm": {"min_hits": 4, "min_peak": 0.4},
           "pitch": "TOUCHLINE", "stabilize": True, "appearance": False}
    with root.cursor() as cur:
        cur.execute("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, config) VALUES (%s, %s, %s, 'test', 'QUEUED', %s)",
                    (run, s["video"], v["organization_id"], json.dumps(cfg)))
        for st in ("SHOTS", "DETECT", "TRACK"):
            cur.execute("INSERT INTO pipeline_steps (id, run_id, step_name) VALUES (UUID(), %s, %s)", (run, st))
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (UUID(), %s, 'ANALYZE', 'analysis_run', %s, %s, %s)",
                    (v["organization_id"], run, f"analyze:{run}", json.dumps({"run_id": run})))
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT config FROM pipeline_runs WHERE id = %s", (run,))
        result = json.loads(cur.fetchone()["config"])["result"]
        cur.execute("""SELECT t.id, COUNT(*) AS n, MAX(o.detector_confidence) AS peak FROM tracks t JOIN track_observations o ON o.track_id = t.id
                        WHERE t.run_id = %s AND t.class_name = 'PERSON' GROUP BY t.id""", (run,))
        persons = cur.fetchall()
    assert result["profile"] == "ULTRA_SENSITIVE" and result["passes_per_frame"] == 14 and result["stabilized"] and result["pitch_filter"] == "TOUCHLINE"
    assert set(result["candidate_tracks_rejected"]) == {"too_few_detections", "no_confident_detection"}
    assert persons and all(p["n"] >= 4 and p["peak"] >= 0.4 for p in persons)


def test_small_players_get_high_accuracy_until_ultra_is_calibrated():
    from vie_worker.quality import recommend
    m = {"issues": [{"code": "SMALL_PLAYERS", "text": ""}], "people": {"median_height_px": 30}}
    assert recommend(m) == "HIGH_ACCURACY"
    assert recommend({"issues": [], "people": {}}) == "STANDARD"


def test_playing_surface_rejects_a_separate_green_region_such_as_stand_seats():
    from vie_worker.detect.pitch import classify_surface, playing_surface
    mask = np.zeros((135, 240), bool)
    mask[80:, :] = True                       # the pitch
    mask[20:40, 50:120] = True                # green seats in the stands, separated by a non-grass band (boards)
    surf = playing_surface(mask)
    assert surf[100, 100] and not surf[30, 80]
    player = Detection("PERSON", 0.8, 0.40, 0.50, 0.02, 0.15)       # feet at y 0.65... on the pitch edge region below 80/135=0.59
    fan = Detection("PERSON", 0.8, 0.30, 0.10, 0.02, 0.15)          # feet at y 0.25: on the seats
    on_line = Detection("PERSON", 0.8, 0.40, 0.46, 0.02, 0.15)      # feet at y 0.61: on the far edge of the pitch
    assert classify_surface([player, fan, on_line], mask) == [True, False, True]


def test_players_in_a_stand_s_shadow_stay_on_the_pitch_but_a_grey_wall_and_a_railing_do_not():
    """Measured on the owner's match (30:07): sunlit grass about RGB (64, 69, 62), the turf in the stand's shadow (50, 53, 57), no green left."""
    from vie_worker.detect.pitch import grass_mask
    rng = np.random.default_rng(5)
    f = np.zeros((720, 1280, 3), np.float32)
    f[:] = (182, 179, 176)                                              # a light wall / sky above the pitch
    f[300:460] = (64, 69, 62)                                           # sunlit grass, far half
    f[460:] = (50, 53, 57)                                              # the same turf in shadow, near half: grey-blue, no green
    f[80:200, 100:500] = (50, 53, 57)                                   # a dark grey panel of the SAME colour, not joined to the pitch
    f[620:, 1000:] = (50, 53, 57)                                       # a railing in the near stand: the same grey, striped
    f[620:, 1000::12] = (150, 150, 150)
    f[300:460, 1000:1280] = (64, 69, 62)
    f += rng.normal(0, 2.0, f.shape)
    rgb = np.clip(f, 0, 255).astype(np.uint8)
    in_shade = Detection("PERSON", 0.9, 0.30, 0.70, 0.02, 0.10)          # feet at y 0.80: on the shaded turf
    in_sun = Detection("PERSON", 0.9, 0.50, 0.45, 0.02, 0.10)            # feet at y 0.55
    on_panel = Detection("PERSON", 0.9, 0.20, 0.10, 0.02, 0.15)          # feet at y 0.25: on the separate grey panel
    on_rail = Detection("PERSON", 0.9, 0.88, 0.80, 0.02, 0.15)           # feet at y 0.95: on the striped railing
    people = [in_shade, in_sun, on_panel, on_rail]
    assert classify(people, grass_mask(rgb, shade=False)) == [False, True, False, False]     # before: the player in the shadow was dropped
    assert classify(people, grass_mask(rgb)) == [True, True, False, False]


def test_cross_scale_validation_drops_weak_detections_seen_only_by_the_finest_tiles():
    from vie_worker.detect.hf_rtdetr import cross_scale_filter
    finest = 1 << 2                           # grids [2, 3]: bit 2 is the 3x3 grid
    only_fine_weak = Detection("PERSON", 0.3, 0.1, 0.1, 0.01, 0.02, finest)
    only_fine_strong = Detection("PERSON", 0.7, 0.2, 0.1, 0.01, 0.02, finest)
    two_scales_weak = Detection("PERSON", 0.3, 0.3, 0.1, 0.01, 0.02, finest | 0b10)
    ball = Detection("BALL", 0.2, 0.4, 0.1, 0.005, 0.005, finest)
    assert cross_scale_filter([only_fine_weak, only_fine_strong, two_scales_weak, ball], finest) == [only_fine_strong, two_scales_weak, ball]


def test_a_briefly_visible_player_with_a_confident_detection_is_kept():
    rule = {"min_hits": 4, "min_peak": 0.4, "strong_peak": 0.6, "strong_hits": 2}
    kept, rejected = _confirm([track("PERSON", [0.75, 0.3]), track("PERSON", [0.45, 0.3]), track("PERSON", [0.9])], rule)
    assert len(kept) == 1 and rejected == {"too_few_detections": 2, "no_confident_detection": 0}


def test_people_below_the_near_touchline_and_behind_the_perimeter_wall_are_not_players():
    from vie_worker.detect.pitch import classify_surface
    mask = np.zeros((135, 240), bool)
    mask[40:110, :] = True                                          # the pitch between the far wall (y < 40) and the near touchline
    photographer = Detection("PERSON", 0.9, 0.40, 0.70, 0.03, 0.20)  # feet at y 0.90: on the carpet below the pitch
    seated_fan = Detection("PERSON", 0.9, 0.60, 0.18, 0.02, 0.12)    # box ends at the far edge (y 0.30), wall beside the feet
    far_player = Detection("PERSON", 0.9, 0.80, 0.22, 0.02, 0.10)    # feet at y 0.32, on the grass just below the far edge
    assert classify_surface([photographer, seated_fan, far_player], mask) == [False, False, True]


def test_fragment_boxes_inside_a_player_are_suppressed_but_a_distant_player_is_not():
    from vie_worker.detect.hf_rtdetr import suppress_fragments
    body = Detection("PERSON", 0.9, 0.40, 0.40, 0.04, 0.20)
    torso = Detection("PERSON", 0.5, 0.405, 0.41, 0.035, 0.09)       # half the body box, inside it
    far = Detection("PERSON", 0.4, 0.41, 0.42, 0.008, 0.03)          # a distant player seen through the gap: tiny
    assert suppress_fragments([body, torso, far]) == [body, far]


def test_a_close_up_player_and_a_player_continuing_a_pitch_track_are_kept_but_a_crowd_is_not_absorbed():
    from vie_worker.analyze import MAX_RESCUES, continues_track
    from vie_worker.tracker import Observation, Track
    mask = np.zeros((90, 160), bool)
    mask[30:, :] = True
    mask[55:63, 70:90] = False                                             # his boots, shadow and the line he stands on
    close_up = Detection(label="PERSON", score=0.95, x=0.45, y=0.18, w=0.09, h=0.49)
    assert classify([close_up], mask) == [False] and classify([close_up], mask, touchline=True) == [True]
    t = Track(number=1, label="PERSON", shot_number=0, observations=[Observation(5, 1_000_000, 0.10, 0.50, 0.03, 0.10, 0.9, 1.0)], hits=5, last_pts_us=1_000_000)
    shaded = Detection(label="PERSON", score=0.9, x=0.105, y=0.505, w=0.03, h=0.10)
    stands = Detection(label="PERSON", score=0.9, x=0.70, y=0.85, w=0.03, h=0.10)
    rescued: dict = {}
    assert continues_track(shaded, [t], 1_166_000, rescued) and not continues_track(stands, [t], 1_166_000, rescued)
    assert not continues_track(shaded, [t], 4_000_000, {})                # not seen for 3 s: no longer a live track
    # carried off the grass sample after sample, a track stops after MAX_RESCUES until the grass confirms it again
    rescued = {}
    results = [continues_track(shaded, [t], 1_166_000, rescued) for _ in range(MAX_RESCUES + 2)]
    assert results == [True] * MAX_RESCUES + [False, False]
