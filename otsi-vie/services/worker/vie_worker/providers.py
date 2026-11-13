"""Provider adapters for link imports (ADR-027). Each turns a pasted link into something the guarded fetcher may download, using only the
provider's official, permitted method; anything else is refused with the reason and the authorised alternative (providers.json).

  direct        the link is the file
  hls           unencrypted, finished HLS playlists: every segment fetched through the guard (FFmpeg never sees the URL)
  wikimedia     Commons API -> original upload URL, licence and author recorded
  archive_org   metadata API -> the item's original video file, licence recorded
  dropbox       shared link -> Dropbox's documented direct-download form (dl=1)
  vimeo         Vimeo API with the user's personal access token -> a download link the API offers to that account
  google_drive  Drive API (files.get alt=media) with the user's OAuth access token
  extractor     video-page links (YouTube, VK, Rutube, OK.ru, Facebook/Instagram, TikTok, X, Twitch, Dailymotion, …): yt-dlp, no sign-in,
                no DRM, no live (extractor.py, ADR-145). A direct link that turns out to be a web page falls back to it too (ingest.py).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit, urlunsplit

from .fetch import Auth, Guard, fetch_json, fetch_text, provider_of
from .jobs import JobError

VIDEO_EXT = (".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".mpg", ".mpeg", ".ts", ".m2ts", ".mts", ".flv", ".ogv", ".ogg")
MAX_HLS_SEGMENTS = 20000
# official API endpoints (module constants so tests can point them at a local stand-in)
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
ARCHIVE_METADATA = "https://archive.org/metadata"
ARCHIVE_DOWNLOAD = "https://archive.org/download"
VIMEO_API = "https://api.vimeo.com"
DRIVE_API = "https://www.googleapis.com/drive/v3"


def _host(base: str) -> str:
    return urlsplit(base).hostname or ""


@dataclass
class Resolved:
    provider: str
    download_url: str | None = None
    segments: list[str] = field(default_factory=list)       # HLS: init (if any) + media segments, in order
    auth: Auth | None = None
    title: str | None = None
    license: str | None = None
    author: str | None = None
    source_page: str | None = None
    extractor: bool = False                                  # fetched with yt-dlp (extractor.py) instead of a plain download


def resolve(url: str, *, token: str | None, guard: Guard) -> Resolved:
    u = urlsplit(url.strip())
    p = provider_of(u.hostname or "")
    pid = p["id"] if p else ("hls" if u.path.lower().endswith(".m3u8") else "direct")
    if p and p["status"] == "unsupported":
        raise JobError("UNSUPPORTED_PROVIDER", f"{p['name']}: {p['reason']} {p['alternative']}")
    if p and p.get("via") == "extractor":
        return Resolved(pid, extractor=True, source_page=url)
    if pid == "hls":
        return _hls(url, guard)
    if pid == "direct":
        return Resolved("direct", download_url=url)
    return {"wikimedia": _wikimedia, "archive_org": _archive, "dropbox": _dropbox, "vimeo": _vimeo, "google_drive": _drive}[pid](url, token, guard)


# ------------------------------------------------------------------ open-licence archives
def _wikimedia(url: str, token, guard: Guard) -> Resolved:
    u = urlsplit(url)
    if u.hostname == "upload.wikimedia.org":
        return Resolved("wikimedia", download_url=url)
    m = re.search(r"/wiki/(File:[^?#]+)", u.path) or re.search(r"[?&]title=(File:[^&#]+)", url)
    if not m:
        raise JobError("UNSUPPORTED_LINK", "Use the link of a Wikimedia Commons file page (…/wiki/File:Name.webm).")
    title = unquote(m.group(1)).replace("_", " ")
    api = COMMONS_API + "?" + urlencode({"action": "query", "titles": title, "prop": "imageinfo",
                                                                  "iiprop": "url|mime|extmetadata", "format": "json"})
    page = next(iter(fetch_json(api, guard=guard).get("query", {}).get("pages", {}).values()), {})
    info = (page.get("imageinfo") or [None])[0]
    if not info:
        raise JobError("NOT_FOUND", "There is no such file on Wikimedia Commons.")
    if not str(info.get("mime", "")).startswith(("video/", "application/ogg")):
        raise JobError("NOT_A_MEDIA_FILE", f"That Commons file is '{info.get('mime')}', not a video.")
    meta = info.get("extmetadata", {})
    strip = lambda k: re.sub("<[^>]+>", "", meta.get(k, {}).get("value", "")).strip() or None  # noqa: E731
    return Resolved("wikimedia", download_url=info["url"], title=title.removeprefix("File:"), license=strip("LicenseShortName"),
                    author=strip("Artist"), source_page=info.get("descriptionurl"))


def _archive(url: str, token, guard: Guard) -> Resolved:
    m = re.match(r"^/(?:details|download)/([^/?#]+)(?:/(.+))?", urlsplit(url).path)
    if not m:
        raise JobError("UNSUPPORTED_LINK", "Use the link of an Internet Archive item (archive.org/details/<item>).")
    item, file_name = m.group(1), m.group(2)
    meta = fetch_json(f"{ARCHIVE_METADATA}/{quote(item)}", guard=guard)
    files = meta.get("files") or []
    if not files:
        raise JobError("NOT_FOUND", "There is no such Internet Archive item, or it has no files.")
    if file_name:
        chosen = next((f for f in files if f.get("name") == unquote(file_name)), None)
    else:
        vids = [f for f in files if str(f.get("name", "")).lower().endswith(VIDEO_EXT)]
        originals = [f for f in vids if f.get("source") == "original"] or vids
        chosen = max(originals, key=lambda f: int(f.get("size") or 0), default=None)
    if not chosen or not str(chosen.get("name", "")).lower().endswith(VIDEO_EXT):
        raise JobError("NOT_A_MEDIA_FILE", "That Internet Archive item has no video file.")
    md = meta.get("metadata", {})
    return Resolved("archive_org", download_url=f"{ARCHIVE_DOWNLOAD}/{quote(item)}/{quote(chosen['name'])}",
                    title=md.get("title") if isinstance(md.get("title"), str) else chosen["name"], license=md.get("licenseurl"),
                    author=md.get("creator") if isinstance(md.get("creator"), str) else None, source_page=f"https://archive.org/details/{item}")


# ------------------------------------------------------------------ shared links
def _dropbox(url: str, token, guard: Guard) -> Resolved:
    u = urlsplit(url)
    if u.hostname == "dl.dropboxusercontent.com":
        return Resolved("dropbox", download_url=url)
    q = parse_qs(u.query)
    q["dl"] = ["1"]                                                  # Dropbox's documented "force download" switch for shared links
    q.pop("raw", None)
    return Resolved("dropbox", download_url=urlunsplit((u.scheme, u.netloc, u.path, urlencode(q, doseq=True), "")))


# ------------------------------------------------------------------ token-based official APIs
def _vimeo(url: str, token, guard: Guard) -> Resolved:
    if not token:
        raise JobError("AUTH_REQUIRED", "Vimeo imports need your Vimeo personal access token (vimeo.com/settings/apps). Only videos Vimeo lets your account download can be imported.")
    m = re.search(r"/(?:video/)?(\d{5,})", urlsplit(url).path)
    if not m:
        raise JobError("UNSUPPORTED_LINK", "Use the link of a single Vimeo video (vimeo.com/<number>).")
    auth = Auth(f"bearer {token}", (_host(VIMEO_API),))
    v = fetch_json(f"{VIMEO_API}/videos/{m.group(1)}?fields=name,download,license,user.name,link", guard=guard, auth=auth)
    files = [d for d in (v.get("download") or []) if d.get("link")]
    if not files:
        raise JobError("NOT_DOWNLOADABLE", "Vimeo does not offer this video for download to your account (only your own videos, or videos whose owner enabled downloads).")
    best = max(files, key=lambda d: (d.get("quality") == "source", int(d.get("height") or 0), int(d.get("size") or 0)))
    return Resolved("vimeo", download_url=best["link"], title=v.get("name"), license=v.get("license"), author=(v.get("user") or {}).get("name"),
                    source_page=v.get("link"))


def _drive(url: str, token, guard: Guard) -> Resolved:
    if not token:
        raise JobError("AUTH_REQUIRED", "Google Drive imports need a Google OAuth access token for an account that can open the file (Drive read-only scope).")
    u = urlsplit(url)
    m = re.search(r"/file/d/([A-Za-z0-9_-]{10,})", u.path)
    fid = m.group(1) if m else (parse_qs(u.query).get("id") or [None])[0]
    if not fid or not re.fullmatch(r"[A-Za-z0-9_-]{10,}", fid):
        raise JobError("UNSUPPORTED_LINK", "Use a Google Drive file link (drive.google.com/file/d/<id>/view).")
    auth = Auth(f"Bearer {token}", (_host(DRIVE_API),))
    meta = fetch_json(f"{DRIVE_API}/files/{fid}?fields=name,mimeType,size&supportsAllDrives=true", guard=guard, auth=auth)
    if not str(meta.get("mimeType", "")).startswith("video/"):
        raise JobError("NOT_A_MEDIA_FILE", f"That Drive file is '{meta.get('mimeType')}', not a video.")
    return Resolved("google_drive", download_url=f"{DRIVE_API}/files/{fid}?alt=media&supportsAllDrives=true", auth=auth,
                    title=meta.get("name"), source_page=url)


# ------------------------------------------------------------------ HLS
def _attr(line: str, key: str) -> str | None:
    m = re.search(rf'{key}=("([^"]*)"|[^,]*)', line)
    return (m.group(2) if m.group(2) is not None else m.group(1)) if m else None


def _hls(url: str, guard: Guard) -> Resolved:
    text, base = fetch_text(url, guard=guard)
    if not text.lstrip().startswith("#EXTM3U"):
        raise JobError("NOT_A_MEDIA_FILE", "The link is not an HLS playlist.")
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if any(l.startswith("#EXT-X-STREAM-INF") for l in lines):                                  # master playlist: highest bandwidth
        variants = []
        for i, l in enumerate(lines):
            if l.startswith("#EXT-X-STREAM-INF") and i + 1 < len(lines) and not lines[i + 1].startswith("#"):
                variants.append((int(_attr(l, "BANDWIDTH") or 0), _join(base, lines[i + 1])))
        if not variants:
            raise JobError("NOT_A_MEDIA_FILE", "The HLS playlist lists no streams.")
        text, base = fetch_text(max(variants)[1], guard=guard)
        lines = [l.strip() for l in text.splitlines() if l.strip()]
    for l in lines:
        if l.startswith(("#EXT-X-KEY", "#EXT-X-SESSION-KEY")) and (_attr(l, "METHOD") or "NONE").upper() != "NONE":
            raise JobError("ENCRYPTED_STREAM", "This stream is encrypted (DRM or protected keys); it cannot be imported. Ask the rights holder for the original file.")
    if "#EXT-X-ENDLIST" not in lines:
        raise JobError("LIVE_STREAM", "This is a live or unfinished stream; only finished recordings can be imported.")
    segments, init = [], None
    for l in lines:
        if l.startswith("#EXT-X-MAP"):
            init = _join(base, _attr(l, "URI") or "")
        elif not l.startswith("#"):
            segments.append(_join(base, l))
    if not segments:
        raise JobError("NOT_A_MEDIA_FILE", "The HLS playlist has no segments.")
    if len(segments) > MAX_HLS_SEGMENTS:
        raise JobError("FILE_TOO_LARGE", "The stream has too many segments to import.")
    return Resolved("hls", segments=([init] if init else []) + segments)


def _join(base: str, ref: str) -> str:
    from urllib.parse import urljoin
    return urljoin(base, ref)
