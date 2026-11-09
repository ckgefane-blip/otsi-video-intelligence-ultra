"""PROXY (Block 04): a browser-playable copy of an ingested video for the analysis workspace and the editors.

WebM with VP9 video (libvpx, BSD) and Opus audio — royalty-free codecs that every current browser plays — at most 960 px wide.
Timestamps are the source's presentation times rebased to its first video frame: the proxy plays on exactly the media clock that every
detection and track uses (pts_us), so overlays line up frame for frame, also for variable-frame-rate sources. Not used for export.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import uuid

from . import ff
from .db import audit, publish, tx
from .jobs import Job, JobError, JobRunner
from .storage import LocalStore

SERVICE = "proxy-worker"
MAX_WIDTH = 960


def encode_proxy(src: str, dst: str, on_progress=None) -> dict:
    """One ffmpeg process (LGPL build): video rebased so its first decoded frame is 0 (the media clock), audio shifted by its own
    offset from that frame, VP9 + Opus in WebM, variable frame rate kept (no frame is duplicated or dropped)."""
    info = ff.ffprobe_json(src, "-show_format", "-show_streams")
    v = ff.main_video(info)
    if not v:
        raise JobError("NO_VIDEO_STREAM", "The video has no video track.")
    vids = [s["index"] for s in info["streams"] if s.get("codec_type") == "video"]
    vsel = f"0:v:{vids.index(v['index'])}"
    has_audio = any(s.get("codec_type") == "audio" for s in info["streams"])
    w, h = int(v["width"]), int(v["height"])
    tw = min(MAX_WIDTH, w - w % 2)
    th = max(2, int(round(h * tw / w / 2)) * 2)
    fps = ff.rate(v.get("avg_frame_rate")) or ff.rate(v.get("r_frame_rate")) or 25
    t_v = ff.first_frame_time(src, f"v:{vids.index(v['index'])}") or 0.0
    graph = f"[{vsel}]setpts=PTS-STARTPTS,scale={tw}:{th},format=yuv420p[v]"
    if has_audio:
        t_a = ff.first_frame_time(src, "a:0")
        offset = (t_a - t_v) if t_a is not None else 0.0
        shift = f"adelay={int(round(offset * 1000))}:all=1" if offset > 0.0005 else (f"atrim=start={-offset:.6f},asetpts=PTS-STARTPTS" if offset < -0.0005 else "anull")
        graph += f";[0:a:0]asetpts=PTS-STARTPTS,{shift},aresample=48000,aformat=channel_layouts=stereo[a]"
    gop = max(1, int(round(float(fps)))) * 2
    duration_us = 0
    for d in (v.get("duration"), (info.get("format") or {}).get("duration")):
        if d not in (None, "N/A"):
            duration_us = int(float(d) * 1_000_000)
            break
    cmd = [ff.tool("ffmpeg"), "-hide_banner", "-nostdin", "-v", "error", "-noautorotate", "-i", src, "-filter_complex", graph, "-map", "[v]",
           *(["-map", "[a]", "-c:a", "libopus", "-b:a", "96k"] if has_audio else []),
           "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-crf", "36", "-b:v", "0", "-g", str(gop),
           "-fps_mode", "passthrough", "-progress", "pipe:1", "-f", "webm", "-y", dst]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=ff.NO_WINDOW)
    frames = 0
    assert proc.stdout is not None
    try:
        for raw in proc.stdout:
            k, _, val = raw.decode("utf-8", "replace").strip().partition("=")
            if k == "frame" and val.isdigit():
                frames = int(val)
            elif k == "out_time_us" and val.isdigit() and on_progress and duration_us:
                on_progress(min(99.0, 100 * int(val) / duration_us))     # raises LeaseLost when another owner holds the job
    except BaseException:
        # the loop broke off (the lease was lost, or any error): no encoder may be left running, or an orphan keeps writing the same file
        # while the next attempt encodes it again. A normal end is NOT interrupted: ffmpeg is allowed to finish writing.
        proc.kill()
        proc.wait()
        raise
    err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
    if proc.wait() != 0:
        raise JobError("PROXY_FAILED", f"The playback copy could not be made: {err.strip()[-300:]}")
    return {"width": tw, "height": th, "frames": frames, "audio": has_audio, "encoder": "libvpx-vp9 + libopus (LGPL FFmpeg)"}


def handle_proxy(runner: JobRunner, job: Job) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, video_id = job.organization_id, job.payload["video_id"]
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT v.state, v.proxy_asset_id, v.project_id, a.object_key FROM video_sources v LEFT JOIN assets a ON a.id = v.source_asset_id
                        WHERE v.id = %s AND v.organization_id = %s""", (video_id, org))
        v = cur.fetchone()
    if not v or v["state"] != "INGESTED" or not v["object_key"]:
        raise JobError("VIDEO_NOT_READY", "The video is not verified; no playback copy is made.")
    if v["proxy_asset_id"]:
        return {"video_id": video_id, "note": "proxy already exists"}
    key = f"org/{org}/videos/{video_id}/proxy.webm"
    tmp = store.path(f"org/{org}/videos/{video_id}/proxy.webm.partial")
    runner.progress(job, 1, "Making the playback copy")
    info = encode_proxy(store.path(v["object_key"]), tmp, lambda pct: runner.progress(job, pct, "Making the playback copy"))
    os.replace(tmp, store.path(key))
    h = hashlib.sha256()
    with open(store.path(key), "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    asset = str(uuid.uuid4())
    with tx(runner.conn) as cur:
        cur.execute("SELECT claim_token FROM worker_jobs WHERE id = %s FOR UPDATE", (job.id,))
        if cur.fetchone()["claim_token"] != job.token:
            raise JobError("LEASE_LOST", "Another worker took over this job.")
        cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, metadata) "
                    "VALUES (%s, %s, %s, 'PROXY', %s, 'local', %s, %s, 'video/webm', %s)",
                    (asset, org, v["project_id"], key, os.path.getsize(store.path(key)), h.hexdigest(), json.dumps(info)))
        cur.execute("UPDATE video_sources SET proxy_asset_id = %s WHERE id = %s AND organization_id = %s", (asset, video_id, org))
        audit(cur, org, SERVICE, "video.proxy_created", "video", video_id, info, f"job:{job.id}")
        publish(cur, org, "video", video_id, "video.proxy_created", {"video_id": video_id}, f"proxy-created:{video_id}")
    return {"video_id": video_id, **info}
