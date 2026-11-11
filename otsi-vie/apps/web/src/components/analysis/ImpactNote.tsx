"use client";
/**
 * v3 Phase B.7 (ADR-084): what an identity decision would make out of date, shown next to the buttons that save it, before anyone presses
 * them: reels that would need their targets refreshed (and whether they were rendered or shared) and made PDF reports that would no longer
 * match. Nothing shows when nothing would go out of date.
 */
import { impactText, type IdentityImpact } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

export function useIdentityImpact(trackIds: string[], state: string, playerId: string | null): IdentityImpact | null {
  const [impact, setImpact] = useState<IdentityImpact | null>(null);
  const key = `${[...trackIds].sort().join(",")}|${state}|${playerId ?? ""}`;
  useEffect(() => {
    setImpact(null);
    if (!trackIds.length) return;
    let live = true;
    const q = new URLSearchParams({ track_ids: trackIds.join(","), state, ...(playerId ? { player_id: playerId } : {}) });
    const h = setTimeout(() => void api<IdentityImpact>(`/v1/identity-impact?${q}`).then((i) => { if (live) setImpact(i); }, () => undefined), 150);
    return () => { live = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return impact;
}

export function ImpactNote({ trackIds, state, playerId, className = "" }: { trackIds: string[]; state: string; playerId: string | null; className?: string }) {
  const { t: dict } = useLocale();
  const i = useIdentityImpact(trackIds, state, playerId);
  const text = i ? impactText(i) : null;
  if (!text) return null;
  return (
    <p role="note" data-identity-impact className={`rounded-ctl border border-[#f5b82e]/60 bg-[#f5b82e]/10 px-2.5 py-1.5 text-xs text-[#ffe6a8] ${className}`}>
      <b>{dict.body.analysis.beforeYouSave}</b> {text}
    </p>
  );
}
