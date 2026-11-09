"""Runtime smoke for the compiled `outbox-dispatcher` worker (apps/api/dist/workers/outbox-dispatcher.js).

Creates a brand-new scratch database on the disposable MySQL 8.4 server (127.0.0.1:3507 — never 3306), migrates it with the real
migrator, provisions roles and a least-privilege runtime account, starts the worker as a separate process with only the environment a
deployment gives it, publishes one event, and checks the worker settles it. Everything is dropped afterwards.
Usage: python otsi-vie/tools/smoke/outbox_worker_smoke.py   (build the API first: corepack pnpm -C otsi-vie/apps/api build)
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pymysql

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
sys.path.insert(0, str(APP / "tools" / "db"))
import migrate  # noqa: E402
import roles  # noqa: E402

PORT = 3507
PW = next(l.split("=", 1)[1].strip() for l in (ROOT / ".local" / "mysql-lint.env").read_text().splitlines() if l.startswith("MYSQL_ROOT_PASSWORD="))


def main() -> int:
    name, user, upw = "vie_smoke_" + uuid.uuid4().hex[:10], "otsi_app_s_" + uuid.uuid4().hex[:6], uuid.uuid4().hex
    admin = pymysql.connect(host="127.0.0.1", port=PORT, user="root", password=PW, autocommit=True)
    proc = None
    try:
        with admin.cursor() as cur:
            cur.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
        root_dsn = f"mysql://root:{PW}@127.0.0.1:{PORT}/{name}"
        migrate.up(root_dsn, applied_by="smoke")
        roles.provision(root_dsn)
        with admin.cursor() as cur:
            cur.execute(f"CREATE USER '{user}'@'%' IDENTIFIED BY '{upw}'")
            cur.execute(f"GRANT otsi_app TO '{user}'@'%'")
            cur.execute(f"SET DEFAULT ROLE otsi_app TO '{user}'@'%'")
        env = {"PATH": os.environ["PATH"], "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
               "OTSI_VIE_DB_DSN": f"mysql://{user}:{upw}@127.0.0.1:{PORT}/{name}", "OTSI_VIE_OUTBOX_POLL_MS": "100"}
        proc = subprocess.Popen(["node", str(APP / "apps" / "api" / "dist" / "workers" / "outbox-dispatcher.js")], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        db = pymysql.connect(host="127.0.0.1", port=PORT, user="root", password=PW, database=name, autocommit=True)
        org = str(uuid.uuid4())
        with db.cursor() as cur:
            cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s, 'Smoke', %s)", (org, f"smoke-{org}"))
            cur.execute("INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, event_payload) "
                        "VALUES (%s, 'smoke', %s, 'smoke.published', '{}')", (org, str(uuid.uuid4())))
            eid = cur.lastrowid
        deadline = time.time() + 15
        delivered = None
        while time.time() < deadline and delivered is None:
            if proc.poll() is not None:
                break
            with db.cursor() as cur:
                cur.execute("SELECT delivered_at FROM outbox_events WHERE id=%s", (eid,))
                delivered = cur.fetchone()[0]
            time.sleep(0.2)
        db.close()
        alive = proc.poll() is None
        proc.terminate()
        out = proc.communicate(timeout=10)[0]
        print(f"worker alive while polling: {alive}")
        print(f"event {eid} delivered_at: {delivered}")
        print("worker output:\n" + out.strip())
        return 0 if (alive and delivered is not None) else 1
    finally:
        if proc and proc.poll() is None:
            proc.kill()
        with admin.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS `{name}`")
            cur.execute(f"DROP USER IF EXISTS '{user}'@'%'")
        admin.close()


if __name__ == "__main__":
    sys.exit(main())
