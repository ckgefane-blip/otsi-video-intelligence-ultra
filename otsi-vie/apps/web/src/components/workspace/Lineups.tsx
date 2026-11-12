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
    catch (x) { setErr(x instanceof ApiProblem ? x.message : dict.body.workspace.engineCouldNotStart); }
  };
  const line = { color: "#8ea3bf" } as const;
  const btn = { minHeight: u(52), padding: `${u(8)} ${u(12)}`, lineHeight: 1.25, border: `${u(1.5)} solid #1f5a9c`, borderRadius: u(8), background: "#0a2a55", color: "#33a8ff", fontFamily: "inherit", fontSize: u(19), fontWeight: 700, cursor: "pointer" } as const;
  return (
    <div data-lineups-block style={{ display: "flex", flexDirection: "column", gap: u(10), width: u(330 + dw), marginTop: u(18), fontSize: u(17) }}>
      <div style={{ color: "#cfe0f5", fontWeight: 700, fontSize: u(20) }}>{dict.body.analysis.lineups}</div>
      {!r && <span style={line}>{dict.body.workspace.teamSheetsHint}</span>}
      {r && (r.status === "QUEUED" || r.status === "RUNNING") && <span role="status" style={line}>{dict.body.workspace.readingLineups} {r.stage_message ?? ""}{r.progress !== null ? ` (${Math.round(r.progress)}%)` : ""}</span>}
      {r?.status === "FAILED" && <span role="alert" style={{ color: "#ff8a8a" }}>{r.failure_detail ?? dict.body.workspace.lineupsCouldNotBeRead}</span>}
      {r?.status === "SUCCEEDED" && cards.length === 0 && <span style={line}>{dict.body.workspace.noLineupCard}</span>}
      {cards.length > 0 && (
        <span data-lineups-found style={line}>
          {cards.map((c) => (c.entries.length === 1
            ? dict.body.workspace.lineupCardOne.replace("{a}", c.team_name ?? dict.body.workspace.aTeam).replace("{c}", c.state === "APPLIED" ? dict.body.workspace.approvedSuffix : "")
            : dict.body.workspace.lineupCardMany.replace("{a}", c.team_name ?? dict.body.workspace.aTeam).replace("{b}", String(c.entries.length)).replace("{c}", c.state === "APPLIED" ? dict.body.workspace.approvedSuffix : ""))).join(" · ")}
        </span>
      )}
      {canWrite && cards.length > 0 && <button type="button" data-lineups-review onClick={onReview} style={open.length ? btn : { ...btn, minHeight: u(40), fontSize: u(16), fontWeight: 600 }}>{open.length ? dict.body.workspace.reviewApproveLineups : dict.body.workspace.seeLineups}</button>}
      {canWrite && d?.match_id && <button type="button" data-name-players onClick={onName} style={btn}>{dict.body.workspace.namePlayersRoster}</button>}
      {canWrite && r?.status !== "QUEUED" && r?.status !== "RUNNING" && (
        <button type="button" data-lineups-start onClick={() => void start()}
          style={cards.length ? { ...btn, minHeight: u(40), fontSize: u(16), fontWeight: 600, background: "transparent", color: "#8ea3bf", border: `${u(1)} solid #1f3f6a` } : btn}>
          {r ? dict.body.workspace.readLineupsAgain : dict.body.workspace.readLineups}</button>
      )}
      {err && <span role="alert" style={{ color: "#ff8a8a" }}>{err}</span>}
    </div>
  );
}

type Row = { number: string; name: string; role: "STARTER" | "SUBSTITUTE"; use: boolean };
type Draft = { card: LineupCard; side: "HOME" | "AWAY" | "NONE"; team: string; rows: Row[] };

function CardImage({ id }: { id: string }) {
  const { t: dict } = useLocale();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true, made: string | null = null;
    void apiBlob(`/v1/lineup-cards/${id}/image`).then((b) => { made = URL.createObjectURL(b); if (live) setUrl(made); }, () => undefined);
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id]);
  return url ? <img src={url} alt={dict.body.workspace.lineupCardBroadcast} className="w-full rounded border border-line" /> : <div className="aspect-video w-full rounded border border-line/50 bg-raised/40" />;
}

export function LineupsDialog({ open, onOpenChange, videoId, lineups, onApplied }: {
  open: boolean; onOpenChange: (o: boolean) => void; videoId: string; lineups: ReturnType<typeof useLineups>; onApplied: () => void;
}) {
  const { t: dict } = useLocale();
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
      setMsg({ ok: failed === 0, text: dict.body.workspace.rosterFilled.replace("{a}", String(r.rows.filter((x) => x.outcome === "CREATED").length)).replace("{b}", String(r.rows.filter((x) => x.outcome === "FOUND").length)).replace("{c}", failed ? dict.body.workspace.rosterNotAdded.replace("{a}", String(failed)) : "") });
      await lineups.reload(); onApplied();
    } catch (x) { setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.workspace.lineupsNotApproved }); } finally { setBusy(false); }
  };
  const dismiss = async (c: LineupCard) => {
    try { await api(`/v1/lineup-cards/${c.id}/dismiss`, { method: "POST" }); await lineups.reload(); }
    catch (x) { setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.workspace.notDismissed }); }
  };
  const inp = "rounded-ctl border border-line bg-canvas px-1.5 py-0.5";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="lineups" className="fixed left-1/2 top-1/2 z-50 max-h-[94vh] w-[min(1500px,98vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-normal">{dict.body.workspace.lineupsBroadcast}</Dialog.Title>
              <Dialog.Description className="text-xs text-muted">
                Check each row against the picture and correct what the engine misread. {linked ? dict.body.workspace.approvingFills : dict.body.workspace.markHomeAway}
                {" "}{dict.body.workspace.playersFoundRegistry}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-ctl border border-line px-3 py-1">{dict.common.close}</Dialog.Close>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(1, drafts.length)}, minmax(0, 1fr))` }}>
            {drafts.map((d, k) => (
              <section key={d.card.id} data-lineup-card={d.card.id} className="space-y-2 rounded-ctl border border-line/70 p-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted">{dict.body.workspace.shownAt.replace("{a}", formatDuration(d.card.pts_us))}</span>
                  {d.card.state === "APPLIED" ? <span className="text-ok">{dict.body.workspace.approvedLower}</span> : (
                    <>
                      <select aria-label={dict.body.workspace.sideLabel} value={d.side} onChange={(e) => set(k, (x) => ({ ...x, side: e.target.value as Draft["side"] }))} className={inp}>
                        <option value="HOME">{dict.body.workspace.homeTeam}</option><option value="AWAY">{dict.body.workspace.awayTeam}</option><option value="NONE">{dict.body.workspace.notUsed}</option>
                      </select>
                      <button type="button" onClick={() => void dismiss(d.card)} className="rounded border border-line px-1.5 py-0.5 text-muted">{dict.body.workspace.notLineup}</button>
                    </>
                  )}
                </div>
                <CardImage id={d.card.id} />
                <label className="flex items-center gap-2 text-xs">{dict.body.workspace.teamName}
                  <input value={d.team} disabled={d.card.state === "APPLIED"} onChange={(e) => set(k, (x) => ({ ...x, team: e.target.value }))} className={`${inp} flex-1 text-sm`} />
                </label>
                {d.card.coach_name && <p className="text-xs text-muted">{dict.body.workspace.coachLabel.replace("{a}", d.card.coach_name)}</p>}
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-muted"><th className="w-8">{dict.body.workspace.useLabel}</th><th className="w-12">{dict.body.analysis.noNumber}</th><th>{dict.body.library.name}</th><th className="w-28">{dict.body.workspace.roleLabel}</th></tr></thead>
                  <tbody>
                    {d.rows.map((x, i) => (
                      <tr key={i} className={x.use ? "" : "opacity-50"}>
                        <td><input type="checkbox" aria-label={dict.body.workspace.useName.replace("{a}", x.name)} checked={x.use} disabled={d.card.state === "APPLIED"} onChange={(e) => set(k, (y) => ({ ...y, rows: y.rows.map((r, j) => (j === i ? { ...r, use: e.target.checked } : r)) }))} /></td>
                        <td><input aria-label={dict.body.analysis.shirtNumber} value={x.number} disabled={d.card.state === "APPLIED"} onChange={(e) => set(k, (y) => ({ ...y, rows: y.rows.map((r, j) => (j === i ? { ...r, number: e.target.value.replace(/\D/g, "").slice(0, 2) } : r)) }))} className={`${inp} w-10`} /></td>
                        <td><input aria-label={dict.body.library.name} value={x.name} disabled={d.card.state === "APPLIED"} onChange={(e) => set(k, (y) => ({ ...y, rows: y.rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)) }))} className={`${inp} w-full`} /></td>
                        <td>
                          <select aria-label={dict.body.workspace.roleLabel} value={x.role} disabled={d.card.state === "APPLIED"} onChange={(e) => set(k, (y) => ({ ...y, rows: y.rows.map((r, j) => (j === i ? { ...r, role: e.target.value as Row["role"] } : r)) }))} className={inp}>
                            <option value="STARTER">{dict.body.workspace.starter}</option><option value="SUBSTITUTE">{dict.body.workspace.substitute}</option>
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
            <button type="button" data-lineups-apply disabled={busy || !ready} onClick={() => void apply()} className="rounded-ctl bg-primary px-4 py-2 font-normal text-white disabled:opacity-50">
              {busy ? dict.body.workspace.approving : dict.body.workspace.approveRoster}</button>
            {!ready && chosen.length > 0 && <span className="text-xs text-muted">{linked ? dict.body.workspace.giveTeamName : dict.body.workspace.chooseHomeAway}</span>}
            {msg && <span role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</span>}
          </div>
          {result && result.rows.some((x) => x.outcome === "FAILED") && (
            <ul className="mt-2 space-y-0.5 text-xs text-danger">
              {result.rows.filter((x) => x.outcome === "FAILED").map((x) => <li key={`${x.card_id}-${x.number}-${x.name}`}>{dict.body.workspace.failedRowLine.replace("{a}", String(x.number)).replace("{b}", x.name).replace("{c}", x.message ?? "")}</li>)}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
