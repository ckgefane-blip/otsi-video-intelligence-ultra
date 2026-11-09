"""RENDER on REAL football footage (Block 11, ADR-032): a confirmed player's reel becomes a validated MP4 with the spotlight; the spotlight
follows only detected / interpolated positions, a stale reel is refused, and everything is recorded (asset, manifest, result).
Footage: CC BY-SA 4.0 France–Germany clip (.local/eval-footage). Skipped where the footage or verified weights are absent."""
from __future__ import annotations

import json
import uuid
from fractions import Fraction
from pathlib import Path

from test_analyze import FOOTAGE, ingest, needs_real, run_all, start_analysis

from vie_worker import ff


def make_reel(root, s, clip_in_us: int, clip_out_us: int, settings: dict | None = None, overlay: dict | None = None, extra: dict | None = None,
              label: str | None = None) -> dict:
    """A reel as the API builds it: the longest PERSON track confirmed for a new provisional player, its decision pinned, one clip."""
    with root.cursor() as cur:
        cur.execute("SELECT created_by, project_id FROM video_sources WHERE id = %s", (s["video"],))
        v = cur.fetchone()
        cur.execute("SELECT id FROM pipeline_runs WHERE video_id = %s AND status = 'SUCCEEDED'", (s["video"],))
        run = cur.fetchone()["id"]
        cur.execute("""SELECT id, first_pts_us, last_pts_us FROM tracks WHERE run_id = %s AND class_name = 'PERSON'
                        ORDER BY observation_count DESC, first_pts_us LIMIT 1""", (run,))
        track = cur.fetchone()
        player, decision, reel, clip, render = (str(uuid.uuid4()) for _ in range(5))
        cur.execute("INSERT INTO players (id, display_name, canonical_state, created_by_organization_id) VALUES (%s, 'Test Player', 'PROVISIONAL', %s)", (player, s["org"]))
        cur.execute("INSERT INTO track_identity_decisions (id, track_id, player_id, state, decided_by, basis) VALUES (%s, %s, %s, 'CONFIRMED', %s, 'HUMAN')",
                    (decision, track["id"], player, v["created_by"]))
        cur.execute("INSERT INTO reel_projects (id, organization_id, project_id, video_id, player_id, run_id, name, created_by, settings) VALUES (%s, %s, %s, %s, %s, %s, 'R', %s, %s)",
                    (reel, s["org"], v["project_id"], s["video"], player, run, v["created_by"], json.dumps({"dim": 0.6, "ring": True, "name_caption": True})))
        cur.execute("INSERT INTO reel_targets (reel_id, track_id, player_id, identity_decision_id) VALUES (%s, %s, %s, %s)", (reel, track["id"], player, decision))
        a = max(0, min(clip_in_us, track["first_pts_us"]))
        b = clip_out_us
        cur.execute("INSERT INTO reel_clips (id, reel_id, source_video_id, in_pts_us, out_pts_us, sequence_index, origin, label) VALUES (%s, %s, %s, %s, %s, 0, 'SUGGESTED', %s)",
                    (clip, reel, s["video"], a, b, label))
        cfg = {"codec": "h264", "bitrate_mbps": 6, "reel_version": 1, "aspect": "16:9", "settings": settings or {"dim": 0.6, "ring": True, "name_caption": True},
               **({"overlay": overlay} if overlay else {}), **(extra or {}),
               "clips": [{"id": clip, "in_pts_us": a, "out_pts_us": b, "label": label}]}
        cur.execute("INSERT INTO render_jobs (id, reel_id, organization_id, requested_by, config, idempotency_key) VALUES (%s, %s, %s, %s, %s, %s)",
                    (render, reel, s["org"], v["created_by"], json.dumps(cfg), f"k-{render}"))
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (UUID(), %s, 'RENDER', 'render_job', %s, %s, %s)",
                    (s["org"], render, f"render:{render}", json.dumps({"render_id": render, "reel_id": reel})))
    return {"reel": reel, "render": render, "track": track, "decision": decision, "player": player, "in": a, "out": b, "user": v["created_by"]}


@needs_real
def test_a_confirmed_players_reel_renders_to_a_valid_mp4_with_the_spotlight(stack, root, seed):
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    r = make_reel(root, s, 0, 6_000_000)
    assert run_all(stack, ["RENDER"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("""SELECT j.state, j.result, j.failure_code, j.failure_detail, o.object_key, o.mime_type, o.sha256, m.object_key AS mkey, p.status
                         FROM render_jobs j LEFT JOIN assets o ON o.id = j.output_asset_id LEFT JOIN assets m ON m.id = j.manifest_asset_id
                         JOIN reel_projects p ON p.id = j.reel_id WHERE j.id = %s""", (r["render"],))
        j = cur.fetchone()
        cur.execute("SELECT COUNT(*) AS n FROM reel_manifest_versions WHERE reel_project_id = %s", (r["reel"],))
        versions = cur.fetchone()["n"]
    assert j["state"] == "SUCCEEDED", (j["failure_code"], j["failure_detail"])
    result = json.loads(j["result"])
    out = Path(stack["storage"], *j["object_key"].split("/"))
    info = ff.ffprobe_json(str(out), "-show_streams", "-show_format", "-count_frames")
    v = ff.main_video(info)
    assert j["mime_type"] == "video/mp4" and v["codec_name"] == "h264" and v["pix_fmt"] in ("yuv420p", "nv12")
    assert int(v["nb_read_frames"]) == result["frames"] and abs(result["duration_s"] - 6.0) < 0.2       # every source frame of the clip
    assert result["validation_ok"] and result["width"] == 1920 and result["height"] == 1080
    sf = result["spotlight_frames"]
    assert sf["DETECTED"] + sf["INTERPOLATED"] + sf["MISSING"] == result["frames"] and sf["DETECTED"] > 0      # follows real detections
    manifest = json.loads(Path(stack["storage"], *j["mkey"].split("/")).read_text(encoding="utf-8"))
    assert manifest["pinned_identity_decisions"] == [r["decision"]] and manifest["output"]["validation"]["ok"]
    assert manifest["clips"][0]["anchors"] >= 1 and "Development" in manifest["notice"]
    assert j["status"] == "READY" and versions == 1
    import os
    import shutil
    if os.environ.get("OTSI_TEST_KEEP_RENDER"):                  # for a person to look at the result
        shutil.copy(out, os.environ["OTSI_TEST_KEEP_RENDER"])


@needs_real
def test_every_overlay_and_branding_switch_renders_into_a_valid_mp4_with_an_end_screen(stack, root, seed):
    """ADR-044: vignette, score / time, competition and custom logo, lower third, watermark, end screen, strict target lock, Auto Track off."""
    from PIL import Image
    from vie_worker.render.overlays import END_S
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    key = f"org/{s['org']}/brand/test-logo.png"
    logo = Path(stack["storage"], *key.split("/"))
    logo.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (300, 150), (255, 0, 0, 255)).save(logo)
    settings = {"dim": 0.6, "ring": True, "name_caption": True, "vignette": 0.6, "lock": 0.1, "auto_track": False, "score_bug": True, "lower_third": True,
                "watermark": True, "end_screen": True, "competition_logo_id": str(uuid.uuid4()), "custom_logo_id": str(uuid.uuid4())}
    overlay = {"title": "Test Player - highlights", "home": "Франция", "away": "Deutschland", "competition": None, "player_club": "Test Club",
               "periods": {"first": [0, 2_700_000_000], "second": None}, "competition_logo_key": key, "custom_logo_key": key}
    r = make_reel(root, s, 0, 6_000_000, settings, overlay)
    assert run_all(stack, ["RENDER"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT j.state, j.result, j.failure_code, j.failure_detail, o.object_key, m.object_key AS mkey FROM render_jobs j LEFT JOIN assets o ON o.id = j.output_asset_id "
                    "LEFT JOIN assets m ON m.id = j.manifest_asset_id WHERE j.id = %s", (r["render"],))
        j = cur.fetchone()
    assert j["state"] == "SUCCEEDED", (j["failure_code"], j["failure_detail"])
    result = json.loads(j["result"])
    out = Path(stack["storage"], *j["object_key"].split("/"))
    info = ff.ffprobe_json(str(out), "-show_streams", "-show_format", "-count_frames")
    v = ff.main_video(info)
    fps = ff.rate(v.get("avg_frame_rate"))
    assert int(v["nb_read_frames"]) == result["frames"] and abs(result["duration_s"] - (6.0 + END_S)) < 0.25    # the clip, then the end screen
    assert result["validation_ok"]
    if result["audio"]:
        a = next(x for x in info["streams"] if x["codec_type"] == "audio")
        assert abs(float(a["duration"]) - result["frames"] / float(fps)) < 0.15                                   # silence under the end screen
    manifest = json.loads(Path(stack["storage"], *j["mkey"].split("/")).read_text(encoding="utf-8"))
    assert manifest["overlays"] | {"facts": None} == {"vignette": True, "score_bug": True, "clock": True, "lower_third": True, "watermark": True, "competition_logo": True,
                                                      "custom_logo": True, "end_screen": True, "end_screen_s": END_S, "facts": None,
                                                      "event_tags": False, "match_card": False, "match_card_s": 0}
    assert "competition_logo_key" not in manifest["overlays"]["facts"]
    assert manifest["rules"]["auto_track"] is False and manifest["rules"]["dense_fps"] is None and manifest["clips"][0].get("auto_track") is False
    sf = result["spotlight_frames"]
    assert sf["DETECTED"] > 0 and sf["DETECTED"] + sf["INTERPOLATED"] + sf["MISSING"] == result["frames"] - round(END_S * float(fps))
    frames = ff.decode_sampled(str(out), None, start_us=0, end_us=int(result["duration_s"] * 1e6), seek=False)
    first = next(frames).rgb
    h, w = first.shape[:2]
    red = (first[..., 0] > 200) & (first[..., 1] < 70) & (first[..., 2] < 70)
    assert red[: h // 4, w * 3 // 4:].sum() > 500 and red[h * 3 // 4:, w * 3 // 4:].sum() > 500          # both logos where the layout puts them
    import os
    import shutil
    if os.environ.get("OTSI_TEST_KEEP_RENDER"):
        shutil.copy(out, os.environ["OTSI_TEST_KEEP_RENDER"])

@needs_real
def test_a_stale_reel_is_refused_and_nothing_is_rendered(stack, root, seed):
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=1, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    r = make_reel(root, s, 0, 3_000_000)
    with root.cursor() as cur:                                   # the followed identity is corrected after the reel was built
        cur.execute("INSERT INTO track_identity_decisions (id, track_id, player_id, state, decided_by, basis, supersedes_id, reason) VALUES (UUID(), %s, NULL, 'UNRESOLVED', %s, 'HUMAN', %s, 'not sure any more')",
                    (r["track"]["id"], r["user"], r["decision"]))
    assert run_all(stack, ["RENDER"]) == ["succeeded"]            # the job ends normally; the render is refused with the reason
    with root.cursor() as cur:
        cur.execute("SELECT state, failure_code, output_asset_id FROM render_jobs WHERE id = %s", (r["render"],))
        j = cur.fetchone()
    assert j["state"] == "FAILED" and j["failure_code"] == "REEL_TARGETS_STALE" and j["output_asset_id"] is None


def test_the_spotlight_never_takes_a_point_where_the_confirmed_player_cannot_be():
    """A dense re-analysis track that slid onto a neighbour must not move the spotlight to the other man (2026-10-31)."""
    from vie_worker.render.reel import PathPoint, on_path
    h = 0.1
    anchors = [PathPoint(0, (0.30, 0.40, 0.03, h), "analysis"), PathPoint(166_667, (0.32, 0.40, 0.03, h), "analysis"),
               PathPoint(333_333, (0.34, 0.40, 0.03, h), "analysis")]
    assert on_path(PathPoint(83_333, (0.311, 0.402, 0.03, h), "dense"), anchors)            # between two confirmed positions, on the line
    assert not on_path(PathPoint(83_333, (0.40, 0.40, 0.03, h), "dense"), anchors)         # the neighbour, a body height away: rejected
    assert on_path(PathPoint(400_000, (0.35, 0.40, 0.03, h), "dense"), anchors)            # just after the last one, a running step on
    assert not on_path(PathPoint(400_000, (0.60, 0.40, 0.03, h), "dense"), anchors)        # three body heights away 70 ms later: impossible
    assert not on_path(PathPoint(0, (0.3, 0.4, 0.03, h), "dense"), [])                     # nothing confirmed: nothing to follow


def test_each_reel_frame_crops_the_full_height_to_its_shape():
    """ADR-080: 16:9 keeps the picture; 9:16, 1:1 and 4:5 crop the full source height to their shape (even widths)."""
    from vie_worker.render.reel import _output_geometry
    assert _output_geometry(1920, 1080, "16:9")[2] == 1920
    assert _output_geometry(1920, 1080, "9:16")[2] == 608
    assert _output_geometry(1920, 1080, "1:1")[2] == 1080
    ow, oh, cw = _output_geometry(1920, 1080, "4:5")
    assert cw == 864 and (ow, oh) == (864, 1080)


def test_the_beam_path_is_steady_and_keeps_up_with_a_running_player():
    """ADR-079: smoothing on both sides of each moment, no lag on a straight run, nothing outside the seen stretches, never across a cut."""
    from vie_worker.render.reel import PathPoint, smooth_path
    run = [PathPoint(i * 200_000, (0.1 + 0.04 * i + (0.01 if i % 2 else -0.01), 0.4, 0.05, 0.15), "analysis") for i in range(21)]
    s = smooth_path(run, 0.6)
    assert s[0].pts_us == 0 and s[-1].pts_us == 4_000_000
    for p in s:
        if 600_000 <= p.pts_us <= 3_400_000:
            assert abs(p.box[0] + p.box[2] / 2 - (0.125 + 0.2 * p.pts_us / 1e6)) < 0.004
    gap = run[:5] + [PathPoint(3_000_000, (0.3, 0.4, 0.05, 0.15), "analysis")]
    assert not any(800_000 < p.pts_us < 3_000_000 for p in smooth_path(gap, 0.6))
    cut = run[:2] + [PathPoint(400_000, (0.8, 0.4, 0.05, 0.15), "analysis"), PathPoint(600_000, (0.81, 0.4, 0.05, 0.15), "analysis")]
    c = smooth_path(cut, 0.6)
    assert not any(200_000 < p.pts_us < 400_000 for p in c)
    assert next(p for p in c if p.pts_us == 400_000).box[0] > 0.75


@needs_real
def test_many_short_clips_keep_picture_and_sound_the_same_length(stack, root, seed):
    """Owner 2026-11-02: two 59-clip reels failed RENDER_INVALID (15630 frames != 15649): each clip's picture ran a fraction of a frame
    longer than its sound, the encoder cut the picture to the sound. Each clip is now exactly its length in frames."""
    from vie_worker.render.reel import clip_frames
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    r = make_reel(root, s, 0, 1_000_000, settings={"dim": 0.6, "auto_track": False})
    clips = [{"id": str(uuid.uuid4()), "in_pts_us": 13_333 + i * 731_111, "out_pts_us": 13_333 + i * 731_111 + 707_407, "label": None} for i in range(12)]
    with root.cursor() as cur:
        cur.execute("UPDATE render_jobs SET config = JSON_SET(config, '$.clips', CAST(%s AS JSON)) WHERE id = %s", (json.dumps(clips), r["render"]))
    assert run_all(stack, ["RENDER"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT j.state, j.result, j.failure_code, j.failure_detail, o.object_key FROM render_jobs j LEFT JOIN assets o ON o.id = j.output_asset_id WHERE j.id = %s",
                    (r["render"],))
        j = cur.fetchone()
    assert j["state"] == "SUCCEEDED", (j["failure_code"], j["failure_detail"])
    info = ff.ffprobe_json(str(Path(stack["storage"], *j["object_key"].split("/"))), "-show_streams", "-show_format", "-count_frames")
    v = ff.main_video(info)
    fps = Fraction(v["r_frame_rate"])
    assert int(v["nb_read_frames"]) == json.loads(j["result"])["frames"] == sum(clip_frames(c, fps) for c in clips)
    a = [x for x in info["streams"] if x.get("codec_type") == "audio"]
    if a:                                                                      # the sound ends with the picture (within a frame or two)
        assert abs(float(a[0]["duration"]) - float(v["duration"])) < 3 / float(fps)


def test_the_spotlight_is_a_broadcast_pitch_tracker_with_no_sky_beam():
    """ADR-110: broadcast pitch tracker on targeted player: grounded dark disc + glowing cyan ring + floating badge; no beam from heaven."""
    import numpy as np
    from vie_worker.render.reel import Spotlight
    frame = np.full((360, 640, 3), 120, np.uint8)
    spot = Spotlight(640, 360, {"dim": 0.6, "size": 1.6, "feather": 0.6, "ring": True}, "Glushenkov  ·  31.4 km/h")
    out = spot.apply(frame, (310, 200, 12, 30), 1.0).astype(int)
    # No beam from heaven at top of frame: natural / slightly dimmed picture
    assert out[2, 316].mean() < 130
    assert abs(out[2, 316].mean() - out[2, 60].mean()) < 15  # no bright column pouring down from the sky
    # Player body is clear and unoccluded
    assert out[215, 316].mean() == 120
    # Ground tracker disc at player's feet
    assert out[230, 316].mean() < 80
    # Glowing cyan ring at player's feet
    assert out[230, 329, 2] > 200 and out[230, 329, 0] < 50
    # Floating broadcast card above player's head
    assert 50 < out[175, 316].mean() < 100
    # Steady: a box whose width and edges change with every arm and leg movement must not make the tracker wobble
    from vie_worker.render.reel import PathPoint, box_at, smooth_path
    spot.reset()
    rng = np.random.default_rng(1)
    raw = []
    for i in range(40):
        w, dx = 12 * (1 + rng.uniform(-0.4, 0.4)), rng.uniform(-2, 2)
        raw.append((dx, PathPoint(i * 40_000, ((316 - w / 2 + dx) / 640, (200 + rng.uniform(-2, 2)) / 360, w / 640, (30 + rng.uniform(-4, 4)) / 360), "analysis")))
    steady = smooth_path([p for _, p in raw], 0.6)
    centres, boxes = [], []
    for dx, p in raw:
        b = box_at(steady, p.pts_us, 40_000, 0.6)[0]
        applied = spot.apply(frame, (b[0] * 640, b[1] * 360, b[2] * 640, b[3] * 360), 1.0)
        # tracker center at feet
        feet_row = applied[230, :, 2]
        cyan_pts = np.flatnonzero(feet_row > 180)
        if len(cyan_pts) > 0:
            centres.append(cyan_pts.mean())
            boxes.append(316 + dx)
    if len(centres) > 10:
        assert np.ptp(centres[5:]) <= np.ptp(boxes[5:]) + 2
    assert (spot.apply(frame, None, 1.0) == frame).all()    # not found: the footage untouched


def test_music_is_mixed_under_the_match_sound_looped_and_cut_to_the_reel(tmp_path):
    """ADR-047: a 3 s tune under a 7.5 s reel is looped and cut to 7.5 s; over match sound both are heard; without match sound the music alone."""
    from vie_worker.render.reel import mix_music

    def tone(name: str, hz: int, secs: float) -> str:
        p = tmp_path / name
        r = ff.run(["-v", "error", "-y", "-nostdin", "-f", "lavfi", "-i", f"sine=frequency={hz}:duration={secs}", "-ac", "2", "-ar", "44100", str(p)])
        assert r.returncode == 0, r.stderr
        return str(p)

    def dur(p: str) -> float:
        return float(ff.ffprobe_json(p, "-show_format")["format"]["duration"])

    match, tune = tone("match.wav", 220, 7.5), tone("tune.mp3", 880, 3.0)
    mixed = mix_music(match, tune, 7.5, 0.8, 0.3, tmp_path)
    assert mixed and abs(dur(mixed) - 7.5) < 0.05
    alone = mix_music(None, tune, 7.5, 0.8, 0.3, tmp_path)
    assert alone and abs(dur(alone) - 7.5) < 0.05
    (tmp_path / "broken.mp3").write_bytes(b"ID3 not really music")
    assert mix_music(match, str(tmp_path / "broken.mp3"), 7.5, 0.8, 0.3, tmp_path) is None


@needs_real
def test_an_intro_the_match_card_the_event_tag_and_an_outro_render_in_order_with_their_sound(stack, root, seed):
    """ADR-050: intro (a 4:3 video with sound, fitted inside the frame), the match card, the clip with its event tag, the outro (no sound:
    silence); exact frame counts, one continuous audio track, recorded in the manifest. An unreadable intro fails the render."""
    from vie_worker.render.overlays import CARD_S
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    keys = {}
    for name, args in (("intro", ["-f", "lavfi", "-i", "testsrc2=size=640x480:rate=30:duration=2", "-f", "lavfi", "-i", "sine=frequency=660:duration=2",
                                  "-c:v", "mpeg4", "-c:a", "aac", "-shortest"]),
                       ("outro", ["-f", "lavfi", "-i", "color=c=red:size=1280x720:rate=25:duration=1.5", "-c:v", "mpeg4"])):
        keys[name] = f"org/{s['org']}/brand/test-{name}.mp4"
        p = Path(stack["storage"], *keys[name].split("/"))
        p.parent.mkdir(parents=True, exist_ok=True)
        r = ff.run(["-v", "error", "-y", "-nostdin", *args, str(p)])
        assert r.returncode == 0, r.stderr
    settings = {"dim": 0.6, "ring": True, "name_caption": True, "auto_track": False, "event_tags": True, "match_card": True}
    overlay = {"title": "T", "home": "FRA", "away": "GER", "home_name": "Франция", "away_name": "Deutschland", "competition": "Friendly",
               "date": "2026-10-11", "venue": "Stade de France"}
    r = make_reel(root, s, 0, 4_000_000, settings, overlay, {"intro": {"key": keys["intro"]}, "outro": {"key": keys["outro"]}}, label="Free-kick goal")
    assert run_all(stack, ["RENDER"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT j.state, j.result, j.failure_code, j.failure_detail, o.object_key, m.object_key AS mkey FROM render_jobs j LEFT JOIN assets o ON o.id = j.output_asset_id "
                    "LEFT JOIN assets m ON m.id = j.manifest_asset_id WHERE j.id = %s", (r["render"],))
        j = cur.fetchone()
    assert j["state"] == "SUCCEEDED", (j["failure_code"], j["failure_detail"])
    result = json.loads(j["result"])
    manifest = json.loads(Path(stack["storage"], *j["mkey"].split("/")).read_text(encoding="utf-8"))
    out = Path(stack["storage"], *j["object_key"].split("/"))
    info = ff.ffprobe_json(str(out), "-show_streams", "-show_format", "-count_frames")
    v = ff.main_video(info)
    fps = float(ff.rate(v.get("avg_frame_rate")))
    n_in, n_out, n_card = manifest["inserts"]["intro"]["frames"], manifest["inserts"]["outro"]["frames"], round(CARD_S * fps)
    assert n_in == int(2 * fps) and n_out == int(1.5 * fps) and manifest["overlays"]["match_card"] and manifest["overlays"]["event_tags"]
    assert int(v["nb_read_frames"]) == result["frames"] and abs(result["frames"] - (n_in + n_card + 4.0 * fps + n_out)) <= 2
    a = next(x for x in info["streams"] if x["codec_type"] == "audio")
    assert abs(float(a["duration"]) - result["frames"] / fps) < 0.15                                            # one track: intro sound, silence, match, silence
    frames = list(ff.decode_sampled(str(out), None))
    h, w = frames[0].rgb.shape[:2]
    first = frames[0].rgb.astype(int)
    assert abs(first[h // 2, 5] - [6, 17, 31]).max() < 20 and first[h // 2, w // 2].std() >= 0                 # the 4:3 intro fitted, navy at the sides
    card = frames[n_in + n_card // 2].rgb.astype(int)
    assert card[: h // 5].mean() < 80 and (card[h // 3: 2 * h // 3] > 200).any()                                # the dark card with white text
    tagged = frames[n_in + n_card + int(1.5 * fps)].rgb.astype(int)
    blue = (tagged[..., 2] > 100) & (tagged[..., 0] < 40) & (tagged[..., 1] > 40) & (tagged[..., 1] < 90)
    assert blue[h // 2:, : w // 2].sum() > 300                                                                   # the tag panel, lower left
    last = frames[-1].rgb.astype(int)
    assert last[..., 0].mean() > 200 and last[..., 1].mean() < 60                                                # the red outro last
    # an intro that is not a video gives no frames: the render then fails with INTRO_UNREADABLE instead of drawing nothing
    from fractions import Fraction
    from vie_worker.render.reel import insert_count
    bad = Path(stack["storage"], *keys["intro"].split("/"))
    bad.write_bytes(b"\x00\x00\x00\x18ftypmp42 not a video")
    assert insert_count(str(bad), Fraction(25)) == 0


def test_each_transition_blends_two_pictures_and_only_a_fade_shows_black():
    """ADR-055: a transition frame is drawn from the clip before (its handle) and the clip it leads into; the reel's length does not change."""
    import numpy as np
    from vie_worker.render import transitions as trn
    a = np.full((90, 160, 3), 200, np.uint8)
    b = np.full((90, 160, 3), 40, np.uint8)
    assert trn.blend("FADE", a, b, 0.5).max() == 0                          # through black, on purpose
    assert trn.blend("FADE", a, b, 0.25).mean() == 100 and trn.blend("FADE", a, b, 1.0).mean() == 40
    assert abs(trn.blend("DISSOLVE", a, b, 0.5).mean() - 120) < 1 and trn.blend("DISSOLVE", a, b, 0.5).min() > 0
    for kind in ("DISSOLVE", "ZOOM", "SPIN"):                               # never a black frame
        for p in (0.05, 0.3, 0.5, 0.7, 0.95):
            f = trn.blend(kind, a, b, p)
            assert f.shape == a.shape and f.min() >= 39, (kind, p)
    assert abs(trn.blend("SPIN", a, b, 0.5)[0, 0].mean() - 40) < 1 and trn.blend("SPIN", a, b, 0.5)[45, 80].mean() > 150   # a turns and shrinks over b
    assert trn.frame_count(600_000, 25, 100) == 15 and trn.frame_count(600_000, 25, 20) == 10 and trn.frame_count(40_000, 25, 100) == 0
    assert trn.frame_count(5_000_000, 50, 1000) == 50                       # at most 1 s


@needs_real
def test_a_reel_with_transitions_renders_with_its_length_and_sound_unchanged(stack, root, seed):
    from vie_worker.render.reel import clip_frames
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    r = make_reel(root, s, 0, 1_000_000, settings={"dim": 0.6, "auto_track": False})
    clips = [{"id": str(uuid.uuid4()), "in_pts_us": a, "out_pts_us": b, "label": None} for a, b in ((0, 2_000_000), (3_000_000, 5_000_000), (6_000_000, 8_000_000))]
    trans = [{"clip_id": clips[1]["id"], "kind": "SPIN", "duration_us": 600_000}, {"clip_id": clips[2]["id"], "kind": "FADE", "duration_us": 1_000_000},
             {"clip_id": clips[0]["id"], "kind": "ZOOM", "duration_us": 600_000}]          # into the first clip: nothing to blend from, not drawn
    with root.cursor() as cur:
        cur.execute("UPDATE render_jobs SET config = JSON_SET(config, '$.clips', CAST(%s AS JSON), '$.transitions', CAST(%s AS JSON)) WHERE id = %s",
                    (json.dumps(clips), json.dumps(trans), r["render"]))
    assert run_all(stack, ["RENDER"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT j.state, j.result, j.failure_code, j.failure_detail, o.object_key FROM render_jobs j LEFT JOIN assets o ON o.id = j.output_asset_id WHERE j.id = %s",
                    (r["render"],))
        j = cur.fetchone()
    assert j["state"] == "SUCCEEDED", (j["failure_code"], j["failure_detail"])
    out = str(Path(stack["storage"], *j["object_key"].split("/")))
    info = ff.ffprobe_json(out, "-show_streams", "-show_format", "-count_frames")
    v = ff.main_video(info)
    fps = Fraction(v["r_frame_rate"])
    total = sum(clip_frames(c, fps) for c in clips)
    assert int(v["nb_read_frames"]) == json.loads(j["result"])["frames"] == total                  # transitions add no frames
    a = [x for x in info["streams"] if x.get("codec_type") == "audio"]
    if a:
        assert abs(float(a[0]["duration"]) - float(v["duration"])) < 3 / float(fps)
    # the middle of the fade into clip 3 is black; the same moment without transitions is not
    n2 = clip_frames(clips[0], fps) + clip_frames(clips[1], fps)
    n3 = min(int(round(float(fps))), clip_frames(clips[2], fps) // 2)          # the fade's frames (1 s, at most half the clip)
    mid = n2 + n3 // 2                                                         # its middle: black
    frames = list(ff.decode_sampled(out, None, width=int(v["width"]), height=int(v["height"])))
    assert frames[mid].rgb.mean() < 12 and frames[n2 + n3 + 1].rgb.mean() > 30


def test_speed_effects_retime_the_clip_as_the_editor_counts_them():
    """E2 (ADR-065): the same lengths as packages/contracts/src/retime.ts (apps/web/test/retime.test.ts checks the same numbers)."""
    from vie_worker.render.reel import clip_frames, output_plan, retime_segments, strap_offset_s
    c = {"in_pts_us": 0, "out_pts_us": 4_000_000}
    assert retime_segments(c) == [(0.0, 4e6, 1.0, 0.0)] and clip_frames(c, 25) == 100
    assert clip_frames({**c, "effect": {"kind": "SLOW", "speed": 0.5}}, 25) == 200
    fr = {**c, "effect": {"kind": "FREEZE", "at_us": 1_000_000, "hold_ms": 1500, "speed": 1}}
    plan = output_plan(fr, 25)
    assert len(plan) == 138 and plan[24][0] == 960_000 and all(t == 1_000_000 and held for t, held in plan[25:62]) and plan[62] == (1_000_000, False)
    assert abs(strap_offset_s(fr, 25) - 0.0) < 1e-9                                                  # key moment at 1 s: strap from 0 s
    ramp = {**c, "effect": {"kind": "RAMP", "at_us": 2_000_000, "speed": 0.35}}
    segs = retime_segments(ramp)
    assert len(segs) == 10 and abs(min(s[2] for s in segs) - (1 - 0.65 * 0.9619397662556434)) < 1e-9
    assert clip_frames(ramp, 25) == 135                                                              # 5.38 s
    assert clip_frames({**c, "effect": {"kind": "FREEZE", "at_us": 5_000_000, "hold_ms": 1500, "speed": 1}}, 25) == 100   # moment outside: inactive


@needs_real
def test_slow_motion_a_freeze_and_a_hero_ramp_render_with_picture_and_sound_the_same_length(stack, root, seed):
    from vie_worker.render.reel import clip_frames
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    r = make_reel(root, s, 0, 1_000_000, settings={"dim": 0.6, "auto_track": False, "lower_third": True},
                  overlay={"player_number": 9, "player_position": "Forward", "player_club": "Club"})
    clips = [{"id": str(uuid.uuid4()), "in_pts_us": 0, "out_pts_us": 2_000_000, "label": None, "effect": {"kind": "SLOW", "at_us": None, "speed": 0.5, "hold_ms": 0}},
             {"id": str(uuid.uuid4()), "in_pts_us": 3_000_000, "out_pts_us": 5_000_000, "label": "Pass", "effect": {"kind": "FREEZE", "at_us": 4_000_000, "speed": 1, "hold_ms": 1000}},
             {"id": str(uuid.uuid4()), "in_pts_us": 6_000_000, "out_pts_us": 9_000_000, "label": None, "effect": {"kind": "RAMP", "at_us": 7_500_000, "speed": 0.35, "hold_ms": 0}}]
    with root.cursor() as cur:
        cur.execute("UPDATE render_jobs SET config = JSON_SET(config, '$.clips', CAST(%s AS JSON)) WHERE id = %s", (json.dumps(clips), r["render"]))
    assert run_all(stack, ["RENDER"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT j.state, j.result, j.failure_code, j.failure_detail, o.object_key FROM render_jobs j LEFT JOIN assets o ON o.id = j.output_asset_id WHERE j.id = %s",
                    (r["render"],))
        j = cur.fetchone()
    assert j["state"] == "SUCCEEDED", (j["failure_code"], j["failure_detail"])
    out = str(Path(stack["storage"], *j["object_key"].split("/")))
    info = ff.ffprobe_json(out, "-show_streams", "-show_format", "-count_frames")
    v = ff.main_video(info)
    fps = Fraction(v["r_frame_rate"])
    n = [clip_frames(c, fps) for c in clips]
    assert int(v["nb_read_frames"]) == json.loads(j["result"])["frames"] == sum(n)
    assert n[0] == round(4 * float(fps)) and n[1] == round(3 * float(fps))                       # 2 s at half speed; 2 s plus a 1 s freeze
    a = [x for x in info["streams"] if x.get("codec_type") == "audio"]
    if a:
        assert abs(float(a[0]["duration"]) - float(v["duration"])) < 3 / float(fps)
    # inside the freeze the picture stands still (only the beam's slow light moves); just before it, the match moves on
    frames = list(ff.decode_sampled(out, None, width=int(v["width"]), height=int(v["height"])))
    k = n[0] + round(float(fps))                                                                   # the freeze starts 1 s into clip 2
    still = float(abs(frames[k + 5].rgb.astype(int) - frames[k + 15].rgb.astype(int)).mean())
    moving = float(abs(frames[k - 20].rgb.astype(int) - frames[k - 10].rgb.astype(int)).mean())
    assert still < moving / 2, (still, moving)


def test_reframe_crop_rules_match_the_editor_preview():
    """E3 (ADR-066): the same cases as apps/web/test/reframe.test.ts: look-ahead, dead zone, hold without a player, follow speed."""
    from vie_worker.render.reel import CROP_DEAD_ZONE, crop_alpha, crop_target
    cw = 608
    lim = CROP_DEAD_ZONE * cw
    assert crop_target(None, 1000, None, cw) == 1000 and abs(crop_target(None, 1000, 1100, cw) - 1040) < 1e-9
    assert crop_target(1000, 1000 + lim - 1, None, cw) == 1000
    assert abs(crop_target(1000, 1000 + lim + 50, None, cw) - 1050) < 1e-9 and abs(crop_target(1000, 1000 - lim - 30, None, cw) - 970) < 1e-9
    assert crop_target(1000, None, 1500, cw) == 1000 and crop_target(None, None, None, cw) is None
    assert [round(crop_alpha(x), 3) for x in (0, 0.5, 1, 3)] == [0.04, 0.12, 0.2, 0.2]


def _wav_rms(path: str, a: float, b: float) -> float:
    import wave
    import numpy as np
    with wave.open(path, "rb") as w:
        r = w.getframerate()
        w.setpos(int(a * r))
        x = np.frombuffer(w.readframes(int((b - a) * r)), np.int16).astype(float)
    return float(np.sqrt((x ** 2).mean()))


@needs_real
def test_music_dips_under_loud_match_sound_and_the_loudness_is_set_to_the_target(tmp_path):
    """E3 (ADR-066): with ducking the music is quieter while the match is loud than after it goes quiet; the whole sound is set to -14 / -23
    LUFS within 1 LU; silence is left as it is."""
    from vie_worker.render.reel import loudness, mix_music
    match = str(tmp_path / "match.wav")
    r = ff.run(["-v", "error", "-y", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=220:duration=6,volume='if(lt(t,3),0.9,0)':eval=frame", "-ac", "2", "-ar", "48000", match])
    assert r.returncode == 0, r.stderr
    tune = str(tmp_path / "tune.wav")
    assert ff.run(["-v", "error", "-y", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=880:duration=6", "-ac", "2", "-ar", "48000", tune]).returncode == 0
    plain = mix_music(match, tune, 6.0, 0.5, 0.0, tmp_path)            # match volume 0: what is left is the music alone
    plain_rms = (_wav_rms(plain, 1.0, 2.5), _wav_rms(plain, 3.3, 3.9))     # before the 2 s end fade
    (tmp_path / "audio_music.wav").rename(tmp_path / "plain.wav")
    ducked = mix_music(match, tune, 6.0, 0.5, 0.0, tmp_path, duck=True)
    loud_part, quiet_part = _wav_rms(ducked, 1.0, 2.5), _wav_rms(ducked, 3.3, 3.9)
    assert abs(plain_rms[0] - plain_rms[1]) < 0.05 * plain_rms[1]       # without ducking the music is level
    assert loud_part < 0.4 * quiet_part, (loud_part, quiet_part)         # ducked (about -8 dB or more) while the match is loud
    quiet = str(tmp_path / "quiet.wav")
    assert ff.run(["-v", "error", "-y", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=440:duration=8,volume=0.02", "-ac", "2", "-ar", "48000", quiet]).returncode == 0
    for target in (-14.0, -23.0):
        out, measured = loudness(quiet, target, -1.5, tmp_path)
        assert out != quiet and measured is not None and abs(measured - target) <= 1.0, (target, measured)
    silent = str(tmp_path / "silent.wav")
    assert ff.run(["-v", "error", "-y", "-nostdin", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "3", silent]).returncode == 0
    assert loudness(silent, -14.0, -1.5, tmp_path) == (silent, None)


@needs_real
def test_a_social_9_16_cut_follows_the_player_with_ducked_music_at_its_loudness(stack, root, seed):
    """E3 (ADR-066): the SOCIAL profile of one edit: a 9:16 file, music ducked under the match, the sound set to -14 LUFS, all recorded."""
    from vie_worker.render.reel import _output_geometry
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    music_key = f"org/{s['org']}/brand/tune.wav"
    Path(stack["storage"], *music_key.split("/")).parent.mkdir(parents=True, exist_ok=True)
    assert ff.run(["-v", "error", "-y", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=660:duration=4,volume=0.3", "-ac", "2", "-ar", "44100",
                   str(Path(stack["storage"], *music_key.split("/")))]).returncode == 0
    r = make_reel(root, s, 0, 6_000_000, settings={"dim": 0.6, "auto_track": False, "reframe_speed": 0.3},
                  extra={"aspect": "9:16", "profile": "SOCIAL", "audio": {"lufs": -14, "true_peak_db": -1.5, "duck_music": True},
                         "music": {"key": music_key, "volume": 0.8, "match_volume": 0.4}})
    assert run_all(stack, ["RENDER"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("""SELECT j.state, j.result, j.failure_code, j.failure_detail, o.object_key, m.object_key AS mkey FROM render_jobs j
                         LEFT JOIN assets o ON o.id = j.output_asset_id LEFT JOIN assets m ON m.id = j.manifest_asset_id WHERE j.id = %s""", (r["render"],))
        j = cur.fetchone()
    assert j["state"] == "SUCCEEDED", (j["failure_code"], j["failure_detail"])
    result = json.loads(j["result"])
    out = str(Path(stack["storage"], *j["object_key"].split("/")))
    info = ff.ffprobe_json(out, "-show_streams", "-show_format")
    v = ff.main_video(info)
    src = ff.main_video(ff.ffprobe_json(str(FOOTAGE), "-show_streams"))
    ow, oh, _ = _output_geometry(int(src["width"]), int(src["height"]), "9:16")
    assert (int(v["width"]), int(v["height"])) == (ow, oh) and oh > ow
    assert result["profile"] == "SOCIAL" and result["aspect"] == "9:16" and result["music"]
    assert result["loudness_lufs"] is not None and abs(result["loudness_lufs"] + 14) <= 1.5, result["loudness_lufs"]
    # the file itself, measured again from the encoded sound
    m = ff.run(["-v", "info", "-nostdin", "-i", out, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], timeout=300)
    txt = m.stderr.decode("utf-8", "replace")
    measured = float(json.loads(txt[txt.rfind("{"):txt.rfind("}") + 1])["input_i"])
    assert abs(measured + 14) <= 1.5, measured
    manifest = json.loads(Path(stack["storage"], *j["mkey"].split("/")).read_text(encoding="utf-8"))
    assert manifest["profile"] == "SOCIAL" and manifest["audio_rules"]["target_lufs"] == -14 and manifest["audio_rules"]["duck_music"] is True
    assert manifest["audio_rules"]["reframe_speed"] == 0.3


@needs_real
def test_a_colour_look_a_zoom_and_a_drawing_render_into_the_file(stack, root, seed):
    """E5 (ADR-068): a black & white look (the LUT, before the spotlight), a 2x zoom and a red arrow drawn on at 0.5 s: the file is valid, its
    picture is grey but for the arrow while it shows, and the manifest and result record the look, the clip's effects and the lead time."""
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    look = {"preset": "MONO", "strength": 1, "exposure": 0, "contrast": 1, "saturation": 1, "temperature": 0, "match": None}
    r = make_reel(root, s, 0, 3_000_000, settings={"dim": 0.6, "auto_track": False, "look": look})
    fx = {"zoom": [{"at_ms": 0, "zoom": 1, "ease": "EASE"}, {"at_ms": 1000, "zoom": 2, "ease": "EASE"}],
          "drawings": [{"kind": "ARROW", "x1": 0.2, "y1": 0.8, "x2": 0.6, "y2": 0.8, "color": "RED", "at_ms": 500, "draw_ms": 400, "hold_ms": 800}]}
    with root.cursor() as cur:
        cur.execute("UPDATE render_jobs SET config = JSON_SET(config, '$.clips[0].fx', CAST(%s AS JSON)) WHERE id = %s", (json.dumps(fx), r["render"]))
    assert run_all(stack, ["RENDER"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("""SELECT j.state, j.result, j.failure_code, j.failure_detail, o.object_key, m.object_key AS mkey FROM render_jobs j
                         LEFT JOIN assets o ON o.id = j.output_asset_id LEFT JOIN assets m ON m.id = j.manifest_asset_id WHERE j.id = %s""", (r["render"],))
        j = cur.fetchone()
    assert j["state"] == "SUCCEEDED", (j["failure_code"], j["failure_detail"])
    result = json.loads(j["result"])
    assert result["lead_s"] == 0
    out = str(Path(stack["storage"], *j["object_key"].split("/")))
    v = ff.main_video(ff.ffprobe_json(out, "-show_streams"))
    fps = float(Fraction(v["r_frame_rate"]))
    frames = list(ff.decode_sampled(out, None, width=int(v["width"]), height=int(v["height"])))

    def colour(f):            # how far from grey: the largest channel spread per pixel
        a = f.rgb.astype(int)
        return a.max(axis=2) - a.min(axis=2)
    def red(f):
        a = f.rgb.astype(int)
        return int(((a[..., 0] > 150) & (a[..., 1] < 110) & (a[..., 2] < 110)).sum())
    before, during, after = frames[int(0.3 * fps)], frames[int(1.1 * fps)], frames[int(2.5 * fps)]
    assert float(colour(before).mean()) < 6 and red(before) == 0                  # grey (the encoder's chroma adds a little)
    assert red(during) > 200                                                      # the arrow, drawn on
    assert red(after) == 0 and float(colour(after).mean()) < 6                    # gone after 0.5 + 0.4 + 0.8 s
    manifest = json.loads(Path(stack["storage"], *j["mkey"].split("/")).read_text(encoding="utf-8"))
    assert manifest["look"]["settings"]["preset"] == "MONO" and manifest["look"]["lut"]
    assert manifest["clip_fx"][0]["zoom"][1]["zoom"] == 2 and manifest["clip_fx"][0]["drawings"][0]["color"] == "RED"


def test_a_spacer_counts_as_black_frames_before_its_clip():
    """B.19 (ADR-094): the same length as contracts retime.ts gapUs (apps/web/test/spacer.test.ts)."""
    from vie_worker.render.reel import gap_frames
    assert gap_frames({"in_pts_us": 0, "out_pts_us": 1}, 25) == 0
    assert gap_frames({"fx": {"gap_ms": 1000}}, 25) == 25 and gap_frames({"fx": {"gap_ms": 500}}, Fraction(30000, 1001)) == 15
    assert gap_frames({"fx": None}, 25) == 0


@needs_real
def test_a_spacer_renders_black_and_silent_and_drops_the_transition_into_its_clip(stack, root, seed):
    from vie_worker.render.reel import clip_frames, gap_frames
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    r = make_reel(root, s, 0, 1_000_000, settings={"dim": 0.6, "auto_track": False})
    clips = [{"id": str(uuid.uuid4()), "in_pts_us": 0, "out_pts_us": 2_000_000, "label": None},
             {"id": str(uuid.uuid4()), "in_pts_us": 3_000_000, "out_pts_us": 5_000_000, "label": None, "fx": {"zoom": [], "drawings": [], "gap_ms": 1000}}]
    trans = [{"clip_id": clips[1]["id"], "kind": "SPIN", "duration_us": 600_000}]           # into the clip after the spacer: not drawn
    with root.cursor() as cur:
        cur.execute("UPDATE render_jobs SET config = JSON_SET(config, '$.clips', CAST(%s AS JSON), '$.transitions', CAST(%s AS JSON)) WHERE id = %s",
                    (json.dumps(clips), json.dumps(trans), r["render"]))
    assert run_all(stack, ["RENDER"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT j.state, j.result, j.failure_code, j.failure_detail, o.object_key FROM render_jobs j LEFT JOIN assets o ON o.id = j.output_asset_id WHERE j.id = %s",
                    (r["render"],))
        j = cur.fetchone()
    assert j["state"] == "SUCCEEDED", (j["failure_code"], j["failure_detail"])
    out = str(Path(stack["storage"], *j["object_key"].split("/")))
    info = ff.ffprobe_json(out, "-show_streams", "-show_format", "-count_frames")
    v = ff.main_video(info)
    fps = Fraction(v["r_frame_rate"])
    n0, g = clip_frames(clips[0], fps), gap_frames(clips[1], fps)
    assert g == round(float(fps))
    assert int(v["nb_read_frames"]) == json.loads(j["result"])["frames"] == n0 + g + clip_frames(clips[1], fps)
    a = [x for x in info["streams"] if x.get("codec_type") == "audio"]
    if a:
        assert abs(float(a[0]["duration"]) - float(v["duration"])) < 3 / float(fps)
    frames = list(ff.decode_sampled(out, None, width=int(v["width"]), height=int(v["height"])))
    assert frames[n0 - 2].rgb.mean() > 30 and frames[n0 + g // 2].rgb.mean() < 6 and frames[n0 + g + 2].rgb.mean() > 30


def test_a_clips_sound_level_and_mute_follow_the_editor():
    """B.20 (ADR-095): contracts look.ts gain_db / MUTE_DB"""
    from vie_worker.render.reel import clip_gain_db
    assert clip_gain_db({}) == 0 and clip_gain_db({"fx": {"gain_db": -6}}) == -6 and clip_gain_db({"fx": {"gain_db": -60}}) is None


@needs_real
def test_a_muted_clip_is_silent_in_the_file_and_a_quieter_clip_is_quieter(stack, root, seed, tmp_path):
    import numpy as np
    from vie_worker.render.reel import clip_frames
    s = ingest(stack, root, seed, FOOTAGE.read_bytes(), "france-germany.ogv")
    start_analysis(root, s["org"], s["video"], sample_fps=2, tiles=1)
    assert run_all(stack, ["ANALYZE"]) == ["succeeded"]
    r = make_reel(root, s, 0, 1_000_000, settings={"dim": 0.6, "auto_track": False})
    win = (2_000_000, 5_000_000)                                   # the same source window three times: as recorded, -12 dB, muted
    clips = [{"id": str(uuid.uuid4()), "in_pts_us": win[0], "out_pts_us": win[1], "label": None, "fx": {"zoom": [], "drawings": [], "gain_db": g}} for g in (0, -12, -60)]
    with root.cursor() as cur:
        cur.execute("UPDATE render_jobs SET config = JSON_SET(config, '$.clips', CAST(%s AS JSON), '$.audio', NULL) WHERE id = %s", (json.dumps(clips), r["render"]))
    assert run_all(stack, ["RENDER"]) == ["succeeded"]
    with root.cursor() as cur:
        cur.execute("SELECT j.state, j.failure_code, j.failure_detail, o.object_key FROM render_jobs j LEFT JOIN assets o ON o.id = j.output_asset_id WHERE j.id = %s", (r["render"],))
        j = cur.fetchone()
    assert j["state"] == "SUCCEEDED", (j["failure_code"], j["failure_detail"])
    out = str(Path(stack["storage"], *j["object_key"].split("/")))
    info = ff.ffprobe_json(out, "-show_streams")
    if not any(x.get("codec_type") == "audio" for x in info["streams"]):
        return                                                     # footage without sound: nothing to compare
    fps = Fraction(ff.main_video(info)["r_frame_rate"])
    wav = tmp_path / "a.wav"
    assert ff.run(["-v", "error", "-y", "-i", out, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", str(wav)]).returncode == 0
    pcm = np.frombuffer(wav.read_bytes(), dtype=np.int16).astype(float)
    n = clip_frames(clips[0], fps) / float(fps) * 8000
    rms = [float(np.sqrt(np.mean(pcm[int(i * n + 0.2 * n):int(i * n + 0.8 * n)] ** 2))) for i in range(3)]
    if rms[0] < 50:
        return                                                     # a silent stretch of footage: nothing to compare
    assert 0.15 < rms[1] / rms[0] < 0.4, rms                        # -12 dB is about a quarter
    assert rms[2] < rms[0] * 0.01, rms
