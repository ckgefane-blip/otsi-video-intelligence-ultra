-- 0076 grassroots price list: top-ups priced at the plan's own rate (OTSI VIE v2, MySQL 8.4).
-- Owner APPROVED 2026-11-13 (docs/billing-blueprint.md §5): top-ups are sold in blocks of 100 tokens at the customer's own
-- plan per-token price; a customer with no plan pays the Free / "Player pack" rate. wallet_pack_requests.pack_code now records
-- the plan whose rate priced the request, so FREE joins the allowed values. Existing rows keep their codes (no data change).
-- The free grant's column default follows the approved 100 (the API always writes the value explicitly).
ALTER TABLE `wallet_pack_requests`
  MODIFY COLUMN `pack_code` ENUM('FREE','STARTER','CLUB','ACADEMY','SEASON') NOT NULL;
ALTER TABLE `wallet_free_grants`
  MODIFY COLUMN `granted_tokens` INT NOT NULL DEFAULT 100;
