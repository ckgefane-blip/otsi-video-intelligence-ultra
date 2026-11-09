"use client";
/**
 * The Players list (owner 2026-11-02: "the engine should have a player list where user can enter player profile before creating reel").
 * A person records what the video cannot tell: nationality, preferred foot, birth date (the age is computed) and usual position. Team and
 * shirt number are read from the latest match team sheet, where they are recorded per match (a team sheet's position, for that match, is
 * shown first where there is one). Reels and reports show what is saved here;
 * nothing is guessed. Only the organization that created a player can change the profile (the registry is shared).
 */
import type { Country, PlayerListEntry, PlayerProfile } from "@otsi-vie/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, ApiProblem } from "@/lib/api";

export const POSITION_NAMES: Record<string, string> = {
  GK: "Goalkeeper", RB: "Right back", CB: "Centre back", LB: "Left back", RWB: "Right wing-back", LWB: "Left wing-back", DM: "Defensive midfielder",
  CM: "Central midfielder", AM: "Attacking midfielder", RM: "Right midfielder", LM: "Left midfielder", RW: "Right winger", LW: "Left winger",
  CF: "Centre forward", ST: "Striker", DF: "Defender", MF: "Midfielder", FW: "Forward",
};
export const FOOT_NAMES: Record<string, string> = { LEFT: "Left", RIGHT: "Right", BOTH: "Both", UNKNOWN: "Unknown" };

type Draft = { nationality: string; foot: string; birth: string; position: string };
const draftOf = (p: PlayerProfile): Draft => ({ nationality: p.nationality?.code ?? "", foot: p.preferred_foot ?? "", birth: p.birth_date ?? "", position: p.position ?? "" });

function Row({ e, countries, focus, onSaved }: { e: PlayerListEntry; countries: Country[]; focus: boolean; onSaved(p: PlayerProfile): void }) {
  const [d, setD] = useState<Draft>(draftOf(e.profile));
  const [state, setState] = useState<{ busy?: boolean; ok?: string; err?: string }>({});
  useEffect(() => setD(draftOf(e.profile)), [e.profile]);
  const saved = draftOf(e.profile);
  const changed = d.nationality !== saved.nationality || d.foot !== saved.foot || d.birth !== saved.birth || d.position !== saved.position;
  const t = e.profile.latest_team;
  const can = e.profile.editable;
  const save = async () => {
    setState({ busy: true });
    try {
      const body: Record<string, string | boolean | null> = {};
      if (d.nationality !== saved.nationality) body.nationality = d.nationality || null;
      if (d.foot !== saved.foot) body.preferred_foot = d.foot || null;
      if (d.birth !== saved.birth) body.birth_date = d.birth || null;
      if (d.position !== saved.position) {
        body.position = d.position || null;
        body.confirm_role = true;
      }
      const p = await api<PlayerProfile>(`/v1/players/${e.player_id}/profile`, { method: "PATCH", json: body });
      onSaved(p); setState({ ok: "Saved & confirmed." });
    } catch (x) {
      setState({ err: x instanceof ApiProblem ? x.message : "Could not save. Try again." });
    }
  };
  const confirmRole = async () => {
    setState({ busy: true });
    try {
      const p = await api<PlayerProfile>(`/v1/players/${e.player_id}/profile`, { method: "PATCH", json: { confirm_role: true } });
      onSaved(p); setState({ ok: "Role confirmed." });
    } catch (x) {
      setState({ err: x instanceof ApiProblem ? x.message : "Could not confirm role." });
    }
  };
  const field = "w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 disabled:opacity-60";
  return (
    <li id={`player-${e.player_id}`} data-player={e.player_id}
      className={`grid grid-cols-1 gap-3 rounded-card border bg-panel p-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_repeat(4,minmax(0,1fr))_auto] md:items-end ${focus ? "border-primary" : "border-line"}`}>
      <div className="min-w-0">
        <div className="truncate text-base font-semibold">{e.display_name}</div>
        <div className="truncate text-xs text-muted">{e.canonical_otsi_id ?? "Provisional: no OTSI Player ID yet"}</div>
        <Link href={`/reports/players/${e.canonical_otsi_id ?? e.player_id}`} className="text-xs text-primary hover:underline">Open report ›</Link>
      </div>
      <div className="min-w-0 text-sm">
        <div className="text-xs text-muted">Team · No. (from the team sheet)</div>
        {t ? <div className="truncate">{t.team} · {t.jersey_number ?? "—"}</div>
          : <div className="text-muted">Not on a team sheet yet</div>}
      </div>
      <label className="text-sm">
        <div className="mb-1 flex items-center justify-between">
          <span className="block text-xs text-muted">Position</span>
          {e.profile.position && (
            e.profile.role_confirmed ? (
              <span className="rounded bg-ok/20 px-1 py-0.5 text-[10px] font-semibold text-ok" title={e.profile.role_confirmed_by_name ? `Confirmed by ${e.profile.role_confirmed_by_name}` : "Confirmed by analyst"}>✓ Confirmed</span>
            ) : (
              <div className="flex items-center gap-1">
                <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-semibold text-amber-400">Provisional</span>
                {can && <button type="button" onClick={() => void confirmRole()} className="text-[10px] text-primary hover:underline">Confirm</button>}
              </div>
            )
          )}
        </div>
        <select aria-label={`${e.display_name} position`} value={d.position} disabled={!can} onChange={(x) => setD({ ...d, position: x.target.value })} className={field}>
          <option value="">Not recorded</option>
          {Object.entries(POSITION_NAMES).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
        </select>
      </label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Nationality</span>
        <select aria-label={`${e.display_name} nationality`} value={d.nationality} disabled={!can} onChange={(x) => setD({ ...d, nationality: x.target.value })} className={field}>
          <option value="">Not recorded</option>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Preferred foot</span>
        <select aria-label={`${e.display_name} preferred foot`} value={d.foot} disabled={!can} onChange={(x) => setD({ ...d, foot: x.target.value })} className={field}>
          <option value="">Not recorded</option>
          {Object.entries(FOOT_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Birth date{e.profile.age !== null ? ` (age ${e.profile.age})` : ""}</span>
        <input type="date" aria-label={`${e.display_name} birth date`} value={d.birth} disabled={!can} max={new Date().toISOString().slice(0, 10)} min="1900-01-01"
          onChange={(x) => setD({ ...d, birth: x.target.value })} className={field} />
      </label>
      <div className="flex flex-col items-start gap-1 md:items-end">
        <button type="button" disabled={!can || !changed || state.busy} onClick={() => void save()}
          className="rounded-ctl border border-primary/70 bg-primary/20 px-4 py-1.5 text-sm font-semibold hover:bg-primary/30 disabled:opacity-40">{state.busy ? "Saving…" : "Save"}</button>
        {!can && <span className="text-xs text-muted">Created by another organization: read only</span>}
        {state.ok && !changed && <span role="status" className="text-xs text-ok">{state.ok}</span>}
        {state.err && <span role="alert" className="text-xs text-danger">{state.err}</span>}
      </div>
    </li>
  );
}

export function PlayersList() {
  const focus = useSearchParams().get("player");
  const [list, setList] = useState<PlayerListEntry[] | null | undefined>(undefined);
  const [countries, setCountries] = useState<Country[]>([]);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [confirmedOnly, setConfirmedOnly] = useState(true);
  useEffect(() => {
    void api<PlayerListEntry[]>("/v1/player-list").then(setList, () => setList(null));
    void api<Country[]>("/v1/countries").then(setCountries, () => setCountries([]));
  }, []);
  useEffect(() => { if (focus && list) document.getElementById(`player-${focus}`)?.scrollIntoView({ block: "center" }); }, [focus, list]);
  const shown = useMemo(() => (list ?? []).filter((e) => {
    if (q.trim()) {
      const matchText = e.display_name.toLowerCase().includes(q.trim().toLowerCase()) || (e.canonical_otsi_id ?? "").includes(q.trim().toUpperCase());
      if (!matchText) return false;
    }
    if (roleFilter) {
      if (confirmedOnly) {
        if (!e.profile.role_confirmed || e.profile.position !== roleFilter) return false;
      } else {
        if (e.profile.position !== roleFilter) return false;
      }
    } else if (confirmedOnly && e.profile.position && !e.profile.role_confirmed) {
      // If position is set but not confirmed, and confirmedOnly is active when role is selected
    }
    return true;
  }), [list, q, roleFilter, confirmedOnly]);
  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6" data-page="players">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Players</h1>
          <p className="text-sm text-muted">Enter what you know about each player once. Reels and reports show it. The video never fills these in.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by position"
            className="rounded-ctl border border-line bg-canvas px-3 py-2 text-sm">
            <option value="">All positions</option>
            {Object.entries(POSITION_NAMES).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={confirmedOnly} onChange={(e) => setConfirmedOnly(e.target.checked)} className="rounded border-line" />
            <span>Confirmed roles only</span>
          </label>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" placeholder="Search by name or OTSI Player ID…"
            className="w-full max-w-xs rounded-ctl border border-line bg-canvas px-3 py-2 text-sm" />
        </div>
      </div>
      {list === undefined && <p className="text-muted">Loading…</p>}
      {list === null && <p role="alert" className="text-danger">The players could not be loaded.</p>}
      {list && shown.length === 0 && <p className="text-muted">{list.length ? "No player matches the search." : "No players yet. Add players to a match team sheet, or confirm who a player is in Analysis."}</p>}
      <ul aria-label="Players" className="space-y-3">
        {shown.map((e) => (
          <Row key={e.player_id} e={e} countries={countries} focus={focus === e.player_id}
            onSaved={(p) => setList((l) => l?.map((x) => (x.player_id === e.player_id ? { ...x, profile: p } : x)))} />
        ))}
      </ul>
    </main>
  );
}
