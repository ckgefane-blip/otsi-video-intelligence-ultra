"use client";
/**
 * The broadcast lineup cards on Page 04 (ADR-039). The engine reads them by itself after an analysis ("Read the lineups" re-reads); a person
 * approves them here: the card's picture beside the rows as read, every row editable (number, name, starter / substitute, used or not), the
 * team name and which side is home. Approval creates the clubs and the match (or fills the linked match), finds each player in the registry
 * by exact name or creates him, and fills the roster. Shirt numbers read on players then suggest these names.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { AppliedLineups, LineupCard, Lineups } from "@otsi-vie/contracts";
import { useLocale } from "@/lib/i18n";
import { useCallback, useEffect, useState } from "react";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { u } from "@/components/stage/DesignStage";
import { useDw } from "./ResizableColumns";

export function useLineups(videoId: string | undefined) {
  const [data, setData] = useState<Lineups | null>(null);
  const reload = useCallback(async () => {
    if (!videoId) { setData(null); return; }
    try { setData(await api<Lineups>(`/v1/videos/${videoId}/lineups`)); } catch { /* keep what is shown */ }
  }, [videoId]);
  useEffect(() => { setData(null); void reload(); }, [reload]);
  const busy = data?.read?.status === "QUEUED" || data?.read?.status === "RUNNING";
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void reload(), 3000);
    return () => clearInterval(t);
  }, [busy, reload]);
  return { data, reload, setData };
}

export function LineupsBlock({ videoId, canWrite, onReview, onName, lineups }: { videoId: string; canWrite: boolean; onReview: () => void; onName: () => void; lineups: ReturnType<typeof useLineups> }) {
  const { t: dict } = useLocale();
  const dw = useDw();
  const [err, setErr] = useState<string | null>(null);
  const d = lineups.data, r = d?.read ?? null;
  const cards = (d?.cards ?? []).filter((c) => c.state !== "DISMISSED");
  const open = cards.filter((c) => c.state === "PROPOSED");
  const start = async () => {
    setErr(null);
    try { lineups.setData(await api<Lineups>(`/v1/videos/${videoId}/lineups`, { method: "POST" })); }
    catch (x) { setErr(x instanceof ApiProblem ? x.message : "The engine could not start."); }
  };
  const line = { color: "#8ea3bf" } as const;
  const btn = { minHeight: u(52), padding: `${u(8)} ${u(12)}`, lineHeight: 1.25, border: `${u(1.5)} solid #1f5a9c`, borderRadius: u(8), background: "#0a2a55", color: "#33a8ff", fontFamily: "inherit", fontSize: u(19), fontWeight: 700, cursor: "pointer" } as const;
  return (
    <div data-lineups-block style={{ display: "flex", flexDirection: "column", gap: u(10), width: u(330 + dw), marginTop: u(18), fontSize: u(17) }}>
      <div style={{ color: "#cfe0f5", fontWeight: 700, fontSize: u(20) }}>{dict.body.analysis.lineups}</div>
      {!r && <span style={line}>The team sheets the broadcast shows (numbers and names) can name the players. The engine reads them after each analysis.</span>}
      {r && (r.status === "QUEUED" || r.status === "RUNNING") && <span role="status" style={line}>Reading the lineups… {r.stage_message ?? ""}{r.progress !== null ? ` (${Math.round(r.progress)}%)` : ""}</span>}
      {r?.status === "FAILED" && <span role="alert" style={{ color: "#ff8a8a" }}>{r.failure_detail ?? "The lineups could not be read."}</span>}
      {r?.status === "SUCCEEDED" && cards.length === 0 && <span style={line}>No lineup card found in this video. Name players with Identify on the player card.</span>}
      {cards.length > 0 && (
        <span data-lineups-found style={line}>
          {cards.map((c) => `${c.team_name ?? "A team"}: ${c.entries.length} players${c.state === "APPLIED" ? " (approved)" : ""}`).join(" · ")}
        </span>
      )}
      {canWrite && cards.length > 0 && <button type="button" data-lineups-review onClick={onReview} style={open.length ? btn : { ...btn, minHeight: u(40), fontSize: u(16), fontWeight: 600 }}>{open.length ? "Review and approve the lineups…" : "See the lineups…"}</button>}
      {canWrite && d?.match_id && <button type="button" data-name-players onClick={onName} style={btn}>Name players from the roster…</button>}
      {canWrite && r?.status !== "QUEUED" && r?.status !== "RUNNING" && (
        <button type="button" data-lineups-start onClick={() => void start()}
          style={cards.length ? { ...btn, minHeight: u(40), fontSize: u(16), fontWeight: 600, background: "transparent", color: "#8ea3bf", border: `${u(1)} solid #1f3f6a` } : btn}>
          {r ? "Read the lineups again" : "Read the lineups"}</button>
      )}
      {err && <span role="alert" style={{ color: "#ff8a8a" }}>{err}</span>}
    </div>
  );
}

type Row = { number: string; name: string; role: "STARTER" | "SUBSTITUTE"; use: boolean };
type Draft = { card: LineupCard; side: "HOME" | "AWAY" | "NONE"; team: string; rows: Row[] };

function CardImage({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true, made: string | null = null;
    void apiBlob(`/v1/lineup-cards/${id}/image`).then((b) => { made = URL.createObjectURL(b); if (live) setUrl(made); }, () => undefined);
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  return url ? <img src={url} alt="The lineup card as broadcast" className="w-full rounded border border-line" /> : <div className="aspect-video w-full rounded border border-line/50 bg-raised/40" />;
}

export function LineupsDialog({ open, onOpenChange, videoId, lineups, onApplied }: {
  open: boolean; onOpenChange: (o: boolean) => void; videoId: string; lineups: ReturnType<typeof useLineups>; onApplied: () => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [result, setResult] = useState<AppliedLineups | null>(null);
  const cards = (lineups.data?.cards ?? []).filter((c) => c.state !== "DISMISSED");
  const linked = !!lineups.data?.match_id;
  useEffect(() => {
    if (!open) return;
    setMsg(null); setResult(null);
    setDrafts(cards.map((c, i) => ({ card: c, side: i === 0 ? "HOME" : i === 1 ? "AWAY" : "NONE", team: (c.team_name ?? "").replace(/^\s*(ФК|FC|FK|CF|SC)\s*/i, "").replace(/["«»“”]/g, "").trim(),
      rows: c.entries.map((e) => ({ number: e.number, name: e.name, role: e.role, use: true })) })));
  }, [open, lineups.data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: number, f: (d: Draft) => Draft) => setDrafts((ds) => ds.map((d, i) => (i === k ? f(d) : d)));
  const chosen = drafts.filter((d) => d.side !== "NONE" && d.card.state === "PROPOSED");
  const ready = chosen.length > 0 && (linked || (chosen.length === 2 && chosen[0]!.side !== chosen[1]!.side)) && chosen.every((d) => d.team.trim().length >= 2);
  const apply = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api<AppliedLineups>(`/v1/videos/${videoId}/lineups/apply`, { method: "POST", json: { cards: chosen.map((d) => ({
        card_id: d.card.id, side: d.side, team_name: d.team.trim(),
        entries: d.rows.filter((x) => x.use && /^\d{1,2}$/.test(x.number) && x.name.trim().length >= 2).map((x) => ({ number: Number(x.number), name: x.name.trim(), role: x.role })) })) } });
      setResult(r);
      const failed = r.rows.filter((x) => x.outcome === "FAILED").length;
      setMsg({ ok: failed === 0, text: `Roster filled: ${r.rows.filter((x) => x.outcome === "CREATED").length} new players, ${r.rows.filter((x) => x.outcome === "FOUND").length} found in the registry${failed ? `, ${failed} not added (see below)` : ""}.` });
      await lineups.reload(); onApplied();
    } catch (x) { setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : "The lineups were not approved." }); } finally { setBusy(false); }
  };
  const dismiss = async (c: LineupCard) => {
    try { await api(`/v1/lineup-cards/${c.id}/dismiss`, { method: "POST" }); await lineups.reload(); }
    catch (x) { setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : "Not dismissed." }); }
  };
  const inp = "rounded-ctl border border-line bg-canvas px-1.5 py-0.5";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="lineups" className="fixed left-1/2 top-1/2 z-50 max-h-[94vh] w-[min(1500px,98vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">Lineups from the broadcast</Dialog.Title>
              <Dialog.Description className="text-xs text-muted">
                Check each row against the picture and correct what the engine misread. {linked ? "Approving fills the linked match's roster." : "Mark one card Home and one Away: approving creates the two clubs and the match."}
                {" "}Players are found in the registry by exact name, or created as provisional players (no OTSI Player ID until registered).
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-ctl border border-line px-3 py-1">Close</Dialog.Close>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(1, drafts.length)}, minmax(0, 1fr))` }}>
            {drafts.map((d, k) => (
              <section key={d.card.id} data-lineup-card={d.card.id} className="space-y-2 rounded-ctl border border-line/70 p-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted">Shown at {formatDuration(d.card.pts_us)}</span>
                  {d.card.state === "APPLIED" ? <span className="text-ok">approved</span> : (
                    <>
                      <select aria-label="Side" value={d.side} onChange={(e) => set(k, (x) => ({ ...x, side: e.target.value as Draft["side"] }))} className={inp}>
                        <option value="HOME">Home team</option><option value="AWAY">Away team</option><option value="NONE">Not used</option>
                      </select>
                      <button type="button" onClick={() => void dismiss(d.card)} className="rounded border border-line px-1.5 py-0.5 text-muted">Not a lineup</button>
                    </>
                  )}
                </div>
                <CardImage id={d.card.id} />
                <label className="flex items-center gap-2 text-xs">Team name
                  <input value={d.team} disabled={d.card.state === "APPLIED"} onChange={(e) => set(k, (x) => ({ ...x, team: e.target.value }))} className={`${inp} flex-1 text-sm`} />
                </label>
                {d.card.coach_name && <p className="text-xs text-muted">Coach: {d.card.coach_name}</p>}
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-muted"><th className="w-8">Use</th><th className="w-12">No.</th><th>Name</th><th className="w-28">Role</th></tr></thead>
                  <tbody>
                    {d.rows.map((x, i) => (
                      <tr key={i} className={x.use ? "" : "opacity-50"}>
                        <td><input type="checkbox" aria-label={`Use ${x.name}`} checked={x.use} disabled={d.card.state === "APPLIED"} onChange={(e) => set(k, (y) => ({ ...y, rows: y.rows.map((r, j) => (j === i ? { ...r, use: e.target.checked } : r)) }))} /></td>
                        <td><input aria-label="Shirt number" value={x.number} disabled={d.card.state === "APPLIED"} onChange={(e) => set(k, (y) => ({ ...y, rows: y.rows.map((r, j) => (j === i ? { ...r, number: e.target.value.replace(/\D/g, "").slice(0, 2) } : r)) }))} className={`${inp} w-10`} /></td>
                        <td><input aria-label="Name" value={x.name} disabled={d.card.state === "APPLIED"} onChange={(e) => set(k, (y) => ({ ...y, rows: y.rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)) }))} className={`${inp} w-full`} /></td>
                        <td>
                          <select aria-label="Role" value={x.role} disabled={d.card.state === "APPLIED"} onChange={(e) => set(k, (y) => ({ ...y, rows: y.rows.map((r, j) => (j === i ? { ...r, role: e.target.value as Row["role"] } : r)) }))} className={inp}>
                            <option value="STARTER">Starter</option><option value="SUBSTITUTE">Substitute</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" data-lineups-apply disabled={busy || !ready} onClick={() => void apply()} className="rounded-ctl bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
              {busy ? "Approving…" : "Approve as the match roster"}</button>
            {!ready && chosen.length > 0 && <span className="text-xs text-muted">{linked ? "Give the team a name." : "Choose one Home and one Away card."}</span>}
            {msg && <span role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</span>}
          </div>
          {result && result.rows.some((x) => x.outcome === "FAILED") && (
            <ul className="mt-2 space-y-0.5 text-xs text-danger">
              {result.rows.filter((x) => x.outcome === "FAILED").map((x) => <li key={`${x.card_id}-${x.number}-${x.name}`}>No. {x.number} {x.name}: {x.message}</li>)}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
