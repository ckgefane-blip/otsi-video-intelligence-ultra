"use client";
/**
 * Page 04 Sections 07-08 — event chips and Tracks & Presence (approved reference 04_ANALYSIS_WORKSPACE, centre bottom).
 *
 * Events are found by the engine from its ball (ADR-040-042): passes, key passes, the ball won from the other team, shots and pressures. The chips
 * filter them (All Events, or one kind) and count them in match time; each shows as a mark above the lanes (a mark seeks to just before
 * it and selects the player who did it, so he can be identified for a reel; the selected player's are white) and Previous / Next under
 * the lanes steps through the ones shown. Tackles and interceptions are the balls won that the engine's rule reads as one or the other
 * (ADR-041): "possible", about half right by eye; they stay in Ball Won too. Goals come from the broadcast scoreboard (ADR-049); a possible
 * foul is a free kick or penalty the engine found (ADR-048: play stopped just before). Cards are not measured. Chips of kinds not detected
 * show "—" with the reason.
 * The line under the lanes gives the passes and each team's possession. Tracks &
 * Presence draws the people tracks of the latest finished run (the selected one first, then the longest of the chosen team): a bar from
 * the first to the last time the track was seen, and for the selected track the exact spans with gaps shown as gaps (observations of
 * the run). A row selects its track and jumps to where it first appears; clicking a lane seeks. The playhead crosses all lanes.
 * Team shapes need calibrated pitch positions, so those rows are listed and disabled.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { MatchEvents, Observation } from "@otsi-vie/contracts";
import { B, T, u } from "@/components/stage/DesignStage";
import { Box } from "@/components/tactics/kit";
import { clock, Hit, isPerson, type Shared } from "./shared";
import { useDw } from "./ResizableColumns";
import type { PeriodsState } from "./Periods";
import { eventsLine, teamName } from "./Events";
import { notBuilt } from "@/lib/devMode";
import { EngineLanes, useLanes } from "./EngineLanes";
import { getDictionary, useLocale, type Dictionary } from "@/lib/i18n";

/** [kind code, translated chip label, x, width] — the code is a lookup key and stays English; only the label translates. */
const CHIPS = (d: Dictionary): [Kind | "Cards", string, number, number][] => [
  ["Goals", d.body.workspace.chipGoals, 610, 135], ["Passes", d.body.workspace.chipPasses, 762, 168],
  ["Key Passes", d.body.workspace.chipKeyPasses, 945, 177], ["Shots", d.body.workspace.chipShots, 1137, 143],
  ["Tackles", d.body.workspace.chipTackles, 1298, 152], ["Interceptions", d.body.workspace.chipInterceptions, 1467, 204],
  ["Fouls", d.body.workspace.chipFouls, 1685, 138], ["Cards", d.body.workspace.chipCards, 1837, 137],
  ["Ball Won", d.body.workspace.chipBallWon, 1990, 170], ["Pressures", d.body.workspace.chipPressures, 2176, 180],
  ["Set Pieces", d.body.workspace.chipSetPieces, 2372, 192]];
const LEGEND = (d: Dictionary): [string, number, string][] => [
  [d.body.workspace.chipGoals, 1308, "#a066ff"], [d.body.workspace.chipShots, 1327, "#19d3ff"],
  [d.body.workspace.chipKeyPasses, 1346, "#19e6c0"], [d.body.workspace.chipPasses, 1364, "#7ae85a"],
  [d.body.workspace.duelsLabel, 1382, "#ffb21a"], [d.body.workspace.defensiveActions, 1401, "#ff4a4a"]];
const CHIPS_END = 2580;                                   // the last chip (Set Pieces, owner 2026-11-02) ends at 2564; a 16 px margin
const X0 = 650, X1_0 = 1940, ROWS = 7;                   // lanes from X0 to X1 (X1 follows the centre column's width)

/** an event on the timeline: when, who took part, and one line about it */
export type Kind = "Goals" | "Fouls" | "Passes" | "Key Passes" | "Ball Won" | "Tackles" | "Interceptions" | "Shots" | "Pressures" | "Set Pieces";
export interface Mark {
  kind: Kind;
  id: string;
  at: number;
  end: number;
  tracks: (string | null)[];
  detail: string;
  decision?: string | null;
  reviewer_id?: string | null;
}
export const KIND = (d: Dictionary): Record<Kind, { color: string; noun: string; plural: string; lead: number }> => ({
  Goals: { color: "#a066ff", noun: d.body.workspace.goalNoun, plural: d.body.workspace.goalsNoun, lead: 0 },              // the goal's span is already the attack before it
  Fouls: { color: "#ffd84a", noun: d.body.workspace.possibleFoul, plural: d.body.workspace.possibleFouls, lead: 6_000_000 },   // the stoppage: the foul is in the seconds before
  Passes: { color: "#7ae85a", noun: d.body.workspace.passNoun, plural: d.body.workspace.passesNoun, lead: 2_000_000 },
  "Key Passes": { color: "#19e6c0", noun: d.body.workspace.keyPass, plural: d.body.workspace.keyPasses, lead: 2_000_000 },
  "Ball Won": { color: "#ff4a4a", noun: d.body.workspace.ballWon, plural: d.body.workspace.ballsWon, lead: 3_000_000 },   // at_us is when the winner has it: start before the duel
  Tackles: { color: "#ff7a45", noun: d.body.workspace.possibleTackle, plural: d.body.workspace.possibleTackles, lead: 3_000_000 },
  Interceptions: { color: "#ffa04a", noun: d.body.workspace.possibleInterception, plural: d.body.workspace.possibleInterceptions, lead: 3_000_000 },
  Shots: { color: "#19d3ff", noun: d.body.workspace.shotNoun, plural: d.body.workspace.shotsNoun, lead: 3_000_000 },
  Pressures: { color: "#ffb21a", noun: d.body.workspace.pressureNoun, plural: d.body.workspace.pressuresNoun, lead: 2_000_000 },
  "Set Pieces": { color: "#e0e0ff", noun: d.body.workspace.setPiece, plural: d.body.workspace.setPieces, lead: 3_000_000 },
});
const seen = (e: string, d: Dictionary) => (e === "DETECTED" ? d.body.workspace.ballSeenBothEnds : d.body.workspace.ballPartlyInferred);
const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);

export function marksOf(ev: MatchEvents | null, d?: Dictionary): Record<Kind, Mark[]> {
  const dict = d ?? getDictionary("en");
  const SET_PIECE: Record<string, string> = { KICK_OFF: dict.body.workspace.kickOffLower, PENALTY: dict.body.workspace.penaltyLower, CORNER: dict.body.workspace.cornerLower, GOAL_KICK: dict.body.workspace.goalKick, THROW_IN: dict.body.workspace.throwInLower, FREE_KICK: dict.body.workspace.freeKick };
  const passes = (ev?.passes ?? []).map((p): Mark => ({ kind: p.key ? "Key Passes" : "Passes", id: p.id, at: p.start_us, end: p.end_us, tracks: [p.from_track_id, p.to_track_id],
    detail: `${p.length_m !== null ? `${p.length_m} m · ` : ""}${seen(p.evidence, dict)}`, decision: p.decision, reviewer_id: p.reviewer_id }));
  const team = (k: number | null) => { const i = ev?.teams.findIndex((t) => t.kit_group === k) ?? -1; return i >= 0 ? teamName(ev!.teams[i]!, i, dict) : dict.body.workspace.otherTeam; };
  return {
    Goals: (ev?.goals ?? []).map((g): Mark => ({ kind: "Goals", id: g.id, at: g.start_us, end: g.end_us, tracks: [g.track_id],
      detail: dict.body.workspace.goalDetail.replace("{a}", String(g.score[0])).replace("{b}", String(g.score[1])).replace("{c}", g.set_piece ? dict.body.workspace.goalAfterSetPiece.replace("{a}", SET_PIECE[g.set_piece] ?? dict.body.workspace.setPiece) : "").replace("{d}", g.track_id ? dict.body.workspace.possibleScorer.replace("{a}", team(g.kit_group)) : dict.body.workspace.scorerNotClear),
      decision: g.decision, reviewer_id: g.reviewer_id })),
    // a free kick or a penalty means play was stopped for a foul (or an offside) just before: a possible foul, for a person to check
    Fouls: (ev?.set_pieces ?? []).filter((x) => x.kind === "FREE_KICK" || x.kind === "PENALTY").map((x): Mark => ({ kind: "Fouls", id: `foul-${x.id}`, at: x.dead_from_us,
      end: x.at_us, tracks: [x.track_id], detail: dict.body.workspace.foulDetail.replace("{a}", SET_PIECE[x.kind!] ?? dict.body.workspace.setPiece).replace("{b}", x.kit_group !== null ? dict.body.workspace.foulToTeam.replace("{a}", team(x.kit_group)) : ""),
      decision: x.decision, reviewer_id: x.reviewer_id })),
    Passes: passes,
    "Key Passes": passes.filter((m) => m.kind === "Key Passes"),
    "Ball Won": (ev?.changes ?? []).map((c): Mark => ({ kind: "Ball Won", id: c.id, at: c.at_us, end: c.at_us, tracks: [c.won_track_id, c.lost_track_id], detail: dict.body.workspace.wonBy.replace("{a}", team(c.to_kit_group)),
      decision: c.decision, reviewer_id: c.reviewer_id })),
    Tackles: (ev?.changes ?? []).filter((c) => c.how === "TACKLE").map((c): Mark => ({ kind: "Tackles", id: c.id, at: c.at_us, end: c.at_us, tracks: [c.won_track_id, c.lost_track_id],
      detail: dict.body.workspace.wonAtFeet.replace("{a}", team(c.to_kit_group)), decision: c.decision, reviewer_id: c.reviewer_id })),
    Interceptions: (ev?.changes ?? []).filter((c) => c.how === "INTERCEPTION").map((c): Mark => ({ kind: "Interceptions", id: c.id, at: c.at_us, end: c.at_us, tracks: [c.won_track_id, c.lost_track_id],
      detail: dict.body.workspace.cutOutFlight.replace("{a}", team(c.to_kit_group)), decision: c.decision, reviewer_id: c.reviewer_id })),
    Shots: (ev?.shots ?? []).map((x): Mark => ({ kind: "Shots", id: x.id, at: x.at_us, end: x.at_us + 1_000_000, tracks: [x.track_id],
      detail: [x.speed_ms !== null ? dict.body.workspace.shotSpeedKmh.replace("{a}", String(Math.round(x.speed_ms * 3.6))) : null, x.distance_m !== null ? dict.body.workspace.shotDistanceM.replace("{a}", String(x.distance_m)) : null].filter(Boolean).join(" · "),
      decision: x.decision, reviewer_id: x.reviewer_id })),
    Pressures: (ev?.pressures ?? []).map((x): Mark => ({ kind: "Pressures", id: x.id, at: x.start_us, end: x.end_us, tracks: [x.presser_track_id, x.pressed_track_id],
      detail: dict.body.workspace.pressureDetail.replace("{a}", team(x.kit_group)).replace("{b}", x.regain ? dict.body.workspace.ballWonBack5s : dict.body.workspace.ballNotWonBack), decision: x.decision, reviewer_id: x.reviewer_id })),
    "Set Pieces": (ev?.set_pieces ?? []).map((x): Mark => ({ kind: "Set Pieces", id: x.id, at: x.at_us, end: x.at_us + 1_000_000, tracks: [x.track_id],
      detail: dict.body.workspace.setPieceDetail.replace("{a}", x.kind ? (SET_PIECE[x.kind] ?? dict.body.workspace.setPiece) : dict.body.workspace.kindNotMeasured).replace("{b}", x.kit_group !== null ? dict.body.workspace.setPieceTakenBy.replace("{a}", team(x.kit_group)) : ` ${dict.body.workspace.takerNotClear}`).replace("{c}", String(Math.round((x.at_us - x.dead_from_us) / 1e6))),
      decision: x.decision, reviewer_id: x.reviewer_id })),
  };
}

/** every event once, in time order (a key pass is a pass: listed once); the timeline's "All Events" and the right panel's Events tab */
export const allMarks = (m: Record<Kind, Mark[]>) => [...m.Passes, ...m["Ball Won"], ...m.Shots, ...m.Pressures, ...m["Set Pieces"], ...m.Goals].sort((a, b) => a.at - b.at);

export function TimelinePanel({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const NOT_DETECTED = notBuilt(dict.body.workspace.eventDetectionLower);
  const WHY: Record<string, string> = {
    Goals: dict.body.workspace.noneGoal,
    Tackles: dict.body.workspace.noneTackle,
    Interceptions: dict.body.workspace.noneInterception,
    Shots: dict.body.workspace.noneShot,
    "Key Passes": dict.body.workspace.noneKeyPass,
    "Ball Won": dict.body.workspace.noneBallChange,
    "Set Pieces": dict.body.workspace.noneSetPiece,
    Fouls: dict.body.workspace.noneFoul,
    Cards: dict.body.workspace.notMeasuredCards,
    Pressures: dict.body.workspace.nonePressure,
  };
  const { ws, teamGroups } = s;
  const dw = useDw();
  const X1 = X1_0 + dw;
  const dur = ws?.video?.duration_us ?? null, t = ws?.timeUs ?? 0;
  const tracks = ws?.tracks ?? null, selectedId = ws?.selectedId ?? null;
  const rows = useMemo(() => {
    const list = (tracks ?? []).filter((x) => isPerson(x) && (!teamGroups || teamGroups.has(x.kit_group ?? -1)))
      .sort((a, b) => b.observation_count - a.observation_count);
    const chosen = list.find((x) => x.track_id === selectedId) ?? (tracks ?? []).find((x) => x.track_id === selectedId && isPerson(x));
    return (chosen ? [chosen, ...list.filter((x) => x !== chosen)] : list).slice(0, ROWS);
  }, [tracks, teamGroups, selectedId]);

  // exact observed spans of the selected track only (gaps stay gaps); the others show first-to-last seen
  const [obs, setObs] = useState<Observation[] | null>(null);
  const observationsOf = ws?.observationsOf;
  useEffect(() => {
    setObs(null);
    if (selectedId && observationsOf) void observationsOf(selectedId).then(setObs, () => setObs(null));
  }, [selectedId, observationsOf]);
  const interval = ws?.intervalUs ?? 1_000_000;
  const spans = useMemo(() => {
    const out: [number, number][] = [];
    for (const o of obs ?? []) {
      const last = out[out.length - 1];
      if (last && o.pts_us - last[1] <= interval * 1.5) last[1] = o.pts_us; else out.push([o.pts_us, o.pts_us]);
    }
    return out;
  }, [obs, interval]);

  // the chip strip: no scrollbar over the chips (it covered them and the time labels, owner 2026-11-01); the mouse wheel scrolls it
  // sideways and a fade at an edge says more chips are there
  const [strip, setStrip] = useState<HTMLDivElement | null>(null);       // state, not a ref: the strip element is replaced when the page reloads its data
  const [more, setMore] = useState<[boolean, boolean]>([false, false]);
  useEffect(() => {
    const el = strip;
    if (!el) return;
    const edges = () => setMore([el.scrollLeft > 1, el.scrollLeft + el.clientWidth < el.scrollWidth - 1]);
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY; e.preventDefault();
    };
    edges();
    el.addEventListener("scroll", edges);
    el.addEventListener("wheel", wheel, { passive: false });
    const ro = new ResizeObserver(edges); ro.observe(el);
    const inner = el.firstElementChild;
    if (inner) ro.observe(inner);
    return () => { el.removeEventListener("scroll", edges); el.removeEventListener("wheel", wheel); ro.disconnect(); };
  }, [strip, dw]);
  const per = ws?.periods;
  const [lo, hi] = dur && per ? per.window(dur) : [0, dur ?? 0];
  // stable across playhead moves, so the memoised PeriodBar below does not re-render on every tick
  const x = useCallback((us: number) => X0 + (hi > lo ? Math.min(1, Math.max(0, (us - lo) / (hi - lo))) : 0) * (X1 - X0), [lo, hi, X1]);
  const usAt = useCallback((clientX: number, el: Element) => { const r = el.getBoundingClientRect(); return lo + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (hi - lo); }, [lo, hi]);
  const finished = !!ws?.run;
  const ev = ws?.events.data ?? null;
  const marks = useMemo(() => marksOf(ev, dict), [ev]);
  const [filter, setFilter] = useState<Kind | null>(null);                     // null: All Events
  // the marks shown: one kind, or all of them (a key pass is a pass: shown once, in its own colour)
  const shown = useMemo(() => (filter ? marks[filter] : allMarks(marks)), [marks, filter]);
  // the marks inside the window shown: memoised so the lane does not re-filter them on every playhead move
  const visibleMarks = useMemo(() => shown.filter((m) => m.at >= lo && m.at <= hi), [shown, lo, hi]);
  // stepping through the events shown, one by one: memoised, so the three scans do not run on every playhead move
  const nav = useMemo(() => {
    const lead = (m: Mark) => KIND(dict)[m.kind].lead;                                 // start playing a moment before it
    // the latest event the playhead has reached (two a few seconds apart: the second, once the video is at it)
    const at = shown.findLastIndex((m) => t >= m.at - lead(m) - 300_000 && t <= m.end + 3_000_000);
    const next = shown.findIndex((m) => m.at - lead(m) > t + 300_000);
    const prev = [...shown].reverse().find((m) => m.at - lead(m) < t - 1_000_000 && shown.indexOf(m) !== at);
    return { at, next, prev, cur: at >= 0 ? shown[at]! : null };
  }, [shown, t]);
  // watch an event: a moment before it, with the player who did it (the passer, the winner, the presser, the shooter) selected
  const watch = (m: Mark) => {
    if (!ws) return;
    if (m.tracks[0]) ws.select(m.tracks[0]);
    ws.seek(Math.max(0, m.at - KIND(dict)[m.kind].lead));
  };
  const empty = !finished || rows.length === 0;
  // B.3 (ADR-082): the rows show the players' tracks, or the engine's lanes (shots, ball, pitch, the selected player, markers)
  const [mode, setMode] = useState<"players" | "engine">("players");
  const { lanes, setMarkers } = useLanes(ws?.video?.id ?? null, ws?.run?.id ?? null);
  const selRow = (tracks ?? []).find((x) => x.track_id === selectedId);

  return (
    <section aria-label={dict.body.workspace.eventsAndTracks} data-section="p04-s07" data-lanes={String(rows.length)}>
      <Box x={414} y={935} w={1580 + dw} h={483} />
      {/* the chips keep their size: in a narrower centre the strip scrolls sideways instead of running under the players panel */}
      <div ref={setStrip} role="group" aria-label={dict.body.workspace.eventFilter} data-chip-strip className="absolute" style={{ left: u(414), top: u(945 - 101), width: u(1580 + dw), height: u(48), overflowX: "auto", overflowY: "hidden", scrollbarWidth: "none" }}>
       <div className="absolute" style={{ left: u(-414), top: u(-(945 - 101)), width: u(CHIPS_END), height: u(1) }}>
        <Hit x={432} y={947} w={149} h={42} label={dict.body.workspace.allEventsHint} pressed={!filter} onClick={() => setFilter(null)}
          style={{ border: `${u(1.5)} solid ${!filter ? "#1e90ff" : "#1f4a7a"}`, borderRadius: u(6), background: !filter ? "#0d3a78" : "#0a1d38", color: "#33a8ff" }}>
          <B o={[432, 947]} x={446} y={957} w={22} h={22} style={{ borderRadius: "50%", background: "#33a8ff" }} />
          <T o={[432, 947]} x={476} y={968} size={19} color="#33a8ff" as="span">{dict.body.analysis.allEvents}</T>
        </Hit>
        {CHIPS(dict).map(([n, chipLabel, cx, w]) => n in KIND(dict) && marks[n as Kind].length ? (() => {
          const k = n as Kind, on = filter === k, c = KIND(dict)[k].color;
          return (
            <Hit key={n} x={cx} y={947} w={w} h={42} label={dict.body.workspace.chipFound.replace("{a}", chipLabel).replace("{b}", String(marks[k].length)).replace("{c}", on ? dict.body.workspace.showAllEvents : dict.body.workspace.showOnlyThese)} pressed={on} onClick={() => setFilter(on ? null : k)}
              style={{ border: `${u(1.5)} solid ${on ? c : "#2a5a8a"}`, borderRadius: u(6), background: on ? "#123a2c" : "#0a1d38", color: "#e6f7e0" }}>
              <B o={[cx, 947]} x={cx + 14} y={957} w={22} h={22} style={{ borderRadius: "50%", background: c }} />
              <T o={[cx, 947]} x={cx + 44} y={968} size={19} color="#e6f7e0" as="span">{chipLabel}</T>
              <B o={[cx, 947]} x={cx + w - 52} y={954} w={46} h={28} style={{ background: "#1d4a3e", borderRadius: u(4), fontSize: u(16), display: "flex", alignItems: "center", justifyContent: "center" }}>{marks[k].length}</B>
            </Hit>
          );
        })() : (
          <Hit key={n} x={cx} y={947} w={w} h={42} label={dict.body.workspace.chipNoneDetected.replace("{a}", chipLabel)} reason={(ev?.ball_track_id && WHY[n]) || NOT_DETECTED}
            style={{ border: `${u(1.5)} solid #1f4a7a`, borderRadius: u(6), background: "#0a1d38", color: "#cfdcf0", opacity: 0.85 }}>
            <B o={[cx, 947]} x={cx + 14} y={957} w={22} h={22} style={{ borderRadius: "50%", background: "#2a4f80" }} />
            <T o={[cx, 947]} x={cx + 44} y={968} size={19} color="#cfdcf0" as="span">{chipLabel}</T>
            <B o={[cx, 947]} x={cx + w - 36} y={954} w={30} h={28} style={{ background: "#12294a", borderRadius: u(4), fontSize: u(17), display: "flex", alignItems: "center", justifyContent: "center" }}>—</B>
          </Hit>
        ))}
       </div>
      </div>
      {more[0] && <div aria-hidden className="absolute" style={{ left: u(414), top: u(945 - 101), width: u(40), height: u(48), pointerEvents: "none", background: "linear-gradient(90deg, #0a1730, transparent)" }} />}
      {more[1] && <div aria-hidden data-chip-more className="absolute" style={{ left: u(414 + 1580 + dw - 40), top: u(945 - 101), width: u(40), height: u(48), pointerEvents: "none", background: "linear-gradient(270deg, #0a1730, transparent)" }} />}

      <B x={424} y={1022} w={207} h={41} style={{ border: `${u(1.5)} solid #1f4a7a`, borderRadius: u(6), background: "#0a1d38" }} />
      <T x={440} y={1043} size={20} weight={700} as="h3">{mode === "players" ? dict.body.analysis.tracksPresence : dict.body.workspace.engineLanes}</T>
      <div role="radiogroup" aria-label={dict.body.workspace.lanesLabel} className="absolute" style={{ left: u(424), top: u(997 - 101), display: "flex", gap: u(4), zIndex: 2 }}>
        {([["players", dict.body.analysis.players], ["engine", dict.body.workspace.engineLanes]] as const).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} data-lanes-mode={k} onClick={() => setMode(k)}
            title={k === "engine" ? dict.body.workspace.shotsCutsPitch : dict.body.workspace.playersTracks}
            style={{ height: u(20), padding: `0 ${u(8)}`, fontSize: u(13), fontFamily: "inherit", whiteSpace: "nowrap", lineHeight: 1, borderRadius: u(4), cursor: "pointer", color: "#fff",
              border: `${u(1)} solid ${mode === k ? "#33a8ff" : "#1f4a7a"}`, background: mode === k ? "#0f4f9a" : "#0a1d38" }}>{l}</button>
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => <T key={i} x={X0 + i * ((X1 - X0 - 50) / 6)} y={1018} size={17} color="#cfdcf0">{dur ? clock(lo + ((hi - lo) * i) / 6) : "—"}</T>)}
      {dur && per?.shown.first && <PeriodBarMemo per={per} x={x} usAt={usAt} canEdit={!!ws?.canWrite} X1={X1} />}
      {mode === "players" && empty && <T x={1200 + dw / 2} y={1180} size={18} color="#8ea3bf" align="center">{ws?.video ? (finished ? (ws.tracks ? dict.body.workspace.noPeopleTracksTeam : dict.body.workspace.readingTracks) : dict.body.workspace.noTracksYetRun) : dict.body.workspace.noTracksYetRun}</T>}

      {mode === "engine" && <EngineLanes s={s} x={x} lo={lo} hi={hi} spans={spans} selectedLabel={selRow ? String(selRow.track_number) : null} lanes={lanes} setMarkers={setMarkers} X0={X0} X1={X1} />}
      {mode === "players" && <>
      {Array.from({ length: ROWS }, (_, i) => {
        const y = 1082 + i * 24.3, tr = rows[i];
        const chosen = !!tr && tr.track_id === selectedId;
        return (
          <div key={i} data-lane={tr?.track_number ?? ""}>
            <Hit x={425} y={y - 10} w={20} h={20} label={tr ? dict.body.workspace.selectTrack.replace("{a}", tr.label) : dict.body.workspace.noTrack} {...(tr && ws ? { onClick: () => { ws.select(tr.track_id); ws.seek(tr.first_pts_us); } } : { reason: dict.body.workspace.noTrackYet })}
              pressed={chosen} style={{ border: `${u(2)} solid ${chosen ? "#1a8cff" : "#4a6a96"}`, borderRadius: u(4), background: chosen ? "#1a8cff" : "transparent", color: "#fff", fontSize: u(14), lineHeight: u(16), textAlign: "center" }}>{chosen ? "✓" : ""}</Hit>
            <T x={458} y={y} size={17} color="#cfdcf0">{tr ? tr.track_number : "—"}</T>
            <T x={495} y={y} size={18} color={tr ? "#dbe8f8" : "#8ea3bf"} style={{ maxWidth: u(150), overflow: "hidden", textOverflow: "ellipsis" }}>{tr ? tr.label.split(" · ")[0] : dict.body.workspace.playerTrack}</T>
            {tr && dur && (
              chosen && spans.length ? spans.filter(([a, b]) => b >= lo && a <= hi).map(([a, b]) => <B key={a} x={x(a)} y={y - 5} w={Math.max(2, x(b + interval) - x(a))} h={10} style={{ background: "#19d3ff", borderRadius: u(2), opacity: 0.85 }} />)
                : <B x={x(tr.first_pts_us)} y={y - 5} w={Math.max(2, x(tr.last_pts_us) - x(tr.first_pts_us))} h={10} style={{ background: "#19d3ff", borderRadius: u(2), opacity: chosen ? 0.85 : 0.45 }} />
            )}
          </div>
        );
      })}
      {[0, 1].map((i) => (
        <div key={i} title={notBuilt(dict.body.workspace.teamShapesNeedPitch)} aria-disabled>
          <B x={425} y={1082 + (7 + i) * 24.3 - 10} w={20} h={20} style={{ border: `${u(2)} solid #f5b82e`, borderRadius: u(4), opacity: 0.6 }} />
          <T x={495} y={1082 + (7 + i) * 24.3} size={18} color="#8ea3bf">{i === 0 ? dict.body.workspace.teamShapeHome : dict.body.workspace.teamShapeAway}</T>
        </div>
      ))}
      </>}
      {/* events: a mark each, just above the lanes; the selected player's in white */}
      {dur && ws && visibleMarks.map((m) => {
        const mine = !!selectedId && m.tracks.includes(selectedId);
        return (
          <button key={m.id} type="button" data-event={m.kind} data-pass={m.kind === "Ball Won" || m.kind === "Shots" ? undefined : m.id} aria-label={dict.body.workspace.eventAtClock.replace("{a}", cap(KIND(dict)[m.kind].noun)).replace("{b}", clock(m.at))}
            onClick={() => watch(m)} title={m.detail ? dict.body.workspace.eventAtClockDetail.replace("{a}", cap(KIND(dict)[m.kind].noun)).replace("{b}", clock(m.at)).replace("{c}", m.detail) : `${dict.body.workspace.eventAtClock.replace("{a}", cap(KIND(dict)[m.kind].noun)).replace("{b}", clock(m.at))} · ${dict.body.workspace.clickToWatch}`}
            className="group"
            style={{ position: "absolute", left: u(x(m.at) - 6), top: u(1054 - 101), width: u(12), height: u(16), padding: 0, border: 0, cursor: "pointer",
              background: "transparent", zIndex: mine ? 2 : 1 }}>
            {/* a thin mark, a wide target: the whole 12 px answers the click */}
            <span className="group-hover:scale-x-[2.5]" style={{ position: "absolute", left: u(4.5), top: u(3), width: u(3), height: u(10), background: mine ? "#ffffff" : KIND(dict)[m.kind].color,
              opacity: mine || !selectedId ? 0.9 : 0.45, transition: "transform 80ms" }} />
          </button>
        );
      })}
      {/* lane surface: click to seek; the playhead crosses every lane */}
      {dur && ws && (
        <>
          {mode === "players" && <button type="button" aria-label={dict.body.workspace.seekTimeline} onClick={(e) => ws.seek(usAt(e.clientX, e.currentTarget))}
            style={{ position: "absolute", left: u(X0), top: u(1068 - 101), width: u(X1 - X0), height: u(24.3 * ROWS + 6), padding: 0, border: 0, background: "transparent", cursor: "pointer" }} />}
          <B x={x(t)} y={1068} w={2} h={24.3 * ROWS + 6} style={{ background: "#f5b82e", pointerEvents: "none" }} />
        </>
      )}

      <T x={433} y={1309} size={17} weight={700}>{dict.body.workspace.eventTypes}</T>
      {LEGEND(dict).map(([l, y, c]) => (
        <div key={l}>
          <B x={540} y={y - 5} w={10} h={10} style={{ background: c, borderRadius: u(2) }} />
          <T x={560} y={y} size={14} color="#8ea3bf">{l}</T>
        </div>
      ))}
      <T x={700} y={1309} size={15} color="#8ea3bf" style={{ width: u(X1 - 700), whiteSpace: "normal", lineHeight: 1.3 }}>{eventsLine(ev, dict)}</T>
      {/* step through the events shown one by one: over a whole match their marks are closer than a pixel apart */}
      {ws && shown.length > 0 && (() => {
        const noun = filter ? KIND(dict)[filter].noun : dict.body.workspace.eventNoun, plural = filter ? KIND(dict)[filter].plural : dict.body.workspace.eventsNoun;
        const { at, next, prev, cur } = nav;
        const btn = (x: number, w: number, label: string, target: Mark | undefined, text: string) => (
          <Hit x={x} y={1358} w={w} h={34} label={label} {...(target ? { onClick: () => watch(target) } : { reason: dict.body.workspace.noMoreThisWay.replace("{a}", plural) })}
            style={{ border: `${u(1.5)} solid #2f7a3e`, borderRadius: u(6), background: "#0f2e1a", color: "#d8f5cf", fontSize: u(16), display: "flex", alignItems: "center", justifyContent: "center", opacity: target ? 1 : 0.4 }}>{text}</Hit>
        );
        return (
          <div data-pass-nav data-event-nav>
            {btn(700, 200, dict.body.workspace.prevLabel.replace("{a}", noun), prev, dict.body.workspace.prevBtn.replace("{a}", noun))}
            <T x={920} y={1375} size={16} color={cur ? "#e6f7e0" : "#8ea3bf"}>
              {cur ? `${cap(KIND(dict)[cur.kind].noun)} · ${dict.body.workspace.navOf.replace("{a}", String(at + 1)).replace("{b}", String(shown.length))} · ${clock(cur.at)}${cur.detail ? ` · ${cur.detail}` : ""}`
                : `${shown.length} ${plural} · ${dict.body.workspace.watchOneByOne}`}</T>
            {btn(Math.max(1330, X1 - 200), 200, dict.body.workspace.nextLabel.replace("{a}", noun), next >= 0 ? shown[next] : undefined, dict.body.workspace.nextBtn.replace("{a}", noun))}
          </div>
        );
      })()}
      {/* no events of the kind shown (events loaded, and a run exists): name it instead of leaving the nav area blank */}
      {ws && shown.length === 0 && finished && ev && (
        <T x={920} y={1375} size={16} color="#8ea3bf">{filter ? dict.body.workspace.noKindPlural.replace("{a}", KIND(dict)[filter].plural) : dict.body.workspace.noEventsYet}</T>
      )}
    </section>
  );
}

/** The halves on the timeline: coloured spans with a handle at each end (drag to correct; Confirm is in Time Range). */
function PeriodBar({ per, x, usAt, canEdit, X1 }: { per: PeriodsState; x: (us: number) => number; usAt: (cx: number, el: Element) => number; canEdit: boolean; X1: number }) {
  const { t: dict } = useLocale();
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const start = (which: "first" | "second", edge: "start_us" | "end_us") => (e: React.PointerEvent) => {
    if (!canEdit || !bar) return;
    e.preventDefault();
    const move = (ev: PointerEvent) => per.drag(which, edge, usAt(ev.clientX, bar));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const spans: ["first" | "second", string][] = [["first", dict.body.workspace.firstHalfLower], ["second", dict.body.workspace.secondHalfLower]];
  return (
    <div ref={setBar} data-period-bar className="absolute" style={{ left: u(X0), top: u(1030 - 101), width: u(X1 - X0), height: u(26) }}>
      {spans.map(([k, l]) => {
        const p = per.shown[k];
        if (!p) return null;
        const a = x(p.start_us) - X0, b = x(p.end_us) - X0;
        if (b - a < 1) return null;
        return (
          <div key={k} data-period={k} style={{ position: "absolute", left: u(a), width: u(b - a), top: 0, height: u(26), background: per.data?.state === "CONFIRMED" && !per.dirty ? "#1d5a2e" : "#5a4a0a",
            border: `${u(1)} solid ${per.data?.state === "CONFIRMED" && !per.dirty ? "#2ee86a" : "#ffd400"}`, borderRadius: u(4), fontSize: u(15), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", whiteSpace: "nowrap" }}>
            {l} · {clock(p.start_us)}–{clock(p.end_us)}
            {(["start_us", "end_us"] as const).map((edge) => (
              <span key={edge} role="slider" aria-label={edge === "start_us" ? dict.body.workspace.periodStart.replace("{a}", l) : dict.body.workspace.periodEnd.replace("{a}", l)} aria-valuenow={Math.round(p[edge] / 1e6)} onPointerDown={start(k, edge)}
                style={{ position: "absolute", top: 0, [edge === "start_us" ? "left" : "right"]: 0, width: u(10), height: "100%", background: "#ffffffaa", cursor: canEdit ? "ew-resize" : "default" }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// memoised: the bar only re-renders when its props change, not on every playhead move (x/usAt are useCallback'd above)
const PeriodBarMemo = memo(PeriodBar);
