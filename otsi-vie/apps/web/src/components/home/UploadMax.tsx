"use client";
/** The upload size limit this server really enforces (GET /v1/upload-limits, OTSI_VIE_MAX_UPLOAD_BYTES), never a typed number; "—" until read. */
import type { UploadLimits } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

let once: Promise<UploadLimits | null> | null = null;
export function UploadMax() {
  const [b, setB] = useState<number | null>(null);
  useEffect(() => {
    once ??= api<UploadLimits>("/v1/upload-limits").catch(() => null);
    void once.then((x) => setB(x?.max_upload_bytes ?? null));
  }, []);
  return <>{b ? `${Math.round(b / 1024 ** 3)} GB` : "—"}</>;
}
