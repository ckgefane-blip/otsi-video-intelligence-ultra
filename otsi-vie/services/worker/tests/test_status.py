"""Worker resource status (migration 0019): a real measurement of this machine, written by the least-privilege runtime account."""
from __future__ import annotations

from vie_worker.status import StatusReporter, sample


def test_sample_is_a_real_measurement():
    s = sample()
    assert 0 <= s["cpu_percent"] <= 100
    assert s["cpu_count"] >= 1
    assert 0 < s["memory_used_bytes"] <= s["memory_total_bytes"]


def test_reporter_upserts_one_row_per_worker(stack, root):
    r = StatusReporter(stack["dsn"], "worker-test-status", ["ANALYZE", "RENDER"])
    r.write()
    r.busy.set()
    r.write()
    with root.cursor() as cur:
        cur.execute("SELECT * FROM worker_status WHERE worker_id = 'worker-test-status'")
        rows = cur.fetchall()
    assert len(rows) == 1
    row = rows[0]
    assert row["busy"] == 1 and row["gpu_percent"] is None
    assert 0 < row["memory_used_bytes"] <= row["memory_total_bytes"] and row["cpu_count"] >= 1
