-- C.1 (ADR-102). One-use previews scoped to the person, organization, and role that requested them.
CREATE TABLE assistant_plans (
  id CHAR(36) NOT NULL PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  preview_role VARCHAR(16) NOT NULL,
  step JSON NULL,
  expires_at DATETIME(6) NOT NULL,
  approved_at DATETIME(6) NULL,
  KEY ix_assistant_plans_user (organization_id, user_id, expires_at),
  CONSTRAINT fk_assistant_plans_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_assistant_plans_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
