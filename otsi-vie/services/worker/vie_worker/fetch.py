"""Server-side fetching for link imports, safe against SSRF (threat model 3.4; ADR-023, ADR-027).

  * http/https only, no credentials in the URL, default ports or 1024-65535
  * the host is resolved once; EVERY address must be public (no loopback, private, link-local, CGNAT, multicast, reserved, unspecified,
    IPv4-mapped/compat or 6to4/Teredo forms of those); the connection goes to that vetted IP (Host header and TLS SNI keep the name),
    so a second DNS answer cannot redirect it (DNS rebinding)
  * redirects are followed by hand, at most 5, each one re-checked; https -> http downgrades are refused
  * links to providers whose terms or APIs do not allow imports are refused with the reason (providers.json)
  * a user's access token is sent ONLY to the hosts named for it (the provider's own API) and never after a redirect to another host
  * every response has a media-type allow-list and a size cap; connect and idle time-outs; nothing from the server's environment is sent
"""
from __future__ import annotations

import http.client
import ipaddress
import json
import os
import socket
import ssl
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin, urlsplit

from .jobs import JobError

MAX_REDIRECTS = 5
CONNECT_TIMEOUT_S = 15
IDLE_TIMEOUT_S = 60
CHUNK = 1024 * 1024
MEDIA_TYPES = ("video/", "application/octet-stream", "binary/octet-stream", "application/mp4", "application/x-matroska", "application/ogg", "audio/ogg")
PLAYLIST_TYPES = ("application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl", "text/plain", "application/octet-stream")
JSON_TYPES = ("application/json", "text/json")
# Identifies the importer as media hosts ask (Wikimedia's User-Agent policy blocks downloads from unidentified clients). The operator's
# contact (URL or address) can be added with OTSI_VIE_HTTP_CONTACT; nothing personal is sent by default.
USER_AGENT = ("OTSI-VIE-Ingest/1 (authorised video import for football analysis; "
              f"contact: {os.environ.get('OTSI_VIE_HTTP_CONTACT') or 'operator of this OTSI VIE installation'}) python-http.client")
POLICY_FILE = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "src" / "providers.json"
POLICY = json.loads(POLICY_FILE.read_text(encoding="utf-8"))["providers"]


def provider_of(host: str) -> dict | None:
    h = host.lower().rstrip(".")
    for p in POLICY:
        if any(h == x or h.endswith("." + x) for x in p["hosts"]):
            return p
    return None


def is_public_address(ip: str) -> bool:
    a = ipaddress.ip_address(ip)
    if isinstance(a, ipaddress.IPv6Address):
        if a.ipv4_mapped:
            return is_public_address(str(a.ipv4_mapped))
        if a.sixtofour:
            return is_public_address(str(a.sixtofour))
        if a.teredo:
            return False
        if a in ipaddress.ip_network("::/96"):                        # deprecated IPv4-compatible form
            return False
    if a.is_loopback or a.is_private or a.is_link_local or a.is_multicast or a.is_reserved or a.is_unspecified:
        return False
    if isinstance(a, ipaddress.IPv4Address) and a in ipaddress.ip_network("100.64.0.0/10"):   # carrier-grade NAT
        return False
    return a.is_global


@dataclass
class Target:
    scheme: str
    host: str
    port: int
    path: str
    ip: str


@dataclass
class Auth:
    """A credential and the only hosts it may be sent to (suffix match)."""
    header: str
    hosts: tuple[str, ...]

    def applies(self, host: str) -> bool:
        h = host.lower()
        return any(h == x or h.endswith("." + x) for x in self.hosts)


@dataclass
class Guard:
    resolve: Callable[[str, int], list[str]] | None = None
    address_ok: Callable[[str], bool] = field(default=is_public_address)


def check_url(url: str, resolve: Callable[[str, int], list[str]] | None = None, address_ok: Callable[[str], bool] = is_public_address) -> Target:
    """Validate a URL and pick the vetted address to connect to. Raises JobError with a user-facing reason."""
    if len(url) > 2048:
        raise JobError("URL_TOO_LONG", "The link is too long.")
    try:
        u = urlsplit(url.strip())
        port = u.port
    except ValueError:
        raise JobError("INVALID_URL", "That is not a valid link.")
    if u.scheme not in ("http", "https") or not u.hostname:
        raise JobError("INVALID_URL", "Only http:// and https:// links to a video can be imported.")
    if u.username or u.password:
        raise JobError("INVALID_URL", "Links with a user name or password are not accepted.")
    port = port or (443 if u.scheme == "https" else 80)
    if port not in (80, 443) and not 1024 <= port <= 65535:
        raise JobError("BLOCKED_DESTINATION", "That port is not allowed.")
    p = provider_of(u.hostname)
    if p and p["status"] == "unsupported":
        raise JobError("UNSUPPORTED_PROVIDER", f"{p['name']}: {p['reason']} {p['alternative']}")
    try:
        literal = ipaddress.ip_address(u.hostname.strip("[]"))
        ips = [str(literal)]
    except ValueError:
        try:
            ips = (resolve or _resolve)(u.hostname, port)
        except OSError:
            raise JobError("HOST_NOT_FOUND", "The link's server could not be found.")
    if not ips or not all(address_ok(ip) for ip in ips):
        raise JobError("BLOCKED_DESTINATION", "That link points to a private or reserved network address and cannot be imported.")
    path = (u.path or "/") + (f"?{u.query}" if u.query else "")
    return Target(u.scheme, u.hostname, port, path, ips[0])


def _resolve(host: str, port: int) -> list[str]:
    return sorted({ai[4][0] for ai in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)})


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, t: Target):
        super().__init__(t.host, t.port, timeout=CONNECT_TIMEOUT_S, context=ssl.create_default_context())
        self._ip = t.ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        sock.settimeout(IDLE_TIMEOUT_S)                                    # after connecting: the longest silence while reading
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


class _PinnedHTTP(http.client.HTTPConnection):
    def __init__(self, t: Target):
        super().__init__(t.host, t.port, timeout=CONNECT_TIMEOUT_S)
        self._ip = t.ip

    def connect(self):
        self.sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock.settimeout(IDLE_TIMEOUT_S)


def _get(url: str, *, accept: str, types: tuple[str, ...], max_bytes: int, sink, guard: Guard, auth: Auth | None,
         on_progress: Callable[[int, int | None], None] | None, what: str) -> dict:
    """One guarded GET with manual redirects; the body goes to `sink(chunk)`. Returns {bytes, content_type, final_url}."""
    current, previous_scheme = url, None
    for _ in range(MAX_REDIRECTS + 1):
        t = check_url(current, guard.resolve, guard.address_ok)
        if previous_scheme == "https" and t.scheme == "http":
            raise JobError("BLOCKED_DESTINATION", "The link redirects from https to an unencrypted http address.")
        headers = {"Host": t.host if t.port in (80, 443) else f"{t.host}:{t.port}", "User-Agent": USER_AGENT, "Accept": accept}
        if auth and auth.applies(t.host):
            headers["Authorization"] = auth.header
        conn = (_PinnedHTTPS if t.scheme == "https" else _PinnedHTTP)(t)
        try:
            conn.request("GET", t.path, headers=headers)
            r = conn.getresponse()
            if r.status in (301, 302, 303, 307, 308):
                loc = r.getheader("Location")
                if not loc:
                    raise JobError("BAD_REDIRECT", "The link redirects without a destination.")
                previous_scheme, current = t.scheme, urljoin(current, loc)
                continue
            if r.status in (401, 403):
                raise JobError("ACCESS_DENIED", f"The server refused access to that {what} (login, permission or a valid access token is required).")
            if r.status in (404, 410):
                raise JobError("NOT_FOUND", f"There is no {what} at that link.")
            if r.status == 429:
                raise OSError("rate limited by the provider")
            if r.status >= 500:
                raise OSError(f"server error {r.status}")
            if r.status != 200:
                raise JobError("UNEXPECTED_RESPONSE", f"The server answered {r.status}.")
            ctype = (r.getheader("Content-Type") or "").split(";")[0].strip().lower()
            if ctype and not ctype.startswith(types):
                if what == "video" and (ctype.startswith("text/") or ctype in ("application/json", "application/xhtml+xml")):
                    raise JobError("NOT_A_MEDIA_FILE", "The link opens a web page, not a video file. Use a direct link to the video file.")
                raise JobError("NOT_A_MEDIA_FILE", f"The link returns '{ctype}', not a {what}.")
            length = r.getheader("Content-Length")
            total = int(length) if length and length.isdigit() else None
            if total is not None and total > max_bytes:
                raise JobError("FILE_TOO_LARGE", f"The {what} is larger than allowed ({max_bytes // 1024 ** 2} MB).")
            got, last = 0, time.monotonic()
            while chunk := r.read(CHUNK):
                got += len(chunk)
                if got > max_bytes:
                    raise JobError("FILE_TOO_LARGE", f"The {what} is larger than allowed ({max_bytes // 1024 ** 2} MB).")
                sink(chunk)
                if on_progress and time.monotonic() - last > 1:
                    on_progress(got, total)
                    last = time.monotonic()
            if total is not None and got != total:
                raise OSError(f"connection ended after {got} of {total} bytes")
            if on_progress:
                on_progress(got, total)
            return {"bytes": got, "content_type": ctype or None, "final_url": current}
        finally:
            conn.close()
    raise JobError("TOO_MANY_REDIRECTS", "The link redirects too many times.")


def download(url: str, dest: str, max_bytes: int, on_progress: Callable[[int, int | None], None],
             resolve: Callable[[str, int], list[str]] | None = None, address_ok: Callable[[str], bool] = is_public_address,
             auth: Auth | None = None, append: bool = False) -> dict:
    """Fetch a video file into `dest`. Raises JobError (decided) or OSError (retryable network trouble)."""
    with open(dest, "ab" if append else "wb") as f:
        r = _get(url, accept="video/*, application/octet-stream;q=0.9", types=MEDIA_TYPES, max_bytes=max_bytes, sink=f.write,
                 guard=Guard(resolve, address_ok), auth=auth, on_progress=on_progress, what="video")
    if r["bytes"] == 0:
        raise JobError("EMPTY_FILE", "The link returned an empty file.")
    return r


def fetch_json(url: str, *, guard: Guard, auth: Auth | None = None, max_bytes: int = 4 * 1024 * 1024) -> dict:
    buf = bytearray()
    _get(url, accept="application/json", types=JSON_TYPES, max_bytes=max_bytes, sink=buf.extend, guard=guard, auth=auth, on_progress=None, what="API response")
    try:
        return json.loads(buf.decode("utf-8"))
    except ValueError:
        raise JobError("BAD_PROVIDER_RESPONSE", "The video service answered with something that is not valid JSON.")


def fetch_text(url: str, *, guard: Guard, max_bytes: int = 2 * 1024 * 1024) -> tuple[str, str]:
    """A playlist: returns (text, final_url) — relative segment links resolve against the final URL after redirects."""
    buf = bytearray()
    r = _get(url, accept="application/vnd.apple.mpegurl, */*;q=0.1", types=PLAYLIST_TYPES, max_bytes=max_bytes, sink=buf.extend, guard=guard,
             auth=None, on_progress=None, what="playlist")
    return buf.decode("utf-8", errors="replace"), r["final_url"]
