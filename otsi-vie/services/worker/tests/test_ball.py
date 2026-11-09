"""The engine's ball (vie_worker.ball, ADR-037) on a synthetic scene built like the owner's match: several ball candidates per frame - boots
that move with players, a logo dot printed on every shot, a crest on a close-up's shirt, a pitch mark under a still camera - and one real ball
that moves like a ball. The tracker must follow the ball, say UNKNOWN where it is not seen, and never pick the decoys. Then the TRACK_BALL job
end to end: evidence file + shots in, positions + metrics out."""
from __future__ import annotations

import json
import random
import uuid

import pyarrow as pa
import pyarrow.parquet as pq

from vie_worker import ball
from vie_worker.jobs import JobRunner
from vie_worker.main import HANDLERS

STEP = 1_000_000 / 6
W, H = 1280, 720


def scene(seconds: int = 30, seed: int = 3):
    """Frames of candidates and person boxes; truth[pts] = (x, y) of the ball or None when it is hidden."""
    rnd = random.Random(seed)
    frames, persons, truth = {}, {}, {}
    bx, by, vx, vy = 0.2, 0.5, 0.12, 0.02                              # picture widths (heights) per second
    players = [[rnd.uniform(0.1, 0.9), rnd.uniform(0.3, 0.8)] for _ in range(6)]
    for k in range(int(seconds * 6)):
        pts = int(round(k * STEP))
        if k % 30 == 0:                                                  # a kick every 5 s: new direction
            vx, vy = rnd.uniform(-0.25, 0.25), rnd.uniform(-0.1, 0.1)
        bx, by = min(0.95, max(0.05, bx + vx / 6)), min(0.9, max(0.1, by + vy / 6))
        if bx in (0.05, 0.95): vx = -vx
        if by in (0.1, 0.9): vy = -vy
        hidden = 60 <= k < 70                                            # behind players for 10 frames
        truth[pts] = None if hidden else (bx, by)
        cands = []
        if not hidden and k % 7 != 3:                                    # the detector misses it now and then
            cands.append(ball.Cand(pts, bx + rnd.gauss(0, 0.001), by + rnd.gauss(0, 0.001), 7.0, rnd.uniform(0.22, 0.5)))
        boxes = []
        for p in players:
            p[0] = min(0.95, max(0.05, p[0] + rnd.gauss(0, 0.004)))
            p[1] = min(0.9, max(0.2, p[1] + rnd.gauss(0, 0.004)))
            boxes.append((p[0] - 0.01, p[1] - 0.09, 0.02, 0.09))          # ~65 px tall
            if rnd.random() < 0.6:                                       # a boot: at the feet, jittering, scored like the ball
                cands.append(ball.Cand(pts, p[0] + rnd.uniform(-0.01, 0.01), p[1] - 0.004, 6.0, rnd.uniform(0.2, 0.4)))
        cands.append(ball.Cand(pts, 0.956, 0.048, 9.0, 0.3, on_pitch=True))   # the logo dot, every frame of every shot
        if rnd.random() < 0.5:                                           # a crest on a shirt (upper body)
            b = boxes[0]
            cands.append(ball.Cand(pts, b[0] + b[2] / 2, b[1] + 0.25 * b[3], 6.0, 0.45))
        if rnd.random() < 0.3:                                           # the stands
            cands.append(ball.Cand(pts, rnd.random(), 0.05, 6.0, 0.35, on_pitch=False))
        frames[pts], persons[pts] = cands, boxes
    return frames, persons, truth


def shots_of(frames, every_s: int = 10) -> dict[int, int]:
    return {p: int(p // (every_s * 1_000_000)) for p in frames}


def run(frames, persons, shot_of):
    kept, why = ball.plausible(frames, persons, shot_of, W, H, STEP)
    return ball.follow_ball(kept, shot_of, STEP, W / H), why


def test_the_ball_is_followed_and_the_decoys_are_not():
    frames, persons, truth = scene()
    shot_of = shots_of(frames)
    points, why = run(frames, persons, shot_of)
    assert why["printed"] + why["still"] >= 150 and why["on_body"] > 0 and why["off_pitch"] > 0
    marks = [{"pts_us": p, "visible": t is not None, "x": t[0] if t else None, "y": t[1] if t else None} for p, t in truth.items()]
    r = ball.evaluate(points, marks, STEP, W, H)
    assert r["precision"] >= 0.95, r                                     # when it says where the ball is, it is right
    assert r["recall"] >= 0.85, r                                        # and it finds the ball in most frames it is visible
    assert r["invented"] <= 2, r                                         # hidden frames stay unknown (an inferred straight line may cover the edges)
    assert all(abs(p.x - 0.956) > 0.02 or abs(p.y - 0.048) > 0.02 for p in points)       # never the logo


def test_inferred_only_across_short_gaps_and_unknown_beyond():
    pts = [int(round(k * STEP)) for k in range(40)]
    frames = {p: [] for p in pts}
    for k in list(range(0, 11)) + list(range(13, 20)) + list(range(30, 40)):   # a 2-frame gap (inferred) and a 9-frame gap (unknown)
        frames[pts[k]] = [ball.Cand(pts[k], 0.3 + 0.004 * k, 0.5, 7.0, 0.4)]
    out = {p.pts_us: p.state for p in ball.follow_ball(frames, {p: 0 for p in pts}, STEP, W / H)}
    assert out[pts[11]] == "INFERRED" and out[pts[12]] == "INFERRED"
    assert all(pts[k] not in out for k in range(21, 30))
    assert out[pts[5]] == "DETECTED"


def test_a_still_mark_and_a_logo_are_removed_but_a_ball_at_rest_briefly_is_kept():
    pts = [int(round(k * STEP)) for k in range(6 * 60)]
    frames = {p: [ball.Cand(p, 0.4, 0.6, 7.0, 0.3)] for p in pts}                  # 60 s on one spot in one shot: a pitch mark
    for k in range(12):                                                              # a ball at rest for 2 s elsewhere
        frames[pts[k]].append(ball.Cand(pts[k], 0.7, 0.5, 7.0, 0.3))
    kept, why = ball.plausible(frames, {}, {p: 0 for p in pts}, W, H, STEP)
    assert why["still"] == len(pts)
    assert sum(len(v) for v in kept.values()) == 12
    sure = {p: [ball.Cand(p, 0.4, 0.6, 7.0, 0.9)] for p in pts}                     # a ball waiting for a free kick, detected with certainty
    assert sum(len(v) for v in ball.plausible(sure, {}, {p: 0 for p in pts}, W, H, STEP)[0].values()) == len(pts)


def test_a_mark_overrides_the_engine():
    points = [ball.BallPoint(1_000_000, "DETECTED", 0.5, 0.5, 0.9), ball.BallPoint(1_166_667, "DETECTED", 0.6, 0.5, 0.9)]
    merged = ball.merge_marks(points, [{"pts_us": 1_000_000, "visible": True, "x": 0.4, "y": 0.4}, {"pts_us": 1_166_667, "visible": False}], STEP)
    assert [(p.pts_us, p.state, p.x) for p in merged] == [(1_000_000, "MARKED", 0.4)]


def test_track_ball_job_end_to_end(stack, root, seed):
    org, user, project = seed.org()
    video, run, asset, bt = (str(uuid.uuid4()) for _ in range(4))
    frames, persons, truth = scene(seconds=20, seed=5)
    rows = {k: [] for k in ("frame_index", "pts_us", "label", "score", "x", "y", "w", "h", "on_pitch", "track_number")}
    for i, p in enumerate(sorted(frames)):
        for c in frames[p]:
            for k, v in zip(rows, (i, p, "BALL", c.score, c.x - c.w_px / W / 2, c.y - c.w_px / H / 2, c.w_px / W, c.w_px / H, c.on_pitch, None)):
                rows[k].append(v)
        for b in persons[p]:
            for k, v in zip(rows, (i, p, "PERSON", 0.9, *b, True, None)):
                rows[k].append(v)
    key = f"org/{org}/runs/{run}/detections.parquet"
    path = stack["storage"].joinpath(*key.split("/"))
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(rows), path)
    with root.cursor() as cur:
        cur.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, width, height, created_by) VALUES (%s, %s, %s, 'UPLOAD', 'VALIDATING', %s, %s, %s)",
                    (video, org, project, W, H, user))
        cur.execute("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, config) VALUES (%s, %s, %s, 'test', 'SUCCEEDED', %s)",
                    (run, video, org, json.dumps({"sample_fps": 6})))
        cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (%s, %s, %s, 'DETECTIONS', %s, 'local', 1)", (asset, org, project, key))
        cur.execute("INSERT INTO model_versions (id, task, model_name, semantic_version) VALUES (%s, 'DETECT', 'test', '1')", (mv := str(uuid.uuid4()),))
        cur.execute("INSERT INTO detection_batches (id, run_id, model_version_id, start_frame, end_frame, payload_asset_id, checksum, detection_count) VALUES (UUID(), %s, %s, 0, 1, %s, 'x', 1)", (run, mv, asset))
        for n, s in enumerate((0, 10_000_000)):
            cur.execute("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (UUID(), %s, %s, %s, %s, %s)", (video, run, n + 1, s, s + 10_000_000))
        for p in sorted(truth)[::10]:
            t = truth[p]
            cur.execute("INSERT INTO ball_marks (id, organization_id, video_id, pts_us, visible, x, y, marked_by) VALUES (UUID(), %s, %s, %s, %s, %s, %s, %s)",
                        (org, video, p, t is not None, t[0] if t else None, t[1] if t else None, user))
        cur.execute("INSERT INTO ball_tracks (id, organization_id, video_id, run_id) VALUES (%s, %s, %s, %s)", (bt, org, video, run))
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (UUID(), %s, 'TRACK_BALL', 'ball_track', %s, %s, %s)",
                    (org, bt, f"track_ball:{bt}", json.dumps({"ball_track_id": bt})))
    runner = JobRunner(stack["dsn"], "test-worker", ["TRACK_BALL"], lease_seconds=60)
    assert runner.run_one(HANDLERS) == "succeeded"
    with root.cursor() as cur:
        cur.execute("SELECT status, metrics FROM ball_tracks WHERE id = %s", (bt,))
        r = cur.fetchone()
        cur.execute("SELECT COUNT(*) n, SUM(state = 'DETECTED') d FROM ball_positions WHERE ball_track_id = %s", (bt,))
        n = cur.fetchone()
        cur.execute("SELECT action FROM audit_events WHERE entity_id = %s", (video,))
        acts = [a["action"] for a in cur.fetchall()]
    m = json.loads(r["metrics"])
    assert r["status"] == "SUCCEEDED" and m["frames"] == 120 and n["n"] == m["detected"] + m["inferred"] and int(n["d"]) == m["detected"] > 60
    assert m["against_marks"]["precision"] >= 0.9 and m["against_marks"]["marked_visible"] >= 10
    assert "video.ball_tracked" in acts and m["possession"]["passes"] == 0          # nobody followed in this run: no holder, no pass
    # possession events are stored against the ball track (migration 0031); saving again replaces them
    from vie_worker.ball_job import save_events
    from vie_worker.possession import Event
    with root.cursor() as cur:
        cur.execute("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, first_pts_us, last_pts_us) VALUES (%s, %s, %s, 1, 'PERSON', 0, 1)", (a := str(uuid.uuid4()), run, video))
        cur.execute("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, first_pts_us, last_pts_us) VALUES (%s, %s, %s, 2, 'PERSON', 0, 1)", (b := str(uuid.uuid4()), run, video))
        ev = [Event("PASS", 1_000_000, 1_500_000, a, b, 0, "DETECTED", 0.8, {"length_m": 12.5}), Event("TEAM_POSSESSION", 0, 2_000_000, None, None, 0, "DETECTED", 0.8, {})]
        save_events(cur, run, video, bt, ev)
        save_events(cur, run, video, bt, ev)
        cur.execute("SELECT event_type, kit_group, JSON_EXTRACT(features, '$.length_m') AS m FROM event_candidates WHERE ball_track_id = %s ORDER BY event_type", (bt,))
        assert [(r["event_type"], r["kit_group"], r["m"]) for r in cur.fetchall()] == [("PASS", 0, "12.5"), ("TEAM_POSSESSION", 0, None)]


def test_heat_map_peaks_are_the_strongest_separate_spots():
    from vie_worker.ball_net import peaks
    import numpy as np
    p = np.zeros((90, 160), np.float32)
    p[40, 50], p[41, 51], p[10, 120], p[70, 20] = 0.9, 0.85, 0.6, 0.2              # one ball (two neighbouring pixels), a weaker spot, noise
    assert peaks(p) == [(50, 40, np.float32(0.9)), (120, 10, np.float32(0.6))]
    assert peaks(p, floor=0.7) == [(50, 40, np.float32(0.9))]
