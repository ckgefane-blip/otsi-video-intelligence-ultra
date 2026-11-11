"""Same-results comparison harness (distribution plan v4 §1d, safeguard 5).

Runs ONE deterministic workload through the real db.py functions on a backend and dumps the
resulting tables in canonical form; two dumps are then diffed. The workload is the DB-level
output of the workers for a fixed input: job claims (all six kinds, staggered priorities),
progress reports (including a same-value repeat), audit + outbox writes (including a duplicate
dedupe key), settle outcomes (succeed / retry / terminal fail), a status upsert, and track /
observation / event / ball-track rows.

Wall-clock columns can never match between two runs (each backend stamps its own "now"), so they
are EXCLUDED from the diff by design and listed in the dump (see EXCLUDED): started_at /
finished_at / heartbeat_at / lease_expires_at / available_at on worker_jobs, occurred_at on
audit_events, created_at on outbox_events / tracks / ball_tracks, finished_at on ball_tracks,
reported_at on worker_status. Everything else — states, payloads, JSON, counts, IDs — must match
exactly. A MATCH means the two backends produced the same DB-level results; it does not by itself
mean the full video pipeline matches (that needs a real match on the host — see below).

Usage (here — SQLite only; MySQL cannot run on this VM):
  python3 compare_backends.py run --backend sqlite --dsn sqlite:////tmp/cmp-a/vie.db --init-sqlite-schema --out /tmp/cmp-a.json
  python3 compare_backends.py run --backend sqlite --dsn sqlite:////tmp/cmp-b/vie.db --init-sqlite-schema --out /tmp/cmp-b.json
  python3 compare_backends.py diff /tmp/cmp-a.json /tmp/cmp-b.json
  python3 compare_backends.py selfcheck        # the two SQLite runs above, end to end; must MATCH

On the owner's host (the real MySQL-vs-SQLite comparison):
  # MySQL side: a scratch database on host MySQL 3507, migrated with the real migrations.
  python3 compare_backends.py run --backend mysql --mysql-scratch --repo-root D:\\OTSI-Ultra --out C:\\Temp\\cmp-mysql.json
  # SQLite side: a file prepared with the REAL SQLite migrations (agent A), NOT --init-sqlite-schema.
  python3 compare_backends.py run --backend sqlite --dsn sqlite:///D:/OTSI-VIE/data/vie-compare.db --out C:\\Temp\\cmp-sqlite.json
  python3 compare_backends.py diff C:\\Temp\\cmp-mysql.json C:\\Temp\\cmp-sqlite.json
  # --init-sqlite-schema is for here/CI only: it creates the TEST schema (tests/sqlite_support.py),
  # which mirrors the post-migration shape but is not the migration itself.

The MySQL side CANNOT run here (no MySQL server on this VM, pymysql not installed) — the harness
says so plainly and exits non-zero instead of claiming a comparison it did not run.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "tests"))

from vie_worker import db  # noqa: E402
from vie_worker.db import audit, connect, publish, tx  # noqa: E402
from vie_worker.jobs import JobRunner  # noqa: E402

NS = uuid.NAMESPACE_URL
BASE_MS = db.to_ms(datetime(2026, 11, 11, 8, 20, 0, tzinfo=timezone.utc))

TABLES = ["organizations", "worker_jobs", "audit_events", "outbox_events", "worker_status",
          "tracks", "track_observations", "event_candidates", "ball_tracks", "ball_positions"]
ORDER_BY = {
    "organizations": "id", "worker_jobs": "id", "audit_events": "id", "outbox_events": "id",
    "worker_status": "worker_id", "tracks": "id", "track_observations": "video_id, frame_index, track_id",
    "event_candidates": "id", "ball_tracks": "id", "ball_positions": "ball_track_id, pts_us",
}
#: wall-clock columns: stamped with "now" by whichever backend runs the workload, so they cannot
#: match between runs and are excluded from the diff (row COUNTS still compare).
EXCLUDED = {
    "worker_jobs": ["started_at", "finished_at", "heartbeat_at", "lease_expires_at", "available_at"],
    "audit_events": ["occurred_at"],
    "outbox_events": ["created_at", "claimed_at", "delivered_at"],
    "worker_status": ["reported_at"],
    "tracks": ["created_at"],
    "ball_tracks": ["created_at", "finished_at"],
}

KINDS = ["INGEST_UPLOAD", "PROXY", "ANALYZE", "RENDER", "TRACK_BALL", "READ_LINEUPS"]
PRIORITIES = [5, 1, 8, 3, 5, 2]


def _uid(name: str) -> str:
    return str(uuid.uuid5(NS, f"otsi-compare:{name}"))


def run_workload(dsn: str) -> None:
    """The deterministic workload. Every ID, timestamp-that-matters and payload is fixed; only the
    EXCLUDED wall-clock columns vary, by design."""
    org = _uid("org")
    run_id, video_id = _uid("run"), _uid("video")
    c = connect(dsn)
    try:
        with tx(c) as cur:
            cur.execute("INSERT INTO organizations (id, name, slug, created_at) VALUES (%s, %s, %s, %s)",
                        (org, "Compare org", "compare-org", BASE_MS))
            for i, (kind, prio) in enumerate(zip(KINDS, PRIORITIES)):
                cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, priority, available_at, created_at) "
                            "VALUES (%s, %s, %s, 'video', %s, %s, %s, %s, %s, %s)",
                            (_uid(f"job:{kind}"), org, kind, video_id, f"cmp:{kind}",
                             json.dumps({"video_id": video_id, "n": i}), prio, BASE_MS - 1000, BASE_MS + i * 1000))
        runner = JobRunner(dsn, "cmp-w1", KINDS, lease_seconds=120, org_max_running=100)
        settled = []
        for n in range(6):
            job = runner.claim()
            assert job is not None, f"claim {n} returned None"
            for pct in (10.0, 50.0, 99.0, 99.0):  # the last repeat changes nothing: the lease must hold
                runner.progress(job, pct, f"compare step {n}")
            with tx(runner.conn) as cur:
                audit(cur, org, "compare-worker", "video.analysed", "video", job.subject_id,
                      {"kind": job.kind, "n": n}, f"cmp-req-{n}")
                publish(cur, org, "video", job.subject_id, "video.analysed",
                        {"kind": job.kind, "n": n}, dedupe_key=f"cmp:{job.kind}")
                publish(cur, org, "video", job.subject_id, "video.analysed",
                        {"kind": job.kind, "n": n}, dedupe_key=f"cmp:{job.kind}")  # duplicate: no-op
            settled.append(job)
        # settle: 4 succeed, 1 retryable (back to QUEUED), 1 terminal fail
        for i, job in enumerate(settled):
            if i < 4:
                assert runner.succeed(job, {"rank": i, "kind": job.kind})
            elif i == 4:
                assert runner.fail(job, "RETRY_ME", "compare retry", retryable=True) == "retry"
            else:
                assert runner.fail(job, "FINAL", "compare final", retryable=False) == "failed"
        runner.conn.close()
        # status upsert twice: the second write updates the one row in place
        started = datetime(2026, 11, 11, 8, 20, 0, tzinfo=timezone.utc)
        with tx(c) as cur:
            for cpu, busy in ((1.5, False), (42.5, True)):
                cur.execute("""INSERT INTO worker_status (worker_id, host, kinds, cpu_percent, cpu_count, memory_used_bytes, memory_total_bytes, gpu_name,
                                     gpu_percent, busy, started_at, reported_at)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, UTC_TIMESTAMP(6))
                               ON DUPLICATE KEY UPDATE cpu_percent = VALUES(cpu_percent), cpu_count = VALUES(cpu_count), memory_used_bytes = VALUES(memory_used_bytes),
                                 memory_total_bytes = VALUES(memory_total_bytes), gpu_name = VALUES(gpu_name), busy = VALUES(busy), reported_at = VALUES(reported_at)"""
                            if db.backend_of(c) == "mysql" else
                            """INSERT INTO worker_status (worker_id, host, kinds, cpu_percent, cpu_count, memory_used_bytes, memory_total_bytes, gpu_name,
                                     gpu_percent, busy, started_at, reported_at)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, UTC_TIMESTAMP(6))
                               ON CONFLICT(worker_id) DO UPDATE SET cpu_percent = excluded.cpu_percent, cpu_count = excluded.cpu_count,
                                 memory_used_bytes = excluded.memory_used_bytes, memory_total_bytes = excluded.memory_total_bytes,
                                 gpu_name = excluded.gpu_name, busy = excluded.busy, reported_at = excluded.reported_at""",
                            ("cmp-w1", "compare-host", json.dumps(KINDS), cpu, 8, 1_000_000, 2_000_000, None, busy, started))
        # tracks / observations / events / ball track — fixed geometry, fixed confidence
        with tx(c) as cur:
            for t in range(3):
                tid = _uid(f"track:{t}")
                first = 1_000_000 + t * 10_000_000
                cur.execute("INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, "
                            "quality_score, observation_count, mean_confidence) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'ENDED', %s, %s, %s)",
                            (tid, run_id, video_id, None, t, "PLAYER", first, first + 9 * 40_000, 0.9, 10, 0.9))
                rows = [(video_id, f, tid, first + f * 40_000, 0.1 + f * 0.01, 0.2, 0.05, 0.1, 0.9, 0.9, "DETECTED", None)
                        for f in range(10)]
                cur.executemany("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, "
                                "detector_confidence, association_confidence, observation_state, model_version_id) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                                rows)
            bid = _uid("ball-track")
            cur.execute("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, metrics) VALUES (%s, %s, %s, %s, 'SUCCEEDED', %s)",
                        (bid, org, video_id, run_id, json.dumps({"detected": 4, "inferred": 1})))
            cur.executemany("INSERT INTO ball_positions (ball_track_id, pts_us, state, x, y, confidence) VALUES (%s, %s, %s, %s, %s, %s)",
                            [(bid, 1_000_000 + f * 40_000, "DETECTED", 0.5, 0.5, 0.95) for f in range(5)])
            for e, (etype, kit) in enumerate([("PASS", 1), ("SHOT", None), ("TACKLE", 2), ("INTERCEPTION", 1)]):
                cur.execute("INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, "
                            "secondary_track_id, kit_group, confidence, evidence_state, features) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                            (_uid(f"event:{e}"), run_id, video_id, bid, etype, 2_000_000 + e * 1_000_000, 2_500_000 + e * 1_000_000,
                             _uid("track:0"), None, kit, 0.8, "DETECTED", json.dumps({"n": e})))
    finally:
        c.close()


def _canon(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, datetime):
        dt = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, int) and value > 1_000_000_000_000:
        # integer-ms timestamps (the SQLite backend) read back as ISO, like MySQL datetimes
        return db.from_ms(value).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).hex()
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return value
        if isinstance(parsed, (dict, list)):
            return json.dumps(parsed, sort_keys=True)
        return value
    return value


def dump(dsn: str) -> dict:
    backend = "sqlite" if db.is_sqlite_dsn(dsn) else "mysql"
    c = connect(dsn)
    try:
        out: dict = {"backend": backend, "tables": {}, "counts": {}}
        for table in TABLES:
            with c.cursor() as cur:
                cur.execute(f"SELECT * FROM {table} ORDER BY {ORDER_BY[table]}")
                rows = cur.fetchall()
                cols = list(rows[0].keys()) if rows else []
            excluded = EXCLUDED.get(table, [])
            kept = [col for col in cols if col not in excluded]
            canon_rows = [{k: _canon(r[k]) for k in kept} for r in rows]
            out["tables"][table] = {"columns": kept, "excluded": excluded, "rows": canon_rows}
            out["counts"][table] = len(rows)
        return out
    finally:
        c.close()


def diff_dumps(a: dict, b: dict) -> tuple[bool, list[str]]:
    problems: list[str] = []
    if a["counts"] != b["counts"]:
        problems.append(f"row counts differ: {a['counts']} vs {b['counts']}")
    for table in TABLES:
        ta, tb = a["tables"][table], b["tables"][table]
        if ta["columns"] != tb["columns"]:
            problems.append(f"{table}: columns differ: {ta['columns']} vs {tb['columns']}")
            continue
        if ta["rows"] != tb["rows"]:
            for i, (ra, rb) in enumerate(zip(ta["rows"], tb["rows"])):
                if ra != rb:
                    problems.append(f"{table} row {i} differs:\n  A: {json.dumps(ra, sort_keys=True)}\n  B: {json.dumps(rb, sort_keys=True)}")
                    if len(problems) > 10:
                        break
            if len(ta["rows"]) != len(tb["rows"]):
                problems.append(f"{table}: row count {len(ta['rows'])} vs {len(tb['rows'])}")
    return (not problems), problems


def _mysql_scratch(repo_root: str) -> str:
    """Host-only: a scratch MySQL database on 127.0.0.1:3507, migrated with the real migrations.
    Reads the root password from <repo>/.local/mysql-lint.env (the same file conftest.py reads);
    never creates that file. Returns the root DSN; the caller drops the database afterwards."""
    import uuid as _uuid
    root = Path(repo_root)
    pw = next(l.split("=", 1)[1].strip() for l in (root / ".local" / "mysql-lint.env").read_text().splitlines()
              if l.startswith("MYSQL_ROOT_PASSWORD="))
    try:
        import pymysql
    except ImportError as e:
        raise RuntimeError("MySQL side needs pymysql (installed on the owner's host, not on this VM)") from e
    name = "vie_compare_" + _uuid.uuid4().hex[:10]
    sys.path.insert(0, str(root / "otsi-vie" / "tools" / "db"))
    import migrate  # noqa: E402
    admin = pymysql.connect(host="127.0.0.1", port=3507, user="root", password=pw, autocommit=True)
    with admin.cursor() as cur:
        cur.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
    admin.close()
    dsn = f"mysql://root:{pw}@127.0.0.1:3507/{name}"
    migrate.up(dsn, applied_by="compare-backends")
    return dsn, name, pw


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--backend", choices=["sqlite", "mysql"], required=True)
    r.add_argument("--dsn", default=None)
    r.add_argument("--out", required=True)
    r.add_argument("--init-sqlite-schema", action="store_true")
    r.add_argument("--mysql-scratch", action="store_true")
    r.add_argument("--repo-root", default=None)
    d = sub.add_parser("diff")
    d.add_argument("a")
    d.add_argument("b")
    sub.add_parser("selfcheck")
    args = ap.parse_args()

    if args.cmd == "diff":
        a = json.loads(Path(args.a).read_text())
        b = json.loads(Path(args.b).read_text())
        ok, problems = diff_dumps(a, b)
        print("MATCH" if ok else "DIFFER")
        for p in problems:
            print(p)
        return 0 if ok else 1

    if args.cmd == "selfcheck":
        import sqlite_support  # noqa: E402
        base = Path(tempfile.mkdtemp(prefix="vie-compare-selfcheck-"))
        try:
            outs = []
            for tag in ("a", "b"):
                stack = sqlite_support.make_stack(base / tag)
                out = base / f"cmp-{tag}.json"
                run_workload(stack["dsn"])
                Path(out).write_text(json.dumps(dump(stack["dsn"]), indent=2, sort_keys=True))
                outs.append(str(out))
            a = json.loads(Path(outs[0]).read_text())
            b = json.loads(Path(outs[1]).read_text())
            ok, problems = diff_dumps(a, b)
            print("SELFCHECK:", "MATCH" if ok else "DIFFER")
            for p in problems:
                print(p)
            return 0 if ok else 1
        finally:
            shutil.rmtree(base, ignore_errors=True)

    # run
    dsn = args.dsn
    scratch = None
    if args.backend == "mysql":
        if args.mysql_scratch:
            if not args.repo_root:
                print("mysql --mysql-scratch needs --repo-root (host-only)")
                return 2
            try:
                dsn, scratch, _pw = _mysql_scratch(args.repo_root)
            except FileNotFoundError:
                print("MySQL side NOT RUN: <repo>/.local/mysql-lint.env not found (host-only; never fabricated here)")
                return 2
            except RuntimeError as e:
                print(f"MySQL side NOT RUN: {e}")
                return 2
        if not dsn:
            print("MySQL side needs --dsn or --mysql-scratch (no MySQL server on this VM)")
            return 2
    if args.backend == "sqlite" and args.init_sqlite_schema:
        import sqlite_support  # noqa: E402
        from vie_worker.db import connect as _connect
        if dsn:
            # fresh test schema on the DSN's own file: the file's folder is the data folder
            os.environ["OTSI_VIE_DATA_DIR"] = str(Path(urlparse(dsn).path).parent)
            conn = _connect(dsn)
            try:
                sqlite_support.apply_schema(conn)
            finally:
                conn.close()
        else:
            tmpdir = Path(tempfile.mkdtemp(prefix="vie-compare-"))
            stack = sqlite_support.make_stack(tmpdir)
            dsn = stack["dsn"]
    if not dsn:
        print("SQLite side needs --dsn (or --init-sqlite-schema to make a fresh test stack)")
        return 2
    try:
        run_workload(dsn)
    except ImportError as e:
        print(f"backend NOT RUN: {e} (MySQL needs pymysql + a server; host-only)")
        return 2
    except Exception as e:
        print(f"workload failed on {args.backend}: {type(e).__name__}: {e}")
        return 1
    Path(args.out).write_text(json.dumps(dump(dsn), indent=2, sort_keys=True))
    print(f"dumped {args.backend} to {args.out}")
    if scratch:
        print(f"NOTE: scratch MySQL database {scratch} was left in place for inspection; drop it when done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
