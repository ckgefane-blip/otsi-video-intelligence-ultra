"""Generate docs/database/DATABASE_VALIDATION_REPORT.md from the evidence (never hand-edited):
tests/db/schema_inventory.json (exact objects), the newest release-evidence/block-01/*/pytest-db.xml (tests executed) and the newest
release-evidence/db-check/*/report.json (independent client-side check). Usage: python otsi-vie/tools/db/validation_report.py"""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
OUT = APP / "docs" / "database" / "DATABASE_VALIDATION_REPORT.md"

RESOLVED = [
    ("S1", "1064 syntax error, `policy_decisions` not created", "PostgreSQL array type `CHAR(36)[]` in a MySQL schema", "C-SQL-02: JSON arrays"),
    ("S2", "3 follow-on errors (2 x 1146 FK, 1 x 1146 index) on `policy_decisions`", "consequence of S1", "resolved by C-SQL-02"),
    ("S3", "3780 incompatible FK `admin_actions.resulting_audit_event_id` -> `audit_events.id`", "signed `bigint` vs `BIGINT UNSIGNED`", "C-SQL-03"),
    ("S4", "1061 duplicate index `idx_outbox_pending`", "PostgreSQL partial index translated twice, as a useless index on the primary key", "C-SQL-04 + ADR-012"),
    ("S5", "migration hard-coded `CREATE DATABASE otsi_owner_vie` / `USE`", "a migration choosing its own database would bypass the scratch database", "C-SQL-01"),
    ("S6", "duplicate `outbox_events` contract (publishing vs billing)", "two source definitions; conversion silently kept one", "ADR-012: one canonical outbox"),
    ("S7", "cross-tenant links possible in 27 relations", "no row-level security in MySQL", "C-SQL-05 / ADR-015: composite tenant FKs"),
    ("S8", "audit / decision history could be rewritten", "no immutability control in the reference", "ADR-013: append-only triggers + grants"),
    ("S9", "1213 deadlocks when 40 canonical IDs were allocated concurrently", "insert-if-missing then SELECT ... FOR UPDATE upgraded a shared lock", "one atomic upsert takes the exclusive lock (ADR-016)"),
    ("S10", "valid canonical IDs rejected by the format CHECK", "MySQL 8.4.13: REGEXP_LIKE CHECK misbehaves on a CHAR(20) column", "VARCHAR(20) ascii_bin (ADR-016)"),
    ("S11", "canonical ID case-insensitive, unformatted, mutable, no allocator (identity audit G1-G8)", "reference schema predates the owner's identity directive", "migrations 0006-0008 (ADR-016)"),
]

LIMITS = [
    "49 tables are tenant-owned only through a parent (no `organization_id` column). The database guarantees the parent link; isolation of reads through them is the API's job and must be proven by API-level cross-tenant tests (Block 02).",
    "14 foreign keys delete with CASCADE (compositional children: upload parts, frame index, shots, track observations/segments/candidates, pipeline steps/events, reel clips/targets/timeline, keyframes, rosters). Parent rows are archived, not deleted (blueprint), so a cascade only runs inside an authorised erasure job; every other foreign key is RESTRICT (NO ACTION), proven by the 1451 test.",
    "IDs are CHAR(36) with the general `utf8mb4_0900_ai_ci` collation (blueprint convention). A binary/ascii collation or BINARY(16) UUIDs would be faster at scale; to be measured in the Block 15 load test before any change.",
    "`track_observations` is unpartitioned (MySQL partitioning conflicts with foreign keys); high-volume traces go to Parquet in object storage per the blueprint (Block 05/06).",
    "DDL cannot be rolled back in MySQL; a migration failing part-way leaves its earlier statements applied and is restored from the pre-migration snapshot (runbook, Block 15). Backup / point-in-time restore drills are not yet done (release gate G-backup).",
    "Validated on the disposable MySQL 8.4.13 Community server only. The owner's target host version is NOT yet verified (owner action: `SELECT VERSION(), @@version_comment` in phpMyAdmin, or authorise a read-only check). MariaDB is not assumed compatible.",
    "Stored procedures exist only for the canonical identity writes (sp_issue_canonical_player_id, sp_merge_players) and views only for identity resolution (v_player_identity, v_track_current_identity); roles.py refuses to provision a procedure without a reviewed grant decision, and the inventory test fails on any unexpected object.",
    "`admin_actions.organization_id` may be NULL for platform-level administration; such rows are not tenant-checked by the composite key (MATCH SIMPLE), so only the platform-admin role may create them (API, Block 02).",
    "Owner identity tests 15, 19 and 20 (cross-tenant identity operations through the API, reports, every API/UI returning the same ID) need the API and report modules; they are tracked as open in IMPLEMENTATION_STATUS.md.",
    "One full-suite run took 146 s instead of ~10 s (four later runs: ~10 s). The cause was not identified; watched in CI.",
]


def newest(pattern: str) -> Path | None:
    found = sorted((APP / "release-evidence").glob(pattern))
    return found[-1] if found else None


def main() -> None:
    inv = json.loads((APP / "tests" / "db" / "schema_inventory.json").read_text(encoding="utf-8"))
    junit = newest("block-01/*/pytest-db.xml")
    check = newest("db-check/*/report.json")
    tests = []
    if junit:
        for tc in ET.parse(junit).getroot().iter("testcase"):
            failed = any(ch.tag in ("failure", "error") for ch in tc)
            tests.append((tc.get("classname", "").split(".")[-1], tc.get("name"), "FAILED" if failed else "passed"))
    chk = json.loads(check.read_text(encoding="utf-8")) if check else {}
    L = ["# Database validation report — OTSI VIE v2 (MySQL 8.4)", "",
         "_Generated by `otsi-vie/tools/db/validation_report.py` from the committed inventory and the newest evidence. Do not edit by hand._", "",
         "## Where and how it was validated",
         f"- Server: **{chk.get('server', 'n/a')}** — a disposable container on `127.0.0.1:3507` with in-memory storage. The existing MySQL on port 3306 and every existing database were never connected to.",
         f"- Migrations: {', '.join(chk.get('migrations', []))}",
         "- Two independent paths on brand-new scratch databases: (1) `tools/db/db_check.py` (mysql client, two fresh databases, identical schema fingerprint = reproducible); (2) the real migrator `tools/db/migrate.py` + `pytest tests/db`.",
         f"- Independent check evidence: `{check.relative_to(APP).as_posix() if check else 'n/a'}` — ok = **{chk.get('ok')}**; fingerprint {chk.get('checks', {}).get('reproducible', {}).get('fingerprint_a', '')[:16]}…",
         f"- Test evidence: `{junit.parent.relative_to(APP).as_posix() if junit else 'n/a'}` — **{sum(t[2] == 'passed' for t in tests)} passed, {sum(t[2] == 'FAILED' for t in tests)} failed**", "",
         "## Objects created (exact; from `tests/db/schema_inventory.json`, enforced by the drift test)", "",
         "| Object | Count |", "|---|---|"] + [f"| {k} | {len(v)} |" for k, v in inv.items()] + [""]
    for k in ("tables", "triggers", "primary_keys", "unique_keys", "foreign_keys", "check_constraints", "indexes", "routines", "views", "events", "columns"):
        items = inv.get(k, [])
        listed = [f"- `{x}`" for x in items] or ["- none"]
        L += [f"<details><summary><b>{k}</b> ({len(items)})</summary>", "", *listed, "", "</details>", ""]
    L += ["## Failures found and resolved", "", "| # | Failure | Root cause | Resolution |", "|---|---|---|---|"]
    L += [f"| {a} | {b} | {c} | {d} |" for a, b, c, d in RESOLVED] + ["",
          "## Tests executed", "", "| Area | Test | Result |", "|---|---|---|"]
    L += [f"| {c} | `{n}` | {r} |" for c, n, r in tests] + ["", "## Remaining limitations (honest)", ""] + [f"- {x}" for x in LIMITS] + [""]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(L), encoding="utf-8")
    print(f"written {OUT} ({len(tests)} tests listed)")


if __name__ == "__main__":
    main()
