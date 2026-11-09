"""Malware scan of every ingested file before any decoder reads it (threat model 3.4; ADR-027).

Scanner: Microsoft Defender's command-line scanner on Windows (MpCmdRun -Scan -ScanType 3 -File <f> -DisableRemediation: exit 0 = no
threat, 2 = threat found), or ClamAV `clamscan` where configured (exit 0 clean, 1 infected). OTSI_VIE_AV_SCANNER = auto (default) | defender
| clamav | none. When no scanner is available the result is recorded honestly as "not_scanned" — never as clean.
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess

TIMEOUT_S = 1800


def _defender() -> str | None:
    cands = sorted(glob.glob(r"C:\ProgramData\Microsoft\Windows Defender\Platform\*\MpCmdRun.exe"), reverse=True)
    cands.append(r"C:\Program Files\Windows Defender\MpCmdRun.exe")
    return next((c for c in cands if os.path.exists(c)), None)


def scan(path: str) -> dict:
    mode = os.environ.get("OTSI_VIE_AV_SCANNER", "auto").lower()
    if mode == "none":
        return {"scanner": None, "result": "not_scanned", "detail": "scanning disabled by configuration"}
    if mode in ("auto", "defender") and os.name == "nt" and (exe := _defender()):
        try:
            p = subprocess.run([exe, "-Scan", "-ScanType", "3", "-File", os.path.abspath(path), "-DisableRemediation"],
                               capture_output=True, text=True, timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return {"scanner": "microsoft-defender", "result": "error", "detail": "scan timed out"}
        if p.returncode == 0:
            return {"scanner": "microsoft-defender", "result": "clean", "detail": None}
        if p.returncode == 2:
            threat = next((l.strip() for l in p.stdout.splitlines() if "Threat" in l), "threat found")
            return {"scanner": "microsoft-defender", "result": "threat", "detail": threat[:300]}
        return {"scanner": "microsoft-defender", "result": "error", "detail": f"exit code {p.returncode}"}
    if mode in ("auto", "clamav") and (exe := shutil.which("clamscan")):
        p = subprocess.run([exe, "--no-summary", path], capture_output=True, text=True, timeout=TIMEOUT_S)
        if p.returncode == 0:
            return {"scanner": "clamav", "result": "clean", "detail": None}
        if p.returncode == 1:
            return {"scanner": "clamav", "result": "threat", "detail": p.stdout.strip()[:300]}
        return {"scanner": "clamav", "result": "error", "detail": f"exit code {p.returncode}"}
    return {"scanner": None, "result": "not_scanned", "detail": "no malware scanner is available on this machine"}
