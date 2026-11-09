"""CLI entrypoint for vie-render (v3 Phase C.8, ADR-107).

Usage:
  vie-render <manifest> [options]
  vie-render <manifest1> <manifest2> ... --output-dir <dir>

Options:
  -o, --output <path>       Output video path or destination directory
  -s, --source <path>       Source video override path
  --storage-dir <dir>       OTSI_VIE_STORAGE_DIR override
  --dry-run                 Preview frame plan and durations without encoding
  --validate-only           Validate existing rendered file against manifest QC rules
  --json                    Output results in structured JSON format
  -q, --quiet               Quiet mode, only output errors
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from pathlib import Path

from .headless import render_manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="vie-render",
        description="Headless render command for batch processing and disaster recovery (v3 Phase C.8, ADR-107)",
    )
    parser.add_argument(
        "manifests",
        nargs="+",
        help="One or more render manifest JSON files (wildcards supported)",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="Output video file path (single manifest) or destination folder (batch)",
    )
    parser.add_argument(
        "-s",
        "--source",
        help="Override source video file path",
    )
    parser.add_argument(
        "--storage-dir",
        help="Override storage directory location",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse manifest and print planned frame counts and geometry without rendering",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate existing rendered file without re-rendering",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON summary",
    )
    parser.add_argument(
        "-q",
        "--quiet",
        action="store_true",
        help="Suppress non-error output",
    )

    args = parser.parse_args(argv)

    # Resolve manifest paths (support shell globbing / windows wildcards)
    manifest_paths: list[Path] = []
    for m in args.manifests:
        expanded = glob.glob(m)
        if expanded:
            for p in expanded:
                manifest_paths.append(Path(p).resolve())
        else:
            manifest_paths.append(Path(m).resolve())

    if not manifest_paths:
        sys.stderr.write("Error: No manifest files specified.\n")
        return 1

    out_arg = Path(args.output).resolve() if args.output else None
    is_batch = len(manifest_paths) > 1

    results = []
    total_ok = True

    for i, m_path in enumerate(manifest_paths):
        prefix = f"[{i + 1}/{len(manifest_paths)}] " if is_batch else ""
        if not args.quiet and not args.json:
            sys.stdout.write(f"{prefix}Processing {m_path.name} ...\n")
            sys.stdout.flush()

        # Determine target output path
        out_target = None
        if out_arg:
            if is_batch or out_arg.is_dir() or not out_arg.suffix:
                out_arg.mkdir(parents=True, exist_ok=True)
                out_target = out_arg / f"{m_path.stem}_rendered.mp4"
            else:
                out_target = out_arg

        def progress_cb(pct: int, msg: str):
            if not args.quiet and not args.json:
                sys.stdout.write(f"\r  -> {pct:3d}% {msg}...")
                sys.stdout.flush()

        try:
            res = render_manifest(
                m_path,
                output_path=out_target,
                source_override=args.source,
                storage_dir=args.storage_dir,
                dry_run=args.dry_run,
                validate_only=args.validate_only,
                progress_cb=progress_cb,
            )
            if not args.quiet and not args.json:
                sys.stdout.write("\n")
                if res.get("dry_run"):
                    sys.stdout.write(
                        f"  [DRY-RUN] {res['frames']} frames ({res['duration_s']}s) at {res['width']}x{res['height']} ({res['aspect']})\n"
                    )
                elif res.get("validation"):
                    qc = res["validation"].get("qc", {})
                    loud = (qc.get("loudness") or {}).get("measured_lufs")
                    lufs_str = f"{loud:.1f} LUFS" if loud is not None else "N/A"
                    status_str = "PASS" if res["ok"] else "FAIL"
                    fps_real = round(res["frames"] / max(0.01, res["seconds"]), 1)
                    sys.stdout.write(
                        f"  [{status_str}] {res['frames']} frames in {res['seconds']}s ({fps_real} fps) - QC: {lufs_str} -> {res['output_path']}\n"
                    )
            results.append(res)
            if not res["ok"]:
                total_ok = False
        except Exception as e:
            if not args.quiet and not args.json:
                sys.stdout.write(f"\n  [ERROR] {e}\n")
            results.append({"ok": False, "manifest_path": str(m_path), "error": str(e)})
            total_ok = False

    if args.json:
        sys.stdout.write(json.dumps(results if is_batch else results[0], indent=2) + "\n")

    return 0 if total_ok else 1


if __name__ == "__main__":
    sys.exit(main())
