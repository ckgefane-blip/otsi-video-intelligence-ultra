"use client";
/**
 * "Name players" on Page 04 (ADR-039): naming tracks in bulk once the match roster exists (from the lineup cards or typed in).
 *   1 Kits      which kit colour group is which team (or not a team): run_team_assignments, one decision per group
 *   2 Numbers   every track with a shirt number read -> the roster player wearing it for that kit's team; the engine ticks only clear readings
 *               with a known team and no clash; the person unticks what looks wrong and accepts the rest
 *   3 Look-alikes  for each named player, the tracks anywhere in the match that look like him (from all his named tracks); accepting widens it
 *   4 Is this him?  for one player (the reel's): the unnamed players in the engine's events who could be him; Yes / No / Can't tell (ADR-046)
 * Every acceptance is one identity decision per track, made by the person; nothing is named without it.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { LookAlikes, NamedPlayers, NumberProposals, RunTeams, TrackIdentity } from "@otsi-vie/contracts";
import { useCallback, useEffect, useState } from "react";
import { TrackThumb } from "@/components/analysis/SamePerson";
import { useAnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";
import { api, ApiProblem } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { MomentPreview, WhoIsThisPanel } from "./WhoIsThis";

type Tab = "kits" | "numbers" | "alike" | "who";

/** confirm one track as a player (a correction of an earlier decision carries the reason) */
async function confirm(trackId: string, playerId: string, why: string): Promise<void> {
  const cur = await api<TrackIdentity>(`/v1/tracks/${trackId}/identity`);
  if (cur.state === "CONFIRMED" && cur.player?.player_id === playerId) return;
  if (cur.state === "CONFIRMED") throw new ApiProblem(409, "CONFLICT", "already named as someone else");
  await api(`/v1/tracks/${trackId}/identity-decisions`, { method: "POST", json: { state: "CONFIRMED", player_id: playerId, supersedes_id: cur.decision_id, reason: cur.decision_id ? why : null } });
}

async function confirmAll(items: { track_id: string; player_id: string }[], why: string, onStep: (done: number) => void): Promise<{ ok: number; failed: number }> {
  let ok = 0, failed = 0;
  for (const [i, x] of items.entries()) {
    try { await confirm(x.track_id, x.player_id, why); ok++; } catch { failed++; }
    onStep(i + 1);
  }
  return { ok, failed };
}

/** `player`: the player whose reel is being made (the Reel Builder's "Find more of him"): opens on step 4 asking "is this him?" */
export function NamePlayersDialog({ open, onOpenChange, player }: { open: boolean; onOpenChange: (o: boolean) => void; player?: string | null }) {
  const ws = useAnalysisWorkspace();
  const runId = ws?.run?.id;
  const [tab, setTab] = useState<Tab>("kits");
  const [kits, setKits] = useState<RunTeams | null>(null);
  const [props, setProps] = useState<NumberProposals | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [named, setNamed] = useState<NamedPlayers>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [whoFor, setWhoFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId) return;
    const [k, p, n] = await Promise.all([api<RunTeams>(`/v1/analysis-runs/${runId}/kit-groups`), api<NumberProposals>(`/v1/analysis-runs/${runId}/number-proposals`),
      api<NamedPlayers>(`/v1/analysis-runs/${runId}/named-players`)]);
    setKits(k); setProps(p); setNamed(n); setTicked(new Set(p.proposals.filter((x) => x.accept).map((x) => x.track_id)));
  }, [runId]);
  useEffect(() => { if (open) { setMsg(null); void load().catch(() => setMsg({ ok: false, text: "Could not load." })); } }, [open, load]);
  useEffect(() => { if (open && player) { setTab("who"); setWhoFor(player); } }, [open, player]);


  const assign = async (group: number, clubId: string | null) => {
    if (!runId) return;
    const cur = kits?.groups.find((g) => g.kit_group === group)?.assignment;
    setBusy(`kit-${group}`); setMsg(null);
    try {
      setKits(await api<RunTeams>(`/v1/analysis-runs/${runId}/kit-groups/${group}/assignment`, { method: "POST", json: { club_id: clubId, supersedes_id: cur?.assignment_id ?? null, reason: cur ? "corrected while naming players" : null } }));
      setProps(await api<NumberProposals>(`/v1/analysis-runs/${runId}/number-proposals`).then((p) => { setTicked(new Set(p.proposals.filter((x) => x.accept).map((x) => x.track_id))); return p; }));
    } catch (x) { setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : "Not saved." }); } finally { setBusy(null); }
  };

  const acceptNumbers = async () => {
    const items = (props?.proposals ?? []).filter((x) => ticked.has(x.track_id) && x.player).map((x) => ({ track_id: x.track_id, player_id: x.player!.player_id }));
    if (!items.length) return;
    setBusy("numbers"); setMsg(null);
    const r = await confirmAll(items, "named from the shirt number and the match roster", (d) => setMsg({ ok: true, text: `Naming… ${d} of ${items.length}` }));
    setMsg({ ok: r.failed === 0, text: `${r.ok} tracks named${r.failed ? `, ${r.failed} not (already named as someone else)` : ""}. Step 3 spreads each name to his look-alikes.` });
    await ws?.reloadTracks(); await load(); setBusy(null);
  };

  const tabs: [Tab, string][] = [["kits", "1 · Kits to teams"], ["numbers", `2 · From shirt numbers${props ? ` (${props.proposals.filter((x) => x.player).length})` : ""}`], ["alike", `3 · From look-alikes${named.length ? ` (${named.length} player${named.length === 1 ? "" : "s"})` : ""}`], ["who", "4 · Is this him? (his events)"]];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="name-players" className="fixed left-1/2 top-1/2 z-50 max-h-[94vh] w-[min(1200px,98vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">Name players</Dialog.Title>
              <Dialog.Description className="text-xs text-muted">From the match roster: first say which kit is which team, then accept the names the shirt numbers give, then spread each name to the tracks that look like him. Untick anything that looks wrong: unknown is better than wrong.</Dialog.Description>
            </div>
            <Dialog.Close className="rounded-ctl bg-primary px-3 py-1 font-semibold text-white">Done</Dialog.Close>
          </div>
          <div role="tablist" className="mb-3 flex gap-2">
            {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-ctl border px-3 py-1 ${tab === k ? "border-primary text-primary" : "border-line text-muted"}`}>{l}</button>)}
          </div>
          {!kits?.match_id && <p className="text-xs text-danger">This video has no match yet: approve the lineups (or link a match) first.</p>}

          {tab === "kits" && kits && (
            <div className="space-y-2" data-kits>
              {kits.groups.map((g) => (
                <div key={g.kit_group} className="flex flex-wrap items-center gap-3 rounded border border-line/60 p-2" data-kit={g.kit_group}>
                  <span className="inline-block h-6 w-6 rounded border border-line" style={{ background: g.kit_rgb ?? "#555" }} />
                  <span className="w-28 text-xs text-muted">Kit {g.kit_group + 1} · {g.tracks} tracks</span>
                  <div className="flex gap-1">{g.sample_track_ids.map((id) => <TrackThumb key={id} trackId={id} has size={26} />)}</div>
                  <select aria-label={`Team of kit ${g.kit_group + 1}`} disabled={busy !== null} value={g.assignment ? (g.assignment.club_id ?? "none") : ""}
                    onChange={(e) => void assign(g.kit_group, e.target.value === "none" ? null : e.target.value)} className="ml-auto rounded-ctl border border-line bg-canvas px-2 py-1">
                    <option value="" disabled>Which team?</option>
                    {kits.teams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value="none">Not a team (referees, staff)</option>
                  </select>
                </div>
              ))}
              <p className="text-xs text-muted">A kit colour group is the engine's grouping by shirt colour: goalkeepers and referees often form their own groups.</p>
            </div>
          )}

          {tab === "numbers" && props && (
            <div className="space-y-2" data-numbers>
              {props.kits_unassigned > 0 && <p className="text-xs text-amber">{props.kits_unassigned} kit group{props.kits_unassigned === 1 ? "" : "s"} without a team: many numbers are worn by both teams, so set the kits first (step 1).</p>}
              {props.proposals.length === 0 ? <p className="text-xs text-muted">No track left with a readable shirt number.</p> : (
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-muted"><th className="w-8" /><th className="w-10" /><th>Track</th><th>No.</th><th>Team</th><th>Player</th><th>Why not ticked</th></tr></thead>
                  <tbody>
                    {props.proposals.map((x) => (
                      <tr key={x.track_id} data-proposal={x.track_number} className={x.player ? "" : "opacity-60"}>
                        <td><input type="checkbox" aria-label={`Accept track ${x.track_number}`} disabled={!x.player} checked={ticked.has(x.track_id)}
                          onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(x.track_id); else n.delete(x.track_id); return n; })} /></td>
                        <td><button type="button" title="Show on the video" onClick={() => { ws?.select(x.track_id); ws?.seek(x.first_pts_us); }}><TrackThumb trackId={x.track_id} has={x.has_thumbnail} size={22} /></button></td>
                        <td>{x.track_number} · {formatDuration(x.first_pts_us)}</td>
                        <td>{x.shirt.number}{x.shirt.source === "UNCERTAIN" ? " (uncertain)" : x.shirt.source === "CONFIRMED" ? " (confirmed)" : ""}</td>
                        <td>{x.team ? x.team.name : "—"}</td>
                        <td>{x.player ? x.player.display_name : "—"}</td>
                        <td className="text-muted">{x.note ?? (x.shirt.source === "UNCERTAIN" ? "Uncertain reading: check it." : "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button type="button" disabled={busy !== null || ticked.size === 0} onClick={() => void acceptNumbers()} className="rounded-ctl bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
                Accept the ticked ({[...ticked].filter((id) => props.proposals.some((x) => x.track_id === id && x.player)).length})</button>
            </div>
          )}

          {tab === "who" && ws?.video && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-muted">Player
                <select value={whoFor ?? ""} onChange={(e) => setWhoFor(e.target.value || null)} className="rounded-ctl border border-line bg-panel px-2 py-1 text-sm text-text">
                  <option value="">Choose the player of the reel…</option>
                  {named.map((pl) => <option key={pl.player_id} value={pl.player_id}>{pl.display_name}</option>)}
                </select>
              </label>
              {whoFor ? <WhoIsThisPanel videoId={ws.video.id} playerId={whoFor} onNamed={async () => { await ws.reloadTracks(); await load(); }} />
                : <p className="text-xs text-muted">{named.length ? "Choose the player whose reel you are making." : "Name the player first with Identify (or from shirt numbers, step 2)."}</p>}
            </div>
          )}

          {tab === "alike" && (
            <div className="space-y-2" data-alike>
              {named.length === 0 ? <p className="text-xs text-muted">No player named yet: accept some from shirt numbers (step 2) or name one with Identify.</p>
                : named.map((pl) => <PlayerAlikes key={pl.player_id} name={pl.display_name} trackId={pl.track_id} named={pl.tracks} startOpen={pl.player_id === player} onChanged={async () => { await ws?.reloadTracks(); setNamed(await api<NamedPlayers>(`/v1/analysis-runs/${runId}/named-players`)); }} />)}
            </div>
          )}
          {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** say "not him" about one track: a REJECTED decision naming the player, so the search never offers it for him again */
async function rejectFor(trackId: string, playerId: string, why: string): Promise<void> {
  const cur = await api<TrackIdentity>(`/v1/tracks/${trackId}/identity`);
  if (cur.state === "CONFIRMED") throw new ApiProblem(409, "CONFLICT", "already named");
  if (cur.state === "REJECTED" && cur.player?.player_id === playerId) return;
  await api(`/v1/tracks/${trackId}/identity-decisions`, { method: "POST", json: { state: "REJECTED", player_id: playerId, supersedes_id: cur.decision_id, reason: cur.decision_id ? why : null } });
}

type Verdict = "him" | "not";
type Other = LookAlikes["items"][number]["other"];

/**
 * One player's look-alikes (ADR-045): the tracks that look most like him, ranked by look and shirt colour. Nothing is pre-ticked (on wide
 * footage everyone looks alike to the model: no threshold separates him from the others); the person says Him or Not him per picture
 * ("Show" puts the moment on the video), and saving records both: Not him is never offered for him again, so the next look-alikes come up.
 */
function PlayerAlikes({ name, trackId, named, startOpen, onChanged }: { name: string; trackId: string; named: number; startOpen?: boolean; onChanged(): Promise<void> }) {
  const ws = useAnalysisWorkspace();
  const [data, setData] = useState<LookAlikes | null>(null);
  const [say, setSay] = useState<Map<string, Verdict>>(new Map());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [openRow, setOpenRow] = useState(!!startOpen);
  const [preview, setPreview] = useState<Other | null>(null);
  const load = useCallback(async () => {
    setData(await api<LookAlikes>(`/v1/tracks/${trackId}/look-alikes`)); setSay(new Map()); setPreview(null);
  }, [trackId]);
  useEffect(() => { if (openRow) void load().catch(() => setMsg({ ok: false, text: "Could not load his look-alikes." })); }, [openRow, load]);
  const mark = (id: string, v: Verdict) => setSay((m) => { const n = new Map(m); if (n.get(id) === v) n.delete(id); else n.set(id, v); return n; });
  const yes = [...say].filter(([, v]) => v === "him").map(([id]) => id), no = [...say].filter(([, v]) => v === "not").map(([id]) => id);
  const save = async () => {
    if (!data?.player) return;
    const pid = data.player.player_id;
    setBusy(true); setMsg(null);
    const r = await confirmAll(yes.map((id) => ({ track_id: id, player_id: pid })), `looks like ${name} (look-alike reviewed)`, () => undefined);
    let rejected = 0, failed = r.failed;
    for (const id of no) { try { await rejectFor(id, pid, `not ${name} (look-alike reviewed)`); rejected++; } catch { failed++; } }
    setMsg({ ok: failed === 0, text: `${r.ok} more track${r.ok === 1 ? "" : "s"} named ${name}, ${rejected} marked not him${failed ? `; ${failed} not saved (someone else decided them)` : ""}. The next look-alikes are below.` });
    await onChanged(); await load(); setBusy(false);
  };
  const show = (o: Other) => { setPreview(o); ws?.select(o.track_id); ws?.seek(o.first_pts_us); };
  return (
    <div className="rounded border border-line/60 p-2" data-player-alikes={name}>
      <button type="button" onClick={() => setOpenRow((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="font-medium">{name}</span><span className="text-xs text-muted">{named} named track{named === 1 ? "" : "s"} · {openRow ? "hide" : "find his other tracks"}</span>
      </button>
      {openRow && (!data ? <p className="text-xs text-muted">Loading…</p> : data.items.length === 0 ? <p className="text-xs text-muted">No more look-alikes from his {data.seeds} named tracks.</p> : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted">The {data.items.length} tracks that look most like him (from his {data.seeds} named tracks{data.more ? `; ${data.more} more after these` : ""}). Look at each one: press Show to see the moment on the video, then Him or Not him. Leave it if you are not sure.</p>
          {preview && <MomentPreview key={preview.track_id} trackId={preview.track_id} from={preview.first_pts_us} to={preview.last_pts_us} onClose={() => setPreview(null)}
            label={`${formatDuration(preview.first_pts_us)}–${formatDuration(preview.last_pts_us)}`} />}
          <div className="flex flex-wrap gap-2">
            {data.items.map(({ other: o, score }) => {
              const v = say.get(o.track_id);
              return (
                <div key={o.track_id} data-alike={o.track_number} data-verdict={v ?? "none"} className={`flex w-[132px] flex-col items-center gap-1 rounded border p-1.5 text-[11px] ${preview?.track_id === o.track_id ? "ring-2 ring-primary " : ""}${v === "him" ? "border-ok bg-ok/10" : v === "not" ? "border-danger/70 opacity-60" : "border-line/50"}`}>
                  <TrackThumb trackId={o.track_id} has={o.has_thumbnail} size={80} />
                  <span>{formatDuration(o.first_pts_us)} · {formatDuration(o.last_pts_us - o.first_pts_us)} · {Math.round(score * 100)}</span>
                  <button type="button" onClick={() => show(o)} className="w-full rounded-ctl border border-line px-1 py-0.5 text-primary">Show</button>
                  <div className="flex w-full gap-1">
                    <button type="button" aria-pressed={v === "him"} aria-label={`Track ${o.track_number} is ${name}`} onClick={() => mark(o.track_id, "him")}
                      className={`flex-1 rounded-ctl px-1 py-0.5 font-semibold ${v === "him" ? "bg-ok text-black" : "border border-ok/60 text-ok"}`}>Him</button>
                    <button type="button" aria-pressed={v === "not"} aria-label={`Track ${o.track_number} is not ${name}`} onClick={() => mark(o.track_id, "not")}
                      className={`flex-1 rounded-ctl px-1 py-0.5 font-semibold ${v === "not" ? "bg-danger text-white" : "border border-danger/60 text-danger"}`}>Not him</button>
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" disabled={busy || say.size === 0} onClick={() => void save()} className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white disabled:opacity-50">
            {busy ? "Saving…" : `Save: ${yes.length} him, ${no.length} not him`}</button>
        </div>
      ))}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-1 text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
