-- Migration 010 — Dashboard KPIs (01), billing/entitlements/quotas, policy & rights decisions, audit, outbox,
--                 idempotency, security, retention, release gates
USE `otsi_owner_vie`;

-- 01 Home KPI tiles (Matches Analyzed / Players Tracked / Reels Generated / Reports Created + trend).
-- Materialised by a scheduled job from domain tables; the API never computes these on the request path.
CREATE TABLE kpi_snapshots (
  organization_id   ID36 NOT NULL,
  kpi_key           ENUM('MATCHES_ANALYZED','PLAYERS_TRACKED','REELS_GENERATED','REPORTS_CREATED') NOT NULL,
  period_kind       ENUM('ALL_TIME','LAST_30_DAYS','MONTH') NOT NULL,
  period_start      DATE NOT NULL,
  value_count       BIGINT UNSIGNED NOT NULL,
  previous_value    BIGINT UNSIGNED NULL,
  trend_pct         DECIMAL(7,2) AS (IF(previous_value IS NULL OR previous_value = 0, NULL, ROUND((value_count - previous_value) * 100 / previous_value, 2))) STORED,
  series            JSON NULL COMMENT 'Mini bar chart points (last 5 periods) — replaces decorative fixed bars',
  computed_at       TS6 NOT NULL NOWTS,
  PRIMARY KEY (organization_id, kpi_key, period_kind, period_start),
  CONSTRAINT fk_kpi_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) TBL;

CREATE TABLE plans (
  id                ID36 NOT NULL,
  code              VARCHAR(40) CHARACTER SET ascii NOT NULL,
  name              VARCHAR(80) NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plans_code (code)
) TBL;

CREATE TABLE plan_versions (
  id                ID36 NOT NULL,
  plan_id           ID36 NOT NULL,
  version           INT UNSIGNED NOT NULL,
  effective_at      TS6 NOT NULL NOWTS,
  feature_limits    JSON NOT NULL COMMENT '{"analysis_minutes":600,"render_minutes":120,"storage_gb":500,"seats":5,"max_upload_bytes":...}',
  is_published      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_versions (plan_id, version),
  CONSTRAINT fk_pv_plan FOREIGN KEY (plan_id) REFERENCES plans(id)
) TBL;

CREATE TABLE plan_prices (
  id                ID36 NOT NULL,
  plan_version_id   ID36 NOT NULL,
  provider          ENUM('STRIPE','PADDLE','MANUAL') NOT NULL,
  external_price_id VARCHAR(255) CHARACTER SET ascii NOT NULL,
  billing_period    ENUM('MONTHLY','YEARLY','CUSTOM') NOT NULL,
  currency          CHAR(3) CHARACTER SET ascii NOT NULL,
  unit_amount_minor BIGINT UNSIGNED NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_prices_ext (provider, external_price_id),
  CONSTRAINT fk_pp_version FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id)
) TBL;

CREATE TABLE billing_customers (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  provider          ENUM('STRIPE','PADDLE','MANUAL') NOT NULL,
  provider_customer_id VARCHAR(255) CHARACTER SET ascii NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bc_org (organization_id),
  UNIQUE KEY uq_bc_ext (provider, provider_customer_id),
  CONSTRAINT fk_bc_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
) TBL;

CREATE TABLE subscriptions (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  plan_version_id   ID36 NOT NULL,
  provider_subscription_id VARCHAR(255) CHARACTER SET ascii NULL,
  state             ENUM('TRIALING','ACTIVE','PAST_DUE','CANCELED','UNPAID','INCOMPLETE') NOT NULL,
  period_start      TS6 NULL,
  period_end        TS6 NULL,
  trial_end         TS6 NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  row_version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sub_ext (provider_subscription_id),
  KEY ix_sub_org (organization_id, state),
  CONSTRAINT fk_sub_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_sub_pv  FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id),
  CONSTRAINT ck_sub_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end > period_start)
) TBL;

CREATE TABLE billing_webhook_inbox (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider          ENUM('STRIPE','PADDLE','MANUAL') NOT NULL,
  external_event_id VARCHAR(255) CHARACTER SET ascii NOT NULL,
  signature_verified BOOLEAN NOT NULL,
  event_kind        VARCHAR(100) CHARACTER SET ascii NOT NULL,
  payload_sha256    CHAR(64) CHARACTER SET ascii NOT NULL,
  payload           JSON NOT NULL,
  received_at       TS6 NOT NULL NOWTS,
  processed_at      TS6 NULL,
  error_code        VARCHAR(64) CHARACTER SET ascii NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bwi (provider, external_event_id),
  CONSTRAINT ck_bwi_verified CHECK (processed_at IS NULL OR signature_verified)
) TBL;

CREATE TABLE invoices (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  subscription_id   ID36 NULL,
  provider_invoice_id VARCHAR(255) CHARACTER SET ascii NULL,
  amount_due_minor  BIGINT UNSIGNED NOT NULL,
  currency          CHAR(3) CHARACTER SET ascii NOT NULL,
  invoice_state     ENUM('DRAFT','OPEN','PAID','VOID','UNCOLLECTIBLE') NOT NULL,
  occurred_at       TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inv_ext (provider_invoice_id),
  CONSTRAINT fk_inv_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_inv_sub FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
) TBL;

CREATE TABLE entitlement_grants (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  source_subscription_id ID36 NULL,
  feature_key       VARCHAR(64) CHARACTER SET ascii NOT NULL,
  limit_value       BIGINT NULL COMMENT 'NULL = unlimited',
  valid_from        TS6 NOT NULL,
  valid_until       TS6 NULL,
  PRIMARY KEY (id),
  KEY ix_eg_lookup (organization_id, feature_key, valid_from),
  CONSTRAINT fk_eg_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_eg_sub FOREIGN KEY (source_subscription_id) REFERENCES subscriptions(id),
  CONSTRAINT ck_eg_range CHECK (valid_until IS NULL OR valid_until > valid_from)
) TBL;

CREATE TABLE quota_counters (
  organization_id   ID36 NOT NULL,
  feature_key       VARCHAR(64) CHARACTER SET ascii NOT NULL,
  window_start      TS6 NOT NULL,
  used_amount       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reserved_amount   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, feature_key, window_start),
  CONSTRAINT fk_qc_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
) TBL;

CREATE TABLE quota_reservations (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  feature_key       VARCHAR(64) CHARACTER SET ascii NOT NULL,
  window_start      TS6 NOT NULL,
  quantity          BIGINT UNSIGNED NOT NULL,
  status            ENUM('RESERVED','COMMITTED','RELEASED') NOT NULL,
  subject_type      VARCHAR(40) CHARACTER SET ascii NOT NULL COMMENT 'PIPELINE_RUN / RENDER_JOB / UPLOAD',
  subject_id        ID36 NOT NULL,
  idempotency_key   VARCHAR(128) CHARACTER SET ascii NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_qr_idem (organization_id, feature_key, idempotency_key),
  CONSTRAINT fk_qr_counter FOREIGN KEY (organization_id, feature_key, window_start) REFERENCES quota_counters(organization_id, feature_key, window_start),
  CONSTRAINT ck_qr_qty CHECK (quantity > 0)
) TBL;

CREATE TABLE usage_events (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  reservation_id    ID36 NULL,
  event_key         VARCHAR(160) CHARACTER SET ascii NOT NULL,
  quantity          BIGINT UNSIGNED NOT NULL,
  unit              ENUM('ANALYSIS_SECOND','RENDER_SECOND','STORAGE_BYTE_DAY','UPLOAD_BYTE','SEAT','REPORT') NOT NULL,
  occurred_at       TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ue_key (event_key),
  KEY ix_ue_org (organization_id, unit, occurred_at),
  CONSTRAINT fk_ue_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_ue_res FOREIGN KEY (reservation_id) REFERENCES quota_reservations(id)
) TBL;

-- Rights + entitlement checks recorded at ENQUEUE and at DELIVERY (ADR-007). (Handoff's invalid CHAR(36)[] replaced by JSON arrays.)
CREATE TABLE policy_decisions (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  action            ENUM('ANALYZE','PRODUCE','EXPORT','VIEW','DOWNLOAD','SHARE','DELIVER') NOT NULL,
  resource_type     VARCHAR(40) CHARACTER SET ascii NOT NULL,
  resource_id       ID36 NOT NULL,
  actor_id          ID36 NULL,
  decision          ENUM('ALLOW','DENY','REVIEW') NOT NULL,
  rule_version      VARCHAR(20) NOT NULL,
  grant_ids         JSON NOT NULL DEFAULT (JSON_ARRAY()),
  dependency_asset_ids JSON NOT NULL DEFAULT (JSON_ARRAY()),
  reason_codes      JSON NOT NULL DEFAULT (JSON_ARRAY()),
  checked_at        TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  KEY ix_pd_resource (organization_id, resource_type, resource_id, checked_at),
  CONSTRAINT fk_pd_org   FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_pd_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  CONSTRAINT ck_pd_arrays CHECK (JSON_TYPE(grant_ids) = 'ARRAY' AND JSON_TYPE(dependency_asset_ids) = 'ARRAY' AND JSON_TYPE(reason_codes) = 'ARRAY')
) TBL;

ALTER TABLE deliveries ADD CONSTRAINT fk_del_policy FOREIGN KEY (rights_decision_id) REFERENCES policy_decisions(id);

CREATE TABLE artifact_dependencies (
  artifact_asset_id ID36 NOT NULL,
  depends_on_asset_id ID36 NOT NULL,
  dependency_type   ENUM('SOURCE_VIDEO','AUDIO','FONT','LOGO','TRACKS','MODEL','METADATA','OTHER') NOT NULL,
  PRIMARY KEY (artifact_asset_id, depends_on_asset_id, dependency_type),
  KEY ix_ad_dep (depends_on_asset_id),
  CONSTRAINT fk_ad_art FOREIGN KEY (artifact_asset_id) REFERENCES assets(id),
  CONSTRAINT fk_ad_dep FOREIGN KEY (depends_on_asset_id) REFERENCES assets(id),
  CONSTRAINT ck_ad_self CHECK (artifact_asset_id <> depends_on_asset_id)
) TBL COMMENT='Revoking a source right blocks every derived render/report that depends on it';

-- Append-only audit log, range-partitioned by month for cheap retention (no FKs on partitioned tables).
CREATE TABLE audit_events (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  occurred_at       TS6 NOT NULL NOWTS,
  organization_id   ID36 NULL,
  actor_id          ID36 NULL,
  actor_kind        ENUM('USER','SERVICE','SHARE_LINK','SYSTEM') NOT NULL,
  action            VARCHAR(80) CHARACTER SET ascii NOT NULL,
  entity_type       VARCHAR(40) CHARACTER SET ascii NOT NULL,
  entity_id         ID36 NULL,
  request_id        VARCHAR(64) CHARACTER SET ascii NULL,
  ip_hash           CHAR(64) CHARACTER SET ascii NULL,
  before_state      JSON NULL,
  after_state       JSON NULL,
  PRIMARY KEY (id, occurred_at),
  KEY ix_audit_entity (organization_id, entity_type, entity_id, occurred_at),
  KEY ix_audit_actor (organization_id, actor_id, occurred_at)
) TBL
PARTITION BY RANGE COLUMNS (occurred_at) (
  PARTITION p2026_10 VALUES LESS THAN ('2026-11-01'),
  PARTITION p2026_11 VALUES LESS THAN ('2026-12-01'),
  PARTITION p2026_12 VALUES LESS THAN ('2027-01-01'),
  PARTITION p_future VALUES LESS THAN (MAXVALUE)
);

CREATE TABLE outbox_events (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id   ID36 NULL,
  aggregate_type    VARCHAR(40) CHARACTER SET ascii NOT NULL,
  aggregate_id      ID36 NOT NULL,
  event_type        VARCHAR(80) CHARACTER SET ascii NOT NULL COMMENT 'e.g. pipeline.step.progressed, render.job.succeeded',
  schema_version    SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  event_payload     JSON NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  available_at      TS6 NOT NULL NOWTS,
  claimed_by        VARCHAR(64) CHARACTER SET ascii NULL,
  claimed_at        TS6 NULL,
  delivered_at      TS6 NULL,
  attempt_count     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_error        VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY ix_outbox_pending (delivered_at, available_at, id),
  KEY ix_outbox_aggregate (aggregate_type, aggregate_id, id)
) TBL COMMENT='Dispatcher: SELECT ... WHERE delivered_at IS NULL AND available_at<=NOW(6) ORDER BY id LIMIT n FOR UPDATE SKIP LOCKED';

CREATE TABLE idempotency_keys (
  organization_id   ID36 NOT NULL,
  idempotency_key   VARCHAR(128) CHARACTER SET ascii NOT NULL,
  request_hash      CHAR(64) CHARACTER SET ascii NOT NULL,
  route             VARCHAR(120) CHARACTER SET ascii NOT NULL,
  response_status   SMALLINT UNSIGNED NULL,
  response_body     JSON NULL,
  created_at        TS6 NOT NULL NOWTS,
  expires_at        TS6 NOT NULL,
  PRIMARY KEY (organization_id, idempotency_key),
  KEY ix_idem_expiry (expires_at)
) TBL;

CREATE TABLE security_events (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id   ID36 NULL,
  actor_id          ID36 NULL,
  ip_hash           CHAR(64) CHARACTER SET ascii NULL,
  event_kind        VARCHAR(64) CHARACTER SET ascii NOT NULL,
  outcome           ENUM('SUCCESS','FAILURE','BLOCKED') NOT NULL,
  details           JSON NULL,
  occurred_at       TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  KEY ix_sec (organization_id, event_kind, occurred_at)
) TBL;

CREATE TABLE admin_actions (
  id                ID36 NOT NULL,
  actor_id          ID36 NOT NULL,
  organization_id   ID36 NULL,
  action            VARCHAR(80) CHARACTER SET ascii NOT NULL,
  justification     TEXT NOT NULL,
  approved_by       ID36 NULL,
  occurred_at       TS6 NOT NULL NOWTS,
  PRIMARY KEY (id),
  CONSTRAINT fk_aa_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  CONSTRAINT fk_aa_appr  FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT ck_aa_four_eyes CHECK (approved_by IS NULL OR approved_by <> actor_id)
) TBL;

CREATE TABLE processing_dead_letters (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  workflow_id       VARCHAR(255) CHARACTER SET ascii NOT NULL,
  job_kind          VARCHAR(40) CHARACTER SET ascii NOT NULL,
  error_code        VARCHAR(64) CHARACTER SET ascii NOT NULL,
  attempt_count     SMALLINT UNSIGNED NOT NULL,
  payload_object_key VARCHAR(1024) NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  resolved_at       TS6 NULL,
  PRIMARY KEY (id),
  KEY ix_pdl_open (resolved_at, created_at),
  CONSTRAINT fk_pdl_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
) TBL;

CREATE TABLE retention_jobs (
  id                ID36 NOT NULL,
  organization_id   ID36 NOT NULL,
  subject_type      VARCHAR(40) CHARACTER SET ascii NOT NULL,
  subject_id        ID36 NOT NULL,
  requested_by      ID36 NULL,
  legal_hold        BOOLEAN NOT NULL DEFAULT FALSE,
  status            ENUM('QUEUED','RUNNING','DONE','BLOCKED','FAILED') NOT NULL,
  created_at        TS6 NOT NULL NOWTS,
  finished_at       TS6 NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_ret_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT ck_ret_hold CHECK (NOT (legal_hold AND status = 'DONE'))
) TBL;

CREATE TABLE release_signoffs (
  id                ID36 NOT NULL,
  build_sha         CHAR(40) CHARACTER SET ascii NOT NULL,
  gate_code         VARCHAR(64) CHARACTER SET ascii NOT NULL,
  state             ENUM('PENDING','PASS','FAIL','WAIVED') NOT NULL,
  signed_by         ID36 NULL,
  evidence_object_key VARCHAR(1024) NULL,
  signed_at         TS6 NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rs (build_sha, gate_code),
  CONSTRAINT fk_rs_user FOREIGN KEY (signed_by) REFERENCES users(id)
) TBL;

CREATE TABLE schema_migrations (
  version           VARCHAR(10) CHARACTER SET ascii NOT NULL,
  description       VARCHAR(200) NOT NULL,
  checksum_sha256   CHAR(64) CHARACTER SET ascii NOT NULL,
  applied_at        TS6 NOT NULL NOWTS,
  applied_by        VARCHAR(100) NOT NULL DEFAULT (CURRENT_USER()),
  PRIMARY KEY (version)
) TBL;
