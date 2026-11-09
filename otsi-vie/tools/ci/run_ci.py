"""Local continuous-integration pipeline for OTSI VIE v2 — every check, in dependency order, one command.

  python otsi-vie/tools/ci/run_ci.py [--evidence DIR] [--skip-e2e]

Steps: generated-file freshness (page specs) -> licence check -> contracts build -> API typecheck/build/tests -> DB tests ->
compiled outbox-worker smoke -> web typecheck/unit tests/production build/browser e2e. Each step's full output is written to the evidence
directory (default: release-evidence/ci/<UTC timestamp>/) with a summary.md; the run stops at the first failure and exits non-zero.
Database steps use only the disposable MySQL 8.4 server on 127.0.0.1:3507 (never 3306). Nothing is pushed or deployed.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
PY = str(ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))
PNPM = [shutil.which("corepack") or "corepack", "pnpm"]      # corepack.cmd on Windows
ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def steps(skip_e2e: bool) -> list[tuple[str, list[str], Path, dict[str, str]]]:
    api, web, contracts = APP / "apps" / "api", APP / "apps" / "web", APP / "packages" / "contracts"
    out: list[tuple[str, list[str], Path, dict[str, str]]] = [
        ("page specs are current", [PY, "-I", "tools/web/extract_page_specs.py", "--check"], APP, {}),
        ("dependency licences", [PY, "-I", "tools/licenses/dependency_licenses.py", "--check"], APP, {}),
        ("contracts build", PNPM + ["build"], contracts, {}),
        ("api typecheck", PNPM + ["typecheck"], api, {}),
        ("api build", PNPM + ["build"], api, {}),
        ("api tests (real MySQL 8.4)", PNPM + ["test"], api, {}),
        ("database tests", [PY, "-m", "pytest", "tests/db", "-q", "-p", "no:cacheprovider"], APP, {}),
        ("outbox worker smoke", [PY, "tools/smoke/outbox_worker_smoke.py"], APP, {}),
        # ingest, link import and the detection/tracking pipeline on real football footage (skipped where footage or verified weights are absent)
        ("worker tests (real media, real footage)", [PY, "-m", "pytest", "tests", "-q", "-p", "no:cacheprovider", "-rs"], APP / "services" / "worker",
         {"HF_HOME": str(ROOT / ".local" / "hf"), "HF_HUB_OFFLINE": "1"}),
        ("web typecheck", PNPM + ["typecheck"], web, {}),
        ("web unit tests", PNPM + ["test"], web, {}),
        ("web production build", PNPM + ["build"], web, {"NEXT_TELEMETRY_DISABLED": "1"}),
    ]
    if not skip_e2e:
        # against the real API on a scratch database that tools/dev/e2e.py prepares and drops
        out.append(("web browser e2e (Chromium, real API)", [PY, "tools/dev/e2e.py"], APP,
                    {"NEXT_TELEMETRY_DISABLED": "1", "PLAYWRIGHT_BROWSERS_PATH": str(ROOT.parent / "_tmp" / "ms-playwright")}))
    return out


def main() -> int:
    sys.stdout.reconfigure(errors="replace")          # test output contains symbols the Windows console code page cannot print
    ap = argparse.ArgumentParser()
    ap.add_argument("--evidence", type=Path)
    ap.add_argument("--skip-e2e", action="store_true")
    args = ap.parse_args()
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    ev = args.evidence or APP / "release-evidence" / "ci" / stamp
    ev.mkdir(parents=True, exist_ok=True)
    shots = ev / "screenshots"
    rows, ok = [], True
    for i, (name, cmd, cwd, extra) in enumerate(steps(args.skip_e2e), 1):
        env = {**os.environ, **extra, "NO_COLOR": "1", "FORCE_COLOR": "0"}
        if "e2e" in name:
            shots.mkdir(exist_ok=True)
            env["OTSI_E2E_SHOTS"] = str(shots)
        t0 = time.time()
        p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", shell=False)
        secs = time.time() - t0
        log = ANSI.sub("", p.stdout + p.stderr)
        (ev / f"{i:02d}-{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')}.txt").write_text(
            f"$ {' '.join(cmd)}\n(cwd {cwd.relative_to(ROOT)})\n\n{log}\nexit={p.returncode}\n", encoding="utf-8")
        rows.append((name, p.returncode == 0, secs))
        print(f"[{'PASS' if p.returncode == 0 else 'FAIL'}] {name} ({secs:.1f}s)", flush=True)
        if p.returncode != 0:
            ok = False
            print("\n".join(log.strip().splitlines()[-30:]))
            break
    versions = f"node {subprocess.run(['node', '-v'], capture_output=True, text=True).stdout.strip()}, python {platform.python_version()}, {platform.platform()}"
    summary = [f"# CI run {stamp}", "", f"Result: **{'PASSED' if ok else 'FAILED'}**", "", versions, "",
               "| Step | Result | Seconds |", "|---|---|---|"] + [f"| {n} | {'pass' if r else 'FAIL'} | {s:.1f} |" for n, r, s in rows]
    (ev / "summary.md").write_text("\n".join(summary) + "\n", encoding="utf-8")
    print(f"evidence: {ev}")
    return 0 if ok else 1


if __name__ == "__main__":
    if shutil.which("corepack") is None:
        sys.exit("corepack (Node.js 22) is required")
    sys.exit(main())
