/**
 * v3 Phase B.1 (ADR-081): a reel's editable state (name, frame, look, clips with effects and drawings, transitions), how it is read and written
 * back, and the EDIT row recorded with every content change. Used by ReelsService (every change) and ReelHistoryService (undo / redo).
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import type { Principal } from "../../core/auth";
import { ApiError, notFound } from "../../core/problem";

interface ClipState {
  id: string; source_video_id: string; in_pts_us: number; out_pts_us: number; sequence_index: number; output_duration_us: number | null;
  playback_speed: number; effect_kind: string; effect_at_us: number | null; effect_hold_ms: number; clip_fx: unknown; source_event_id: string | null;
  review_state: string; origin: string; label: string | null;
}
export interface EditState {
  name: string; aspect: string; settings: unknown;
  clips: ClipState[];
  transitions: { clip_id: string; duration_us: number; parameters: unknown }[];
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) as unknown : v ?? null);

/** JSON with sorted keys, so equal states hash equally */
function stable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
export const stateHash = (s: EditState) => createHash("sha256").update(stable(s)).digest("hex");

/** the reel's editable state; locks the reel row so the change and its record are one step */
export async function snapshot(c: PoolConnection, reelId: string): Promise<EditState> {
  const [r] = await c.query<RowDataPacket[]>("SELECT name, aspect, settings FROM reel_projects WHERE id = ? FOR UPDATE", [reelId]);
  if (!r[0]) throw notFound("Reel");
  const [clips] = await c.query<RowDataPacket[]>(
    `SELECT id, source_video_id, in_pts_us, out_pts_us, sequence_index, output_duration_us, playback_speed, effect_kind, effect_at_us, effect_hold_ms,
            clip_fx, source_event_id, review_state, origin, label FROM reel_clips WHERE reel_id = ? ORDER BY sequence_index`, [reelId]);
  const [tr] = await c.query<RowDataPacket[]>(
    `SELECT i.reel_clip_id, i.duration_us, i.parameters FROM timeline_items i JOIN timeline_tracks t ON t.id = i.timeline_track_id
      WHERE t.reel_id = ? AND t.track_type = 'TRANSITION' AND t.layer = 0 AND i.reel_clip_id IS NOT NULL ORDER BY i.reel_clip_id`, [reelId]);
  return {
    name: r[0].name as string, aspect: r[0].aspect as string, settings: parse(r[0].settings) ?? {},
    clips: clips.map((k) => ({
      id: k.id, source_video_id: k.source_video_id, in_pts_us: Number(k.in_pts_us), out_pts_us: Number(k.out_pts_us), sequence_index: Number(k.sequence_index),
      output_duration_us: num(k.output_duration_us), playback_speed: Number(k.playback_speed), effect_kind: k.effect_kind, effect_at_us: num(k.effect_at_us),
      effect_hold_ms: Number(k.effect_hold_ms), clip_fx: parse(k.clip_fx), source_event_id: k.source_event_id ?? null, review_state: k.review_state, origin: k.origin,
      label: k.label ?? null,
    })),
    transitions: tr.map((t) => ({ clip_id: t.reel_clip_id as string, duration_us: Number(t.duration_us), parameters: parse(t.parameters) ?? {} })),
  };
}

/** write a recorded state back: clips (same ids), their order, effects and drawings, transitions, name, frame and look */
export async function restore(c: PoolConnection, reelId: string, s: EditState): Promise<void> {
  const keep = new Set(s.clips.map((k) => k.id));
  const [now] = await c.query<RowDataPacket[]>("SELECT id FROM reel_clips WHERE reel_id = ?", [reelId]);
  const gone = now.map((k) => k.id as string).filter((id) => !keep.has(id));
  if (gone.length) {
    try {
      await c.query(`DELETE FROM reel_clips WHERE reel_id = ? AND id IN (${gone.map(() => "?").join(",")})`, [reelId, ...gone]);
    } catch (e) {
      if ((e as { errno?: number }).errno === 1451) throw new ApiError(409, "CLIP_REVIEWED", "A clip this would take out has review decisions; it cannot be removed.");
      throw e;
    }
  }
  await c.query("UPDATE reel_clips SET sequence_index = sequence_index + 1000000 WHERE reel_id = ?", [reelId]);
  for (const k of s.clips) {
    await c.query(
      `INSERT INTO reel_clips (id, reel_id, source_video_id, in_pts_us, out_pts_us, sequence_index, output_duration_us, playback_speed, effect_kind, effect_at_us,
                               effect_hold_ms, clip_fx, source_event_id, review_state, origin, label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE in_pts_us = VALUES(in_pts_us), out_pts_us = VALUES(out_pts_us), sequence_index = VALUES(sequence_index),
         output_duration_us = VALUES(output_duration_us), playback_speed = VALUES(playback_speed), effect_kind = VALUES(effect_kind), effect_at_us = VALUES(effect_at_us),
         effect_hold_ms = VALUES(effect_hold_ms), clip_fx = VALUES(clip_fx), source_event_id = VALUES(source_event_id), origin = VALUES(origin), label = VALUES(label)`,
      [k.id, reelId, k.source_video_id, k.in_pts_us, k.out_pts_us, k.sequence_index, k.output_duration_us, k.playback_speed, k.effect_kind, k.effect_at_us,
       k.effect_hold_ms, k.clip_fx === null ? null : JSON.stringify(k.clip_fx), k.source_event_id, k.review_state, k.origin, k.label]);
  }
  let [tr] = await c.query<RowDataPacket[]>("SELECT id FROM timeline_tracks WHERE reel_id = ? AND track_type = 'TRANSITION' AND layer = 0", [reelId]);
  if (tr[0]) await c.query("DELETE FROM timeline_items WHERE timeline_track_id = ? AND reel_clip_id IS NOT NULL", [tr[0].id]);
  if (s.transitions.length) {
    if (!tr[0]) {
      await c.query("INSERT INTO timeline_tracks (id, reel_id, track_type, layer) VALUES (?, ?, 'TRANSITION', 0)", [uuidv7(), reelId]);
      [tr] = await c.query<RowDataPacket[]>("SELECT id FROM timeline_tracks WHERE reel_id = ? AND track_type = 'TRANSITION' AND layer = 0", [reelId]);
    }
    for (const t of s.transitions) {
      await c.query("INSERT INTO timeline_items (id, timeline_track_id, reel_clip_id, start_us, duration_us, parameters) VALUES (?, ?, ?, 0, ?, ?)",
        [uuidv7(), tr[0]!.id, t.clip_id, t.duration_us, JSON.stringify(t.parameters)]);
    }
  }
  await c.query("UPDATE reel_projects SET name = ?, aspect = ?, settings = ?, status = 'DRAFT' WHERE id = ?", [s.name, s.aspect, JSON.stringify(s.settings), reelId]);
}

async function nextSeq(c: PoolConnection, reelId: string): Promise<number> {
  const [r] = await c.query<RowDataPacket[]>("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM reel_edits WHERE reel_id = ?", [reelId]);
  return Number(r[0]!.n);
}

export async function insertRow(c: PoolConnection, orgId: string, reelId: string, row: { kind: "EDIT" | "UNDO" | "REDO"; action: string; label: string; state: string | null;
  target: string | null; actor: string | null; before: EditState; after: EditState }): Promise<string> {
  const id = uuidv7();
  await c.query(
    `INSERT INTO reel_edits (id, organization_id, reel_id, seq, kind, action, label, state, target_edit_id, actor_user_id, before_state, after_state, before_hash, after_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, orgId, reelId, await nextSeq(c, reelId), row.kind, row.action, row.label.slice(0, 255), row.state, row.target, row.actor,
     JSON.stringify(row.before), JSON.stringify(row.after), stateHash(row.before), stateHash(row.after)]);
  return id;
}

/** after a content change (inside its transaction): one EDIT row when the reel changed; undone edits can no longer be redone */
export async function recordEdit(c: PoolConnection, p: Principal, reelId: string, action: string, label: string, before: EditState): Promise<void> {
  const after = await snapshot(c, reelId);
  if (stateHash(after) === stateHash(before)) return;
  await c.query("UPDATE reel_edits SET state = 'DROPPED' WHERE reel_id = ? AND kind = 'EDIT' AND state = 'UNDONE'", [reelId]);
  await insertRow(c, p.organizationId, reelId, { kind: "EDIT", action, label, state: "ACTIVE", target: null, actor: p.userId, before, after });
}
