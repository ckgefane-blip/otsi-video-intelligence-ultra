"""The per-frame follower (vie_worker.follow): crossing players keep their own tracks."""
from __future__ import annotations

from types import SimpleNamespace

import numpy as np

from vie_worker.detect.base import Detection
from vie_worker.follow import FrameStream, follow_centre, patch_shift
from vie_worker.tracker import Tracker

W, H, FPS, EVERY = 480, 270, 30, 5          # a small picture, 30 frames a second, the detector looks at every 5th (6 a second)


def scene(t: float, rng) -> tuple[np.ndarray, list[tuple[float, float]]]:
    """Grass with two players of the SAME kit: they run towards each other, meet at the middle (6 px apart) at t = 1 s and both turn back (a challenge for the
    ball). Returns the grey picture and the two centres (px)."""
    img = np.full((H, W), 90.0) + rng.normal(0, 3, (H, W))
    xs = []
    for start, sign in ((110.0, 1), (370.0, -1)):
        d = 124 * t if t <= 1.0 else 124 - 124 * (t - 1.0)          # 124 px/s towards the middle, then back the way he came
        x, y = start + sign * d, 130.0                              # level with each other
        img[int(y - 18):int(y + 18), int(x - 6):int(x + 6)] = 30.0 + rng.normal(0, 2, (36, 12))     # dark shirt and shorts
        img[int(y - 18):int(y - 12), int(x - 3):int(x + 3)] = 160.0                                   # a lighter head
        xs.append((x, y))
    return np.clip(img, 0, 255).astype(np.uint8), xs


def run(use_follow: bool) -> list[list[float]]:
    rng = np.random.default_rng(3)
    tr = Tracker(high=0.5, low=0.15, min_hits=2, distance_weight=0.3)
    frames = [scene(i / FPS, rng) for i in range(int(2.0 * FPS))]
    stream = FrameStream(iter(SimpleNamespace(pts_us=int(i * 1e6 / FPS), rgb=g) for i, (g, _) in enumerate(frames)))
    prev = None
    for i in range(0, len(frames), EVERY):
        pts = int(i * 1e6 / FPS)
        grays = stream.between(pts)
        fol = None
        if use_follow and grays:
            fol = {}
            for t in tr.active:
                if t.observations and t.observations[-1].pts_us == prev:
                    o = t.observations[-1]
                    c = follow_centre(grays, (o.x, o.y, o.w, o.h))
                    if c is not None:
                        fol[id(t)] = c
        prev = pts
        dets = [Detection("PERSON", 0.9, (x - 6) / W, (y - 18) / H, 12 / W, 36 / H) for x, y in frames[i][1]]
        tr.update(i, pts, dets, follow=fol)
    # for every track: its x positions (px) over time
    return [[(o.x + o.w / 2) * W for o in t.observations] for t in tr.results()]


def test_two_players_who_turn_back_where_they_meet_keep_their_own_tracks_when_followed():
    for xs in run(use_follow=True):
        left = xs[0] < 240
        assert all((x < 240) == left for x in xs), xs           # a track that starts on the left stays the left player (he never crossed the middle)
    swapped = any(any((x < 240) != (xs[0] < 240) for x in xs) for xs in run(use_follow=False))
    assert swapped                                                # without following, the speed guess carries each track over to the other man


def test_patch_shift_and_follow_centre_measure_a_known_move():
    rng = np.random.default_rng(1)
    a = rng.uniform(0, 255, (40, 30))
    b = np.roll(np.roll(a, 3, axis=1), -2, axis=0)
    assert patch_shift(a, b) == (3.0, -2.0)
    g0 = np.full((100, 200), 90, np.uint8); g0[40:70, 50:60] = 20
    g1 = np.full((100, 200), 90, np.uint8); g1[40:70, 54:64] = 20             # moved 4 px right
    cx, cy = follow_centre([g0, g1], (50 / 200, 40 / 100, 10 / 200, 30 / 100))
    assert abs(cx * 200 - 59) < 0.6 and abs(cy * 100 - 55) < 0.6
    assert follow_centre([g0, g1], (0.0, 0.0, 10 / 200, 30 / 100)) is None    # the patch would leave the picture
    assert follow_centre([g0], (0.2, 0.4, 0.05, 0.3)) is None                  # nothing to follow


def test_the_frame_stream_hands_over_the_frames_between_two_analysed_frames():
    fr = [SimpleNamespace(pts_us=i * 33_333, rgb=np.full((2, 2), i, np.uint8)) for i in range(11)]
    s = FrameStream(iter(fr))
    assert s.between(0) == []                                     # the first analysed frame: nothing before it
    got = s.between(5 * 33_333)
    assert [int(g[0, 0]) for g in got] == [0, 1, 2, 3, 4, 5]      # from the previous analysed frame up to and including this one
    assert [int(g[0, 0]) for g in s.between(10 * 33_333)] == [5, 6, 7, 8, 9, 10]
    assert s.between(20 * 33_333) == []                           # past the end of the video
