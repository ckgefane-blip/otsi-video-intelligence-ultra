"""TRACK_BALL (ADR-037): the ball followed through one analysis run's saved detections (vie_worker.ball), nobody clicking.

Ball candidates come from the registered ball model (vie_worker.ball_net, ADR-038) when there is one - it reads the video, three frames at
a time, once per run (cached) - else from the general detector's saved "sports ball" boxes. Reads the run's detection evidence file
(Parquet: people, and those boxes), its shots and the video's size; writes one `ball_positions` row per frame where the engine
knows where the ball is and the track's metrics (what each rule removed, how many frames are detected / inferred / unknown, and how the answer
compares with the person's marks of this video at that moment). Then possession and passes (ADR-040, vie_worker.possession) from the ball
and the run's people tracks, stored as `event_candidates` of this ball track. Runs in seconds when the ball model's answer is cached.
"""
from __future__ import annotations

import bisect
import json
import os
import uuid
from collections import defaultdict
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

import pymysql

from . import ball, ball_net, possession, scoreboard
from .db import audit, tx
from .jobs import Job, JobError, JobRunner
from .storage import LocalStore

SERVICE = "ball-worker"


def _fail(runner: JobRunner, bid: str, code: str, detail: str) -> dict:
    with tx(runner.conn) as cur:
        cur.execute("UPDATE ball_tracks SET status = 'FAILED', failure_code = %s, failure_detail = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s", (code, detail[:2000], bid))
    return {"ball_track_id": bid, "status": "FAILED", "failure_code": code}


def load_candidates(path: str, width_px: int, height_px: int) -> tuple[dict[int, list[ball.Cand]], dict[int, list[tuple[float, float, float, float]]]]:
    """Every analysed frame's ball candidates and person boxes from the evidence file (frames without any candidate are kept, empty)."""
    t = pq.read_table(path, columns=["pts_us", "label", "score", "x", "y", "w", "h", "on_pitch"]).to_pydict()
    frames: dict[int, list[ball.Cand]] = defaultdict(list)
    persons: dict[int, list[tuple[float, float, float, float]]] = defaultdict(list)
    for i, label in enumerate(t["label"]):
        p, x, y, w, h = int(t["pts_us"][i]), float(t["x"][i]), float(t["y"][i]), float(t["w"][i]), float(t["h"][i])
        if label == "BALL":
            frames[p].append(ball.Cand(p, x + w / 2, y + h / 2, w * width_px, float(t["score"][i]), bool(t["on_pitch"][i])))
        else:
            frames.setdefault(p, [])
            persons[p].append((x, y, w, h))
    return dict(frames), dict(persons)


def pitch_lookup(rows: list[dict]):
    """The video's pitch calibration slices -> a function giving, for a moment, the best-quality slice covering it as (picture -> pitch
    matrix, length, width), or None (the same rule as the API's heat zones). Slices are short; the lookup scans back a few."""
    sl = []
    for r in rows:
        H = np.array(r["transform_matrix"] if not isinstance(r["transform_matrix"], str) else json.loads(r["transform_matrix"]), dtype=float)
        try:
            inv = np.linalg.inv(H)
        except np.linalg.LinAlgError:
            continue
        sl.append((int(r["start_pts_us"]), int(r["end_pts_us"]), float(r["quality_score"] or 0), (inv.tolist(), float(r["pitch_length_m"] or 105), float(r["pitch_width_m"] or 68))))
    sl.sort(key=lambda q: q[0])
    starts = [q[0] for q in sl]

    def at(pts: int):
        i = bisect.bisect_right(starts, pts)
        best = None
        for j in range(i - 1, max(-1, i - 9), -1):
            s0, s1, q, v = sl[j]
            if s1 > pts and (best is None or q > best[0]):
                best = (q, v)
        return best[1] if best else None
    return at


def load_people(conn, video_id: str, run_id: str, wanted: set[int]) -> dict[int, list[possession.Person]]:
    """The run's people (not the ball) in the frames where the ball is known: track, kit group and box. Streamed: a match has millions of rows."""
    out: dict[int, list[possession.Person]] = defaultdict(list)
    with conn.cursor(pymysql.cursors.SSCursor) as cur:
        cur.execute("""SELECT o.pts_us, o.track_id, ta.kit_group, o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h
                         FROM track_observations o JOIN tracks t ON t.id = o.track_id LEFT JOIN track_appearance ta ON ta.track_id = o.track_id
                        WHERE o.video_id = %s AND t.run_id = %s AND t.class_name <> 'BALL'""", (video_id, run_id))
        for pts, tid, kg, x, y, w, h in cur:
            if int(pts) in wanted:
                out[int(pts)].append((str(tid), None if kg is None else int(kg), float(x), float(y), float(w), float(h)))
    return dict(out)


def save_events(cur, run_id: str, video_id: str, bid: str, events: list[possession.Event]) -> None:
    """The ball track's possession events; a retry replaces them."""
    cur.execute("DELETE FROM event_candidates WHERE ball_track_id = %s", (bid,))
    ev = [(str(uuid.uuid4()), run_id, video_id, bid, e.kind, e.start, e.end, e.track_id, e.other_track_id, e.kit_group, e.confidence, e.state,
           json.dumps(e.features)) for e in events]
    for i in range(0, len(ev), 2000):
        cur.executemany("""INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id,
                           secondary_track_id, kit_group, confidence, evidence_state, features) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""", ev[i:i + 2000])


def read_goals(runner: JobRunner, job: Job, det_path: str, src: str, duration_us: int, starts: list[int], points, events, held: dict) -> list:
    """ADR-049: goals from the broadcast scoreboard (vie_worker.scoreboard), read once per run (cached next to the detections) and placed
    on the last live-play shot before the score changed. No readable scoreboard or no text reader: no goal is claimed (the reason is kept)."""
    cache = Path(det_path).with_name(f"{scoreboard.READER_VERSION}.json")
    try:
        if cache.exists():
            read = json.loads(cache.read_text(encoding="utf-8"))
        else:
            runner.progress(job, 79, "Reading the scoreboard")
            read = scoreboard.read_video(src, duration_us, lambda f: runner.progress(job, 79, f"Reading the scoreboard ({round(100 * f)}%)"))
            cache.write_text(json.dumps(read), encoding="utf-8")
    except Exception as e:  # noqa: BLE001 - goals are optional evidence; the ball, possession and the rest stand
        held["scoreboard"] = {"error": str(e)[:300]}
        held["goals"] = 0
        return []
    found = scoreboard.goals([(int(t), (int(a), int(b))) for t, a, b in read["reads"]])
    placed = [e for g in found if (e := scoreboard.place(g, starts, points, events, duration_us or (points[-1].pts_us if points else 0)))]
    held["scoreboard"] = {"boxes": len(read["boxes"]), "reads": len(read["reads"]), "score_changes": len(found)}
    held["goals"] = len(placed)
    return placed


def handle_track_ball(runner: JobRunner, job: Job) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, bid = job.organization_id, job.payload["ball_track_id"]
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT b.id, b.status, b.video_id, b.run_id, r.status AS run_status, r.config, v.width, v.height, v.duration_us, sa.object_key AS source_key
                         FROM ball_tracks b JOIN pipeline_runs r ON r.id = b.run_id JOIN video_sources v ON v.id = b.video_id AND v.organization_id = b.organization_id
                         LEFT JOIN assets sa ON sa.id = v.source_asset_id
                        WHERE b.id = %s AND b.organization_id = %s""", (bid, org))
        row = cur.fetchone()
        if not row:
            raise JobError("NOT_FOUND", "The ball track no longer exists.")
        if row["status"] in ("SUCCEEDED", "FAILED"):
            return {"ball_track_id": bid, "status": row["status"], "note": "already settled"}
        cur.execute("""SELECT a.object_key FROM detection_batches d JOIN assets a ON a.id = d.payload_asset_id WHERE d.run_id = %s LIMIT 1""", (row["run_id"],))
        det = cur.fetchone()
        cur.execute("SELECT start_pts_us FROM video_shots WHERE run_id = %s ORDER BY start_pts_us", (row["run_id"],))
        starts = [int(r["start_pts_us"]) for r in cur.fetchall()]
        cur.execute("SELECT start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m, quality_score FROM pitch_calibrations WHERE video_id = %s",
                    (row["video_id"],))
        pitch_at = pitch_lookup(cur.fetchall())
        cur.execute("SELECT pts_us, visible, x, y FROM ball_marks WHERE video_id = %s AND organization_id = %s", (row["video_id"], org))
        marks = [{"pts_us": int(m["pts_us"]), "visible": bool(m["visible"]), "x": m["x"], "y": m["y"]} for m in cur.fetchall()]
    if row["run_status"] != "SUCCEEDED" or not det:
        return _fail(runner, bid, "RUN_NOT_FINISHED", "The analysis has not finished, so there are no detections to follow the ball in.")
    config = row["config"] if isinstance(row["config"], dict) else json.loads(row["config"] or "{}")
    step_us = 1_000_000 / float(config.get("sample_fps") or 2)
    width_px, height_px = int(row["width"] or 1280), int(row["height"] or 720)
    with tx(runner.conn) as cur:
        cur.execute("UPDATE ball_tracks SET status = 'RUNNING' WHERE id = %s", (bid,))
        cur.execute("DELETE FROM ball_positions WHERE ball_track_id = %s", (bid,))          # a retry starts clean
    runner.progress(job, 10, "Reading the saved detections")
    path = str(store.path(det["object_key"]))
    if not os.path.exists(path):
        return _fail(runner, bid, "DETECTIONS_MISSING", "The saved detections of this analysis are no longer available.")
    frames, persons = load_candidates(path, width_px, height_px)
    source = "detector"
    if ball_net.registered() and row["source_key"] and job.payload.get("model") != "detector":
        model = ball_net.BallModel()
        cache = ball_net.cache_path(path, model.sha16)
        times = sorted(frames)
        if cache.exists():
            frames = {**{t: [] for t in times}, **ball_net.load(cache, times)}
        else:
            runner.progress(job, 12, "Looking for the ball in the video")
            frames = ball_net.candidates(str(store.path(row["source_key"])), times, width_px, height_px, model,
                                         lambda f: runner.progress(job, 12 + 58 * f, f"Looking for the ball in the video ({round(100 * f)}%)"))
            ball_net.save(cache, frames)
        source = f"ball_net:{model.sha16}"
    shot_of = {p: max(0, bisect.bisect_right(starts, p) - 1) for p in frames}
    runner.progress(job, 72, "Following the ball")
    kept, removed = ball.plausible(frames, persons, shot_of, width_px, height_px, step_us, pitch_at)
    use_flight = bool(config.get("ball_flight"))       # U.9: parabolic flight separation, off by default (run config "ball_flight": true)
    points = ball.follow_ball(kept, shot_of, step_us, width_px / height_px, use_flight=use_flight)
    runner.progress(job, 78, "Finding possession and passes")
    people = load_people(runner.conn, str(row["video_id"]), str(row["run_id"]), {p.pts_us for p in points})
    events, held = possession.analyse(points, people, shot_of, width_px / height_px, pitch_at)
    if row["source_key"]:
        events += read_goals(runner, job, path, str(store.path(row["source_key"])), int(row["duration_us"] or 0), starts, points, events, held)
    runner.progress(job, 80, "Saving the ball's path")
    detected = sum(p.state == "DETECTED" for p in points)
    metrics = {"frames": len(frames), "detected": detected, "inferred": len(points) - detected, "unknown": max(0, len(frames) - len(points)),
               "candidates": sum(len(v) for v in frames.values()), "candidates_from": source, "removed": removed, "step_us": round(step_us),
               "ball_flight": use_flight,
               "possession": held, "against_marks": {k: v for k, v in ball.evaluate(points, marks, step_us, width_px, height_px).items() if k != "errors_px"}}
    with tx(runner.conn) as cur:
        cur.execute("SELECT claim_token FROM worker_jobs WHERE id = %s FOR UPDATE", (job.id,))
        if cur.fetchone()["claim_token"] != job.token:
            raise JobError("LEASE_LOST", "Another worker took over this ball track.")
        rows = [(bid, p.pts_us, p.state, round(min(1.0, max(0.0, p.x)), 6), round(min(1.0, max(0.0, p.y)), 6), round(p.confidence, 3)) for p in points]
        for i in range(0, len(rows), 2000):
            cur.executemany("INSERT INTO ball_positions (ball_track_id, pts_us, state, x, y, confidence) VALUES (%s, %s, %s, %s, %s, %s)", rows[i:i + 2000])
        save_events(cur, str(row["run_id"]), str(row["video_id"]), bid, events)
        cur.execute("UPDATE ball_tracks SET status = 'SUCCEEDED', metrics = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s", (json.dumps(metrics), bid))
        audit(cur, org, SERVICE, "video.ball_tracked", "video", str(row["video_id"]), {"ball_track_id": bid, "run_id": str(row["run_id"]), "detected": detected,
              "inferred": metrics["inferred"]}, f"job:{job.id}")
    return {"ball_track_id": bid, "status": "SUCCEEDED", **{k: metrics[k] for k in ("frames", "detected", "inferred")}}
