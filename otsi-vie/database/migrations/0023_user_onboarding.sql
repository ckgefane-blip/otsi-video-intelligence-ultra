-- 0023 first-run onboarding (OTSI VIE v2, MySQL 8.4) — splash and tour, 2026-10-30
-- A person sets their own name and finishes the welcome tour the first time they sign in. `onboarded_at` records when; NULL means the tour
-- has not been completed yet (every existing account starts with NULL, so each person sees it once). Forward-only: no existing value changes.
ALTER TABLE `users` ADD COLUMN `onboarded_at` DATETIME(6) NULL;
