-- Migration 010 — Dashboard KPIs (01), billing/entitlements/quotas, policy & rights decisions, audit, outbox,
--                 idempotency, security, retention, release gates
USE `otsi_owner_vie`;

-- 01 Home KPI tiles (Matches Analyzed / Players Tracked / Reels Generated / Reports Created + trend).
-- Materialised by a scheduled job from domain tables; the API never computes these on the request path.
CREATE TABLE kpi_snapshots (
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kpi_key           ENUM('MATCHES_ANALYZED','PLAYERS_TRACKED','REELS_GENERATED','REPORTS_CREATED') NOT NULL,
  period_kind       ENUM('ALL_TIME','LAST_30_DAYS','MONTH') NOT NULL,
  period_start      DATE NOT NULL,
  value_count       BIGINT UNSIGNED NOT NULL,
  previous_value    BIGINT UNSIGNED NULL,
  trend_pct         DECIMAL(7,2) AS (IF(previous_value IS NULL OR previous_value = 0, NULL, ROUND((value_count - previous_value) * 100 / previous_value, 2))) STORED,
  series            JSON NULL COMMENT 'Mini bar chart points (last 5 periods) — replaces decorative fixed bars',
  computed_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (organization_id, kpi_key, period_kind, period_start),
  CONSTRAINT fk_kpi_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE plans (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code              VARCHAR(40) CHARACTER SET ascii NOT NULL,
  name              VARCHAR(80) NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_plans_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE plan_versions (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_id           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version           INT UNSIGNED NOT NULL,
  effective_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  feature_limits    JSON NOT NULL COMMENT '{"analysis_minutes":600,"render_minutes":120,"storage_gb":500,"seats":5,"max_upload_bytes":...}',
  is_published      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_versions (plan_id, version),
  CONSTRAINT fk_pv_plan FOREIGN KEY (plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE plan_prices (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_version_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider          ENUM('STRIPE','PADDLE','MANUAL') NOT NULL,
  external_price_id VARCHAR(255) CHARACTER SET ascii NOT NULL,
  billing_period    ENUM('MONTHLY','YEARLY','CUSTOM') NOT NULL,
  currency          CHAR(3) CHARACTER SET ascii NOT NULL,
  unit_amount_minor BIGINT UNSIGNED NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_plan_prices_ext (provider, external_price_id),
  CONSTRAINT fk_pp_version FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE billing_customers (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider          ENUM('STRIPE','PADDLE','MANUAL') NOT NULL,
  provider_customer_id VARCHAR(255) CHARACTER SET ascii NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_bc_org (organization_id),
  UNIQUE KEY uq_bc_ext (provider, provider_customer_id),
  CONSTRAINT fk_bc_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE subscriptions (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_version_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_subscription_id VARCHAR(255) CHARACTER SET ascii NULL,
  state             ENUM('TRIALING','ACTIVE','PAST_DUE','CANCELED','UNPAID','INCOMPLETE') NOT NULL,
  period_start      DATETIME(6) NULL,
  period_end        DATETIME(6) NULL,
  trial_end         DATETIME(6) NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  row_version       BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sub_ext (provider_subscription_id),
  KEY ix_sub_org (organization_id, state),
  CONSTRAINT fk_sub_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_sub_pv  FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id),
  CONSTRAINT ck_sub_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end > period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE billing_webhook_inbox (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider          ENUM('STRIPE','PADDLE','MANUAL') NOT NULL,
  external_event_id VARCHAR(255) CHARACTER SET ascii NOT NULL,
  signature_verified BOOLEAN NOT NULL,
  event_kind        VARCHAR(100) CHARACTER SET ascii NOT NULL,
  payload_sha256    CHAR(64) CHARACTER SET ascii NOT NULL,
  payload           JSON NOT NULL,
  received_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  processed_at      DATETIME(6) NULL,
  error_code        VARCHAR(64) CHARACTER SET ascii NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bwi (provider, external_event_id),
  CONSTRAINT ck_bwi_verified CHECK (processed_at IS NULL OR signature_verified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE invoices (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subscription_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  provider_invoice_id VARCHAR(255) CHARACTER SET ascii NULL,
  amount_due_minor  BIGINT UNSIGNED NOT NULL,
  currency          CHAR(3) CHARACTER SET ascii NOT NULL,
  invoice_state     ENUM('DRAFT','OPEN','PAID','VOID','UNCOLLECTIBLE') NOT NULL,
  occurred_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_inv_ext (provider_invoice_id),
  CONSTRAINT fk_inv_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_inv_sub FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE entitlement_grants (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_subscription_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  feature_key       VARCHAR(64) CHARACTER SET ascii NOT NULL,
  limit_value       BIGINT NULL COMMENT 'NULL = unlimited',
  valid_from        DATETIME(6) NOT NULL,
  valid_until       DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY ix_eg_lookup (organization_id, feature_key, valid_from),
  CONSTRAINT fk_eg_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_eg_sub FOREIGN KEY (source_subscription_id) REFERENCES subscriptions(id),
  CONSTRAINT ck_eg_range CHECK (valid_until IS NULL OR valid_until > valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE quota_counters (
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  feature_key       VARCHAR(64) CHARACTER SET ascii NOT NULL,
  window_start      DATETIME(6) NOT NULL,
  used_amount       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  reserved_amount   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, feature_key, window_start),
  CONSTRAINT fk_qc_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE quota_reservations (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  feature_key       VARCHAR(64) CHARACTER SET ascii NOT NULL,
  window_start      DATETIME(6) NOT NULL,
  quantity          BIGINT UNSIGNED NOT NULL,
  status            ENUM('RESERVED','COMMITTED','RELEASED') NOT NULL,
  subject_type      VARCHAR(40) CHARACTER SET ascii NOT NULL COMMENT 'PIPELINE_RUN / RENDER_JOB / UPLOAD',
  subject_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key   VARCHAR(128) CHARACTER SET ascii NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_qr_idem (organization_id, feature_key, idempotency_key),
  CONSTRAINT fk_qr_counter FOREIGN KEY (organization_id, feature_key, window_start) REFERENCES quota_counters(organization_id, feature_key, window_start),
  CONSTRAINT ck_qr_qty CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE usage_events (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reservation_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  event_key         VARCHAR(160) CHARACTER SET ascii NOT NULL,
  quantity          BIGINT UNSIGNED NOT NULL,
  unit              ENUM('ANALYSIS_SECOND','RENDER_SECOND','STORAGE_BYTE_DAY','UPLOAD_BYTE','SEAT','REPORT') NOT NULL,
  occurred_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ue_key (event_key),
  KEY ix_ue_org (organization_id, unit, occurred_at),
  CONSTRAINT fk_ue_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_ue_res FOREIGN KEY (reservation_id) REFERENCES quota_reservations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

-- Rights + entitlement checks recorded at ENQUEUE and at DELIVERY (ADR-007). (Handoff's invalid CHAR(36)[] replaced by JSON arrays.)
CREATE TABLE policy_decisions (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action            ENUM('ANALYZE','PRODUCE','EXPORT','VIEW','DOWNLOAD','SHARE','DELIVER') NOT NULL,
  resource_type     VARCHAR(40) CHARACTER SET ascii NOT NULL,
  resource_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  decision          ENUM('ALLOW','DENY','REVIEW') NOT NULL,
  rule_version      VARCHAR(20) NOT NULL,
  grant_ids         JSON NOT NULL DEFAULT (JSON_ARRAY()),
  dependency_asset_ids JSON NOT NULL DEFAULT (JSON_ARRAY()),
  reason_codes      JSON NOT NULL DEFAULT (JSON_ARRAY()),
  checked_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_pd_resource (organization_id, resource_type, resource_id, checked_at),
  CONSTRAINT fk_pd_org   FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_pd_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  CONSTRAINT ck_pd_arrays CHECK (JSON_TYPE(grant_ids) = 'ARRAY' AND JSON_TYPE(dependency_asset_ids) = 'ARRAY' AND JSON_TYPE(reason_codes) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

ALTER TABLE deliveries ADD CONSTRAINT fk_del_policy FOREIGN KEY (rights_decision_id) REFERENCES policy_decisions(id);

CREATE TABLE artifact_dependencies (
  artifact_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  depends_on_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dependency_type   ENUM('SOURCE_VIDEO','AUDIO','FONT','LOGO','TRACKS','MODEL','METADATA','OTHER') NOT NULL,
  PRIMARY KEY (artifact_asset_id, depends_on_asset_id, dependency_type),
  KEY ix_ad_dep (depends_on_asset_id),
  CONSTRAINT fk_ad_art FOREIGN KEY (artifact_asset_id) REFERENCES assets(id),
  CONSTRAINT fk_ad_dep FOREIGN KEY (depends_on_asset_id) REFERENCES assets(id),
  CONSTRAINT ck_ad_self CHECK (artifact_asset_id <> depends_on_asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC COMMENT='Revoking a source right blocks every derived render/report that depends on it';

-- Append-only audit log, range-partitioned by month for cheap retention (no FKs on partitioned tables).
CREATE TABLE audit_events (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  occurred_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_kind        ENUM('USER','SERVICE','SHARE_LINK','SYSTEM') NOT NULL,
  action            VARCHAR(80) CHARACTER SET ascii NOT NULL,
  entity_type       VARCHAR(40) CHARACTER SET ascii NOT NULL,
  entity_id         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  request_id        VARCHAR(64) CHARACTER SET ascii NULL,
  ip_hash           CHAR(64) CHARACTER SET ascii NULL,
  before_state      JSON NULL,
  after_state       JSON NULL,
  PRIMARY KEY (id, occurred_at),
  KEY ix_audit_entity (organization_id, entity_type, entity_id, occurred_at),
  KEY ix_audit_actor (organization_id, actor_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC
PARTITION BY RANGE COLUMNS (occurred_at) (
  PARTITION p2026_10 VALUES LESS THAN ('2026-11-01'),
  PARTITION p2026_11 VALUES LESS THAN ('2026-12-01'),
  PARTITION p2026_12 VALUES LESS THAN ('2027-01-01'),
  PARTITION p_future VALUES LESS THAN (MAXVALUE)
);

CREATE TABLE outbox_events (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  aggregate_type    VARCHAR(40) CHARACTER SET ascii NOT NULL,
  aggregate_id      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type        VARCHAR(80) CHARACTER SET ascii NOT NULL COMMENT 'e.g. pipeline.step.progressed, render.job.succeeded',
  schema_version    SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  event_payload     JSON NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  available_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  claimed_by        VARCHAR(64) CHARACTER SET ascii NULL,
  claimed_at        DATETIME(6) NULL,
  delivered_at      DATETIME(6) NULL,
  attempt_count     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  last_error        VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY ix_outbox_pending (delivered_at, available_at, id),
  KEY ix_outbox_aggregate (aggregate_type, aggregate_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC COMMENT='Dispatcher: SELECT ... WHERE delivered_at IS NULL AND available_at<=NOW(6) ORDER BY id LIMIT n FOR UPDATE SKIP LOCKED';

CREATE TABLE idempotency_keys (
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key   VARCHAR(128) CHARACTER SET ascii NOT NULL,
  request_hash      CHAR(64) CHARACTER SET ascii NOT NULL,
  route             VARCHAR(120) CHARACTER SET ascii NOT NULL,
  response_status   SMALLINT UNSIGNED NULL,
  response_body     JSON NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at        DATETIME(6) NOT NULL,
  PRIMARY KEY (organization_id, idempotency_key),
  KEY ix_idem_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE security_events (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ip_hash           CHAR(64) CHARACTER SET ascii NULL,
  event_kind        VARCHAR(64) CHARACTER SET ascii NOT NULL,
  outcome           ENUM('SUCCESS','FAILURE','BLOCKED') NOT NULL,
  details           JSON NULL,
  occurred_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_sec (organization_id, event_kind, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE admin_actions (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actor_id          CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  action            VARCHAR(80) CHARACTER SET ascii NOT NULL,
  justification     TEXT NOT NULL,
  approved_by       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  occurred_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  CONSTRAINT fk_aa_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  CONSTRAINT fk_aa_appr  FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT ck_aa_four_eyes CHECK (approved_by IS NULL OR approved_by <> actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE processing_dead_letters (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workflow_id       VARCHAR(255) CHARACTER SET ascii NOT NULL,
  job_kind          VARCHAR(40) CHARACTER SET ascii NOT NULL,
  error_code        VARCHAR(64) CHARACTER SET ascii NOT NULL,
  attempt_count     SMALLINT UNSIGNED NOT NULL,
  payload_object_key VARCHAR(1024) NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  resolved_at       DATETIME(6) NULL,
  PRIMARY KEY (id),
  KEY ix_pdl_open (resolved_at, created_at),
  CONSTRAINT fk_pdl_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE retention_jobs (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  organization_id   CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject_type      VARCHAR(40) CHARACTER SET ascii NOT NULL,
  subject_id        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_by      CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  legal_hold        BOOLEAN NOT NULL DEFAULT FALSE,
  status            ENUM('QUEUED','RUNNING','DONE','BLOCKED','FAILED') NOT NULL,
  created_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at       DATETIME(6) NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_ret_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT ck_ret_hold CHECK (NOT (legal_hold AND status = 'DONE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE release_signoffs (
  id                CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  build_sha         CHAR(40) CHARACTER SET ascii NOT NULL,
  gate_code         VARCHAR(64) CHARACTER SET ascii NOT NULL,
  state             ENUM('PENDING','PASS','FAIL','WAIVED') NOT NULL,
  signed_by         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  evidence_object_key VARCHAR(1024) NULL,
  signed_at         DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rs (build_sha, gate_code),
  CONSTRAINT fk_rs_user FOREIGN KEY (signed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;

CREATE TABLE schema_migrations (
  version           VARCHAR(10) CHARACTER SET ascii NOT NULL,
  description       VARCHAR(200) NOT NULL,
  checksum_sha256   CHAR(64) CHARACTER SET ascii NOT NULL,
  applied_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  applied_by        VARCHAR(100) NOT NULL DEFAULT (CURRENT_USER()),
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci ROW_FORMAT=DYNAMIC;
