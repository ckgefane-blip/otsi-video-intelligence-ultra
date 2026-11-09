-- 0011 credential email must really be lower case (OTSI VIE v2, MySQL 8.4) — ADR-021
-- 0010's check `email_normalized = LOWER(email_normalized)` compared under the column's case-INSENSITIVE collation (utf8mb4_0900_ai_ci),
-- so 'Mixed@b.test' passed. Found by tests/db/test_behaviour.py; fixed forward (0010 is applied and checksum-locked, ADR-014).
ALTER TABLE `local_credentials`
  DROP CHECK `ck_local_credentials_email`,
  ADD CONSTRAINT `ck_local_credentials_email` CHECK (
    CAST(`email_normalized` AS BINARY) = CAST(LOWER(`email_normalized`) AS BINARY) AND `email_normalized` LIKE '%_@_%');
