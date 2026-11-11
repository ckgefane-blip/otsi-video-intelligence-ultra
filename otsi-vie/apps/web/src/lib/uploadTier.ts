/**
 * Tier-aware upload limits (owner, 2026-11-11). MP4 / MOV only. Free 2 GB, Pro 24 GB, Enterprise 64 GB per video.
 *
 * The limit a person gets is the smaller of their tier's limit and what this server really enforces (GET /v1/upload-limits,
 * OTSI_VIE_MAX_UPLOAD_BYTES), so the app never promises more than the server accepts. The tier comes from the licence
 * (GET /v1/licence `plan`): "FREE" is the Free tier. OPEN OWNER DECISION: the paid plan codes (STARTER, CLUB, ACADEMY, SEASON) are not
 * yet mapped to Pro or Enterprise; until the owner maps them, a paid plan is limited only by the server's own maximum.
 */
import type { LicenceSnapshot, UploadLimits } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "./api";

export type UploadTier = "Free" | "Pro" | "Enterprise";
const GB = 1024 ** 3;
export const TIER_LIMIT_BYTES: Record<UploadTier, number> = { Free: 2 * GB, Pro: 24 * GB, Enterprise: 64 * GB };
/** plan code -> tier; only FREE is decided (see the header) */
export const PLAN_TIER: Record<string, UploadTier> = { FREE: "Free" };
export const ACCEPTED = /\.(mp4|mov)$/i;

export const formatGB = (bytes: number) => `${Math.round((bytes / GB) * 10) / 10} GB`;
export const formatBytes = (b: number) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(0)} MB` : `${Math.ceil(b / 1024)} KB`);

export interface TierLimit { tier: UploadTier | null; plan: string | null; maxBytes: number | null }

let pending: Promise<TierLimit> | null = null;
export function readTierLimit(): Promise<TierLimit> {
  pending ??= Promise.all([
    api<UploadLimits>("/v1/upload-limits").catch(() => null),
    api<LicenceSnapshot>("/v1/licence").catch(() => null),
  ]).then(([limits, lic]) => {
    const plan = lic?.plan ?? null;
    const tier = plan ? PLAN_TIER[plan] ?? null : null;
    const server = limits?.max_upload_bytes ?? null;
    const tierMax = tier ? TIER_LIMIT_BYTES[tier] : null;
    const maxBytes = server !== null && tierMax !== null ? Math.min(server, tierMax) : server ?? tierMax;
    return { tier, plan, maxBytes };
  });
  return pending;
}

/** undefined while reading */
export function useTierLimit(): TierLimit | undefined {
  const [v, setV] = useState<TierLimit | undefined>(undefined);
  useEffect(() => { let live = true; void readTierLimit().then((x) => { if (live) setV(x); }); return () => { live = false; }; }, []);
  return v;
}

export type FileCheck = { ok: true } | { ok: false; reason: "type" | "size"; tier: UploadTier | null; limit: number | null };

/** checked when a file is picked or dropped, before any upload starts */
export function checkUploadFile(f: { name: string; size: number; type?: string }, lim: TierLimit | undefined): FileCheck {
  if (!ACCEPTED.test(f.name) && !/video\/(mp4|quicktime)/.test(f.type ?? "")) return { ok: false, reason: "type", tier: lim?.tier ?? null, limit: lim?.maxBytes ?? null };
  if (lim?.maxBytes && f.size > lim.maxBytes) return { ok: false, reason: "size", tier: lim.tier, limit: lim.maxBytes };
  return { ok: true };
}
