"""Render QC validation unit tests (v3 C.6, ADR-106).
Tests loudness measurement, black frame detection, and QC report generation.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from vie_worker.render.validate import detect_black_frames, measure_loudness_qc, validate


def test_detect_black_frames_parses_ffmpeg_output():
    mock_stderr = (
        b"[blackdetect @ 0x12345] black_start:1.200 black_end:2.600 black_duration:1.400\n"
        b"[blackdetect @ 0x12345] black_start:5.000 black_end:5.500 black_duration:0.500\n"
    )
    with patch("vie_worker.ff.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stderr=mock_stderr)
        spans = detect_black_frames("/fake/path.mp4")

        assert len(spans) == 2
        assert spans[0] == {"start_s": 1.2, "end_s": 2.6, "duration_s": 1.4}
        assert spans[1] == {"start_s": 5.0, "end_s": 5.5, "duration_s": 0.5}


def test_measure_loudness_qc_parses_ffmpeg_output():
    mock_stderr = (
        b"[Parsed_ebur128_0 @ 0x12345] Summary:\n"
        b"  Integrated loudness:\n"
        b"    I:         -14.2 LUFS\n"
        b"    Threshold: -24.2 LUFS\n\n"
        b"  True peak:\n"
        b"    Peak:        -1.1 dBFS\n"
    )
    with patch("vie_worker.ff.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stderr=mock_stderr)
        qc = measure_loudness_qc("/fake/path.mp4")

        assert qc["measured_lufs"] == -14.2
        assert qc["true_peak_db"] == -1.1


def test_validate_integrates_qc_checks():
    mock_info = {
        "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "10.0"},
        "streams": [
            {
                "codec_type": "video",
                "codec_name": "h264",
                "profile": "High",
                "pix_fmt": "yuv420p",
                "width": 1920,
                "height": 1080,
                "nb_read_frames": "300",
                "duration": "10.0",
            },
            {
                "codec_type": "audio",
                "codec_name": "aac",
                "duration": "10.0",
            },
        ],
    }

    with (
        patch("vie_worker.ff.ffprobe_json", return_value=mock_info),
        patch("vie_worker.render.validate._top_level_atoms", return_value=["moov", "mdat"]),
        patch("vie_worker.ff.run", return_value=MagicMock(returncode=0, stderr=b"")),
        patch("vie_worker.render.validate.measure_loudness_qc", return_value={"measured_lufs": -14.0, "true_peak_db": -1.0}),
        patch("vie_worker.render.validate.detect_black_frames", return_value=[]),
        patch("os.path.getsize", return_value=1024 * 1024),
    ):
        report = validate("/fake/render.mp4", codec="h264", width=1920, height=1080, frames=300, fps=30.0, audio=True, target_lufs=-14.0)

        assert report["ok"] is True
        assert "qc" in report
        assert report["qc"]["loudness"]["measured_lufs"] == -14.0
        assert report["qc"]["loudness"]["compliant"] is True
        assert report["qc"]["black_frames"]["unintended_black"] is False
