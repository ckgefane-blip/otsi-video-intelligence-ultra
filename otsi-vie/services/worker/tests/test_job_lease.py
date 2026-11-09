"""The job lease must survive a progress report that did not move (regression, found on a 156-minute match): the playback copy sat at its 99 %
cap, kept reporting the same value, MySQL counted 0 changed rows, and the worker took that for a lost lease and restarted the job from zero.
A lease is lost only when ANOTHER owner holds the job."""
from __future__ import annotations

import json
import uuid

import pytest

from vie_worker.jobs import JobRunner, LeaseLost


@pytest.fixture()
def job(stack, root):
    org, jid = str(uuid.uuid4()), str(uuid.uuid4())
    with root.cursor() as cur:
        cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s, %s, %s)", (org, "Lease " + org[-6:], "lease-" + org))
        cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (%s, %s, 'PROXY', 'video', %s, %s, %s)",
                    (jid, org, str(uuid.uuid4()), "lease:" + jid, json.dumps({})))
    return jid


def test_repeating_the_same_progress_is_not_a_lost_lease(stack, root, job):
    runner = JobRunner(stack["dsn"], "w1", ["PROXY"], lease_seconds=120)
    claimed = runner.claim()
    assert claimed is not None and claimed.id == job
    runner.progress(claimed, 99.0, "Making the playback copy")
    for _ in range(5):                                            # identical value and message: nothing changes in the row
        runner.progress(claimed, 99.0, "Making the playback copy")
    assert not claimed._lost.is_set()


def test_a_taken_over_job_is_still_detected(stack, root, job):
    runner = JobRunner(stack["dsn"], "w1", ["PROXY"], lease_seconds=120)
    claimed = runner.claim()
    assert claimed is not None
    with root.cursor() as cur:                                    # another owner (or a cancellation) takes the claim away
        cur.execute("UPDATE worker_jobs SET claim_token = NULL, lease_expires_at = NULL, state = 'CANCELLED' WHERE id = %s", (job,))
    with pytest.raises(LeaseLost):
        runner.progress(claimed, 50.0, "still working")
    assert claimed._lost.is_set()

def test_a_cancelled_job_is_noticed_within_seconds_inside_a_long_loop(stack, root, job):
    """Owner 2026-11-02: Stop rendering must stop the work promptly, not at the next heartbeat (40 s)."""
    runner = JobRunner(stack["dsn"], "w1", ["PROXY"], lease_seconds=120)
    claimed = runner.claim()
    assert claimed is not None
    runner.still_mine(claimed)                                    # ours: the loop goes on
    with root.cursor() as cur:                                    # the person presses Stop (the API clears the claim)
        cur.execute("UPDATE worker_jobs SET claim_token = NULL, lease_expires_at = NULL, state = 'CANCELLED' WHERE id = %s", (job,))
    runner.still_mine(claimed, every_s=60)                        # within the throttle window: no database read yet
    with pytest.raises(LeaseLost):
        runner.still_mine(claimed, every_s=0)                     # the next read sees it
    with pytest.raises(LeaseLost):
        runner.still_mine(claimed)                                # and every later check stops at once


def test_higher_priority_first_and_a_cap_per_organization(stack, root):
    """ADR-060: the claim takes the highest priority first, never a PAUSED job, and holds an organization at its running cap."""
    org = str(uuid.uuid4())
    low, high, held = (str(uuid.uuid4()) for _ in range(3))
    with root.cursor() as cur:
        cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s, %s, %s)", (org, "Queue " + org[-6:], "queue-" + org))
        for jid, prio in ((low, 8), (high, 1)):
            cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, priority) VALUES (%s, %s, 'READ_LINEUPS', 'lineup_read', %s, %s, '{}', %s)",
                        (jid, org, str(uuid.uuid4()), "queue:" + jid, prio))
        cur.execute("""INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, priority, state, paused_at, paused_by)
                       VALUES (%s, %s, 'READ_LINEUPS', 'lineup_read', %s, %s, '{}', 1, 'PAUSED', CURRENT_TIMESTAMP(6), %s)""",
                    (held, org, str(uuid.uuid4()), "queue:" + held, str(uuid.uuid4())))
    runner = JobRunner(stack["dsn"], "w1", ["READ_LINEUPS"], lease_seconds=120, org_max_running=1)
    first = runner.claim()
    assert first is not None and first.id == high                 # priority 1 before 8; the paused priority-1 job is skipped
    second = runner.claim()
    assert second is None or second.organization_id != org       # the organization is at its cap of 1 running job
    with root.cursor() as cur:
        cur.execute("SELECT state FROM worker_jobs WHERE id IN (%s, %s) ORDER BY id", (low, held))
        assert sorted(r["state"] for r in cur.fetchall()) == ["PAUSED", "QUEUED"]
