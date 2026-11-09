"use client";
/**
 * Match context, rosters and team identity (Block 07, ADR-033), shared by Upload (page 01 section 2) and the Analysis Workspace
 * (page 03 sections 1 and 6):
 *  - MatchLinker: link a video to a match, or create the match (and its clubs) on the spot; record its final score (owner 2026-11-02:
 *    scoreboards show "—" until a person enters it — the score is never read from the footage);
 *  - RosterPanel: both teams' players — starters and substitutes, positions, shirt numbers, captain — added from the player registry
 *    (search, or a new provisional player), edited and removed with history, verified by a person;
 *  - TeamAssignment: which match team each kit colour group of the analysis is (or "not a team": referees, staff).
 * A shirt number or a colour is never an identity; the OTSI Player ID comes from the player registry only.
 */
import { Position, type Club, type Match, type PlayerIdentity, type RosterChange, type RosterEntry, type RunTeams } from "@otsi-vie/contracts";
import { CheckCircle2, History, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";

const input = "rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm";
const small = "rounded border border-line px-2 py-0.5 text-xs hover:border-primary/60 disabled:opacity-50";
const problem = (x: unknown, fallback: string) => (x instanceof ApiProblem ? x.message : fallback);
const idem = (s: string) => `ui-${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${Date.now().toString(36)}`;

export const matchTitle = (m: Pick<Match, "home" | "away">) => `${m.home?.name ?? "?"} v ${m.away?.name ?? "?"}`;

/* ------------------------------------------------------------------ club picker: search, or create */
function ClubPicker({ label, value, onChange, exclude }: { label: string; value: Club | null; onChange(c: Club | null): void; exclude?: string | undefined }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Club[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (value || q.trim().length < 1) { setHits(null); return; }
    const h = setTimeout(() => void api<Club[]>(`/v1/clubs?q=${encodeURIComponent(q.trim())}`).then(setHits, () => setHits([])), 200);
    return () => clearTimeout(h);
  }, [q, value]);
  if (value) {
    return (
      <p className="flex items-center justify-between gap-2 text-sm"><span><span className="text-xs text-muted">{label}: </span><span className="font-medium" data-club={label}>{value.name}</span></span>
        <button type="button" className={small} onClick={() => { onChange(null); setQ(""); }}>Change</button></p>
    );
  }
  const exact = hits?.some((c) => c.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <div className="space-y-1">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${label} club`} aria-label={`${label} club`} className={`w-full ${input}`} />
      {hits && (
        <ul className="space-y-0.5 text-xs" aria-label={`${label} club matches`}>
          {hits.filter((c) => c.id !== exclude).map((c) => (
            <li key={c.id}><button type="button" className="w-full rounded px-1 py-0.5 text-left hover:bg-raised/60" onClick={() => onChange(c)}>{c.name}{c.shared ? " (shared)" : ""}</button></li>
          ))}
          {!exact && q.trim().length >= 2 && (
            <li><button type="button" className="flex items-center gap-1 rounded px-1 py-0.5 text-primary hover:bg-raised/60"
              onClick={() => { setErr(null); void api<Club>("/v1/clubs", { method: "POST", json: { name: q.trim() } }).then(onChange, (x) => setErr(problem(x, "The club was not created."))); }}>
              <Plus className="h-3 w-3" />Create club &quot;{q.trim()}&quot;</button></li>
          )}
        </ul>
      )}
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ link a video to a match (or create one) */
export function MatchLinker({ videoId, matchId, canWrite, onLinked, refreshKey = 0 }: { videoId: string; matchId: string | null; canWrite: boolean; onLinked(m: Match): void; refreshKey?: number }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [mode, setMode] = useState<"view" | "pick" | "create" | "score" | "details">("view");
  const [home, setHome] = useState<Club | null>(null);
  const [away, setAway] = useState<Club | null>(null);
  const [competition, setCompetition] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!matchId) setMatch(null);
    if (matchId) void api<Match>(`/v1/matches/${matchId}`).then(setMatch, () => setMatch(null));
  }, [matchId, refreshKey]);
  useEffect(() => { if (mode === "pick" && !matches) void api<Match[]>("/v1/matches").then(setMatches, () => setMatches([])); }, [mode, matches]);
  const done = (m: Match) => { setMatch(m); setMode("view"); onLinked(m); };
  const link = (id: string) => {
    setBusy(true); setErr(null);
    void api<Match>(`/v1/videos/${videoId}/match`, { method: "POST", json: { match_id: id } }).then(done, (x) => setErr(problem(x, "The video was not linked."))).finally(() => setBusy(false));
  };
  const create = () => {
    if (!home || !away) return;
    setBusy(true); setErr(null);
    void api<Match>("/v1/matches", { method: "POST", json: { home_club_id: home.id, away_club_id: away.id, video_id: videoId,
      ...(competition.trim() ? { competition: competition.trim() } : {}), ...(date ? { kickoff_at: new Date(`${date}T12:00:00Z`).toISOString() } : {}) } })
      .then(done, (x) => setErr(problem(x, "The match was not created."))).finally(() => setBusy(false));
  };
  return (
    <div className="space-y-2 text-sm" data-match-linker>
      {matchId && !match && <p className="text-xs text-muted">Loading the match…</p>}
      {match && mode === "view" && (
        <div data-linked-match={match.id}>
          <p className="font-semibold">{matchTitle(match)}{match.home_score !== null && match.away_score !== null ? ` · ${match.home_score}–${match.away_score}` : ""}</p>
          <p className="text-xs text-muted">{[match.competition, match.kickoff_at?.slice(0, 10), match.venue].filter(Boolean).join(" · ") || "No competition or date yet"} · {match.roster.length} players on the roster
            {match.roster.length > 0 && (match.roster.every((r) => r.verified) ? " (verified)" : " (not verified)")}</p>
        </div>
      )}
      {!matchId && mode === "view" && <p className="text-xs text-muted">This video is not linked to a match. Teams, rosters and shirt-number look-ups need one.</p>}
      {canWrite && mode === "view" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={small} onClick={() => setMode("create")}>{matchId ? "Link to a new match" : "Create match"}</button>
          <button type="button" className={small} onClick={() => setMode("pick")}>{matchId ? "Link to another match" : "Choose existing match"}</button>
          {match && <button type="button" className={small} data-set-score onClick={() => setMode("score")}>
            {match.home_score !== null && match.away_score !== null ? "Change final score" : "Set final score"}</button>}
          {match && <button type="button" className={small} data-set-details onClick={() => setMode("details")}>
            {match.competition || match.kickoff_at || match.venue ? "Edit match details" : "Set match details"}</button>}
        </div>
      )}
      {match && mode === "score" && <ScoreForm match={match} onSaved={done} onCancel={() => setMode("view")} />}
      {match && mode === "details" && <DetailsForm match={match} onSaved={done} onCancel={() => setMode("view")} />}
      {mode === "pick" && (
        <div className="space-y-1">
          {!matches ? <p className="text-xs text-muted">Loading…</p> : matches.length === 0 ? <p className="text-xs text-muted">No matches yet: create one.</p> : (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs" aria-label="Matches">
              {matches.map((m) => (
                <li key={m.id}><button type="button" disabled={busy || m.id === matchId} onClick={() => link(m.id)} className="w-full rounded px-1 py-1 text-left hover:bg-raised/60 disabled:opacity-50">
                  {matchTitle(m)} <span className="text-muted">{[m.competition, m.kickoff_at?.slice(0, 10)].filter(Boolean).join(" · ")}</span></button></li>
              ))}
            </ul>
          )}
          <button type="button" className={small} onClick={() => setMode("view")}>Cancel</button>
        </div>
      )}
      {mode === "create" && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); create(); }} aria-label="New match">
          <ClubPicker label="Home" value={home} onChange={setHome} exclude={away?.id} />
          <ClubPicker label="Away" value={away} onChange={setAway} exclude={home?.id} />
          <div className="flex flex-wrap gap-2">
            <input value={competition} onChange={(e) => setCompetition(e.target.value)} placeholder="Competition (optional)" aria-label="Competition" className={`min-w-0 flex-1 ${input}`} />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Match date" className={input} />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !home || !away} className="rounded-ctl bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Create match and link video</button>
            <button type="button" className={small} onClick={() => setMode("view")}>Cancel</button>
          </div>
        </form>
      )}
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ final score */
/** The match's final score, entered by a person (owner 2026-11-02); scoreboards and reels show it, "—" until then. Also on Analysis. */
export function ScoreForm({ match, onSaved, onCancel }: { match: Match; onSaved(m: Match): void; onCancel(): void }) {
  const [score, setScore] = useState({ home: match.home_score?.toString() ?? "", away: match.away_score?.toString() ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ok = (s: string) => /^\d{1,2}$/.test(s);
  const bad = (score.home !== "" && !ok(score.home)) || (score.away !== "" && !ok(score.away));
  const save = (clear: boolean) => {
    setBusy(true); setErr(null);
    const n = (s: string) => (clear ? null : Number(s));
    void api<Match>(`/v1/matches/${match.id}`, { method: "PATCH", json: { version: match.version, home_score: n(score.home), away_score: n(score.away) } })
      .then(onSaved, (x) => setErr(problem(x, "The score was not saved."))).finally(() => setBusy(false));
  };
  return (
    <form className="space-y-2 text-sm" aria-label="Final score" data-score-form onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <p className="text-xs text-muted">The final score, as the match ended. Scoreboards and reels show it; until then they show "—".</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate font-medium">{match.home?.name ?? "Home"}</span>
        <input inputMode="numeric" autoFocus value={score.home} onChange={(e) => setScore({ ...score, home: e.target.value.trim() })} aria-label={`${match.home?.name ?? "Home"} goals`} className={`w-14 text-center ${input}`} />
        <span>–</span>
        <input inputMode="numeric" value={score.away} onChange={(e) => setScore({ ...score, away: e.target.value.trim() })} aria-label={`${match.away?.name ?? "Away"} goals`} className={`w-14 text-center ${input}`} />
        <span className="min-w-0 truncate font-medium">{match.away?.name ?? "Away"}</span>
      </div>
      {bad && <p className="text-xs text-danger">Enter a number of goals (0-99).</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !ok(score.home) || !ok(score.away)} className="rounded-ctl bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save score</button>
        {match.home_score !== null && <button type="button" className={small} disabled={busy} onClick={() => save(true)}>Clear score</button>}
        <button type="button" className={small} onClick={onCancel}>Cancel</button>
      </div>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </form>
  );
}

/* ------------------------------------------------------------------ match details */
/** Competition, date and venue, entered by a person (owner 2026-11-02: Home's Recent Matches said "Match details not recorded"). An
 *  empty field clears it. Never read from the footage. */
export function DetailsForm({ match, onSaved, onCancel }: { match: Match; onSaved(m: Match): void; onCancel(): void }) {
  const [f, setF] = useState({ competition: match.competition ?? "", date: match.kickoff_at?.slice(0, 10) ?? "", venue: match.venue ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    setBusy(true); setErr(null);
    const same = match.kickoff_at?.slice(0, 10) === f.date;                    // keep a recorded kick-off time when the day is unchanged
    void api<Match>(`/v1/matches/${match.id}`, { method: "PATCH", json: { version: match.version, competition: f.competition.trim() || null, venue: f.venue.trim() || null,
      kickoff_at: !f.date ? null : same ? match.kickoff_at : new Date(`${f.date}T12:00:00Z`).toISOString() } })
      .then(onSaved, (x) => setErr(problem(x, "The match details were not saved."))).finally(() => setBusy(false));
  };
  return (
    <form className="space-y-2 text-sm" aria-label="Match details" data-details-form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <p className="text-xs text-muted">The competition, date and venue, as you know them. Home and the Library show them.</p>
      <input value={f.competition} autoFocus maxLength={255} onChange={(e) => setF({ ...f, competition: e.target.value })} placeholder="Competition" aria-label="Competition" className={`w-full ${input}`} />
      <div className="flex flex-wrap gap-2">
        <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Match date" className={input} />
        <input value={f.venue} maxLength={255} onChange={(e) => setF({ ...f, venue: e.target.value })} placeholder="Venue" aria-label="Venue" className={`min-w-0 flex-1 ${input}`} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-ctl bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save details</button>
        <button type="button" className={small} onClick={onCancel}>Cancel</button>
      </div>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </form>
  );
}

/* ------------------------------------------------------------------ roster */
type Draft = { jersey_number: string; role: RosterEntry["role"]; position: string; captain: boolean };
const draftOf = (r?: RosterEntry): Draft => ({ jersey_number: r?.jersey_number === null || r?.jersey_number === undefined ? "" : String(r.jersey_number), role: r?.role ?? "STARTER", position: r?.position ?? "", captain: r?.captain ?? false });

function EntryFields({ d, set }: { d: Draft; set(d: Draft): void }) {
  return (
    <>
      <input value={d.jersey_number} onChange={(e) => set({ ...d, jersey_number: e.target.value.replace(/\D/g, "").slice(0, 2) })} placeholder="No." aria-label="Shirt number" inputMode="numeric" className={`w-14 ${input}`} />
      <select value={d.role} onChange={(e) => set({ ...d, role: e.target.value as Draft["role"] })} aria-label="Starter or substitute" className={input}>
        <option value="STARTER">Starter</option><option value="SUBSTITUTE">Substitute</option>
      </select>
      <select value={d.position} onChange={(e) => set({ ...d, position: e.target.value })} aria-label="Position" className={input}>
        <option value="">Position</option>{Position.options.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={d.captain} onChange={(e) => set({ ...d, captain: e.target.checked })} />Captain</label>
    </>
  );
}

function AddPlayer({ match, club, busy, save }: { match: Match; club: Club; busy: boolean; save(playerId: string, d: Draft): Promise<void> }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlayerIdentity[] | null>(null);
  const [pick, setPick] = useState<PlayerIdentity | null>(null);
  const [d, setD] = useState<Draft>(draftOf());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (pick || q.trim().length < 2) { setHits(null); return; }
    const h = setTimeout(() => void api<PlayerIdentity[]>(`/v1/players?q=${encodeURIComponent(q.trim())}`).then(setHits, () => setHits([])), 250);
    return () => clearTimeout(h);
  }, [q, pick]);
  const onRoster = new Set(match.roster.map((r) => r.player_id));
  const submit = async () => {
    setErr(null);
    try {
      const p = pick ?? await api<PlayerIdentity>("/v1/players", { method: "POST", json: { display_name: q.trim() }, headers: { "idempotency-key": idem(`roster-${q}`) } });
      await save(p.player_id, d);
      setQ(""); setPick(null); setD(draftOf());
    } catch (x) { setErr(problem(x, "The player was not added.")); }
  };
  return (
    <form className="space-y-1 rounded border border-dashed border-line/70 p-1.5" aria-label={`Add player to ${club.name}`} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {pick ? (
        <p className="flex items-center justify-between text-xs"><span>{pick.display_name} · {pick.canonical_otsi_id ?? "provisional"}</span><button type="button" className={small} onClick={() => setPick(null)}>Change</button></p>
      ) : (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find player, or type a new player's name" aria-label={`Player for ${club.name}`} className={`w-full ${input}`} />
      )}
      {hits && !pick && (
        <ul className="space-y-0.5 text-xs">
          {hits.filter((p) => !onRoster.has(p.player_id)).map((p) => (
            <li key={p.player_id}><button type="button" className="w-full rounded px-1 py-0.5 text-left hover:bg-raised/60" onClick={() => setPick(p)}>{p.display_name} · {p.canonical_otsi_id ?? "provisional"}</button></li>
          ))}
          {hits.length === 0 && <li className="text-muted">No player found; adding creates a new provisional player (no OTSI Player ID yet).</li>}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <EntryFields d={d} set={setD} />
        <button type="submit" disabled={busy || (!pick && q.trim().length < 2)} className="flex items-center gap-1 rounded-ctl border border-primary/60 px-2 py-1 text-xs text-primary disabled:opacity-50"><Plus className="h-3 w-3" />Add</button>
      </div>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </form>
  );
}

export function RosterPanel({ matchId, canWrite, canVerify, onChanged }: { matchId: string; canWrite: boolean; canVerify: boolean; onChanged?(): void }) {
  const [m, setM] = useState<Match | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf());
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<RosterChange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => api<Match>(`/v1/matches/${matchId}`).then(setM), [matchId]);
  useEffect(() => { setM(null); setHistory(null); void load().catch(() => setMsg({ ok: false, text: "The roster could not be loaded." })); }, [load]);
  const act = async (f: () => Promise<Match>, ok: string) => {
    setBusy(true); setMsg(null);
    try { const r = await f(); setM(r); setMsg({ ok: true, text: ok }); setEditing(null); setReason(""); if (history) setHistory(await api<RosterChange[]>(`/v1/matches/${matchId}/roster/history`)); onChanged?.(); }
    catch (x) { setMsg({ ok: false, text: problem(x, "That was not saved.") }); throw x; }
    finally { setBusy(false); }
  };
  if (!m) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading the roster…</p>;
  const verified = m.roster.length > 0 && m.roster.every((r) => r.verified);
  const needsReason = (r: RosterEntry) => r.verified;
  const body = (playerId: string, clubId: string, d: Draft, why: string | null) => ({ player_id: playerId, club_id: clubId, jersey_number: d.jersey_number === "" ? null : Number(d.jersey_number),
    role: d.role, position: d.position || null, captain: d.captain, reason: why });
  const save = (playerId: string, clubId: string, d: Draft, why: string | null) =>
    act(() => api<Match>(`/v1/matches/${matchId}/roster`, { method: "POST", json: body(playerId, clubId, d, why) }), "Roster saved.");
  return (
    <div className="space-y-3 text-sm" data-roster={m.id} data-roster-verified={verified ? "1" : "0"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{m.roster.length} players · {verified ? <span className="text-ok">verified by a person</span> : "not verified"}. A shirt number is what a player wore in this match, not an identity.</p>
        <div className="flex gap-1.5">
          {canVerify && m.roster.length > 0 && (
            <button type="button" disabled={busy} data-verify-roster onClick={() => void act(() => api<Match>(`/v1/matches/${matchId}/roster/verify`, { method: "POST", json: { verified: !verified } }), verified ? "Roster marked unverified." : "Roster verified.").catch(() => undefined)}
              className={`flex items-center gap-1 ${small}`}><ShieldCheck className="h-3.5 w-3.5" />{verified ? "Mark unverified" : "Verify roster"}</button>
          )}
          <button type="button" className={`flex items-center gap-1 ${small}`} onClick={() => void (history ? setHistory(null) : api<RosterChange[]>(`/v1/matches/${matchId}/roster/history`).then(setHistory))}>
            <History className="h-3.5 w-3.5" />{history ? "Hide history" : "History"}</button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[m.home, m.away].filter((c): c is Club => !!c).map((club) => {
          const entries = m.roster.filter((r) => r.club_id === club.id);
          return (
            <section key={club.id} aria-label={`${club.name} roster`} className="min-w-0 space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{club.name} · {entries.filter((e) => e.role === "STARTER").length} starters, {entries.filter((e) => e.role === "SUBSTITUTE").length} subs</h4>
              <ul className="space-y-1">
                {entries.map((r) => (
                  <li key={r.player_id} data-roster-player={r.display_name} className="rounded border border-line/50 p-1.5 text-xs">
                    {editing === r.player_id ? (
                      <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); void save(r.player_id, club.id, draft, reason.trim() || null).catch(() => undefined); }}>
                        <p className="font-medium">{r.display_name}</p>
                        <div className="flex flex-wrap items-center gap-1.5"><EntryFields d={draft} set={setDraft} /></div>
                        {needsReason(r) && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why change a verified entry? (required)" aria-label="Reason for the roster change" className={`w-full ${input}`} />}
                        <div className="flex flex-wrap gap-1.5">
                          <button type="submit" disabled={busy || (needsReason(r) && reason.trim().length < 3)} className={small}>Save</button>
                          <button type="button" disabled={busy || (needsReason(r) && reason.trim().length < 3)} aria-label={`Remove ${r.display_name}`}
                            onClick={() => void act(() => api<Match>(`/v1/matches/${matchId}/roster/${r.player_id}${reason.trim() ? `?reason=${encodeURIComponent(reason.trim())}` : ""}`, { method: "DELETE" }), `${r.display_name} removed.`).catch(() => undefined)}
                            className={`flex items-center gap-1 ${small} hover:border-danger/60`}><Trash2 className="h-3 w-3" />Remove</button>
                          <button type="button" className={small} onClick={() => { setEditing(null); setReason(""); }}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="w-6 text-right font-semibold tabular-nums">{r.jersey_number ?? "–"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{r.display_name}{r.captain ? " (C)" : ""}</span>
                          <span className="block text-muted">{r.canonical_otsi_id ?? "provisional, no OTSI Player ID yet"} · {r.role === "STARTER" ? "starter" : "substitute"}{r.position ? ` · ${r.position}` : ""}</span>
                        </span>
                        {r.verified && <CheckCircle2 aria-label="verified" className="h-3.5 w-3.5 shrink-0 text-ok" />}
                        {canWrite && <button type="button" className={small} onClick={() => { setEditing(r.player_id); setDraft(draftOf(r)); setReason(""); }}>Edit</button>}
                      </div>
                    )}
                  </li>
                ))}
                {entries.length === 0 && <li className="text-xs text-muted">No players yet.</li>}
              </ul>
              {canWrite && <AddPlayer match={m} club={club} busy={busy} save={(pid, d) => save(pid, club.id, d, null).then(() => undefined)} />}
            </section>
          );
        })}
      </div>
      {history && (
        <ol aria-label="Roster history" className="max-h-56 space-y-0.5 overflow-y-auto rounded border border-line/50 p-1.5 text-xs">
          {history.length === 0 && <li className="text-muted">No changes yet.</li>}
          {history.map((h) => (
            <li key={h.id}><span className="text-muted">{h.changed_at.slice(0, 16).replace("T", " ")}</span> · {h.changed_by}: {h.action.toLowerCase()} {h.display_name}
              {h.after && h.action !== "VERIFIED" && h.action !== "UNVERIFIED" && (h.after as { jersey_number?: number | null }).jersey_number !== undefined ? ` (No. ${(h.after as { jersey_number?: number | null }).jersey_number ?? "–"})` : ""}
              {h.reason ? ` — “${h.reason}”` : ""}</li>
          ))}
        </ol>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ kit groups -> match teams */
export function TeamAssignment({ runId, canReview, onChanged }: { runId: string; canReview: boolean; onChanged?(): void }) {
  const [rt, setRt] = useState<RunTeams | null>(null);
  const [reason, setReason] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setRt(null); void api<RunTeams>(`/v1/analysis-runs/${runId}/kit-groups`).then(setRt, () => setMsg({ ok: false, text: "Kit groups could not be loaded." })); }, [runId]);
  if (!rt) return <p className="text-sm text-muted">Loading kit groups…</p>;
  if (rt.groups.length === 0) return <p className="text-sm text-muted">This analysis found no kit colour groups (too few clear crops).</p>;
  const assign = (group: number, value: string, current: RunTeams["groups"][number]["assignment"]) => {
    setBusy(true); setMsg(null);
    const club_id = value === "none" ? null : value;
    void api<RunTeams>(`/v1/analysis-runs/${runId}/kit-groups/${group}/assignment`, { method: "POST", json: { club_id, supersedes_id: current?.assignment_id ?? null, reason: current ? (reason[group] ?? "").trim() || null : null } })
      .then((r) => { setRt(r); setReason({ ...reason, [group]: "" }); setMsg({ ok: true, text: `Kit ${String.fromCharCode(65 + group)} saved.` }); onChanged?.(); },
        (x) => setMsg({ ok: false, text: problem(x, "The assignment was not saved.") })).finally(() => setBusy(false));
  };
  return (
    <div className="space-y-2 text-sm" data-team-assignment>
      {!rt.match_id && <p className="text-xs text-muted">Link this video to a match to assign kit groups to its teams. Until then a group can only be marked &quot;not a team&quot;.</p>}
      {rt.match_id && !rt.roster_verified && <p className="text-xs text-amber">The roster is not verified yet: shirt-number suggestions count for less until it is.</p>}
      <ul className="space-y-1.5">
        {rt.groups.map((g) => (
          <li key={g.kit_group} data-kit-group={g.kit_group} className="flex flex-wrap items-center gap-2 rounded border border-line/50 p-1.5 text-xs">
            <span aria-hidden className="h-4 w-4 rounded-sm border border-line" style={{ background: g.kit_rgb ?? "transparent" }} />
            <span className="w-28">Kit {String.fromCharCode(65 + g.kit_group)} · {g.tracks} tracks</span>
            {canReview ? (
              <>
                <select aria-label={`Team of kit ${String.fromCharCode(65 + g.kit_group)}`} disabled={busy || (!!g.assignment && (reason[g.kit_group] ?? "").trim().length < 3)}
                  value={g.assignment ? g.assignment.club_id ?? "none" : ""} onChange={(e) => e.target.value && assign(g.kit_group, e.target.value, g.assignment)} className={input}>
                  <option value="">Not decided</option>
                  {rt.teams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="none">Not a team (referees, staff, mixed)</option>
                </select>
                {g.assignment && <input value={reason[g.kit_group] ?? ""} onChange={(e) => setReason({ ...reason, [g.kit_group]: e.target.value })} placeholder="Reason to change" aria-label={`Reason to change kit ${String.fromCharCode(65 + g.kit_group)}`} className={`min-w-0 flex-1 ${input}`} />}
              </>
            ) : <span>{g.assignment ? g.assignment.club_name ?? "not a team" : "not decided"}</span>}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted">A colour group is not a team until you say so: similar kits, goalkeepers, referees and lighting can mix colours. Check a few tracks of each group first.</p>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
