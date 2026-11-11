"""SQLite support for the worker tests (SQLite conversion, safeguards 4/5).

TEST-ONLY schema: the subset of the post-migration MySQL shape the worker tests, the load test and
the comparison harness actually touch (worker_jobs, audit_events, outbox_events, worker_status, plus
tracks / track_observations / event_candidates / ball_tracks / ball_positions). This is NOT a
migration — the real SQLite schema is the migrations agent's (agent A); this file exists so the
worker tests can run against SQLite here, without MySQL, and so the harness has a known shape to
create when the real schema is not available.

Rules it mirrors from plan v4 §1d:
* dates as INTEGER ms since the epoch (``DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))``
  where MySQL defaults to CURRENT_TIMESTAMP(6));
* booleans as INTEGER 0/1; JSON as TEXT holding a json.dumps string;
* STRICT tables (a deliberate test-only choice: a value of the wrong type must fail loudly here, not
  silently coerce — the coordinator confirms whether the real SQLite schema is STRICT too).
"""
from __future__ import annotations

import os
from pathlib import Path

#: integer-ms "now" as a SQLite DEFAULT expression (parenthesised expressions are allowed in DEFAULT).
NOW_MS = "(CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))"

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL DEFAULT {NOW_MS}
) STRICT;

CREATE TABLE IF NOT EXISTS worker_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'QUEUED',
  priority INTEGER NOT NULL DEFAULT 5,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at INTEGER NOT NULL DEFAULT {NOW_MS},
  claim_token TEXT,
  lease_expires_at INTEGER,
  heartbeat_at INTEGER,
  worker_id TEXT,
  progress REAL NOT NULL DEFAULT 0,
  stage_message TEXT,
  error_code TEXT,
  error_detail TEXT,
  result TEXT,
  created_at INTEGER NOT NULL DEFAULT {NOW_MS},
  started_at INTEGER,
  finished_at INTEGER,
  paused_at INTEGER,
  paused_by TEXT,
  CHECK (state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PAUSED')),
  CHECK (priority BETWEEN 1 AND 9),
  CHECK (progress BETWEEN 0 AND 100)
) STRICT;

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL,
  actor_id TEXT,
  actor_kind TEXT NOT NULL DEFAULT 'USER',
  actor_service TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  request_id TEXT,
  before_state TEXT,
  after_state TEXT,
  occurred_at INTEGER NOT NULL DEFAULT {NOW_MS}
) STRICT;

CREATE TABLE IF NOT EXISTS outbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  created_at INTEGER NOT NULL DEFAULT {NOW_MS},
  claimed_at INTEGER,
  delivered_at INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS worker_status (
  worker_id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  kinds TEXT NOT NULL,
  cpu_percent REAL,
  cpu_count INTEGER,
  memory_used_bytes INTEGER,
  memory_total_bytes INTEGER,
  gpu_name TEXT,
  gpu_percent REAL,
  busy INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  reported_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  shot_id TEXT,
  internal_track_number INTEGER NOT NULL,
  class_name TEXT NOT NULL,
  first_pts_us INTEGER NOT NULL,
  last_pts_us INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  identity_state TEXT NOT NULL DEFAULT 'UNRESOLVED',
  quality_score REAL,
  observation_count INTEGER,
  mean_confidence REAL,
  created_at INTEGER NOT NULL DEFAULT {NOW_MS},
  UNIQUE (run_id, internal_track_number)
) STRICT;

CREATE TABLE IF NOT EXISTS track_observations (
  video_id TEXT NOT NULL,
  frame_index INTEGER NOT NULL,
  track_id TEXT NOT NULL,
  pts_us INTEGER NOT NULL,
  bbox_x REAL NOT NULL,
  bbox_y REAL NOT NULL,
  bbox_w REAL NOT NULL,
  bbox_h REAL NOT NULL,
  detector_confidence REAL,
  association_confidence REAL,
  observation_state TEXT NOT NULL,
  model_version_id TEXT,
  PRIMARY KEY (video_id, frame_index, track_id)
) STRICT;

CREATE TABLE IF NOT EXISTS event_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  ball_track_id TEXT,
  event_type TEXT NOT NULL,
  start_pts_us INTEGER NOT NULL,
  end_pts_us INTEGER NOT NULL,
  primary_track_id TEXT,
  secondary_track_id TEXT,
  kit_group INTEGER,
  confidence REAL,
  evidence_state TEXT NOT NULL DEFAULT 'DETECTED',
  features TEXT NOT NULL DEFAULT '{{}}'
) STRICT;

CREATE TABLE IF NOT EXISTS ball_tracks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  metrics TEXT,
  failure_code TEXT,
  failure_detail TEXT,
  requested_by TEXT,
  created_at INTEGER NOT NULL DEFAULT {NOW_MS},
  finished_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS ball_positions (
  ball_track_id TEXT NOT NULL REFERENCES ball_tracks(id),
  pts_us INTEGER NOT NULL,
  state TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (ball_track_id, pts_us)
) STRICT;
"""


def apply_schema(conn) -> None:
    """Create the test schema on an open db.py connection (either backend's cursor handles the DDL
    as written for SQLite; for MySQL this is never used — the real migrations apply there)."""
    with conn.cursor() as cur:
        for stmt in SCHEMA.split(";"):
            stmt = stmt.strip()
            if stmt:
                cur.execute(stmt)


def make_stack(data_dir: str | Path) -> dict:
    """A fresh SQLite stack under ``data_dir``: sets OTSI_VIE_DATA_DIR (the db.py path guard needs
    it), creates the file, applies the test schema. Returns {"dsn", "path", "data_dir"}."""
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["OTSI_VIE_DATA_DIR"] = str(data_dir)
    path = data_dir / "vie-worker-test.db"
    if path.exists():
        path.unlink()
        for suffix in ("-wal", "-shm"):
            sidecar = Path(str(path) + suffix)
            if sidecar.exists():
                sidecar.unlink()
    dsn = f"sqlite:///{path}"
    from vie_worker.db import connect
    conn = connect(dsn)
    try:
        apply_schema(conn)
    finally:
        conn.close()
    return {"dsn": dsn, "path": str(path), "data_dir": str(data_dir)}
