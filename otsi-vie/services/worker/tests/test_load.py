"""Load testing harness unit tests (v3 Phase D.7, ADR-115).
Tests latency calculations, metric aggregation, and report generation.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Add otsi-vie to sys.path to import tools.load.load_test
OTSI_VIE_ROOT = Path(__file__).resolve().parents[3]
if str(OTSI_VIE_ROOT) not in sys.path:
    sys.path.insert(0, str(OTSI_VIE_ROOT))

from tools.load.load_test import calculate_latencies, LoadTestHarness


def test_calculate_latencies_handles_empty():
    stats = calculate_latencies([])
    assert stats["p50_ms"] == 0.0
    assert stats["p95_ms"] == 0.0
    assert stats["p99_ms"] == 0.0
    assert stats["mean_ms"] == 0.0


def test_calculate_latencies_computes_accurate_percentiles():
    # 100 observations uniformly distributed from 0.010 s (10ms) to 0.109 s (109ms)
    durations = [0.010 + i * 0.001 for i in range(100)]
    stats = calculate_latencies(durations)

    assert 55.0 <= stats["p50_ms"] <= 65.0
    assert 95.0 <= stats["p95_ms"] <= 106.0
    assert 99.0 <= stats["p99_ms"] <= 110.0
    assert stats["min_ms"] == 10.0
    assert stats["max_ms"] == 109.0


def test_load_test_harness_initialization():
    harness = LoadTestHarness(port=3508, concurrency=4)
    # Validate initialization
    assert harness.port == 3508
    assert harness.concurrency == 4
    assert len(harness.test_org_id) == 36  # Valid UUID string
