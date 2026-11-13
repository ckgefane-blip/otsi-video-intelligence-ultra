"""Video-page links (ADR-145): YouTube, VK, Rutube, OK.ru, Facebook/Instagram, TikTok, X, Twitch, Dailymotion, Streamable and any other
page that is not itself a video file are fetched with yt-dlp (public domain / Unlicense, free; owner 2026-11-13: "The app should be able to
accept all links especially YouTube and VK").

What it does NOT do, by design:
  * no sign-in, no cookies, no browser session: private, members-only and sign-in-only videos fail with the service's own reason
  * no DRM: yt-dlp refuses protected streams; we report ENCRYPTED_STREAM
  * no live streams: only finished recordings (LIVE_STREAM)
  * one video per link, never a whole playlist or channel
The host is checked first by the same guard as every other import (public address, http/https only), the file is capped at the import
size limit, and the result goes through the same sniff / probe / decode / malware checks as an upload. FFmpeg (the LGPL build, ADR-029)
joins separate video and audio streams when the site serves them apart.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

from .jobs import JobError

# yt-dlp's error text -> our failure codes (checked in order, lower-case)
_REASONS: tuple[tuple[str, str, str], ...] = (
    ("drm", "ENCRYPTED_STREAM", "This video is DRM-protected; it cannot be imported. Ask the rights holder for the original file."),
    ("is live", "LIVE_STREAM", "This is a live stream; only finished recordings can be imported."),
    ("live event", "LIVE_STREAM", "This is a live or upcoming stream; only finished recordings can be imported."),
    ("private video", "NOT_DOWNLOADABLE", "This video is private. Ask its owner for the file, or for a public or unlisted link."),
    ("sign in", "NOT_DOWNLOADABLE", "The service only shows this video after signing in, which OTSI VIE does not do. Download it from the service yourself and upload the file."),
    ("login", "NOT_DOWNLOADABLE", "The service only shows this video after signing in, which OTSI VIE does not do. Download it from the service yourself and upload the file."),
    ("members", "NOT_DOWNLOADABLE", "This video is for channel members only. Download it from the service yourself and upload the file."),
    ("not available in your country", "NOT_DOWNLOADABLE", "The service does not offer this video in this country."),
    ("geo", "NOT_DOWNLOADABLE", "The service does not offer this video in this country."),
    ("unavailable", "NOT_FOUND", "The service says this video is unavailable (removed or blocked)."),
    ("does not exist", "NOT_FOUND", "The service says this video does not exist."),
    ("404", "NOT_FOUND", "The service says this video does not exist."),
    ("unsupported url", "UNSUPPORTED_LINK", "No video was found at this link. Use the link of the video's own page, or a direct link to the file."),
    ("no video formats", "UNSUPPORTED_LINK", "No video was found at this link. Use the link of the video's own page, or a direct link to the file."),
    ("max_filesize", "FILE_TOO_LARGE", "The video is larger than the import limit."),
    ("larger than", "FILE_TOO_LARGE", "The video is larger than the import limit."),
)
_NETWORK = ("timed out", "timeout", "connection reset", "connection refused", "connection aborted", "urlopen error", "temporarily",
            "http error 5", "http error 429", "too many requests", "network is unreachable")


class ExtractorMissing(JobError):
    pass


def _clean(msg: str) -> str:
    return re.sub(r"\x1b\[[0-9;]*m", "", msg).replace("ERROR: ", "").strip()


def classify(msg: str) -> tuple[str, str] | None:
    """(code, user-facing reason) for a yt-dlp error, or None when it looks like a network problem worth retrying."""
    low = _clean(msg).lower()
    if any(n in low for n in _NETWORK):              # first: "HTTP Error 503: Service Unavailable" is the network, not a removed video
        return None
    for needle, code, reason in _REASONS:
        if needle in low:
            return code, reason
    return "EXTRACT_FAILED", f"The video could not be fetched from this link: {_clean(msg)[:300]}"


def _reject_live(info: dict, *, incomplete: bool) -> str | None:
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming", "post_live"):
        return "is live"
    return None


def extract(url: str, work: Path, max_bytes: int, on_progress: Callable[[int, int | None], None], *, ffmpeg_dir: str | None = None,
            ydl_factory=None) -> dict:
    """Download the single video behind a video-page link into `work`. Returns {path, bytes, title, author, license, source_page}.
    Raises JobError for a decided refusal and OSError for a network problem (the caller retries those)."""
    if ydl_factory is None:
        try:
            import yt_dlp  # noqa: PLC0415 — optional at import time so the rest of the worker runs without it
        except ImportError as e:
            raise ExtractorMissing("EXTRACTOR_MISSING", "Video-page links need the yt-dlp component, which is not installed with this worker.") from e
        ydl_factory, download_error = yt_dlp.YoutubeDL, yt_dlp.utils.DownloadError
    else:
        download_error = Exception

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            on_progress(int(d.get("downloaded_bytes") or 0), d.get("total_bytes") or d.get("total_bytes_estimate"))

    opts = {
        "outtmpl": str(work / "extracted.%(ext)s"),
        # best quality that fits the analysis pipeline: MP4 video + M4A audio when offered, else the best single file
        # without FFmpeg to join streams: the best single file that already holds both, else the picture alone (analysis needs
        # the video; many sites, YouTube included, now serve picture and sound only as separate streams)
        "format": "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b" if ffmpeg_dir else "b[ext=mp4]/b/bv*[ext=mp4]/bv*",
        "merge_output_format": "mp4",
        "noplaylist": True,                 # one video per link, never a whole playlist or channel
        "playlist_items": "1",
        "max_filesize": max_bytes,
        "match_filter": _reject_live,
        "quiet": True, "no_warnings": True, "noprogress": True,
        "restrictfilenames": True, "windowsfilenames": True,
        "socket_timeout": 30, "retries": 3, "fragment_retries": 3,
        "progress_hooks": [hook],
        "cachedir": False,                  # nothing written outside the job's own folder
        "nopart": False,
    }
    if ffmpeg_dir:
        opts["ffmpeg_location"] = ffmpeg_dir
    try:
        with ydl_factory(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except download_error as e:
        verdict = classify(str(e))
        if verdict is None:
            raise OSError(_clean(str(e))) from e
        raise JobError(*verdict) from e
    if info is None:                                                    # the live filter skipped it
        raise JobError("LIVE_STREAM", "This is a live or upcoming stream; only finished recordings can be imported.")
    if info.get("_type") == "playlist":
        entries = [x for x in (info.get("entries") or []) if x]
        if not entries:
            raise JobError("UNSUPPORTED_LINK", "This link is a playlist with no downloadable video. Use the link of one video.")
        info = entries[0]
    files = sorted((p for p in work.glob("extracted.*") if p.is_file() and not p.name.endswith((".part", ".ytdl"))),
                   key=lambda p: p.stat().st_size, reverse=True)
    if not files:
        raise JobError("EXTRACT_FAILED", "The service answered, but no video file was saved.")
    out = files[0]
    size = out.stat().st_size
    if size > max_bytes:
        raise JobError("FILE_TOO_LARGE", "The video is larger than the import limit.")
    return {
        "path": out, "bytes": size,
        "title": info.get("title"),
        "author": info.get("uploader") or info.get("channel") or info.get("creator"),
        "license": info.get("license"),
        "source_page": info.get("webpage_url") or url,
        "provider_key": info.get("extractor_key"),
    }
