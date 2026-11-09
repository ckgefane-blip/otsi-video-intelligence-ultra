"""LIVE checks of the link-import adapters against the real services, through the real SSRF guard (public internet). Opt-in:
OTSI_VIE_LIVE_TESTS=1. They prove the official methods work today; they do not prove rights — a provider's licence field is the uploader's
declaration and is recorded as such."""
from __future__ import annotations

import os

import pytest

from vie_worker.fetch import Guard, download
from vie_worker.ingest import sniff
from vie_worker.jobs import JobError
from vie_worker.providers import resolve

pytestmark = pytest.mark.skipif(os.environ.get("OTSI_VIE_LIVE_TESTS") != "1", reason="live internet tests are opt-in (OTSI_VIE_LIVE_TESTS=1)")
GUARD = Guard()


def test_live_wikimedia_commons_file_page(tmp_path):
    r = resolve("https://commons.wikimedia.org/wiki/File:AFN_Naples_News_-_NSA_Naples_Soccer_Game_(1005987).webm", token=None, guard=GUARD)
    assert r.provider == "wikimedia" and r.download_url.startswith("https://upload.wikimedia.org/") and r.license == "Public domain"
    got = download(r.download_url, str(tmp_path / "v.bin"), 64 * 1024 ** 2, lambda n, t: None)
    assert got["bytes"] > 10 * 1024 ** 2 and sniff(tmp_path / "v.bin") == "matroska/webm"


def test_live_internet_archive_item(tmp_path):
    r = resolve("https://archive.org/details/2a-00a-30ab-7f-8e-9b-0cecddeeeb-5d-54d-21", token=None, guard=GUARD)
    assert r.provider == "archive_org" and r.download_url.startswith("https://archive.org/download/") and r.license
    got = download(r.download_url, str(tmp_path / "v.bin"), 64 * 1024 ** 2, lambda n, t: None)
    assert got["bytes"] > 10_000 and sniff(tmp_path / "v.bin") is not None


def test_live_youtube_is_refused_without_contacting_it():
    with pytest.raises(JobError) as e:
        resolve("https://www.youtube.com/watch?v=dQw4w9WgXcQ", token=None, guard=GUARD)
    assert e.value.code == "UNSUPPORTED_PROVIDER"
