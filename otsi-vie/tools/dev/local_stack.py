"""Run OTSI VIE v2 for real on this machine (ADR-020, ADR-021).

  python otsi-vie/tools/dev/local_stack.py run                     # prepare (first time) and start API + outbox worker + web app
  python otsi-vie/tools/dev/local_stack.py run --mysql portable   # same, but MySQL runs from a downloaded portable server (no Docker)
  python otsi-vie/tools/dev/local_stack.py bootstrap-owner --email you@example.com --name "Your Name" --organization "Your Club"
  python otsi-vie/tools/dev/local_stack.py status
  python otsi-vie/tools/dev/local_stack.py dev                     # development: web app with hot module replacement (next dev), API
                                                                   # recompiled and restarted on save, outbox worker, Python worker
  python otsi-vie/tools/dev/local_stack.py run --no-build --public-origin https://<name>.trycloudflare.com
        owner review preview (owner directive 2026-10-27): also accept that HTTPS origin, with Secure cookies. Only the web app (4310) is
        put behind the tunnel; the API (4520), MySQL (3508) and the workers stay on 127.0.0.1.

The REAL workspace ("owner" stack) lives in its own persistent MySQL 8.4 container `otsi-vie-v2-mysql` (127.0.0.1:3508 only; data in
VIE-Engine-v2/.local/mysql-data on D:), database `otsi_owner_vie`. It starts EMPTY: no fixtures, no sample data. The disposable server on
3507 (tools/db/db_check.py) is only for tests; scratch stacks (`--stack e2e-...`) live there and are dropped with `drop`.
Never touches the existing MySQL on port 3306. Secrets (DB passwords, the token signing key) are generated into .local/stack/<name>/ and
never committed. Nothing is published or deployed.
"""
from __future__ import annotations

import argparse
import base64
import os
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import pymysql

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
LOCAL = ROOT / ".local"
sys.path.insert(0, str(APP / "tools" / "db"))
import migrate  # noqa: E402
import roles  # noqa: E402

OWNER_CONTAINER, OWNER_PORT, OWNER_DB = "otsi-vie-v2-mysql", 3508, "otsi_owner_vie"
TEST_PORT = 3507
IMAGE = "mysql:8.4@sha256:76f0358884cb92d9a086d24e5671c38048d3fef40f2588703d73eb55392d6b69"   # same pinned 8.4.13 image as tools/db/db_check.py
# One Python worker process per group: a 70-minute analysis must not hold up the verification of a new upload (one process runs one job at a time)
WORKER_GROUPS = {"jobs-ingest": "INGEST_UPLOAD,INGEST_URL,ASSESS", "jobs-media": "PROXY,RENDER,CALIBRATE_PITCH,READ_LINEUPS,SNAPSHOT,BEAT_GRID", "jobs-analysis": "ANALYZE,TRACK_BALL"}   # TRACK_BALL: ~70 min on the GPU with the ball model
API_PORT, WEB_PORT = 4520, 4310   # 4300 is taken on the dev machine by an unrelated, pre-existing process
# Portable mode (the desktop app) gets its own ports so it can run side by
# side with the original engine instead of clashing on 4310/4520 (web) and
# 4520 (API). The database already did the same (portable 3510 vs Docker 3508).
PORTABLE_API_PORT, PORTABLE_WEB_PORT = 4521, 4311


def ports_for(mysql_mode: str) -> tuple[int, int]:
    """(api_port, web_port) for a stack mode: portable gets its own ports."""
    if mysql_mode == "portable":
        return PORTABLE_API_PORT, PORTABLE_WEB_PORT
    return API_PORT, WEB_PORT


def web_origins_for(web_port: int) -> str:
    return f"http://127.0.0.1:{web_port},http://localhost:{web_port}"
NODE = shutil.which("node") or "node"
COREPACK = shutil.which("corepack") or "corepack"


def env_file(path: Path) -> dict[str, str]:
    out = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def write_secret(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def sh(cmd: list[str], check: bool = True, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=check, **kw)


def owner_db_up(mysql_mode: str = "docker") -> str:
    """Start (or create) the persistent MySQL container for the real workspace; returns its root password."""
    if mysql_mode == "portable":
        import portable_mysql  # same directory as this file; only used in portable mode
        pw_file = LOCAL / "mysql-portable.env"  # separate file from Docker's mysql-owner.env
        if not pw_file.exists():
            write_secret(pw_file, f"MYSQL_ROOT_PASSWORD={secrets.token_urlsafe(24)}\n")
        pw = env_file(pw_file)["MYSQL_ROOT_PASSWORD"]
        portable_mysql.ensure_running(ROOT, pw)
        return pw
    secrets_file = LOCAL / "mysql-owner.env"
    if not secrets_file.exists():
        write_secret(secrets_file, f"MYSQL_ROOT_PASSWORD={secrets.token_urlsafe(24)}\n")
    pw = env_file(secrets_file)["MYSQL_ROOT_PASSWORD"]
    state = sh(["docker", "ps", "-a", "--filter", f"name=^{OWNER_CONTAINER}$", "--format", "{{.State}}"]).stdout.strip()
    if not state:
        data = LOCAL / "mysql-data"
        data.mkdir(parents=True, exist_ok=True)
        sh(["docker", "run", "-d", "--name", OWNER_CONTAINER, "--restart", "unless-stopped", "--env-file", str(secrets_file),
            "-v", f"{data.resolve().as_posix()}:/var/lib/mysql", "-p", f"127.0.0.1:{OWNER_PORT}:3306", IMAGE,
            "--character-set-server=utf8mb4", "--collation-server=utf8mb4_0900_ai_ci"])
        print(f"created MySQL container {OWNER_CONTAINER} (127.0.0.1:{OWNER_PORT}, data in {data})")
    elif state != "running":
        sh(["docker", "start", OWNER_CONTAINER])
    for _ in range(120):
        try:
            pymysql.connect(host="127.0.0.1", port=OWNER_PORT, user="root", password=pw).close()
            return pw
        except pymysql.err.OperationalError:
            time.sleep(1)
    raise SystemExit("MySQL did not become ready within 120 s")


def test_root_password() -> str:
    return env_file(LOCAL / "mysql-lint.env")["MYSQL_ROOT_PASSWORD"]


def stack_dir(name: str) -> Path:
    return LOCAL / "stack" / name


def prepare(name: str, mysql_mode: str = "docker") -> dict[str, str]:
    """Create (once) and migrate the stack's database, roles, runtime account and signing key; returns the process environment."""
    owner = name == "owner"
    if owner:
        # Portable mode runs its own mysqld on portable_mysql.PORT (3510),
        # a different port from the Docker owner stack (OWNER_PORT 3508), so
        # both can run side by side. The API/worker DSN must point at the
        # portable port, not the Docker one.
        root_pw = owner_db_up(mysql_mode)
        if mysql_mode == "portable":
            import portable_mysql
            port = portable_mysql.PORT
        else:
            port = OWNER_PORT
        db = OWNER_DB
    else:
        port, db, root_pw = TEST_PORT, f"vie_{name.replace('-', '_')}", test_root_password()
    assert port != 3306
    api_port, web_port = ports_for(mysql_mode)
    d = stack_dir(name)
    s = env_file(d / "secrets.env")
    if "DB_PASSWORD" in s and ("MEDIA_SIGNING_KEY" not in s or "CREDENTIAL_KEY" not in s):    # stacks created before these keys existed
        s.setdefault("MEDIA_SIGNING_KEY", secrets.token_urlsafe(32))
        s.setdefault("CREDENTIAL_KEY", base64.b64encode(secrets.token_bytes(32)).decode())
        write_secret(d / "secrets.env", "".join(f"{k}={v}\n" for k, v in s.items()))
    if "DB_PASSWORD" not in s:
        s = {"DB_USER": f"otsi_app_{secrets.token_hex(3)}", "DB_PASSWORD": secrets.token_urlsafe(24), "MEDIA_SIGNING_KEY": secrets.token_urlsafe(32),
             "CREDENTIAL_KEY": base64.b64encode(secrets.token_bytes(32)).decode()}
        write_secret(d / "secrets.env", "".join(f"{k}={v}\n" for k, v in s.items()))
    admin = pymysql.connect(host="127.0.0.1", port=port, user="root", password=root_pw, autocommit=True)
    with admin.cursor() as cur:
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
    root_dsn = f"mysql://root:{root_pw}@127.0.0.1:{port}/{db}"
    applied = migrate.up(root_dsn, applied_by=f"local_stack:{name}")
    roles.provision(root_dsn)                                  # re-run after every migration: new tables get their grants
    with admin.cursor() as cur:
        cur.execute(f"CREATE USER IF NOT EXISTS '{s['DB_USER']}'@'%' IDENTIFIED BY '{s['DB_PASSWORD']}'")
        cur.execute(f"GRANT otsi_app TO '{s['DB_USER']}'@'%'")
        cur.execute(f"SET DEFAULT ROLE otsi_app TO '{s['DB_USER']}'@'%'")
    admin.close()
    key = d / "signing-key.pem"
    if not key.exists():
        pem = sh([NODE, "-e", "const {generateKeyPairSync}=require('crypto');process.stdout.write(generateKeyPairSync('rsa',{modulusLength:3072,"
                  "privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey)"]).stdout
        write_secret(key, pem)
    storage = d / "storage"
    storage.mkdir(parents=True, exist_ok=True)
    if applied:
        print(f"[{name}] applied migrations: {', '.join(applied) if isinstance(applied, list) else applied}")
    return {
        "OTSI_VIE_DB_DSN": f"mysql://{s['DB_USER']}:{s['DB_PASSWORD']}@127.0.0.1:{port}/{db}",
        "OTSI_VIE_JWT_ISSUER": f"http://127.0.0.1:{web_port}/",
        "OTSI_VIE_JWT_AUDIENCE": "otsi-vie-api",
        "OTSI_VIE_LOCAL_SIGNING_KEY_FILE": str(key),
        "OTSI_VIE_INSECURE_COOKIES": "yes",                   # plain HTTP on this machine only
        "OTSI_VIE_WEB_ORIGINS": web_origins_for(web_port),
        "OTSI_VIE_API_PORT": str(api_port),
        "OTSI_VIE_API_INTERNAL_URL": f"http://127.0.0.1:{api_port}",   # the web app proxies /api/* here (next.config); must match the API port
        "OTSI_VIE_STORAGE_DIR": str(storage),
        "OTSI_VIE_MEDIA_SIGNING_KEY": s["MEDIA_SIGNING_KEY"],
        "OTSI_VIE_CREDENTIAL_KEY": s["CREDENTIAL_KEY"],               # seals users' provider tokens between the API and the worker
        "OTSI_VIE_MODELS_DIR": str(LOCAL / "models"),
        "PLAYWRIGHT_BROWSERS_PATH": str(LOCAL / "browsers"),           # the local headless Chromium that prints player reports to PDF (ADR-056)
        "HF_HOME": str(LOCAL / "hf"),                         # model libraries never write to C:
        "HF_HUB_OFFLINE": "1",                                # workers load verified local weights only
    }


def drop(name: str) -> None:
    if name == "owner":
        raise SystemExit("refusing to drop the real workspace")
    s = env_file(stack_dir(name) / "secrets.env")
    admin = pymysql.connect(host="127.0.0.1", port=TEST_PORT, user="root", password=test_root_password(), autocommit=True)
    with admin.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS `vie_{name.replace('-', '_')}`")
        if s.get("DB_USER"):
            cur.execute(f"DROP USER IF EXISTS '{s['DB_USER']}'@'%'")
    admin.close()
    shutil.rmtree(stack_dir(name), ignore_errors=True)
    print(f"dropped scratch stack {name}")


def pump(prefix: str, stream) -> None:
    for line in iter(stream.readline, ""):
        sys.stdout.write(f"[{prefix}] {line}")
        sys.stdout.flush()


def run(name: str, build: bool, public_origin: str | None = None, mysql_mode: str = "docker") -> None:
    env = {**os.environ, **prepare(name, mysql_mode), "NEXT_TELEMETRY_DISABLED": "1", "NODE_ENV": "production"}
    _, web_port = ports_for(mysql_mode)
    if public_origin:
        if not public_origin.startswith("https://"):
            raise SystemExit("--public-origin must be an https:// origin")
        env["OTSI_VIE_WEB_ORIGINS"] = f"{env['OTSI_VIE_WEB_ORIGINS']},{public_origin.rstrip('/')}"
        env["OTSI_VIE_INSECURE_COOKIES"] = "no"            # the browser reaches the app over HTTPS: Secure cookies
    if build:
        for pkg in ("packages/contracts", "apps/api", "apps/web"):
            print(f"building {pkg} ...")
            subprocess.run([COREPACK, "pnpm", "build"], cwd=APP / pkg, env=env, check=True)
    procs = {
        "api": subprocess.Popen([NODE, "dist/main.js"], cwd=APP / "apps" / "api", env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True),
        "worker": subprocess.Popen([NODE, "dist/workers/outbox-dispatcher.js"], cwd=APP / "apps" / "api", env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True),
        # Start the web on the mode's port explicitly (do not use `pnpm start`:
        # package.json hardcodes -p 4310, the original engine's port).
        "web": subprocess.Popen([COREPACK, "pnpm", "exec", "next", "start", "-p", str(web_port), "-H", "127.0.0.1"], cwd=APP / "apps" / "web", env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True),
        # the Python background worker (ingest today): claims worker_jobs created by the outbox dispatcher
        **{name_: subprocess.Popen([sys.executable, "-m", "vie_worker.main"], cwd=APP / "services" / "worker", env={**env, "OTSI_VIE_WORKER_KINDS": kinds}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) for name_, kinds in WORKER_GROUPS.items()},
    }
    # The Python workers need the full CV dependencies (numpy, torch,
    # OpenVINO, ...). On a fresh desktop install the venv may not have
    # them yet, so a worker can exit at import time. That must NOT kill
    # the app: the API + web are what the user sees, and jobs simply
    # wait until the worker's dependencies are installed. Only the Node
    # processes (api, worker, web) are critical to the app staying up.
    critical = ("api", "worker", "web")
    reported_dead: set[str] = set()
    for k, p in procs.items():
        threading.Thread(target=pump, args=(k, p.stdout), daemon=True).start()
    print(f"\nOTSI VIE is starting: open http://127.0.0.1:{web_port}  (Ctrl+C stops everything)\n")
    try:
        while all(procs[k].poll() is None for k in critical):
            time.sleep(0.5)
            for k, p in procs.items():
                if k not in critical and k not in reported_dead and p.poll() is not None:
                    reported_dead.add(k)
                    print(f"warning: Python worker {k} stopped (exit {p.returncode}); video jobs will wait until its dependencies are installed. The app keeps running.")
        print("a critical process stopped; shutting the others down")
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs.values():
            if p.poll() is None:
                p.terminate()
        for p in procs.values():
            try:
                p.wait(timeout=15)
            except subprocess.TimeoutExpired:
                p.kill()
        if mysql_mode == "portable":
            import portable_mysql
            portable_mysql.stop()


def dev(name: str, public_origin: str | None = None, mysql_mode: str = "docker") -> None:
    """Development mode on the same ports and database: the web app runs `next dev` (React/CSS hot module replacement), the API is
    recompiled by `tsc --watch` and restarted by `node --watch` on every save. Bound to 127.0.0.1 only; nothing is public."""
    env = {**os.environ, **prepare(name, mysql_mode), "NEXT_TELEMETRY_DISABLED": "1"}
    _, web_port = ports_for(mysql_mode)
    if public_origin:
        if not public_origin.startswith("https://"):
            raise SystemExit("--public-origin must be an https:// origin")
        env["OTSI_VIE_WEB_ORIGINS"] = f"{env['OTSI_VIE_WEB_ORIGINS']},{public_origin.rstrip('/')}"
        env["OTSI_VIE_INSECURE_COOKIES"] = "no"
    subprocess.run([COREPACK, "pnpm", "build"], cwd=APP / "packages" / "contracts", env=env, check=True)
    subprocess.run([COREPACK, "pnpm", "build"], cwd=APP / "apps" / "api", env=env, check=True)
    api = APP / "apps" / "api"
    procs = {
        "contracts": subprocess.Popen([COREPACK, "pnpm", "exec", "tsc", "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"], cwd=APP / "packages" / "contracts", env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True),
        "api-build": subprocess.Popen([COREPACK, "pnpm", "exec", "tsc", "-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"], cwd=api, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True),
        "api": subprocess.Popen([NODE, "--watch-path=dist", "dist/main.js"], cwd=api, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True),
        "worker": subprocess.Popen([NODE, "dist/workers/outbox-dispatcher.js"], cwd=api, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True),
        "web": subprocess.Popen([COREPACK, "pnpm", "exec", "next", "dev", "-p", str(web_port), "-H", "127.0.0.1"], cwd=APP / "apps" / "web", env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True),
        **{name_: subprocess.Popen([sys.executable, "-m", "vie_worker.main"], cwd=APP / "services" / "worker", env={**env, "OTSI_VIE_WORKER_KINDS": kinds}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) for name_, kinds in WORKER_GROUPS.items()},
    }
    for k, p in procs.items():
        threading.Thread(target=pump, args=(k, p.stdout), daemon=True).start()
    print(f"\nOTSI VIE development: open http://127.0.0.1:{web_port}  (live reload on save; Ctrl+C stops everything)\n")
    try:
        while all(p.poll() is None for p in procs.values()):
            time.sleep(0.5)
        print("a process stopped; shutting the others down")
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs.values():
            if p.poll() is None:
                p.terminate()
        if mysql_mode == "portable":
            import portable_mysql
            portable_mysql.stop()


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for c in ("prepare", "run", "dev", "drop", "status", "env", "bootstrap-owner"):
        p = sub.add_parser(c)
        p.add_argument("--stack", default="owner")
        if c != "drop":
            p.add_argument("--mysql", choices=["docker", "portable"], default="docker")
        if c == "run":
            p.add_argument("--no-build", action="store_true")
        if c in ("run", "dev"):
            p.add_argument("--public-origin")
        if c == "bootstrap-owner":
            p.add_argument("--email", required=True)
            p.add_argument("--name", required=True)
            p.add_argument("--organization", required=True)
            p.add_argument("--additional-organization", action="store_true")
    a = ap.parse_args()
    if a.cmd == "prepare":
        prepare(a.stack, a.mysql)
        print(f"stack {a.stack} ready")
    elif a.cmd == "env":                                       # for test harnesses: KEY=VALUE lines (contains secrets: never log)
        for k, v in prepare(a.stack, a.mysql).items():
            print(f"{k}={v}")
    elif a.cmd == "dev":
        dev(a.stack, a.public_origin, a.mysql)
    elif a.cmd == "run":
        run(a.stack, build=not a.no_build, public_origin=a.public_origin, mysql_mode=a.mysql)
    elif a.cmd == "drop":
        drop(a.stack)
    elif a.cmd == "bootstrap-owner":
        env = {**os.environ, **prepare(a.stack, a.mysql)}
        args = [NODE, "dist/cli/bootstrap-owner.js", "--email", a.email, "--name", a.name, "--organization", a.organization]
        if a.additional_organization:
            args.append("--additional-organization")
        sys.exit(subprocess.run(args, cwd=APP / "apps" / "api", env=env).returncode)
    elif a.cmd == "status":
        env = prepare(a.stack, a.mysql)
        u = env["OTSI_VIE_DB_DSN"].split("@", 1)[1]
        print(f"stack {a.stack}: database {u}, storage {env['OTSI_VIE_STORAGE_DIR']}")


if __name__ == "__main__":
    main()
