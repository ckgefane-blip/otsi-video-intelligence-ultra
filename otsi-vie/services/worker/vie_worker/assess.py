"""ASSESS (ADR-034): measure one ingested video's footage quality and recommend an analysis profile (vie_worker.quality).

The detector is the one the analysis will use, run on the sampled frames with the full frame and 2x2 tiles, so the player sizes and the
measured cost per detector pass are those of the real analysis. The result is advice for the user; it is stored on the assessment row
and changes nothing else.
"""
from __future__ import annotations

import json
import logging
import os

from .db import publish, tx
from .detect.base import load_detector
from .jobs import Job, JobError, JobRunner
from .quality import assess
from .storage import LocalStore

log = logging.getLogger("vie_worker.assess")


def handle_assess(runner: JobRunner, job: Job) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, aid = job.organization_id, job.payload["assessment_id"]
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT q.id, q.status, q.video_id, v.state, v.width, v.height, v.duration_us, v.byte_size, v.avg_frame_rate_num, v.avg_frame_rate_den, a.object_key
                         FROM video_quality_assessments q JOIN video_sources v ON v.id = q.video_id AND v.organization_id = q.organization_id
                         LEFT JOIN assets a ON a.id = v.source_asset_id WHERE q.id = %s AND q.organization_id = %s""", (aid, org))
        row = cur.fetchone()
    if not row:
        raise JobError("NOT_FOUND", "The assessment no longer exists.")
    if row["status"] in ("SUCCEEDED", "FAILED"):
        return {"assessment_id": aid, "status": row["status"], "note": "already settled"}
    if row["state"] != "INGESTED" or not row["object_key"] or not row["width"]:
        return _fail(runner, aid, "VIDEO_NOT_READY", "The video has not been verified and measured, so it cannot be assessed.", org, row["video_id"])
    with tx(runner.conn) as cur:
        cur.execute("UPDATE video_quality_assessments SET status = 'RUNNING' WHERE id = %s", (aid,))
    runner.progress(job, 10, "Loading the detector")
    try:
        det = load_detector(None, tiles=2, score_floor=0.2)
    except RuntimeError as e:
        log.warning("assessment without player sizes: %s", e)
        det = None
    runner.progress(job, 30, "Measuring sharpness, compression, motion and player size")
    fps = (row["avg_frame_rate_num"] / row["avg_frame_rate_den"]) if row["avg_frame_rate_num"] and row["avg_frame_rate_den"] else None
    try:
        m = assess(str(store.path(row["object_key"])), width=int(row["width"]), height=int(row["height"]), duration_us=int(row["duration_us"] or 1),
                   fps=fps, byte_size=int(row["byte_size"]) if row["byte_size"] else None, detector=det)
    except Exception as e:  # noqa: BLE001 - a footage problem the user should see, not a crash loop
        return _fail(runner, aid, "ASSESSMENT_FAILED", f"{type(e).__name__}: {e}"[:2000], org, row["video_id"])
    with tx(runner.conn) as cur:
        cur.execute("UPDATE video_quality_assessments SET status = 'SUCCEEDED', metrics = %s, recommended_profile = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s",
                    (json.dumps(m), m["recommended_profile"], aid))
        _settled(cur, org, row["video_id"], aid, "SUCCEEDED", m["recommended_profile"])
    return {"assessment_id": aid, "recommended_profile": m["recommended_profile"], "issues": [i["code"] for i in m["issues"]]}


def _settled(cur, org: str, video_id: str, aid: str, status: str, recommended: str | None) -> None:
    """A.10 (ADR-076): the check is settled; an upload that chose "Recommended" starts its analysis from this event (jobs.auto_analysis_checked)."""
    publish(cur, org, "video", video_id, "video.assessed", {"assessment_id": aid, "video_id": video_id, "status": status, "recommended_profile": recommended},
            f"video-assessed:{aid}")


def _fail(runner: JobRunner, aid: str, code: str, detail: str, org: str, video_id: str) -> dict:
    with tx(runner.conn) as cur:
        cur.execute("UPDATE video_quality_assessments SET status = 'FAILED', failure_code = %s, failure_detail = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s",
                    (code, detail, aid))
        _settled(cur, org, video_id, aid, "FAILED", None)
    return {"assessment_id": aid, "status": "FAILED", "failure_code": code}
