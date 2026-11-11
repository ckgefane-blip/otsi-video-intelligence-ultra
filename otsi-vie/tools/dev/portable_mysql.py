"""Portable MySQL 8.4 server for the OTSI VIE owner stack (Windows, no Docker).

Downloads the official MySQL 8.4 Windows ZIP, extracts it under the repo's
.local directory, initializes its own data directory, and runs mysqld on
127.0.0.1:3510 — a DIFFERENT port from the Docker-based owner stack
(127.0.0.1:3508), so the portable server and the original stack's Docker
database (otsi-vie-v2-mysql) can run side by side. It uses a SEPARATE data
directory (.local/mysql-data-portable). Docker's data (.local/mysql-data)
is never touched.

Verified download (2026-11-11, HEAD):
  URL: https://cdn.mysql.com/archives/mysql-8.4/mysql-8.4.6-winx64.zip
  HTTP 200, Content-Length: 260772595 (~249 MB)
  MySQL version: 8.4.6
  (The dev.mysql.com/get redirector for the same file returns 403, so
  the direct CDN archives link is used instead. Do not switch it back
  to dev.mysql.com/get.)

If mysqld exits immediately on a fresh Windows machine, the usual cause is
the missing Visual C++ Redistributable. Install it once from Microsoft:
  https://aka.ms/vs/17/release/vc_redist.x64.exe
then run again.

Only used by local_stack.py in --mysql portable mode. The Docker path never
imports this module.
"""

from __future__ import annotations

import atexit
import os
import socket
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

MYSQL_VERSION = "8.4.6"
# Direct CDN archives link. The dev.mysql.com/get redirector for the same
# file returns 403, so it is not used. Verified 2026-11-11: HTTP 200.
MYSQL_URL = "https://cdn.mysql.com/archives/mysql-8.4/mysql-8.4.6-winx64.zip"
MYSQL_ZIP_BYTES = 260772595  # Content-Length verified 2026-11-10
PORT = 3510  # portable server only; the Docker owner stack stays on 3508

_PROC: subprocess.Popen | None = None
_STARTED_BY_US = False


def server_dir(root: Path) -> Path:
    return Path(root) / ".local" / "mysql-8.4"


def data_dir(root: Path) -> Path:
    return Path(root) / ".local" / "mysql-data-portable"


def zip_path(root: Path) -> Path:
    return Path(root) / ".local" / f"mysql-{MYSQL_VERSION}-winx64.zip"


def _mysqld_exe(root: Path) -> Path | None:
    base = server_dir(root)
    if not base.exists():
        return None
    for sub in sorted(base.iterdir()):
        cand = sub / "bin" / "mysqld.exe"
        if sub.is_dir() and cand.exists():
            return cand
    return None


def _port_answers(port: int = PORT) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def _root_login_works(root_password: str, port: int = PORT) -> bool:
    try:
        import pymysql
    except ImportError:
        return _port_answers(port)
    try:
        conn = pymysql.connect(host="127.0.0.1", port=port, user="root",
                               password=root_password, connect_timeout=3)
        conn.close()
        return True
    except Exception:
        return False


def _download(root: Path) -> Path:
    zp = zip_path(root)
    if zp.exists() and zp.stat().st_size == MYSQL_ZIP_BYTES:
        print(f"portable MySQL: ZIP already downloaded ({MYSQL_ZIP_BYTES // 1024 // 1024} MB)")
        return zp
    zp.parent.mkdir(parents=True, exist_ok=True)
    print(f"portable MySQL: downloading MySQL {MYSQL_VERSION} (~249 MB, once only)...")
    req = urllib.request.Request(MYSQL_URL, headers={"User-Agent": "OTSI-VIE-portable-mysql/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(zp, "wb") as out:
        total = int(resp.headers.get("Content-Length") or MYSQL_ZIP_BYTES)
        done = 0
        last_shown = -1
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            shown = done // (10 * 1024 * 1024)
            if shown != last_shown:
                last_shown = shown
                print(f"  ... {done // 1024 // 1024} MB of {total // 1024 // 1024} MB")
    got = zp.stat().st_size
    if got != total:
        zp.unlink(missing_ok=True)
        raise SystemExit(
            f"portable MySQL: download incomplete ({got} bytes, expected {total}). "
            "Delete the file and run again.")
    print("portable MySQL: download complete")
    return zp


def _extract(root: Path) -> Path:
    exe = _mysqld_exe(root)
    if exe is not None:
        return exe
    zp = _download(root)
    print("portable MySQL: extracting (a minute or so)...")
    with zipfile.ZipFile(zp) as zf:
        zf.extractall(server_dir(root))
    exe = _mysqld_exe(root)
    if exe is None:
        raise SystemExit("portable MySQL: mysqld.exe not found after extraction. "
                         "Delete .local/mysql-8.4 and run again.")
    print(f"portable MySQL: extracted to {exe.parent.parent}")
    return exe


def _log_tail(path: Path, lines: int = 20) -> str:
    try:
        text = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    return "\n".join(text[-lines:])


def _start_server(root: Path, exe: Path) -> subprocess.Popen:
    data = data_dir(root)
    data.mkdir(parents=True, exist_ok=True)
    log = open(data / "mysqld.log", "ab")
    flags: list[str] = []
    if sys.platform == "win32":
        flags.append(subprocess.CREATE_NO_WINDOW)  # type: ignore[attr-defined]
    proc = subprocess.Popen(
        [str(exe),
         f"--datadir={data}",
         f"--port={PORT}",
         "--bind-address=127.0.0.1",
         "--character-set-server=utf8mb4",
         "--collation-server=utf8mb4_0900_ai_ci",
         f"--log-error={data / 'mysql.err'}"],
        stdout=log, stderr=log, creationflags=sum(flags) if flags else 0)
    return proc


def _wait_ready(root_password: str, timeout: int = 120) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _root_login_works(root_password):
            return True
        time.sleep(1)
    return False


def _set_root_password(root: Path, exe: Path, root_password: str) -> None:
    """Root starts with an empty password after --initialize-insecure; set the stored one."""
    try:
        import pymysql
        conn = pymysql.connect(host="127.0.0.1", port=PORT, user="root",
                               password="", connect_timeout=5)
        with conn.cursor() as cur:
            cur.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY %s", (root_password,))
        conn.close()
        return
    except Exception as first_error:
        # Fallback: the mysqladmin binary shipped in the same folder.
        admin = exe.parent / "mysqladmin.exe"
        r = subprocess.run([str(admin), "-uroot", "-h127.0.0.1", f"-P{PORT}",
                            "password", root_password],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            raise SystemExit(
                "portable MySQL: could not set the root password after first start.\n"
                f"  pymysql error: {first_error}\n"
                f"  mysqladmin error: {r.stderr.strip() or r.stdout.strip()}")


def ensure_running(root: Path, root_password: str) -> bool:
    """Make sure a portable mysqld is running on 127.0.0.1:3510.

    Returns True when this call started the server, False when a server was
    already running and accepting the root password (for example left over
    from an earlier run). Registers an atexit stop, so one-shot commands
    stop the server when they finish; long-running commands stop it
    explicitly in their finally blocks.
    """
    global _PROC, _STARTED_BY_US
    root = Path(root)
    if _PROC is not None and _PROC.poll() is None:
        return True
    if _root_login_works(root_password):
        print(f"portable MySQL: server already running on 127.0.0.1:{PORT}")
        return False
    if _port_answers():
        # Port 3510 is in use by something else and it did not accept
        # the stored root password. This module never stops another
        # program's database on its own — that is the user's call, not
        # the app's. Report the conflict plainly and stop.
        raise SystemExit(
            f"portable MySQL: port {PORT} is already in use by another program, and it did "
            "not accept the stored root password.\n"
            "  If that is the original stack's Docker database (otsi-vie-v2-mysql), stop "
            "it first with:\n"
            "    docker stop otsi-vie-v2-mysql\n"
            "  then run again. Its data stays in its Docker volume.")
    exe = _extract(root)
    data = data_dir(root)
    initialized = (data / "mysql.ibd").exists()
    if not initialized:
        print("portable MySQL: first start, creating the database files...")
        data.mkdir(parents=True, exist_ok=True)
        init = subprocess.run(
            [str(exe), f"--datadir={data}", "--initialize-insecure",
             f"--log-error={data / 'init.err'}"],
            capture_output=True, text=True, timeout=300)
        if init.returncode != 0 or not (data / "mysql.ibd").exists():
            raise SystemExit(
                "portable MySQL: could not create the database files.\n"
                f"  {_log_tail(data / 'init.err') or init.stderr.strip() or init.stdout.strip()}\n"
                "  If mysqld stopped at once with no error above, the usual cause is the\n"
                "  missing Visual C++ Redistributable. Install it once from Microsoft:\n"
                "    https://aka.ms/vs/17/release/vc_redist.x64.exe\n"
                "  then run again.")
    _PROC = _start_server(root, exe)
    _STARTED_BY_US = True
    atexit.register(stop)
    # Give the server a few seconds; if it dies at once, say why plainly.
    for _ in range(10):
        time.sleep(1)
        if _PROC.poll() is not None:
            raise SystemExit(
                "portable MySQL: the server stopped at once after starting.\n"
                f"  {_log_tail(data / 'mysql.err') or _log_tail(data / 'mysqld.log')}\n"
                "  The usual cause on a fresh Windows machine is the missing Visual C++\n"
                "  Redistributable. Install it once from Microsoft:\n"
                "    https://aka.ms/vs/17/release/vc_redist.x64.exe\n"
                "  then run again.")
        if _port_answers():
            break
    if not initialized:
        if not _wait_ready("", timeout=120):
            raise SystemExit("portable MySQL: the server started but never answered. "
                             "See .local/mysql-data-portable/mysql.err and run again.")
        _set_root_password(root, exe, root_password)
    if not _wait_ready(root_password, timeout=120):
        raise SystemExit("portable MySQL: the server started but the stored root password "
                         "was not accepted. Delete .local/mysql-portable.env and "
                         ".local/mysql-data-portable and run again.")
    print(f"portable MySQL: server running on 127.0.0.1:{PORT}")
    return True


def stop() -> None:
    """Stop the server this module started. Safe to call twice or when nothing runs."""
    global _PROC, _STARTED_BY_US
    proc = _PROC
    _PROC = None
    _STARTED_BY_US = False
    if proc is None or proc.poll() is not None:
        return
    print("portable MySQL: stopping the server...")
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=15)
