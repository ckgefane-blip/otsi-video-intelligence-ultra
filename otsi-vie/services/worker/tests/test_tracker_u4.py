"""Track U.4: pitch-plane (2D world-coordinate) Kalman + biomechanical velocity gate (vie_worker.tracker,
vie_worker.geometry).

Synthetic detections, isolated from any database (ADR-020). The homography is built from four known
pitch-corner correspondences (a broadcast trapezoid: the far touchline is narrow in the picture, the near
one wide), so a pitch position in metres maps to a picture box and back again with no model and no footage.
"""
import numpy as np

from vie_worker.detect.base import Detection
from vie_worker.geometry import dlt, feet_pitch_position, project
from vie_worker.tracker import Tracker


def homography():
    """Pitch metres -> normalised picture for a broadcast view: far touchline (y=-34) across the top of the
    picture, near touchline (y=+34) across the bottom."""
    pitch = np.array([[-52.5, -34], [52.5, -34], [-52.5, 34], [52.5, 34]], float)
    image = np.array([[0.05, 0.15], [0.95, 0.15], [0.25, 0.90], [0.75, 0.90]], float)
    return dlt(pitch, image)


H = homography()


def box_at(pitch_pos, h=0.06):
    """A PERSON detection whose feet stand at `pitch_pos` (metres) under H: the box bottom is the feet."""
    im = project(H, np.array([pitch_pos], float))[0]
    w = h * 0.4
    return Detection("PERSON", 0.9, im[0] - w / 2, im[1] - h, w, h)


def run(pts, h=0.06, **kw):
    t = Tracker(**kw)
    for k, p in enumerate(pts):
        t.update(k * 15, k * 500_000, [box_at(p, h)])
    return t, [x for x in t.results() if x.label == "PERSON"]


# ------------------------------------------------------------------ the feet helper (geometry)
def test_feet_pitch_position_round_trips_and_rejects_what_it_cannot_place():
    for p in [(10.0, -20.0), (-40.0, 0.0), (0.0, 30.0), (52.0, -33.0)]:
        box = box_at(p)
        got = feet_pitch_position(H, (box.x, box.y, box.w, box.h))
        assert got is not None and abs(got[0] - p[0]) < 0.01 and abs(got[1] - p[1]) < 0.01
    # feet 20 m beyond the touchline: not a player standing on the pitch, so no position (never a gate)
    assert feet_pitch_position(H, (0.5, 0.9, 0.024, 0.06)) is None
    # a homography that cannot be inverted places nothing, it does not raise
    assert feet_pitch_position(np.zeros((3, 3)), (0.4, 0.5, 0.024, 0.06)) is None


# ------------------------------------------------------------------ the pitch Kalman follows a real run
def test_a_steady_run_stays_one_track_and_its_pitch_speed_is_the_true_speed():
    # 5 m/s along the far touchline, 0.5 s between samples: 2.5 m per sample
    t, tracks = run([(-20 + 2.5 * k, -30) for k in range(6)], pitch_homography=H)
    assert [len(x.observations) for x in tracks] == [6]
    assert abs(Tracker.track_pitch_speed(tracks[0]) - 5.0) < 1.0
    assert t.pitch_stats["gated"] == 0
    # the same run by the near touchline (big boxes, a different image scale) behaves identically
    t, tracks = run([(-20 + 2.5 * k, 30) for k in range(6)], h=0.12, pitch_homography=H)
    assert [len(x.observations) for x in tracks] == [6]
    assert abs(Tracker.track_pitch_speed(tracks[0]) - 5.0) < 1.0


def test_pitch_speed_is_none_before_any_calibration():
    t, tracks = run([(0, 0), (2.5, 0)])
    assert Tracker.track_pitch_speed(tracks[0]) is None
    assert t.pitch_stats == {"gated": 0, "checked": 0}


# ------------------------------------------------------------------ the velocity gate
def test_a_teleport_faster_than_any_player_starts_a_new_track():
    # near touchline, big boxes: the 8 m jump in 0.5 s (16 m/s) still overlaps in the picture, so the
    # image-plane tracker alone keeps it one track — the pitch gate is what splits it
    pts = [(0, 30), (2.5, 30), (10.5, 30), (13, 30)]
    t, tracks = run(pts, h=0.12, pitch_homography=H)
    assert [len(x.observations) for x in tracks] == [2, 2]
    assert t.pitch_stats["gated"] >= 1


def test_without_a_calibration_the_same_teleport_is_still_one_track():
    # the control: this proves the split above comes from the pitch gate, not from the image motion
    pts = [(0, 30), (2.5, 30), (10.5, 30), (13, 30)]
    _, tracks = run(pts, h=0.12)
    assert [len(x.observations) for x in tracks] == [4]


def test_the_gate_also_blocks_a_far_end_jump_the_distance_blend_would_keep():
    # far touchline, small boxes, distance_weight as the reel spotlight uses it: the image-distance blend
    # would keep an 8 m jump in 0.5 s (16 m/s) as one track without the gate
    pts = [(0, -30), (2.5, -30), (10.5, -30), (13, -30)]
    t, tracks = run(pts, pitch_homography=H, distance_weight=0.3)
    assert [len(x.observations) for x in tracks] == [2, 2]
    assert t.pitch_stats["gated"] >= 1
    _, tracks = run(pts, distance_weight=0.3)
    assert [len(x.observations) for x in tracks] == [4]


def test_the_ball_is_never_pitch_gated():
    # a shot travels far faster than 12 m/s and must never be split by a player-speed gate
    t = Tracker(pitch_homography=H)
    for k in range(4):
        t.update(k * 15, k * 500_000, [Detection("BALL", 0.45, 0.2 + 0.1 * k, 0.5, 0.008, 0.014)])
    assert [len(b.observations) for b in t.results() if b.label == "BALL"] == [4]
    assert t.pitch_stats == {"gated": 0, "checked": 0}


def test_a_sprint_just_inside_the_gate_is_kept():
    # 5.5 m in 0.5 s = 11 m/s: a genuine elite sprint, inside the 12 m/s gate (with its noise margin).
    # By the near touchline with big boxes, so the image-plane association can still propose the match
    # (mid-pitch the same sprint moves more than a box width per sample and the image tracker itself
    # fragments it — the gate can only judge matches the image tracker proposes).
    t, tracks = run([(0, 30), (5.5, 30), (11, 30), (16.5, 30)], h=0.12, pitch_homography=H)
    assert [len(x.observations) for x in tracks] == [4]
    assert t.pitch_stats["gated"] == 0
    assert abs(Tracker.track_pitch_speed(tracks[0]) - 11.0) < 1.0
