"""The evaluation metrics (ADR-034) on hand-built cases whose answers are known. These check the arithmetic only; they are not engine
accuracy (that needs manually labelled footage)."""
import json

import pytest

from vie_worker.evaluation import Box, Frames, evaluate, load_ground_truth

W, H = 1920, 1080


def frames(spec: dict[int, list[tuple]]) -> Frames:
    f = Frames(W, H)
    for t, boxes in spec.items():
        f.by_pts[t] = [Box(*b) for b in boxes]
    return f


def b(i, x, y=0.5, h=0.1, ref=None):
    return (i, x, y, 0.03, h, ref)


def test_perfect_tracking_scores_one():
    gt = frames({t * 500_000: [b("g1", 0.1), b("g2", 0.5)] for t in range(10)})
    pr = frames({t * 500_000: [b("p1", 0.1), b("p2", 0.5)] for t in range(10)})
    r = evaluate(gt, pr)
    assert r["detection"]["precision"] == 1 and r["detection"]["recall"] == 1
    assert r["tracking"]["id_switches"] == 0 and r["tracking"]["idf1"] == pytest.approx(1)
    assert r["tracking"]["hota"] == pytest.approx(1) and r["tracking"]["mota"] == pytest.approx(1)


def test_identity_swap_counts_one_switch_per_track_and_lowers_idf1_and_hota():
    gt = frames({t * 500_000: [b("g1", 0.1), b("g2", 0.5)] for t in range(10)})
    pr = frames({t * 500_000: [b("p1" if t < 5 else "p2", 0.1), b("p2" if t < 5 else "p1", 0.5)] for t in range(10)})
    r = evaluate(gt, pr)
    assert r["detection"]["recall"] == 1
    assert r["tracking"]["id_switches"] == 2
    assert r["tracking"]["idf1"] == pytest.approx(0.5)
    assert r["tracking"]["hota"] < 0.8


def test_recall_is_reported_by_box_height_so_tiny_missed_players_show():
    tall, tiny = 100 / H, 15 / H
    gt = frames({0: [b("g1", 0.1, h=tall), b("g2", 0.5, h=tiny), b("g3", 0.8, h=tiny)]})
    pr = frames({0: [b("p1", 0.1, h=tall), b("p9", 0.3, h=tiny)]})          # one tall hit, both tiny ones missed, one false box
    r = evaluate(gt, pr)
    assert r["detection"]["recall_by_height_px"] == {"0-20": {"recall": 0, "gt": 2}, "80-160": {"recall": 1, "gt": 1}}
    assert r["detection"]["precision_by_height_px"]["0-20"] == {"precision": 0, "predicted": 1}
    assert r["detection"]["fp"] == 1 and r["detection"]["fn"] == 2


def test_identity_rates_separate_wrong_from_unassigned_and_top_k_uses_ground_truth():
    gt = frames({t: [b("g1", 0.1, ref="A"), b("g2", 0.5, ref="B")] for t in range(0, 4_000_000, 500_000)})
    pr = frames({t: [b("p1", 0.1, ref="A"), b("p2", 0.5, ref="C" if t >= 2_000_000 else None)] for t in range(0, 4_000_000, 500_000)})
    r = evaluate(gt, pr, candidates={"p1": ["A", "B"], "p2": ["C", "D", "B"]})
    i = r["identity"]
    assert (i["correct"], i["wrong"], i["unassigned"]) == (8, 4, 4)
    assert i["wrong_identity_rate"] == pytest.approx(4 / 12)
    assert i["candidates"] == {"tracks_with_truth": 2, "top1": 0.5, "top3": 1.0, "top5": 1.0}


def test_only_complete_frames_count_and_mot_format_loads(tmp_path):
    j = tmp_path / "gt.json"
    j.write_text(json.dumps({"frame_width": W, "frame_height": H, "frames": [
        {"pts_us": 0, "complete": True, "boxes": [{"id": "g1", "x": 0.1, "y": 0.5, "w": 0.03, "h": 0.1}]},
        {"pts_us": 500000, "complete": False, "boxes": []}]}))
    assert list(load_ground_truth(j).by_pts) == [0]
    m = tmp_path / "gt.txt"
    m.write_text("1,1,192,540,58,108,1,1,1\n1,2,0,0,10,10,0,1,1\n3,1,200,540,58,108,1,1,1\n")
    g = load_ground_truth(m, fps=25, width=W, height=H)
    assert sorted(g.by_pts) == [0, 80_000] and len(g.by_pts[0]) == 1                # the conf-0 ignore box is dropped
    assert g.by_pts[0][0].x == pytest.approx(0.1)


def test_ignore_regions_and_approximately_placed_players():
    gt = frames({0: [b("g1", 0.1), ("ref", 0.5, 0.5, 0.03, 0.1, None)]})
    gt.by_pts[0][1].ignore = True                                       # a referee: neither found nor missed
    gt.by_pts[0].append(Box("g3", 0.8, 0.5, 0.03, 0.1, approximate=True))
    pr = frames({0: [b("p1", 0.1), b("p2", 0.5), ("p3", 0.79, 0.45, 0.05, 0.15, None)]})   # p3: different box, feet at the mark
    r = evaluate(gt, pr)
    assert (r["detection"]["tp"], r["detection"]["fp"], r["detection"]["fn"]) == (2, 0, 0)
