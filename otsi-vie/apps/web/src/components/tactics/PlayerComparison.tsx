"use client";
/**
 * Page 05 Section 09 — player comparison (approved reference 05_TACTICAL_INTELLIGENCE, "player comparison").
 *
 * Players A and B are chosen from the linked match's roster (listed first) or the player registry (GET /v1/players?q=; the OTSI Player
 * ID is shown on hover). Position and shirt number are the match roster's own entry for that player ("—" when the player is not on it).
 * Their head-to-head numbers need event detection, so every value is "—". Nothing is estimated.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Match, PlayerIdentity } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { B, T, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { Box, Head, Sel } from "./kit";

/** a chosen player: their registry identity (a roster entry carries the same three fields) */
type Picked = Pick<PlayerIdentity, "player_id" | "display_name" | "canonical_otsi_id">;

function PlayerSearch({ open, onOpenChange, onChoose, title, match }: { open: boolean; onOpenChange: (o: boolean) => void; onChoose: (p: Picked) => void; title: string; match: Match | null }) {
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
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">Search the player registry by name or OTSI Player ID.</Dialog.Description>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="At least 2 characters" aria-label="Player name or OTSI Player ID"
            className="mb-2 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
          {match && match.roster.length > 0 && !found && (
            <ul className="mb-2 max-h-72 space-y-1 overflow-y-auto" aria-label="Players in this match">
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
          {found?.length === 0 && <p className="text-muted">No player found.</p>}
          <ul className="max-h-72 space-y-1 overflow-y-auto" aria-label="Players">
            {found?.map((p) => (
              <li key={p.player_id}>
                <button type="button" onClick={() => { onChoose(p); onOpenChange(false); }}
                  className="flex w-full justify-between gap-2 rounded-ctl border border-line/70 px-3 py-2 text-left hover:border-primary/60">
                  <span className="font-medium">{p.display_name}</span><span className="text-xs text-muted">{p.canonical_otsi_id ?? "provisional"}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const METRICS: [string, number][] = [["Passes", 1238], ["Pass Accuracy", 1270], ["Progressive Passes", 1302], ["Key Passes", 1334], ["Off-Ball Runs", 1366], ["Chances Created", 1397]];

export function PlayerComparison({ focus, match }: { focus: boolean; match: Match | null }) {
  const [a, setA] = useState<Picked | null>(null);
  const [b, setB] = useState<Picked | null>(null);
  const entry = (p: Picked | null) => (p && match ? match.roster.find((r) => r.player_id === p.player_id) ?? null : null);
  const [picking, setPicking] = useState<"A" | "B" | null>(null);
  const side = (k: "A" | "B", p: Picked | null, card: [number, number, string], tx: number, nx: number, num: [number, number, string, string]) => (
    <div role="group" aria-label={`Player ${k}: ${p?.display_name ?? "no player selected"}`}>
      <button type="button" aria-label={`Choose player ${k}`} onClick={() => setPicking(k)} className="absolute"
        style={{ left: u(card[0]), top: u(1230 - 101), width: u(card[1]), height: u(160), borderRadius: u(6), background: card[2], border: 0, padding: 0, cursor: "pointer" }} />
      <T x={tx} y={1244} size={20} weight={700}>{`Player ${k}`}</T>
      <T x={nx} y={1277} size={17} color="#cfdcf0" style={{ maxWidth: u(170), overflow: "hidden", textOverflow: "ellipsis" }}>
        <span title={p?.canonical_otsi_id ?? undefined}>{p?.display_name ?? "No player selected"}</span>
      </T>
      <T x={tx} y={1311} size={19} color="#cfdcf0">{`Position ${entry(p)?.position ? `${entry(p)!.position}${entry(p)!.verified ? " ✓" : ""}` : "—"}`}</T>
      <B x={num[0]} y={1350} w={num[1]} h={36} style={{ background: num[2], color: num[3], borderRadius: u(4), fontSize: u(22), fontWeight: 700, textAlign: "center", lineHeight: u(36) }}>
        {entry(p)?.jersey_number ?? "—"}
      </B>
    </div>
  );
  return (
    <section id="p05-s09" aria-label="Player comparison" data-section="p05-s09" data-a={a?.player_id ?? ""} data-b={b?.player_id ?? ""}>
      <Box x={1462} y={1162} w={1070} h={258} />
      {focus && <B x={1462} y={1162} w={1070} h={258} style={{ outline: `${u(3)} solid #33a8ff`, outlineOffset: u(2), borderRadius: u(10), pointerEvents: "none" }} />}
      <Head x={1462} y={1193} title="Player Comparison" />
      <Sel x={2074} y={1176} w={216} h={38} label="Compared position" value="AM"
        options={([["AM", "Attacking Midfielder"], ["CM", "Central Midfielder"], ["DM", "Defensive Midfielder"], ["ST", "Striker"], ["W", "Winger"], ["FB", "Full-back"],
          ["CB", "Centre-back"], ["GK", "Goalkeeper"]] as [string, string][]).map(([v, l]): [string, string] => [v, l])} />
      <Sel x={2317} y={1176} w={197} h={38} label="Comparison period" value="30"
        options={[["30", "Last 30 Minutes", "match periods not recorded"], ["full", "Full match"], ["h1", "1st half", "match periods not recorded"], ["h2", "2nd half", "match periods not recorded"]]} />
      {side("A", a, [1489, 133, "linear-gradient(135deg,#5a6f8c,#2a4a78)"], 1638, 1660, [1638, 46, "#1580ff", "#fff"])}
      {side("B", b, [2215, 127, "linear-gradient(135deg,#6a5f5a,#3a2a28)"], 2357, 2378, [2358, 44, "#fff", "#07152b"])}
      <dl style={{ margin: 0 }}>
        {METRICS.map(([l, y]) => (
          <div key={l}>
            <T x={1846} y={y} size={18} weight={700} as="span">—</T>
            <T x={1996} y={y} size={17} color="#cfdcf0" align="center" as="span">{l}</T>
            <T x={2178} y={y} size={18} weight={700} as="span">—</T>
            <B x={2105} y={y - 5} w={42} h={10} style={{ background: "#17304f", borderRadius: u(3) }} />
          </div>
        ))}
      </dl>
      <PlayerSearch match={match} open={picking !== null} onOpenChange={(o) => { if (!o) setPicking(null); }} title={`Choose player ${picking ?? ""}`}
        onChoose={(p) => (picking === "A" ? setA(p) : setB(p))} />
    </section>
  );
}
