"""Concurrent-write load test for the SQLite backend (distribution plan v4 §1d, safeguard 4).

Three writers — mimicking the ingest, media and analysis workers — hammer the SAME SQLite file
through the real db.py functions (JobRunner.claim / progress / succeed, audit, publish, tx), with
realistic write patterns: job claims, progress updates, event inserts, track + observation inserts,
status upserts. The requirement is ZERO "database is locked" / SQLITE_BUSY errors.

Usage:
  python3 load_test_sqlite.py [--writers N] [--cycles N] [--busy-timeout-ms MS] [--data-dir DIR]
  python3 load_test_sqlite.py --writers 3 --busy-timeout-ms 0 --expect-lock-errors   # negative control

The negative control (busy_timeout 0) must FAIL with lock errors: if it does not, the test is not
actually detecting contention. Vary --writers 1 / 3 / 5 and record the results.

Workers are separate PROCESSES (like the real workers — main.py spawns processes), each with its
own JobRunner and connection. Exit code 0 means the run met its expectation (0 lock errors normally,
>0 for the negative control); anything else exits 1.
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import random
import shutil
import sqlite3
import sys
import tempfile
import time
import uuid
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "tests"))

import sqlite_support  # noqa: E402
from vie_worker import db  # noqa: E402
from vie_worker.db import audit, connect, publish, tx  # noqa: E402
from vie_worker.jobs import JobRunner  # noqa: E402

ROLES = ["INGEST_UPLOAD", "PROXY", "ANALYZE"]
STATUS_UPSERT = """INSERT INTO worker_status (worker_id, host, kinds, cpu_percent, cpu_count, memory_used_bytes, memory_total_bytes, gpu_name,
                     gpu_percent, busy, started_at, reported_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, UTC_TIMESTAMP(6))
                   ON CONFLICT(worker_id) DO UPDATE SET cpu_percent = excluded.cpu_percent, cpu_count = excluded.cpu_count,
                     memory_used_bytes = excluded.memory_used_bytes, memory_total_bytes = excluded.memory_total_bytes,
                     gpu_name = excluded.gpu_name, busy = excluded.busy, reported_at = excluded.reported_at"""


def _is_lock_error(e: BaseException) -> bool:
    return isinstance(e, sqlite3.OperationalError) and ("locked" in str(e) or "busy" in str(e))


def seed_jobs(dsn: str, org: str, kinds: list[str], n: int) -> None:
    c = connect(dsn)
    try:
        with c.cursor() as cur:
            cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s, %s, %s)", (org, "Load org", "load-org"))
            for i in range(n):
                jid = str(uuid.uuid4())
                cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (%s, %s, %s, 'video', %s, %s, %s)",
                            (jid, org, kinds[i % len(kinds)], str(uuid.uuid4()), f"load:{jid}", json.dumps({"n": i})))
    finally:
        c.close()


def writer_main(args) -> dict:
    """One worker process: claim jobs of its role's kind and work them, in a loop."""
    dsn, data_dir, index, cycles, tracks_per_cycle, obs_per_track = args
    os.environ["OTSI_VIE_DATA_DIR"] = data_dir
    kind = ROLES[index % len(ROLES)]
    worker_id = f"load-w{index}"
    rng = random.Random(1000 + index)
    org = None
    ops = lock_errors = 0
    other_errors: list[str] = []
    runner = JobRunner(dsn, worker_id, [kind], lease_seconds=120, org_max_running=100)
    started = db.now_ms()
    try:
        for cycle in range(cycles):
            try:
                job = runner.claim()
                ops += 1
                if job is None:
                    # queue drained: keep writing (standalone track/event batch, like analysis output)
                    with tx(runner.conn) as cur:
                        _write_tracks(cur, runner, rng, tracks_per_cycle, obs_per_track)
                    ops += 1
                    continue
                org = job.organization_id
                for pct in (25.0, 50.0, 75.0):
                    runner.progress(job, pct, f"cycle {cycle}")
                    ops += 1
                with tx(runner.conn) as cur:
                    audit(cur, org, "load-worker", "video.analysed", "video", job.subject_id,
                          {"cycle": cycle, "kind": kind}, f"load-{index}-{cycle}")
                    publish(cur, org, "video", job.subject_id, "video.analysed",
                            {"cycle": cycle}, dedupe_key=f"load:{index}:{cycle}")
                    _write_tracks(cur, runner, rng, tracks_per_cycle, obs_per_track)
                ops += 3
                with runner.conn.cursor() as cur:
                    cur.execute(STATUS_UPSERT, (worker_id, "load-host", json.dumps([kind]), 12.5, 8,
                                                1_000_000, 2_000_000, None, False, started))
                ops += 1
                runner.succeed(job, {"cycle": cycle, "tracks": tracks_per_cycle})
                ops += 1
            except Exception as e:  # noqa: BLE001 - counted, then the writer carries on (a lock error must not kill the run)
                if _is_lock_error(e):
                    lock_errors += 1
                else:
                    other_errors.append(f"{type(e).__name__}: {e}"[:200])
    finally:
        runner.conn.close()
    return {"writer": index, "kind": kind, "ops": ops, "lock_errors": lock_errors,
            "other_errors": other_errors[:5], "other_error_count": len(other_errors)}


def _write_tracks(cur, runner, rng, n_tracks: int, obs_per_track: int) -> None:
    """A realistic analysis write: N tracks with M observations each + one event per track, in the
    caller's transaction (the same shape analyze.py / ball_job.py write)."""
    run_id, video_id = str(uuid.uuid4()), str(uuid.uuid4())
    for t in range(n_tracks):
        tid = str(uuid.uuid4())
        first = rng.randrange(0, 1_000_000)
        cur.execute("INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, "
                    "quality_score, observation_count, mean_confidence) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'ENDED', %s, %s, %s)",
                    (tid, run_id, video_id, None, t, "PLAYER", first, first + obs_per_track * 40_000,
                     0.9, obs_per_track, 0.9))
        rows = [(video_id, f, tid, first + f * 40_000, round(rng.random(), 4), round(rng.random(), 4),
                 0.05, 0.1, 0.9, 0.9, "DETECTED", None) for f in range(obs_per_track)]
        cur.executemany("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, "
                        "detector_confidence, association_confidence, observation_state, model_version_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        rows)
        cur.execute("INSERT INTO event_candidates (id, run_id, video_id, event_type, start_pts_us, end_pts_us, primary_track_id, confidence, evidence_state, features) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (str(uuid.uuid4()), run_id, video_id, "PASS", first, first + 40_000, tid, 0.8, "DETECTED", "{}"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--writers", type=int, default=3)
    ap.add_argument("--cycles", type=int, default=40)
    ap.add_argument("--tracks-per-cycle", type=int, default=5)
    ap.add_argument("--obs-per-track", type=int, default=20)
    ap.add_argument("--busy-timeout-ms", type=int, default=db.BUSY_TIMEOUT_MS)
    ap.add_argument("--expect-lock-errors", action="store_true", help="negative control: pass only if lock errors occur")
    ap.add_argument("--data-dir", default=None)
    ap.add_argument("--keep-data-dir", action="store_true")
    args = ap.parse_args()

    tmpdir = Path(args.data_dir) if args.data_dir else Path(tempfile.mkdtemp(prefix="vie-load-test-"))
    try:
        stack = sqlite_support.make_stack(tmpdir)
        dsn = stack["dsn"]
        if args.busy_timeout_ms != db.BUSY_TIMEOUT_MS:
            dsn = f"{dsn}?busy_timeout_ms={args.busy_timeout_ms}"
        org = str(uuid.uuid4())
        seed_jobs(dsn, org, ROLES, args.writers * args.cycles + 10)
        t0 = time.monotonic()
        with ProcessPoolExecutor(max_workers=args.writers, mp_context=mp.get_context("fork")) as pool:
            results = list(pool.map(writer_main, [(dsn, str(tmpdir), i, args.cycles, args.tracks_per_cycle, args.obs_per_track)
                                                  for i in range(args.writers)]))
        duration = time.monotonic() - t0
        total_ops = sum(r["ops"] for r in results)
        total_locks = sum(r["lock_errors"] for r in results)
        total_other = sum(r["other_error_count"] for r in results)
        summary = {"writers": args.writers, "cycles_per_writer": args.cycles,
                   "busy_timeout_ms": args.busy_timeout_ms, "duration_s": round(duration, 2),
                   "operations": total_ops, "lock_errors": total_locks, "other_errors": total_other,
                   "per_writer": results, "db": stack["path"]}
        print(json.dumps(summary, indent=2))
        if args.expect_lock_errors:
            ok = total_locks > 0
            print("NEGATIVE CONTROL:", "PASS (lock errors detected)" if ok else "FAIL (no lock errors: the test detects nothing)")
            return 0 if ok else 1
        print(f"LOCK ERRORS: {total_locks} (requirement: 0)")
        return 0 if (total_locks == 0 and total_other == 0) else 1
    finally:
        if not args.keep_data_dir and not args.data_dir:
            shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
