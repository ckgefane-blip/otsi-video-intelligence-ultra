"""Worker tests: a BRAND-NEW scratch database on the disposable MySQL (127.0.0.1:3507), migrated, roles provisioned, a least-privilege
runtime account for the worker; a temporary storage directory; real video files encoded by FFmpeg (PyAV) for this run only.
Synthetic media exists only here (ADR-020). Everything is dropped afterwards. Never touches port 3306 or the owner's workspace."""
from __future__ import annotations

import hashlib
import os
import sys
import uuid
from pathlib import Path

import pymysql
import pytest

WORKER = Path(__file__).resolve().parents[1]
APP = WORKER.parents[1]
ROOT = APP.parent
sys.path.insert(0, str(WORKER))
sys.path.insert(0, str(APP / "tools" / "db"))
sys.path.insert(0, str(APP / "tools" / "dev"))
import migrate  # noqa: E402
import roles  # noqa: E402
from test_media import encode  # noqa: E402

PORT = 3507
PW = next(l.split("=", 1)[1].strip() for l in (ROOT / ".local" / "mysql-lint.env").read_text().splitlines() if l.startswith("MYSQL_ROOT_PASSWORD="))
MiB = 1024 * 1024


@pytest.fixture(scope="session")
def stack(tmp_path_factory):
    name, user, upw = "vie_worker_" + uuid.uuid4().hex[:10], "otsi_app_w_" + uuid.uuid4().hex[:6], uuid.uuid4().hex
    admin = pymysql.connect(host="127.0.0.1", port=PORT, user="root", password=PW, autocommit=True)
    with admin.cursor() as cur:
        cur.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
    root_dsn = f"mysql://root:{PW}@127.0.0.1:{PORT}/{name}"
    try:
        migrate.up(root_dsn, applied_by="worker-tests")
        roles.provision(root_dsn)
        with admin.cursor() as cur:
            cur.execute(f"CREATE USER '{user}'@'%' IDENTIFIED BY '{upw}'")
            cur.execute(f"GRANT otsi_app TO '{user}'@'%'")
            cur.execute(f"SET DEFAULT ROLE otsi_app TO '{user}'@'%'")
        storage = tmp_path_factory.mktemp("storage")
        os.environ["OTSI_VIE_STORAGE_DIR"] = str(storage)
        yield {"dsn": f"mysql://{user}:{upw}@127.0.0.1:{PORT}/{name}", "db": name, "storage": storage}
    finally:
        with admin.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS `{name}`")
            cur.execute(f"DROP USER IF EXISTS '{user}'@'%'")
        admin.close()


@pytest.fixture()
def root(stack):
    c = pymysql.connect(host="127.0.0.1", port=PORT, user="root", password=PW, database=stack["db"], autocommit=True, cursorclass=pymysql.cursors.DictCursor)
    yield c
    c.close()


# ------------------------------------------------------------------ real media, encoded for the test run (tools/dev/test_media.py)
@pytest.fixture(scope="session")
def media(tmp_path_factory) -> dict[str, Path]:
    d = tmp_path_factory.mktemp("media")
    return {
        "mp4": encode(d / "match.mp4", seconds=4, audio=True, bit_rate=8_000_000, noise=True),          # > 1 MiB: several real upload parts
        "mkv_vfr": encode(d / "phone.mkv", container="matroska", vfr=True, seconds=4),
        "tiny": encode(d / "tiny.mp4", width=64, height=48),
        "avi": encode(d / "old.avi", codec="mjpeg", container="avi", seconds=2),
    }


# ------------------------------------------------------------------ an upload as the API leaves it at "complete"
class Seed:
    def __init__(self, root, storage: Path):
        self.root, self.storage = root, storage

    def org(self) -> tuple[str, str, str]:
        org, user, project = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        with self.root.cursor() as cur:
            cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s, 'Test org', %s)", (org, f"o-{org}"))
            cur.execute("INSERT INTO users (id, external_subject, email, display_name) VALUES (%s, %s, %s, 'Tester')", (user, f"s-{user}", f"{user}@test.invalid"))
            cur.execute("INSERT INTO projects (id, organization_id, name, created_by) VALUES (%s, %s, 'P', %s)", (project, org, user))
        return org, user, project

    def completed_upload(self, data: bytes, file_name: str, *, part_bytes: int = MiB, expected_sha256: str | None = None) -> dict:
        org, user, project = self.org()
        video, upload, job = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        with self.root.cursor() as cur:
            cur.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, title, original_filename, byte_size, state, created_by) "
                        "VALUES (%s, %s, %s, 'UPLOAD', 'T', %s, %s, 'VALIDATING', %s)", (video, org, project, file_name, len(data), user))
            cur.execute("INSERT INTO upload_sessions (id, organization_id, video_id, created_by, idempotency_key, original_filename, expected_bytes, expected_sha256, "
                        "part_bytes, status, expires_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'VERIFYING', NOW(6) + INTERVAL 1 DAY)",
                        (upload, org, video, user, f"k-{upload}", file_name, len(data), expected_sha256, part_bytes))
            d = self.storage / "uploads" / upload
            d.mkdir(parents=True)
            for n, off in enumerate(range(0, len(data), part_bytes), 1):
                chunk = data[off:off + part_bytes]
                (d / f"part-{n:06d}").write_bytes(chunk)
                cur.execute("INSERT INTO upload_parts (session_id, part_number, byte_size, remote_etag, checked_at) VALUES (%s, %s, %s, %s, NOW(6))",
                            (upload, n, len(chunk), hashlib.sha256(chunk).hexdigest()))
            cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (%s, %s, 'INGEST_UPLOAD', 'video', %s, %s, %s)",
                        (job, org, video, f"ingest:{upload}", f'{{"video_id": "{video}", "upload_id": "{upload}"}}'))
        return {"org": org, "video": video, "upload": upload, "job": job}


@pytest.fixture()
def seed(root, stack):
    # each test runs only its own jobs: anything left open by an earlier test is cancelled first
    with root.cursor() as cur:
        cur.execute("UPDATE worker_jobs SET state = 'CANCELLED', claim_token = NULL, lease_expires_at = NULL WHERE state IN ('QUEUED', 'RUNNING')")
    return Seed(root, stack["storage"])
