/**
 * v3 Phase B.1 (ADR-081, S11): a reel's edit history, kept on the server for Reel Builder and Clip Studio alike.
 * Every change to what the reel is (name, frame, look, clips, their order, trims, effects, zoom and drawings, transitions) is one EDIT with the
 * reel's state before and after. Undo never deletes anything: it is a new UNDO entry that puts the earlier state back (a compensating
 * change), and Redo is a REDO entry that puts the later state back. A new edit after an undo drops the undone edits from Redo.
 */
import { z } from "zod";

export const ReelEditKind = z.enum(["EDIT", "UNDO", "REDO"]);
export const ReelEditState = z.enum(["ACTIVE", "UNDONE", "DROPPED"]);

export const ReelEditEntry = z.object({
  id: z.string().uuid(),
  seq: z.number().int(),
  kind: ReelEditKind,
  action: z.string(),
  label: z.string(),
  /** EDIT only: ACTIVE (in the reel), UNDONE (can be redone), DROPPED (undone, then another edit was made) */
  state: ReelEditState.nullable(),
  /** UNDO / REDO: the edit it took back or put back */
  target_edit_id: z.string().uuid().nullable(),
  actor: z.object({ user_id: z.string().uuid(), name: z.string() }).nullable(),
  created_at: z.string(),
});
export type ReelEditEntry = z.infer<typeof ReelEditEntry>;

export const ReelHistory = z.object({
  /** newest first, at most 200 */
  entries: z.array(ReelEditEntry),
  can_undo: z.boolean(),
  can_redo: z.boolean(),
  undo_label: z.string().nullable(),
  redo_label: z.string().nullable(),
});
export type ReelHistory = z.infer<typeof ReelHistory>;

/** to_edit_id: undo every active edit after this one and this one too ("go back to before this edit"); none: the latest */
export const ReelUndoRequest = z.object({ to_edit_id: z.string().uuid().optional() });
export type ReelUndoRequest = z.infer<typeof ReelUndoRequest>;
