/**
 * Library folders, delete and Trash (ADR-052, migration 0039). Owner 2026-11-05: deleting from the Library must really work, without
 * patch-on-patch. Three rules:
 *   - A folder only groups items. Deleting a folder never deletes what is in it; moving an item into a folder changes one row.
 *   - Delete removes only what the person chose (owner 2026-11-06, ADR-074). A reel takes its own rendered files; a match leaves its
 *     videos in the Library, just unlinked; a video still used by reels, or a project that still holds videos or reels, is refused and
 *     the dialog lists what to delete first. (Before ADR-074 a project, match or video took everything made from it.)
 *   - Every delete goes to the Trash as one entry. Restore brings back everything that entry removed. Nothing is erased.
 */
import { z } from "zod";

/** what a person can delete in the Library */
export const RemovableKind = z.enum(["reel", "render", "video", "match", "project", "folder"]);
export type RemovableKind = z.infer<typeof RemovableKind>;
/** what can be put in a folder */
export const FolderItemKind = z.enum(["reel", "render", "video", "match", "project"]);
export type FolderItemKind = z.infer<typeof FolderItemKind>;

export const RemovalItem = z.object({ id: z.string().uuid(), title: z.string() });

export const RemovalPreview = z.object({
  kind: RemovableKind,
  id: z.string().uuid(),
  title: z.string(),
  /** deleted together with it (ADR-074: always empty; nothing else goes without being chosen) */
  videos: z.array(RemovalItem),
  reels: z.array(RemovalItem),
  /** rendered files that leave the Library and Export with it */
  renders: z.number().int().nonnegative(),
  /** share links that stop working (they stay off after a restore) */
  share_links: z.number().int().nonnegative(),
  /** analyses still queued or running that are stopped */
  running_analyses: z.number().int().nonnegative(),
  /** a folder: how many items it holds; they stay in the Library */
  kept_items: z.number().int().nonnegative(),
  /** why it cannot be deleted now (null: it can) */
  blocked: z.string().nullable(),
  /** a match: its videos, which stay in the Library and only leave the match (a restore links them again) */
  unlinked: z.array(RemovalItem).default([]),
  /** what still uses it and has to be deleted first (a video's reels; a project's videos and reels); non-empty means blocked */
  in_use: z.array(RemovalItem.extend({ kind: RemovableKind })).default([]),
});
export type RemovalPreview = z.infer<typeof RemovalPreview>;

export const LibraryFolder = z.object({
  id: z.string().uuid(),
  name: z.string(),
  item_count: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type LibraryFolder = z.infer<typeof LibraryFolder>;

export const CreateFolderRequest = z.object({ name: z.string().trim().min(1).max(255) }).strict();
export type CreateFolderRequest = z.infer<typeof CreateFolderRequest>;
export const RenameFolderRequest = z.object({ version: z.number().int().positive(), name: z.string().trim().min(1).max(255) }).strict();
export type RenameFolderRequest = z.infer<typeof RenameFolderRequest>;

/** which folder each item is in (an item is in at most one) */
export const FolderMembership = z.object({ item_kind: FolderItemKind, item_id: z.string().uuid(), folder_id: z.string().uuid() });
export type FolderMembership = z.infer<typeof FolderMembership>;
/** put an item in a folder, or take it out (folder_id null) */
export const PlaceItemRequest = z.object({ folder_id: z.string().uuid().nullable() }).strict();
export type PlaceItemRequest = z.infer<typeof PlaceItemRequest>;

export const TrashEntry = z.object({
  id: z.string().uuid(),
  kind: RemovableKind,
  item_id: z.string().uuid(),
  title: z.string(),
  deleted_at: z.string(),
  deleted_by: z.string().nullable(),
  /** everything else this delete removed, counted by kind */
  with: z.object({ videos: z.number().int().nonnegative(), reels: z.number().int().nonnegative(), renders: z.number().int().nonnegative() }),
  /** why Restore cannot run now (null: it can), e.g. its project is in the Trash too */
  blocked: z.string().nullable(),
  /** D.4 Retention: calculated expiration date based on org trash_days policy */
  expires_at: z.string().nullable().optional(),
  /** days remaining until permanent erasure eligibility (0 = eligible now) */
  days_remaining: z.number().int().nullable().optional(),
  /** whether the item is past its retention threshold and eligible for purge */
  can_purge: z.boolean().optional(),
});
export type TrashEntry = z.infer<typeof TrashEntry>;
