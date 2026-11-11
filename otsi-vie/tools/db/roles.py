"""Least-privilege database roles for OTSI VIE v2 (MYSQL_ADAPTATION.md "Roles"; ADR-015).

  otsi_migrator   schema changes (used only by migrate.py during a deployment)
  otsi_app        the API and workers at runtime: data access only, never DDL; append-only history tables are SELECT + INSERT only
  otsi_readonly   analysts / support: SELECT only
  otsi_retention  the retention / erasure job: SELECT + DELETE (the only account the append-only triggers let delete history)

Roles are server objects, so they are provisioned by an operator with this tool, not by a numbered migration. Accounts (with passwords from the
secrets manager) are created separately and granted one role each; no password is ever written to the repository.
The grant list is built from the LIVE schema, so a table added by a later migration cannot be left without grants: re-run after migrating.

Usage: python otsi-vie/tools/db/roles.py --dsn mysql://admin:...@host:port/database [--print]
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from migrate import connect  # noqa: E402

APPEND_ONLY = {"audit_events", "track_identity_decisions", "event_decisions", "identity_review_history", "track_link_decisions", "match_roster_changes", "run_team_assignments", "jersey_number_decisions", "formation_decisions", "wallet_ledger"}
# Written ONLY through the allocator / merge procedures (ADR-016) — until the SQLite conversion (ADR-144): the runtime account may read
# them, never write them directly. Since ADR-144 the allocator lives in TypeScript (apps/api/src/modules/players/canonical-allocator.ts)
# and writes these tables directly on BOTH backends (SQLite has no stored procedures), so the runtime account needs the writes below.
# The stored procedures are superseded but retained; their EXECUTE grant is kept.
ALLOCATOR_WRITTEN = {"canonical_id_issuances", "canonical_id_sequences", "player_merges"}
PROCEDURE_OWNED = {"countries"}
# players: the runtime account may edit descriptive attributes only, plus the canonical columns the TypeScript allocator sets
# (canonical_otsi_id, canonical_state, merged_into_player_id — ADR-144); triggers refuse every other change anyway (defence in depth).
PLAYER_EDITABLE = ("display_name", "birth_date", "preferred_foot", "primary_position", "role_confirmed_by", "role_confirmed_at", "role_confirmation_state", "external_ids")   # primary_position: 0035, role_confirmed: 0065
PLAYER_CANONICAL = ("canonical_otsi_id", "canonical_state", "merged_into_player_id")   # ADR-144: set by canonical-allocator.ts, not by a procedure
PROCEDURES = ("sp_issue_canonical_player_id", "sp_merge_players")
ROLES = ("otsi_migrator", "otsi_app", "otsi_readonly", "otsi_retention")


def grant_statements(schema: str, tables: list[str], views: list[str] = (), procedures: list[str] = ()) -> list[str]:
    q = f"`{schema}`"
    out = [f"CREATE ROLE IF NOT EXISTS {', '.join(ROLES)}",
           f"GRANT ALL PRIVILEGES ON {q}.* TO otsi_migrator",
           f"GRANT SELECT ON {q}.* TO otsi_readonly",
           f"GRANT SELECT, DELETE ON {q}.* TO otsi_retention"]
    for t in sorted(tables):
        if t == "schema_migrations":
            out.append(f"GRANT SELECT ON {q}.`{t}` TO otsi_app")
        elif t in APPEND_ONLY:
            out.append(f"GRANT SELECT, INSERT ON {q}.`{t}` TO otsi_app")
        elif t in ALLOCATOR_WRITTEN:
            # ADR-144: the TypeScript allocator writes these directly. Sequences needs UPDATE too:
            # INSERT ... ON DUPLICATE KEY UPDATE last_sequence = last_sequence + 1.
            if t == "canonical_id_sequences":
                out.append(f"GRANT SELECT, INSERT, UPDATE ON {q}.`{t}` TO otsi_app")
            else:
                out.append(f"GRANT SELECT, INSERT ON {q}.`{t}` TO otsi_app")
        elif t in PROCEDURE_OWNED:
            out.append(f"GRANT SELECT ON {q}.`{t}` TO otsi_app")
        elif t == "players":
            cols = ", ".join(f"`{c}`" for c in PLAYER_EDITABLE)
            canon = ", ".join(f"`{c}`" for c in PLAYER_CANONICAL)
            out.append(f"GRANT SELECT, INSERT, DELETE ON {q}.`players` TO otsi_app")
            out.append(f"GRANT UPDATE ({cols}) ON {q}.`players` TO otsi_app")
            out.append(f"GRANT UPDATE ({canon}) ON {q}.`players` TO otsi_app")
        else:
            out.append(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {q}.`{t}` TO otsi_app")
    for v in sorted(views):
        out.append(f"GRANT SELECT ON {q}.`{v}` TO otsi_app")
    for r in sorted(procedures):
        out.append(f"GRANT EXECUTE ON PROCEDURE {q}.`{r}` TO otsi_app")
    return out


def provision(dsn: str, dry_run: bool = False) -> list[str]:
    conn = connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DATABASE()")
            schema = cur.fetchone()[0]
            cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'")
            tables = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT table_name FROM information_schema.views WHERE table_schema=DATABASE()")
            views = [r[0] for r in cur.fetchall()]
            cur.execute("SELECT routine_name FROM information_schema.routines WHERE routine_schema=DATABASE() AND routine_type='PROCEDURE'")
            procs = [r[0] for r in cur.fetchall()]
            unknown = set(procs) - set(PROCEDURES)
            if unknown:
                raise RuntimeError(f"procedures without a reviewed grant decision: {sorted(unknown)}")
            stmts = grant_statements(schema, tables, views, procs)
            if not dry_run:
                for s in stmts:
                    cur.execute(s)
            return stmts
    finally:
        conn.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default=os.environ.get("OTSI_VIE_ADMIN_DSN"))
    ap.add_argument("--print", action="store_true", help="only print the statements")
    a = ap.parse_args()
    if not a.dsn:
        ap.error("give --dsn or set OTSI_VIE_ADMIN_DSN")
    for s in provision(a.dsn, dry_run=a.print):
        print(s + ";")
    return 0


if __name__ == "__main__":
    sys.exit(main())
