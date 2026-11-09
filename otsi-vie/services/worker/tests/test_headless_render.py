"""Headless render unit tests (v3 Phase C.8, ADR-107).
Tests manifest resolution, plan computation, dry-run, validate-only, and CLI batch execution.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from vie_worker.render.cli import main as cli_main
from vie_worker.render.headless import render_manifest, resolve_manifest


def test_resolve_manifest_normalizes_simple_manifest(tmp_path: Path):
    video_file = tmp_path / "match.mp4"
    video_file.write_bytes(b"fake video")

    manifest = {
        "source": str(video_file),
        "aspect": "9:16",
        "codec": "h264",
        "bitrate_mbps": 8.0,
        "clips": [
            {"in_s": 1.0, "out_s": 4.5, "label": "Tackle"},
            {"in_pts_us": 10_000_000, "out_pts_us": 14_000_000, "gap_s": 0.5, "label": "Goal"},
        ],
        "audio": {"lufs": -14.0, "true_peak_db": -1.5},
    }

    plan = resolve_manifest(manifest, base_dir=tmp_path)

    assert plan["source"] == str(video_file.resolve())
    assert plan["aspect"] == "9:16"
    assert plan["codec"] == "h264"
    assert len(plan["clips"]) == 2

    # Check clip timestamp conversions
    c0 = plan["clips"][0]
    assert c0["in_pts_us"] == 1_000_000
    assert c0["out_pts_us"] == 4_500_000

    c1 = plan["clips"][1]
    assert c1["in_pts_us"] == 10_000_000
    assert c1["out_pts_us"] == 14_000_000
    assert c1["gap_us"] == 500_000


def test_resolve_manifest_raises_on_empty_clips(tmp_path: Path):
    with pytest.raises(ValueError, match="no clips to render"):
        resolve_manifest({"clips": []}, base_dir=tmp_path)


def test_render_manifest_dry_run(tmp_path: Path):
    video_file = tmp_path / "source.mp4"
    video_file.write_bytes(b"fake video")

    manifest_data = {
        "source": str(video_file),
        "aspect": "16:9",
        "fps": 30.0,
        "clips": [
            {"in_s": 0.0, "out_s": 5.0},
            {"in_s": 10.0, "out_s": 15.0, "gap_s": 1.0},
        ],
    }
    m_file = tmp_path / "reel.manifest.json"
    m_file.write_text(json.dumps(manifest_data), encoding="utf-8")

    mock_probe = {
        "streams": [
            {
                "codec_type": "video",
                "width": 1920,
                "height": 1080,
                "avg_frame_rate": "30/1",
                "duration": "30.0",
            }
        ],
        "format": {"duration": "30.0"},
    }

    with patch("vie_worker.ff.ffprobe_json", return_value=mock_probe):
        res = render_manifest(m_file, dry_run=True)

        assert res["ok"] is True
        assert res["dry_run"] is True
        # 5s + 5s + 1s gap = 11s * 30 fps = 330 frames
        assert res["frames"] == 330
        assert res["duration_s"] == 11.0
        assert res["width"] == 1920
        assert res["height"] == 1080


def test_render_manifest_validate_only(tmp_path: Path):
    rendered_file = tmp_path / "reel_rendered.mp4"
    rendered_file.write_bytes(b"fake rendered video")

    m_file = tmp_path / "reel.manifest.json"
    m_file.write_text(
        json.dumps({
            "source": str(tmp_path / "src.mp4"),
            "clips": [{"in_s": 0.0, "out_s": 2.0}],
            "audio": {"lufs": -14.0},
        }),
        encoding="utf-8",
    )

    mock_probe_json = {
        "streams": [
            {"codec_type": "video", "width": 1920, "height": 1080},
            {"codec_type": "audio", "duration": "2.0"},
        ],
    }

    mock_val = {
        "ok": True,
        "failures": [],
        "qc": {
            "loudness": {"measured_lufs": -14.1, "compliant": True},
            "black_frames": {"unintended_black": False},
        },
    }

    with (
        patch("vie_worker.ff.ffprobe_json", return_value=mock_probe_json),
        patch("vie_worker.render.headless.validate", return_value=mock_val),
    ):
        res = render_manifest(m_file, output_path=rendered_file, validate_only=True)

        assert res["ok"] is True
        assert res["validation"]["qc"]["loudness"]["measured_lufs"] == -14.1


def test_cli_batch_and_json(tmp_path: Path, capsys):
    m1 = tmp_path / "reel1.manifest.json"
    m2 = tmp_path / "reel2.manifest.json"

    for m in (m1, m2):
        m.write_text(
            json.dumps({"source": "fake.mp4", "clips": [{"in_s": 0.0, "out_s": 1.0}]}),
            encoding="utf-8",
        )

    mock_res = {
        "ok": True,
        "dry_run": True,
        "frames": 30,
        "duration_s": 1.0,
        "width": 1920,
        "height": 1080,
    }

    with patch("vie_worker.render.cli.render_manifest", return_value=mock_res):
        code = cli_main([str(m1), str(m2), "--dry-run", "--json"])
        assert code == 0

        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert isinstance(data, list)
        assert len(data) == 2
        assert data[0]["frames"] == 30
