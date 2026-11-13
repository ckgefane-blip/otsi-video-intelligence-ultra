/**
 * Plan-aware upload limits (owner, APPROVED 2026-11-13: Free 2 GB, Starter 8, Club 24, Academy 48, Season 64 GB per video,
 * Enterprise no plan limit). MP4 / MOV only.
 *
 * The server decides: GET /v1/upload-limits returns the caller's plan and the limit that applies — the smaller of the plan's
 * limit and what this server really enforces (OTSI_VIE_MAX_UPLOAD_BYTES) — and the server refuses a bigger upload itself, so
 * the app never promises more than the server accepts. The plan list (names and limits) is the plan catalogue in contracts.
 */
import type { UploadLimits } from "@otsi-vie/contracts";
import { PLAN_CATALOGUE, planEntryOrNull } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "./api";

const GB = 1024 ** 3;
/** Every plan and its limit per video, in catalogue order; null = no plan limit. */
export const PLAN_LIMITS = PLAN_CATALOGUE.map((p) => ({ code: p.code, label: p.label, bytes: p.upload_gb_per_video === null ? null : p.upload_gb_per_video * GB }));
export const ACCEPTED = /\.(mp4|mov)$/i;

export const formatGB = (bytes: number) => `${Math.round((bytes / GB) * 10) / 10} GB`;
export const formatBytes = (b: number) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(0)} MB` : `${Math.ceil(b / 1024)} KB`);

/** `plan` is the plan code (FREE when none), `tier` its catalogue name, `maxBytes` what this caller may upload per video. */
export interface TierLimit { tier: string | null; plan: string | null; maxBytes: number | null }

let pending: Promise<TierLimit> | null = null;
export function readTierLimit(): Promise<TierLimit> {
  pending ??= api<UploadLimits>("/v1/upload-limits").then(
    (l) => ({ tier: planEntryOrNull(l.plan_code)?.label ?? l.plan_code, plan: l.plan_code, maxBytes: l.max_upload_bytes }),
    () => ({ tier: null, plan: null, maxBytes: null }),
  );
  return pending;
}
/** for tests and after a plan changes */
export function resetTierLimit(): void { pending = null; }

/** undefined while reading */
export function useTierLimit(): TierLimit | undefined {
  const [v, setV] = useState<TierLimit | undefined>(undefined);
  useEffect(() => { let live = true; void readTierLimit().then((x) => { if (live) setV(x); }); return () => { live = false; }; }, []);
  return v;
}

export type FileCheck = { ok: true } | { ok: false; reason: "type" | "size"; tier: string | null; limit: number | null };

/** checked when a file is picked or dropped, before any upload starts */
export function checkUploadFile(f: { name: string; size: number; type?: string }, lim: TierLimit | undefined): FileCheck {
  if (!ACCEPTED.test(f.name) && !/video\/(mp4|quicktime)/.test(f.type ?? "")) return { ok: false, reason: "type", tier: lim?.tier ?? null, limit: lim?.maxBytes ?? null };
  if (lim?.maxBytes && f.size > lim.maxBytes) return { ok: false, reason: "size", tier: lim.tier, limit: lim.maxBytes };
  return { ok: true };
}
