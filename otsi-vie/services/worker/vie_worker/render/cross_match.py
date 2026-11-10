"""Cross-match multi-source render planning (ADR-131 Build B).

Pure helpers for rendering a reel whose clips come from several videos.
No database, storage, FFmpeg or model access here, so these are unit-testable
without MySQL, a GPU or footage (the direct runner in
~/workspace/cross-match-render-runner/).

The rules these encode:

* anchor video — the FIRST clip's video sets the output geometry and frame
  rate (width / height / fps / frame_us). Every clip is decoded from its own
  source file at the anchor geometry; the compositor already normalises every
  frame to the output size, so a source of a different aspect is scaled to the
  anchor frame (mixed-aspect reels are not expected — all match footage is
  16:9 — and a different aspect is a known limitation, not a silent crop).
  Where videos differ in fps, frame timing follows the anchor fps and the
  existing per-clip plan (output_plan / decode_sampled by pts).
* match card — a cross-match reel has no single match, so there is no match
  card (card_n = 0), however the snapshot's settings read. The Player Profile
  Intro (first) and the per-clip event tags carry the identity and the
  match + minute + reason.
* detector config — per clip video, from that video's latest SUCCEEDED
  pipeline run; a video with no run falls back to the existing defaults
  (detector default, tiles 2, score_floor 0.2) and the render never fails for
  a missing run config. Which source was used is recorded per clip in the
  manifest ("run" or "defaults").
* manifest — a cross-match render records source "ALL_MATCHES", the rule
  version and length, every distinct source video in clip order, and each
  clip's source_video_id; the single video_id field is null. A single-match
  render's manifest is unchanged apart from the additive fields.
"""
from __future__ import annotations

# The detector defaults handle_render has always used when a video's run has
# no config (reel.py: load_detector(run_cfg.get("detector"), tiles=..., ...)).
DEFAULT_DETECTOR_TILES = 2
DEFAULT_DETECTOR_SCORE_FLOOR = 0.2


def anchor_video_id(clips: list[dict]) -> str | None:
    """The video that sets the output geometry and frame rate: the first clip's."""
    if not clips:
        return None
    return clips[0].get("source_video_id") or None


def distinct_video_ids_in_clip_order(clips: list[dict]) -> list[str]:
    """Every distinct source video, in the order its first clip appears."""
    seen: list[str] = []
    for c in clips:
        vid = c.get("source_video_id")
        if vid and vid not in seen:
            seen.append(vid)
    return seen


def group_clips_by_video(clips: list[dict]) -> list[tuple[str, list[dict]]]:
    """The clips grouped by their source video, groups in first-appearance order."""
    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for c in clips:
        vid = c.get("source_video_id")
        if not vid:
            continue
        if vid not in groups:
            groups[vid] = []
            order.append(vid)
        groups[vid].append(c)
    return [(vid, groups[vid]) for vid in order]


def plan_clip_sources(clips: list[dict], object_keys: dict[str, str | None]) -> tuple[list[dict], list[str]]:
    """Resolve every clip to its source file.

    `object_keys` maps video_id -> the source asset's object_key (None when the
    video has no source asset). Returns (plan, missing): the plan is one entry
    per clip, {clip_id, source_video_id, object_key}; missing is the clip ids
    whose video is unknown, has no source asset, or whose clip carries no
    source_video_id at all (an old snapshot, or a cross-match clip that was
    never given one — the render refuses those with CLIP_SOURCE_MISSING,
    never a silent wrong render).
    """
    plan: list[dict] = []
    missing: list[str] = []
    for c in clips:
        vid = c.get("source_video_id")
        key = object_keys.get(vid) if vid else None
        if not vid or not key:
            missing.append(c.get("id", "?"))
            continue
        plan.append({"clip_id": c.get("id"), "source_video_id": vid, "object_key": key})
    return plan, missing


def show_match_card(is_cross_match: bool, match_card: bool) -> bool:
    """Whether the match card is drawn. A cross-match reel has no single match
    to put on a card, so it never gets one — even when the snapshot's settings
    ask for a match card (the overlay would have no home / away to show)."""
    return False if is_cross_match else bool(match_card)


def cross_match_manifest_fields(is_cross_match: bool, video_ids: list[str], length_s: int | None, version: str | None) -> dict:
    """The manifest's cross-match fields. A single-match render gains none of
    these — its manifest shape is unchanged."""
    if not is_cross_match:
        return {}
    return {
        "source": "ALL_MATCHES",
        "best_moments_rule": {"version": version, "length_s": length_s},
        "video_ids": list(video_ids),
    }


def detector_config_for_run(run_config: dict | None) -> tuple[str | None, int, float, str]:
    """(detector key, tiles, score_floor, provenance) for one video's latest
    SUCCEEDED pipeline run. No run (or no config on it) falls back to the
    existing defaults and says so — the render never fails for a missing run
    config."""
    if not run_config:
        return None, DEFAULT_DETECTOR_TILES, DEFAULT_DETECTOR_SCORE_FLOOR, "defaults"
    return (run_config.get("detector"),
            int(run_config.get("tiles", DEFAULT_DETECTOR_TILES)),
            float(run_config.get("score_floor", DEFAULT_DETECTOR_SCORE_FLOOR)),
            "run")
