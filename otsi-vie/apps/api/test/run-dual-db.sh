#!/bin/sh
# Dual-database gate (distribution plan §1d safeguard 2): the dialect suite runs twice — once against SQLite,
# once against MySQL — and the release is blocked if either CONFIGURED backend fails.
#
#   SQLite half: always runs, needs no server (this VM).
#   MySQL half:  runs only when the host MySQL is configured (.local/mysql-lint.env exists); on this VM it is
#                SKIPPED with a visible warning, and the exit code still reflects the SQLite half. On the
#                owner's host both halves must be green.
#
# Usage: sh test/run-dual-db.sh        (from otsi-vie/apps/api)
set -u
cd "$(dirname "$0")/.." || exit 1

fail=0
echo "=== dual-db: SQLite half ==="
OTSI_VIE_TEST_DB_BACKEND=sqlite npx vitest run test/db.dialect.test.ts || fail=1

if [ -f ../../../.local/mysql-lint.env ]; then
  echo "=== dual-db: MySQL half ==="
  OTSI_VIE_TEST_DB_BACKEND=mysql npx vitest run test/db.dialect.test.ts || fail=1
else
  echo "=== dual-db: MySQL half SKIPPED — no .local/mysql-lint.env (host-only; MySQL 3507 is not on this machine) ==="
fi

if [ "$fail" -ne 0 ]; then
  echo "=== dual-db: FAILED (a configured backend failed) ==="
  exit 1
fi
echo "=== dual-db: PASSED ==="
