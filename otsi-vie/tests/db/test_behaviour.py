"""Database BEHAVIOUR on a fresh scratch database: transactions, tenant isolation, audit integrity, error handling, roles, outbox,
state machines, and the migrator's own safety rules. Each test states the rule it proves."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pymysql
import pytest

from conftest import connect, dsn
import migrate

TENANT_LINKS = [  # (child, link column, parent) — the 27 tenant guards of migration 0003
    ("assets", "source_asset_id", "assets"), ("deliveries", "asset_id", "assets"), ("render_jobs", "output_asset_id", "assets"),
    ("render_jobs", "manifest_asset_id", "assets"), ("report_jobs", "output_asset_id", "assets"), ("rights_grants", "evidence_asset_id", "assets"),
    ("rights_grants", "asset_id", "assets"), ("share_links", "asset_id", "assets"), ("video_sources", "source_asset_id", "assets"),
    ("admin_actions", "resulting_audit_event_id", "audit_events"), ("video_sources", "match_id", "matches"),
    ("assets", "project_id", "projects"), ("comments", "project_id", "projects"), ("reel_projects", "project_id", "projects"),
    ("report_jobs", "project_id", "projects"), ("video_sources", "project_id", "projects"), ("usage_events", "reservation_id", "quota_reservations"),
    ("comments", "reel_id", "reel_projects"), ("render_jobs", "reel_id", "reel_projects"), ("entitlement_grants", "source_subscription_id", "subscriptions"),
    ("invoices", "subscription_id", "subscriptions"), ("identity_review_history", "video_id", "video_sources"), ("pipeline_runs", "video_id", "video_sources"),
    ("reel_projects", "video_id", "video_sources"), ("report_jobs", "video_id", "video_sources"), ("rights_grants", "video_id", "video_sources"),
    ("upload_sessions", "video_id", "video_sources"),
]


def code(e: pymysql.MySQLError) -> int:
    return e.args[0]


# ---------------------------------------------------------------- tenant isolation
@pytest.mark.parametrize("child,col,parent", TENANT_LINKS, ids=[f"{c}.{k}->{p}" for c, k, p in TENANT_LINKS])
def test_a_row_cannot_point_at_another_tenants_parent(make, child, col, parent):
    org_a, org_b = make.org(), make.org()
    p = make.make(parent, org=org_a)
    pid = p["id"]
    with pytest.raises(pymysql.err.IntegrityError) as e:
        make.make(child, org=org_b, **{col: pid})
    assert code(e.value) == 1452
    make.make(child, org=org_a, **{col: pid})            # the same organization is fine


def test_quota_reservation_cannot_use_another_tenants_counter(make):
    org_a, org_b = make.org(), make.org()
    counter = make.make("quota_counters", org=org_a)
    with pytest.raises(pymysql.err.IntegrityError):
        make.make("quota_reservations", org=org_b, feature_key=counter["feature_key"], window_start=counter["window_start"])


# ---------------------------------------------------------------- transactions
def test_a_rolled_back_transaction_leaves_nothing(scratch_db, meta):
    from factory import Factory
    c = connect(scratch_db, autocommit=False)
    try:
        f = Factory(c, meta)
        c.begin()
        org = f.org()
        f.make("projects", org=org)
        c.rollback()
        with c.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM organizations WHERE id=%s", (org,))
            assert cur.fetchone()[0] == 0
            cur.execute("SELECT COUNT(*) FROM projects WHERE organization_id=%s", (org,))
            assert cur.fetchone()[0] == 0
    finally:
        c.close()


def test_a_failing_statement_does_not_commit_its_transaction(scratch_db, meta):
    """A guard error inside a transaction rejects that statement; nothing of the transaction is visible until commit, and rollback undoes all."""
    from factory import Factory
    c = connect(scratch_db, autocommit=False)
    try:
        f = Factory(c, meta)
        c.begin()
        org = f.org()
        rj = f.make("render_jobs", org=org)
        with pytest.raises(pymysql.err.OperationalError):
            with c.cursor() as cur:
                cur.execute("UPDATE render_jobs SET state='SUCCEEDED' WHERE id=%s", (rj["id"],))   # QUEUED -> SUCCEEDED is not allowed
        other = connect(scratch_db)
        with other.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM organizations WHERE id=%s", (org,))
            assert cur.fetchone()[0] == 0                     # not visible to another session before commit
        other.close()
        c.rollback()
    finally:
        c.close()


# ---------------------------------------------------------------- state machines and integrity guards
def test_render_job_follows_its_state_machine(db, make):
    rj = make.make("render_jobs")
    with db.cursor() as cur:
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("UPDATE render_jobs SET state='SUCCEEDED' WHERE id=%s", (rj["id"],))
        assert "INVALID_RENDER_STATE_TRANSITION" in str(e.value)
        cur.execute("UPDATE render_jobs SET state='RUNNING' WHERE id=%s", (rj["id"],))
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("UPDATE render_jobs SET state='SUCCEEDED' WHERE id=%s", (rj["id"],))
        assert "RENDER_ASSET_AND_MANIFEST_REQUIRED" in str(e.value)    # success needs a real output and manifest
        cur.execute("SELECT state FROM render_jobs WHERE id=%s", (rj["id"],))
        assert cur.fetchone()[0] == "RUNNING"


def test_project_edits_bump_the_version(db, make):
    p = make.make("projects")
    with db.cursor() as cur:
        cur.execute("SELECT version FROM projects WHERE id=%s", (p["id"],))
        v0 = cur.fetchone()[0]
        cur.execute("UPDATE projects SET name='renamed' WHERE id=%s", (p["id"],))
        cur.execute("SELECT version FROM projects WHERE id=%s", (p["id"],))
        assert cur.fetchone()[0] == v0 + 1


def test_a_player_is_born_provisional(make):
    """0007 replaced 'VERIFIED needs an ID' with a stronger rule: every new player starts PROVISIONAL and only the allocator registers it."""
    with pytest.raises(pymysql.err.OperationalError) as e:
        make.make("players", canonical_state="REGISTERED")
    assert "NEW_PLAYERS_ARE_PROVISIONAL" in str(e.value)


def test_a_confirmed_identity_needs_a_player(make):
    with pytest.raises(pymysql.err.OperationalError) as e:
        make.make("track_identity_decisions", state="CONFIRMED", player_id=None)
    assert code(e.value) == 3819


# ---------------------------------------------------------------- audit and decision history
@pytest.mark.parametrize("table", ["audit_events", "track_identity_decisions", "event_decisions", "identity_review_history"])
def test_history_cannot_be_rewritten(db, make, table):
    row = make.make(table)
    pk = "id"
    with db.cursor() as cur:
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute(f"UPDATE `{table}` SET {pk}={pk} WHERE {pk}=%s", (row[pk],))
        assert "APPEND_ONLY" in str(e.value)
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute(f"DELETE FROM `{table}` WHERE {pk}=%s", (row[pk],))        # root is not a retention account either
        assert "APPEND_ONLY" in str(e.value)


def test_only_the_retention_account_can_erase_history(scratch_db, make, accounts):
    row = make.make("audit_events")
    app_user, app_pw = accounts["otsi_app"]
    app = connect(scratch_db, app_user, app_pw)
    with app.cursor() as cur:
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("DELETE FROM audit_events WHERE id=%s", (row["id"],))
        assert code(e.value) == 1142                        # the app role has no DELETE privilege at all
    app.close()
    ret_user, ret_pw = accounts["otsi_retention"]
    ret = connect(scratch_db, ret_user, ret_pw)
    with ret.cursor() as cur:
        assert cur.execute("DELETE FROM audit_events WHERE id=%s", (row["id"],)) == 1
    ret.close()


# ---------------------------------------------------------------- roles (least privilege)
def test_roles_are_least_privilege(scratch_db, make, accounts):
    org = make.org()
    app = connect(scratch_db, *accounts["otsi_app"])
    with app.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM organizations WHERE id=%s", (org,))      # the app reads and writes data
        assert cur.fetchone()[0] == 1
        cur.execute("UPDATE organizations SET name='x' WHERE id=%s", (org,))
        for ddl in ("ALTER TABLE organizations ADD COLUMN hack INT", "DROP TABLE organizations", "CREATE TABLE hack (id INT)"):
            with pytest.raises(pymysql.err.OperationalError) as e:
                cur.execute(ddl)
            assert code(e.value) in (1142, 1044)
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("UPDATE schema_migrations SET name='x'")
        assert code(e.value) == 1142
    app.close()
    ro = connect(scratch_db, *accounts["otsi_readonly"])
    with ro.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM organizations")
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s,'n',%s)", (str(uuid.uuid4()), uuid.uuid4().hex))
        assert code(e.value) == 1142
    ro.close()


# ---------------------------------------------------------------- error handling: each failure has its own, recognisable error
def test_errors_are_specific(db, make):
    org = make.make("organizations")
    with db.cursor() as cur:
        with pytest.raises(pymysql.err.IntegrityError) as e:            # unique
            cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s, 'dup', %s)", (str(uuid.uuid4()), org["slug"]))
        assert code(e.value) == 1062
        with pytest.raises(pymysql.err.IntegrityError) as e:            # missing parent: a complete row whose organization does not exist
            make.make("projects", organization_id=str(uuid.uuid4()))
        assert code(e.value) == 1452
        with pytest.raises(pymysql.err.IntegrityError) as e:            # required value missing
            cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s, NULL, %s)", (str(uuid.uuid4()), uuid.uuid4().hex))
        assert code(e.value) == 1048
        with pytest.raises(pymysql.err.IntegrityError) as e:            # a parent with children cannot be deleted (no silent cascade)
            cur.execute("DELETE FROM organizations WHERE id=%s", (make.make("projects", org=org["id"])["organization_id"],))
        assert code(e.value) == 1451


# ---------------------------------------------------------------- canonical outbox
def test_outbox_deduplicates_and_is_tenant_scoped(db, make):
    org = make.org()
    key = f"billing:test:{uuid.uuid4().hex}:subscription.activated"
    with db.cursor() as cur:
        sql = ("INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, event_payload, dedupe_key) "
               "VALUES (%s,'subscription',%s,'subscription.activated','{}',%s)")
        cur.execute(sql, (org, str(uuid.uuid4()), key))
        with pytest.raises(pymysql.err.IntegrityError) as e:            # a replayed webhook cannot activate a plan twice
            cur.execute(sql, (org, str(uuid.uuid4()), key))
        assert code(e.value) == 1062
        with pytest.raises(pymysql.err.IntegrityError):                   # unknown tenant
            cur.execute(sql, (str(uuid.uuid4()), str(uuid.uuid4()), None))
        cur.execute("SHOW TABLES LIKE '%outbox%'")
        assert [r[0] for r in cur.fetchall()] == ["outbox_events"]        # one outbox, no competing definition


# ---------------------------------------------------------------- migrator safety
def test_migrations_are_recorded_and_rerunning_is_a_no_op(scratch_db):
    with connect(scratch_db).cursor() as cur:
        cur.execute("SELECT version, name, sha256 FROM schema_migrations ORDER BY version")
        rows = cur.fetchall()
    files = migrate.discover()
    assert [(r[0], r[1], r[2]) for r in rows] == [(m.version, m.name, m.sha256) for m in files]
    assert migrate.up(dsn(scratch_db)) == []


def _copy(tmp: Path) -> list[migrate.Migration]:
    d = tmp / "mig"
    shutil.copytree(migrate.MIGRATIONS, d)
    return migrate.discover(d)


def test_an_edited_applied_migration_stops_the_run(scratch_db, tmp_path):
    ms = _copy(tmp_path)
    ms[0].path.write_text(ms[0].sql + "\n-- edited\n", encoding="utf-8")
    with pytest.raises(migrate.MigrationError, match="checksum mismatch"):
        migrate.up(dsn(scratch_db), migrations=migrate.discover(ms[0].path.parent))


def test_a_late_older_migration_stops_the_run(scratch_db, tmp_path):
    ms = _copy(tmp_path)
    (ms[0].path.parent / "0000_sneaked_in.sql").write_text("SELECT 1;\n", encoding="utf-8")
    with pytest.raises(migrate.MigrationError, match="older than the newest applied"):
        migrate.up(dsn(scratch_db), migrations=migrate.discover(ms[0].path.parent))


def test_a_failing_migration_is_not_recorded_and_reports_the_statement(scratch_db, tmp_path):
    ms = _copy(tmp_path)
    (ms[0].path.parent / "9999_broken.sql").write_text("CREATE TABLE ok_part (id INT PRIMARY KEY);\nCREATE TABLE broken (\n", encoding="utf-8")
    with pytest.raises(migrate.MigrationError, match="9999_broken.sql statement 2 failed"):
        migrate.up(dsn(scratch_db), migrations=migrate.discover(ms[0].path.parent))
    with connect(scratch_db).cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM schema_migrations WHERE version='9999'")
        assert cur.fetchone()[0] == 0
        cur.execute("DROP TABLE ok_part")             # test clean-up of the partial effect the run reported


# ---------------------------------------------------------------- outbox: atomic publishing and safe concurrent dispatch (owner point 5)
CLAIM_SQL = ("SELECT id FROM outbox_events WHERE delivered_at IS NULL AND dead_lettered_at IS NULL AND available_at <= CURRENT_TIMESTAMP(6) "
             "ORDER BY id LIMIT %s FOR UPDATE SKIP LOCKED")   # core of the dispatcher's claim query (apps/api/src/core/outbox/dispatcher.ts)


def test_outbox_event_is_published_atomically_with_the_business_change(scratch_db, meta):
    from factory import Factory
    c = connect(scratch_db, autocommit=False)
    try:
        f = Factory(c, meta)
        c.begin()
        org = f.org()
        p = f.make("projects", org=org)
        with c.cursor() as cur:
            cur.execute("INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, event_payload) "
                        "VALUES (%s,'project',%s,'project.created','{}')", (org, p["id"]))
        c.rollback()                                   # the change failed: neither the project nor its event exists
        with c.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM outbox_events WHERE aggregate_id=%s", (p["id"],))
            assert cur.fetchone()[0] == 0
    finally:
        c.close()


def test_two_dispatchers_never_claim_the_same_event(scratch_db, make):
    org = make.org()
    ids = set()
    w = connect(scratch_db)
    with w.cursor() as cur:
        for _ in range(10):
            cur.execute("INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, event_payload) "
                        "VALUES (%s,'t',%s,'test.dispatch','{}')", (org, str(uuid.uuid4())))
            ids.add(cur.lastrowid)
    w.close()
    a, b = connect(scratch_db, autocommit=False), connect(scratch_db, autocommit=False)
    try:
        a.begin(); b.begin()
        with a.cursor() as ca, b.cursor() as cb:
            ca.execute(CLAIM_SQL, (6,)); got_a = {r[0] for r in ca.fetchall()}
            cb.execute(CLAIM_SQL, (6,)); got_b = {r[0] for r in cb.fetchall()}
        assert got_a and got_b and not (got_a & got_b)          # disjoint claims, nobody waits
        assert (got_a | got_b) & ids
    finally:
        a.rollback(); b.rollback(); a.close(); b.close()


# ---------------------------------------------------------------- privileges cannot bypass the application (owner point 7)
def test_runtime_account_has_no_server_wide_privileges(scratch_db, accounts):
    app = connect(scratch_db, *accounts["otsi_app"])
    with app.cursor() as cur:
        cur.execute("SHOW GRANTS FOR CURRENT_USER() USING otsi_app")
        lines = [r[0].upper() for r in cur.fetchall()]
    app.close()
    server_level = [g for g in lines if " ON *.* " in g]
    assert all(g.startswith("GRANT USAGE ON *.*") for g in server_level), server_level   # nothing beyond USAGE at server level
    assert not any("WITH GRANT OPTION" in g for g in lines)                               # cannot hand out its rights
    schema_level = [g for g in lines if ".* TO" in g and " ON *.* " not in g]
    assert not schema_level, schema_level                                                  # no blanket schema rights: per-table only


# ---------------------------------------------------------------- nullable links (owner point 4)
def test_a_nullable_link_never_opens_a_cross_tenant_path(make):
    org_a, org_b = make.org(), make.org()
    proj_b = make.make("projects", org=org_b)
    a_asset = make.make("assets", org=org_a)                                  # link left NULL: references nothing, allowed
    assert a_asset.get("project_id") is None
    with pytest.raises(pymysql.err.IntegrityError):                            # link filled with another tenant's parent: refused
        make.make("assets", org=org_a, project_id=proj_b["id"])


# ---------------------------------------------------------------- 0009: dispatch state, consumer receipts, audit actor (ADR-018/019)
def _event(cur, org) -> int:
    cur.execute("INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, event_payload) "
                "VALUES (%s,'t',%s,'test.dispatch','{}')", (org, str(uuid.uuid4())))
    return cur.lastrowid


def test_an_outbox_claim_always_carries_a_lease_and_an_event_is_never_both_delivered_and_dead(db, make):
    org = make.org()
    with db.cursor() as cur:
        eid = _event(cur, org)
        for sql in ("UPDATE outbox_events SET claim_token=UUID() WHERE id=%s",                          # a claim without a lease
                    "UPDATE outbox_events SET lease_expires_at=NOW(6) WHERE id=%s",                     # a lease without a claim
                    "UPDATE outbox_events SET delivered_at=NOW(6), dead_lettered_at=NOW(6) WHERE id=%s"):
            with pytest.raises(pymysql.err.OperationalError) as e:
                cur.execute(sql, (eid,))
            assert code(e.value) == 3819
        assert cur.execute("UPDATE outbox_events SET claim_token=UUID(), lease_expires_at=NOW(6) WHERE id=%s", (eid,)) == 1


def test_a_dead_lettered_event_is_never_claimed(db, make):
    org = make.org()
    with db.cursor() as cur:
        eid = _event(cur, org)
        cur.execute("UPDATE outbox_events SET dead_lettered_at=NOW(6) WHERE id=%s", (eid,))
        cur.execute(CLAIM_SQL, (1000,))
        assert eid not in {r[0] for r in cur.fetchall()}


def test_a_subscriber_completes_an_event_at_most_once(db, make):
    org = make.org()
    with db.cursor() as cur:
        eid = _event(cur, org)
        cur.execute("INSERT INTO event_consumer_receipts (outbox_event_id, subscriber) VALUES (%s, 'search.indexer')", (eid,))
        with pytest.raises(pymysql.err.IntegrityError) as e:
            cur.execute("INSERT INTO event_consumer_receipts (outbox_event_id, subscriber) VALUES (%s, 'search.indexer')", (eid,))
        assert code(e.value) == 1062
        with pytest.raises(pymysql.err.OperationalError) as e:                                      # subscriber names are identifiers
            cur.execute("INSERT INTO event_consumer_receipts (outbox_event_id, subscriber) VALUES (%s, 'Bad Name')", (eid,))
        assert code(e.value) == 3819
        cur.execute("SHOW TABLES LIKE '%outbox%'")
        assert [r[0] for r in cur.fetchall()] == ["outbox_events"]                                   # still exactly one outbox


@pytest.mark.parametrize("actor_kind,actor,service,action,ok", [
    ("USER", "user", None, "match.created", True),
    ("SERVICE", None, "outbox-dispatcher", "outbox.event_dead_lettered", True), ("SYSTEM", None, "retention", "retention.run_completed", True),
    ("USER", None, None, "match.created", False),                          # a user action names the user
    ("SERVICE", None, None, "outbox.event_dead_lettered", False),          # a service action names the service
    ("USER", "user", "outbox-dispatcher", "match.created", False),         # ... and a user action is not also a service's
    ("ROBOT", None, "x", "match.created", False),                          # unknown actor kind
    ("USER", "user", None, "MatchCreated", False), ("USER", "user", None, "created", False), ("USER", "user", None, "match..created", False),
])
def test_audit_rows_name_their_actor_and_use_dotted_action_names(db, make, actor_kind, actor, service, action, ok):
    org = make.org()
    actor_id = make.make("users")["id"] if actor else None
    with db.cursor() as cur:
        sql = "INSERT INTO audit_events (organization_id, actor_id, actor_kind, actor_service, action, entity_type) VALUES (%s,%s,%s,%s,%s,'test')"
        if ok:
            cur.execute(sql, (org, actor_id, actor_kind, service, action))
        else:
            with pytest.raises(pymysql.err.OperationalError) as e:
                cur.execute(sql, (org, actor_id, actor_kind, service, action))
            assert code(e.value) == 3819


# ---------------------------------------------------------------- 0010: local sign-in (ADR-021)
def test_credentials_store_only_scrypt_hashes_and_lower_case_unique_emails(db, make):
    u1, u2 = make.make("users"), make.make("users")
    with db.cursor() as cur:
        cur.execute("INSERT INTO local_credentials (user_id, email_normalized, password_hash) VALUES (%s, 'a@b.test', 'scrypt$1$1$1$x$y')", (u1["id"],))
        for email, pw_hash in (("Mixed@b.test", "scrypt$1$1$1$x$y"), ("c@b.test", "plaintext-password"), ("no-at-sign", "scrypt$1")):
            with pytest.raises(pymysql.err.OperationalError) as e:
                cur.execute("INSERT INTO local_credentials (user_id, email_normalized, password_hash) VALUES (%s, %s, %s)", (u2["id"], email, pw_hash))
            assert code(e.value) == 3819
        with pytest.raises(pymysql.err.IntegrityError) as e:
            cur.execute("INSERT INTO local_credentials (user_id, email_normalized, password_hash) VALUES (%s, 'a@b.test', 'scrypt$1$1$1$x$y')", (u2["id"],))
        assert code(e.value) == 1062


def test_a_revoked_session_always_says_why(db, make):
    u = make.make("users")
    with db.cursor() as cur:
        cur.execute("INSERT INTO auth_sessions (id, family_id, user_id, refresh_hash, expires_at) VALUES (UUID(), UUID(), %s, %s, NOW(6) + INTERVAL 1 DAY)",
                    (u["id"], uuid.uuid4().hex + uuid.uuid4().hex))
        for sql in ("UPDATE auth_sessions SET revoked_at = NOW(6) WHERE user_id = %s",
                    "UPDATE auth_sessions SET revoke_reason = 'LOGOUT' WHERE user_id = %s",
                    "UPDATE auth_sessions SET revoked_at = NOW(6), revoke_reason = 'BORED' WHERE user_id = %s"):
            with pytest.raises(pymysql.err.OperationalError) as e:
                cur.execute(sql, (u["id"],))
            assert code(e.value) == 3819
        assert cur.execute("UPDATE auth_sessions SET revoked_at = NOW(6), revoke_reason = 'LOGOUT' WHERE user_id = %s", (u["id"],)) == 1
