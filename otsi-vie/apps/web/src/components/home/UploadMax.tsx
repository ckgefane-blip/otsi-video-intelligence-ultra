"use client";
/** The per-video upload limit for this account: the smaller of its tier's limit (Free 2 GB, Pro 24 GB, Enterprise 64 GB) and what this
 *  server really enforces (GET /v1/upload-limits). "—" until read. */
import { formatGB, useTierLimit } from "@/lib/uploadTier";

export function UploadMax() {
  const lim = useTierLimit();
  return <>{lim?.maxBytes ? formatGB(lim.maxBytes) : "—"}</>;
}
