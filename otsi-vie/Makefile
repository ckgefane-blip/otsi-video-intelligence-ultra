# OTSI VIE v2 — developer commands (run from D:\OTSI-Workspace\VIE-Engine-v2\otsi-vie). Database targets use ONLY the disposable
# MySQL 8.4 server on 127.0.0.1:3507 (tools/db/db_check.py starts it); never the existing MySQL on 3306.
PY ?= ../.venv/Scripts/python.exe

db-check:      ## apply all migrations to two fresh scratch databases with the mysql client and compare fingerprints
	$(PY) tools/db/db_check.py

db-test:       ## fresh scratch database via the real migrator + roles, then the behaviour tests
	$(PY) -m pytest tests/db -q -p no:cacheprovider

db-report:     ## regenerate docs/database/DATABASE_VALIDATION_REPORT.md from the newest evidence
	$(PY) tools/db/validation_report.py

ci:            ## the whole local pipeline with evidence (tools/ci/run_ci.py); also runnable without make
	$(PY) tools/ci/run_ci.py

.PHONY: db-check db-test db-report ci
