# OTSI VIE — latest upgrades

1. `01_CORRECTED_10_UIS/` contains the ten corrected clean-state HTML pages and `INDEX.html`. They hold no fabricated operational data. Also included:
   - 2560 × 1440 Chromium screenshots
   - the correction register and verification results
   - the scripts used to apply the corrections and run the checks
2. `02_BACKEND_MYSQL_BLUEPRINT/` contains the proposed MySQL 8.4 back-end blueprint for these UIs:
   - 14 migrations, validated on a disposable server (49/49 behaviour tests pass)
   - the API contract per page
   - the UI field → DB map, data dictionary and ERD

   It is a proposal: do not install it into the live engine database without a compatibility review.

Superseded and not included: the pre-correction UI specification, `OTSI_VIE_CLAUDE_CODE_SPECIFICATION`, which described the uncorrected pages.
