-- 0041 Clip Studio transitions and templates (OTSI VIE v2, MySQL 8.4) - 2026-11-05, ADR-055
-- Transitions lane (page 07 section 08): a transition into a clip is a timeline item on the reel's TRANSITION track, tied to the clip it
-- leads into (reel_clip_id; parameters {"kind": FADE|DISSOLVE|ZOOM|SPIN}; duration_us its length; start_us 0 = at that clip's start, so it
-- follows the clip when clips are reordered). One per clip: a unique key. Removing a clip removes its transition (the baseline FK had no
-- ON DELETE rule, so deleting a clip with a transition would have failed).
-- Templates (page 07 Media Bin): a saved reel look is an effect preset of the organization (schema_version 'reel-look/1', config {aspect,
-- settings}); who saved it and when it last changed.
-- Forward-only: the tables are empty in every environment; the new key and columns hold for empty tables.
ALTER TABLE `timeline_items`
  DROP FOREIGN KEY `fk_timeline_items_91`;
ALTER TABLE `timeline_items`
  ADD CONSTRAINT `fk_timeline_items_91` FOREIGN KEY (`reel_clip_id`) REFERENCES `reel_clips` (`id`) ON DELETE CASCADE,
  ADD UNIQUE KEY `uq_timeline_items_track_clip` (`timeline_track_id`, `reel_clip_id`);

ALTER TABLE `effect_presets`
  ADD COLUMN `created_by` CHAR(36) NULL,
  ADD COLUMN `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  ADD CONSTRAINT `fk_effect_presets_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`);
