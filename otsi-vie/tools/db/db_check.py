"""db-check: validate every migration in database/migrations on a DISPOSABLE MySQL 8.4 server, never on an existing database.

What it does:
  1. makes sure the throwaway container `otsi-vie-v2-mysql-lint` runs (in-memory storage, bound to 127.0.0.1:3507 only);
  2. creates two fresh databases with unique names and applies every migration, in order, stopping at the first error;
  3. checks the result: no errors or warnings, the expected table / trigger counts, every foreign key resolved, and that both fresh databases end with
     the SAME schema fingerprint (the migrations are reproducible);
  4. drops the two scratch databases ("down") and writes the evidence to release-evidence/db-check/<UTC time>/.

Usage (from D:\\OTSI-Workspace\\VIE-Engine-v2):  python otsi-vie/tools/db/db_check.py
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "otsi-vie"
MIGRATIONS = APP / "database" / "migrations"
ENV_FILE = ROOT / ".local" / "mysql-lint.env"
CONTAINER = "otsi-vie-v2-mysql-lint"
IMAGE = "mysql:8.4@sha256:76f0358884cb92d9a086d24e5671c38048d3fef40f2588703d73eb55392d6b69"
EXPECT = {"tables": 143, "views": 5, "triggers": 32, "routines": 2}  # base tables (schema_migrations belongs to the migrator); 0002+0005+0007+0008 triggers; 0007 procedures


def sh(args: list[str], stdin: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, input=stdin, capture_output=True, text=True, encoding="utf-8", check=check)


def mysql(sql: str | None = None, db: str | None = None, stdin: str | None = None) -> str:
    """Run the mysql client INSIDE the throwaway container (the password never leaves its environment)."""
    # SQL always travels on stdin: on the command line the container shell would treat `backticks` as commands
    cmd = 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B --show-warnings --default-character-set=utf8mb4' + (f" {db}" if db else "")
    r = sh(["docker", "exec", "-i", CONTAINER, "sh", "-c", cmd], stdin=sql if sql is not None else stdin, check=False)
    if r.returncode != 0 or "Warning" in r.stdout or "ERROR" in r.stderr:
        raise RuntimeError((r.stderr + r.stdout).strip()[:4000])
    return r.stdout


def ensure_server() -> str:
    running = sh(["docker", "ps", "-q", "--filter", f"name=^{CONTAINER}$"]).stdout.strip()
    if not running:
        if not ENV_FILE.exists():
            import secrets
            ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
            ENV_FILE.write_text("MYSQL_ROOT_PASSWORD=" + secrets.token_urlsafe(24) + "\n", encoding="utf-8")
        sh(["docker", "rm", "-f", CONTAINER], check=False)
        sh(["docker", "run", "-d", "--name", CONTAINER, "--env-file", str(ENV_FILE), "--tmpfs", "/var/lib/mysql:rw,size=2g",
            "-p", "127.0.0.1:3507:3306", IMAGE])
    for _ in range(90):
        if sh(["docker", "exec", CONTAINER, "sh", "-c", 'mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD" --silent'], check=False).returncode == 0:
            break
        time.sleep(2)
    return mysql("SELECT CONCAT(VERSION(), ' | ', @@version_comment, ' | ', @@sql_mode)").strip()


def fingerprint(db: str) -> tuple[str, dict]:
    q = {
        "columns": f"SELECT table_name, column_name, column_type, is_nullable, IFNULL(column_default,'<null>'), extra FROM information_schema.columns WHERE table_schema='{db}' ORDER BY 1, ordinal_position",
        "indexes": f"SELECT table_name, index_name, non_unique, seq_in_index, column_name FROM information_schema.statistics WHERE table_schema='{db}' ORDER BY 1,2,4",
        "foreign_keys": f"SELECT table_name, constraint_name, referenced_table_name FROM information_schema.referential_constraints WHERE constraint_schema='{db}' ORDER BY 1,2",
        "checks": f"SELECT tc.table_name, cc.constraint_name, cc.check_clause FROM information_schema.check_constraints cc JOIN information_schema.table_constraints tc ON tc.constraint_schema=cc.constraint_schema AND tc.constraint_name=cc.constraint_name WHERE cc.constraint_schema='{db}' ORDER BY 1,2",
        "triggers": f"SELECT trigger_name, event_object_table, action_timing, event_manipulation FROM information_schema.triggers WHERE trigger_schema='{db}' ORDER BY 1",
    }
    parts = {k: mysql(v) for k, v in q.items()}
    text = "\n".join(f"## {k}\n{v}" for k, v in parts.items())
    counts = {k: len([x for x in v.splitlines() if x.strip()]) for k, v in parts.items()}
    counts["tables"] = int(mysql(f"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='{db}' AND table_type='BASE TABLE'").strip())
    counts["views"] = int(mysql(f"SELECT COUNT(*) FROM information_schema.views WHERE table_schema='{db}'").strip())
    counts["routines"] = int(mysql(f"SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='{db}'").strip())
    return hashlib.sha256(text.encode()).hexdigest(), {"counts": counts, "text": text}


def apply_all(db: str) -> list[str]:
    mysql(f"CREATE DATABASE `{db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
    applied = []
    for f in sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql")):
        try:
            mysql(db=db, stdin=f.read_text(encoding="utf-8"))
        except RuntimeError as e:
            raise RuntimeError(f"{f.name}: {e}") from None
        applied.append(f.name)
    return applied


def main() -> int:
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = APP / "release-evidence" / "db-check" / stamp
    out.mkdir(parents=True, exist_ok=True)
    report: dict = {"utc": stamp, "server": None, "migrations": [], "checks": {}, "ok": False}
    a, b = f"vie_check_{stamp.lower()}_a", f"vie_check_{stamp.lower()}_b"
    try:
        report["server"] = ensure_server()
        report["migrations"] = apply_all(a)
        apply_all(b)
        fa, ia = fingerprint(a)
        fb, _ = fingerprint(b)
        c = ia["counts"]
        report["checks"] = {
            "tables": {"expected": EXPECT["tables"], "actual": c["tables"], "ok": c["tables"] == EXPECT["tables"]},
            "triggers": {"expected": EXPECT["triggers"], "actual": c["triggers"], "ok": c["triggers"] == EXPECT["triggers"]},
            "views": {"expected": EXPECT["views"], "actual": c["views"], "ok": c["views"] == EXPECT["views"]},
            "routines": {"expected": EXPECT["routines"], "actual": c["routines"], "ok": c["routines"] == EXPECT["routines"]},
            "foreign_keys": {"actual": c["foreign_keys"], "ok": c["foreign_keys"] > 0},
            "check_constraints": {"actual": c["checks"]},
            "reproducible": {"fingerprint_a": fa, "fingerprint_b": fb, "ok": fa == fb},
        }
        (out / "schema_fingerprint.txt").write_text(ia["text"], encoding="utf-8")
        report["ok"] = all(v.get("ok", True) for v in report["checks"].values())
    except Exception as e:  # noqa: BLE001 - every failure is reported, never hidden
        report["error"] = str(e)
    finally:
        for db in (a, b):
            try:
                mysql(f"DROP DATABASE IF EXISTS `{db}`")
            except Exception:  # noqa: BLE001
                pass
    (out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("server", "migrations", "checks", "ok")} | ({"error": report["error"]} if "error" in report else {}), indent=1))
    print(f"evidence: {out}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
