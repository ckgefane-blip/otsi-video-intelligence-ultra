"""The product's media path uses only the LGPL FFmpeg build, in separate processes (ADR-029, owner decision E1 2026-10-27)."""
import ast
from pathlib import Path

from vie_worker import ff

PKG = Path(__file__).resolve().parents[1] / "vie_worker"


def test_no_worker_module_imports_pyav():
    offenders = []
    for f in PKG.rglob("*.py"):
        for node in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""] if isinstance(node, ast.ImportFrom) else []
            if any(n == "av" or n.startswith("av.") for n in names):
                offenders.append(str(f.relative_to(PKG)))
    assert offenders == []


def test_the_installed_build_reports_lgpl_and_no_gpl_or_nonfree_flags():
    exe = ff.tool("ffmpeg")                     # tool() refuses a GPL/nonfree build
    text = " ".join(ff.run(["-hide_banner", "-L"]).stdout.decode().split())
    assert "GNU Lesser General Public License" in text and "GNU General Public License" not in text
    conf = ff.run(["-hide_banner", "-buildconf"]).stdout.decode()
    assert "--enable-gpl" not in conf and "--enable-nonfree" not in conf and "--enable-libx264" not in conf
    assert exe


def test_the_licence_check_refuses_a_gpl_build(monkeypatch, tmp_path):
    import subprocess
    calls = {"-L": "it under the terms of the GNU General Public\nLicense", "-buildconf": "--enable-gpl --enable-libx264"}   # wrapped, as FFmpeg prints it

    def fake(cmd, **kw):
        return subprocess.CompletedProcess(cmd, 0, stdout=calls[cmd[-1]], stderr="")
    monkeypatch.setattr(ff.subprocess, "run", fake)
    monkeypatch.delenv("OTSI_VIE_ALLOW_GPL_FFMPEG", raising=False)
    ff._check_licence.cache_clear()
    try:
        ff._check_licence(str(tmp_path / "gpl-ffmpeg.exe"))
        raise AssertionError("a GPL build was accepted")
    except ff.FFmpegError as e:
        assert "GPL" in str(e)
    finally:
        ff._check_licence.cache_clear()
