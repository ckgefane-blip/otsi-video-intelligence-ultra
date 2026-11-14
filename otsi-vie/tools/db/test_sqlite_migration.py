"""Tests for the SQLite backend (safeguard 6): bootstrap, backup-first
transactional migrations, restore-on-failure, and the translated triggers.

Run with the standard library only (no pytest, no MySQL server needed):

  python otsi-vie/tools/db/test_sqlite_migration.py
  python -m unittest discover -s otsi-vie/tools/db -p "test_sqlite_migration.py"
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import migrate  # noqa: E402
import sqlite_translate as st  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def norm_ddl(sql: str | None) -> str:
    if not sql:
        return ""
    sql = re.sub(r'"([^"]+)"', r"`\1`", sql)
    sql = re.sub(r"\s*,\s*", ", ", sql)  # `)),` and `)) ,` are the same DDL
    sql = re.sub(r"\(\s+", "(", sql)
    sql = re.sub(r"\s+\)", ")", sql)
    return " ".join(sql.split())


class SqliteTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.db = self.dir / "vie.sqlite"
        self.dsn = f"sqlite:///{self.db}"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db))
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def bootstrap(self) -> list[str]:
        return migrate.bootstrap_sqlite(self.dsn)

    # -- schema ---------------------------------------------------- #

    def test_bootstrap_schema_is_complete(self) -> None:
        self.bootstrap()
        conn = self.connect()
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        self.assertEqual(len(tables), 163)  # 162 schema tables + schema_migrations
        for expected in ("players", "tracks", "wallet_ledger", "countries",
                         "canonical_id_issuances", "audit_events", "bank_transfer_orders"):
            self.assertIn(expected, tables)
        strict = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND sql LIKE '%STRICT'").fetchone()[0]
        self.assertEqual(strict, 163)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM countries").fetchone()[0], 253)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0], 78)
        views = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='view'")]
        self.assertEqual(sorted(views), ["v_player_identity", "v_run_team_current",
                                         "v_track_current_identity", "v_track_jersey_current",
                                         "v_track_link_current"])
        self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])
        # Dates are INTEGER ms, not text.
        conn.execute("INSERT INTO users (id, external_subject, email, display_name) "
                     "VALUES ('u1', 'ext1', 'a@example.com', 'A')")
        row = conn.execute("SELECT typeof(created_at), created_at FROM users WHERE id='u1'").fetchone()
        self.assertEqual(row[0], "integer")
        self.assertTrue(1_700_000_000_000 < row[1] < 1_900_000_000_000)
        conn.close()

    def test_incremental_migrations_match_bootstrap(self) -> None:
        """Applying every per-migration file in order must give exactly the
        schema the bootstrap file creates (tables, columns, indexes, views,
        triggers, and normalised DDL)."""
        ran = migrate.up_sqlite(self.dsn)  # empty file -> bootstrap
        self.assertEqual(len(ran), 78)
        boot = self._snapshot()

        db2 = self.dir / "incremental.sqlite"
        conn = migrate.sqlite_connect(db2)
        conn.execute(migrate.SQLITE_BOOTSTRAP_TABLE)
        conn.close()
        ran2 = migrate.up_sqlite(f"sqlite:///{db2}")
        self.assertEqual(len(ran2), 78)
        inc = self._snapshot(db2)
        self.assertEqual(boot, inc)

    def _snapshot(self, path: Path | None = None) -> dict:
        path = path or self.db
        conn = sqlite3.connect(str(path))
        snap: dict = {"tables": {}, "indexes": [], "views": [], "triggers": []}
        for name, sql in conn.execute(
                "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
            cols = [(r[1], r[2], r[3], r[5]) for r in conn.execute(f"PRAGMA table_info(`{name}`)")]
            snap["tables"][name] = {"cols": cols, "ddl": norm_ddl(sql)}
        snap["indexes"] = sorted(r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"))
        snap["views"] = sorted(r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='view'"))
        snap["triggers"] = sorted(r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'"))
        conn.close()
        return snap

    def test_up_is_a_noop_when_nothing_is_pending(self) -> None:
        self.bootstrap()
        self.assertEqual(migrate.up_sqlite(self.dsn), [])
        rows = [r for r in migrate.status_sqlite(self.dsn)]
        self.assertTrue(all(s == "applied" for _, _, s in rows))
        self.assertEqual(len(rows), 78)

    def test_upgrade_from_previous_tip_drops_stale_checks(self) -> None:
        """A database built at the previous tip (old 0007/0013) upgrades to
        the new tip: no checksum mismatch, and the stale CHECKs are gone.
        Regression test for the db27ed3 blocker, where the translator fix
        changed the already-applied 0007/0013 SQLite files, so migrate.py
        refused to start on any existing database ("checksum mismatch").
        The old files live in tools/db/fixtures/ as byte copies of the
        pre-Invite files, pinned by hash below, so this test does not depend
        on the current repo files: run it with the db27ed3 0007/0013 in place
        and it fails with the checksum mismatch, proving it catches the bug.
        """
        fixtures = ROOT / "tools" / "db" / "fixtures"
        old_0007 = fixtures / "0007_canonical_player_registry.pre-invite.sqlite.sql"
        old_0013 = fixtures / "0013_detection_tracking_playback.pre-invite.sqlite.sql"
        # The fixtures are the applied files, byte for byte (pre-Invite).
        self.assertEqual(sha256(old_0007),
                         "5ba99059573c72f1a9a2ceedb087ab54971270f6ebd23f589a97ac6fc93f8a17")
        self.assertEqual(sha256(old_0013),
                         "8b8923a67ddc757bc61f367c34588823274e8f55cd21ecf632eeb152a926f89b")
        # The "previous tip" migration set: every current SQLite migration up
        # to 0078, but with the OLD 0007/0013 in place of the current ones.
        prev = [m for m in migrate.discover_sqlite()
                if m.version not in ("0007", "0013", "0079")]
        prev.append(migrate.Migration("0007", "0007_canonical_player_registry.sqlite.sql", old_0007))
        prev.append(migrate.Migration("0013", "0013_detection_tracking_playback.sqlite.sql", old_0013))
        prev.sort(key=lambda m: m.version)
        # Build a database at the previous tip.
        db_prev = self.dir / "prev.sqlite"
        conn = migrate.sqlite_connect(db_prev)
        conn.execute(migrate.SQLITE_BOOTSTRAP_TABLE)
        conn.close()
        ran_prev = migrate.up_sqlite(f"sqlite:///{db_prev}", migrations=prev)
        self.assertEqual(len(ran_prev), 77)
        # The old database has the stale CHECK on tracks — and it is enforced:
        # a PERSON track (0013's whole point: a track IS a person until
        # classified) is refused by the stale CHECK that forbids PERSON.
        conn = sqlite3.connect(str(db_prev))
        conn.execute("PRAGMA foreign_keys=ON")
        tracks_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='tracks'").fetchone()[0]
        self.assertIn("CHECK (class_name IN ('PLAYER','GOALKEEPER','REFEREE','BALL','OTHER'))", tracks_sql)
        self._seed_org_user(conn)
        conn.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, created_by) "
                     "VALUES ('v1', 'o1', 'p1', 'UPLOAD', 'u1')")
        conn.execute("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version) "
                     "VALUES ('run1', 'v1', 'o1', '1')")
        conn.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, "
                         "first_pts_us, last_pts_us) VALUES ('t1', 'run1', 'v1', 1, 'PERSON', 0, 1000)")
        conn.rollback()
        conn.close()
        # Upgrade to the new tip with the CURRENT repo files: this must not
        # raise a checksum mismatch, and it must apply exactly 0079.
        ran = migrate.up_sqlite(f"sqlite:///{db_prev}")
        self.assertEqual(ran, ["0079_drop_stale_checks.sqlite.sql"])
        # The stale CHECK is gone; ck_tracks_class (with PERSON) stays; a
        # PERSON track now inserts fine.
        conn = sqlite3.connect(str(db_prev))
        conn.execute("PRAGMA foreign_keys=ON")
        tracks_sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='tracks'").fetchone()[0]
        self.assertNotIn("CHECK (class_name IN ('PLAYER','GOALKEEPER','REFEREE','BALL','OTHER'))", tracks_sql)
        self.assertIn("ck_tracks_class", tracks_sql)
        self.assertIn("'PERSON'", tracks_sql)
        conn.execute("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, "
                     "first_pts_us, last_pts_us) VALUES ('t1', 'run1', 'v1', 1, 'PERSON', 0, 1000)")
        conn.commit()
        self.assertEqual(conn.execute(
            "SELECT COUNT(*) FROM schema_migrations").fetchone()[0], 78)
        kept = {r[0]: r[1] for r in conn.execute(
            "SELECT version, sha256 FROM schema_migrations WHERE version IN ('0007', '0013')")}
        self.assertEqual(kept["0007"],
                         "5ba99059573c72f1a9a2ceedb087ab54971270f6ebd23f589a97ac6fc93f8a17")
        self.assertEqual(kept["0013"],
                         "8b8923a67ddc757bc61f367c34588823274e8f55cd21ecf632eeb152a926f89b")
        conn.close()

    def test_bootstrap_refuses_an_applied_database(self) -> None:
        self.bootstrap()
        with self.assertRaises(migrate.MigrationError):
            migrate.bootstrap_sqlite(self.dsn)

    def test_sqlite_statement_splitter_keeps_triggers_whole(self) -> None:
        sql = ("CREATE TRIGGER t BEFORE UPDATE ON x BEGIN "
               "SELECT RAISE(ABORT, 'no'); END;\nCREATE TABLE y (id INTEGER);")
        self.assertEqual(len(migrate.split_sqlite_statements(sql)), 2)

    # -- backup / restore ------------------------------------------ #

    def test_backup_manifest_matches_the_files(self) -> None:
        self.bootstrap()
        conn = self.connect()
        conn.execute("INSERT INTO organizations (id, name, slug) VALUES ('o1', 'Org', 'org')")
        conn.commit()
        conn.close()
        backup = migrate.backup_sqlite(self.db)
        manifest = json.loads((backup / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["backend"], "sqlite")
        for name, info in manifest["files"].items():
            self.assertEqual(sha256(backup / name), info["sha256"])
        # Restore round-trip into a fresh path keeps the row.
        copy = self.dir / "restored.sqlite"
        migrate.restore_sqlite(copy, backup)
        conn = sqlite3.connect(str(copy))
        self.assertEqual(conn.execute("SELECT name FROM organizations WHERE id='o1'").fetchone()[0], "Org")
        conn.close()

    def test_failing_migration_restores_the_backup_byte_identical(self) -> None:
        self.bootstrap()
        conn = self.connect()
        conn.execute("INSERT INTO organizations (id, name, slug) VALUES ('o1', 'Org', 'org')")
        conn.commit()
        conn.close()
        bad = self.dir / "9999_broken.sqlite.sql"
        bad.write_text("CREATE TABLE `broken_table` (id INTEGER PRIMARY KEY);\n"
                       "THIS IS NOT SQL;\n", encoding="utf-8")
        broken = migrate.Migration("9999", "9999_broken.sqlite.sql", bad)
        with self.assertRaises(migrate.MigrationError) as ctx:
            migrate.up_sqlite(self.dsn, migrations=migrate.discover_sqlite() + [broken])
        self.assertIn("restored from the backup", str(ctx.exception))
        self.assertIn("9999_broken", str(ctx.exception))
        # The backup the run took is there, and the database matches it byte for byte.
        backups = sorted((self.db.parent / ".backups").iterdir())
        self.assertEqual(len(backups), 1)
        manifest = json.loads((backups[0] / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(sha256(self.db), manifest["files"][self.db.name]["sha256"])
        self.assertNotIn("broken_table", self._snapshot()["tables"])
        conn = self.connect()
        self.assertEqual(conn.execute("SELECT name FROM organizations WHERE id='o1'").fetchone()[0], "Org")
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0], 78)
        conn.close()

    # -- translated behaviour -------------------------------------- #

    def _seed_org_user(self, conn: sqlite3.Connection) -> None:
        conn.execute("INSERT INTO organizations (id, name, slug) VALUES ('o1', 'Org', 'org')")
        conn.execute("INSERT INTO users (id, external_subject, email, display_name) "
                     "VALUES ('u1', 'ext1', 'a@example.com', 'A')")
        conn.execute("INSERT INTO projects (id, organization_id, name, created_by) "
                     "VALUES ('p1', 'o1', 'Proj', 'u1')")
        conn.commit()

    def test_append_only_triggers(self) -> None:
        self.bootstrap()
        conn = self.connect()
        self._seed_org_user(conn)
        conn.execute("INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id) "
                     "VALUES ('o1', 'u1', 'test.did', 'player', 'x')")
        conn.commit()
        with self.assertRaises(sqlite3.IntegrityError) as ctx:
            conn.execute("UPDATE audit_events SET action='test.changed' WHERE entity_id='x'")
        self.assertIn("AUDIT_EVENTS_APPEND_ONLY", str(ctx.exception))
        conn.rollback()
        with self.assertRaises(sqlite3.IntegrityError) as ctx:
            conn.execute("DELETE FROM audit_events WHERE entity_id='x'")
        self.assertIn("AUDIT_EVENTS_APPEND_ONLY", str(ctx.exception))
        conn.close()

    def test_wallet_ledger_is_immutable(self) -> None:
        self.bootstrap()
        conn = self.connect()
        self._seed_org_user(conn)
        # A PURCHASE row without an invoice reference breaks the ledger's CHECK.
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO wallet_ledger (id, organization_id, kind, amount, balance_after, "
                         "idempotency_key) VALUES ('w1', 'o1', 'PURCHASE', 100, 100, 'k1')")
        conn.rollback()
        conn.execute("INSERT INTO wallet_ledger (id, organization_id, kind, amount, balance_after, "
                     "idempotency_key, invoice_ref) VALUES ('w1', 'o1', 'PURCHASE', 100, 100, 'k1', 'INV-1')")
        conn.commit()
        with self.assertRaises(sqlite3.IntegrityError) as ctx:
            conn.execute("UPDATE wallet_ledger SET amount=200 WHERE id='w1'")
        self.assertIn("wallet_ledger is immutable", str(ctx.exception))
        conn.rollback()
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("DELETE FROM wallet_ledger WHERE id='w1'")
        conn.close()

    def test_render_state_machine_trigger(self) -> None:
        self.bootstrap()
        conn = self.connect()
        self._seed_org_user(conn)
        conn.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, created_by) "
                     "VALUES ('v1', 'o1', 'p1', 'UPLOAD', 'u1')")
        conn.execute("INSERT INTO reel_projects (id, organization_id, project_id, video_id, name, created_by) "
                     "VALUES ('r1', 'o1', 'p1', 'v1', 'Reel', 'u1')")
        conn.execute("INSERT INTO render_jobs (id, reel_id, organization_id, requested_by, config, idempotency_key) "
                     "VALUES ('j1', 'r1', 'o1', 'u1', '{}', 'k1')")
        conn.commit()
        with self.assertRaises(sqlite3.IntegrityError) as ctx:
            conn.execute("UPDATE render_jobs SET state='SUCCEEDED' WHERE id='j1'")
        self.assertIn("INVALID_RENDER_STATE_TRANSITION", str(ctx.exception))
        conn.rollback()
        conn.execute("UPDATE render_jobs SET state='RUNNING' WHERE id='j1'")
        with self.assertRaises(sqlite3.IntegrityError) as ctx:
            conn.execute("UPDATE render_jobs SET state='SUCCEEDED' WHERE id='j1'")
        self.assertIn("RENDER_ASSET_AND_MANIFEST_REQUIRED", str(ctx.exception))
        conn.close()

    def test_canonical_player_guards(self) -> None:
        self.bootstrap()
        conn = self.connect()
        self._seed_org_user(conn)
        with self.assertRaises(sqlite3.IntegrityError) as ctx:
            conn.execute("INSERT INTO players (id, display_name, canonical_otsi_id) "
                         "VALUES ('pl1', 'One', 'OTSI-NGA-2026-000001')")
        self.assertIn("CANONICAL_ID_ONLY_BY_ALLOCATOR", str(ctx.exception))
        conn.rollback()
        with self.assertRaises(sqlite3.IntegrityError) as ctx:
            conn.execute("INSERT INTO players (id, display_name, canonical_state) "
                         "VALUES ('pl1', 'One', 'REGISTERED')")
        self.assertIn("NEW_PLAYERS_ARE_PROVISIONAL", str(ctx.exception))
        conn.rollback()
        conn.execute("INSERT INTO players (id, display_name) VALUES ('pl1', 'One')")
        conn.commit()
        # Setting an ID with no issuance row is refused as "not issued".
        with self.assertRaises(sqlite3.IntegrityError) as ctx:
            conn.execute("UPDATE players SET canonical_otsi_id='OTSI-NGA-2026-000001' WHERE id='pl1'")
        self.assertIn("CANONICAL_ID_NOT_ISSUED_TO_THIS_PLAYER", str(ctx.exception))
        conn.rollback()
        # With the issuance recorded (the allocator's job, done here directly),
        # the ID can be set once — and then it can never change.
        conn.execute("INSERT INTO canonical_id_issuances (canonical_otsi_id, player_id, country_code, "
                     "issue_year, sequence_number, issuing_organization_id, issued_by) "
                     "VALUES ('OTSI-NGA-2026-000001', 'pl1', 'NGA', 2026, 1, 'o1', 'u1')")
        conn.execute("UPDATE players SET canonical_otsi_id='OTSI-NGA-2026-000001', "
                     "canonical_state='REGISTERED' WHERE id='pl1'")
        conn.commit()
        with self.assertRaises(sqlite3.IntegrityError) as ctx:
            conn.execute("UPDATE players SET canonical_otsi_id='OTSI-NGA-2026-000002' WHERE id='pl1'")
        self.assertIn("CANONICAL_ID_IMMUTABLE", str(ctx.exception))
        conn.rollback()
        # The identity view resolves the player to itself while unmerged.
        row = conn.execute("SELECT resolved_player_id FROM v_player_identity WHERE player_id='pl1'").fetchone()
        self.assertEqual(row[0], "pl1")
        conn.close()

    def test_identity_decision_reason_trigger(self) -> None:
        self.bootstrap()
        conn = self.connect()
        self._seed_org_user(conn)
        conn.execute("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, created_by) "
                     "VALUES ('v1', 'o1', 'p1', 'UPLOAD', 'u1')")
        conn.execute("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version) "
                     "VALUES ('run1', 'v1', 'o1', '1')")
        conn.execute("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, "
                     "first_pts_us, last_pts_us) VALUES ('t1', 'run1', 'v1', 1, 'PLAYER', 0, 1000)")
        conn.execute("INSERT INTO players (id, display_name) VALUES ('pl1', 'One')")
        conn.execute("INSERT INTO track_identity_decisions (id, track_id, player_id, state, decided_by, basis) "
                     "VALUES ('d1', 't1', 'pl1', 'CONFIRMED', 'u1', 'HUMAN')")
        conn.commit()
        with self.assertRaises(sqlite3.IntegrityError) as ctx:
            conn.execute("INSERT INTO track_identity_decisions (id, track_id, player_id, state, decided_by, "
                         "basis, supersedes_id, reason) "
                         "VALUES ('d2', 't1', 'pl1', 'CONFIRMED', 'u1', 'HUMAN', 'd1', 'x')")
        self.assertIn("CORRECTION_REASON_REQUIRED", str(ctx.exception))
        conn.close()

    def test_updated_at_touch_trigger(self) -> None:
        self.bootstrap()
        conn = self.connect()
        self._seed_org_user(conn)
        conn.execute("INSERT INTO library_folders (id, organization_id, name, created_by) "
                     "VALUES ('f1', 'o1', 'Folder', 'u1')")
        conn.commit()
        before = conn.execute("SELECT updated_at FROM library_folders WHERE id='f1'").fetchone()[0]
        conn.execute("UPDATE library_folders SET name='Renamed' WHERE id='f1'")
        conn.commit()
        after = conn.execute("SELECT updated_at FROM library_folders WHERE id='f1'").fetchone()[0]
        self.assertIsInstance(before, int)
        self.assertGreater(after, before)
        conn.close()

    def test_json_enum_length_and_fk_checks(self) -> None:
        self.bootstrap()
        conn = self.connect()
        self._seed_org_user(conn)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO clubs (id, canonical_name, external_ids) "
                         "VALUES ('c1', 'Club', 'not json')")
        conn.rollback()
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status) "
                         "VALUES ('run1', 'v1', 'o1', '1', 'BOGUS')")
        conn.rollback()
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO organizations (id, name, slug) VALUES ('o2', '" + "x" * 256 + "', 'o2')")
        conn.rollback()
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, "
                         "first_pts_us, last_pts_us) VALUES ('t1', 'no-such-run', 'v1', 1, 'PLAYER', 0, 1)")
        conn.close()

    def test_collation_decisions(self) -> None:
        self.bootstrap()
        conn = self.connect()
        # Slugs: MySQL _ai_ci is case-insensitive, so NOCASE must collide.
        conn.execute("INSERT INTO organizations (id, name, slug) VALUES ('o1', 'Org', 'My-Club')")
        conn.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO organizations (id, name, slug) VALUES ('o2', 'Org2', 'my-club')")
        conn.rollback()
        # Country codes: explicit ascii_bin, so BINARY. The format CHECK needs
        # upper case, so a lower-case code is refused by the CHECK itself —
        # prove the collation separately: BINARY says 'NGA' <> 'nga', NOCASE
        # says they are equal.
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO countries (code, name, kind) VALUES ('zza', 'Test a', 'ISO3166_1')")
        conn.rollback()
        self.assertEqual(conn.execute("SELECT 'NGA' = 'nga' COLLATE BINARY").fetchone()[0], 0)
        self.assertEqual(conn.execute("SELECT 'NGA' = 'nga' COLLATE NOCASE").fetchone()[0], 1)
        # The collation appendix records both decisions.
        rows = {f"{r[0]}.{r[1]}": r[4] for r in csv_rows()}
        self.assertEqual(rows["organizations.slug"], "NOCASE")
        self.assertEqual(rows["countries.code"], "BINARY")
        conn.close()


def csv_rows():
    import csv as _csv

    with open(ROOT / "database" / "sqlite-column-collations.csv", encoding="utf-8") as f:
        return [(r["table"], r["column"], r["mysql_type"], r["sqlite_type"], r["sqlite_collation"])
                for r in _csv.DictReader(f)]


class TranslatorTestCase(unittest.TestCase):
    def test_translator_covers_all_migrations(self) -> None:
        report = json.loads((ROOT / "database" / "sqlite-translation-report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["tables"], 162)
        self.assertEqual(len(report["migrations"]), 78)
        self.assertEqual(sorted(report["procedures"]), ["sp_issue_canonical_player_id", "sp_merge_players"])
        self.assertEqual(report["triggers"], 34)  # one per MySQL trigger
        self.assertEqual(report["views"], 5)
        files = sorted((ROOT / "database" / "migrations-sqlite").glob("*.sqlite.sql"))
        self.assertEqual(len(files), 78)


if __name__ == "__main__":
    unittest.main(verbosity=2)
