-- 0003 tenant integrity (OTSI VIE v2, MySQL 8.4)
-- MySQL has no row-level security. These keys make the DATABASE itself refuse a row of one organization that points at a parent row of
-- another organization (C-SQL-05). A NULL link is still allowed (MATCH SIMPLE). Tenant scoping of reads stays the API's job (ADR-002).
-- Additive only: the original single-column foreign keys are kept.

ALTER TABLE `assets` ADD UNIQUE KEY `uq_assets_id_org` (`id`, `organization_id`);
ALTER TABLE `audit_events` ADD UNIQUE KEY `uq_audit_events_id_org` (`id`, `organization_id`);
ALTER TABLE `matches` ADD UNIQUE KEY `uq_matches_id_org` (`id`, `organization_id`);
ALTER TABLE `projects` ADD UNIQUE KEY `uq_projects_id_org` (`id`, `organization_id`);
ALTER TABLE `quota_reservations` ADD UNIQUE KEY `uq_quota_reservations_id_org` (`id`, `organization_id`);
ALTER TABLE `reel_projects` ADD UNIQUE KEY `uq_reel_projects_id_org` (`id`, `organization_id`);
ALTER TABLE `subscriptions` ADD UNIQUE KEY `uq_subscriptions_id_org` (`id`, `organization_id`);
ALTER TABLE `video_sources` ADD UNIQUE KEY `uq_video_sources_id_org` (`id`, `organization_id`);

ALTER TABLE `assets` ADD CONSTRAINT `fk_t_assets_source_asset_id` FOREIGN KEY (`source_asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);
ALTER TABLE `deliveries` ADD CONSTRAINT `fk_t_deliveries_asset_id` FOREIGN KEY (`asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);
ALTER TABLE `render_jobs` ADD CONSTRAINT `fk_t_render_jobs_output_asset_id` FOREIGN KEY (`output_asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);
ALTER TABLE `render_jobs` ADD CONSTRAINT `fk_t_render_jobs_manifest_asset_id` FOREIGN KEY (`manifest_asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);
ALTER TABLE `report_jobs` ADD CONSTRAINT `fk_t_report_jobs_output_asset_id` FOREIGN KEY (`output_asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);
ALTER TABLE `rights_grants` ADD CONSTRAINT `fk_t_rights_grants_evidence_asset_id` FOREIGN KEY (`evidence_asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);
ALTER TABLE `rights_grants` ADD CONSTRAINT `fk_t_rights_grants_asset_id` FOREIGN KEY (`asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);
ALTER TABLE `share_links` ADD CONSTRAINT `fk_t_share_links_asset_id` FOREIGN KEY (`asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);
ALTER TABLE `video_sources` ADD CONSTRAINT `fk_t_video_sources_source_asset_id` FOREIGN KEY (`source_asset_id`, `organization_id`) REFERENCES `assets` (`id`, `organization_id`);
ALTER TABLE `admin_actions` ADD CONSTRAINT `fk_t_admin_actions_resulting_audit_event_id` FOREIGN KEY (`resulting_audit_event_id`, `organization_id`) REFERENCES `audit_events` (`id`, `organization_id`);
ALTER TABLE `video_sources` ADD CONSTRAINT `fk_t_video_sources_match_id` FOREIGN KEY (`match_id`, `organization_id`) REFERENCES `matches` (`id`, `organization_id`);
ALTER TABLE `assets` ADD CONSTRAINT `fk_t_assets_project_id` FOREIGN KEY (`project_id`, `organization_id`) REFERENCES `projects` (`id`, `organization_id`);
ALTER TABLE `comments` ADD CONSTRAINT `fk_t_comments_project_id` FOREIGN KEY (`project_id`, `organization_id`) REFERENCES `projects` (`id`, `organization_id`);
ALTER TABLE `reel_projects` ADD CONSTRAINT `fk_t_reel_projects_project_id` FOREIGN KEY (`project_id`, `organization_id`) REFERENCES `projects` (`id`, `organization_id`);
ALTER TABLE `report_jobs` ADD CONSTRAINT `fk_t_report_jobs_project_id` FOREIGN KEY (`project_id`, `organization_id`) REFERENCES `projects` (`id`, `organization_id`);
ALTER TABLE `video_sources` ADD CONSTRAINT `fk_t_video_sources_project_id` FOREIGN KEY (`project_id`, `organization_id`) REFERENCES `projects` (`id`, `organization_id`);
ALTER TABLE `usage_events` ADD CONSTRAINT `fk_t_usage_events_reservation_id` FOREIGN KEY (`reservation_id`, `organization_id`) REFERENCES `quota_reservations` (`id`, `organization_id`);
ALTER TABLE `comments` ADD CONSTRAINT `fk_t_comments_reel_id` FOREIGN KEY (`reel_id`, `organization_id`) REFERENCES `reel_projects` (`id`, `organization_id`);
ALTER TABLE `render_jobs` ADD CONSTRAINT `fk_t_render_jobs_reel_id` FOREIGN KEY (`reel_id`, `organization_id`) REFERENCES `reel_projects` (`id`, `organization_id`);
ALTER TABLE `entitlement_grants` ADD CONSTRAINT `fk_t_entitlement_grants_source_subscription_id` FOREIGN KEY (`source_subscription_id`, `organization_id`) REFERENCES `subscriptions` (`id`, `organization_id`);
ALTER TABLE `invoices` ADD CONSTRAINT `fk_t_invoices_subscription_id` FOREIGN KEY (`subscription_id`, `organization_id`) REFERENCES `subscriptions` (`id`, `organization_id`);
ALTER TABLE `identity_review_history` ADD CONSTRAINT `fk_t_identity_review_history_video_id` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`);
ALTER TABLE `pipeline_runs` ADD CONSTRAINT `fk_t_pipeline_runs_video_id` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`);
ALTER TABLE `reel_projects` ADD CONSTRAINT `fk_t_reel_projects_video_id` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`);
ALTER TABLE `report_jobs` ADD CONSTRAINT `fk_t_report_jobs_video_id` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`);
ALTER TABLE `rights_grants` ADD CONSTRAINT `fk_t_rights_grants_video_id` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`);
ALTER TABLE `upload_sessions` ADD CONSTRAINT `fk_t_upload_sessions_video_id` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`);
