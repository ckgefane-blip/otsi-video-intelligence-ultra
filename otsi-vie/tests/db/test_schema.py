"""Schema objects: every table is usable, every foreign key is exactly compatible, and the created objects match the committed inventory."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

INVENTORY = Path(__file__).parent / "schema_inventory.json"


def tables(db):
    with db.cursor() as cur:
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' AND table_name<>'schema_migrations' ORDER BY 1")
        return [r[0] for r in cur.fetchall()]


# written only through the allocator / merge procedures or seeded by migration; covered by tests/db/test_identity.py
PROCEDURE_OWNED = {"canonical_id_issuances", "canonical_id_sequences", "player_merges", "countries", "archive_bundles", "clip_reviews", "reel_blocks", "reel_clips"}


def test_every_table_accepts_a_minimal_valid_row(db, make):
    failures = {}
    for t in tables(db):
        if t in PROCEDURE_OWNED:
            continue
        try:
            make.make(t)
        except Exception as e:  # noqa: BLE001 - collect all, report once
            failures[t] = str(e)[:300]
    assert not failures, json.dumps(failures, indent=1)


def test_every_foreign_key_is_exactly_compatible(db):
    with db.cursor() as cur:
        cur.execute("""SELECT k.table_name, k.column_name, c1.column_type, c1.collation_name, c2.column_type, c2.collation_name
          FROM information_schema.key_column_usage k
          JOIN information_schema.columns c1 ON c1.table_schema=k.table_schema AND c1.table_name=k.table_name AND c1.column_name=k.column_name
          JOIN information_schema.columns c2 ON c2.table_schema=k.table_schema AND c2.table_name=k.referenced_table_name AND c2.column_name=k.referenced_column_name
          WHERE k.table_schema=DATABASE() AND k.referenced_table_name IS NOT NULL
            AND (c1.column_type<>c2.column_type OR NOT (c1.collation_name<=>c2.collation_name))""")
        assert cur.fetchall() == ()
        # one character set / collation everywhere, except the exact-match canonical identity codes (ADR-016: case-sensitive, ascii_bin)
        cur.execute("""SELECT CONCAT(c.table_name, '.', c.column_name) FROM information_schema.columns c
                       JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
                       WHERE c.table_schema=DATABASE() AND c.collation_name IS NOT NULL AND c.collation_name<>'utf8mb4_0900_ai_ci' ORDER BY 1""")
        assert {r[0] for r in cur.fetchall()} == {
            "canonical_id_issuances.canonical_otsi_id", "canonical_id_issuances.country_code", "canonical_id_sequences.country_code",
            "countries.code", "player_nationalities.country_code", "players.canonical_otsi_id", "search_terms.term"}
        # every table has a primary key and uses InnoDB (foreign keys and transactions need it)
        cur.execute("""SELECT t.table_name, t.engine FROM information_schema.tables t WHERE t.table_schema=DATABASE() AND t.table_type='BASE TABLE'
                       AND (t.engine<>'InnoDB' OR NOT EXISTS (SELECT 1 FROM information_schema.table_constraints c
                       WHERE c.table_schema=t.table_schema AND c.table_name=t.table_name AND c.constraint_type='PRIMARY KEY'))""")
        assert cur.fetchall() == ()


def inventory(db) -> dict:
    q = {
        "tables": "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY 1",
        "columns": "SELECT CONCAT(table_name,'.',column_name,' ',column_type,IF(is_nullable='YES',' NULL',' NOT NULL')) FROM information_schema.columns WHERE table_schema=DATABASE() ORDER BY table_name, ordinal_position",
        "primary_keys": "SELECT CONCAT(table_name,'(',GROUP_CONCAT(column_name ORDER BY ordinal_position),')') FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND constraint_name='PRIMARY' GROUP BY table_name ORDER BY 1",
        "unique_keys": "SELECT CONCAT(table_name,'.',index_name,'(',GROUP_CONCAT(column_name ORDER BY seq_in_index),')') FROM information_schema.statistics WHERE table_schema=DATABASE() AND non_unique=0 AND index_name<>'PRIMARY' GROUP BY table_name, index_name ORDER BY 1",
        "indexes": "SELECT CONCAT(table_name,'.',index_name,'(',GROUP_CONCAT(column_name ORDER BY seq_in_index),')') FROM information_schema.statistics WHERE table_schema=DATABASE() AND non_unique=1 GROUP BY table_name, index_name ORDER BY 1",
        "foreign_keys": "SELECT CONCAT(k.table_name,'(',GROUP_CONCAT(k.column_name ORDER BY k.ordinal_position),') -> ',k.referenced_table_name,'(',GROUP_CONCAT(k.referenced_column_name ORDER BY k.ordinal_position),') ON DELETE ',r.delete_rule) FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_schema=k.table_schema AND r.constraint_name=k.constraint_name AND r.table_name=k.table_name WHERE k.table_schema=DATABASE() AND k.referenced_table_name IS NOT NULL GROUP BY k.table_name, k.constraint_name, k.referenced_table_name, r.delete_rule ORDER BY 1",
        "check_constraints": "SELECT CONCAT(tc.table_name,'.',cc.constraint_name) FROM information_schema.check_constraints cc JOIN information_schema.table_constraints tc ON tc.constraint_schema=cc.constraint_schema AND tc.constraint_name=cc.constraint_name WHERE cc.constraint_schema=DATABASE() ORDER BY 1",
        "triggers": "SELECT CONCAT(trigger_name,' ',action_timing,' ',event_manipulation,' ON ',event_object_table) FROM information_schema.triggers WHERE trigger_schema=DATABASE() ORDER BY 1",
        "routines": "SELECT CONCAT(routine_type,' ',routine_name) FROM information_schema.routines WHERE routine_schema=DATABASE() ORDER BY 1",
        "views": "SELECT table_name FROM information_schema.views WHERE table_schema=DATABASE() ORDER BY 1",
        "events": "SELECT event_name FROM information_schema.events WHERE event_schema=DATABASE() ORDER BY 1",
    }
    out = {}
    with db.cursor() as cur:
        for k, sql in q.items():
            cur.execute(sql)
            out[k] = [r[0] for r in cur.fetchall()]
    return out


def test_created_objects_match_the_committed_inventory(db):
    """Drift guard: the migrations must create exactly the objects in schema_inventory.json (regenerate it only together with a new migration)."""
    actual = inventory(db)
    if not INVENTORY.exists():
        INVENTORY.write_text(json.dumps(actual, indent=1, ensure_ascii=False), encoding="utf-8")
        pytest.fail("schema_inventory.json did not exist: written now; review and commit it, then re-run")
    expected = json.loads(INVENTORY.read_text(encoding="utf-8"))
    diff = {k: {"missing": sorted(set(expected[k]) - set(actual[k])), "unexpected": sorted(set(actual[k]) - set(expected[k]))}
            for k in expected if set(expected[k]) != set(actual.get(k, []))}
    assert not diff, json.dumps(diff, indent=1)
