# OTSI-Owner Developer Handoff — MySQL Greenfield Commercial Edition

**Authoritative database:** MySQL 8.4 LTS, new isolated schema `otsi_owner_vie`, administered via phpMyAdmin. **Do not use or overwrite existing databases.** Target host must be checked for exact MySQL version before deployment.

Open files in this order:
1. `01_COMMERCIAL_MASTER_BLUEPRINT/MYSQL_ADAPTATION.md` — mandatory changes, scope and validation status.
2. `01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md` — application topology.
3. `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/001_full_schema_mysql84.sql` and `002_guard_triggers_mysql84.sql` — MySQL reference schema and controls.
4. `02_APPROVED_UI_IMPLEMENTATION/` — 10 exact approved screen images and 10 detailed MD screen specs.
5. `03_AI_DEVELOPER_EXECUTION/EXECUTE_FROM_ZERO.md` — developer build order and acceptance rules.
6. `04_OWNER_HANDOFF/AGENT_INSTRUCTIONS.md` — single paste-in prompt for Codex or Claude Code.

No PostgreSQL files are active migration inputs. Original non-MySQL SQL is excluded. Additional reference architecture is in `04_REFERENCE_ARCHITECTURE_MYSQL/`.

**Engineering status:** architectural specifications and a reference MySQL schema, NOT a functioning application, NOT database-verified, NOT a guarantee of commercially ready AI. The developer must implement and test the engine and complete each release gate. Existing OTSI project source and existing DB are not needed or authorized as dependencies.
