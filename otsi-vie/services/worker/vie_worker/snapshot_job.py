"""SNAPSHOT (v3 B.5, ADR-083): one still picture of a video at a time, at the source's full resolution, as a PNG.

The frame is the decoded frame nearest the time asked for (its own time is stored). Only what was recorded is drawn on it, and only if asked:
- boxes: the boxes the latest finished analysis recorded at the analysed frame nearest that time (within half an analysis step; none further
  away, so a box is never moved in time); coloured by team as on the page;
- labels: each box's track number, or the player's name and OTSI Player ID when the identity is CONFIRMED (never a suggestion);
- the selected track: drawn white and thicker;
- caption: a strip with the video, the time, and "Boxes are detections, not verified identities" when boxes are drawn.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import uuid
from pathlib import Path

import numpy as np

from . import ff
from .db import audit, tx
from .jobs import Job, JobError, JobRunner
from .storage import LocalStore

SERVICE = "snapshot-worker"
KIT = {0: (46, 232, 106), 1: (255, 77, 77), 2: (255, 214, 0)}           # the page's team colours (TrackOverlay)
NO_TEAM, CHOSEN = (25, 160, 255), (255, 255, 255)
WINDOW_US = 400_000                                                   # frames decoded around the time asked for


def nearest_frame(path: str, pts_us: int):
    """the decoded frame whose time is nearest pts_us (a short window, decoded from a seek point)"""
    best = None
    for f in ff.decode_sampled(path, None, start_us=max(0, pts_us - WINDOW_US), end_us=pts_us + WINDOW_US, seek=True):
        if best is None or abs(f.pts_us - pts_us) < abs(best.pts_us - pts_us):
            best = f
        if f.pts_us > pts_us:
            break
    return best


def box_label(b: dict) -> str:
    if b.get("identity_state") == "CONFIRMED" and b.get("display_name"):
        return f"{b['display_name']} · {b.get('canonical_otsi_id') or 'no OTSI Player ID yet'}"
    return f"#{b['track_number']}"


def compose(rgb: np.ndarray, boxes: list[dict], *, labels: bool, selected: str | None, caption: str | None) -> np.ndarray:
    """the frame with the recorded boxes (normalised x, y, w, h) and an optional caption strip under it; returns a new RGB array"""
    from PIL import Image, ImageDraw
    from .render.text import draw_text, text_size
    h, w = rgb.shape[:2]
    strip = max(28, h // 24) if caption else 0
    img = Image.new("RGB", (w, h + strip), (7, 20, 42))
    img.paste(Image.fromarray(rgb), (0, 0))
    dr = ImageDraw.Draw(img)
    lw = max(2, w // 640)
    fs = max(12, h // 45)
    for b in sorted(boxes, key=lambda b: b["track_id"] == selected):          # the selected one last, on top
        chosen = b["track_id"] == selected
        col = CHOSEN if chosen else KIT.get(b.get("kit_group"), NO_TEAM)
        x0, y0 = b["x"] * w, b["y"] * h
        x1, y1 = (b["x"] + b["w"]) * w, (b["y"] + b["h"]) * h
        dr.rectangle([x0, y0, x1, y1], outline=col, width=lw * (2 if chosen else 1))
        if labels or chosen:
            s = box_label(b)
            tw, th = text_size(s, fs, bold=True)
            ty = y0 - th - 6 if y0 - th - 6 >= 0 else y1 + 2
            dr.rectangle([x0, ty, x0 + tw + 8, ty + th + 6], fill=(0, 0, 0))
            draw_text(dr, (x0 + 4, ty + 2), s, fs, col, bold=True)
    if caption:
        draw_text(dr, (max(8, w // 160), h + (strip - fs) // 2 - 2), caption, max(11, int(strip * 0.5)), (220, 232, 248))
    return np.asarray(img)


def clock(us: int) -> str:
    s = us // 1_000_000
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def _fail(runner: JobRunner, sid: str, code: str, detail: str) -> dict:
    with tx(runner.conn) as cur:
        cur.execute("UPDATE snapshots SET status = 'FAILED', failure_code = %s, failure_detail = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s", (code, detail[:2000], sid))
    return {"snapshot_id": sid, "status": "FAILED", "failure_code": code}


def recorded_boxes(cur, video_id: str, pts_us: int) -> tuple[str | None, list[dict]]:
    """the latest finished analysis and its boxes at the analysed frame nearest pts_us (none when its nearest frame is over half a step away)"""
    cur.execute("SELECT id, config FROM pipeline_runs WHERE video_id = %s AND status = 'SUCCEEDED' ORDER BY finished_at DESC, created_at DESC LIMIT 1", (video_id,))
    run = cur.fetchone()
    if not run:
        return None, []
    cfg = json.loads(run["config"]) if isinstance(run.get("config"), str) else (run.get("config") or {})
    fps = float((cfg or {}).get("sample_fps") or 0) or 2.0                 # the analysis default (analyze.py)
    half = int(1_000_000 / fps / 2) + 1
    cur.execute("""SELECT o.pts_us FROM track_observations o JOIN tracks t ON t.id = o.track_id AND t.run_id = %s
                    WHERE o.video_id = %s AND o.pts_us BETWEEN %s AND %s ORDER BY ABS(o.pts_us - %s) LIMIT 1""",
                (run["id"], video_id, pts_us - half, pts_us + half, pts_us))
    at = cur.fetchone()
    if not at:
        return run["id"], []
    cur.execute("""SELECT o.track_id, o.bbox_x AS x, o.bbox_y AS y, o.bbox_w AS w, o.bbox_h AS h, t.internal_track_number AS track_number,
                          ta.kit_group, ci.state AS identity_state, pi.display_name, pi.canonical_otsi_id
                     FROM track_observations o JOIN tracks t ON t.id = o.track_id AND t.run_id = %s
                     LEFT JOIN track_appearance ta ON ta.track_id = t.id
                     LEFT JOIN v_track_current_identity ci ON ci.track_id = t.id
                     LEFT JOIN v_player_identity pi ON pi.player_id = ci.player_id AND ci.state = 'CONFIRMED'
                    WHERE o.video_id = %s AND o.pts_us = %s AND t.class_name <> 'BALL'""", (run["id"], video_id, at["pts_us"]))
    return run["id"], [dict(r, x=float(r["x"]), y=float(r["y"]), w=float(r["w"]), h=float(r["h"]), track_number=int(r["track_number"])) for r in cur.fetchall()]


def handle_snapshot(runner: JobRunner, job: Job) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, sid = job.organization_id, job.payload["snapshot_id"]
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT s.id, s.status, s.video_id, s.pts_us, s.overlays, v.state, v.project_id, v.title, v.original_filename, a.object_key
                         FROM snapshots s JOIN video_sources v ON v.id = s.video_id AND v.organization_id = s.organization_id
                         LEFT JOIN assets a ON a.id = v.source_asset_id WHERE s.id = %s AND s.organization_id = %s""", (sid, org))
        row = cur.fetchone()
    if not row:
        raise JobError("NOT_FOUND", "The snapshot no longer exists.")
    if row["status"] in ("SUCCEEDED", "FAILED"):
        return {"snapshot_id": sid, "status": row["status"], "note": "already settled"}
    if row["state"] != "INGESTED" or not row["object_key"]:
        return _fail(runner, sid, "VIDEO_NOT_READY", "The video has not been verified, so it cannot be pictured.")
    with tx(runner.conn) as cur:
        cur.execute("UPDATE snapshots SET status = 'RUNNING' WHERE id = %s", (sid,))
    ov = json.loads(row["overlays"]) if isinstance(row["overlays"], str) else (row["overlays"] or {})
    pts = int(row["pts_us"])
    runner.progress(job, 10, "Finding the frame")
    f = nearest_frame(str(store.path(row["object_key"])), pts)
    if f is None:
        return _fail(runner, sid, "NO_FRAME", "No picture was found at that time in the video.")
    run_id, boxes = None, []
    if ov.get("boxes") or ov.get("selected_track_id"):
        with runner.conn.cursor() as cur:
            run_id, boxes = recorded_boxes(cur, row["video_id"], f.pts_us)
        if not ov.get("boxes"):
            boxes = [b for b in boxes if b["track_id"] == ov.get("selected_track_id")]
    name = row["title"] or row["original_filename"] or "Video"
    caption = None
    if ov.get("caption", True):
        caption = f"{name} · {clock(f.pts_us)}" + (" · Boxes are detections, not verified identities" if boxes else "")
    runner.progress(job, 60, "Drawing")
    out = compose(f.rgb, boxes, labels=bool(ov.get("labels")), selected=ov.get("selected_track_id"), caption=caption)
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(out).save(buf, "PNG", optimize=False, compress_level=6)
    png = buf.getvalue()
    key = f"org/{org}/videos/{row['video_id']}/snapshots/{sid}.png"
    Path(store.path(key)).parent.mkdir(parents=True, exist_ok=True)
    Path(store.path(key)).write_bytes(png)
    with tx(runner.conn) as cur:
        cur.execute("SELECT claim_token FROM worker_jobs WHERE id = %s FOR UPDATE", (job.id,))
        if cur.fetchone()["claim_token"] != job.token:
            raise JobError("LEASE_LOST", "Another worker took over this snapshot.")
        asset = str(uuid.uuid4())
        cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, metadata) "
                    "VALUES (%s, %s, %s, 'SNAPSHOT', %s, 'local', %s, %s, 'image/png', %s)",
                    (asset, org, row["project_id"], key, len(png), hashlib.sha256(png).hexdigest(), json.dumps({"snapshot_id": sid, "pts_us": f.pts_us})))
        cur.execute("""UPDATE snapshots SET status = 'SUCCEEDED', asset_id = %s, frame_pts_us = %s, width = %s, height = %s, boxes_drawn = %s, run_id = %s,
                       finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s""", (asset, f.pts_us, out.shape[1], out.shape[0], len(boxes), run_id, sid))
        audit(cur, org, SERVICE, "video.snapshot_made", "video", str(row["video_id"]), {"snapshot_id": sid, "frame_pts_us": f.pts_us, "boxes": len(boxes)}, f"job:{job.id}")
    return {"snapshot_id": sid, "status": "SUCCEEDED", "frame_pts_us": f.pts_us, "boxes": len(boxes), "bytes": len(png)}
