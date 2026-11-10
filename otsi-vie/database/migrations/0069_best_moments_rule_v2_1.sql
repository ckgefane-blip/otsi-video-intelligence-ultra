-- 0069 best-moments rule v2.1 (OTSI VIE v2, MySQL 8.4): ADR-131
-- The best-moments rule is now versioned "2.1" (a dotted string, not an integer): the selection's rule_version, the
-- reel's best_moments_rule_version and the render snapshot's selection.version all stamp "2.1" from v2.1 on. The column
-- therefore moves from INT to VARCHAR(16) (16 leaves room for later dotted versions such as "2.10").
-- Safe on existing rows: no cross-match reels exist yet (the first cross-match reels are built by this code, after the
-- migration), so every existing row has NULL here and stays NULL. The conversion itself is defensive anyway: MySQL
-- converts INT -> VARCHAR keeping the digits (1 -> '1'), NULL stays NULL, and the UPDATE below normalises any value
-- the conversion produced, so an integer that somehow got in becomes its string form rather than being lost.
-- The 0068 CHECK is untouched: it only requires the version to be NOT NULL on an ALL_MATCHES reel, which holds for a
-- VARCHAR exactly as it did for an INT.
-- Forward-only: one column type change, one defensive backfill.
ALTER TABLE `reel_projects`
  MODIFY COLUMN `best_moments_rule_version` VARCHAR(16) NULL;

UPDATE `reel_projects`
   SET `best_moments_rule_version` = CAST(`best_moments_rule_version` AS CHAR)
 WHERE `best_moments_rule_version` IS NOT NULL;
