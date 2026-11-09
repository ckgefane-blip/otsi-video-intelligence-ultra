"""Track U.2: Deep-EIoU association + on-demand DINOv2 appearance gate (vie_worker.tracker).

Synthetic detections, isolated from any database (ADR-020). No model is loaded here: the appearance
provider is a callable the tests supply, so the gate is exercised without DINOv2 weights.
"""
from vie_worker.detect.base import Detection
from vie_worker.tracker import _eiou, _iou, Tracker, Track


def person(x, y, score=0.9, h=0.06):
    return Detection("PERSON", score, x, y, h * 0.4, h)


def ball(x, y, score=0.45):
    return Detection("BALL", score, x, y, 0.008, 0.014)


def track(number, x=0.4, y=0.5):
    return Track(number, "PERSON", 0)


# ------------------------------------------------------------------ Deep-EIoU
def test_eiou_is_plain_iou_at_zero_expansion_and_grows_with_it():
    a = (0.40, 0.50, 0.024, 0.06)
    b = (0.425, 0.50, 0.024, 0.06)          # just disjoint: plain IoU 0
    assert _iou(a, b) == 0.0
    assert _eiou(a, b, 0.0) == 0.0
    assert _eiou(a, b, 0.5) > 0.0           # expanded boxes overlap
    assert abs(_eiou(a, a, 0.2) - 1.0) < 1e-12   # identical boxes still score 1
    c = (0.41, 0.50, 0.024, 0.06)
    assert _iou(a, c) < _eiou(a, c, 0.2) < 1.0


def test_eiou_on_by_default_keeps_unambiguous_matches_identical():
    def run(**kw):
        t = Tracker(**kw)
        for k in range(4):
            t.update(k * 15, k * 500_000, [person(0.3 + 0.1 * i, 0.5) for i in range(3)])
        return sorted(len(x.observations) for x in t.results() if x.label == "PERSON")
    assert run() == run(eiou_expand=0.0) == [4, 4, 4]


# ------------------------------------------------------------------ the gate is on-demand: zero cost on easy matches
def test_unambiguous_matches_never_call_the_appearance_provider():
    calls = []
    t = Tracker(dino_gate=0.35, min_hits=1)
    for k in range(4):
        t.update(k * 15, k * 500_000, [person(0.3 + 0.02 * k, 0.5)], appearance_fn=lambda tr, d: calls.append((tr.number, d.x)) or 0.9)
    assert calls == [] and t.dino_stats == {"calls": 0, "forbids": 0, "ambiguous": 0}
    assert [len(x.observations) for x in t.results() if x.label == "PERSON"] == [4]


def test_two_far_apart_players_never_call_the_provider_either():
    calls = []
    t = Tracker(dino_gate=0.35, min_hits=1)
    for k in range(3):
        t.update(k * 15, k * 500_000, [person(0.2, 0.5), person(0.7, 0.5)],
                 appearance_fn=lambda tr, d: calls.append(1) or 0.9)
    assert calls == []
    assert sorted(len(x.observations) for x in t.results() if x.label == "PERSON") == [3, 3]


def test_the_ball_is_never_arbitrated():
    calls = []
    t = Tracker(dino_gate=0.35)
    for k in range(4):
        t.update(k * 15, k * 500_000, [ball(0.2 + 0.1 * k, 0.5)], appearance_fn=lambda tr, d: calls.append(1) or 0.9)
    assert calls == []
    assert [len(b.observations) for b in t.results() if b.label == "BALL"] == [4]


# ------------------------------------------------------------------ the crossing: motion prefers the swap, appearance forbids it
def crossing():
    """Two tracks whose constant-velocity predictions have crossed (A is predicted where B is, and vice versa),
    so motion alone pairs each track with the other player. The predictions mutually overlap (IoU 0.23), which is
    what marks the matches ambiguous. Returns (tracker, tracks, preds, dets)."""
    t = Tracker(dino_gate=0.35)
    tracks = [track(1), track(2)]
    preds = [(0.435, 0.50, 0.024, 0.06), (0.420, 0.50, 0.024, 0.06)]   # A predicted at B's spot, B at A's
    dets = [person(0.420, 0.50), person(0.435, 0.50)]                  # det 0 is really A, det 1 is really B
    return t, tracks, preds, dets


def test_gate_forbids_the_motion_preferred_swap_when_appearance_disagrees():
    t, tracks, preds, dets = crossing()
    # cosine(track, det): high only for the true pairing (A-det0, B-det1), low for the swapped one.
    cos = {(1, 0): 0.9, (1, 1): 0.10, (2, 0): 0.10, (2, 1): 0.9}
    matches, free_t, free_d = t._associate(tracks, preds, dets, app_fn=lambda tr, d: cos[(tr.number, dets.index(d))])
    assert sorted((i, j) for i, j, _ in matches) == [(0, 0), (1, 1)]   # each track keeps its own player
    assert t.dino_stats == {"calls": 2, "forbids": 2, "ambiguous": 2}
    assert free_t == set() and free_d == set()


def test_without_the_gate_the_same_crossing_swaps_the_tracks():
    t, tracks, preds, dets = crossing()
    t.dino_gate = None
    calls = []
    matches, _, _ = t._associate(tracks, preds, dets, app_fn=lambda tr, d: calls.append(1) or 0.1)
    assert sorted((i, j) for i, j, _ in matches) == [(0, 1), (1, 0)]   # motion alone swaps them
    assert calls == [] and t.dino_stats["calls"] == 0                  # and the provider is never consulted


def test_gate_keeps_the_match_when_appearance_agrees_or_is_unknown():
    t, tracks, preds, dets = crossing()
    matches, _, _ = t._associate(tracks, preds, dets, app_fn=lambda tr, d: 0.9)
    assert sorted((i, j) for i, j, _ in matches) == [(0, 1), (1, 0)]   # high cosine: no forbid, motion stands
    assert t.dino_stats == {"calls": 2, "forbids": 0, "ambiguous": 2}
    t2, tracks2, preds2, dets2 = crossing()
    matches, _, _ = t2._associate(tracks2, preds2, dets2, app_fn=lambda tr, d: None)
    assert sorted((i, j) for i, j, _ in matches) == [(0, 1), (1, 0)]   # unknown beats wrong: no forbid either
    assert t2.dino_stats == {"calls": 2, "forbids": 0, "ambiguous": 2}


def test_a_failing_provider_is_treated_as_unknown_not_a_crash():
    t, tracks, preds, dets = crossing()

    def boom(tr, d):
        raise RuntimeError("model unavailable")
    matches, _, _ = t._associate(tracks, preds, dets, app_fn=boom)
    assert sorted((i, j) for i, j, _ in matches) == [(0, 1), (1, 0)]
    assert t.dino_stats["forbids"] == 0


def test_a_close_rival_candidate_also_triggers_the_gate():
    # One track, two detections 0.002 apart: their motion costs are within the ambiguity margin, so the provider is asked.
    t = Tracker(dino_gate=0.35)
    tracks = [track(1)]
    preds = [(0.40, 0.50, 0.024, 0.06)]
    dets = [person(0.400, 0.50), person(0.402, 0.50)]
    calls = []
    matches, _, _ = t._associate(tracks, preds, dets, app_fn=lambda tr, d: calls.append(d.x) or 0.9)
    assert len(calls) == 1 and matches[0][1] == 0
    assert t.dino_stats["forbids"] == 0
