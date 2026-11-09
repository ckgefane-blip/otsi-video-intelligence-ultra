-- 0030 match periods (OTSI VIE v2, MySQL 8.4) — when the halves are played inside a broadcast, 2026-11-01 (owner: "Perfect move ... on
-- skipping pre-match and half time programme")
-- The engine proposes the first and the second half from how many players it follows on the pitch (packages/contracts periods.ts); a person
-- confirms or corrects them. One current row per video; every decision is also in the audit log. Forward-only: one new table.
CREATE TABLE `match_periods` (
  `video_id` CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36) NOT NULL,
  `run_id` CHAR(36) NULL,                              -- the analysis the proposal was detected from
  `state` VARCHAR(10) NOT NULL,
  `first_start_us` BIGINT NOT NULL,
  `first_end_us` BIGINT NOT NULL,
  `second_start_us` BIGINT NULL,
  `second_end_us` BIGINT NULL,
  `note` TEXT NULL,
  `per_minute` JSON NULL,                              -- players followed per analysed frame, minute by minute (the evidence)
  `decided_by` CHAR(36) NULL,
  `decided_at` DATETIME(6) NULL,
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY `fk_mp_org` (`organization_id`),
  KEY `fk_mp_video` (`video_id`, `organization_id`),
  KEY `fk_mp_run` (`run_id`),
  KEY `fk_mp_user` (`decided_by`),
  CONSTRAINT `fk_mp_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  CONSTRAINT `fk_mp_video` FOREIGN KEY (`video_id`, `organization_id`) REFERENCES `video_sources` (`id`, `organization_id`),
  CONSTRAINT `fk_mp_run` FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs` (`id`),
  CONSTRAINT `fk_mp_user` FOREIGN KEY (`decided_by`) REFERENCES `users` (`id`),
  CONSTRAINT `ck_mp_state` CHECK (`state` IN ('PROPOSED', 'CONFIRMED')),
  CONSTRAINT `ck_mp_first` CHECK (`first_start_us` >= 0 AND `first_end_us` > `first_start_us`),
  CONSTRAINT `ck_mp_second` CHECK ((`second_start_us` IS NULL AND `second_end_us` IS NULL)
    OR (`second_start_us` >= `first_end_us` AND `second_end_us` > `second_start_us`)),
  CONSTRAINT `ck_mp_decided` CHECK (`state` <> 'CONFIRMED' OR (`decided_by` IS NOT NULL AND `decided_at` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
