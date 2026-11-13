/**
 * v3 Phase A.15 (S13, ADR-075): the header's notifications bell. Each notification is read from a recorded row of the organization (nothing
 * is made up or stored twice); "unread" means recorded after the person last opened the bell.
 */
import { z } from "zod";

export const NotificationKind = z.enum(["JOB_DONE", "JOB_FAILED", "REVIEW", "COMMENT", "RIGHTS", "BILLING"]);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const Notification = z.object({
  /** stable per source row, e.g. "run:<id>", "render:<id>", "comment:<id>" */
  id: z.string(),
  kind: NotificationKind,
  title: z.string(),
  detail: z.string().nullable(),
  /** when it happened (ISO) */
  at: z.string(),
  /** the page that deals with it */
  href: z.string(),
  unread: z.boolean(),
});
export type Notification = z.infer<typeof Notification>;

export const Notifications = z.object({
  items: z.array(Notification),
  unread: z.number().int().nonnegative(),
  /** when the person last opened the bell in this organization (null: never) */
  seen_at: z.string().nullable(),
  /** how far back the list goes, in days */
  window_days: z.number().int().positive(),
});
export type Notifications = z.infer<typeof Notifications>;

export const NOTIFICATION_WINDOW_DAYS = 14;
export const NOTIFICATION_LIMIT = 30;
