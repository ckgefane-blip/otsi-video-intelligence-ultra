"""SNAPSHOT job (v3 B.5, ADR-083): a real encoded video, a real job run by the JobRunner on the scratch database. The PNG is the nearest frame at
the source's full size, with only the recorded boxes of the latest finished analysis at that frame; none from another moment."""
from __future__ import annotations

import io
import json
import shutil
import uuid

import numpy as np
from PIL import Image

from vie_worker.jobs import JobRunner
from vie_worker.main import HANDLERS
from vie_worker.snapshot_job import box_label, compose


def test_labels_name_only_confirmed_identities():
    assert box_label({"track_number": 7, "identity_state": "CANDIDATE", "display_name": "A. Player"}) == "#7"
    assert box_label({"track_number": 7, "identity_state": "CONFIRMED", "display_name": "A. Player", "canonical_otsi_id": "OTSI-NGA-2026-000001"}) == "A. Player · OTSI-NGA-2026-000001"
    assert box_label({"track_number": 7, "identity_state": "CONFIRMED", "display_name": "A. Player", "canonical_otsi_id": None}) == "A. Player · no OTSI Player ID yet"


def test_compose_draws_boxes_where_recorded_and_adds_a_caption_strip():
    rgb = np.zeros((240, 320, 3), np.uint8)
    out = compose(rgb, [{"track_id": "a", "x": 0.25, "y": 0.25, "w": 0.25, "h": 0.5, "kit_group": 1, "track_number": 3}], labels=False, selected=None, caption="Test · 0:01")
    assert out.shape[1] == 320 and out.shape[0] > 240                                     # the caption strip is under the picture, never over it
    assert tuple(out[60, 100]) == (255, 77, 77)                                         # the box's top edge in the team colour
    assert tuple(out[150, 120]) == (0, 0, 0)                                            # inside the box the picture is untouched
    plain = compose(rgb, [], labels=False, selected=None, caption=None)
    assert plain.shape == (240, 320, 3) and not plain.any()


def test_a_snapshot_job_makes_a_full_size_png_with_only_the_recorded_boxes(stack, root, seed, media):
    org, user, project = seed.org()
    video, asset, run, snap, other = (str(uuid.uuid4()) for _ in range(5))
    key = f"org/{org}/videos/{video}/source.mp4"
    dest = stack["storage"] / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(media["mp4"], dest)                                               # 320 x 240, 4 s at 25 fps
    tracks = [str(uuid.uuid4()) for _ in range(3)]
    with root.cursor() as cur:
        cur.execute("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (%s, %s, %s, 'SOURCE', %s, 'local', %s, 'video/mp4')",
                    (asset, org, project, key, dest.stat().st_size))
        cur.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, title, original_filename, byte_size, state, created_by, width, height, duration_us, source_asset_id) "
                    "VALUES (%s, %s, %s, 'UPLOAD', 'Cup final', 'm.mp4', 1, 'INGESTED', %s, 320, 240, 4000000, %s)", (video, org, project, user, asset))
        cur.execute("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, config, finished_at) VALUES (%s, %s, %s, 'test', 'SUCCEEDED', %s, NOW(6))",
                    (run, video, org, json.dumps({"sample_fps": 2})))
        for f, pts in ((50, 2_000_000), (75, 3_000_000)):
            cur.execute("INSERT INTO video_frame_index (video_id, frame_index, pts_us) VALUES (%s, %s, %s)", (video, f, pts))
        for n, t in enumerate(tracks, 1):
            cur.execute("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, first_pts_us, last_pts_us) VALUES (%s, %s, %s, %s, 'PLAYER', 0, 4000000)",
                        (t, run, video, n))
        # two boxes at 2.0 s, one only at 3.0 s
        for t, f, pts, x in ((tracks[0], 50, 2_000_000, 0.1), (tracks[1], 50, 2_000_000, 0.5), (tracks[2], 75, 3_000_000, 0.3)):
            cur.execute("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, observation_state) "
                        "VALUES (%s, %s, %s, %s, %s, 0.2, 0.2, 0.5, 'DETECTED')", (video, f, t, pts, x))
        ov = {"boxes": True, "labels": True, "selected_track_id": tracks[1], "caption": True}
        for s, at in ((snap, 2_010_000), (other, 1_000_000)):
            cur.execute("INSERT INTO snapshots (id, organization_id, video_id, pts_us, overlays, requested_by) VALUES (%s, %s, %s, %s, %s, %s)", (s, org, video, at, json.dumps(ov), user))
            cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (%s, %s, 'SNAPSHOT', 'snapshot', %s, %s, %s)",
                        (str(uuid.uuid4()), org, s, f"snapshot:{s}", json.dumps({"snapshot_id": s, "video_id": video})))
    runner = JobRunner(stack["dsn"], "test-worker", ["SNAPSHOT"], lease_seconds=60)
    assert runner.run_one(HANDLERS) and runner.run_one(HANDLERS)
    with root.cursor() as cur:
        cur.execute("SELECT s.*, a.object_key, a.kind, a.mime_type FROM snapshots s JOIN assets a ON a.id = s.asset_id WHERE s.id IN (%s, %s)", (snap, other))
        rows = {r["id"]: r for r in cur.fetchall()}
        cur.execute("SELECT state FROM worker_jobs WHERE subject_id IN (%s, %s)", (snap, other))
        assert {r["state"] for r in cur.fetchall()} == {"SUCCEEDED"}
    a, b = rows[snap], rows[other]
    assert a["status"] == "SUCCEEDED" and a["kind"] == "SNAPSHOT" and a["mime_type"] == "image/png"
    assert abs(a["frame_pts_us"] - 2_010_000) <= 20_000                               # the nearest decoded frame (25 fps)
    assert a["boxes_drawn"] == 2 and a["run_id"] == run                                 # the two boxes at 2.0 s; never the one recorded at 3.0 s
    assert b["boxes_drawn"] == 0 and b["run_id"] == run                                 # 1.0 s: nothing recorded within half a step, nothing drawn
    img = Image.open(io.BytesIO((stack["storage"] / a["object_key"]).read_bytes()))
    assert img.format == "PNG" and img.width == 320 and img.height > 240 and (a["width"], a["height"]) == img.size
