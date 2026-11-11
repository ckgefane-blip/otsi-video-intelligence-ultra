"use client";
/**
 * Page 10 Export & Delivery: shared state (approved reference 10_EXPORT_DELIVERY, 2560 x 1440 composition).
 *
 * Real: the organization's reels and their renders (GET /v1/reels, polled while a render runs), the chosen reel's render result and
 * download link, the export settings the renderer has (video codec/container, quality = bitrate, aspect = the reel's), and starting a
 * render (POST /v1/reels/:id/renders), the reel's branded overlays (its saved look, PATCH /v1/reels/:id settings, drawn by the renderer)
 * with the organization's logos (GET /v1/brand-assets), and the organization's members (GET /v1/members). The companion files, Download
 * All and Deliver to Client live in Deliver.tsx (ADR-058). Nothing is invented: unknown values are "—".
 */
import type { BrandAsset, ExportPreset, Member, Reel, ReelAspectT, SpotlightSettings } from "@otsi-vie/contracts";
import { createContext, useContext } from "react";
import type { Outbox } from "./Deliver";

export type Codec = "h264" | "av1" | "vp9";
export const QUALITY: [string, number][] = [["Standard", 4], ["High", 8], ["Maximum", 16]];
export const FORMATS: [Codec, string][] = [["h264", "MP4 (H.264)"], ["av1", "MP4 (AV1)"], ["vp9", "WebM (VP9)"]];

export interface Links { url: string; download_url: string; notice: string }

/** E3 (ADR-066), B.22 (ADR-097): the Output Preset, by id: a preset of the library (built in, the organization's or the member's own) */
export type Preset = string;

export interface ExportState {
  reels: Reel[] | null;
  /** the last reels read failed: a failed read is named, never shown as empty */
  reelsFailed: boolean;
  /** read the reels (and their renders) again */
  reload(): Promise<void>;
  reel: Reel | null;
  canEdit: boolean;
  busy: boolean;
  msg: { ok: boolean; text: string } | null;
  codec: Codec;
  setCodec(c: Codec): void;
  bitrate: number;
  setBitrate(b: number): void;
  reset(): void;
  /** E3: the Output Preset (one or two files per render) */
  preset: Preset;
  setPreset(p: Preset): void;
  /** B.22: the preset library, and opening it */
  presets: ExportPreset[];
  openLibrary(): void;
  /** C.3 (ADR-103): OpenTimelineIO (.otio) and .otsi-reel manifest interchange dialog */
  openInterchange(): void;
  /** ADR-142: the Single Match Spotlight / Scouting Pack dialog (the paid bundle: reel + report + published brief) */
  openScoutingPack(): void;
  /** E3: download one of the reel's finished files (Reel.formats) */
  download(renderId: string): void;
  setAspect(a: ReelAspectT): void;
  render(): void;
  /** the latest finished render's playback and download links */
  links: Links | null;
  pick(): void;
  tab: number;
  focus: string | null;
  jump(i: number): void;
  autoChapters: boolean;
  setAutoChapters(b: boolean): void;
  /** change part of the reel's look (what the renderer draws); saved at once, the next render uses it */
  setSettings(patch: Partial<SpotlightSettings>, ok: string): void;
  /** the organization's logos, music and intro / outro videos with the state of their rights */
  brand: BrandAsset[] | null;
  /** the organization's active members */
  members: Member[] | null;
  /** owners and admins manage the team (invite, roles) */
  canManageTeam: boolean;
  /** the reel's source match, as recorded */
  match: { title: string; competition: string; date: string } | null;
  /** the companion files, Download All and Deliver to Client (Deliver.tsx, ADR-058) */
  outbox: Outbox;
}
const Ctx = createContext<ExportState | null>(null);
export const ExportProvider = Ctx.Provider;
export function useExport(): ExportState {
  const c = useContext(Ctx);
  if (!c) throw new Error("outside the Export stage");
  return c;
}

export const sec = (us: number) => `${Math.floor(us / 6e7).toString().padStart(2, "0")}:${(Math.floor(us / 1e6) % 60).toString().padStart(2, "0")}`;
export const active = (r: Reel) => !!r.latest_render && ["QUEUED", "RUNNING"].includes(r.latest_render.state);
