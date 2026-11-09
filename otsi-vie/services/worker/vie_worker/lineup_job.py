"""READ_LINEUPS (ADR-039): find and read the broadcast lineup cards of one video (vie_worker.lineup).

Scan: one frame every SCAN_STEP_S seconds through the whole video with the fast text detector only (OpenVINO, ~0.1 s a frame on the Arc);
a frame with at least CARD_REGIONS text regions in CARD_ROWS rows is card-like. Card-like frames close in time are one showing of a card;
the middle frame of each showing is read in full (Paddle Inference, a few seconds). The same team shown twice (before kick-off and at
half-time) keeps the reading with the most rows. Each card is stored with a JPEG of its frame for the person who approves it.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import time
import uuid
from pathlib import Path

from . import ff
from .db import audit, tx
from .jobs import Job, JobError, JobRunner
from .lineup import Card, PageReader
from .storage import LocalStore

SERVICE = "lineup-worker"
SCAN_STEP_S = 2.0
CARD_REGIONS = 25                # an ordinary match frame has fewer than 15 (score bug, clock, boards)
CARD_ROWS = 10
SHOWING_GAP_US = 6_000_000       # card-like frames closer than this are one showing


def card_like(regions: list) -> bool:
    if len(regions) < CARD_REGIONS:
        return False
    ys = sorted((g[1] + g[3]) / 2 for g in regions)
    return 1 + sum(1 for i in range(1, len(ys)) if ys[i] - ys[i - 1] > 8) >= CARD_ROWS


def team_key(c: Card) -> str:
    return "".join(ch for ch in (c.team or "").lower() if ch.isalnum())


def _fail(runner: JobRunner, rid: str, code: str, detail: str) -> dict:
    with tx(runner.conn) as cur:
        cur.execute("UPDATE lineup_reads SET status = 'FAILED', failure_code = %s, failure_detail = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s", (code, detail[:2000], rid))
    return {"lineup_read_id": rid, "status": "FAILED", "failure_code": code}


def handle_read_lineups(runner: JobRunner, job: Job) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, rid = job.organization_id, job.payload["lineup_read_id"]
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT r.id, r.status, r.video_id, v.state, v.duration_us, v.project_id, a.object_key
                         FROM lineup_reads r JOIN video_sources v ON v.id = r.video_id AND v.organization_id = r.organization_id
                         LEFT JOIN assets a ON a.id = v.source_asset_id WHERE r.id = %s AND r.organization_id = %s""", (rid, org))
        row = cur.fetchone()
    if not row:
        raise JobError("NOT_FOUND", "The lineup read no longer exists.")
    if row["status"] in ("SUCCEEDED", "FAILED"):
        return {"lineup_read_id": rid, "status": row["status"], "note": "already settled"}
    if row["state"] != "INGESTED" or not row["object_key"]:
        return _fail(runner, rid, "VIDEO_NOT_READY", "The video has not been verified, so it cannot be read.")
    with tx(runner.conn) as cur:
        cur.execute("UPDATE lineup_reads SET status = 'RUNNING' WHERE id = %s", (rid,))
        cur.execute("DELETE FROM lineup_cards WHERE read_id = %s", (rid,))                 # a retry starts clean
    runner.progress(job, 2, "Loading the text readers")
    reader = PageReader()
    path, duration = str(store.path(row["object_key"])), int(row["duration_us"] or 0)
    t0 = time.monotonic()
    hits: list[tuple[int, object]] = []
    frames = 0
    for f in ff.decode_sampled(path, 1.0 / SCAN_STEP_S):
        frames += 1
        if card_like(reader.regions(f.rgb)):
            hits.append((f.pts_us, f.rgb))
        if frames % 60 == 0 and duration:
            runner.progress(job, 3 + 80 * min(1.0, f.pts_us / duration), f"Looking for lineup cards: {f.pts_us // 60_000_000} of {duration // 60_000_000} min")
    # showings: card-like frames close in time; each is read once, on its middle frame
    showings: list[list[tuple[int, object]]] = []
    for h in hits:
        if showings and h[0] - showings[-1][-1][0] <= SHOWING_GAP_US:
            showings[-1].append(h)
        else:
            showings.append([h])
    best: dict[str, tuple[int, Card, object]] = {}
    for k, s in enumerate(showings):
        runner.progress(job, 85 + 10 * k / max(1, len(showings)), f"Reading lineup card {k + 1} of {len(showings)}")
        pts, rgb = s[len(s) // 2]
        card = reader.read_card(rgb)
        if not card:
            continue
        key = team_key(card) or f"card-{pts}"
        if key not in best or len(card.entries) > len(best[key][1].entries):
            best[key] = (pts, card, rgb)
    runner.progress(job, 96, "Saving the lineups")
    from PIL import Image
    with tx(runner.conn) as cur:
        cur.execute("SELECT claim_token FROM worker_jobs WHERE id = %s FOR UPDATE", (job.id,))
        if cur.fetchone()["claim_token"] != job.token:
            raise JobError("LEASE_LOST", "Another worker took over this lineup read.")
        for pts, card, rgb in sorted(best.values(), key=lambda b: b[0]):
            buf = io.BytesIO(); Image.fromarray(rgb).save(buf, "JPEG", quality=88); jpg = buf.getvalue()
            key = f"org/{org}/videos/{row['video_id']}/lineups/{rid}/{pts}.jpg"
            Path(store.path(key)).parent.mkdir(parents=True, exist_ok=True)
            Path(store.path(key)).write_bytes(jpg)
            asset = str(uuid.uuid4())
            cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, metadata) "
                        "VALUES (%s, %s, %s, 'THUMBNAIL', %s, 'local', %s, %s, 'image/jpeg', %s)",
                        (asset, org, row["project_id"], key, len(jpg), hashlib.sha256(jpg).hexdigest(), json.dumps({"lineup_read_id": rid, "pts_us": pts})))
            entries = [{"number": e.number, "name": e.name, "role": e.role, "confidence": e.confidence} for e in card.entries]
            cur.execute("""INSERT INTO lineup_cards (id, organization_id, read_id, video_id, pts_us, team_name, coach_name, entries, frame_asset_id)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (str(uuid.uuid4()), org, rid, row["video_id"], pts, (card.team or "")[:255] or None, (card.coach or "")[:255] or None, json.dumps(entries, ensure_ascii=False), asset))
        metrics = {"frames_scanned": frames, "card_like_frames": len(hits), "showings": len(showings), "cards": len(best),
                   "players": sum(len(b[1].entries) for b in best.values()), "seconds": round(time.monotonic() - t0, 1), "reader": reader.model_version}
        cur.execute("UPDATE lineup_reads SET status = 'SUCCEEDED', metrics = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s", (json.dumps(metrics), rid))
        audit(cur, org, SERVICE, "video.lineups_read", "video", str(row["video_id"]), {"lineup_read_id": rid, "cards": len(best)}, f"job:{job.id}")
    return {"lineup_read_id": rid, "status": "SUCCEEDED", **metrics}
