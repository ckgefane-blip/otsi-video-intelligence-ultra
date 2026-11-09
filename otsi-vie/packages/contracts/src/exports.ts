import { z } from "zod";
import { CreateShareLinkRequest } from "./sharing";

/**
 * Page 10 Output & Reports, Download All and Deliver to Client (ADR-058, migration 0044). A bundle is the companions of one finished
 * render; each item is made on its own and may fail or be "not measured" without touching the others. Nothing is invented: the PDFs,
 * CSV and PNG are built only from recorded clips, confirmed identities and measured values.
 */
export const BundleItemKind = z.enum(["PERFORMANCE_PDF", "CLIP_SHEET_PDF", "EVENTS_CSV", "HEATMAP_PNG"]);
export type BundleItemKind = z.infer<typeof BundleItemKind>;
export const BUNDLE_ITEM_NAMES: Record<BundleItemKind, [string, string]> = {
  PERFORMANCE_PDF: ["Performance Report (PDF)", "His measured numbers, events and published assessment"],
  CLIP_SHEET_PDF: ["Clip Sheet (PDF)", "Each clip: time, his events, how he was identified"],
  EVENTS_CSV: ["Event List (CSV)", "All clips and his events with timestamps"],
  HEATMAP_PNG: ["Heatmap (PNG)", "Where he was measured on the pitch"],
};

export const BundleItem = z.object({
  kind: BundleItemKind,
  state: z.enum(["SUCCEEDED", "FAILED", "NOT_MEASURED"]),
  bytes: z.number().int().nullable(),
  sha256: z.string().nullable(),
  failure: z.string().nullable(),
  /** signed links (members only, a few hours) */
  view_url: z.string().nullable(),
  download_url: z.string().nullable(),
});
export type BundleItem = z.infer<typeof BundleItem>;

export const ExportBundle = z.object({
  id: z.string().uuid(),
  reel_id: z.string().uuid(),
  render_id: z.string().uuid(),
  requested: z.array(BundleItemKind),
  items: z.array(BundleItem),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  requested_by_name: z.string(),
  /** Download All: the ZIP of the render and these files, once made */
  zip: z.object({ bytes: z.number().int(), download_url: z.string() }).nullable(),
});
export type ExportBundle = z.infer<typeof ExportBundle>;

export const CreateBundleRequest = z.object({ items: z.array(BundleItemKind).min(1).max(4).refine((a) => new Set(a).size === a.length, "an item is listed twice") });
export type CreateBundleRequest = z.infer<typeof CreateBundleRequest>;

export const CreateDeliveryRequest = z.object({
  notify_client: z.boolean().default(false),
  recipient_name: z.string().trim().max(255).nullable().default(null),
  recipient_email: z.string().trim().max(255).email().nullable().default(null),
  notify_team: z.boolean().default(false),
  team_user_ids: z.array(z.string().uuid()).max(50).default([]),
  message: z.string().max(2000).default(""),
  link: CreateShareLinkRequest.default({}),
});
export type CreateDeliveryRequest = z.infer<typeof CreateDeliveryRequest>;

export const Delivery = z.object({
  id: z.string().uuid(),
  render_id: z.string().uuid(),
  state: z.string(),
  /** OWN_MAIL_APP: the message was handed to the sender's own mail app; the server cannot know it was sent */
  channel: z.string().nullable(),
  recipient_name: z.string().nullable(),
  recipient_email: z.string().nullable(),
  team: z.array(z.object({ user_id: z.string().uuid(), display_name: z.string() })),
  message: z.string().nullable(),
  failure: z.string().nullable(),
  created_at: z.string(),
  requested_by_name: z.string(),
  /** receipts: how often the link was opened, and whether it still works */
  link: z.object({ id: z.string().uuid(), opened: z.number().int(), expires_at: z.string(), revoked: z.boolean(), expired: z.boolean() }).nullable(),
});
export type Delivery = z.infer<typeof Delivery>;

export const CreatedDelivery = z.object({
  delivery: Delivery,
  /** the share link's path (the page adds its own origin) */
  url: z.string(),
  mail: z.object({ to: z.array(z.string()), bcc: z.array(z.string()), subject: z.string(), body: z.string() }),
});
export type CreatedDelivery = z.infer<typeof CreatedDelivery>;
