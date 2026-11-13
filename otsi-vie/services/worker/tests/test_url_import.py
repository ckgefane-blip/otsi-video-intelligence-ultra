"""Link import (F07): the SSRF guard's decisions, the download mechanics against a local test server, and the INGEST_URL job end to end.
The local server is reachable only because these tests pass an explicit `address_ok` that admits 127.0.0.1 — production has no such switch."""
from __future__ import annotations

import functools
import http.server
import threading
import uuid

import pytest

from vie_worker.fetch import check_url, download, is_public_address
from vie_worker.ingest import handle_ingest_url
from vie_worker.jobs import JobError, JobRunner

LOCAL_OK = lambda ip: ip == "127.0.0.1" or is_public_address(ip)          # noqa: E731 - test-only allowance for the local server


@pytest.mark.parametrize("ip,public", [
    ("8.8.8.8", True), ("2606:4700:4700::1111", True),
    ("127.0.0.1", False), ("10.1.2.3", False), ("172.16.0.1", False), ("192.168.1.1", False), ("169.254.169.254", False),
    ("100.64.0.1", False), ("0.0.0.0", False), ("224.0.0.1", False), ("::1", False), ("fe80::1", False), ("fc00::1", False),
    ("::ffff:10.0.0.1", False), ("::ffff:127.0.0.1", False), ("2002:0a00:0001::1", False), ("2001:0000:4136:e378::1", False),
])
def test_only_public_addresses_are_reachable(ip, public):
    assert is_public_address(ip) is public


@pytest.mark.parametrize("url,code", [
    ("ftp://example.com/a.mp4", "INVALID_URL"), ("file:///etc/passwd", "INVALID_URL"), ("javascript:alert(1)", "INVALID_URL"),
    ("https://user:pw@example.com/a.mp4", "INVALID_URL"), ("https://example.com:22/a.mp4", "BLOCKED_DESTINATION"),
    ("http://127.0.0.1:8080/a.mp4", "BLOCKED_DESTINATION"), ("http://169.254.169.254/latest/meta-data", "BLOCKED_DESTINATION"),
    ("http://[::1]/a.mp4", "BLOCKED_DESTINATION"), ("http://[::ffff:192.168.0.1]/a.mp4", "BLOCKED_DESTINATION"), ("http://" + "a" * 2050, "URL_TOO_LONG"),
])
def test_refused_links(url, code):
    with pytest.raises(JobError) as e:
        check_url(url, resolve=lambda h, p: ["93.184.215.14"])
    assert e.value.code == code


@pytest.mark.parametrize("url", ["https://www.youtube.com/watch?v=x", "https://youtu.be/x", "https://vk.com/video-1_2", "https://m.facebook.com/v"])
def test_video_site_links_pass_the_guard(url):
    # ADR-145: no video site is refused by name any more; the address checks still apply
    assert check_url(url, resolve=lambda h, p: ["93.184.215.14"]).ip == "93.184.215.14"


def test_a_name_that_resolves_to_any_private_address_is_refused():
    with pytest.raises(JobError) as e:
        check_url("https://rebind.example/a.mp4", resolve=lambda h, p: ["93.184.215.14", "10.0.0.5"])
    assert e.value.code == "BLOCKED_DESTINATION"
    assert check_url("https://ok.example/a.mp4", resolve=lambda h, p: ["93.184.215.14"]).ip == "93.184.215.14"


# ------------------------------------------------------------------ a local HTTP server standing in for a media host
@pytest.fixture(scope="module")
def server(media):
    clip = media["mp4"].read_bytes()

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            routes = {
                "/clip.mp4": (200, "video/mp4", clip),
                "/clip-generic": (200, "application/octet-stream", clip),
                "/page": (200, "text/html; charset=utf-8", b"<html>a page</html>"),
                "/denied": (403, "text/plain", b"no"),
                "/gone": (404, "text/plain", b"no"),
                "/garbage.mp4": (200, "video/mp4", b"\x00" * 50_000),
            }
            if self.path == "/redirect":
                self.send_response(302); self.send_header("Location", "/clip.mp4"); self.end_headers(); return
            if self.path == "/loop":
                self.send_response(302); self.send_header("Location", "/loop"); self.end_headers(); return
            if self.path == "/to-metadata":
                self.send_response(302); self.send_header("Location", "http://169.254.169.254/latest/meta-data"); self.end_headers(); return
            if self.path == "/short":
                self.send_response(200); self.send_header("Content-Type", "video/mp4"); self.send_header("Content-Length", "999999"); self.end_headers()
                self.wfile.write(clip[:1000]); return
            status, ctype, body = routes.get(self.path, (404, "text/plain", b"no"))
            self.send_response(status); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body)

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def fetch(url, tmp_path, max_bytes=64 * 1024 ** 2):
    return download(url, str(tmp_path / "out.bin"), max_bytes, lambda n, t: None, address_ok=LOCAL_OK)


def test_downloads_a_direct_video_link_and_follows_safe_redirects(server, tmp_path, media):
    r = fetch(f"{server}/redirect", tmp_path)
    assert r["bytes"] == len(media["mp4"].read_bytes()) and r["content_type"] == "video/mp4" and r["final_url"].endswith("/clip.mp4")
    assert (tmp_path / "out.bin").read_bytes() == media["mp4"].read_bytes()


@pytest.mark.parametrize("path,code", [
    ("/page", "NOT_A_MEDIA_FILE"), ("/denied", "ACCESS_DENIED"), ("/gone", "NOT_FOUND"), ("/loop", "TOO_MANY_REDIRECTS"), ("/to-metadata", "BLOCKED_DESTINATION"),
])
def test_refuses_pages_denials_loops_and_redirects_into_private_networks(server, tmp_path, path, code):
    with pytest.raises(JobError) as e:
        fetch(server + path, tmp_path)
    assert e.value.code == code


def test_size_limit_and_truncated_transfers(server, tmp_path):
    with pytest.raises(JobError) as e:
        fetch(f"{server}/clip.mp4", tmp_path, max_bytes=1000)
    assert e.value.code == "FILE_TOO_LARGE"
    with pytest.raises(OSError):                                       # retryable: the connection ended early
        fetch(f"{server}/short", tmp_path)


# ------------------------------------------------------------------ the INGEST_URL job
def seed_import(root, seed, url: str) -> dict:
    org, user, project = seed.org()
    video, job = str(uuid.uuid4()), str(uuid.uuid4())
    with root.cursor() as cur:
        cur.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, source_uri, title, state, created_by) "
                    "VALUES (%s, %s, %s, 'DIRECT_URL', %s, 'Imported', 'VALIDATING', %s)", (video, org, project, url, user))
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (%s, %s, 'INGEST_URL', 'video', %s, %s, %s)",
                    (job, org, video, f"import:{video}", f'{{"video_id": "{video}", "url": "{url}"}}'))
    return {"video": video, "job": job}


def run_url_job(stack):
    return JobRunner(stack["dsn"], "test-worker", ["INGEST_URL"]).run_one({"INGEST_URL": functools.partial(handle_ingest_url, address_ok=LOCAL_OK)})


def test_an_imported_link_is_verified_like_an_upload(stack, root, seed, server):
    s = seed_import(root, seed, f"{server}/clip-generic")
    assert run_url_job(stack) == "succeeded"
    with root.cursor() as cur:
        cur.execute("SELECT state, width, height, video_codec, byte_size, source_asset_id FROM video_sources WHERE id = %s", (s["video"],))
        v = cur.fetchone()
        cur.execute("SELECT object_key FROM assets WHERE id = %s", (v["source_asset_id"],))
        key = cur.fetchone()["object_key"]
    assert (v["state"], v["width"], v["height"], v["video_codec"]) == ("INGESTED", 320, 240, "mpeg4") and v["byte_size"] > 1024 * 1024
    assert key.endswith("/source.mp4")                                 # extension from the content, not from the link


@pytest.mark.parametrize("path,state,code", [("/page", "FAILED", "NOT_A_MEDIA_FILE"), ("/garbage.mp4", "QUARANTINED", "NOT_A_VIDEO")])
def test_imports_that_are_not_videos_are_refused_with_the_reason(stack, root, seed, server, path, state, code):
    s = seed_import(root, seed, server + path)
    assert run_url_job(stack) == "succeeded"
    with root.cursor() as cur:
        cur.execute("SELECT state, failure_code FROM video_sources WHERE id = %s", (s["video"],))
        assert cur.fetchone() == {"state": state, "failure_code": code}


def test_the_real_guard_refuses_the_local_server(stack, root, seed, server):
    """Without the test allowance the very same job is refused: loopback is never reachable."""
    s = seed_import(root, seed, f"{server}/clip.mp4")
    assert JobRunner(stack["dsn"], "test-worker", ["INGEST_URL"]).run_one({"INGEST_URL": handle_ingest_url}) == "succeeded"
    with root.cursor() as cur:
        cur.execute("SELECT state, failure_code FROM video_sources WHERE id = %s", (s["video"],))
        assert cur.fetchone() == {"state": "FAILED", "failure_code": "BLOCKED_DESTINATION"}
