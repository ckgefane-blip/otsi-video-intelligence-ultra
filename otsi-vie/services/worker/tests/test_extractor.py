"""Video-page link import (ADR-145): the extractor wrapper around yt-dlp, with yt-dlp stood in so the tests run offline. What is checked:
one video per link (never a playlist), live streams refused, no sign-in or cookies configured, the size cap passed on, yt-dlp's errors
turned into our failure codes (DRM, private, sign-in, removed, unsupported), and network trouble raised as OSError so the job retries."""
from __future__ import annotations

from pathlib import Path

import pytest

from vie_worker import extractor
from vie_worker.jobs import JobError


class FakeYDL:
    """records the options it was given and behaves like yt_dlp.YoutubeDL.extract_info(download=True)"""
    seen: dict = {}

    def __init__(self, opts):
        FakeYDL.seen = opts
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url, download):
        assert download is True
        behaviour = FakeYDL.behaviour
        if isinstance(behaviour, Exception):
            raise behaviour
        info = dict(behaviour)
        if self.opts["match_filter"](info, incomplete=False):
            return None
        out = Path(self.opts["outtmpl"].replace("%(ext)s", "mp4"))
        out.write_bytes(b"\x00" * info.pop("_size", 1000))
        for hook in self.opts["progress_hooks"]:
            hook({"status": "downloading", "downloaded_bytes": 1000, "total_bytes": 1000})
        return info


def run(tmp_path, behaviour, max_bytes=10_000, ffmpeg_dir="C:/ffmpeg/bin"):
    FakeYDL.behaviour = behaviour
    progress = []
    r = extractor.extract("https://www.youtube.com/watch?v=abc", tmp_path, max_bytes, lambda n, t: progress.append((n, t)),
                          ffmpeg_dir=ffmpeg_dir, ydl_factory=FakeYDL)
    return r, progress


def test_one_video_is_saved_with_its_title_author_and_page(tmp_path):
    r, progress = run(tmp_path, {"title": "Cup final", "uploader": "Club TV", "webpage_url": "https://www.youtube.com/watch?v=abc", "extractor_key": "Youtube"})
    assert r["path"] == tmp_path / "extracted.mp4" and r["bytes"] == 1000
    assert (r["title"], r["author"], r["source_page"], r["provider_key"]) == ("Cup final", "Club TV", "https://www.youtube.com/watch?v=abc", "Youtube")
    assert progress == [(1000, 1000)]


def test_the_options_never_sign_in_never_take_a_playlist_and_cap_the_size(tmp_path):
    run(tmp_path, {"title": "x"})
    o = FakeYDL.seen
    assert o["noplaylist"] is True and o["playlist_items"] == "1"
    assert o["max_filesize"] == 10_000
    assert not any(k in o for k in ("cookiefile", "cookiesfrombrowser", "username", "password", "usenetrc"))
    assert o["cachedir"] is False and o["outtmpl"].startswith(str(tmp_path))
    assert o["ffmpeg_location"] == "C:/ffmpeg/bin" and "+ba" in o["format"]


def test_without_ffmpeg_a_single_file_format_is_taken(tmp_path):
    run(tmp_path, {"title": "x"}, ffmpeg_dir=None)
    assert "ffmpeg_location" not in FakeYDL.seen and "+" not in FakeYDL.seen["format"] and FakeYDL.seen["format"].endswith("/bv*")


def test_a_live_stream_is_refused(tmp_path):
    with pytest.raises(JobError) as e:
        run(tmp_path, {"title": "x", "is_live": True})
    assert e.value.code == "LIVE_STREAM"


def test_a_file_over_the_limit_is_refused(tmp_path):
    with pytest.raises(JobError) as e:
        run(tmp_path, {"title": "x", "_size": 20_000})
    assert e.value.code == "FILE_TOO_LARGE"


@pytest.mark.parametrize("message,code", [
    ("ERROR: [youtube] abc: This video is DRM protected", "ENCRYPTED_STREAM"),
    ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "NOT_DOWNLOADABLE"),
    ("ERROR: [vk] 1_2: This video is only available for registered users. Use --cookies; login required", "NOT_DOWNLOADABLE"),
    ("ERROR: [youtube] abc: Join this channel to get access to members-only content", "NOT_DOWNLOADABLE"),
    ("ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader", "NOT_FOUND"),
    ("ERROR: Unsupported URL: https://example.com/page", "UNSUPPORTED_LINK"),
    ("ERROR: [youtube] abc: Requested format is not available", "EXTRACT_FAILED"),
])
def test_yt_dlp_errors_become_our_failure_codes(tmp_path, message, code):
    with pytest.raises(JobError) as e:
        run(tmp_path, JobError("RAW", message))        # FakeYDL raises; with the fake, every exception counts as a download error
    assert e.value.code == code


@pytest.mark.parametrize("message", ["ERROR: Unable to download webpage: <urlopen error timed out>", "ERROR: HTTP Error 503: Service Unavailable",
                                     "ERROR: HTTP Error 429: Too Many Requests"])
def test_network_trouble_is_retried(tmp_path, message):
    with pytest.raises(OSError):
        run(tmp_path, JobError("RAW", message))


def test_without_yt_dlp_installed_the_job_says_so(monkeypatch, tmp_path):
    import builtins
    real = builtins.__import__
    monkeypatch.setattr(builtins, "__import__", lambda name, *a, **k: (_ for _ in ()).throw(ImportError(name)) if name == "yt_dlp" else real(name, *a, **k))
    with pytest.raises(JobError) as e:
        extractor.extract("https://vk.com/video-1_2", tmp_path, 1000, lambda n, t: None)
    assert e.value.code == "EXTRACTOR_MISSING"
