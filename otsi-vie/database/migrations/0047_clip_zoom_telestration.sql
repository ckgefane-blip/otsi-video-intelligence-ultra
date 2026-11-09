-- 0047 Clip zoom keyframes and telestration (OTSI VIE v2, MySQL 8.4) - 2026-11-06, ADR-068 (editor stage E5)
-- Per reel clip, one JSON document {zoom: [{at_ms, zoom, ease}], drawings: [{kind, x1, y1, x2, y2, color, at_ms, draw_ms, hold_ms}]}, validated
-- by the API (packages/contracts/src/look.ts ClipFx) and drawn by the renderer (render/look.py). NULL means none. The reel's colour look is
-- part of its settings JSON (no column).
-- Forward-only: a new nullable column; existing clips have none.
ALTER TABLE `reel_clips` ADD COLUMN `clip_fx` JSON NULL AFTER `effect_hold_ms`;
ALTER TABLE `reel_clips` ADD CONSTRAINT `ck_reel_clips_fx_object` CHECK (`clip_fx` IS NULL OR JSON_TYPE(`clip_fx`) = 'OBJECT');
