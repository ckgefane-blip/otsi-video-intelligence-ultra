"use client";
/**
 * Page 05 Section 09 — player comparison (approved reference 05_TACTICAL_INTELLIGENCE, "player comparison"), in flow (Desktop UI Drop 2).
 *
 * Players A and B are chosen from the linked match's roster (listed first) or the player registry (GET /v1/players?q=; the OTSI Player
 * ID is shown on hover). Position and shirt number are the match roster's own entry for that player ("—" when the player is not on it).
 * Their head-to-head numbers need event detection, so every value is "—". Nothing is estimated.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Match, PlayerIdentity } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

/** a chosen player: their registry identity (a roster entry carries the same three fields) */
type Picked = Pick<PlayerIdentity, "player_id" | "display_name" | "canonical_otsi_id">;

function PlayerSearch({ open, onOpenChange, onChoose, title, match }: { open: boolean; onOpenChange: (o: boolean) => void; onChoose: (p: Picked) => void; title: string; match: Match | null }) {
  const { t: dict } = useLocale();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<PlayerIdentity[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setFound(null); return; }
    const t = setTimeout(() => void api<PlayerIdentity[]>(`/v1/players?q=${encodeURIComponent(q.trim())}`).then(setFound, () => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(480px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
          <Dialog.Title className="t-panel">{title}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{dict.body.tactics.searchRegistryHint}</Dialog.Description>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={dict.body.tactics.atLeast2Chars} aria-label={dict.body.tactics.playerNameOrId}
            className="mb-2 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
          {match && match.roster.length > 0 && !found && (
            <ul className="mb-2 max-h-72 space-y-1 overflow-y-auto" aria-label={dict.body.tactics.playersInMatch}>
              {match.roster.map((r) => (
                <li key={r.player_id}>
                  <button type="button" onClick={() => { onChoose(r); onOpenChange(false); }}
                    className="flex w-full justify-between gap-2 rounded-ctl border border-line/70 px-3 py-2 text-left hover:border-primary/60">
                    <span className="font-medium">{r.jersey_number !== null ? `${r.jersey_number} · ` : ""}{r.display_name}</span>
                    <span className="text-xs text-muted">{r.position ? `${r.position}${r.verified ? " (confirmed)" : ""}` : "—"} · {r.club_id === match.home?.id ? match.home.name : match.away?.name ?? "—"}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {found?.length === 0 && <p className="text-muted">{dict.body.reports.noPlayerFound}</p>}
          <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label={dict.body.analysis.players}>
            {found?.map((p) => (
              <li key={p.player_id}>
                <button type="button" onClick={() => { onChoose(p); onOpenChange(false); }}
                  className="flex w-full justify-between gap-2 rounded-ctl border border-line/70 px-3 py-2 text-left hover:border-primary/60">
                  <span className="font-medium">{p.display_name}</span><span className="text-xs text-muted">{p.canonical_otsi_id ?? dict.body.analysis.provisionalBadge}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function PlayerComparison({ focus, match }: { focus: boolean; match: Match | null }) {
  const { t: dict } = useLocale();
  const [a, setA] = useState<Picked | null>(null);
  const METRICS: string[] = [dict.body.processing.eventPasses, dict.body.workspace.metricPassAccuracy, dict.body.workspace.metricProgressivePasses, dict.body.workspace.metricKeyPasses, dict.body.tactics.offBallRuns, dict.body.workspace.metricChancesCreated];
  const [b, setB] = useState<Picked | null>(null);
  const entry = (p: Picked | null) => (p && match ? match.roster.find((r) => r.player_id === p.player_id) ?? null : null);
  const [picking, setPicking] = useState<"A" | "B" | null>(null);
  const side = (k: "A" | "B", p: Picked | null, bg: string, numBg: string, numColor: string) => {
    const e = entry(p);
    return (
      <div role="group" aria-label={`Player ${k}: ${p?.display_name ?? "no player selected"}`} className="flex items-center gap-3 rounded-md p-3" style={{ background: bg }}>
        <button type="button" aria-label={`Choose player ${k}`} onClick={() => setPicking(k)}
          className="flex h-10 w-12 shrink-0 items-center justify-center rounded text-white t-section" style={{ background: numBg, color: numColor }}>
          {e?.jersey_number ?? "—"}
        </button>
        <div className="min-w-0">
          <div className="t-label text-white/70">{`Player ${k}`}</div>
          <button type="button" onClick={() => setPicking(k)} className="block w-full truncate bg-transparent p-0 text-left text-white t-panel" title={p?.canonical_otsi_id ?? undefined}>
            {p?.display_name ?? dict.body.workspace.noPlayerSelected}
          </button>
          <div className="truncate text-sm text-[#cfdcf0]">{`Position ${e?.position ? `${e.position}${e.verified ? " ✓" : ""}` : "—"}`}</div>
        </div>
      </div>
    );
  };
  return (
    <section id="p05-s09" aria-label={dict.body.tactics.playerComparison} data-section="p05-s09" data-a={a?.player_id ?? ""} data-b={b?.player_id ?? ""}
      className={`vie-panel ${focus ? "outline outline-2 outline-offset-2 outline-primary" : ""}`}>
      <div className="vie-ph">
        <h2 className="t-panel"><span aria-hidden className="mr-2 inline-block h-5 w-1.5 rounded bg-primary align-middle" />{dict.body.workspace.playerComparisonMode}</h2>
        <div className="flex gap-2">
          <select aria-label={dict.body.tactics.comparedPosition} defaultValue="AM" className="h-8 rounded-md border border-line bg-raised px-2 text-sm text-ink">
            {([["AM", dict.body.tactics.posAttackingMid], ["CM", dict.body.tactics.posCentralMid], ["DM", dict.body.tactics.posDefensiveMid], ["ST", dict.body.tactics.posStriker], ["W", "Winger"], ["FB", "Full-back"],
              ["CB", "Centre-back"], ["GK", dict.body.workspace.goalkeeper]] as [string, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select aria-label={dict.body.tactics.comparisonPeriod} defaultValue="30" className="h-8 rounded-md border border-line bg-raised px-2 text-sm text-ink">
            <option value="30" disabled>Last 30 Minutes — match periods not recorded</option>
            <option value="full">Full match</option>
            <option value="h1" disabled>{`${dict.body.workspace.firstHalfLower} — match periods not recorded`}</option>
            <option value="h2" disabled>{`${dict.body.workspace.secondHalfLower} — match periods not recorded`}</option>
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {side("A", a, "#2a4a78", "#1580ff", "#fff")}
          {side("B", b, "#3a2a28", "#fff", "#07152b")}
        </div>
        <dl className="m-0 flex flex-col gap-1.5">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 t-th">
            <span>{`Player A`}</span><span className="text-center">{dict.body.tactics.metricLabel}</span><span className="text-right">{`Player B`}</span>
          </div>
          {METRICS.map((l) => (
            <div key={l} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
              <span className="font-semibold">—</span>
              <span className="text-center text-[#cfdcf0]">{l}</span>
              <span className="text-right font-semibold">—</span>
            </div>
          ))}
        </dl>
      </div>
      <PlayerSearch match={match} open={picking !== null} onOpenChange={(o) => { if (!o) setPicking(null); }} title={`Choose player ${picking ?? ""}`}
        onChoose={(p) => (picking === "A" ? setA(p) : setB(p))} />
    </section>
  );
}
