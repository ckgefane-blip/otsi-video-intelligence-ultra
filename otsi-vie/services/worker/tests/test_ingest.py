"""INGEST_UPLOAD on real encoded videos, a real scratch database and real files: accepted media gets measured facts, a thumbnail,
assets, audit and an event; everything else is refused with the precise reason — nothing is guessed or faked."""
from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path

import pytest

from vie_worker.ingest import handle_ingest_upload, sniff
from vie_worker.jobs import JobRunner
from vie_worker.main import HANDLERS


def run(stack, lease: int = 60) -> str | None:
    return JobRunner(stack["dsn"], "test-worker", ["INGEST_UPLOAD"], lease_seconds=lease).run_one(HANDLERS)


def video(root, vid: str) -> dict:
    with root.cursor() as cur:
        cur.execute("SELECT * FROM video_sources WHERE id = %s", (vid,))
        return cur.fetchone()


def job(root, jid: str) -> dict:
    with root.cursor() as cur:
        cur.execute("SELECT * FROM worker_jobs WHERE id = %s", (jid,))
        return cur.fetchone()


def test_accepts_a_real_mp4_with_measured_facts_thumbnail_assets_audit_and_event(stack, root, seed, media):
    data = media["mp4"].read_bytes()
    s = seed.completed_upload(data, "Final.mp4", expected_sha256=hashlib.sha256(data).hexdigest())
    assert len(data) > 2 * 1024 * 1024                                          # assembled from 3+ parts
    assert run(stack) == "succeeded"
    v = video(root, s["video"])
    assert v["state"] == "INGESTED" and v["failure_code"] is None
    assert (v["width"], v["height"], v["video_codec"], v["audio_codec"]) == (320, 240, "mpeg4", "aac")
    assert v["container_format"].startswith("mov,mp4")
    assert 3_900_000 <= v["duration_us"] <= 4_200_000                       # 4 s encoded
    assert (v["avg_frame_rate_num"], v["avg_frame_rate_den"]) == (25, 1)
    assert v["is_variable_frame_rate"] == 0
    assert v["video_sha256"] == hashlib.sha256(data).hexdigest()
    with root.cursor() as cur:
        cur.execute("SELECT kind, object_key, byte_size, sha256 FROM assets WHERE id IN (%s, %s) ORDER BY kind", (v["source_asset_id"], v["thumbnail_asset_id"]))
        src, thumb = cur.fetchall()
        cur.execute("SELECT action, actor_kind, actor_service FROM audit_events WHERE entity_id = %s", (s["video"],))
        assert cur.fetchall() == [{"action": "video.ingested", "actor_kind": "SERVICE", "actor_service": "ingest-worker"}]
        cur.execute("SELECT event_type FROM outbox_events WHERE aggregate_id = %s", (s["video"],))
        assert [r["event_type"] for r in cur.fetchall()] == ["video.ingested"]
        cur.execute("SELECT status FROM upload_sessions WHERE id = %s", (s["upload"],))
        assert cur.fetchone()["status"] == "COMPLETED"
    stored = Path(stack["storage"], *src["object_key"].split("/"))
    assert src["kind"] == "SOURCE" and stored.read_bytes() == data and src["sha256"] == hashlib.sha256(data).hexdigest()
    jpg = Path(stack["storage"], *thumb["object_key"].split("/")).read_bytes()
    assert thumb["kind"] == "THUMBNAIL" and jpg[:3] == b"\xff\xd8\xff"           # a real JPEG decoded from the video
    assert not (Path(stack["storage"]) / "uploads" / s["upload"]).exists()     # parts deleted after assembly
    j = job(root, s["job"])
    assert (j["state"], float(j["progress"]), j["claim_token"]) == ("SUCCEEDED", 100.0, None)


def test_detects_variable_frame_rate_and_other_containers(stack, root, seed, media):
    vfr = seed.completed_upload(media["mkv_vfr"].read_bytes(), "phone.mkv")
    avi = seed.completed_upload(media["avi"].read_bytes(), "old.avi")
    assert run(stack) == "succeeded" and run(stack) == "succeeded"
    v1, v2 = video(root, vfr["video"]), video(root, avi["video"])
    assert (v1["state"], v1["container_format"], v1["is_variable_frame_rate"]) == ("INGESTED", "matroska,webm", 1)
    assert (v2["state"], v2["video_codec"]) == ("INGESTED", "mjpeg")


@pytest.mark.parametrize("case,state,code", [
    ("random", "QUARANTINED", "NOT_A_VIDEO"),
    ("truncated", "FAILED", "DAMAGED_OR_INCOMPLETE"),
    ("tiny", "FAILED", "RESOLUTION_TOO_LOW"),
    ("checksum", "FAILED", "CHECKSUM_MISMATCH"),
])
def test_refuses_with_the_precise_reason(stack, root, seed, media, case, state, code):
    good = media["mp4"].read_bytes()
    if case == "random":
        s = seed.completed_upload(os.urandom(300_000), "renamed-document.mp4")
    elif case == "truncated":
        s = seed.completed_upload(good[: len(good) // 3], "cut.mp4")
    elif case == "tiny":
        s = seed.completed_upload(media["tiny"].read_bytes(), "tiny.mp4")
    else:
        s = seed.completed_upload(good, "x.mp4", expected_sha256="0" * 64)
    assert run(stack) == "succeeded"                                          # the job reached a verdict
    v = video(root, s["video"])
    assert v["state"] == state and v["failure_detail"]
    if code:
        assert v["failure_code"] == code
    assert v["source_asset_id"] is None and v["duration_us"] is None          # no facts are recorded for a refused file
    with root.cursor() as cur:
        cur.execute("SELECT action FROM audit_events WHERE entity_id = %s", (s["video"],))
        assert [r["action"] for r in cur.fetchall()] == ["video.ingest_refused"]
    assert not (Path(stack["storage"]) / "uploads" / s["upload"]).exists()


def test_a_part_changed_after_upload_is_detected(stack, root, seed, media):
    s = seed.completed_upload(media["mp4"].read_bytes(), "x.mp4")
    p = Path(stack["storage"]) / "uploads" / s["upload"] / "part-000002"
    p.write_bytes(b"\x00" + p.read_bytes()[1:])
    assert run(stack) == "succeeded"
    assert video(root, s["video"])["failure_code"] == "STORAGE_CORRUPTION"


def test_a_crashed_worker_is_taken_over_after_its_lease_and_fenced(stack, root, seed, media):
    s = seed.completed_upload(media["mp4"].read_bytes(), "x.mp4")
    crashed = JobRunner(stack["dsn"], "crashed", ["INGEST_UPLOAD"], lease_seconds=1)
    stale = crashed.claim()
    assert stale and stale.id == s["job"]
    assert run(stack) is None                                                   # lease still held
    time.sleep(1.3)
    assert run(stack) == "succeeded"
    assert crashed.succeed(stale, {}) is False                                  # the crashed worker's late result changes nothing
    j = job(root, s["job"])
    assert (j["state"], j["attempts"]) == ("SUCCEEDED", 2)


def test_unexpected_errors_are_retried_then_failed_without_leaking_internals(stack, root, seed, media, monkeypatch):
    s = seed.completed_upload(media["mp4"].read_bytes(), "x.mp4")
    with root.cursor() as cur:
        cur.execute("UPDATE worker_jobs SET max_attempts = 2 WHERE id = %s", (s["job"],))
    monkeypatch.setitem(HANDLERS, "INGEST_UPLOAD", lambda r, j: (_ for _ in ()).throw(RuntimeError("secret internal path C:\\x password=hunter2")))
    assert run(stack) == "retry"
    j = job(root, s["job"])
    assert (j["state"], j["error_code"]) == ("QUEUED", "INTERNAL_ERROR") and "hunter2" not in j["error_detail"]
    with root.cursor() as cur:
        cur.execute("UPDATE worker_jobs SET available_at = NOW(6) WHERE id = %s", (s["job"],))
    assert run(stack) == "failed"
    assert job(root, s["job"])["state"] == "FAILED"
    monkeypatch.setitem(HANDLERS, "INGEST_UPLOAD", handle_ingest_upload)


def test_a_job_cannot_reach_another_organizations_upload(stack, root, seed, media):
    s = seed.completed_upload(media["mp4"].read_bytes(), "x.mp4")
    other_org, _, _ = seed.org()
    with root.cursor() as cur:
        cur.execute("UPDATE worker_jobs SET organization_id = %s WHERE id = %s", (other_org, s["job"]))
    assert run(stack) == "failed"
    assert job(root, s["job"])["error_code"] == "NOT_FOUND"
    assert video(root, s["video"])["state"] == "VALIDATING"                     # untouched


def test_file_signatures(tmp_path, media):
    assert sniff(media["mp4"]) == "mp4/mov" and sniff(media["mkv_vfr"]) == "matroska/webm" and sniff(media["avi"]) == "avi"
    (tmp_path / "x.mp4").write_bytes(b"%PDF-1.7 not a video" * 100)
    assert sniff(tmp_path / "x.mp4") is None
