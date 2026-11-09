"""The real processing pipeline on REAL football footage (Blocks 04-06): ingest -> playback copy -> analysis (shots, detection, tracking).
Footage: CC BY-SA 4.0 France–Germany match clip from Wikimedia Commons (.local/eval-footage, SOURCES.json); weights: the registered,
SHA-256-verified RT-DETRv2 checkpoint. Skipped (with the reason) where either is absent. A synthetic clip with no people must produce
no person tracks: the engine never invents detections."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path

import pyarrow.parquet as pq
import pytest

from vie_worker import ff
from vie_worker.detect.base import models_dir, registry
from vie_worker.jobs import JobRunner
from vie_worker.main import HANDLERS

FOOTAGE = Path(__file__).resolve().parents[4] / ".local" / "eval-footage" / "france_germany_ccbysa.ogv"
MODEL = registry()["default"]
needs_real = pytest.mark.skipif(not FOOTAGE.exists() or not (models_dir() / MODEL / "model.safetensors").exists(),
                                reason="evaluation footage or verified model weights not present on this machine (tools/models/fetch_models.py)")


def run_all(stack, kinds) -> list[str]:
    runner = JobRunner(stack["dsn"], "test-worker", kinds, lease_seconds=300)
    out = []
    while (o := runner.run_one(HANDLERS)) is not None:
        out.append(o)
    return out


def start_analysis(root, org: str, video: str, sample_fps: float, tiles: int) -> str:
    run = str(uuid.uuid4())
    with root.cursor() as cur:
        cur.execute("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, config) VALUES (%s, %s, %s, 'test', 'QUEUED', %s)",
                    (run, video, org, json.dumps({"sample_fps": sample_fps, "tiles": tiles, "detector": None, "score_floor": 0.2})))
        for s in ("SHOTS", "DETECT", "TRACK"):
            cur.execute("INSERT INTO pipeline_steps (id, run_id, step_name) VALUES (UUID(), %s, %s)", (run, s))
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (UUID(), %s, 'ANALYZE', 'analysis_run', %s, %s, %s)",
                    (org, run, f"analyze:{run}", json.dumps({"run_id": run})))
    return run


def ingest(stack, root, seed, data: bytes, name: str) -> dict:
    s = seed.completed_upload(data, name)
    assert run_all(stack, ["INGEST_UPLOAD"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT state, organization_id FROM video_sources WHERE id = %s", (s["video"],))
        assert cur.fetchone()["state"] == "INGESTED"
    return s


@needs_real
def test_real_match_footage_is_detected_tracked_and_stored_as_evidence(stack, root, seed):
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    with root.cursor() as cur:
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (UUID(), %s, 'PROXY', 'video', %s, %s, %s)",
                    (s["org"], s["video"], f"proxy:{s['video']}", json.dumps({"video_id": s["video"]})))
    assert run_all(stack, ["PROXY"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT a.object_key, a.mime_type FROM video_sources v JOIN assets a ON a.id = v.proxy_asset_id WHERE v.id = %s", (s["video"],))
        proxy = cur.fetchone()
    pinfo = ff.ffprobe_json(str(Path(stack["storage"], *proxy["object_key"].split("/"))), "-show_format", "-show_streams")   # a real VP9 playback copy
    pv = ff.main_video(pinfo)
    assert proxy["mime_type"] == "video/webm" and pv["codec_name"] == "vp9" and pv["width"] <= 960
    assert float(pinfo["format"]["duration"]) > 15
    assert (ff.first_frame_time(str(Path(stack["storage"], *proxy["object_key"].split("/"))), "v:0") or 0) < 0.001   # on the media clock

    run = start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT status, JSON_EXTRACT(config, '$.result') AS r FROM pipeline_runs WHERE id = %s", (run,))
        r = cur.fetchone()
        result = json.loads(r["r"])
        cur.execute("SELECT step_name, status FROM pipeline_steps WHERE run_id = %s ORDER BY step_name", (run,))
        steps = {x["step_name"]: x["status"] for x in cur.fetchall()}
        cur.execute("SELECT class_name, COUNT(*) AS n, MIN(observation_count) AS min_obs, MAX(identity_state) AS idstate FROM tracks WHERE run_id = %s GROUP BY class_name", (run,))
        by_class = {x["class_name"]: x for x in cur.fetchall()}
        cur.execute("SELECT COUNT(*) AS n, MIN(bbox_x) AS x0, MAX(bbox_x + bbox_w) AS x1, MAX(bbox_y + bbox_h) AS y1, MIN(observation_state) AS st0, MAX(observation_state) AS st1 "
                    "FROM track_observations o JOIN tracks t ON t.id = o.track_id WHERE t.run_id = %s", (run,))
        obs = cur.fetchone()
        cur.execute("SELECT a.object_key, a.sha256, b.detection_count FROM detection_batches b JOIN assets a ON a.id = b.payload_asset_id WHERE b.run_id = %s", (run,))
        ev = cur.fetchone()
        cur.execute("SELECT m.model_name, m.weights_sha256 FROM pipeline_steps s JOIN model_versions m ON m.id = s.model_version_id WHERE s.run_id = %s AND s.step_name = 'DETECT'", (run,))
        model = cur.fetchone()
        cur.execute("SELECT COUNT(*) AS n FROM video_shots WHERE run_id = %s", (run,))
        shots = cur.fetchone()["n"]
        cur.execute("""SELECT ta.kit_group, ta.kit_rgb, ta.crop_count, ta.drift_score, ta.embedding_row, a.object_key AS thumb, t.class_name
                         FROM track_appearance ta JOIN tracks t ON t.id = ta.track_id LEFT JOIN assets a ON a.id = ta.thumbnail_asset_id
                        WHERE ta.run_id = %s""", (run,))
        looks = cur.fetchall()
        cur.execute("SELECT l.score, l.gap_us, l.crosses_cut, ta.first_pts_us AS a_first, ta.last_pts_us AS a_last, tb.first_pts_us AS b_first "
                    "FROM track_links l JOIN tracks ta ON ta.id = l.track_a_id JOIN tracks tb ON tb.id = l.track_b_id WHERE l.run_id = %s", (run,))
        links = cur.fetchall()
        cur.execute("SELECT m.model_name FROM pipeline_steps s JOIN model_versions m ON m.id = s.model_version_id WHERE s.run_id = %s AND s.step_name = 'IDENTIFY'", (run,))
        emb_model = cur.fetchone()
    assert r["status"] == "SUCCEEDED" and steps == {"DETECT": "SUCCEEDED", "SHOTS": "SUCCEEDED", "TRACK": "SUCCEEDED", "IDENTIFY": "SUCCEEDED"}
    assert result["sampled_frames"] >= 16 and result["model"] == MODEL and shots >= 1
    assert by_class["PERSON"]["n"] >= 3, by_class                             # players are found in real match footage
    assert by_class["PERSON"]["min_obs"] >= 2 and by_class["PERSON"]["idstate"] == "UNRESOLVED"     # no one-frame tracks, no identities
    assert obs["n"] >= 20 and obs["x0"] >= 0 and obs["x1"] <= 1.00001 and obs["y1"] <= 1.00001
    assert obs["st0"] == obs["st1"] == "DETECTED"                             # only real detections are stored, nothing interpolated
    path = Path(stack["storage"], *ev["object_key"].split("/"))
    import hashlib
    assert hashlib.sha256(path.read_bytes()).hexdigest() == ev["sha256"]
    table = pq.read_table(path)
    assert table.num_rows == ev["detection_count"] == result["detections"]
    assert set(table.column("label").to_pylist()) <= {"PERSON", "BALL"} and "on_pitch" in table.column_names
    assert model["model_name"] == MODEL and len(model["weights_sha256"]) == 64
    # appearance (ADR-031): evidence for review only — kit colour groups, embeddings, thumbnails, link suggestions; no identity created
    assert len(looks) >= 3 and all(x["class_name"] == "PERSON" and x["crop_count"] >= 3 for x in looks)
    assert {x["kit_group"] for x in looks} >= {0, 1}, looks                  # two kits on the pitch (France / Germany)
    assert all(x["kit_rgb"] and x["kit_rgb"].startswith("#") for x in looks)
    assert all(x["embedding_row"] is not None for x in looks) and emb_model["model_name"] == "dinov2_small"
    assert all((x["drift_score"] is not None) == (x["crop_count"] >= 6) for x in looks)        # the drift check needs 3+ crops per half
    assert all(Path(stack["storage"], *x["thumb"].split("/")).read_bytes()[:2] == b"\xff\xd8" for x in looks if x["thumb"])   # JPEG crops
    assert result["appearance"]["described_tracks"] == len(looks) and result["appearance"]["link_suggestions"] == len(links)
    # shirt-number evidence (ADR-033): one verdict per person track; RECOGNIZED only with agreement over >= 2 frames; never invented
    with root.cursor() as cur:
        cur.execute("SELECT e.state, e.number, e.candidate_frames, e.frame_reads FROM track_jersey_evidence e JOIN tracks t ON t.id = e.track_id WHERE t.run_id = %s", (run,))
        ev = cur.fetchall()
        cur.execute("SELECT COUNT(*) AS n FROM tracks WHERE run_id = %s AND class_name = 'PERSON'", (run,))
        persons = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(*) AS n FROM track_neighbours n JOIN tracks t ON t.id = n.track_id WHERE t.run_id = %s", (run,))
        nb = cur.fetchone()["n"]
    assert len(ev) == persons and result["shirt_numbers"]["runtime"].startswith("openvino")
    for e in ev:
        assert e["state"] in ("RECOGNIZED", "UNCERTAIN", "UNREADABLE", "TOO_SMALL")
        assert (e["state"] == "TOO_SMALL") == (e["candidate_frames"] == 0)
        if e["state"] == "RECOGNIZED":
            assert sum(1 for r in json.loads(e["frame_reads"]) if r["number"] == e["number"]) >= 2
    assert nb == result["shirt_numbers"]["neighbour_pairs"] and nb > 0
    for x in links:                                                           # links join tracks that never overlap, earlier -> later
        assert x["b_first"] > x["a_last"] and x["gap_us"] == x["b_first"] - x["a_last"] and 0 <= x["score"] <= 1


@needs_real
def test_no_people_are_invented_in_a_video_without_people(stack, root, seed, media):
    s = ingest(stack, root, seed, media["mp4"].read_bytes(), "noise.mp4")
    run = start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM tracks WHERE run_id = %s AND class_name = 'PERSON'", (run,))
        assert cur.fetchone()["n"] == 0


@needs_real
def test_a_cancelled_run_stops_and_an_unverified_video_is_refused(stack, root, seed, media):
    s = ingest(stack, root, seed, media["mp4"].read_bytes(), "x.mp4")
    run = start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    with root.cursor() as cur:
        cur.execute("UPDATE pipeline_runs SET status = 'CANCELLED' WHERE id = %s", (run,))
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]                     # settles without doing anything
    with root.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM tracks WHERE run_id = %s", (run,))
        assert cur.fetchone()["n"] == 0
        cur.execute("UPDATE video_sources SET state = 'VALIDATING' WHERE id = %s", (s["video"],))
    run2 = start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["failed"]
    with root.cursor() as cur:
        cur.execute("SELECT error_code FROM worker_jobs WHERE subject_id = %s", (run2,))
        assert cur.fetchone()["error_code"] == "VIDEO_NOT_READY"


@needs_real
def test_a_retrack_replays_the_saved_detections_and_never_runs_the_detector(stack, root, seed, monkeypatch):
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    first = start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    # from now on the detector must not be loaded at all
    import vie_worker.analyze as an
    monkeypatch.setattr(an, "load_detector", lambda *a, **k: (_ for _ in ()).throw(AssertionError("the detector was loaded during a re-track")))
    second = str(uuid.uuid4())
    with root.cursor() as cur:
        cur.execute("SELECT config FROM pipeline_runs WHERE id = %s", (first,))
        cfg = json.loads(cur.fetchone()["config"])
        cfg.pop("result", None)
        cur.execute("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, config) VALUES (%s, %s, %s, 'test', 'QUEUED', %s)",
                    (second, s["video"], s["org"], json.dumps({**cfg, "pitch": "TOUCHLINE", "reuse_detections_from": first})))
        for st in ("SHOTS", "DETECT", "TRACK"):
            cur.execute("INSERT INTO pipeline_steps (id, run_id, step_name) VALUES (UUID(), %s, %s)", (second, st))
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (UUID(), %s, 'ANALYZE', 'analysis_run', %s, %s, %s)",
                    (s["org"], second, f"analyze:{second}", json.dumps({"run_id": second})))
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT status, JSON_EXTRACT(config, '$.result') AS r FROM pipeline_runs WHERE id = %s", (second,))
        row = cur.fetchone()
        cur.execute("SELECT JSON_EXTRACT(config, '$.result') AS r FROM pipeline_runs WHERE id = %s", (first,))
        before = json.loads(cur.fetchone()["r"])
        cur.execute("SELECT COUNT(*) AS n FROM tracks WHERE run_id = %s AND class_name = 'PERSON'", (second,))
        persons = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(*) AS n FROM tracks WHERE run_id = %s", (first,))
        old_tracks = cur.fetchone()["n"]
    after = json.loads(row["r"])
    assert row["status"] == "SUCCEEDED" and after["retracked_from"] == first
    assert after["detections"] == before["detections"] and after["sampled_frames"] == before["sampled_frames"]    # exactly the saved detections, the same frames
    assert persons >= 1 and old_tracks > 0                                                                       # the first run is untouched
