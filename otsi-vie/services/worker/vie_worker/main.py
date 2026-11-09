"""The OTSI VIE background worker process (ADR-022). Claims `worker_jobs` it knows how to run, one at a time per process; run more
processes for more throughput. Environment: OTSI_VIE_DB_DSN (runtime account), OTSI_VIE_STORAGE_DIR (same store as the API).

  python -m vie_worker.main            (from otsi-vie/services/worker)

OTSI_VIE_WORKER_KINDS (optional, comma list of job kinds): this process claims ONLY those kinds. The local stack starts one process per group
(ingest, media, analysis) so a long analysis never holds up the check of a new upload; without it a process handles every kind.
"""
from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import uuid

from .analyze import handle_analyze
from .assess import handle_assess
from .pitch_job import handle_calibrate_pitch
from .ball_job import handle_track_ball
from .lineup_job import handle_read_lineups
from .snapshot_job import handle_snapshot
from .beat_job import handle_beat_grid
from .ingest import handle_ingest_upload, handle_ingest_url
from .proxy import handle_proxy
from .render.reel import handle_render
from .jobs import JobRunner
from .status import StatusReporter

HANDLERS = {"INGEST_UPLOAD": handle_ingest_upload, "INGEST_URL": handle_ingest_url, "PROXY": handle_proxy, "ANALYZE": handle_analyze, "RENDER": handle_render, "ASSESS": handle_assess, "CALIBRATE_PITCH": handle_calibrate_pitch, "TRACK_BALL": handle_track_ball, "READ_LINEUPS": handle_read_lineups, "SNAPSHOT": handle_snapshot, "BEAT_GRID": handle_beat_grid}
log = logging.getLogger("vie_worker")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    for name in ("OTSI_VIE_DB_DSN", "OTSI_VIE_STORAGE_DIR"):
        if not os.environ.get(name):
            raise SystemExit(f"missing required setting {name}")
    wanted = [k.strip() for k in os.environ.get("OTSI_VIE_WORKER_KINDS", "").split(",") if k.strip()]
    unknown = [k for k in wanted if k not in HANDLERS]
    if unknown:
        raise SystemExit(f"unknown job kind(s) in OTSI_VIE_WORKER_KINDS: {', '.join(unknown)}")
    handlers = {k: HANDLERS[k] for k in wanted} if wanted else HANDLERS
    worker_id = f"worker-{socket.gethostname()}-{uuid.uuid4().hex[:6]}"
    runner = JobRunner(os.environ["OTSI_VIE_DB_DSN"], worker_id, list(handlers), lease_seconds=int(os.environ.get("OTSI_VIE_JOB_LEASE_SECONDS", "120")),
                       org_max_running=int(os.environ.get("OTSI_VIE_ORG_MAX_RUNNING", "4")))     # ADR-060: running jobs per organization
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    status = StatusReporter(os.environ["OTSI_VIE_DB_DSN"], worker_id, list(handlers))  # the machine's measured load, for Page 03
    status.start(stop)
    log.info("started as %s, handling %s", worker_id, ", ".join(handlers))
    while not stop.is_set():
        try:
            status.busy.set()
            outcome = runner.run_one(handlers)
        except Exception:  # noqa: BLE001 - database outage etc.: log, wait, try again
            log.exception("job cycle failed")
            outcome = None
            stop.wait(5)
            runner = JobRunner(os.environ["OTSI_VIE_DB_DSN"], worker_id, list(handlers), lease_seconds=runner.lease, org_max_running=runner.org_max_running)
        finally:
            status.busy.clear()
        if outcome:
            log.info("job %s", outcome)
        else:
            stop.wait(1.0)
    log.info("stopped")


if __name__ == "__main__":
    main()
