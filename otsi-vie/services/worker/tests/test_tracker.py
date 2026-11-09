"""Tracker rules that the sampling study (ADR-028) changed or relies on. Synthetic detections, isolated from any database (ADR-020)."""
from vie_worker.detect.base import Detection
from vie_worker.tracker import Tracker


def person(x, y, score=0.9, h=0.06):
    return Detection("PERSON", score, x, y, h * 0.4, h)


def ball(x, y, score=0.45):
    return Detection("BALL", score, x, y, 0.008, 0.014)


def test_the_ball_is_tracked_across_sparse_samples_although_its_boxes_never_overlap():
    t = Tracker()
    # 2 analysed frames per second; the ball travels 0.1 frame widths between samples (far more than its own size)
    for k in range(6):
        t.update(k * 15, k * 500_000, [ball(0.2 + 0.1 * k, 0.5)])
    balls = [x for x in t.results() if x.label == "BALL"]
    assert len(balls) == 1 and len(balls[0].observations) == 6


def test_a_ball_that_jumps_further_than_physically_possible_starts_a_new_track():
    t = Tracker(ball_speed=0.8)
    t.update(0, 0, [ball(0.05, 0.5)])
    t.update(15, 500_000, [ball(0.10, 0.5)])
    t.update(30, 1_000_000, [ball(0.95, 0.5)])         # 0.85 frame widths in 0.5 s: another object, not the same ball
    t.update(45, 1_500_000, [ball(0.93, 0.5)])
    balls = [x for x in t.results() if x.label == "BALL"]
    assert [len(b.observations) for b in balls] == [2, 2]


def test_a_low_score_ball_can_start_a_track():
    t = Tracker()
    t.update(0, 0, [ball(0.5, 0.5, score=0.35)])
    t.update(15, 500_000, [ball(0.52, 0.5, score=0.33)])
    assert [len(b.observations) for b in t.results() if b.label == "BALL"] == [2]


def test_camera_shift_keeps_players_associated_through_a_fast_pan():
    # every player stays still on the pitch; the camera pans by 0.08 frame widths between samples (player width 0.024)
    def frames(shift_known):
        t = Tracker()
        for k in range(4):
            dets = [person(0.3 + 0.1 * i - 0.08 * k, 0.5) for i in range(3)]
            t.update(k * 15, k * 500_000, dets, camera_shift=(-0.08, 0.0) if shift_known and k else None)
        return [x for x in t.results() if x.label == "PERSON"]
    assert sorted(len(x.observations) for x in frames(True)) == [4, 4, 4]
    assert all(len(x.observations) < 4 for x in frames(False))     # without it, no player is followed through the pan


def test_a_cut_ends_every_track_and_nothing_is_bridged():
    t = Tracker()
    for k in range(3):
        t.update(k, k * 500_000, [person(0.4, 0.5)])
    t.end_all()
    for k in range(3, 6):
        t.update(k, k * 500_000, [person(0.4, 0.5)])
    tracks = t.results()
    assert [len(x.observations) for x in tracks] == [3, 3] and tracks[0].shot_number != tracks[1].shot_number
