"""Portable MySQL supervisor for the packaged desktop app (ADR-144 §1.2).

The desktop shell starts this as a compiled binary (Nuitka; no .py ships)
and keeps it alive for the whole session. It starts the bundled portable
MySQL server (tools/dev/portable_mysql.py) and stops it when it is killed:
SIGTERM/SIGINT stop the server and exit, and on Windows the shell kills
the whole process tree. It owns mysqld — nothing else starts or stops it.

Environment (all set by the desktop shell):
  OTSI_VIE_DATA_DIR (required): the data folder; the server lives under
    <data>/.local/mysql-8.4 with its data in <data>/.local/mysql-data-portable.
  OTSI_VIE_MYSQL_ROOT_PASSWORD (required).
  OTSI_VIE_ENGINE_DIR (required): the bundled engine folder, so the
    portable_mysql module can be found (…/otsi-vie/tools/dev).
  OTSI_VIE_MYSQL_ZIP (optional): the bundled MySQL ZIP (see portable_mysql.bundled_zip).
"""
from __future__ import annotations

import os
import signal
import sys
import time
from pathlib import Path

ENGINE_DIR = Path(os.environ.get("OTSI_VIE_ENGINE_DIR", "")).resolve()
if not ENGINE_DIR:
    raise SystemExit("mysql-supervisor: OTSI_VIE_ENGINE_DIR is not set")
sys.path.insert(0, str(ENGINE_DIR / "otsi-vie" / "tools" / "dev"))

import portable_mysql  # noqa: E402


def main() -> int:
    data_dir = os.environ.get("OTSI_VIE_DATA_DIR", "")
    root_password = os.environ.get("OTSI_VIE_MYSQL_ROOT_PASSWORD", "")
    if not data_dir or not root_password:
        raise SystemExit("mysql-supervisor: OTSI_VIE_DATA_DIR and "
                         "OTSI_VIE_MYSQL_ROOT_PASSWORD are both required")
    stop = False

    def _stop(*_args: object) -> None:
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    portable_mysql.ensure_running(Path(data_dir), root_password)
    print("mysql-supervisor: server running; waiting to be stopped", flush=True)
    while not stop:
        time.sleep(0.5)
    portable_mysql.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
