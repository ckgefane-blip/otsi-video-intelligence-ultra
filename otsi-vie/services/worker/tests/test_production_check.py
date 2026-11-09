"""Production deployment preflight checks unit tests (v3 Phase D.9, ADR-116).
Tests entropy calculation, environment validation, and deployment report schema.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Add otsi-vie to sys.path to import tools.deploy.production_check
OTSI_VIE_ROOT = Path(__file__).resolve().parents[3]
if str(OTSI_VIE_ROOT) not in sys.path:
    sys.path.insert(0, str(OTSI_VIE_ROOT))

from tools.deploy.production_check import DeploymentAuditor, calculate_shannon_entropy


def test_calculate_shannon_entropy():
    # Empty string
    assert calculate_shannon_entropy("") == 0.0
    # Homogeneous string (all 'a') has 0 bits/char
    assert calculate_shannon_entropy("aaaaaaaa") == 0.0
    # 16 distinct chars uniformly distributed
    s = "abcdefghijklmnop"
    e = calculate_shannon_entropy(s)
    assert 60.0 <= e <= 65.0  # 4 bits/char * 16 chars = 64 bits


def test_deployment_auditor_initialization():
    auditor = DeploymentAuditor(port=3508, db_name="test_db")
    assert auditor.port == 3508
    assert auditor.db_name == "test_db"
    assert auditor.checks == []


def test_audit_environment_passes():
    auditor = DeploymentAuditor(port=3508)
    auditor.audit_environment()
    check_names = [c["name"] for c in auditor.checks]
    assert "PythonVersion" in check_names
    assert "NodeInstalled" in check_names
    for c in auditor.checks:
        if c["name"] == "PythonVersion":
            assert c["status"] == "PASS"
