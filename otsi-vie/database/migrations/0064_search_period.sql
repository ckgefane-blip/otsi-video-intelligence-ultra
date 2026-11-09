-- 0064 search period: v3 Phase E.5 (ADR-120), 2026-11-09
-- Add match period (H1, H2) to search_documents for cross-match moment filtering.
ALTER TABLE `search_documents`
  ADD COLUMN `period` VARCHAR(8) NULL AFTER `at_us`,
  ADD KEY `idx_search_doc_period` (`organization_id`, `kind`, `period`);
