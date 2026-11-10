"""Cross-match multi-source render planning (ADR-131 Build B).

Pure-function tests for vie_worker.render.cross_match plus the _audio wiring in
vie_worker.render.reel (the per-clip audio join). No database, GPU, OpenVINO,
weights or footage: run with the direct runner in
~/workspace/cross-match-render-runner/ (pytest cannot run here — conftest.py
needs .local/mysql-lint.env + MySQL 3507 on the owner's host; never fabricated).
A live multi-source render cannot run here either — that needs the owner's host.
"""
from __future__ import annotations

from fractions import Fraction
import tempfile
from pathlib import Path

from vie_worker.render import cross_match as cm


def _clip(cid: str, video: str | None, inn: int = 0, out: int = 4_000_000) -> dict:
    c: dict = {"id": cid, "in_pts_us": inn, "out_pts_us": out}
    if video is not None:
        c["source_video_id"] = video
    return c


def test_anchor_is_the_first_clips_video():
    clips = [_clip("c1", "v1"), _clip("c2", "v2"), _clip("c3", "v1")]
    assert cm.anchor_video_id(clips) == "v1"
    assert cm.anchor_video_id([]) is None
    assert cm.anchor_video_id([{"id": "c1"}]) is None


def test_distinct_videos_in_clip_order():
    clips = [_clip("c1", "v2"), _clip("c2", "v1"), _clip("c3", "v2"), _clip("c4", "v3")]
    assert cm.distinct_video_ids_in_clip_order(clips) == ["v2", "v1", "v3"]
    assert cm.distinct_video_ids_in_clip_order([]) == []


def test_group_clips_by_video_keeps_clip_order():
    clips = [_clip("c1", "v1", 0, 4_000_000), _clip("c2", "v2", 0, 4_000_000),
             _clip("c3", "v1", 8_000_000, 12_000_000), _clip("c4", "v2", 8_000_000, 12_000_000)]
    groups = cm.group_clips_by_video(clips)
    assert [v for v, _ in groups] == ["v1", "v2"]
    assert [c["id"] for _, cs in groups for c in cs] == ["c1", "c3", "c2", "c4"]
    assert cm.group_clips_by_video([{"id": "c1"}]) == []  # no source video: no group


def test_plan_clip_sources_resolves_every_clip():
    clips = [_clip("c1", "v1"), _clip("c2", "v2"), _clip("c3", "v1")]
    plan, missing = cm.plan_clip_sources(clips, {"v1": "org/o/videos/v1/source.mp4", "v2": "org/o/videos/v2/source.mp4"})
    assert missing == []
    assert plan == [
        {"clip_id": "c1", "source_video_id": "v1", "object_key": "org/o/videos/v1/source.mp4"},
        {"clip_id": "c2", "source_video_id": "v2", "object_key": "org/o/videos/v2/source.mp4"},
        {"clip_id": "c3", "source_video_id": "v1", "object_key": "org/o/videos/v1/source.mp4"},
    ]


def test_plan_clip_sources_names_the_missing_ones():
    clips = [_clip("c1", "v1"), _clip("c2", "v2"), _clip("c3", "v3"), _clip("c4", None)]
    plan, missing = cm.plan_clip_sources(clips, {"v1": "k1", "v2": None})
    assert [p["clip_id"] for p in plan] == ["c1"]
    # v2 has no source asset, v3 is unknown, c4 carries no source video at all
    assert missing == ["c2", "c3", "c4"]


def test_match_card_is_skipped_for_cross_match_reels():
    assert cm.show_match_card(True, True) is False
    assert cm.show_match_card(True, False) is False
    assert cm.show_match_card(False, True) is True
    assert cm.show_match_card(False, False) is False


def test_manifest_fields_only_for_cross_match():
    fields = cm.cross_match_manifest_fields(True, ["v1", "v2", "v1"], 180, "2.1")
    assert fields == {"source": "ALL_MATCHES", "best_moments_rule": {"version": "2.1", "length_s": 180},
                      "video_ids": ["v1", "v2", "v1"]}
    assert cm.cross_match_manifest_fields(False, ["v1"], None, None) == {}


def test_detector_config_falls_back_to_defaults_without_a_run():
    assert cm.detector_config_for_run(None) == (None, 2, 0.2, "defaults")
    assert cm.detector_config_for_run({}) == (None, 2, 0.2, "defaults")
    assert cm.detector_config_for_run({"detector": "rtdetr", "tiles": 3, "score_floor": 0.35}) == ("rtdetr", 3, 0.35, "run")
    # a partial run config fills the missing keys from the defaults, never fails
    assert cm.detector_config_for_run({"detector": "rtdetr"}) == ("rtdetr", 2, 0.2, "run")


# ------------------------------------------------------------------ _audio wiring

class _FakeFF:
    """ffprobe says every source has an audio stream; ff.run records its inputs and writes the output file."""

    def __init__(self, work: Path, audio: bool = True):
        self.work = work
        self.audio = audio
        self.runs: list[list[str]] = []

    def ffprobe_json(self, path: str, *args: str) -> dict:
        return {"streams": [{"codec_type": "audio"}]} if self.audio else {"streams": [{"codec_type": "video"}]}

    def run(self, args: list[str], timeout: int = 0):
        self.runs.append(list(args))
        (self.work / "audio.wav").write_bytes(b"wav")
        return type("R", (), {"returncode": 0})()


def _patched_audio(monkey, work: Path, audio: bool = True):
    from vie_worker.render import reel
    fake = _FakeFF(work, audio)
    orig = reel.ff
    reel.ff = fake  # type: ignore[assignment]
    return reel, fake, orig


def test_audio_join_takes_each_clips_own_source():
    # the direct runner calls test functions with no arguments (no pytest fixtures here), so the temp dir is made inline
    from vie_worker.render import reel
    with tempfile.TemporaryDirectory() as d:
        tmp_path = Path(d)
        clips = [_clip("c1", "v1", 0, 4_000_000), _clip("c2", "v2", 0, 4_000_000)]
        fake_reel, fake, orig = _patched_audio(None, tmp_path)
        try:
            out = reel._audio_for_clips([("/store/v1.mp4", 0.5), ("/store/v2.mp4", 1.25)], clips, tmp_path, 0.0, Fraction(25))
        finally:
            reel.ff = orig
        assert out == str(tmp_path / "audio.wav")
    assert len(fake.runs) == 1
    args = fake.runs[0]
    assert args.count("-i") == 2
    assert args[args.index("-i") + 1] == "/store/v1.mp4" and args[args.index("-i", args.index("-i") + 1) + 1] == "/store/v2.mp4"
    graph = args[args.index("-filter_complex") + 1]
    assert "[0:a:0]atrim=start=0.500000" in graph  # clip 1: its own file, its own first-frame time
    assert "[1:a:0]atrim=start=1.250000" in graph  # clip 2: the other file, the other first-frame time


def test_audio_single_source_builds_the_old_single_input_graph():
    from vie_worker.render import reel
    with tempfile.TemporaryDirectory() as d:
        tmp_path = Path(d)
        clips = [_clip("c1", "v1", 0, 4_000_000), _clip("c2", "v1", 4_000_000, 8_000_000)]
        fake_reel, fake, orig = _patched_audio(None, tmp_path)
        try:
            out = reel._audio("/store/v1.mp4", clips, 0.5, tmp_path, 0.0, Fraction(25))
        finally:
            reel.ff = orig
        assert out == str(tmp_path / "audio.wav")
    args = fake.runs[0]
    assert args.count("-i") == 1  # one input, as before — _audio is the single-source entry point
    graph = args[args.index("-filter_complex") + 1]
    assert "[0:a:0]atrim=start=0.500000" in graph and "[0:a:0]atrim=start=4.500000" in graph


def test_audio_is_none_when_no_clip_has_sound():
    from vie_worker.render import reel
    with tempfile.TemporaryDirectory() as d:
        tmp_path = Path(d)
        clips = [_clip("c1", "v1", 0, 4_000_000)]
        fake_reel, fake, orig = _patched_audio(None, tmp_path, audio=False)
        try:
            assert reel._audio_for_clips([("/store/v1.mp4", 0.0)], clips, tmp_path, 0.0, Fraction(25)) is None
        finally:
            reel.ff = orig
        assert fake.runs == []
