"""Browser end-to-end tests against the REAL stack on a scratch database (never the owner's workspace).

  python otsi-vie/tools/dev/e2e.py [playwright args...]

Creates a scratch stack on the disposable test MySQL (127.0.0.1:3507) with tools/dev/local_stack.py, creates a test-only owner with a
random password generated for this run, starts nothing itself (Playwright's webServer starts the built API and web app with this
environment), runs Playwright, and drops the scratch database, account and secrets afterwards — also when the tests fail.
Build first: contracts, API and web (`tools/ci/run_ci.py` does).
"""
from __future__ import annotations

import os
import secrets
import shutil
import tempfile
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
PY = sys.executable
STACK = APP / "tools" / "dev" / "local_stack.py"

# real match footage (CC BY-SA 4.0, Wikimedia Commons; .local/eval-footage/SOURCES.json) for the analysis journey; skipped when absent
FOOTAGE = ROOT / ".local" / "eval-footage" / "france_germany_ccbysa.ogv"


def main() -> int:
    name = f"e2e-{secrets.token_hex(4)}"
    try:
        out = subprocess.run([PY, str(STACK), "env", "--stack", name], capture_output=True, text=True, check=True).stdout
        env = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
        email, password = f"e2e-owner-{secrets.token_hex(3)}@test.invalid", secrets.token_urlsafe(18)
        boot = subprocess.run([PY, str(STACK), "bootstrap-owner", "--stack", name, "--email", email, "--name", "E2E Test Owner", "--organization", "E2E Test Organization"],
                              env={**os.environ, "OTSI_VIE_BOOTSTRAP_PASSWORD": password}, capture_output=True, text=True)
        if boot.returncode != 0:
            print(boot.stdout, boot.stderr)
            return 1
        media = Path(tempfile.mkdtemp(prefix="otsi-e2e-media-"))         # synthetic test videos for this run only (ADR-020)
        subprocess.run([PY, str(APP / "tools" / "dev" / "test_media.py"), str(media)], check=True, capture_output=True)
        run_env = {**os.environ, **env, "OTSI_E2E_EMAIL": email, "OTSI_E2E_PASSWORD": password, "NEXT_TELEMETRY_DISABLED": "1",
                   "OTSI_E2E_MEDIA": str(media), "OTSI_E2E_PYTHON": PY, "OTSI_E2E_FOOTAGE": str(FOOTAGE) if FOOTAGE.exists() else "", "OTSI_VIE_UPLOAD_PART_BYTES": str(1024 * 1024),
                   "PLAYWRIGHT_BROWSERS_PATH": os.environ.get("PLAYWRIGHT_BROWSERS_PATH", str(ROOT.parent / "_tmp" / "ms-playwright"))}
        corepack = shutil.which("corepack") or "corepack"
        return subprocess.run([corepack, "pnpm", "e2e", *sys.argv[1:]], cwd=APP / "apps" / "web", env=run_env).returncode
    finally:
        subprocess.run([PY, str(STACK), "drop", "--stack", name], capture_output=True, text=True)
        if "media" in locals():
            shutil.rmtree(media, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
