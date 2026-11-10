"""Export engine predictions as OTSI JSON for the Track G benchmark.

Verified export path (2026-11-10, read from the repo — there is NO built-in
export that writes this shape, so this script assembles it):
  - Tracks live in MySQL: `tracks` (one row per track: internal_track_number,
    class_name) and `track_observations` (one row per detection: pts_us,
    bbox_x/y/w/h, detector_confidence). Boxes are normalised 0..1.
  - Identity: v_track_current_identity + v_player_identity give the
    canonical OTSI ID for tracks CONFIRMED as a player (same join as the
    API's track list in apps/api/src/modules/analysis/analysis.ts).
  - The API exposes the same data (GET /v1/analysis-runs/:runId/tracks and
    GET /v1/analysis-runs/:runId/observations, 20 s windows), but the
    database read is simpler and has no window cap, so this script reads
    the database directly.
  - Only PERSON observations are exported: the ground truth is players, and
    a BALL box would count as a false positive in detection scoring.
  - Box id is the engine's track number (as a string); player_ref is the
    canonical OTSI ID where the track is CONFIRMED as a player, else null.
    (The harness matches identity by id; player_ref is the human-readable
    name the scorer reports.)

Usage (on the host, from the repo root):
  python otsi-vie/tools/eval/export_predictions.py --run-id <uuid> \
      --from-s 840 --to-s 960 --out predictions-nart.json
  python otsi-vie/tools/eval/sukhum_benchmark.py \
      --gt annotations/gt/nart_ercakhu_r20.json --pred predictions-nart.json \
      --validate-only

The database password is read from --db-password, the OTSI_VIE_DB_PASSWORD
environment variable, or .local/mysql-owner.env / .local/mysql-portable.env
(MYSQL_ROOT_PASSWORD=...). Defaults match the owner stack: 127.0.0.1:3508,
user root, database otsi_owner_vie.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
LOCAL = REPO_ROOT / ".local"


def _env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def resolve_password(explicit: str | None) -> str:
    if explicit:
        return explicit
    if os.environ.get("OTSI_VIE_DB_PASSWORD"):
        return os.environ["OTSI_VIE_DB_PASSWORD"]
    for name in ("mysql-owner.env", "mysql-portable.env"):
        pw = _env_file(LOCAL / name).get("MYSQL_ROOT_PASSWORD")
        if pw:
            return pw
    raise SystemExit(
        "No database password found. Pass --db-password, set "
        "OTSI_VIE_DB_PASSWORD, or make sure .local/mysql-owner.env (or "
        ".local/mysql-portable.env) exists with MYSQL_ROOT_PASSWORD=....")


def assemble(rows, width: int, height: int, video: str) -> dict:
    """Build the OTSI JSON document from observation rows.

    rows: (pts_us, track_number, bbox_x, bbox_y, bbox_w, bbox_h,
    canonical_otsi_id-or-None). Pure function — no database access, so it
    can be tested without MySQL.
    """
    frames: dict[int, list[dict]] = {}
    skipped = 0
    for pts_us, number, x, y, w, h, otsi_id in rows:
        if w is None or h is None or w <= 0 or h <= 0:
            skipped += 1
            continue
        box = {"id": str(number), "x": float(x), "y": float(y),
               "w": float(w), "h": float(h),
               "player_ref": otsi_id or None,
               "ignore": False, "approximate": False}
        frames.setdefault(int(pts_us), []).append(box)
    out_frames = []
    for pts_us in sorted(frames):
        boxes = sorted(frames[pts_us], key=lambda b: int(b["id"]))
        # One box per track per frame: keep the first if a duplicate slips in.
        seen: set[str] = set()
        deduped = []
        for b in boxes:
            if b["id"] in seen:
                skipped += 1
                continue
            seen.add(b["id"])
            deduped.append(b)
        out_frames.append({"pts_us": pts_us, "complete": True, "boxes": deduped})
    doc = {"video": video, "frame_width": int(width),
           "frame_height": int(height), "frames": out_frames}
    return doc, skipped


def self_check(doc: dict) -> list[str]:
    """The hard errors sukhum_benchmark.validate_document would raise.

    Mirrors that function (not imported: it needs the worker package). Run
    --validate-only on the harness as the real check after this.
    """
    errors: list[str] = []
    for key in ("frame_width", "frame_height", "frames"):
        if key not in doc:
            errors.append(f"missing required key {key!r}")
    if errors:
        return errors
    if not isinstance(doc["frame_width"], int) or doc["frame_width"] <= 0:
        errors.append("frame_width must be a positive integer")
    if not isinstance(doc["frame_height"], int) or doc["frame_height"] <= 0:
        errors.append("frame_height must be a positive integer")
    if not isinstance(doc["frames"], list) or not doc["frames"]:
        errors.append("frames must be a non-empty list")
        return errors
    for i, f in enumerate(doc["frames"]):
        if not isinstance(f, dict):
            errors.append(f"frames[{i}]: must be an object")
            continue
        if "pts_us" not in f or not isinstance(f["pts_us"], (int, float)):
            errors.append(f"frames[{i}]: missing numeric pts_us")
        if "boxes" not in f or not isinstance(f["boxes"], list):
            errors.append(f"frames[{i}]: missing boxes list")
            continue
        seen: set[str] = set()
        for j, b in enumerate(f["boxes"]):
            if not isinstance(b, dict):
                errors.append(f"frames[{i}]: boxes[{j}]: must be an object")
                continue
            if not b.get("id"):
                errors.append(f"frames[{i}]: boxes[{j}]: missing id")
            elif b["id"] in seen:
                errors.append(f"frames[{i}]: boxes[{j}]: duplicate box id {b['id']!r}")
            else:
                seen.add(b["id"])
            for k in ("x", "y", "w", "h"):
                if k not in b or not isinstance(b[k], (int, float)):
                    errors.append(f"frames[{i}]: boxes[{j}]: missing numeric {k}")
                elif k in ("w", "h") and b[k] <= 0:
                    errors.append(f"frames[{i}]: boxes[{j}]: {k}={b[k]} must be positive")
                elif not -0.05 <= b[k] <= 1.05:
                    errors.append(f"frames[{i}]: boxes[{j}]: {k}={b[k]} outside [-0.05, 1.05]")
    return errors


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--run-id", required=True, help="analysis run UUID")
    p.add_argument("--from-s", type=float, default=840.0, help="segment start (seconds, default 840)")
    p.add_argument("--to-s", type=float, default=960.0, help="segment end (seconds, default 960)")
    p.add_argument("--out", required=True, help="output predictions JSON path")
    p.add_argument("--video", default="nart_ercakhu_r20", help="video/clip name in the file")
    p.add_argument("--db-host", default="127.0.0.1")
    p.add_argument("--db-port", type=int, default=3508)
    p.add_argument("--db-user", default="root")
    p.add_argument("--db-password", default=None)
    p.add_argument("--db-name", default="otsi_owner_vie")
    a = p.parse_args(argv)

    try:
        import pymysql  # noqa: PLC0415  (lazy: assemble/self_check need no DB)
    except ImportError:
        print("pymysql is not installed in this Python. Run with the engine's "
              ".venv python (it has pymysql).", file=sys.stderr)
        return 2

    password = resolve_password(a.db_password)
    conn = pymysql.connect(host=a.db_host, port=a.db_port, user=a.db_user,
                           password=password, database=a.db_name,
                           connect_timeout=10)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT v.width, v.height FROM video_sources v "
                "JOIN tracks t ON t.video_id = v.id WHERE t.run_id = %s LIMIT 1",
                (a.run_id,))
            row = cur.fetchone()
            if not row:
                print(f"No tracks found for run {a.run_id} — is the run id right "
                      "and the analysis finished?", file=sys.stderr)
                return 2
            width, height = int(row[0]), int(row[1])
            cur.execute(
                "SELECT t.id, t.internal_track_number, pi.canonical_otsi_id "
                "FROM tracks t "
                "LEFT JOIN v_track_current_identity ci ON ci.track_id = t.id "
                "LEFT JOIN v_player_identity pi ON pi.player_id = ci.player_id "
                "AND ci.state = 'CONFIRMED' WHERE t.run_id = %s",
                (a.run_id,))
            identities = {r[0]: r[2] for r in cur.fetchall()}
            from_us, to_us = int(a.from_s * 1_000_000), int(a.to_s * 1_000_000)
            cur.execute(
                "SELECT o.pts_us, t.internal_track_number, "
                "o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h, t.id "
                "FROM track_observations o JOIN tracks t ON t.id = o.track_id "
                "WHERE t.run_id = %s AND t.class_name = 'PERSON' "
                "AND o.pts_us >= %s AND o.pts_us < %s "
                "ORDER BY o.pts_us, t.internal_track_number",
                (a.run_id, from_us, to_us))
            rows = [(r[0], r[1], r[2], r[3], r[4], r[5], identities.get(r[6]))
                    for r in cur.fetchall()]
    finally:
        conn.close()

    doc, skipped = assemble(rows, width, height, a.video)
    errors = self_check(doc)
    if errors:
        print("Assembled file would be rejected by the harness:", file=sys.stderr)
        for e in errors[:20]:
            print(f"  {e}", file=sys.stderr)
        return 2
    out = Path(a.out)
    out.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    named = sum(1 for f in doc["frames"] for b in f["boxes"] if b["player_ref"])
    print(f"wrote {out} ({width}x{height}, {a.from_s:.0f}-{a.to_s:.0f}s): "
          f"{len(doc['frames'])} frames, "
          f"{sum(len(f['boxes']) for f in doc['frames'])} boxes, "
          f"{named} with a confirmed OTSI ID"
          + (f", {skipped} rows skipped" if skipped else ""))
    print("Next: run the harness with --validate-only, then score it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
