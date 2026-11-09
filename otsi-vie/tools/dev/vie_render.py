#!/usr/bin/env python
"""Wrapper for vie-render headless command (v3 Phase C.8, ADR-107)."""
import os
import subprocess
import sys
from pathlib import Path

FILE = Path(__file__).resolve()
ROOT = FILE.parents[2]  # otsi-vie
REPO = FILE.parents[3]  # VIE-Engine-v2
VENV_PY = REPO / ".venv" / "Scripts" / "python.exe"
if VENV_PY.exists() and Path(sys.executable).resolve() != VENV_PY.resolve():
    cmd = [str(VENV_PY), str(FILE), *sys.argv[1:]]
    sys.exit(subprocess.call(cmd))

WORKER = ROOT / "services" / "worker"
if str(WORKER) not in sys.path:
    sys.path.insert(0, str(WORKER))

from vie_worker.render.cli import main

if __name__ == "__main__":
    sys.exit(main())
