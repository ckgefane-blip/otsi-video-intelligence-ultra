"""ANALYZE (Blocks 05-06): one processing run of one ingested video.

  SHOTS + DETECT   one decoding pass over the source at `sample_fps`: hard-cut detection and person/ball detection per sampled frame
  TRACK            tracking within each shot (vie_worker.tracker); confirmed tracks and their DETECTED boxes are stored
  IDENTIFY         appearance of each person track (kit colour group, embedding, drift, thumbnail) and same-person link SUGGESTIONS
                   between tracks across occlusions and camera cuts (vie_worker.appearance, ADR-031) - evidence for review, never identity;
                   shirt-number evidence from several clear frames per track (vie_worker.jersey, ADR-033) and the look-alike neighbour graph

Stored: the raw detector output as an immutable Parquet evidence file (asset DETECTIONS + detection_batches, SHA-256), the shots, the
tracks (class PERSON or BALL: role and team are not decided here) and their observations (only real detections; nothing interpolated),
presence intervals, the model version used. Progress is written to the run's steps; a cancelled run stops at the next batch.
No identity is created: every track starts UNRESOLVED and is shown as "Unidentified ... · track N" (ADR-016).
"""
from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from . import appearance as appear
from . import jersey as jer
from .db import audit, publish, tx
from .detect.base import load_detector
from .detect.pitch import classify, classify_surface, grass_mask
from .detect.stored import StoredDetector
from .quality import phase_shift
from .follow import FOLLOW_WIDTH, FrameStream, follow_centre, overlapping_boxes
from .frames import CutDetector, sample_frames
from . import ff
from .jobs import Job, JobError, JobRunner
from .storage import LocalStore
from .tracker import Tracker, torso_colour

SERVICE = "analysis-worker"
BATCH = 8                    # frames per detector call (and per progress/cancel check)
PRESENCE_GAP_US = 1_000_000
DRIFT_WARNING = appear.DRIFT_WARNING


def _step(cur, run_id: str, name: str, **cols) -> None:
    sets = ", ".join(f"{k} = %s" for k in cols)
    cur.execute(f"UPDATE pipeline_steps SET {sets} WHERE run_id = %s AND step_name = %s", (*cols.values(), run_id, name))


def _model_version(cur, det, cfg: dict) -> str:
    """The registered model version row for exactly this model + settings (created once)."""
    e = det.entry
    grids = "" if not cfg.get("grids") else "-grids" + "x".join(str(g) for g in cfg["grids"])
    version = f"{e['revision'][:12]}-tiles{cfg['tiles']}{grids}-floor{cfg['score_floor']}-{det.runtime}"
    cur.execute("SELECT id FROM model_versions WHERE task = 'DETECT' AND model_name = %s AND semantic_version = %s", (e["key"], version))
    row = cur.fetchone()
    if row:
        return row["id"]
    mid = str(uuid.uuid4())
    cur.execute("INSERT INTO model_versions (id, task, model_name, semantic_version, weights_sha256, license_id, config) VALUES (%s, 'DETECT', %s, %s, %s, %s, %s)",
                (mid, e["key"], version, det.weights_sha256, "Apache-2.0", json.dumps({"source": e["source"], "revision": e["revision"], "tiles": cfg["tiles"],
                                                                                       "score_floor": cfg["score_floor"], "grids": cfg.get("grids"), "family": e["family"],
                                                                                       "runtime": det.runtime})))
    return mid


def handle_analyze(runner: JobRunner, job: Job) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, run_id = job.organization_id, job.payload["run_id"]
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT r.id, r.video_id, r.status, r.config, v.state, v.duration_us, a.object_key
                         FROM pipeline_runs r JOIN video_sources v ON v.id = r.video_id AND v.organization_id = r.organization_id
                         LEFT JOIN assets a ON a.id = v.source_asset_id WHERE r.id = %s AND r.organization_id = %s""", (run_id, org))
        run = cur.fetchone()
    if not run:
        raise JobError("NOT_FOUND", "The analysis run no longer exists.")
    if run["status"] in ("SUCCEEDED", "FAILED", "CANCELLED"):
        return {"run_id": run_id, "status": run["status"], "note": "already settled"}
    if run["state"] != "INGESTED" or not run["object_key"]:
        raise JobError("VIDEO_NOT_READY", "The video has not been verified, so it cannot be analysed.")
    cfg = {"sample_fps": 2.0, "detector": None, "tiles": 2, "score_floor": 0.2, **(json.loads(run["config"]) if isinstance(run["config"], str) else (run["config"] or {}))}
    video_id, duration = run["video_id"], max(1, int(run["duration_us"] or 1))
    threads = int(os.environ.get("OTSI_VIE_CPU_THREADS", str(max(1, (os.cpu_count() or 2) - 2))))

    with tx(runner.conn) as cur:
        cur.execute("UPDATE pipeline_runs SET status = 'RUNNING', started_at = COALESCE(started_at, CURRENT_TIMESTAMP(6)) WHERE id = %s", (run_id,))
        _step(cur, run_id, "SHOTS", status="RUNNING", started_at=time.strftime("%Y-%m-%d %H:%M:%S"))
        _step(cur, run_id, "DETECT", status="RUNNING", started_at=time.strftime("%Y-%m-%d %H:%M:%S"))
    reuse = cfg.get("reuse_detections_from")
    if reuse:
        # re-track: replay the saved detections of an earlier finished run of this same video (no detector run)
        with runner.conn.cursor() as cur:
            cur.execute("""SELECT b.model_version_id, a.object_key, m.model_name FROM detection_batches b JOIN pipeline_runs r ON r.id = b.run_id
                             JOIN assets a ON a.id = b.payload_asset_id JOIN model_versions m ON m.id = b.model_version_id
                            WHERE b.run_id = %s AND r.video_id = %s AND r.organization_id = %s AND r.status = 'SUCCEEDED'""", (reuse, video_id, org))
            src = cur.fetchone()
        if not src:
            return _fail(runner, job, run_id, "DETECT", "RETRACK_SOURCE_MISSING", "The saved detections of the earlier analysis are no longer available.")
        det = StoredDetector(store.path(src["object_key"]), reuse, src["model_name"])
        model_version_id = src["model_version_id"]
    else:
        try:
            det = load_detector(cfg["detector"], threads=threads, tiles=int(cfg["tiles"]), score_floor=float(cfg["score_floor"]), device=cfg.get("device"),
                                grids=cfg.get("grids"), cross_scale=bool(cfg.get("cross_scale", False)))
        except RuntimeError as e:
            return _fail(runner, job, run_id, "DETECT", "MODEL_UNAVAILABLE", str(e))
        with runner.conn.cursor() as cur:
            model_version_id = _model_version(cur, det, cfg)

    cuts = CutDetector()
    seed_us = cfg.get("team_seed_pts_us")
    team_ref, team_info, team_auto = None, None, None
    touchline = cfg.get("pitch") == "TOUCHLINE"
    surface = cfg.get("pitch") == "SURFACE"
    if seed_us is None and cfg.get("team_auto", True) and with_appearance_cfg(cfg):
        # nobody pointed at the kickoff: look for it (the teams standing on their own halves), so the person never has to
        runner.progress(job, 1, "Looking for the kickoff to learn the two teams")
        seed_us, team_auto = scan_for_kickoff(store.path(run["object_key"]), det, int(duration), touchline=touchline, surface=surface, sample_fps=float(cfg["sample_fps"]),
                                              progress=lambda p: runner.progress(job, 1 + 3 * p, "Looking for the kickoff to learn the two teams"))
        if seed_us is None:
            team_info = team_auto
    tracker = Tracker(**{k: v for k, v in (cfg.get("tracker") or {}).items() if k in ("high", "low", "min_hits", "distance_weight", "max_lost_s", "kit_gate",
                                                                                                  "eiou_expand", "dino_gate", "ambiguity_margin")},
                      team_gate=seed_us is not None)
    # U.2: eiou_expand / dino_gate / ambiguity_margin are configurable here, but the DINOv2 gate has no live provider in
    # analyze.py — embeddings are computed post-hoc (appearance.describe), not while tracking — so the gate stays off
    # (dino_gate=None) until a caller supplies an appearance_fn to tracker.update(); what the gate did is reported in
    # tracker.dino_stats (see "dino_gate" in the run stats below).
    confirm = {"min_hits": tracker.min_hits, "min_peak": 0.0, **(cfg.get("confirm") or {})}
    touchline = cfg.get("pitch") == "TOUCHLINE"
    surface = cfg.get("pitch") == "SURFACE"
    stabilize = bool(cfg.get("stabilize", False))
    prev_rgb = [None]                          # previous analysed frame of the current shot (camera-motion compensation)
    reservoirs: dict[int, appear.CropReservoir] = {}       # id(track) -> evenly spaced crops of its own detections
    ocr_candidates: dict[int, jer.OcrCandidates] = {}      # id(track) -> its clearest large crops, for shirt numbers
    ocr_budget = jer.OcrBudget()
    with_appearance = bool(cfg.get("appearance", True))
    rescued: dict[int, int] = {}               # per live track: samples in a row it was carried off the pitch (continues_track)
    rows: list[tuple] = []                     # raw detections for the evidence file
    frame_index_rows: list[tuple] = []         # the frame/timestamp index entries of every analysed frame
    shot_starts: list[int] = [0]
    frames, batch = 0, []
    # who-is-who between analysed frames: every video frame, small and grey, read alongside (vie_worker.follow); config "follow": false turns it off
    stream = FrameStream(ff.decode_sampled(store.path(run["object_key"]), None, max_width=FOLLOW_WIDTH, gray=True)) if cfg.get("follow", True) else None
    follow_stats = {"on": stream is not None, "predictions": 0, "followed": 0, "frozen": 0}
    prev_pts = [None]                          # the previous analysed frame (the tracks' last observations are there)
    t0 = time.monotonic()
    last_check = 0.0

    if seed_us is not None:
        runner.progress(job, 1, "Reading the two teams at kickoff")
        team_ref, team_info = teach_teams(store.path(run["object_key"]), det, int(seed_us), touchline=touchline, surface=surface, sample_fps=float(cfg["sample_fps"]))
        team_info["pts_us"] = int(seed_us)
        if team_auto is not None:
            team_info["auto"] = True
        if team_ref is None:
            import logging
            logging.getLogger("vie_worker.analyze").warning("teams could not be read at kickoff: %s", team_info.get("reason"))

    def flush(batch_frames) -> None:
        nonlocal frames
        found = det.detect_frames(batch_frames) if hasattr(det, "detect_frames") else det.detect([f.rgb for f in batch_frames])
        for f, ds in zip(batch_frames, found):
            frame_index_rows.append((video_id, f.frame_index, f.pts_us, f.keyframe))
            on = classify_surface(ds, grass_mask(f.rgb)) if surface else classify(ds, grass_mask(f.rgb), touchline=touchline)
            shift = None
            if stabilize and prev_rgb[0] is not None:
                dx, dy = phase_shift(prev_rgb[0], f.rgb)                          # the picture's movement since the last sample (camera pan)
                shift = (dx / f.rgb.shape[1], dy / f.rgb.shape[0])
            prev_rgb[0] = f.rgb if stabilize else None
            # only people on the playing surface are tracked; a confident person who continues an on-pitch track is kept too (shade, touchline)
            seen_on_grass = [d for d, ok in zip(ds, on) if ok and d.label == "PERSON"]
            for t in tracker.active:                                         # a track seen on the grass again may be carried again
                if t.observations and any(_iou(d, t.observations[-1]) >= 0.4 for d in seen_on_grass):
                    rescued.pop(id(t), None)
            kept = [d for d, ok in zip(ds, on) if ok or (d.label == "PERSON" and d.score >= tracker.high and continues_track(d, tracker.active, f.pts_us, rescued))]
            feats = [torso_colour(f.rgb, d) if d.label == "PERSON" else None for d in kept] if tracker.kit_gate is not None else None
            boxes = [(d.x, d.y, d.w, d.h) for d in ds if d.label == "PERSON" and d.score >= 0.3]            # everyone in the frame: left out when the ground beside a player is measured
            teams = {id(d): team_ref.classify_detection(f.rgb, d, boxes) for d in kept if d.label == "PERSON"} if team_ref is not None else None
            fol = None
            if stream is not None:
                grays = stream.between(f.pts_us)
                if grays:
                    fol = {}
                    # U.1: players whose boxes mutually overlap in this analysed frame are crossing — freeze their follow (hold the
                    # last known centre) instead of following a patch contaminated by the other player.
                    live = [(t, t.observations[-1]) for t in tracker.active
                            if t.label == "PERSON" and t.observations and t.observations[-1].pts_us == prev_pts[0]]
                    frozen = overlapping_boxes([(o.x, o.y, o.w, o.h) for _, o in live])
                    for k, (t, o) in enumerate(live):
                        follow_stats["predictions"] += 1
                        c = follow_centre(grays, (o.x, o.y, o.w, o.h), freeze=k in frozen)
                        if c is not None:
                            fol[id(t)] = c
                            follow_stats["followed"] += 1
                            if k in frozen:
                                follow_stats["frozen"] += 1
            prev_pts[0] = f.pts_us
            tracker.update(f.frame_index, f.pts_us, kept, camera_shift=shift, features=feats, teams=teams, follow=fol)
            if with_appearance:
                for t in tracker.active:
                    o = t.observations[-1]
                    if t.label == "PERSON" and o.frame_index == f.frame_index:
                        reservoirs.setdefault(id(t), appear.CropReservoir()).offer(f.pts_us, f.rgb, (o.x, o.y, o.w, o.h))
                        if o.h * f.rgb.shape[0] >= jer.OCR_MIN_PX:
                            ocr_candidates.setdefault(id(t), jer.OcrCandidates()).offer(f.pts_us, f.rgb, (o.x, o.y, o.w, o.h), ocr_budget)
            rows.extend((f.frame_index, f.pts_us, d.label, d.score, d.x, d.y, d.w, d.h, ok) for d, ok in zip(ds, on))
        frames += len(batch_frames)

    for f in sample_frames(store.path(run["object_key"]), float(cfg["sample_fps"])):
        if cuts.is_cut(f.rgb):
            if batch:
                flush(batch); batch = []
            tracker.end_all()
            prev_rgb[0] = None
            shot_starts.append(f.pts_us)
        batch.append(f)
        if len(batch) >= BATCH:
            flush(batch); batch = []
            if time.monotonic() - last_check > 2:
                last_check = time.monotonic()
                pct = min(99.0, 100 * f.pts_us / duration)
                runner.progress(job, pct * 0.9, f"Detecting people and the ball: {f.pts_us // 60_000_000} of {duration // 60_000_000} min")
                with runner.conn.cursor() as cur:
                    _step(cur, run_id, "DETECT", progress=round(pct, 2))
                    _step(cur, run_id, "SHOTS", progress=round(pct, 2))
                    cur.execute("SELECT status FROM pipeline_runs WHERE id = %s", (run_id,))
                    if cur.fetchone()["status"] == "CANCELLED":
                        if stream is not None:
                            stream.close()
                        return {"run_id": run_id, "status": "CANCELLED"}
    if batch:
        flush(batch)
    if stream is not None:
        stream.close()
    if frames == 0:
        return _fail(runner, job, run_id, "DETECT", "NO_FRAMES", "No frame of the video could be decoded for analysis.")
    elapsed = time.monotonic() - t0
    raw_tracks = tracker.results()
    if with_appearance:                                         # one track = one shirt: cut where the tracker swapped two people
        def _next_number() -> int:
            tracker.next_number += 1
            return tracker.next_number - 1
        raw_tracks = appear.split_on_shirt_change(raw_tracks, reservoirs, _next_number)
    dropped = drop_double_boxes(raw_tracks)
    raw_tracks.sort(key=lambda t: t.observations[0].pts_us if t.observations else 0)      # numbered in time order: a split track sits next to its original
    tracks, rejected = _confirm(raw_tracks, confirm)
    apps, links, embed_runtime, embed_model_id, embedder = [], [], None, None, None
    neighbour_rows, jersey, ocr_runtime = [], {}, None
    if with_appearance:
        runner.progress(job, 91, "Describing how each person looks (kit colour, appearance)")
        try:
            from .embed import Embedder
            embedder = Embedder(cfg.get("appearance_model") or "dinov2_small")
            embed_runtime = embedder.runtime
        except Exception as e:  # noqa: BLE001 - appearance is optional evidence: kit colours still work without the embedding model
            import logging
            logging.getLogger("vie_worker.analyze").warning("appearance embeddings unavailable: %s", e)
        apps = appear.describe(tracks, reservoirs, embedder)
        if team_ref is not None:                       # taught at kickoff: each track's team is the majority of its own per-frame calls (None when unsure)
            by_number = {t.number: t for t in tracks}
            for a in apps:
                t = by_number.get(a.number)
                a.group = appear.group_from_votes([o.team for o in t.observations]) if t is not None else None
        links = appear.propose_links(apps)
        neighbour_rows = appear.neighbours(apps)
        runner.progress(job, 92, "Reading shirt numbers where players are large enough")
        jersey, ocr_runtime = {}, None
        try:
            from .ocr import JerseyReader
            reader = JerseyReader()
            ocr_runtime = reader.runtime
            by_number = {t.number: ocr_candidates[id(t)] for t in tracks if id(t) in ocr_candidates}
            jersey = jer.read_tracks(by_number, reader)
        except Exception as e:  # noqa: BLE001 - shirt numbers are optional evidence; tracking and identity review work without them
            import logging
            logging.getLogger("vie_worker.analyze").warning("shirt-number reading unavailable: %s", e)
        if embedder is not None:
            with runner.conn.cursor() as cur:
                embed_model_id = _embed_model_version(cur, embedder)
    reservoirs.clear()
    ocr_candidates.clear()
    runner.progress(job, 93, "Saving tracks")

    # evidence file: every raw detection, with the track it became part of (if any)
    key_of = {}
    for t in tracks:
        for o in t.observations:
            key_of[(o.frame_index, t.label, round(o.x, 6), round(o.y, 6))] = t.number
    table = pa.table({
        "frame_index": [r[0] for r in rows], "pts_us": [r[1] for r in rows], "label": [r[2] for r in rows], "score": [float(r[3]) for r in rows],
        "x": [float(r[4]) for r in rows], "y": [float(r[5]) for r in rows], "w": [float(r[6]) for r in rows], "h": [float(r[7]) for r in rows],
        "on_pitch": [bool(r[8]) for r in rows],
        "track_number": [key_of.get((r[0], r[2], round(r[4], 6), round(r[5], 6))) for r in rows],
    })
    det_key = f"org/{org}/runs/{run_id}/detections.parquet"
    Path(store.path(det_key)).parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, store.path(det_key), compression="zstd")
    det_sha = hashlib.sha256(Path(store.path(det_key)).read_bytes()).hexdigest()

    with tx(runner.conn) as cur:
        cur.execute("SELECT claim_token FROM worker_jobs WHERE id = %s FOR UPDATE", (job.id,))
        if cur.fetchone()["claim_token"] != job.token:
            raise JobError("LEASE_LOST", "Another worker took over this run.")
        cur.execute("DELETE FROM track_links WHERE run_id = %s", (run_id,))                                                       # a crashed earlier attempt
        cur.execute("DELETE FROM track_jersey_evidence WHERE run_id = %s", (run_id,))
        cur.execute("DELETE n FROM track_neighbours n JOIN tracks t ON t.id = n.track_id WHERE t.run_id = %s", (run_id,))
        cur.execute("DELETE FROM track_appearance WHERE run_id = %s", (run_id,))
        cur.execute("DELETE o FROM track_observations o JOIN tracks t ON t.id = o.track_id WHERE t.run_id = %s", (run_id,))
        cur.execute("DELETE FROM presence_intervals WHERE track_id IN (SELECT id FROM tracks WHERE run_id = %s)", (run_id,))
        cur.execute("DELETE FROM tracks WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM video_shots WHERE run_id = %s", (run_id,))
        cur.execute("SELECT project_id FROM video_sources WHERE id = %s", (video_id,))
        project_id = cur.fetchone()["project_id"]
        asset_id = str(uuid.uuid4())
        cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, metadata) "
                    "VALUES (%s, %s, %s, 'DETECTIONS', %s, 'local', %s, %s, 'application/vnd.apache.parquet', %s)",
                    (asset_id, org, project_id, det_key, os.path.getsize(store.path(det_key)), det_sha, json.dumps({"run_id": run_id, "rows": len(rows)})))
        cur.execute("INSERT INTO detection_batches (id, run_id, model_version_id, start_frame, end_frame, payload_asset_id, checksum, detection_count) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (str(uuid.uuid4()), run_id, model_version_id, rows[0][0] if rows else 0, rows[-1][0] if rows else 0, asset_id, det_sha, len(rows)))
        shot_ids = []
        bounds = shot_starts + [duration]
        for n, (s, e) in enumerate(zip(bounds, bounds[1:])):
            sid = str(uuid.uuid4())
            shot_ids.append(sid)
            cur.execute("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (%s, %s, %s, %s, %s, %s)",
                        (sid, video_id, run_id, n + 1, s, max(e, s + 1)))
        obs_rows, presence = [], []
        track_ids: dict[int, str] = {}
        for t in tracks:
            tid = str(uuid.uuid4())
            track_ids[t.number] = tid
            o0, o1 = t.observations[0], t.observations[-1]
            mean = sum(o.score for o in t.observations) / len(t.observations)
            cur.execute("""INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status,
                                               quality_score, observation_count, mean_confidence) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'ENDED', %s, %s, %s)""",
                        (tid, run_id, video_id, shot_ids[min(t.shot_number, len(shot_ids) - 1)], t.number, t.label, o0.pts_us, o1.pts_us,
                         round(mean, 4), len(t.observations), round(mean, 4)))
            for o in t.observations:
                x, y = min(max(o.x, 0.0), 0.9999), min(max(o.y, 0.0), 0.9999)
                w, h = max(min(o.w, 1 - x), 1e-6), max(min(o.h, 1 - y), 1e-6)
                obs_rows.append((video_id, o.frame_index, tid, o.pts_us, x, y, w, h, round(min(o.score, 1.0), 4), round(min(max(o.association, 0.0), 1.0), 4), model_version_id))
            start = prev = o0.pts_us
            count = 0
            for o in t.observations:
                if o.pts_us - prev > PRESENCE_GAP_US:
                    presence.append((str(uuid.uuid4()), video_id, tid, start, max(prev, start + 1), count)); start, count = o.pts_us, 0
                prev, count = o.pts_us, count + 1
            presence.append((str(uuid.uuid4()), video_id, tid, start, max(prev, start + 1), count))
        # frame/timestamp index (media contract): derived from the source alone, so every run agrees; shots are per run, not stored here
        for i in range(0, len(frame_index_rows), 2000):
            cur.executemany("INSERT INTO video_frame_index (video_id, frame_index, pts_us, keyframe) VALUES (%s, %s, %s, %s) "
                            "ON DUPLICATE KEY UPDATE frame_index = frame_index", frame_index_rows[i:i + 2000])
        known = {r[1] for r in frame_index_rows}
        stray = sorted({r[1] for r in obs_rows} - known)
        if stray:                                                  # an observation must point at a frame of this run's index: say which, never guess
            raise JobError("FRAME_INDEX_MISMATCH", f"{len(stray)} observed frames are missing from the frame index (first: {stray[:5]}; indexed {len(known)}).")
        for i in range(0, len(obs_rows), 2000):
            cur.executemany("""INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence,
                                   association_confidence, observation_state, model_version_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'DETECTED', %s)""",
                            obs_rows[i:i + 2000])
        if presence:
            cur.executemany("INSERT INTO presence_intervals (id, video_id, track_id, start_pts_us, end_pts_us, observation_count) VALUES (%s, %s, %s, %s, %s, %s)", presence)
        appearance_stats = _store_appearance(cur, store, org, project_id, run_id, apps, links, track_ids, embed_model_id) if with_appearance else None
        jersey_stats = _store_jersey(cur, run_id, tracks, jersey, neighbour_rows, track_ids, ocr_runtime) if with_appearance else None
        stats = {"sampled_frames": frames, "detections": len(rows), "detections_on_pitch": sum(1 for r in rows if r[8]), "person_tracks": sum(t.label == "PERSON" for t in tracks),
                 "ball_tracks": sum(t.label == "BALL" for t in tracks), "shots": len(shot_ids), "seconds": round(elapsed, 1),
                 "frames_per_second": round(frames / elapsed, 2) if elapsed > 0 else None, "model": det.entry["key"], "tiles": cfg["tiles"], "threads": threads,
                 "runtime": det.runtime, "retracked_from": reuse, "team_seed": team_info, "follow": follow_stats, "dino_gate": tracker.dino_stats,
                 "appearance": appearance_stats, "appearance_runtime": embed_runtime,
                 "shirt_numbers": jersey_stats, "profile": cfg.get("profile"), "grids": cfg.get("grids"), "passes_per_frame": det.passes_per_frame() if hasattr(det, "passes_per_frame") else None,
                 "candidate_tracks_rejected": rejected, "double_boxes_dropped": dropped, "confirmation": confirm, "stabilized": stabilize, "pitch_filter": cfg.get("pitch") or "STRICT", "cross_scale": bool(cfg.get("cross_scale", False))}
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        _step(cur, run_id, "SHOTS", status="SUCCEEDED", progress=100, completed_at=now)
        _step(cur, run_id, "DETECT", status="SUCCEEDED", progress=100, completed_at=now, output_asset_id=asset_id, model_version_id=model_version_id)
        _step(cur, run_id, "TRACK", status="SUCCEEDED", progress=100, started_at=now, completed_at=now)
        cur.execute("INSERT IGNORE INTO pipeline_steps (id, run_id, step_name) VALUES (%s, %s, 'IDENTIFY')", (str(uuid.uuid4()), run_id))  # runs started before 0014
        _step(cur, run_id, "IDENTIFY", status="SUCCEEDED" if with_appearance else "CANCELLED", progress=100 if with_appearance else 0, started_at=now,
              completed_at=now, **({"model_version_id": embed_model_id} if embed_model_id else {}))
        cur.execute("UPDATE pipeline_runs SET status = 'SUCCEEDED', finished_at = CURRENT_TIMESTAMP(6), config = JSON_SET(config, '$.result', CAST(%s AS JSON)) WHERE id = %s",
                    (json.dumps(stats), run_id))
        audit(cur, org, SERVICE, "analysis.completed", "analysis_run", run_id, stats, f"job:{job.id}")
        publish(cur, org, "analysis_run", run_id, "analysis.completed", {"run_id": run_id, "video_id": video_id}, f"analysis-completed:{run_id}")
    return {"run_id": run_id, **stats}


def _embed_model_version(cur, emb) -> str:
    e = emb.entry
    version = f"{e['revision'][:12]}-{emb.runtime}"
    cur.execute("SELECT id FROM model_versions WHERE task = 'EMBED' AND model_name = %s AND semantic_version = %s", (e["key"], version))
    row = cur.fetchone()
    if row:
        return row["id"]
    mid = str(uuid.uuid4())
    cur.execute("INSERT INTO model_versions (id, task, model_name, semantic_version, weights_sha256, license_id, config) VALUES (%s, 'EMBED', %s, %s, %s, %s, %s)",
                (mid, e["key"], version, emb.weights_sha256, "Apache-2.0", json.dumps({"source": e["source"], "revision": e["revision"], "runtime": emb.runtime})))
    return mid


def _store_appearance(cur, store, org, project_id, run_id, apps, links, track_ids, model_id) -> dict:
    """Embeddings (one Parquet evidence file), thumbnails (JPEG assets), track_appearance rows and link suggestions."""
    emb_asset = None
    with_emb = [a for a in apps if a.embedding is not None]
    if with_emb:
        key = f"org/{org}/runs/{run_id}/embeddings.parquet"
        table = pa.table({"track_number": [a.number for a in with_emb], "embedding": [a.embedding.tolist() for a in with_emb],
                          "kit_histogram": [a.kit.tolist() for a in with_emb]})
        Path(store.path(key)).parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(table, store.path(key), compression="zstd")
        sha = hashlib.sha256(Path(store.path(key)).read_bytes()).hexdigest()
        emb_asset = str(uuid.uuid4())
        cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, metadata) "
                    "VALUES (%s, %s, %s, 'EMBEDDINGS', %s, 'local', %s, %s, 'application/vnd.apache.parquet', %s)",
                    (emb_asset, org, project_id, key, os.path.getsize(store.path(key)), sha, json.dumps({"run_id": run_id, "rows": len(with_emb)})))
    row_of = {a.number: i for i, a in enumerate(with_emb)}
    thumbs = 0
    for a in apps:
        tid = track_ids.get(a.number)
        if not tid:
            continue
        thumb_id = None
        if a.thumbnail_jpeg:
            key = f"org/{org}/runs/{run_id}/thumbs/{a.number}.jpg"
            Path(store.path(key)).parent.mkdir(parents=True, exist_ok=True)
            Path(store.path(key)).write_bytes(a.thumbnail_jpeg)
            thumb_id = str(uuid.uuid4())
            cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, metadata) "
                        "VALUES (%s, %s, %s, 'THUMBNAIL', %s, 'local', %s, %s, 'image/jpeg', %s)",
                        (thumb_id, org, project_id, key, len(a.thumbnail_jpeg), hashlib.sha256(a.thumbnail_jpeg).hexdigest(),
                         json.dumps({"run_id": run_id, "track": a.number})))
            thumbs += 1
        rgb = "#" + "".join(f"{int(min(255, max(0, v))):02X}" for v in a.rgb)
        cur.execute("""INSERT INTO track_appearance (track_id, run_id, kit_group, kit_rgb, embedding_asset_id, embedding_row, crop_count, drift_score,
                                                     thumbnail_asset_id, model_version_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (tid, run_id, a.group, rgb, emb_asset if a.number in row_of else None, row_of.get(a.number), a.crop_count,
                     None if a.drift is None else round(max(-1.0, min(1.0, a.drift)), 4), thumb_id, model_id if a.embedding is not None else None))
    for link in links:
        cur.execute("""INSERT INTO track_links (id, run_id, track_a_id, track_b_id, score, method, crosses_cut, gap_us, evidence, model_version_id)
                       VALUES (%s, %s, %s, %s, %s, 'APPEARANCE', %s, %s, %s, %s)""",
                    (str(uuid.uuid4()), run_id, track_ids[link["a"]], track_ids[link["b"]], link["score"], link["crosses_cut"], link["gap_us"],
                     json.dumps(link["evidence"]), model_id))
    groups = [a.group for a in apps]
    return {"described_tracks": len(apps), "with_embedding": len(with_emb), "thumbnails": thumbs, "kit_group_0": groups.count(0),
            "kit_group_1": groups.count(1), "no_kit_group": groups.count(None), "link_suggestions": len(links),
            "links_across_cuts": sum(1 for x in links if x["crosses_cut"]),
            "possible_identity_switches": sum(1 for a in apps if a.drift is not None and a.drift < DRIFT_WARNING)}


def with_appearance_cfg(cfg: dict) -> bool:
    return bool(cfg.get("appearance", True))


def _readable_people(f, ds, *, touchline: bool, surface: bool) -> list:
    """The people on the pitch in one frame whose shirt can be read: [(shirt Lab, horizontal centre)]."""
    on = classify_surface(ds, grass_mask(f.rgb)) if surface else classify(ds, grass_mask(f.rgb), touchline=touchline)
    out = []
    boxes = [(d.x, d.y, d.w, d.h) for d in ds if d.label == "PERSON" and d.score >= 0.3]
    for d, ok in zip(ds, on):
        if ok and d.label == "PERSON" and d.score >= 0.5:
            lab = appear.detection_lab(f.rgb, d, boxes)
            if lab is not None:
                out.append((lab, d.x + d.w / 2))
    return out


def scan_for_kickoff(path, det, duration_us: int, *, touchline: bool, surface: bool, sample_fps: float, step_s: float = 20.0, limit_s: float = 3000.0, progress=None):
    """Look for the kickoff without being told: one frame every `step_s` seconds from the start (up to `limit_s`), on the analysis's own time grid, until the two
    teams are seen on separate halves (appearance.find_kickoff). Returns (time_us or None, info)."""
    from . import ff
    from .frames import MAX_ANALYSIS_WIDTH
    limit = min(duration_us, int(limit_s * 1e6))
    times = list(range(0, max(1, limit), int(step_s * 1e6)))

    def people_of(t: int):
        if progress:
            progress(t / max(limit, 1))
        start = int(int(t * sample_fps / 1e6) / sample_fps * 1e6)
        fr = list(ff.decode_sampled(str(path), sample_fps, max_width=MAX_ANALYSIS_WIDTH, start_us=start, end_us=start + int(0.3 * 1e6), seek=True))[:1]
        if not fr:
            return None
        found = det.detect_frames(fr) if hasattr(det, "detect_frames") else det.detect([fr[0].rgb])
        return _readable_people(fr[0], found[0], touchline=touchline, surface=surface)

    t, info = appear.find_kickoff(times, people_of)
    if t is None:
        return None, info
    return int(int(t * sample_fps / 1e6) / sample_fps * 1e6), info


def teach_teams(path, det, seed_us: int, *, touchline: bool, surface: bool, sample_fps: float = 6.0):
    """The two team shirt colours from the moment the person pointed at (the kickoff: the teams stand on separate halves). Reads three frames around it,
    keeps the people on the pitch whose box is big enough to read a shirt, and builds the reference (appearance.build_team_reference). Returns
    (TeamReference | None, what it saw and why not, if not)."""
    from . import ff
    from .frames import MAX_ANALYSIS_WIDTH
    # the frames are taken on the analysis's own time grid (multiples of 1 / sample_fps): detections saved by an earlier run are found by frame time
    start = int(int(seed_us * sample_fps / 1e6) / sample_fps * 1e6)
    frames = list(ff.decode_sampled(str(path), sample_fps, max_width=MAX_ANALYSIS_WIDTH, start_us=start, end_us=start + int(0.8 * 1e6), seek=True))[:4]
    if not frames:
        return None, {"ok": False, "reason": "The video could not be read at that moment."}
    found = det.detect_frames(frames) if hasattr(det, "detect_frames") else det.detect([f.rgb for f in frames])
    people = []
    for f, ds in zip(frames, found):
        people.extend(_readable_people(f, ds, touchline=touchline, surface=surface))
    return appear.build_team_reference(people)


def drop_double_boxes(tracks, min_iou: float = 0.6) -> int:
    """Two tracks drawing a box on the same person in the same frame (a duplicate track after a crossing): in that frame the shorter track's
    box is dropped, so one person has one box. Returns how many observations were dropped."""
    from collections import defaultdict
    by_frame = defaultdict(list)
    for t in tracks:
        if t.label == "PERSON":
            for o in t.observations:
                by_frame[o.frame_index].append((t, o))
    drop = set()
    for obs in by_frame.values():
        for i in range(len(obs)):
            for j in range(i + 1, len(obs)):
                (ta, a), (tb, b) = obs[i], obs[j]
                if ta is tb:
                    continue
                iw = min(a.x + a.w, b.x + b.w) - max(a.x, b.x)
                ih = min(a.y + a.h, b.y + b.h) - max(a.y, b.y)
                if iw <= 0 or ih <= 0:
                    continue
                inter = iw * ih
                if inter / (a.w * a.h + b.w * b.h - inter) >= min_iou:
                    drop.add(id(b) if len(ta.observations) >= len(tb.observations) else id(a))
    n = 0
    for t in tracks:
        if t.label == "PERSON":
            before = len(t.observations)
            t.observations = [o for o in t.observations if id(o) not in drop]
            n += before - len(t.observations)
    return n


def _iou(a, b) -> float:
    iw, ih = min(a.x + a.w, b.x + b.w) - max(a.x, b.x), min(a.y + a.h, b.y + b.h) - max(a.y, b.y)
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    return inter / (a.w * a.h + b.w * b.h - inter)


MAX_RESCUES = 6          # samples in a row (about a second) a track may be carried off the pitch before grass must confirm it again


def continues_track(d, tracks, pts_us: int, rescued: dict, *, max_gap_us: int = 1_500_000) -> bool:
    """A person the pitch filter rejects (grass in deep shade reads blue-grey, a player at the touchline) but whose box overlaps where an on-pitch
    track (>= 3 hits) was a moment ago: he keeps his track. At most MAX_RESCUES samples in a row per track: a track must be seen on the grass again
    to go on, so it can never walk into the stands and spread through a crowd. `rescued` is the caller's per-track count."""
    for t in tracks:
        if t.label != "PERSON" or not t.observations or t.hits < 3 or pts_us - t.last_pts_us > max_gap_us or rescued.get(id(t), 0) >= MAX_RESCUES:
            continue
        if _iou(d, t.observations[-1]) >= 0.4:
            rescued[id(t)] = rescued.get(id(t), 0) + 1
            return True
    return False


def _confirm(tracks, rule: dict):
    """Temporal confirmation (ADR-034): a person track is kept with `min_hits` detections and at least one detection scoring
    `min_peak` or more — or, so that a legitimate player seen only briefly is not lost, with `strong_hits` (default 2) detections of
    which one scores `strong_peak` or more. Low-confidence boxes can extend or start candidate tracks, but never become a track on
    their own. Rejected candidates are counted (by reason), not stored as tracks; their raw detections stay in the evidence file."""
    kept, rejected = [], {"too_few_detections": 0, "no_confident_detection": 0}
    for t in tracks:
        if t.label == "PERSON":
            if not t.observations:                          # every box of it was a duplicate of another track's
                continue
            peak = max(o.score for o in t.observations)
            strong = rule.get("strong_peak") is not None and len(t.observations) >= int(rule.get("strong_hits", 2)) and peak >= float(rule["strong_peak"])
            if strong:
                kept.append(t)
                continue
            if len(t.observations) < int(rule["min_hits"]):
                rejected["too_few_detections"] += 1
                continue
            if max(o.score for o in t.observations) < float(rule["min_peak"]):
                rejected["no_confident_detection"] += 1
                continue
        kept.append(t)
    for i, t in enumerate(kept, 1):
        t.number = i
    return kept, rejected


def _store_jersey(cur, run_id, tracks, jersey, neighbour_rows, track_ids, runtime) -> dict:
    """Shirt-number evidence for every person track (TOO_SMALL when it never was large enough), and the look-alike neighbour graph."""
    model_id = None
    if runtime:
        version = f"ppocr-v4-det-rec-{runtime}"
        cur.execute("SELECT id FROM model_versions WHERE task = 'OCR' AND model_name = 'ppocr_v4' AND semantic_version = %s", (version,))
        row = cur.fetchone()
        model_id = row["id"] if row else str(uuid.uuid4())
        if not row:
            cur.execute("INSERT INTO model_versions (id, task, model_name, semantic_version, license_id, config) VALUES (%s, 'OCR', 'ppocr_v4', %s, 'Apache-2.0', %s)",
                        (model_id, version, json.dumps({"detector": "ppocr_v4_det", "recogniser": "ppocr_v4_en_rec", "runtime": runtime})))
    counts = {"RECOGNIZED": 0, "UNCERTAIN": 0, "UNREADABLE": 0, "TOO_SMALL": 0}
    for t in tracks:
        if t.label != "PERSON" or t.number not in track_ids:
            continue
        ev = jersey.get(t.number) if runtime else None
        if ev is None:
            ev = jer.JerseyEvidence("TOO_SMALL" if runtime else "UNREADABLE", None, None, "UNKNOWN", 0, [], [])
            if not runtime:
                continue                                   # no reader: record nothing rather than a misleading verdict
        counts[ev.state] += 1
        cur.execute("""INSERT INTO track_jersey_evidence (track_id, run_id, state, number, confidence, side, candidate_frames, frame_reads, alternatives, model_version_id)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (track_ids[t.number], run_id, ev.state, ev.number, ev.confidence, ev.side, ev.candidate_frames, json.dumps(ev.reads),
                     json.dumps(ev.alternatives), model_id))
    rows = [(track_ids[n["a"]], track_ids[n["b"]], n["cosine"], n["kit_similarity"], n["rank"]) for n in neighbour_rows if n["a"] in track_ids and n["b"] in track_ids]
    for i in range(0, len(rows), 1000):
        cur.executemany("INSERT INTO track_neighbours (track_id, neighbour_id, cosine, kit_similarity, rank_no) VALUES (%s, %s, %s, %s, %s)", rows[i:i + 1000])
    return {**{k.lower(): v for k, v in counts.items()}, "runtime": runtime, "neighbour_pairs": len(rows)}


def _fail(runner: JobRunner, job: Job, run_id: str, step: str, code: str, detail: str) -> dict:
    with tx(runner.conn) as cur:
        _step(cur, run_id, step, status="FAILED", error_code=code[:64])
        cur.execute("UPDATE pipeline_steps SET status = 'CANCELLED' WHERE run_id = %s AND status IN ('QUEUED', 'RUNNING')", (run_id,))
        cur.execute("UPDATE pipeline_runs SET status = 'FAILED', failure_code = %s, failure_detail = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s",
                    (code[:64], detail[:2000], run_id))
        audit(cur, job.organization_id, SERVICE, "analysis.failed", "analysis_run", run_id, {"code": code, "detail": detail}, f"job:{job.id}")
    return {"run_id": run_id, "status": "FAILED", "code": code}
