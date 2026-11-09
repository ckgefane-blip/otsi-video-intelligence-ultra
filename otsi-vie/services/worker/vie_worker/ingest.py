"""INGEST_UPLOAD (Block 03, F06/F08): turn a completed upload into a validated source video — or say exactly why not.

  1. assemble the parts in order, re-verifying each part's SHA-256 recorded at upload time, and hash the whole file
  2. compare with the client's whole-file SHA-256 when it sent one
  3. check the file signature (magic bytes) before any decoder sees it
  4. probe and test-decode in a separate, time-limited process (vie_worker.probe)
  5. apply the acceptance policy (codec, duration, resolution, DRM)
  6. commit: source + thumbnail assets, measured facts on the video, state INGESTED (or FAILED / QUARANTINED with the reason),
     upload session closed, parts deleted, audit row (SERVICE ingest-worker) and outbox event — all in one transaction
A failure is final for the video (the user sees the reason and can upload again); only infrastructure errors are retried.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

from .db import audit, publish, tx
from .fetch import Guard, download
from .providers import resolve as resolve_provider
from .scanner import scan
from .secrets_box import open_sealed
from .jobs import Job, JobError, JobRunner, RetryableError
from .probe import FRAMES_TO_DECODE
from .storage import LocalStore

SERVICE = "ingest-worker"
ALLOWED_VIDEO_CODECS = {"h264", "hevc", "mpeg2video", "mpeg4", "vp8", "vp9", "av1", "prores", "mjpeg", "dnxhd", "theora"}
MAX_DURATION_US = 6 * 3600 * 1_000_000          # a full match with extra time and pre/post-match fits
MIN_WIDTH, MIN_HEIGHT = 160, 90
PROBE_TIMEOUT_S = 300
CHUNK = 4 * 1024 * 1024

# container signatures checked before any decoder runs (offset, bytes)
SIGNATURES = {
    "mp4/mov": [(4, b"ftyp"), (4, b"moov"), (4, b"mdat"), (4, b"free"), (4, b"wide"), (4, b"skip")],
    "matroska/webm": [(0, b"\x1a\x45\xdf\xa3")],
    "avi": [(0, b"RIFF")],
    "flv": [(0, b"FLV")],
    "mpeg-ps": [(0, b"\x00\x00\x01\xba")],
    "ogg": [(0, b"OggS")],
}


def sniff(path: Path) -> str | None:
    with open(path, "rb") as f:
        head = f.read(4096)
    for name, sigs in SIGNATURES.items():
        if any(head[o:o + len(s)] == s for o, s in sigs):
            if name == "avi" and head[8:12] != b"AVI ":
                continue
            return name
    if len(head) >= 188 * 3 and all(head[i * 188] == 0x47 for i in range(3)):
        return "mpeg-ts"
    if len(head) >= 192 * 3 and all(head[4 + i * 192] == 0x47 for i in range(3)):
        return "mpeg-ts (m2ts)"
    return None


def run_probe(path: Path, thumb: Path) -> dict:
    """Probe in a child process (isolated interpreter, time limit). A crash or hang becomes a decided failure, not a worker crash."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("OTSI_VIE_")}      # the prober gets no credentials
    src_root = str(Path(__file__).resolve().parents[1])
    try:
        p = subprocess.run([sys.executable, "-I", "-c", f"import sys; sys.path.insert(0, {src_root!r}); from vie_worker.probe import probe; import json; "
                            f"print(json.dumps(probe(sys.argv[1], sys.argv[2])))", str(path), str(thumb)],
                           capture_output=True, text=True, timeout=PROBE_TIMEOUT_S, env=env)
    except subprocess.TimeoutExpired:
        raise JobError("PROBE_TIMEOUT", f"Inspecting the video took longer than {PROBE_TIMEOUT_S // 60} minutes; the file may be damaged.")
    if p.returncode != 0 or not p.stdout.strip():
        raise JobError("PROBE_CRASHED", "The video could not be inspected safely; the file may be damaged or malformed.")
    return json.loads(p.stdout.strip().splitlines()[-1])


def policy(facts: dict) -> tuple[str, str] | None:
    """The acceptance rules; returns (code, message) for a refusal."""
    if facts.get("video_codec") not in ALLOWED_VIDEO_CODECS:
        return "UNSUPPORTED_CODEC", f"Video codec '{facts.get('video_codec')}' is not supported. Supported: {', '.join(sorted(ALLOWED_VIDEO_CODECS))}."
    if not facts.get("duration_us"):
        return "UNKNOWN_DURATION", "The video's duration could not be determined."
    if facts["duration_us"] > MAX_DURATION_US:
        return "TOO_LONG", "Videos up to 6 hours are accepted."
    if (facts.get("width") or 0) < MIN_WIDTH or (facts.get("height") or 0) < MIN_HEIGHT:
        return "RESOLUTION_TOO_LOW", f"The video must be at least {MIN_WIDTH}x{MIN_HEIGHT} pixels."
    return None


def handle_ingest_upload(runner: JobRunner, job: Job) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, video_id, upload_id = job.organization_id, job.payload["video_id"], job.payload["upload_id"]
    with runner.conn.cursor() as cur:
        cur.execute("SELECT * FROM upload_sessions WHERE id = %s AND organization_id = %s AND video_id = %s", (upload_id, org, video_id))
        s = cur.fetchone()
        cur.execute("SELECT state, original_filename FROM video_sources WHERE id = %s AND organization_id = %s", (video_id, org))
        v = cur.fetchone()
        cur.execute("SELECT part_number, byte_size, remote_etag FROM upload_parts WHERE session_id = %s ORDER BY part_number", (upload_id,))
        parts = cur.fetchall()
    if not s or not v:
        raise JobError("NOT_FOUND", "The upload or its video no longer exists.")
    if v["state"] in ("INGESTED", "FAILED", "QUARANTINED"):
        return {"video_id": video_id, "state": v["state"], "note": "already settled"}         # a re-run after a crash: nothing to redo
    if s["status"] != "VERIFYING":
        raise JobError("UPLOAD_NOT_COMPLETED", f"The upload is {s['status'].lower()}, not completed.")

    ext = (Path(v["original_filename"] or "").suffix.lower().lstrip(".") or "bin")[:8]
    work = Path(tempfile.mkdtemp(prefix="ingest-", dir=store.ensure_dir(f"org/{org}/videos/{video_id}")))
    try:
        # 1-2 assemble and verify
        assembled = work / f"source.{ext}"
        total, expected = 0, int(s["expected_bytes"])
        whole = hashlib.sha256()
        with open(assembled, "wb") as out:
            for i, part in enumerate(parts, 1):
                runner.check(job)
                ph = hashlib.sha256()
                with open(store.path(f"uploads/{upload_id}/part-{part['part_number']:06d}"), "rb") as f:
                    while chunk := f.read(CHUNK):
                        ph.update(chunk)
                        whole.update(chunk)
                        out.write(chunk)
                        total += len(chunk)
                if ph.hexdigest() != part["remote_etag"]:
                    return settle_failure(runner, job, store, video_id, upload_id, "FAILED", "STORAGE_CORRUPTION",
                                          f"Part {part['part_number']} changed after it was uploaded. Please upload the file again.")
                runner.progress(job, 40 * i / len(parts), f"Assembling the file ({i}/{len(parts)} parts)")
        sha256 = whole.hexdigest()
        if total != expected:
            return settle_failure(runner, job, store, video_id, upload_id, "FAILED", "SIZE_MISMATCH", f"Received {total} bytes, expected {expected}.")
        if s["expected_sha256"] and s["expected_sha256"] != sha256:
            return settle_failure(runner, job, store, video_id, upload_id, "FAILED", "CHECKSUM_MISMATCH",
                                  "The file's checksum does not match the one your browser computed; it was damaged during upload.")

        return verify_and_commit(runner, job, store, Source(org, video_id, upload_id, work, assembled, total, sha256, ext))
    finally:
        shutil.rmtree(work, ignore_errors=True)


@dataclass
class Source:
    """A complete source file on local storage, from an upload (upload_id) or a link import (upload_id None)."""
    org: str
    video_id: str
    upload_id: str | None
    work: Path
    path: Path
    total: int
    sha256: str
    ext: str
    provenance: dict | None = None            # link imports: provider, source page, licence, author


def verify_and_commit(runner: JobRunner, job: Job, store: LocalStore, src: Source) -> dict:
    """Steps 3-6, shared by uploads and link imports: signature, isolated probe + decode, policy, one-transaction commit."""
    org, video_id, upload_id, work, assembled, total, sha256, ext = src.org, src.video_id, src.upload_id, src.work, src.path, src.total, src.sha256, src.ext
    final_key = f"org/{org}/videos/{video_id}/source.{ext}"
    # 3 signature
    runner.progress(job, 45, "Checking the file type")
    kind = sniff(assembled)
    if kind is None:
        return settle_failure(runner, job, store, video_id, upload_id, "QUARANTINED", "NOT_A_VIDEO",
                              "The file content is not a recognised video container, whatever its name says.")

    # malware scan before any decoder reads the file
    runner.progress(job, 47, "Scanning the file for malware")
    av_result = scan(str(assembled))
    if av_result["result"] == "threat":
        return settle_failure(runner, job, store, video_id, upload_id, "QUARANTINED", "MALWARE_DETECTED",
                              f"The malware scanner ({av_result['scanner']}) flagged this file; it was not opened.")
    if av_result["result"] == "error":
        raise RetryableError("SCAN_FAILED", "The malware scan could not complete; it will be retried.")

    # 4-5 probe, decode, policy
    runner.progress(job, 50, "Inspecting and test-decoding the video")
    thumb = work / "thumbnail.jpg"
    facts = run_probe(assembled, thumb)
    runner.check(job)
    if not facts.get("ok"):
        error = facts.get("error", "PROBE_FAILED")
        if error in ("NOT_A_VIDEO", "UNREADABLE"):
            # the signature says it is a video container, but it cannot be read: damaged or cut off, not disguised
            return settle_failure(runner, job, store, video_id, upload_id, "FAILED", "DAMAGED_OR_INCOMPLETE",
                                  f"The file looks like a {kind} video but cannot be read; it may be incomplete or damaged. Try exporting it again.")
        state = "QUARANTINED" if error == "DRM_PROTECTED" else "FAILED"
        return settle_failure(runner, job, store, video_id, upload_id, state, error, facts.get("detail", "The video could not be read."))
    refusal = policy(facts)
    if refusal:
        return settle_failure(runner, job, store, video_id, upload_id, "FAILED", refusal[0], refusal[1])

    # 6 commit
    runner.progress(job, 90, "Saving")
    final_path = store.path(final_key)
    os.replace(assembled, final_path)
    thumb_key = None
    if facts.get("thumbnail_written") and thumb.exists():
        thumb_key = f"org/{org}/videos/{video_id}/thumbnail.jpg"
        os.replace(thumb, store.path(thumb_key))
    source_asset, thumb_asset = str(uuid.uuid4()), (str(uuid.uuid4()) if thumb_key else None)
    with tx(runner.conn) as cur:
        cur.execute("SELECT claim_token FROM worker_jobs WHERE id = %s FOR UPDATE", (job.id,))
        if cur.fetchone()["claim_token"] != job.token:
            raise RetryableError("LEASE_LOST", "Another worker took over this job.")
        cur.execute("SELECT project_id FROM video_sources WHERE id = %s", (video_id,))
        project_id = cur.fetchone()["project_id"]
        cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, metadata) "
                    "VALUES (%s, %s, %s, 'SOURCE', %s, 'local', %s, %s, %s, %s)",
                    (source_asset, org, project_id, final_key, total, sha256, f"video/{ext}", json.dumps({"container": facts.get("container_format"), "sniffed": kind, "malware_scan": av_result,
                                "decode": {"frames_decoded": facts.get("decoded_frames"), "frames_tested": FRAMES_TO_DECODE}, **({"provenance": src.provenance} if src.provenance else {})})))
        if thumb_key:
            cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, source_asset_id) "
                        "VALUES (%s, %s, %s, 'THUMBNAIL', %s, 'local', %s, %s, 'image/jpeg', %s)",
                        (thumb_asset, org, project_id, thumb_key, os.path.getsize(store.path(thumb_key)), sha_file(store.path(thumb_key)), source_asset))
        fr, tb = facts.get("avg_frame_rate") or facts.get("real_frame_rate"), facts.get("time_base")
        cur.execute(
            """UPDATE video_sources SET state = 'INGESTED', source_asset_id = %s, thumbnail_asset_id = %s, duration_us = %s, width = %s, height = %s,
                      timebase_num = %s, timebase_den = %s, avg_frame_rate_num = %s, avg_frame_rate_den = %s, video_sha256 = %s,
                      container_format = %s, video_codec = %s, audio_codec = %s, is_variable_frame_rate = %s, frame_count = %s,
                      rotation_degrees = %s, failure_code = NULL, failure_detail = NULL WHERE id = %s AND organization_id = %s""",
            (source_asset, thumb_asset, facts["duration_us"], facts["width"], facts["height"], tb["num"] if tb else None, tb["den"] if tb else None,
             fr["num"] if fr else None, fr["den"] if fr else None, sha256, facts.get("container_format"), facts.get("video_codec"), facts.get("audio_codec"),
             facts.get("is_variable_frame_rate"), facts.get("frame_count"), facts.get("rotation_degrees") if facts.get("rotation_degrees") in (0, 90, 180, 270) else None,
             video_id, org))
        if upload_id:
            cur.execute("UPDATE upload_sessions SET status = 'COMPLETED' WHERE id = %s", (upload_id,))
        summary = {k: facts.get(k) for k in ("container_format", "video_codec", "audio_codec", "width", "height", "duration_us", "is_variable_frame_rate")}
        audit(cur, org, SERVICE, "video.ingested", "video", video_id, {**summary, "sha256": sha256, "bytes": total}, f"job:{job.id}")
        publish(cur, org, "video", video_id, "video.ingested", {"video_id": video_id, "source_asset_id": source_asset}, f"video-ingested:{video_id}")
    if upload_id:
        store.remove(f"uploads/{upload_id}")
    return {"video_id": video_id, "state": "INGESTED", "sha256": sha256, "bytes": total, **summary}


def sha_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def settle_failure(runner: JobRunner, job: Job, store: LocalStore, video_id: str, upload_id: str | None, state: str, code: str, detail: str) -> dict:
    """Record a decided refusal on the video (the job itself SUCCEEDED: it reached a verdict). Parts are deleted; nothing is kept."""
    with tx(runner.conn) as cur:
        cur.execute("UPDATE video_sources SET state = %s, failure_code = %s, failure_detail = %s WHERE id = %s AND organization_id = %s",
                    (state, code[:64], detail[:1000], video_id, job.organization_id))
        if upload_id:
            cur.execute("UPDATE upload_sessions SET status = 'FAILED' WHERE id = %s", (upload_id,))
        audit(cur, job.organization_id, SERVICE, "video.ingest_refused", "video", video_id, {"state": state, "code": code, "detail": detail}, f"job:{job.id}")
        publish(cur, job.organization_id, "video", video_id, "video.ingest_refused", {"video_id": video_id, "code": code}, f"video-refused:{video_id}")
    if upload_id:
        store.remove(f"uploads/{upload_id}")
    return {"video_id": video_id, "state": state, "failure_code": code}


MAX_IMPORT_BYTES = int(os.environ.get("OTSI_VIE_MAX_UPLOAD_BYTES", str(64 * 1024 ** 3)))
URL_EXTENSIONS = {"mp4/mov": "mp4", "matroska/webm": "mkv", "avi": "avi", "flv": "flv", "mpeg-ps": "mpg", "mpeg-ts": "ts", "mpeg-ts (m2ts)": "m2ts", "ogg": "ogv"}


def handle_ingest_url(runner: JobRunner, job: Job, *, resolve=None, address_ok=None) -> dict:
    """INGEST_URL (F07, ADR-023/027): resolve the link through its provider adapter (official methods only), download through the SSRF guard
    (HLS: segment by segment), then the same verification as an upload. Network trouble is retried; a decided refusal (unsupported provider,
    private address, not a media file, access denied, encrypted or live stream) is final. A user's access token is deleted when the job settles."""
    try:
        return _ingest_url(runner, job, resolve=resolve, address_ok=address_ok)
    finally:
        if "credential" in job.payload:
            with runner.conn.cursor() as cur:
                cur.execute("UPDATE worker_jobs SET payload = JSON_REMOVE(payload, '$.credential') WHERE id = %s", (job.id,))


def _ingest_url(runner: JobRunner, job: Job, *, resolve, address_ok) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, video_id, url = job.organization_id, job.payload["video_id"], job.payload["url"]
    with runner.conn.cursor() as cur:
        cur.execute("SELECT state FROM video_sources WHERE id = %s AND organization_id = %s AND ingest_mode IN ('DIRECT_URL', 'AUTHORIZED_PROVIDER')", (video_id, org))
        v = cur.fetchone()
    if not v:
        raise JobError("NOT_FOUND", "The import or its video no longer exists.")
    if v["state"] in ("INGESTED", "FAILED", "QUARANTINED"):
        return {"video_id": video_id, "state": v["state"], "note": "already settled"}
    token = open_sealed(job.payload["credential"], video_id) if job.payload.get("credential") else None
    guard = Guard(resolve, address_ok) if address_ok else Guard(resolve)
    work = Path(tempfile.mkdtemp(prefix="import-", dir=store.ensure_dir(f"org/{org}/videos/{video_id}")))
    try:
        target = work / "download.bin"
        runner.progress(job, 1, "Resolving the link")
        kwargs = {k: f for k, f in (("resolve", resolve), ("address_ok", address_ok)) if f is not None}
        try:
            r = resolve_provider(url, token=token, guard=guard)
            if r.segments:
                done = 0
                for i, seg in enumerate(r.segments):
                    remaining = MAX_IMPORT_BYTES - done
                    got = download(seg, str(target), remaining, lambda n, t: None, append=i > 0, **kwargs)
                    done += got["bytes"]
                    if i % 10 == 0:
                        runner.progress(job, 40 * (i + 1) / len(r.segments), f"Downloading the stream ({i + 1}/{len(r.segments)} segments)")
                got = {"bytes": done}
            else:
                got = download(r.download_url, str(target), MAX_IMPORT_BYTES,
                               lambda n, total: runner.progress(job, 40 * n / total if total else 20, f"Downloading ({n // (1024 * 1024)} MB)"),
                               auth=r.auth, **kwargs)
        except JobError as e:
            return settle_failure(runner, job, store, video_id, None, "FAILED", e.code, str(e))
        except OSError as e:
            raise RetryableError("NETWORK_ERROR", f"The download was interrupted ({type(e).__name__}); it will be retried.")
        sha256 = sha_file(str(target))
        kind = sniff(target)
        ext = URL_EXTENSIONS.get(kind or "", "bin")
        final = work / f"source.{ext}"
        os.replace(target, final)
        provenance = {k: v for k, v in {"provider": r.provider, "source_page": r.source_page, "license": r.license, "author": r.author, "title": r.title}.items() if v}
        with runner.conn.cursor() as cur:
            cur.execute("UPDATE video_sources SET byte_size = %s, title = COALESCE(%s, title) WHERE id = %s AND organization_id = %s",
                        (got["bytes"], (r.title or None) and r.title[:255], video_id, org))
        return verify_and_commit(runner, job, store, Source(org, video_id, None, work, final, got["bytes"], sha256, ext, provenance))
    finally:
        shutil.rmtree(work, ignore_errors=True)
