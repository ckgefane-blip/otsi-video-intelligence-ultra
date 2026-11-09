"""Worker resource status (migration 0019, Page 03 "System Resources").

A daemon thread writes this process's machine load every few seconds: CPU % (system-wide, psutil), logical CPUs, memory used and total,
whether this worker is running a job, and the GPU's name when the operating system lists one (Windows: Win32_VideoController, read once).
GPU load is never estimated: it stays NULL. A failed write is logged and retried on the next tick; it never stops job processing.
"""
from __future__ import annotations

import json
import logging
import socket
import subprocess
import sys
import threading
from datetime import datetime, timezone

import psutil

from .db import connect

log = logging.getLogger("vie_worker.status")


def gpu_name() -> str | None:
    """The first display adapter the OS reports (Windows only); None when it cannot be read."""
    if sys.platform != "win32":
        return None
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                              "(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)"],
                             capture_output=True, text=True, timeout=10, check=False).stdout.strip()
        return out[:255] or None
    except (OSError, subprocess.SubprocessError):
        return None


def sample() -> dict:
    """One measurement of this machine (never an estimate)."""
    mem = psutil.virtual_memory()
    return {"cpu_percent": round(min(100.0, max(0.0, psutil.cpu_percent(interval=None))), 2), "cpu_count": psutil.cpu_count(logical=True),
            "memory_used_bytes": int(mem.total - mem.available), "memory_total_bytes": int(mem.total)}


class StatusReporter:
    def __init__(self, dsn: str, worker_id: str, kinds: list[str], every: float = 5.0) -> None:
        self.dsn, self.worker_id, self.kinds, self.every = dsn, worker_id[:100], kinds, every
        self.busy = threading.Event()
        self.started = datetime.now(timezone.utc).replace(tzinfo=None)
        self.gpu = gpu_name()
        psutil.cpu_percent(interval=None)                       # prime: the first reading after start-up is meaningless

    def write(self) -> None:
        s = sample()
        c = connect(self.dsn)
        try:
            with c.cursor() as cur:
                cur.execute(
                    """INSERT INTO worker_status (worker_id, host, kinds, cpu_percent, cpu_count, memory_used_bytes, memory_total_bytes, gpu_name,
                                                  gpu_percent, busy, started_at, reported_at)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, UTC_TIMESTAMP(6))
                       ON DUPLICATE KEY UPDATE cpu_percent = VALUES(cpu_percent), cpu_count = VALUES(cpu_count), memory_used_bytes = VALUES(memory_used_bytes),
                         memory_total_bytes = VALUES(memory_total_bytes), gpu_name = VALUES(gpu_name), busy = VALUES(busy), reported_at = VALUES(reported_at)""",
                    (self.worker_id, socket.gethostname()[:255], json.dumps(self.kinds), s["cpu_percent"], s["cpu_count"], s["memory_used_bytes"],
                     s["memory_total_bytes"], self.gpu, self.busy.is_set(), self.started))
        finally:
            c.close()

    def run(self, stop: threading.Event) -> None:
        while not stop.wait(self.every):
            try:
                self.write()
            except Exception:  # noqa: BLE001 - status is best effort; jobs carry on
                log.warning("could not write the worker status", exc_info=True)

    def start(self, stop: threading.Event) -> threading.Thread:
        t = threading.Thread(target=self.run, args=(stop,), name="worker-status", daemon=True)
        t.start()
        return t
