-- 0046 Clip speed effects (OTSI VIE v2, MySQL 8.4) - 2026-11-06, ADR-065 (editor stage E2)
-- One speed effect per reel clip: NONE, SLOW (the whole clip at playback_speed), FREEZE (the picture held at effect_at_us for
-- effect_hold_ms) or RAMP (eases down to playback_speed at effect_at_us and back up). effect_at_us is a source time; when a trim leaves it
-- outside the clip the effect stays stored but does nothing (packages/contracts/src/retime.ts, render/reel.py retime_segments).
-- Forward-only: new defaulted columns and checks; existing clips get NONE.
ALTER TABLE `reel_clips`
  ADD COLUMN `effect_kind` VARCHAR(8) NOT NULL DEFAULT 'NONE' AFTER `playback_speed`,
  ADD COLUMN `effect_at_us` BIGINT NULL AFTER `effect_kind`,
  ADD COLUMN `effect_hold_ms` INT NOT NULL DEFAULT 0 AFTER `effect_at_us`;

ALTER TABLE `reel_clips` ADD CONSTRAINT `ck_reel_clips_effect_kind` CHECK (`effect_kind` IN ('NONE', 'SLOW', 'FREEZE', 'RAMP'));
ALTER TABLE `reel_clips` ADD CONSTRAINT `ck_reel_clips_effect_moment` CHECK ((`effect_kind` IN ('FREEZE', 'RAMP')) = (`effect_at_us` IS NOT NULL));
ALTER TABLE `reel_clips` ADD CONSTRAINT `ck_reel_clips_effect_hold` CHECK (`effect_hold_ms` BETWEEN 0 AND 3000 AND (`effect_kind` = 'FREEZE') = (`effect_hold_ms` > 0));
ALTER TABLE `reel_clips` ADD CONSTRAINT `ck_reel_clips_speed_range` CHECK (`playback_speed` BETWEEN 0.25 AND 1 AND (`effect_kind` IN ('SLOW', 'RAMP')) = (`playback_speed` < 1));
