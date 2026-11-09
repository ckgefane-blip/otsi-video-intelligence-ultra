> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# Schema, migrations, triggers, functions, and tenancy

## Status and safe usage
Reference implementation for an **empty isolated MySQL database**; it is **NOT a tested migration for an existing OTSI deployment**. Record schema inspection output and map existing tables first. In particular, preserve the existing website-allocated canonical OTSI player ID authority, any `otsi_players` rows, foreign keys, and engine's `otsi_pms_id` compatibility until migration tests pass. Do not use this SQL to replace a running schema. SQL has not been executed against a MySQL instance in this delivery.

## Migration order
`otsi-vie/database/migrations/0001..N` (from the MySQL reference `mysql_migrations/001..002`; the PostgreSQL files 001..005 are not used). MySQL commits DDL implicitly, so a file is not one transaction: the migrator records a checksum per version, holds a named lock, stops on the first error and never auto-repairs (ADR-014). Migrator must use a unique migration checksum lock, [MySQL correction C-DOC-11] least-privilege role, and fresh snapshot before alteration. Rollback scripts are environment-specific and intentionally not fabricated; generate by comparing real current schema and data. No auto-drop of live tables. Migrations are additive as approved by owner.

## Storage/scale decision
- Metadata lives in MySQL 8.4. [MySQL correction C-DOC-12] Source media, proxies, thumbnails, decoded observation Parquet, manifests, rendered artifacts and reports live in S3-compatible object storage, referenced by immutable asset rows and content hashes.
- `track_observations` is a query-serving sampled/hot store partitioned by video hash. Full frame-rate observations can be stored in partitioned Parquet for cost; do not duplicate unbounded high-volume video data blindly.
- Store `pts_us` (source decoded presentation timestamp), `frame_index`, `shot_id`; variable-frame-rate support is mandatory. Resampling never overwrites source timing.
- Bounding boxes are normalized image `x,y,w,h` with (0,0) at top left, not pitch coordinates. Pitch metrics require separately validated calibration transforms.
- `detection_batches` point to raw model output blobs; `track_segments` point to time-contiguous observation chunks. Query APIs merge indexed hot data with Parquet artifacts.

## Identity integrity
- Track number is scoped to a pipeline run. Never use it as a global identity or as a canonical OTSI player ID.
- Candidate scores are evidence; confirmed identity is a separate review decision. When correcting a track, append a new decision with `supersedes_id`; do not rewrite history or change the stable player registry ID.
- Cross-camera/re-entry stitching stores evidence and independent track segment joins, not guessed continuation.
- The proposed format `OTSI-CCC-YYYY-NNNNNN` is checked on `vie.players`, but **allocation remains with the existing website-side allocator**. Do not issue canonical IDs directly from this new table.

## Tenant isolation and privileged role design
MySQL has no row-level security, `SET LOCAL` or security-definer functions. Tenant isolation is enforced in the API service layer on every query, including child tables reached through a parent (matches/rosters, model outputs, identities, timelines), with negative cross-tenant tests; the database adds composite tenant foreign keys so a row can never link to another tenant's parent (migration 0003), and the runtime account has least-privilege grants (ADR-015). [MySQL correction C-DOC-13] Never accept org IDs from browsers as authority.

## Triggers vs application behavior
`set_updated_at` and render transition guards are DB-level integrity checks. `enqueue_outbox` bridges transaction and queues; a separate dispatcher publishes idempotently. Rights decisions belong in an auditable policy service that checks source and derivative rights, recipient territory, expiration, minor consent, role, requested action and dynamic revocation. Recheck before render, artifact download, signed URL issuance, and async delivery. Do NOT implement rights solely through a one-time trigger.

## Additional required production migrations
- Immutable rights-decision snapshots, source-license and restriction inheritance per derived artifact; guardian-consent evidence.
- Correct scope-mapped server-enforced tenant isolation policies for every child relation.
- Search indices (MySQL FULLTEXT, OpenSearch/Meilisearch when measured scale requires) [MySQL correction C-DOC-14], analytics materialized aggregates, indexes by match/video/person, delivery audit, data-deletion tombstones.
- Event/timeframe partition retention, asset dedupe, backup and restore catalog, constraints preventing overlapping confirmed identity when evidence establishes impossibility.
- Approved database and schema adapters for the actual running engine and WordPress/website player posts.

## Data dictionary requirements
For each deployed table record owner service, write paths, read paths, row count forecast, retention policy, PII class, tenancy rule, index rationale, audit change history, and exact UI consumer. `01_core` contains organizational, source, identity registry and job entities; `02_intelligence` contains detections/tracks, candidates and metrics; `03_production` contains editing, renders and delivery; `04_controls` adds policies and transactional behaviors.
