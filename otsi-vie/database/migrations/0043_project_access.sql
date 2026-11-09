-- 0043 Project access (OTSI VIE v2, MySQL 8.4) - 2026-11-06, ADR-057
-- Page 09 Collaborators / Manage Access (owner: "Yes, lock it"). A project is open to the whole organization (ORGANIZATION, the default:
-- every existing project keeps how it works today) or only to the people chosen for it (RESTRICTED). In a restricted project only Owners,
-- Admins and the people listed in project_acl see its videos, reels, renders and reports; everyone else gets "not found" everywhere.
-- project_acl keeps its baseline shape; the API writes ONE permission per person (READ viewer, REVIEW reviewer, EDIT editor, ADMIN manager).
-- Forward-only: one column with a default, one index, one FK index.
ALTER TABLE `projects`
  ADD COLUMN `access` ENUM('ORGANIZATION','RESTRICTED') NOT NULL DEFAULT 'ORGANIZATION',
  ADD KEY `ix_projects_org_access` (`organization_id`, `access`);

ALTER TABLE `project_acl`
  ADD KEY `ix_project_acl_user` (`user_id`, `project_id`);
