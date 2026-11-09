"""
v3 Phase D.5 part 1 (ADR-101): back up the owner database and media storage, and prove the backup restores.

  backup.py backup [--stack owner] [--with-storage]   dump otsi_owner_vie (consistent snapshot: --single-transaction, with routines,
                                                       triggers and events) to .local/backups/<UTC time>/db.sql.gz, write a manifest
                                                       of the storage folder (path, size, mtime) and, with --with-storage, copy the
                                                       files that are new or changed since the last backup (hard-linking unchanged ones)
  backup.py verify [<backup folder>]                   restore into a new temporary MySQL container (disk on D:, no exposed port),
                                                       compare every table's row count with the source, remove that container and
                                                       its data, and write verify.json next to the dump

Passwords never leave the containers: mysqldump and mysql run inside them with the container's own MYSQL_ROOT_PASSWORD. Read-only on the
owner server (a dump); never touches the MySQL on 3306; everything is written under VIE-Engine-v2/.local on D:.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import datetime as dt
import gzip
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]                    # VIE-Engine-v2
LOCAL = ROOT / ".local"
BACKUPS = LOCAL / "backups"
OWNER, OWNER_DB = "otsi-vie-v2-mysql", "otsi_owner_vie"
SCRATCH_DB = "otsi_restore_check"
RESTORE_ROOT = LOCAL / "restore-checks"
MYSQL_IMAGE = "mysql:8.4@sha256:76f0358884cb92d9a086d24e5671c38048d3fef40f2588703d73eb55392d6b69"
RESTORE_ENV = LOCAL / "mysql-lint.env"
IN_CONTAINER = 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec {cmd}'


def dexec(container: str, cmd: str, *, stdin=None, stdout=subprocess.PIPE, check=True) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", "exec", "-i", container, "sh", "-c", IN_CONTAINER.format(cmd=cmd)], stdin=stdin, stdout=stdout,
                          stderr=subprocess.PIPE, check=check)


def counts(container: str, db: str) -> dict[str, int]:
    tables = dexec(container, f"mysql -uroot -N -e \"SELECT table_name FROM information_schema.tables WHERE table_schema='{db}' AND table_type='BASE TABLE' ORDER BY 1\"").stdout.decode().split()
    out: dict[str, int] = {}
    for t in tables:
        out[t] = int(dexec(container, f"mysql -uroot -N -e 'SELECT COUNT(*) FROM `{db}`.`{t}`'").stdout.decode().strip())
    return out


def storage_manifest(storage: Path) -> list[dict]:
    files = []
    for p in sorted(storage.rglob("*")) if storage.exists() else []:
        if p.is_file():
            st = p.stat()
            files.append({"path": p.relative_to(storage).as_posix(), "bytes": st.st_size, "mtime": int(st.st_mtime)})
    return files


def backup(stack: str, with_storage: bool, keep_last: int = 7) -> Path:
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = BACKUPS / stamp
    dest.mkdir(parents=True)
    dump = dest / "db.sql.gz"
    with gzip.open(dump, "wb", compresslevel=6) as gz:
        p = subprocess.Popen(["docker", "exec", OWNER, "sh", "-c", IN_CONTAINER.format(
            cmd=f"mysqldump -uroot --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF --databases {OWNER_DB}")],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert p.stdout
        for chunk in iter(lambda: p.stdout.read(1 << 20), b""):
            gz.write(chunk)
        err = p.stderr.read().decode() if p.stderr else ""
        if p.wait() != 0:
            raise SystemExit(f"mysqldump failed: {err.strip()[:400]}")
    storage = LOCAL / "stack" / stack / "storage"
    files = storage_manifest(storage)
    copied = linked = 0
    if with_storage:
        prev = sorted((d for d in BACKUPS.iterdir() if d.is_dir() and d.name < stamp and (d / "storage").exists()), reverse=True)
        last = prev[0] / "storage" if prev else None
        for f in files:
            src, out = storage / f["path"], dest / "storage" / f["path"]
            out.parent.mkdir(parents=True, exist_ok=True)
            old = last / f["path"] if last else None
            if old and old.exists() and old.stat().st_size == f["bytes"] and int(old.stat().st_mtime) == f["mtime"]:
                os.link(old, out); linked += 1                    # unchanged since the last backup: no second copy on disk
            else:
                shutil.copy2(src, out); copied += 1
    man = {"created_at": stamp, "database": OWNER_DB, "server": OWNER, "dump": dump.name, "dump_bytes": dump.stat().st_size,
           "source_row_counts": counts(OWNER, OWNER_DB), "storage": {"dir": str(storage), "files": len(files), "bytes": sum(f["bytes"] for f in files),
           "copied": with_storage, "new_or_changed": copied, "hard_linked": linked}}
    (dest / "manifest.json").write_text(json.dumps(man, indent=2), encoding="utf-8")
    (dest / "storage-files.json").write_text(json.dumps(files), encoding="utf-8")
    print(f"backup {dest}: dump {man['dump_bytes']} bytes, {len(man['source_row_counts'])} tables, storage {len(files)} files"
          + (f" ({copied} copied, {linked} linked)" if with_storage else " (manifest only)"))
    if keep_last > 0:
        prune_backups(keep_last)
    return dest


def prune_backups(keep: int = 7) -> list[str]:
    """Prunes older backups beyond the newest `keep` backups."""
    if not BACKUPS.exists() or keep <= 0:
        return []
    dirs = sorted([d for d in BACKUPS.iterdir() if d.is_dir() and (d / "manifest.json").exists()], key=lambda d: d.name, reverse=True)
    pruned = []
    for d in dirs[keep:]:
        shutil.rmtree(d, ignore_errors=True)
        pruned.append(d.name)
    if pruned:
        print(f"pruned {len(pruned)} older backups (kept newest {keep}): {', '.join(pruned)}", flush=True)
    return pruned


def list_backups() -> list[dict]:
    """Returns metadata for all available backups."""
    if not BACKUPS.exists():
        return []
    dirs = sorted([d for d in BACKUPS.iterdir() if d.is_dir() and (d / "manifest.json").exists()], key=lambda d: d.name, reverse=True)
    out = []
    for d in dirs:
        try:
            man = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
            verify_path = d / "verify.json"
            ver = json.loads(verify_path.read_text(encoding="utf-8")) if verify_path.exists() else None
            out.append({
                "id": d.name,
                "timestamp": man.get("created_at", d.name),
                "db_bytes": man.get("dump_bytes", (d / "db.sql.gz").stat().st_size if (d / "db.sql.gz").exists() else 0),
                "tables": len(man.get("source_row_counts", {})),
                "rows": sum(man.get("source_row_counts", {}).values()),
                "storage_files": man.get("storage", {}).get("files", 0),
                "storage_bytes": man.get("storage", {}).get("bytes", 0),
                "verified": ver is not None,
                "verified_at": ver.get("verified_at") if ver else None,
                "verification_ok": ver.get("ok") if ver else None,
            })
        except Exception:
            continue
    return out


@contextmanager
def restore_server():
    """A unique, offline server; never use or remove the owner/test containers."""
    if not RESTORE_ENV.is_file():
        raise RuntimeError("Missing local MySQL environment file; no container was created.")
    RESTORE_ROOT.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(RESTORE_ROOT).free < 8 * 1024 ** 3:
        raise RuntimeError("Restore verification needs at least 8 GiB free on D:; no container was created.")
    run = Path(tempfile.mkdtemp(prefix="verify-", dir=RESTORE_ROOT)).resolve()
    data = run / "mysql"
    data.mkdir()
    name = "otsi-vie-restore-" + uuid.uuid4().hex
    container = None
    try:
        # --pull never: reuse the pinned image already used by this project; no download or expense.
        created = subprocess.run(["docker", "create", "--pull", "never", "--name", name, "--network", "none",
                                  "--label", "otsi.vie.purpose=backup-verify", "--env-file", str(RESTORE_ENV),
                                  "--mount", f"type=bind,source={data},target=/var/lib/mysql", MYSQL_IMAGE, "--skip-log-bin"],
                                 capture_output=True, text=True)
        if created.returncode:
            raise RuntimeError("Could not create the isolated restore container; check Docker and the pinned local image.")
        container = created.stdout.strip()
        if len(container) != 64 or any(c not in "0123456789abcdef" for c in container):
            raise RuntimeError("Docker did not return a valid restore container ID.")
        started = subprocess.run(["docker", "start", container], capture_output=True)
        if started.returncode:
            raise RuntimeError("Could not start the isolated restore container.")
        for _ in range(180):
            # Require authenticated SQL, not mysqladmin ping (which also succeeds on access denied).
            ready = dexec(container, "mysql -uroot -N -e 'SELECT @@GLOBAL.port'", check=False)
            if ready.returncode == 0 and ready.stdout.strip() == b"3306":
                break
            time.sleep(1)
        else:
            raise RuntimeError("The isolated restore server did not become ready within 180 seconds.")
        print(f"verify: isolated server {name}, disk-backed on D:, no published port", flush=True)
        yield container, name, run
    finally:
        if container:
            removed = subprocess.run(["docker", "rm", "-f", container], capture_output=True)
            if removed.returncode:
                # Never erase mounted files while a server may still own them.
                raise RuntimeError(f"Restore container cleanup failed; retained its data at {run}.")
        # Remove only the unique directory created above, after removing its container.
        if run.parent != RESTORE_ROOT.resolve() or not run.name.startswith("verify-"):
            raise RuntimeError("Refusing cleanup outside the restore-check directory.")
        shutil.rmtree(run)


def verify(folder: Path | None) -> bool:
    folder = folder or max((d for d in BACKUPS.iterdir() if (d / "db.sql.gz").exists()), default=None)
    if not folder:
        raise SystemExit("No backup found under .local/backups.")
    man = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    # Retain prior evidence rather than presenting an old success as this attempt's result.
    result_path = folder / "verify.json"
    if result_path.exists():
        result_path.rename(folder / ("verify.previous-" + uuid.uuid4().hex + ".json"))
    with restore_server() as (container, server_name, run):
        dexec(container, f"mysql -uroot -e 'CREATE DATABASE `{SCRATCH_DB}`'")
        # Error output can contain source-row values. Keep it in the temporary directory, never print it.
        with tempfile.TemporaryFile(dir=run) as errors:
            proc = subprocess.Popen(["docker", "exec", "-i", container, "sh", "-c",
                                     IN_CONTAINER.format(cmd=f"mysql -uroot --binary-mode {SCRATCH_DB}")],
                                    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors)
            try:
                assert proc.stdin
                with gzip.open(folder / "db.sql.gz", "rb") as gz:
                    for line in gz:
                        if line.startswith(b"CREATE DATABASE ") or line.startswith(b"USE `"):
                            continue
                        proc.stdin.write(line)
                proc.stdin.close()
                if proc.wait() != 0:
                    raise RuntimeError("Restore failed; no verification result was written (source-row errors withheld).")
            finally:
                if proc.stdin and not proc.stdin.closed:
                    proc.stdin.close()
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
        got = counts(container, SCRATCH_DB)
        want = man["source_row_counts"]
        diff = {t: [want.get(t), got.get(t)] for t in sorted(set(want) | set(got)) if want.get(t) != got.get(t)}
        routines = dexec(container, f"mysql -uroot -N -e \"SELECT (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='{SCRATCH_DB}'), (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='{SCRATCH_DB}')\"").stdout.decode().split()
        res = {"verified_at": dt.datetime.now(dt.timezone.utc).isoformat(), "server": server_name,
               "storage": "temporary disk-backed container; no published port", "tables": len(got), "rows": sum(got.values()),
               "routines": int(routines[0]), "triggers": int(routines[1]), "mismatches": diff, "ok": not diff}
    # A success is published only after container and disk cleanup both completed.
    res["container_removed"] = True
    res["temporary_data_removed"] = True
    result_path.write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(f"verify {folder.name}: {'OK' if res['ok'] else 'MISMATCH'} - {res['tables']} tables, {res['rows']} rows, "
          f"{res['routines']} routines, {res['triggers']} triggers restored; temporary server and data removed", flush=True)
    return res["ok"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("backup")
    b.add_argument("--stack", default="owner")
    b.add_argument("--with-storage", action="store_true")
    b.add_argument("--keep-last", type=int, default=7, help="Number of recent backups to keep (default 7)")
    v = sub.add_parser("verify")
    v.add_argument("folder", nargs="?", type=Path)
    l = sub.add_parser("list")
    l.add_argument("--json", action="store_true", help="Output as JSON")
    p = sub.add_parser("prune")
    p.add_argument("--keep-last", type=int, default=7, help="Number of recent backups to keep (default 7)")
    a = ap.parse_args()
    if a.cmd == "backup":
        backup(a.stack, a.with_storage, a.keep_last)
    elif a.cmd == "verify":
        sys.exit(0 if verify(a.folder) else 1)
    elif a.cmd == "list":
        backups = list_backups()
        if a.json:
            print(json.dumps(backups, indent=2))
        else:
            print(f"Available backups ({len(backups)}):")
            for b_info in backups:
                v_str = f"VERIFIED OK ({b_info['verified_at'][:19]})" if b_info["verification_ok"] else ("VERIFY FAILED" if b_info["verified"] else "UNVERIFIED")
                print(f"  {b_info['id']}: {b_info['tables']} tables, {b_info['rows']} rows, {b_info['db_bytes'] / (1024*1024):.1f} MB [{v_str}]")
    elif a.cmd == "prune":
        prune_backups(a.keep_last)


if __name__ == "__main__":
    main()
