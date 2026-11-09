"""Provider adapters for link imports (ADR-027). A local stand-in server answers with the official APIs' response shapes, so every adapter
runs end to end offline: Commons and Internet Archive resolution, Vimeo and Google Drive with a user's token (sent only to the API host,
sealed at rest, deleted after use), HLS assembly (encrypted and live streams refused), Dropbox's documented direct-download form, and the
refusal of providers whose terms or APIs do not allow imports. Live checks against the real services are in test_providers_live.py."""
from __future__ import annotations

import base64
import functools
import http.server
import json
import os
import threading
import uuid
from urllib.parse import parse_qs, urlsplit

import pytest
from pathlib import Path

from vie_worker import providers
from vie_worker.fetch import Auth, Guard, is_public_address
from vie_worker.ingest import handle_ingest_url
from vie_worker.jobs import JobError, JobRunner
from vie_worker.secrets_box import seal

LOCAL_OK = lambda ip: ip == "127.0.0.1" or is_public_address(ip)          # noqa: E731 - test-only allowance for the stand-in server
GUARD = Guard(None, LOCAL_OK)


def ts_bytes(tmp_dir) -> bytes:
    """A genuine MPEG-TS recording (MPEG-2 video with in-band headers), as HLS segments carry."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tools" / "dev"))
    from test_media import encode
    return encode(Path(tmp_dir) / "stream.ts", codec="mpeg2video", container="mpegts", seconds=4, bit_rate=4_000_000).read_bytes()


@pytest.fixture(scope="module")
def server(media, tmp_path_factory):
    clip = media["mp4"].read_bytes()
    ts = ts_bytes(tmp_path_factory.mktemp("hls"))
    cut = (len(ts) // 3) // 188 * 188
    segs = [ts[:cut], ts[cut:2 * cut], ts[2 * cut:]]
    state = {"auth_seen": []}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, status, ctype, body: bytes):
            self.send_response(status); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urlsplit(self.path)
            q = parse_qs(u.query)
            auth = self.headers.get("Authorization")
            state["auth_seen"].append((u.path, auth))
            base = f"http://127.0.0.1:{self.server.server_address[1]}"
            if u.path == "/commons/api.php":
                title = q["titles"][0]
                pages = {"-1": {"title": title, "missing": ""}} if "Missing" in title else {"1": {"title": title, "imageinfo": [{
                    "url": f"{base}/files/clip.mp4", "descriptionurl": "https://commons.wikimedia.org/wiki/" + title.replace(" ", "_"), "mime": "video/mp4",
                    "extmetadata": {"LicenseShortName": {"value": "CC BY 4.0"}, "Artist": {"value": "<a href='x'>A. Filmmaker</a>"}}}]}}
                return self.send(200, "application/json", json.dumps({"query": {"pages": pages}}).encode())
            if u.path == "/archive/metadata/match-1970":
                return self.send(200, "application/json", json.dumps({"metadata": {"title": "A 1970 match", "licenseurl": "http://creativecommons.org/publicdomain/mark/1.0/"},
                    "files": [{"name": "thumb.jpg", "source": "derivative", "size": "10"}, {"name": "match.mp4", "source": "original", "size": str(len(clip))},
                              {"name": "match_512kb.mp4", "source": "derivative", "size": "100"}]}).encode())
            if u.path == "/archive/download/match-1970/match.mp4" or u.path == "/files/clip.mp4":
                return self.send(200, "video/mp4", clip)
            if u.path.startswith("/vimeo/videos/"):
                if auth != "bearer good-token":
                    return self.send(401, "application/json", b'{"error":"unauthorized"}')
                vid = u.path.rsplit("/", 1)[1]
                dl = [] if vid == "99999" else [{"quality": "sd", "height": 360, "link": f"{base}/nope"}, {"quality": "source", "height": 240, "link": f"{base}/files/clip.mp4"}]
                return self.send(200, "application/json", json.dumps({"name": "Training session", "download": dl, "license": "by", "user": {"name": "Club"},
                                                                      "link": f"https://vimeo.com/{vid}"}).encode())
            if u.path.startswith("/drive/files/"):
                if auth != "Bearer drive-token":
                    return self.send(401, "application/json", b"{}")
                if q.get("alt") == ["media"]:
                    return self.send(200, "video/mp4", clip)
                fid = u.path.rsplit("/", 1)[1]
                mime = "application/pdf" if fid.startswith("pdf") else "video/mp4"
                return self.send(200, "application/json", json.dumps({"name": "match.mp4", "mimeType": mime, "size": str(len(clip))}).encode())
            if u.path == "/hls/master.m3u8":
                return self.send(200, "application/vnd.apple.mpegurl", b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=200000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000\nhigh/v.m3u8\n")
            if u.path == "/hls/high/v.m3u8":
                return self.send(200, "application/vnd.apple.mpegurl", ("#EXTM3U\n#EXT-X-TARGETDURATION:2\n" + "".join(f"#EXTINF:1.3,\nseg{i}.ts\n" for i in range(3)) + "#EXT-X-ENDLIST\n").encode())
            if u.path.startswith("/hls/high/seg"):
                return self.send(200, "video/mp2t", segs[int(u.path[-4])])
            if u.path == "/hls/live.m3u8":
                return self.send(200, "application/vnd.apple.mpegurl", b"#EXTM3U\n#EXTINF:2,\nseg0.ts\n")
            if u.path == "/hls/enc.m3u8":
                return self.send(200, "application/vnd.apple.mpegurl", b'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k.key"\n#EXTINF:2,\nseg0.ts\n#EXT-X-ENDLIST\n')
            return self.send(404, "text/plain", b"no")

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}"
    yield {"base": base, "state": state, "clip": clip, "ts": ts}
    srv.shutdown()


@pytest.fixture()
def endpoints(server, monkeypatch):
    b = server["base"]
    monkeypatch.setattr(providers, "COMMONS_API", f"{b}/commons/api.php")
    monkeypatch.setattr(providers, "ARCHIVE_METADATA", f"{b}/archive/metadata")
    monkeypatch.setattr(providers, "ARCHIVE_DOWNLOAD", f"{b}/archive/download")
    monkeypatch.setattr(providers, "VIMEO_API", f"{b}/vimeo")
    monkeypatch.setattr(providers, "DRIVE_API", f"{b}/drive")
    server["state"]["auth_seen"].clear()
    return server


# ------------------------------------------------------------------ resolution
def test_commons_file_page_resolves_to_the_original_with_licence_and_author(endpoints):
    r = providers.resolve("https://commons.wikimedia.org/wiki/File:Some_match_(1).webm", token=None, guard=GUARD)
    assert (r.provider, r.download_url.endswith("/files/clip.mp4"), r.license, r.author, r.title) == ("wikimedia", True, "CC BY 4.0", "A. Filmmaker", "Some match (1).webm")
    with pytest.raises(JobError) as e:
        providers.resolve("https://commons.wikimedia.org/wiki/File:Missing.webm", token=None, guard=GUARD)
    assert e.value.code == "NOT_FOUND"


def test_archive_item_resolves_to_its_original_video_file(endpoints):
    r = providers.resolve("https://archive.org/details/match-1970", token=None, guard=GUARD)
    assert r.download_url.endswith("/archive/download/match-1970/match.mp4") and r.license.endswith("publicdomain/mark/1.0/") and r.title == "A 1970 match"


def test_dropbox_shared_link_uses_the_documented_direct_download_form():
    r = providers.resolve("https://www.dropbox.com/scl/fi/abc123/match.mp4?rlkey=xyz&dl=0", token=None, guard=GUARD)
    q = parse_qs(urlsplit(r.download_url).query)
    assert (r.provider, q["dl"], q["rlkey"]) == ("dropbox", ["1"], ["xyz"])


def test_vimeo_needs_the_users_token_and_only_takes_what_the_api_offers(endpoints):
    with pytest.raises(JobError) as e:
        providers.resolve("https://vimeo.com/123456789", token=None, guard=GUARD)
    assert e.value.code == "AUTH_REQUIRED"
    r = providers.resolve("https://vimeo.com/123456789", token="good-token", guard=GUARD)
    assert r.download_url.endswith("/files/clip.mp4") and r.title == "Training session"          # the source quality, not the 360p
    with pytest.raises(JobError) as e:
        providers.resolve("https://vimeo.com/99999", token="good-token", guard=GUARD)
    assert e.value.code == "NOT_DOWNLOADABLE"
    with pytest.raises(JobError) as e:
        providers.resolve("https://vimeo.com/123456789", token="wrong", guard=GUARD)
    assert e.value.code == "ACCESS_DENIED"


def test_google_drive_needs_a_token_and_a_video_file(endpoints):
    with pytest.raises(JobError) as e:
        providers.resolve("https://drive.google.com/file/d/abcdefghijk12345/view", token=None, guard=GUARD)
    assert e.value.code == "AUTH_REQUIRED"
    r = providers.resolve("https://drive.google.com/file/d/abcdefghijk12345/view?usp=sharing", token="drive-token", guard=GUARD)
    assert "alt=media" in r.download_url and r.auth.header == "Bearer drive-token"
    with pytest.raises(JobError) as e:
        providers.resolve("https://drive.google.com/file/d/pdfdefghijk12345/view", token="drive-token", guard=GUARD)
    assert e.value.code == "NOT_A_MEDIA_FILE"


def test_a_token_is_only_ever_sent_to_its_api_host():
    a = Auth("Bearer t", ("www.googleapis.com",))
    assert a.applies("www.googleapis.com") and not a.applies("googleapis.com.evil.example") and not a.applies("storage.example.com")


def test_hls_picks_the_best_stream_and_refuses_live_and_encrypted_streams(endpoints):
    b = endpoints["base"]
    r = providers.resolve(f"{b}/hls/master.m3u8", token=None, guard=GUARD)
    assert r.provider == "hls" and [s.rsplit("/", 2)[-2:] for s in r.segments] == [["high", "seg0.ts"], ["high", "seg1.ts"], ["high", "seg2.ts"]]
    for path, code in (("/hls/live.m3u8", "LIVE_STREAM"), ("/hls/enc.m3u8", "ENCRYPTED_STREAM")):
        with pytest.raises(JobError) as e:
            providers.resolve(b + path, token=None, guard=GUARD)
        assert e.value.code == code


@pytest.mark.parametrize("url", ["https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://www.instagram.com/reel/x", "https://www.hudl.com/video/1",
                                 "https://www.tiktok.com/@a/video/1", "https://x.com/a/status/1", "https://1drv.ms/v/s!abc"])
def test_providers_without_a_permitted_import_method_are_refused_with_an_alternative(url):
    with pytest.raises(JobError) as e:
        providers.resolve(url, token=None, guard=GUARD)
    assert e.value.code == "UNSUPPORTED_PROVIDER" and ("upload" in str(e.value).lower())


# ------------------------------------------------------------------ whole jobs
def import_job(root, seed, url: str, token: str | None = None) -> dict:
    org, user, project = seed.org()
    video, job = str(uuid.uuid4()), str(uuid.uuid4())
    payload = {"video_id": video, "url": url}
    if token:
        payload["credential"] = seal(token, video)
    with root.cursor() as cur:
        cur.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, title, state, created_by) VALUES (%s, %s, %s, 'AUTHORIZED_PROVIDER', 'T', 'VALIDATING', %s)",
                    (video, org, project, user))
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (%s, %s, 'INGEST_URL', 'video', %s, %s, %s)",
                    (job, org, video, f"import:{video}", json.dumps(payload)))
    return {"video": video, "job": job}


@pytest.fixture()
def credential_key(monkeypatch):
    monkeypatch.setenv("OTSI_VIE_CREDENTIAL_KEY", base64.b64encode(os.urandom(32)).decode())


def run(stack):
    return JobRunner(stack["dsn"], "t", ["INGEST_URL"]).run_one({"INGEST_URL": functools.partial(handle_ingest_url, address_ok=LOCAL_OK)})


def source_meta(root, video):
    with root.cursor() as cur:
        cur.execute("SELECT v.state, v.failure_code, v.title, a.metadata FROM video_sources v LEFT JOIN assets a ON a.id = v.source_asset_id WHERE v.id = %s", (video,))
        r = cur.fetchone()
    return r, (json.loads(r["metadata"]) if r["metadata"] else None)


def test_a_vimeo_import_uses_the_sealed_token_once_records_provenance_and_deletes_the_token(stack, root, seed, endpoints, credential_key):
    s = import_job(root, seed, "https://vimeo.com/123456789", token="good-token")
    assert run(stack) == "succeeded"
    v, meta = source_meta(root, s["video"])
    assert v["state"] == "INGESTED" and v["title"] == "Training session"
    assert meta["provenance"] == {"provider": "vimeo", "source_page": "https://vimeo.com/123456789", "license": "by", "author": "Club", "title": "Training session"}
    assert meta["malware_scan"]["result"] in ("clean", "not_scanned")
    with root.cursor() as cur:
        cur.execute("SELECT JSON_EXTRACT(payload, '$.credential') AS c FROM worker_jobs WHERE id = %s", (s["job"],))
        assert cur.fetchone()["c"] is None                                                        # the token is gone
    sent = [a for p, a in endpoints["state"]["auth_seen"] if a]
    assert sent and all(p.startswith("/vimeo/") for p, a in endpoints["state"]["auth_seen"] if a)    # the token went to the API only


def test_an_hls_stream_is_assembled_segment_by_segment_and_verified(stack, root, seed, endpoints):
    s = import_job(root, seed, f"{endpoints['base']}/hls/master.m3u8")
    assert run(stack) == "succeeded"
    v, meta = source_meta(root, s["video"])
    assert v["state"] == "INGESTED" and meta["sniffed"] == "mpeg-ts" and meta["provenance"]["provider"] == "hls"


def test_a_youtube_link_is_refused_with_the_reason_and_the_alternative(stack, root, seed, endpoints):
    s = import_job(root, seed, "https://www.youtube.com/watch?v=abc123")
    assert run(stack) == "succeeded"
    v, _ = source_meta(root, s["video"])
    assert v["state"] == "FAILED" and v["failure_code"] == "UNSUPPORTED_PROVIDER"
    with root.cursor() as cur:
        cur.execute("SELECT failure_detail FROM video_sources WHERE id = %s", (s["video"],))
        assert "YouTube Studio" in cur.fetchone()["failure_detail"]


def test_a_token_sealed_for_another_video_does_not_open(stack, root, seed, endpoints, credential_key):
    s = import_job(root, seed, "https://vimeo.com/123456789", token="good-token")
    other = seal("good-token", str(uuid.uuid4()))
    with root.cursor() as cur:
        cur.execute("UPDATE worker_jobs SET payload = JSON_SET(payload, '$.credential', CAST(%s AS JSON)), max_attempts = 1 WHERE id = %s", (json.dumps(other), s["job"]))
    assert run(stack) == "failed"
