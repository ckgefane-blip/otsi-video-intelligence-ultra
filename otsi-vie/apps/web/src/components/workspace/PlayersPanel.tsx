"use client";
/**
 * Page 04 Sections 09-10 — players list and selected player card (approved reference 04_ANALYSIS_WORKSPACE, right column).
 *
 * The list is the people tracks of the latest finished run (a track is a temporary reference within one analysis, not a player ID):
 * thumbnail, label, the team a person assigned to its kit colour, mean detection confidence and identity state. Jersey numbers are not
 * read yet, so the "#" column says "—". Search, All / Home / Away and a row click (select + jump to where the track first appears) work
 * on real tracks. The card shows what is recorded about the selected track; distance, speed, passes and the heatmap need calibrated
 * pitch positions and event detection, so they say "Not measured". Identity decisions are made on the identity review page.
 * Events tab (owner 2026-11-02, "Events and Clips totally empty"): every event the engine found, in time order, the same list as the
 * timeline's All Events; a row selects the player who did it and plays from just before it. Clips tab: the clips of the reels made from
 * this video; a row plays the clip's start, and each reel opens in Reel Builder.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ballWonBy, clipOutputUs, passesOf, pressuresBy, type Movement, type Reel, type TrackIdentity, type TrackSummary } from "@otsi-vie/contracts";
import { teamCode } from "@/lib/team";
import { B, Ic, T, u } from "@/components/stage/DesignStage";
import { Box } from "@/components/tactics/kit";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { assignmentOf, clock, Hit, isPerson, Thumb, type Shared } from "./shared";
import { useDw } from "./ResizableColumns";
import { HeatPitch, measuredText, useHeatZones } from "./HeatPitch";
import { IdentifyDialog } from "./IdentifyDialog";
import { PropertiesDialog } from "./PropertiesCard";
import { allMarks, KIND, marksOf } from "./TimelinePanel";
import { notBuilt } from "@/lib/devMode";

const list_ = (dw: number) => ({ left: u(2033), top: u(188 - 101), width: u(487 + dw), height: u(530), overflowY: "auto" as const });
const row = { display: "flex", gap: u(10), alignItems: "flex-start", width: "100%", padding: `${u(8)} ${u(6)}`, borderBottom: `${u(1)} solid #12305a`,
  background: "transparent", color: "#dbe8f8", fontSize: u(17), textAlign: "left" as const, cursor: "pointer" };

/** the Events tab: every event found, a row to watch it and accept/reject it (ADR-118) */
function EventsTab({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws } = s;
  const dw = useDw();
  const marks = useMemo(() => allMarks(marksOf(ws?.events.data ?? null)), [ws?.events.data]);
  const names = useMemo(() => new Map((ws?.tracks ?? []).map((t) => [t.track_id, t.label])), [ws?.tracks]);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const decide = async (eventId: string, decision: "CONFIRM" | "REJECT") => {
    if (!ws?.video?.id) return;
    setDecidingId(eventId);
    try {
      await api(`/v1/videos/${ws.video.id}/events/${eventId}/decision`, {
        method: "POST",
        json: { decision },
      });
      await ws.events.reload();
      if (ws.bumpEvidence) ws.bumpEvidence();
    } catch {
      /* keep what is shown */
    } finally {
      setDecidingId(null);
    }
  };

  if (!ws?.run) return <T x={2276 + dw / 2} y={480} size={20} color="#8ea3bf" align="center">{dict.body.analysis.noFinishedAnalysis}</T>;
  if (!marks.length) return <T x={2276 + dw / 2} y={480} size={20} color="#8ea3bf" align="center" style={{ maxWidth: u(460) }}>No events found yet. Events are found once the ball is followed (AI Tools → Ball).</T>;
  const rejectedCount = ws.events.data?.rejected_events_count ?? 0;
  return (
    <div role="list" aria-label="Events" data-events={String(marks.length)} className="absolute" style={list_(dw)}>
      <div style={{ fontSize: u(15), color: "#8ea3bf", padding: `0 ${u(6)} ${u(6)}`, display: "flex", justifyContent: "space-between" }}>
        <span>{marks.length} events, in time order.</span>
        {rejectedCount > 0 && <span style={{ color: "#ef4444" }}>({rejectedCount} rejected hidden)</span>}
      </div>
      {marks.map((m) => {
        const k = KIND[m.kind], who = m.tracks.filter((x): x is string => !!x).map((x) => names.get(x) ?? "a player");
        const dec = m.decision;
        return (
          <div key={`${m.kind}-${m.id}`} style={{ ...row, display: "flex", flexDirection: "column", gap: u(4) }}>
            <div
              style={{ display: "flex", gap: u(10), alignItems: "flex-start", width: "100%", cursor: "pointer" }}
              onClick={() => { if (m.tracks[0]) ws.select(m.tracks[0]); ws.seek(Math.max(0, m.at - k.lead)); }}
            >
              <span style={{ width: u(12), height: u(12), marginTop: u(5), borderRadius: "50%", background: k.color, flex: "none" }} />
              <span style={{ width: u(64), flex: "none", color: "#9fb3cc" }}>{clock(m.at)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{k.noun[0]!.toUpperCase() + k.noun.slice(1)}</span>
                {who.length > 0 && <span style={{ color: "#cfdcf0" }}> · {who.join(" → ")}</span>}
                {m.detail && <span style={{ display: "block", color: "#8ea3bf", fontSize: u(15) }}>{m.detail}</span>}
              </span>
              {dec && (
                <span style={{
                  fontSize: u(12),
                  padding: `${u(2)} ${u(6)}`,
                  borderRadius: u(4),
                  fontWeight: 600,
                  background: dec === "CONFIRM" ? "rgba(34, 197, 94, 0.2)" : dec === "EDIT" ? "rgba(59, 130, 246, 0.2)" : "rgba(245, 158, 11, 0.2)",
                  color: dec === "CONFIRM" ? "#22c55e" : dec === "EDIT" ? "#60a5fa" : "#fbbf24",
                }}>
                  {dec}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: u(8), paddingLeft: u(74), marginTop: u(2) }}>
              <button
                type="button"
                disabled={decidingId === m.id || dec === "CONFIRM"}
                style={{
                  fontSize: u(13),
                  padding: `${u(2)} ${u(8)}`,
                  borderRadius: u(4),
                  background: dec === "CONFIRM" ? "transparent" : "rgba(34, 197, 94, 0.15)",
                  color: dec === "CONFIRM" ? "#22c55e" : "#4ade80",
                  border: `${u(1)} solid rgba(34, 197, 94, 0.3)`,
                  cursor: dec === "CONFIRM" ? "default" : "pointer",
                }}
                onClick={(e) => { e.stopPropagation(); void decide(m.id, "CONFIRM"); }}
              >
                {dec === "CONFIRM" ? "✓ Confirmed" : "Confirm"}
              </button>
              <button
                type="button"
                disabled={decidingId === m.id}
                style={{
                  fontSize: u(13),
                  padding: `${u(2)} ${u(8)}`,
                  borderRadius: u(4),
                  background: "rgba(239, 68, 68, 0.15)",
                  color: "#f87171",
                  border: `${u(1)} solid rgba(239, 68, 68, 0.3)`,
                  cursor: "pointer",
                }}
                onClick={(e) => { e.stopPropagation(); void decide(m.id, "REJECT"); }}
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** the Clips tab: the clips of the reels made from this video */
function ClipsTab({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws } = s;
  const dw = useDw();
  const videoId = ws?.video?.id ?? null;
  const [reels, setReels] = useState<Reel[] | null | undefined>(undefined);
  useEffect(() => { setReels(undefined); if (videoId) void api<Reel[]>(`/v1/reels?video_id=${videoId}`).then(setReels, () => setReels(null)); }, [videoId]);
  const msg = !videoId ? "Choose a video first." : reels === undefined ? "Loading clips…" : reels === null ? "The clips could not be loaded." : reels.every((r) => !r.clips.length) ? "No clips yet. Make a highlight reel of a player (Create Highlight Reel) and add moments to it." : null;
  if (msg) return <T x={2276 + dw / 2} y={480} size={20} color="#8ea3bf" align="center" style={{ maxWidth: u(460) }}>{msg}</T>;
  return (
    <div role="list" aria-label="Clips" data-clips={String(reels!.reduce((n, r) => n + r.clips.length, 0))} className="absolute" style={list_(dw)}>
      {reels!.filter((r) => r.clips.length).map((r) => (
        <div key={r.id}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: u(8), padding: `${u(6)} ${u(6)}`, fontSize: u(17), fontWeight: 700 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name} · {r.clips.length} clips</span>
            <Link href={`/reels/${r.id}`} style={{ color: "#33a8ff", fontWeight: 400, flex: "none" }}>{dict.body.analysis.openInReelBuilder}</Link>
          </div>
          {r.clips.map((c, i) => (
            <button key={c.id} type="button" role="listitem" data-clip={c.id} style={row} onClick={() => ws?.seek(c.in_pts_us)}>
              <span style={{ width: u(34), flex: "none", color: "#33a8ff", fontWeight: 700 }}>{i + 1}</span>
              <span style={{ width: u(130), flex: "none", color: "#9fb3cc" }}>{clock(c.in_pts_us)}–{clock(c.out_pts_us)}</span>
              <span style={{ minWidth: 0 }}>{c.label ?? "Clip"} <span style={{ color: "#8ea3bf" }}>· {Math.round(clipOutputUs(c) / 1e6)} s</span></span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

const PAGE = 40;
const code = (n: string | null | undefined) => teamCode(n);
const bars = (c: number | null) => (c === null ? 0 : c >= 0.85 ? 4 : c >= 0.7 ? 3 : c >= 0.5 ? 2 : 1);

function Players({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws, kits, match, team, setTeam, teams } = s;
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const dw = useDw();                                         // the panel's width change: the list and search widen, the right-hand columns stay at the right edge
  const finished = !!ws?.run;
  const all = useMemo(() => (ws?.tracks ?? []).filter((t) => isPerson(t) && t.observation_count >= 3).sort((a, b) => b.observation_count - a.observation_count), [ws?.tracks]);
  const inTeam = (t: TrackSummary, club: string) => assignmentOf(kits, t)?.club_id === club;
  const list = all.filter((t) => (team === "all" || inTeam(t, team)) && (!q.trim() || t.label.toLowerCase().includes(q.trim().toLowerCase())));
  const reason = !match ? "Link this video to a match first" : "Assign this team to a kit colour first (Analysis, Teams)";
  const chips: [string, string, string | null, number, number, boolean][] = [["All", "all", "all", 2034, 98, true],
    ["Home", "home", teams[0]?.club_id ?? null, 2148, 163, false], ["Away", "away", teams[1]?.club_id ?? null, 2328, 191, false]];
  return (
    <section aria-label="Players" data-section="p04-s09" data-players={String(list.length)}>
      <Box x={2015} y={117} w={522 + dw} h={763} />
      <div role="tablist" aria-label="Right panel">
        {([["Players (" + (finished ? (ws?.tracks ? all.length : "…") : "—") + ")", 2062, 160], ["Events", 2262, 120], ["Clips", 2431, 80]] as const).map(([l, x, w], i) => (
          <Hit key={l} x={x - 14} y={125} w={w} h={44} label={l} pressed={tab === i} onClick={() => setTab(i)}>
            <T o={[x - 14, 125]} x={x} y={145} size={i === 0 ? 25 : 24} weight={tab === i ? 700 : 400} color={tab === i ? "#33a8ff" : undefined} as="span">{l}</T>
          </Hit>
        ))}
      </div>
      <B x={[2035, 2245, 2415][tab]!} y={171} w={[171, 100, 90][tab]!} h={3} style={{ background: "#1e90ff" }} />

      {tab === 0 && (
        <>
          <B x={2033} y={188} w={487 + dw} h={40} style={{ border: `${u(1.5)} solid #17355f`, borderRadius: u(6), background: "#0a1d38" }} />
          <T x={2052} y={208} size={18}>🔍</T>
          <input aria-label="Search players" placeholder="Search players..." value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
            className="absolute" style={{ left: u(2080), top: u(190 - 101), width: u(430 + dw), height: u(36), border: 0, outline: 0, background: "transparent", color: "#dbe8f8", fontSize: u(18) }} />
          <div role="radiogroup" aria-label="Team">
            {chips.map(([n, key, club, x, w, a0]) => {
              const on = a0 ? team === "all" : !!club && team === club;
              const c = a0 ? finished ? String(all.length) : "—" : club && finished ? String(all.filter((t) => inTeam(t, club)).length) : "—";
              const usable = a0 || (!!club && all.some((t) => inTeam(t, club)));
              return (
                <Hit key={n} x={x} y={243} w={w} h={42} label={`${n}, ${c}`} pressed={on} {...(usable ? { onClick: () => setTeam(a0 ? "all" : club!) } : { reason })}
                  style={{ border: `${u(1.5)} solid ${on ? "#1e90ff" : "#17355f"}`, borderRadius: u(6), background: on ? "#0d3a78" : "#0a1d38", opacity: usable ? 1 : 0.7 }}>
                  {!a0 && <B o={[x, 243]} x={x + 12} y={254} w={22} h={22} style={{ borderRadius: "50%", background: key === "home" ? "#7ab6ff" : "#e8d9a0" }} />}
                  <T o={[x, 243]} x={x + (on ? 18 : 46)} y={264} size={19} weight={on ? 700 : 400} color={on ? "#33a8ff" : "#cfdcf0"} as="span">{n}</T>
                  <B o={[x, 243]} x={x + w - 48} y={254} w={36} h={22} style={{ background: "#12294a", borderRadius: u(4), fontSize: u(16), display: "flex", alignItems: "center", justifyContent: "center" }}>{c}</B>
                </Hit>
              );
            })}
          </div>
          {([["#", 2047, 0], ["Player", 2127, 0], ["Team", 2312, 1], ["Conf.", 2390, 1], ["Status", 2464, 1]] as const).map(([l, x, right]) => <T key={l} x={x + right * dw} y={321} size={17} color="#8ea3bf">{l}</T>)}

          {list.length === 0 && <T x={2276 + dw / 2} y={600} size={20} color="#8ea3bf" align="center">{!ws?.video ? "No players detected yet" : !finished ? "No players detected yet" : !ws.tracks ? "Reading the tracks…" : q ? "No player matches the search" : "No players for this team"}</T>}
          <div role="listbox" aria-label="Players" className="absolute" style={{ left: u(2028), top: u(343 - 101), width: u(496 + dw), height: u(527), overflowY: "auto" }}>
            {list.slice(0, shown).map((t) => {
              const on = t.track_id === ws?.selectedId, a = assignmentOf(kits, t);
              return (
                <div key={t.track_id} role="option" aria-selected={on} data-track={t.track_number} tabIndex={0}
                  onClick={() => { ws?.select(t.track_id); ws?.seek(t.first_pts_us); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ws?.select(t.track_id); ws?.seek(t.first_pts_us); } }}
                  style={{ position: "relative", height: u(52.7), cursor: "pointer", boxSizing: "border-box", border: `${u(2)} solid ${on ? "#1e90ff" : "transparent"}`, borderRadius: u(6), background: on ? "#0d3066" : "transparent" }}>
                  <span aria-hidden style={{ position: "absolute", left: u(17), top: u(16), width: u(20), height: u(20), boxSizing: "border-box", border: `${u(2)} solid ${on ? "#1a8cff" : "#4a6a96"}`, borderRadius: u(4),
                    background: on ? "#1a8cff" : "transparent", color: "#fff", fontSize: u(14), lineHeight: u(16), textAlign: "center" }}>{on ? "✓" : ""}</span>
                  <span style={{ position: "absolute", left: u(56), top: u(16), fontSize: u(18) }}>—</span>
                  <Thumb track={t} w={40} h={44} style={{ position: "absolute", left: u(94), top: u(4), borderRadius: "50%" }} />
                  <span style={{ position: "absolute", left: u(152), top: u(14), width: u(130 + dw), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: u(19), fontWeight: on ? 700 : 400 }} title={t.label}>{t.label.split(" · ")[0]}</span>
                  <span style={{ position: "absolute", left: u(292 + dw), top: u(12), minWidth: u(42), height: u(28), padding: `0 ${u(4)}`, boxSizing: "border-box", borderRadius: u(5), background: a?.club_id ? "#1580ff" : "#12294a",
                    fontSize: u(17), fontWeight: 700, textAlign: "center", lineHeight: u(28) }} title={a ? (a.club_name ?? "Not a team") : "Team not assigned yet"}>{a?.club_id ? code(a.club_name) : "—"}</span>
                  <span style={{ position: "absolute", left: u(364 + dw), top: u(16), fontSize: u(18) }}>{t.mean_confidence?.toFixed(2) ?? "—"}</span>
                  <span aria-hidden style={{ position: "absolute", left: u(446 + dw), top: u(14) }}>
                    {[1, 2, 3, 4].map((k) => <i key={k} style={{ position: "absolute", left: u((k - 1) * 8), bottom: u(-12), width: u(5), height: u(k * 5 + 2), background: k <= bars(t.mean_confidence) ? "#1a8cff" : "#1a2a44" }} />)}
                  </span>
                  <span style={{ position: "absolute", left: u(416 + dw), top: u(34), fontSize: u(12), color: "#8ea3bf", whiteSpace: "nowrap" }}>{t.identity_state === "UNRESOLVED" ? "unidentified" : t.identity_state.toLowerCase()}</span>
                </div>
              );
            })}
            {list.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} style={{ display: "block", margin: `${u(8)} auto`, padding: `${u(6)} ${u(14)}`, border: `${u(1.5)} solid #1f4a7a`, borderRadius: u(6), background: "#0a1d38", color: "#cfdcf0", fontSize: u(17), cursor: "pointer" }}>
                Show {Math.min(PAGE, list.length - shown)} more ({list.length - shown} left)
              </button>
            )}
          </div>
        </>
      )}
      {tab === 1 && <EventsTab s={s} />}
      {tab === 2 && <ClipsTab s={s} />}
    </section>
  );
}

function Inspector({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const { ws, kits } = s;
  const t = ws?.tracks?.find((x) => x.track_id === ws.selectedId) ?? null;
  const a = t ? assignmentOf(kits, t) : null;
  const [season, setSeason] = useState(false);
  const dw = useDw();
  const router = useRouter();
  const [identity, setIdentity] = useState<TrackIdentity | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [identifying, setIdentifying] = useState(false);
  const [props, setProps] = useState(false);                // B.6: the Properties card
  const trackId = t?.track_id ?? null, isBall = t?.class_name === "BALL";
  // the identity decision of the selected track: only a player a person CONFIRMED can have a reel
  useEffect(() => {
    setIdentity(null); setErr(null);
    if (trackId && !isBall) void api<TrackIdentity>(`/v1/tracks/${trackId}/identity`).then(setIdentity, () => setIdentity(null));
  }, [trackId, isBall, ws?.tracks]);
  const player = identity?.state === "CONFIRMED" ? identity.player : null;
  // the selected person's heat zones: measured pitch positions only (refreshed when calibrations change)
  // distance and top speed over the stretches where the person's position was measured (never estimated elsewhere)
  const calKey = ws?.pitch.list?.map((r) => `${r.id}:${r.status}`).join();
  const [move, setMove] = useState<Movement | null>(null);
  useEffect(() => {
    setMove(null);
    if (!ws?.run || !trackId || isBall) return;
    let live = true;
    void api<Movement>(`/v1/analysis-runs/${ws.run.id}/tracks/${trackId}/movement`).then((m) => { if (live) setMove(m); }, () => undefined);
    return () => { live = false; };
  }, [ws?.run, trackId, isBall, calKey]);
  const measuredFor = move && move.measured_s > 0 ? `over ${Math.round(move.measured_s)} s measured of ${Math.round(move.seen_s)} s seen` : null;
  // completed passes the engine found (ADR-040): the confirmed player's over all his tracks, else this track's
  const ev = ws?.events.data ?? null;
  const pass = ev?.ball_track_id && trackId && !isBall ? passesOf(ev, { player_id: player?.player_id ?? null, track_ids: [trackId] }) : null;
  const won = pass ? ballWonBy(ev, { player_id: player?.player_id ?? null, track_ids: [trackId!] }) : null;
  const pressed = pass ? pressuresBy(ev, { player_id: player?.player_id ?? null, track_ids: [trackId!] }) : null;
  const kpiValue: Record<string, [string, string] | undefined> = {
    Passes: pass ? [String(pass.made), `Completed passes found by the engine ${ev?.match_time ? "in match time" : "in the video"}${player ? ` for ${player.display_name}` : " for this track (say who he is to count all his tracks)"}: ${pass.made} made, ${pass.received} received${pass.metres !== null ? `, ${pass.metres} m in total where the pitch is measured` : ""}. One-touch passes and passes where the ball is hidden are not counted.`] : undefined,
    Distance: move?.distance_m != null ? [`${move.distance_m} m`, `Distance ${measuredFor}${move.dropped_steps ? `; ${move.dropped_steps} impossible steps dropped as measurement errors` : ""}`] : undefined,
    "Top Speed": move?.top_speed_kmh != null ? [`${move.top_speed_kmh} km/h`, `Fastest pace held for two seconds ${measuredFor}; positions smoothed over a second. ${move.sprints} sprint${move.sprints === 1 ? "" : "s"} (${move.sprint_m ?? 0} m), ${move.high_speed_m ?? 0} m at high speed`] : undefined,
  };
  const heat = useHeatZones(ws?.run && trackId && !isBall ? `/v1/analysis-runs/${ws.run.id}/tracks/${trackId}/heat-zones` : null, ws?.pitch.list?.map((r) => `${r.id}:${r.status}`).join());
  const createReel = () => {
    if (!ws?.video || !player) return;
    setBusy(true); setErr(null);
    void api<{ id: string }>("/v1/reels", { method: "POST", json: { video_id: ws.video.id, player_id: player.player_id } })
      .then((x) => router.push(`/reels/${x.id}`), (x) => setErr(x instanceof ApiProblem ? x.message : "The reel could not be created."))
      .finally(() => setBusy(false));
  };
  const kpi: [string, number, number][] = ([["Distance", 2029, 115], ["Top Speed", 2155, 116], ["Passes", 2282, 115], ["Key Passes", 2407, 115]] as [string, number, number][])
    .map(([l, x, w], i) => [l, x + (i * dw) / 4, w + dw / 4]);                // the four tiles share the extra width
  const NM = "Not measured: needs calibrated pitch positions and event detection";
  return (
    <section aria-label="Selected player" data-section="p04-s10" data-selected-track={t?.track_number ?? ""}>
      <Box x={2015} y={898} w={522 + dw} h={520} />
      {t ? <Thumb track={t} w={110} h={128} style={{ position: "absolute", left: u(2029), top: u(912 - 101), borderRadius: u(6) }} />
        : <B x={2029} y={912} w={110} h={128} style={{ borderRadius: u(6), background: "linear-gradient(135deg,#5a6f8c,#2a4a78)" }} />}
      {/* B.6 (ADR-084): the picture opens everything recorded about the track */}
      <Hit x={2029} y={912} w={110} h={128} label="Properties: everything recorded about this track" {...(t ? { onClick: () => setProps(true) } : { reason: "Select a player first" })}
        style={{ borderRadius: u(6) }}>
        {t && <span data-props-open style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: u(24), background: "rgba(5,15,32,.82)", color: "#cfe3ff", fontSize: u(14), fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", borderRadius: `0 0 ${u(6)} ${u(6)}` }}>ⓘ Properties</span>}
      </Hit>
      <div title="Jersey number: not read yet"><B x={2157} y={917} w={39} h={32} style={{ background: "#1580ff", borderRadius: u(4), fontSize: u(22), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>—</B></div>
      <T x={2214} y={931} size={26} weight={700} as="h2" style={{ maxWidth: u((t && !isBall ? 150 : 260) + dw), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t ? t.label.split(" · ")[0] : "No player selected"}</T>
      {ws?.video && t && !isBall && (
        <button type="button" data-identify onClick={() => setIdentifying(true)} title={player ? `Identity of ${player.display_name}: decisions, shirt number, other tracks` : "Say who this player is"}
          style={{ position: "absolute", left: u(2372 + dw), top: u(914 - 101), height: u(34), padding: `0 ${u(12)}`, borderRadius: u(17), border: 0, cursor: "pointer",
            background: player ? "#0a2a55" : "#1580ff", color: player ? "#8fc4ff" : "#fff", fontFamily: "inherit", fontSize: u(17), fontWeight: 700, whiteSpace: "nowrap" }}>
          {player ? "Identity" : "Identify ›"}</button>
      )}
      <Hit x={2470 + dw} y={915} w={40} h={32} label="Clear the selection" {...(t && ws ? { onClick: () => ws.select(null) } : { reason: "Nothing selected" })}>
        <T o={[2470, 915]} x={2493} y={931} size={24} color="#8ea3bf" as="span">✕</T>
      </Hit>
      <B x={2162} y={960} w={32} h={32} style={{ borderRadius: "50%", background: a?.club_id ? "#7ab6ff" : "#34445c" }} />
      <T x={2214} y={973} size={20} color="#cfdcf0" style={{ maxWidth: u(150), overflow: "hidden", textOverflow: "ellipsis" }}>{t ? `Team ${a ? (a.club_name ?? "none") : "—"}` : "Team —  |"}</T>
      <B x={2378} y={962} w={22} h={22} style={{ background: "#3a5a88" }} />
      <T x={2406} y={973} size={20} color="#cfdcf0">Nationality —</T>
      {([["Position —", 2158, 105], ["Foot —", 2279, 104], ["Age —", 2399, 81]] as const).map(([l, x, w]) => (
        <B key={l} x={x} y={1002} w={w} h={36} style={{ border: `${u(1.5)} solid #1f4a7a`, borderRadius: u(5), background: "#0a1d38", fontSize: u(18), display: "flex", alignItems: "center", justifyContent: "center" }}>{l}</B>
      ))}
      {kpi.map(([l, x, w]) => (
        <div key={l} title={kpiValue[l]?.[1] ?? (l === "Distance" || l === "Top Speed" || (l === "Passes" && ev?.ball_track_id) ? (t && !isBall ? (move ? "No position measured for this player yet" : "Measuring…") : "Select a player") : NM)} data-kpi={l}>
          <B x={x} y={1055} w={w} h={103} style={{ border: `${u(1.5)} solid #17355f`, borderRadius: u(6), background: "#071a33" }} />
          <T x={x + 10} y={1075} size={16} color="#b3c4dc">{l}</T>
          <B x={x + 10} y={1098} w={26} h={26} style={{ border: `${u(2)} solid #19a0ff`, borderRadius: "50%" }} />
          <T x={x + 44} y={1109} size={20} weight={700}>{kpiValue[l]?.[0] ?? "—"}</T>
        </div>
      ))}
      {t ? (
        <div data-ball-won={won ?? ""} title={won !== null ? `Times the engine saw ${player ? player.display_name : "this track"} win the ball from the other team (tackles, interceptions and loose balls alike), and press the other team's player on the ball` : undefined}>
          <T x={2031} y={1169} size={15} color="#8ea3bf" style={{ maxWidth: u(490 + dw), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {`Seen ${clock(t.first_pts_us)}–${clock(t.last_pts_us)} · ${t.observation_count} detections · conf ${t.mean_confidence?.toFixed(2) ?? "—"}${won !== null ? ` · ball won ${won} · pressures ${pressed}` : ""}`}</T>
        </div>
      ) : <T x={2031} y={1169} size={15} color="#8ea3bf">{dict.body.analysis.clickBox}</T>}
      <IdentifyDialog open={identifying} onOpenChange={setIdentifying} />
      <PropertiesDialog s={s} track={t} open={props} onOpenChange={setProps} />
      <div data-create-reel>
        <B x={2031} y={1356} w={489 + dw} h={56} style={{ borderRadius: u(8), border: `${u(1.5)} solid ${player ? "#1f8cff" : "#1f5a9c"}`, background: player ? "#0a4aa8" : "#0a2a55", opacity: player && !busy ? 1 : 0.8 }} />
        <Ic x={2090} y={1384} k="reel" size={30} color={player ? "#fff" : "#8fc4ff"} />
        <T x={2132} y={1372} size={22} weight={700} color={player ? "#fff" : "#33a8ff"}>{dict.body.analysis.createReel}</T>
        <T x={2132} y={1397} size={15} color={err ? "#ff8a8a" : player ? "#cfe3ff" : "#8ea3bf"} style={{ maxWidth: u(380 + dw), overflow: "hidden", textOverflow: "ellipsis" }}>
          {err ?? (player ? `for ${player.display_name}` : !t ? "select a player first" : isBall ? "select a player, not the ball" : "first say who this player is (click)")}</T>
        <Hit x={2031} y={1356} w={489 + dw} h={56} label="Create highlight reel" {...(player && !busy ? { onClick: createReel } : t && !isBall && !player ? { onClick: () => setIdentifying(true) }
            : { reason: player ? "Creating…" : !t ? "Select a player on the video or in the list first" : "Select a player, not the ball" })} />
      </div>
      <B x={2031} y={1178} w={241 + dw / 2} h={166} style={{ background: "#1a4a2a", border: `${u(2)} solid #cfe3d8` }} />
      {heat.zones && heat.zones.measured_s > 0 ? (
        <div data-player-heat style={{ position: "absolute", left: u(2033), top: u(1180 - 101), width: u(237 + dw / 2), height: u(162) }}>
          <div style={{ width: "100%", height: u(140) }}><HeatPitch zones={heat.zones} label={`Heat map of ${t?.label.split(" · ")[0] ?? "the player"}`} /></div>
          <div style={{ fontSize: u(12), color: "#cfe3d8", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title="Teams change ends at half-time: both halves are drawn as filmed">{measuredText(heat.zones)}</div>
        </div>
      ) : (
        <>
          <T x={2151 + dw / 4} y={1250} size={18} color="#cfe3d8" align="center">{heat.loading ? "Loading…" : "No heatmap"}</T>
          <T x={2151 + dw / 4} y={1274} size={13} color="#9fbfa8" align="center">{!t || isBall ? "select a player" : heat.zones ? "no pitch position measured for this player yet" : "needs pitch positions"}</T>
        </>
      )}
      <B x={2288 + dw / 2} y={1177} w={232 + dw / 2} h={34} style={{ border: `${u(1.5)} solid #17355f`, borderRadius: u(5), background: "#0a1d38" }} />
      <B x={(season ? 2288 : 2404 + dw / 4) + dw / 2} y={1177} w={116 + dw / 4} h={34} style={{ background: "#0d4aa0", borderRadius: season ? `${u(5)} 0 0 ${u(5)}` : `0 ${u(5)} ${u(5)} 0` }} />
      <Hit x={2288 + dw / 2} y={1177} w={116 + dw / 4} h={34} label="Season" reason={notBuilt("season statistics")}><T o={[2288, 1177]} x={2325} y={1194} size={16} color="#8ea3bf" as="span">Season</T></Hit>
      <Hit x={2404 + (3 * dw) / 4} y={1177} w={116 + dw / 4} h={34} label="Match" pressed={!season} onClick={() => setSeason(false)}><T o={[2404, 1177]} x={2440} y={1194} size={17} weight={700} as="span">Match</T></Hit>
      {([
        ["Touches", "Not measured: requires full-match ball-touch sensor tracking."],
        ["Pass Accuracy", "Not measured: incomplete passes without possession change are not tracked."],
        ["Chances Created", "Not measured: requires calibrated pass events directly assisting verified shots."],
        ["Shot Assists", "Not measured: requires calibrated pass events directly assisting verified shots."],
        ["Progressive Passes", "Not measured: requires calibrated pitch coordinates for pass start and reception (>= 30m in defensive 1/3, >= 15m in middle 1/3, >= 10m into box)."],
      ] as const).map(([l, reason], i) => (
        <div key={l} title={reason} data-unconfirmed-metric={l}>
          <T x={2292 + dw / 2} y={[1228, 1255, 1282, 1309, 1336][i]!} size={18} color="#cfdcf0">{l}</T>
          <T x={2482 + dw} y={[1228, 1255, 1282, 1309, 1336][i]!} size={18}>—</T>
        </div>
      ))}
    </section>
  );
}

export function PlayersPanel({ s }: { s: Shared }) {
  return (
    <>
      <Players s={s} />
      <Inspector s={s} />
    </>
  );
}
