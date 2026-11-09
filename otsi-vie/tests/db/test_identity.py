"""Canonical OTSI Player ID — database-level proofs (owner directive 2026-10-26, ADR-016). Service/API-level proofs live with the API.

Every test runs on the fresh scratch database of conftest.py (isolated MySQL 8.4 on 127.0.0.1:3507)."""
from __future__ import annotations

import datetime as dt
import re
import threading
import uuid

import pymysql
import pytest

from conftest import connect

ID_RE = re.compile(r"^OTSI-[A-Z]{3}-[0-9]{4}-[0-9]{6}$")
YEAR = dt.datetime.now(dt.timezone.utc).year


def issue(conn, player_id, country, org, user, key=None) -> str:
    with conn.cursor() as cur:
        cur.execute("CALL sp_issue_canonical_player_id(%s, %s, %s, %s, %s, @cid)", (player_id, country, org, user, key))
        cur.execute("SELECT @cid")
        return cur.fetchone()[0]


@pytest.fixture()
def actor(make):
    """an organization and a person in it, who issue / review / decide"""
    org = make.org()
    user = make.make("users")["id"]
    return org, user


def provisional(make, org, name="Test Player"):
    return make.make("players", created_by_organization_id=org, display_name=name)["id"]


def canonical_of(db, player_id):
    with db.cursor() as cur:
        cur.execute("SELECT canonical_otsi_id, canonical_state FROM players WHERE id=%s", (player_id,))
        return cur.fetchone()


# ---------------------------------------------------------------- 1-3 format, uniqueness, immutability
def test_1_issued_id_has_the_exact_format(db, make, actor):
    org, user = actor
    cid = issue(db, provisional(make, org), "NGA", org, user)
    assert ID_RE.match(cid) and len(cid) == 20
    assert cid.startswith(f"OTSI-NGA-{YEAR}-")
    assert canonical_of(db, cid and provisional(make, org))[0] is None          # issuing one player never touches another


def test_1b_malformed_ids_and_codes_are_refused(db, make, actor):
    org, user = actor
    p = provisional(make, org)
    for bad in ("nga", "NG", "XXX", "N1A", None):
        with pytest.raises(pymysql.err.OperationalError) as e:
            issue(db, p, bad, org, user)
        assert "INVALID_COUNTRY_CODE" in str(e.value)
    with db.cursor() as cur:                                                   # the format is enforced by the table itself as well
        with pytest.raises(pymysql.err.OperationalError):
            cur.execute("INSERT INTO canonical_id_issuances (canonical_otsi_id, player_id, country_code, issue_year, sequence_number, issuing_organization_id, issued_by) "
                        "VALUES ('otsi-nga-2026-000001', %s, 'NGA', 2026, 1, %s, %s)", (p, org, user))
    assert canonical_of(db, p) == (None, "PROVISIONAL")


def test_2_ids_are_globally_unique_and_case_sensitive(db, make, actor):
    org, user = actor
    ids = [issue(db, provisional(make, org), c, org, user) for c in ("GHA", "GHA", "GHA", "CMR", "CMR")]
    assert len(set(ids)) == 5
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM players WHERE canonical_otsi_id=%s", (ids[0].lower(),))
        assert cur.fetchone()[0] == 0                                          # binary collation: a lower-case variant is a different value
        cur.execute("SELECT COUNT(*), COUNT(DISTINCT canonical_otsi_id) FROM canonical_id_issuances")
        n, distinct = cur.fetchone()
        assert n == distinct


def test_3_ids_are_immutable_after_issuance(db, make, actor, scratch_db, accounts):
    org, user = actor
    p = provisional(make, org)
    cid = issue(db, p, "SEN", org, user)
    with db.cursor() as cur:
        for sql in ("UPDATE players SET canonical_otsi_id='OTSI-SEN-2026-999999' WHERE id=%s",
                    "UPDATE players SET canonical_otsi_id=NULL, canonical_state='PROVISIONAL' WHERE id=%s"):
            with pytest.raises(pymysql.err.OperationalError) as e:
                cur.execute(sql, (p,))
            assert "CANONICAL_ID_IMMUTABLE" in str(e.value)
        for sql in ("UPDATE canonical_id_issuances SET player_id=player_id WHERE canonical_otsi_id=%s",
                    "DELETE FROM canonical_id_issuances WHERE canonical_otsi_id=%s"):
            with pytest.raises(pymysql.err.OperationalError):
                cur.execute(sql, (cid,))
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("DELETE FROM players WHERE id=%s", (p,))
        assert "REGISTERED_PLAYERS_ARE_NEVER_DELETED" in str(e.value)
    app = connect(scratch_db, *accounts["otsi_app"])                           # the runtime account cannot even attempt it
    with app.cursor() as cur:
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("UPDATE players SET canonical_otsi_id='OTSI-SEN-2026-999998' WHERE id=%s", (p,))
        assert e.value.args[0] in (1142, 1143)
        cur.execute("UPDATE players SET display_name='Renamed' WHERE id=%s", (p,))   # descriptive data stays editable
    app.close()
    assert canonical_of(db, p)[0] == cid


def test_3b_an_id_cannot_be_set_except_by_the_allocator(db, make, actor):
    org, user = actor
    p, other = provisional(make, org), provisional(make, org)
    cid = issue(db, other, "SEN", org, user)
    with db.cursor() as cur:
        with pytest.raises(pymysql.err.OperationalError) as e:                  # someone else's issued ID
            cur.execute("UPDATE players SET canonical_otsi_id=%s, canonical_state='REGISTERED' WHERE id=%s", (cid, p))
        assert "CANONICAL_ID_NOT_ISSUED_TO_THIS_PLAYER" in str(e.value)
        with pytest.raises(pymysql.err.OperationalError) as e:                  # born registered
            cur.execute("INSERT INTO players (id, display_name, canonical_otsi_id, canonical_state) VALUES (%s,'x',%s,'REGISTERED')", (str(uuid.uuid4()), cid))
        assert "CANONICAL_ID_ONLY_BY_ALLOCATOR" in str(e.value)


# ---------------------------------------------------------------- 4-5 concurrency, exactly-once, idempotency
def test_4_concurrent_allocation_never_duplicates(scratch_db, make, actor):
    org, user = actor
    players = [provisional(make, org) for _ in range(40)]
    results, errors = {}, []

    def worker(pid):
        c = connect(scratch_db)
        try:
            results[pid] = issue(c, pid, "KEN", org, user)
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))
        finally:
            c.close()

    threads = [threading.Thread(target=worker, args=(p,)) for p in players]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    ids = list(results.values())
    assert len(ids) == len(set(ids)) == 40
    seqs = sorted(int(i[-6:]) for i in ids)
    assert seqs == list(range(seqs[0], seqs[0] + 40))                          # contiguous: no gap, no reuse


def test_4a_concurrent_keyed_issuance_never_deadlocks(scratch_db, make, actor):
    """The API always sends an idempotency key. With keys, the old allocator's lookup took a shared gap lock and deadlocked against
    concurrent ledger inserts (MySQL 1213, root cause of the intermittent API failure; migration 0018). Here: 60 keyed issuances at
    once, NO retries — every one must succeed first time, unique and contiguous."""
    org, user = actor
    players = [provisional(make, org) for _ in range(60)]
    results, errors = {}, []

    def worker(pid):
        c = connect(scratch_db)
        try:
            results[pid] = issue(c, pid, "LSO", org, user, "key-" + uuid.uuid4().hex)
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))
        finally:
            c.close()

    threads = [threading.Thread(target=worker, args=(p,)) for p in players]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert errors == []
    seqs = sorted(int(i[-6:]) for i in results.values())
    assert len(set(results.values())) == 60 and seqs == list(range(seqs[0], seqs[0] + 60))


def test_4c_a_failed_issuance_leaves_nothing_and_its_retry_is_contiguous(scratch_db, make, actor):
    """A lock timeout in the middle of an issuance (another session holds the sequence row) must roll the WHOLE issuance back — no
    ledger row, no ID on the player, no sequence number consumed — and the client's retry with the same key gets the next number."""
    org, user = actor
    first, p = provisional(make, org), provisional(make, org)
    before = issue(connect(scratch_db), first, "SWZ", org, user, "k-" + uuid.uuid4().hex)
    holder = connect(scratch_db, autocommit=False)
    with holder.cursor() as cur:                                     # hold the SWZ sequence row
        cur.execute("SELECT last_sequence FROM canonical_id_sequences WHERE country_code='SWZ' FOR UPDATE")
    key = "k-" + uuid.uuid4().hex
    c = connect(scratch_db)
    with c.cursor() as cur:
        cur.execute("SET SESSION innodb_lock_wait_timeout = 1")
    with pytest.raises(pymysql.err.OperationalError) as e:
        issue(c, p, "SWZ", org, user, key)
    assert e.value.args[0] == 1205
    holder.rollback(); holder.close()
    with c.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM canonical_id_issuances WHERE player_id=%s OR request_key=%s", (p, key))
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT last_sequence FROM canonical_id_sequences WHERE country_code='SWZ'")
        assert cur.fetchone()[0] == int(before[-6:])                 # no number consumed by the failed attempt
    assert canonical_of(c, p) == (None, "PROVISIONAL")
    retried = issue(c, p, "SWZ", org, user, key)                    # the client retries with the same key
    assert int(retried[-6:]) == int(before[-6:]) + 1
    assert issue(c, p, "SWZ", org, user, key) == retried            # and again: the same ID, never a second one
    assert canonical_of(c, p) == (retried, "REGISTERED")
    c.close()


def test_4b_one_player_racing_itself_gets_exactly_one_id(scratch_db, make, actor):
    org, user = actor
    p = provisional(make, org)
    got, errors = [], []

    def worker():
        c = connect(scratch_db)
        try:
            got.append(issue(c, p, "UGA", org, user))
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))
        finally:
            c.close()

    threads = [threading.Thread(target=worker) for _ in range(12)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors and len(set(got)) == 1
    c = connect(scratch_db)
    with c.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM canonical_id_issuances WHERE player_id=%s", (p,))
        assert cur.fetchone()[0] == 1
    c.close()


def test_5_retries_are_idempotent(db, make, actor):
    org, user = actor
    key = "issue-" + uuid.uuid4().hex
    p = provisional(make, org)
    first = issue(db, p, "TZA", org, user, key)
    assert issue(db, p, "TZA", org, user, key) == first                        # same request again
    assert issue(db, p, "TZA", org, user) == first                             # same player again
    with pytest.raises(pymysql.err.OperationalError) as e:                     # the same key cannot mint for someone else
        issue(db, provisional(make, org), "TZA", org, user, key)
    assert "REQUEST_KEY_ALREADY_USED_FOR_ANOTHER_PLAYER" in str(e.value)
    ck = "create-" + uuid.uuid4().hex                                          # idempotent player creation: one row per (org, creation key)
    make.make("players", created_by_organization_id=org, creation_key=ck)
    with pytest.raises(pymysql.err.IntegrityError) as e:
        make.make("players", created_by_organization_id=org, creation_key=ck)
    assert e.value.args[0] == 1062


def test_5b_exhausted_namespace_is_refused_not_wrapped(db, make, actor):
    org, user = actor
    with db.cursor() as cur:
        cur.execute("INSERT INTO canonical_id_sequences (country_code, issue_year, last_sequence) VALUES ('TUV', %s, 999999)", (YEAR,))
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("UPDATE canonical_id_sequences SET last_sequence=1 WHERE country_code='TUV'")   # a sequence never goes back
        assert "SEQUENCE_ONLY_ADVANCES_BY_ONE" in str(e.value)
    p = provisional(make, org)
    with pytest.raises(pymysql.err.OperationalError) as e:
        issue(db, p, "TUV", org, user)
    assert "CANONICAL_SEQUENCE_EXHAUSTED" in str(e.value)
    assert canonical_of(db, p) == (None, "PROVISIONAL")                       # nothing half-issued


def test_5c_issuance_is_audited(db, make, actor):
    org, user = actor
    p = provisional(make, org)
    cid = issue(db, p, "RWA", org, user)
    with db.cursor() as cur:
        cur.execute("SELECT actor_id, organization_id, JSON_UNQUOTE(JSON_EXTRACT(after_state,'$.canonical_otsi_id')) FROM audit_events "
                    "WHERE action='player.canonical_id_issued' AND entity_id=%s", (p,))
        assert cur.fetchall() == ((user, org, cid),)


# ---------------------------------------------------------------- 6-9 life changes keep the identity
def test_6_to_9_transfers_nationality_jersey_and_matches_keep_the_id(db, make, actor):
    org, user = actor
    p = provisional(make, org)
    cid = issue(db, p, "NGA", org, user)
    club_a, club_b = make.make("clubs")["id"], make.make("clubs")["id"]
    make.make("player_club_memberships", player_id=p, club_id=club_a, valid_from=dt.date(2025, 7, 1), valid_to=dt.date(2026, 6, 30))
    make.make("player_club_memberships", player_id=p, club_id=club_b, valid_from=dt.date(2026, 7, 1))      # 6 transfer
    make.make("player_nationalities", player_id=p, country_code="NGA", kind="SPORTING", valid_to=dt.date(2026, 1, 1))
    make.make("player_nationalities", player_id=p, country_code="ENG", kind="SPORTING", valid_from=dt.date(2026, 1, 2))  # 7 nationality
    make.make("player_jersey_numbers", player_id=p, club_id=club_a, jersey_number=9, valid_from=dt.date(2025, 7, 1))
    make.make("player_jersey_numbers", player_id=p, club_id=club_b, jersey_number=15, valid_from=dt.date(2026, 7, 1))      # 8 jersey
    for _ in range(3):                                                                                                # 9 matches
        m = make.make("matches", org=org)
        make.make("match_rosters", match_id=m["id"], player_id=p, club_id=club_b, jersey_number=15)
    assert canonical_of(db, p) == (cid, "REGISTERED")
    assert cid.startswith("OTSI-NGA-")                                                                                # issuance country, not current one
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(DISTINCT player_id) FROM match_rosters WHERE player_id=%s", (p,))
        assert cur.fetchone()[0] == 1


# ---------------------------------------------------------------- 10-13 tracks never create players; corrections append
def _track(make, org):
    run = make.make("pipeline_runs", org=org)
    return run, make.make("tracks", run_id=run["id"], video_id=run["video_id"])


def test_10_11_cuts_and_tracking_restarts_never_create_ids(db, make, actor):
    org, user = actor
    p = provisional(make, org)
    cid = issue(db, p, "CIV", org, user)
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM canonical_id_issuances")
        issued_before = cur.fetchone()[0]
    for _ in range(4):                                  # 4 runs (restarts) x 3 tracks (camera cuts) of the same man
        run = make.make("pipeline_runs", org=org)
        for n in range(3):
            t = make.make("tracks", run_id=run["id"], video_id=run["video_id"], internal_track_number=n + 1)
            make.make("track_identity_decisions", track_id=t["id"], player_id=p, state="CONFIRMED", basis="HUMAN", decided_by=user)
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM canonical_id_issuances")
        assert cur.fetchone()[0] == issued_before
        cur.execute("SELECT COUNT(DISTINCT v.canonical_otsi_id) FROM v_track_current_identity d JOIN v_player_identity v ON v.player_id=d.player_id WHERE d.player_id=%s", (p,))
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT DISTINCT v.canonical_otsi_id FROM v_track_current_identity d JOIN v_player_identity v ON v.player_id=d.player_id WHERE d.player_id=%s", (p,))
        assert cur.fetchone()[0] == cid


def test_12_unknown_tracks_stay_unidentified(db, make, actor):
    org, _ = actor
    _, t = _track(make, org)
    with db.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM v_track_current_identity WHERE track_id=%s AND state='CONFIRMED'", (t["id"],))
        assert cur.fetchone()[0] == 0                                           # no decision = "Unidentified Player"
    with pytest.raises(pymysql.err.OperationalError):                            # a confirmation always names a player
        make.make("track_identity_decisions", track_id=t["id"], state="CONFIRMED", player_id=None, basis="AUTO_POLICY")


def test_13_corrections_append_and_keep_history(db, make, actor):
    org, user = actor
    p1, p2 = provisional(make, org, "A"), provisional(make, org, "B")
    _, t = _track(make, org)
    d1 = make.make("track_identity_decisions", track_id=t["id"], player_id=p1, state="CONFIRMED", basis="HUMAN", decided_by=user)
    with pytest.raises(pymysql.err.OperationalError) as e:                     # a correction must say why
        make.make("track_identity_decisions", track_id=t["id"], player_id=p2, state="CONFIRMED", basis="HUMAN", decided_by=user, supersedes_id=d1["id"])
    assert "CORRECTION_REASON_REQUIRED" in str(e.value)
    d2 = make.make("track_identity_decisions", track_id=t["id"], player_id=p2, state="CONFIRMED", basis="HUMAN", decided_by=user,
                   supersedes_id=d1["id"], reason="number 15 visible on the back at 12:03")
    with pytest.raises(pymysql.err.IntegrityError):                            # history is linear: d1 cannot be superseded twice
        make.make("track_identity_decisions", track_id=t["id"], player_id=p1, state="CONFIRMED", basis="HUMAN", decided_by=user,
                  supersedes_id=d1["id"], reason="fork attempt")
    _, other_track = _track(make, org)
    with pytest.raises(pymysql.err.IntegrityError):                            # a correction belongs to the same track
        make.make("track_identity_decisions", track_id=other_track["id"], player_id=p1, state="CONFIRMED", basis="HUMAN",
                  decided_by=user, supersedes_id=d2["id"], reason="wrong track")
    with db.cursor() as cur:
        cur.execute("SELECT decision_id, player_id FROM v_track_current_identity WHERE track_id=%s", (t["id"],))
        assert cur.fetchall() == ((d2["id"], p2),)
        cur.execute("SELECT COUNT(*) FROM track_identity_decisions WHERE track_id=%s", (t["id"],))
        assert cur.fetchone()[0] == 2                                           # the original is kept


# ---------------------------------------------------------------- 14 merges keep every ID and reference
def test_14_merges_keep_ids_and_resolve_through_chains(db, make, actor):
    org, user = actor
    a, b, c = (provisional(make, org, n) for n in "ABC")
    ida, idb, idc = (issue(db, x, "MLI", org, user) for x in (a, b, c))
    _, t = _track(make, org)
    make.make("track_identity_decisions", track_id=t["id"], player_id=a, state="CONFIRMED", basis="HUMAN", decided_by=user)
    with db.cursor() as cur:
        cur.execute("CALL sp_merge_players(%s,%s,%s,%s,%s,%s,NULL)", (str(uuid.uuid4()), a, b, org, user, "same passport, duplicate import"))
        cur.execute("CALL sp_merge_players(%s,%s,%s,%s,%s,%s,NULL)", (str(uuid.uuid4()), b, c, org, user, "second duplicate found"))
        cur.execute("SELECT player_id, own_canonical_otsi_id, canonical_otsi_id FROM v_player_identity WHERE player_id IN (%s,%s,%s) ORDER BY own_canonical_otsi_id", (a, b, c))
        rows = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
        assert rows == {a: (ida, idc), b: (idb, idc), c: (idc, idc)}            # old IDs kept for ever, all resolve to the survivor
        cur.execute("SELECT player_id FROM track_identity_decisions WHERE track_id=%s", (t["id"],))
        assert cur.fetchone()[0] == a                                           # history is not rewritten
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("CALL sp_merge_players(%s,%s,%s,%s,%s,%s,NULL)", (str(uuid.uuid4()), a, c, org, user, "again"))
        assert "PLAYER_ALREADY_MERGED" in str(e.value)
        with pytest.raises(pymysql.err.OperationalError) as e:                  # merged duplicates cannot be given new tracks
            make.make("track_identity_decisions", track_id=t["id"], player_id=a, state="CONFIRMED", basis="HUMAN", decided_by=user,
                      supersedes_id=None)
        assert "IDENTITY_DECISION_TARGET_NOT_LIVE" in str(e.value)
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("UPDATE player_merges SET reason='x' WHERE from_player_id=%s", (a,))
        assert "APPEND_ONLY" in str(e.value)


def test_14b_a_merge_needs_a_registered_survivor_and_a_reason(db, make, actor):
    org, user = actor
    a, b = provisional(make, org), provisional(make, org)
    with db.cursor() as cur:
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("CALL sp_merge_players(%s,%s,%s,%s,%s,%s,NULL)", (str(uuid.uuid4()), a, b, org, user, "dup"))
        assert "SURVIVOR_MUST_BE_REGISTERED" in str(e.value)
        issue(db, b, "MLI", org, user)
        with pytest.raises(pymysql.err.OperationalError) as e:
            cur.execute("CALL sp_merge_players(%s,%s,%s,%s,%s,%s,NULL)", (str(uuid.uuid4()), a, b, org, user, ""))
        assert "MERGE_REASON_REQUIRED" in str(e.value)
        with pytest.raises(pymysql.err.OperationalError) as e:                   # merging by hand, without a decision, is refused
            cur.execute("UPDATE players SET canonical_state='MERGED', merged_into_player_id=%s WHERE id=%s", (b, a))
        assert "MERGE_NEEDS_A_RECORDED_DECISION" in str(e.value)


# ---------------------------------------------------------------- 16-18 spotlight targeting is pinned to a decision version
def test_16_17_reel_target_is_pinned_to_one_track_and_one_player(db, make, actor):
    org, user = actor
    p_right, p_other = provisional(make, org, "Right"), provisional(make, org, "Other")
    issue(db, p_right, "NGA", org, user)
    _, t1 = _track(make, org)
    _, t2 = _track(make, org)
    d_right = make.make("track_identity_decisions", track_id=t1["id"], player_id=p_right, state="CONFIRMED", basis="HUMAN", decided_by=user)
    make.make("track_identity_decisions", track_id=t2["id"], player_id=p_other, state="CONFIRMED", basis="HUMAN", decided_by=user)
    reel = make.make("reel_projects", org=org)
    make.make("reel_targets", reel_id=reel["id"], track_id=t1["id"], player_id=p_right, identity_decision_id=d_right["id"])
    with pytest.raises(pymysql.err.IntegrityError):                            # 17: the right decision on another track
        make.make("reel_targets", reel_id=reel["id"], track_id=t2["id"], player_id=p_right, identity_decision_id=d_right["id"])
    with pytest.raises(pymysql.err.IntegrityError):                            # 17: the right track claimed for another player
        make.make("reel_targets", reel_id=make.make("reel_projects", org=org)["id"], track_id=t1["id"], player_id=p_other,
                  identity_decision_id=d_right["id"])
    with pytest.raises(pymysql.err.OperationalError):                          # a target is either pinned to a decision or unresolved
        make.make("reel_targets", reel_id=make.make("reel_projects", org=org)["id"], track_id=t1["id"], player_id=p_right, identity_decision_id=None)


def test_18_a_superseded_decision_makes_the_reel_target_stale(db, make, actor):
    org, user = actor
    p, q = provisional(make, org), provisional(make, org)
    _, t = _track(make, org)
    d1 = make.make("track_identity_decisions", track_id=t["id"], player_id=p, state="CONFIRMED", basis="HUMAN", decided_by=user)
    reel = make.make("reel_projects", org=org)
    make.make("reel_targets", reel_id=reel["id"], track_id=t["id"], player_id=p, identity_decision_id=d1["id"])
    stale_q = ("SELECT COUNT(*) FROM reel_targets rt LEFT JOIN v_track_current_identity c ON c.track_id = rt.track_id "
               "WHERE rt.reel_id=%s AND (rt.identity_decision_id IS NULL OR c.decision_id IS NULL OR c.decision_id <> rt.identity_decision_id "
               "OR c.state <> 'CONFIRMED')")
    with db.cursor() as cur:
        cur.execute(stale_q, (reel["id"],))
        assert cur.fetchone()[0] == 0                                           # valid: export may proceed (subject to rights)
    make.make("track_identity_decisions", track_id=t["id"], player_id=q, state="CONFIRMED", basis="HUMAN", decided_by=user,
              supersedes_id=d1["id"], reason="re-reviewed: it was the other player")
    with db.cursor() as cur:
        cur.execute(stale_q, (reel["id"],))
        assert cur.fetchone()[0] == 1                                           # stale: the export gate must block it (render service)
