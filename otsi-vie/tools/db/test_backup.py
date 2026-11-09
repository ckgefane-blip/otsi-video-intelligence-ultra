"""Backup recovery regression checks; all Docker operations are mocked here."""
import contextlib
import gzip
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import backup

CID = "a" * 64
LOCAL = backup.LOCAL / "backup-unit-tests"


class BackupTests(unittest.TestCase):
    def setUp(self):
        LOCAL.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=LOCAL)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = self.root / "fixture.env"
        self.env.write_text("MYSQL_ROOT_PASSWORD=synthetic-test-only\n")

    def lifecycle(self, removal=0):
        calls = []
        def run(args, **kwargs):
            calls.append(args)
            rc = removal if args[1] == "rm" else 0
            return subprocess.CompletedProcess(args, rc, stdout=CID if args[1] == "create" else "", stderr="")
        return calls, run

    def test_isolated_disk_storage_and_cleanup_after_failure(self):
        calls, run = self.lifecycle()
        storage = self.root / "restore"
        with patch.object(backup, "RESTORE_ROOT", storage), patch.object(backup, "RESTORE_ENV", self.env), \
             patch.object(backup.subprocess, "run", side_effect=run), \
             patch.object(backup, "dexec", return_value=subprocess.CompletedProcess([], 0, b"3306\n")):
            with self.assertRaisesRegex(RuntimeError, "failed midway"):
                with backup.restore_server() as (cid, name, directory):
                    self.assertEqual(cid, CID)
                    self.assertTrue(directory.is_relative_to(storage.resolve()))
                    raise RuntimeError("failed midway")
        create = calls[0]
        self.assertIn("none", create)
        self.assertEqual(create[create.index("--network") + 1], "none")
        self.assertIn("--mount", create)
        self.assertIn("--pull", create)
        self.assertNotIn("--tmpfs", create)
        self.assertNotIn("-p", create)
        self.assertNotIn("--publish", create)
        self.assertNotIn("otsi-vie-v2-mysql-lint", create)
        self.assertEqual(calls[-1], ["docker", "rm", "-f", CID])
        self.assertEqual(list(storage.iterdir()), [])

    def test_failed_container_removal_preserves_mounted_data(self):
        calls, run = self.lifecycle(removal=1)
        storage = self.root / "restore"
        with patch.object(backup, "RESTORE_ROOT", storage), patch.object(backup, "RESTORE_ENV", self.env), \
             patch.object(backup.subprocess, "run", side_effect=run), \
             patch.object(backup, "dexec", return_value=subprocess.CompletedProcess([], 0, b"3306\n")):
            with self.assertRaisesRegex(RuntimeError, "cleanup failed"):
                with backup.restore_server() as (_, _, directory):
                    (directory / "mysql" / "fixture").write_text("keep while mounted")
        self.assertTrue((directory / "mysql" / "fixture").is_file())

    def test_capacity_failure_never_creates_container(self):
        with patch.object(backup, "RESTORE_ROOT", self.root / "restore"), patch.object(backup, "RESTORE_ENV", self.env), \
             patch.object(backup.shutil, "disk_usage", return_value=type("Disk", (), {"free": 1})()), \
             patch.object(backup.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "8 GiB"):
                with backup.restore_server():
                    self.fail("must not start")
        run.assert_not_called()

    def test_verification_reports_row_mismatch_only_after_cleanup(self):
        folder = self.root / "backup"
        folder.mkdir()
        (folder / "manifest.json").write_text(json.dumps({"source_row_counts": {"fixture": 2}}))
        with gzip.open(folder / "db.sql.gz", "wb") as f:
            f.write(b"CREATE DATABASE `source`;\nUSE `source`;\nSELECT 1;\n")
        from io import BytesIO
        class Process:
            stdin = BytesIO()
            def wait(self): return 0
            def poll(self): return 0
        states = []
        @contextlib.contextmanager
        def server():
            states.append("opened")
            yield CID, "fixture-server", self.root
            self.assertFalse((folder / "verify.json").exists())
            states.append("cleaned")
        with patch.object(backup, "restore_server", server), patch.object(backup.subprocess, "Popen", return_value=Process()), \
             patch.object(backup, "counts", return_value={"fixture": 1}), \
             patch.object(backup, "dexec", return_value=subprocess.CompletedProcess([], 0, b"2\t3\n")):
            self.assertFalse(backup.verify(folder))
        result = json.loads((folder / "verify.json").read_text())
        self.assertEqual(states, ["opened", "cleaned"])
        self.assertEqual(result["mismatches"], {"fixture": [2, 1]})
        self.assertTrue(result["container_removed"])

    def test_cleanup_error_does_not_publish_success(self):
        folder = self.root / "backup"
        folder.mkdir()
        (folder / "manifest.json").write_text(json.dumps({"source_row_counts": {}}))
        @contextlib.contextmanager
        def server():
            raise RuntimeError("cleanup failed")
            yield
        with patch.object(backup, "restore_server", server):
            with self.assertRaisesRegex(RuntimeError, "cleanup failed"):
                backup.verify(folder)
        self.assertFalse((folder / "verify.json").exists())


if __name__ == "__main__":
    unittest.main()
