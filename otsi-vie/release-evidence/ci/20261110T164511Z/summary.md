# CI run 20261110T164511Z

Result: **FAILED** — 9 passed, 4 failed, 5 not run here.

Partial run on this machine (Linux VM): the no-DB steps of `otsi-vie/tools/ci/run_ci.py` were run for real; the MySQL-dependent steps were NOT run here and are marked as such, never faked. Deviations from run_ci.py: this run continues past a failed step so every no-DB step is recorded (run_ci.py stops at the first failure); the two stdlib-only Python steps ran under system python3 -I (this VM has no .venv — run_ci.py uses ROOT/.venv/bin/python); node here is v24.22.1 while the repo pins Node >=22.11 <23. The full worker pytest suite (step 09) is replaced by the direct-runner subsets 09a-09e, clearly labelled. MySQL steps need the owner's Windows host with the test database on 127.0.0.1:3507.

node v24.22.1, python 3.12.3, Linux-7.0.0-44-generic-x86_64-with-glibc2.39

| Step | Result | Seconds |
|---|---|---|
| page specs are current | pass | 0.1 |
| dependency licences | FAIL | 2.1 |
| contracts build | pass | 8.5 |
| api typecheck | FAIL | 9.9 |
| api build | FAIL | 9.1 |
| api tests (real MySQL 8.4) | not run here | — |
| database tests | not run here | — |
| outbox worker smoke | not run here | — |
| worker tests (real media, real footage) | not run here | — |
| worker py_compile | pass | 0.6 |
| worker direct runner: U.11 identity rule | pass | 0.5 |
| worker direct runner: U.12 identity veto | pass | 2.4 |
| worker direct runner: Player Profile Intro | pass | 7.1 |
| worker direct runner: cross-match render | pass | 2.2 |
| web typecheck | FAIL | 6.2 |
| web unit tests | pass | 74.3 |
| web production build | pass | 66.8 |
| web browser e2e (Chromium, real API) | not run here | — |
