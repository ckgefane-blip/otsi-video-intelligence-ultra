"use client";
/**
 * Page 04 centre bottom — event chips and Tracks & Presence, in flow (Desktop UI Drop 2).
 *
 * Events are found by the engine from its ball (ADR-040-042): passes, key passes, the ball won from the other team, shots and pressures.
 * The chips filter them (All Events, or one kind) and count them in match time; each shows as a mark above the lanes (a mark seeks to just
 * before it and selects the player who did it, so he can be identified for a reel; the selected player's are white) and Previous / Next
 * under the lanes steps through the ones shown. Tackles and interceptions are the balls won that the engine's rule reads as one or the
 * other (ADR-041): "possible", about half right by eye; they stay in Ball Won too. Goals come from the broadcast scoreboard (ADR-049);
 * a possible foul is a free kick or penalty the engine found (ADR-048: play stopped just before). Cards are not measured. Chips of kinds
 * not detected show "—" with the reason.
 * The line under the lanes gives the passes and each team's possession. Tracks & Presence draws the people tracks of the latest finished
 * run (the selected one first, then the longest of the chosen team): a bar from the first to the last time the track was seen, and for the
 * selected track the exact spans with gaps shown as gaps (observations of the run). A row selects its track and jumps to where it first
 * appears; clicking a lane seeks. The playhead crosses all lanes. Team shapes need calibrated pitch positions, so those rows are listed
 * and disabled. Engine lanes (B.3, ADR-082) show the shots, ball, pitch, selected player and markers instead.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Observation, VideoLanes, VideoMarker } from "@otsi-vie/contracts";
import { api, ApiProblem } from "@/lib/api";
import { clock, isPerson, type Shared } from "@/components/workspace/shared";
import type { PeriodsState } from "@/components/workspace/Periods";
import { eventsLine } from "@/components/workspace/Events";
import { notBuilt } from "@/lib/devMode";
import { useLanes } from "@/components/workspace/EngineLanes";
import { allMarks, KIND, marksOf, type Kind, type Mark } from "@/components/workspace/TimelinePanel";
import { useLocale, type Dictionary } from "@/lib/i18n";

/** [kind code, translated chip label] — the code is a lookup key and stays English; only the label translates. */
const CHIPS = (d: Dictionary): [Kind | "Cards", string][] => [
  ["Goals", d.body.workspace.chipGoals], ["Passes", d.body.workspace.chipPasses],
  ["Key Passes", d.body.workspace.chipKeyPasses], ["Shots", d.body.workspace.chipShots],
  ["Tackles", d.body.workspace.chipTackles], ["Interceptions", d.body.workspace.chipInterceptions],
  ["Fouls", d.body.workspace.chipFouls], ["Cards", d.body.workspace.chipCards],
  ["Ball Won", d.body.workspace.chipBallWon], ["Pressures", d.body.workspace.chipPressures],
  ["Set Pieces", d.body.workspace.chipSetPieces]];
const LEGEND = (d: Dictionary): [string, string][] => [
  [d.body.workspace.chipGoals, "#a066ff"], [d.body.workspace.chipShots, "#19d3ff"],
  [d.body.workspace.chipKeyPasses, "#19e6c0"], [d.body.workspace.chipPasses, "#7ae85a"],
  [d.body.workspace.duelsLabel, "#ffb21a"], [d.body.workspace.defensiveActions, "#ff4a4a"]];
const ROWS = 7;
const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);

export function AnalysisTimeline({ s }: { s: Shared }) {
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
  const dur = ws?.video?.duration_us ?? null, t = ws?.timeUs ?? 0;
  const tracks = ws?.tracks ?? null, selectedId = ws?.selectedId ?? null;
  const rows = useMemo(() => {
    const list = (tracks ?? []).filter((x) => isPerson(x) && (!teamGroups || teamGroups.has(x.kit_group ?? -1)))
      .sort((a, b) => b.observation_count - a.observation_count);
    const chosen = list.find((x) => x.track_id === selectedId) ?? (tracks ?? []).find((x) => x.track_id === selectedId && isPerson(x));
    return (chosen ? [chosen, ...list.filter((x) => x !== chosen)] : list).slice(0, ROWS);
  }, [tracks, teamGroups, selectedId]);
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
  const per = ws?.periods;
  const [lo, hi] = dur && per ? per.window(dur) : [0, dur ?? 0];
  const pct = useCallback((us: number) => (hi > lo ? Math.min(100, Math.max(0, ((us - lo) / (hi - lo)) * 100)) : 0), [lo, hi]);
  const usAt = useCallback((clientX: number, el: Element) => { const r = el.getBoundingClientRect(); return lo + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (hi - lo); }, [lo, hi]);
  const finished = !!ws?.run;
  const ev = ws?.events.data ?? null;
  const marks = useMemo(() => marksOf(ev, dict), [ev]);
  const [filter, setFilter] = useState<Kind | null>(null);
  const shown = useMemo(() => (filter ? marks[filter] : allMarks(marks)), [marks, filter]);
  const visibleMarks = useMemo(() => shown.filter((m) => m.at >= lo && m.at <= hi), [shown, lo, hi]);
  const nav = useMemo(() => {
    const lead = (m: Mark) => KIND(dict)[m.kind].lead;
    const at = shown.findLastIndex((m) => t >= m.at - lead(m) - 300_000 && t <= m.end + 3_000_000);
    const next = shown.findIndex((m) => m.at - lead(m) > t + 300_000);
    const prev = [...shown].reverse().find((m) => m.at - lead(m) < t - 1_000_000 && shown.indexOf(m) !== at);
    return { at, next, prev, cur: at >= 0 ? shown[at]! : null };
  }, [shown, t]);
  const watch = (m: Mark) => {
    if (!ws) return;
    if (m.tracks[0]) ws.select(m.tracks[0]);
    ws.seek(Math.max(0, m.at - KIND(dict)[m.kind].lead));
  };
  const empty = !finished || rows.length === 0;
  const [mode, setMode] = useState<"players" | "engine">("players");
  const { lanes, setMarkers } = useLanes(ws?.video?.id ?? null, ws?.run?.id ?? null);
  const selRow = (tracks ?? []).find((x) => x.track_id === selectedId);
  const [engineNoteOpen, setEngineNoteOpen] = useState(false);
  const LANE_LABELS = [dict.body.workspace.shotsCuts, dict.body.workspace.ballFound, dict.body.workspace.pitchMeasured, dict.body.workspace.selectedPlayer, dict.body.workspace.markersNotes] as const;

  return (
    <section aria-label={dict.body.workspace.eventsAndTracks} data-section="p04-s07" data-lanes={String(rows.length)} className="vie-panel">
      <div className="flex flex-col gap-3 p-3">
        <div role="group" aria-label={dict.body.workspace.eventFilter} data-chip-strip
          className="flex gap-1.5 overflow-x-auto pb-1">
          <button type="button" aria-pressed={!filter} onClick={() => setFilter(null)} title={dict.body.workspace.allEventsHint}
            className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm ${!filter ? "border-primary bg-[#0d3a78] text-[#33a8ff]" : "border-[#1f4a7a] bg-[#0a1d38]"}`}>
            <span aria-hidden className="h-3 w-3 rounded-full bg-[#33a8ff]" />{dict.body.analysis.allEvents}
          </button>
          {CHIPS(dict).map(([n, chipLabel]) => n in KIND(dict) && marks[n as Kind].length ? (() => {
            const k = n as Kind, on = filter === k, c = KIND(dict)[k].color;
            return (
              <button key={n} type="button" aria-pressed={on} onClick={() => setFilter(on ? null : k)}
                title={dict.body.workspace.chipFound.replace("{a}", chipLabel).replace("{b}", String(marks[k].length)).replace("{c}", on ? dict.body.workspace.showAllEvents : dict.body.workspace.showOnlyThese)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm ${on ? "bg-[#123a2c] text-[#e6f7e0]" : "border-[#2a5a8a] bg-[#0a1d38] text-[#e6f7e0]"}`}
                style={on ? { borderColor: c } : undefined}>
                <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: c }} />{chipLabel}
                <span className="rounded bg-[#1d4a3e] px-1.5 text-xs">{marks[k].length}</span>
              </button>
            );
          })() : (
            <button key={n} type="button" aria-disabled title={dict.body.workspace.chipNoneDetected.replace("{a}", chipLabel)}
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#1f4a7a] bg-[#0a1d38] px-2 py-1.5 text-sm text-[#cfdcf0] opacity-85"
              onClick={() => { /* a kind with nothing detected: the reason is the tooltip */ }}>
              <span aria-hidden className="h-3 w-3 rounded-full bg-[#2a4f80]" />{chipLabel}
              <span className="rounded bg-[#12294a] px-1.5 text-xs">—</span>
              <span className="sr-only">{(ev?.ball_track_id && WHY[n]) || NOT_DETECTED}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <h3 className="t-panel">{mode === "players" ? dict.body.analysis.tracksPresence : dict.body.workspace.engineLanes}</h3>
          <div role="radiogroup" aria-label={dict.body.workspace.lanesLabel} className="flex gap-1">
            {([["players", dict.body.analysis.players], ["engine", dict.body.workspace.engineLanes]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} data-lanes-mode={k} onClick={() => setMode(k)}
                title={k === "engine" ? dict.body.workspace.shotsCutsPitch : dict.body.workspace.playersTracks}
                className={`rounded px-2 py-1 text-xs ${mode === k ? "border border-primary bg-[#0f4f9a] text-white" : "border border-line text-muted"}`}>{l}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[minmax(150px,190px)_minmax(0,1fr)] items-center gap-2 text-xs text-muted">
          <span />
          <div className="flex justify-between" aria-hidden>
            {Array.from({ length: 7 }, (_, i) => <span key={i}>{dur ? clock(lo + ((hi - lo) * i) / 6) : "—"}</span>)}
          </div>
        </div>
        {dur && per?.shown.first && <div className="grid grid-cols-[minmax(150px,190px)_minmax(0,1fr)] gap-2"><span /><PeriodBar per={per} pct={pct} usAt={usAt} canEdit={!!ws?.canWrite} /></div>}

        <div className="grid grid-cols-[minmax(150px,190px)_minmax(0,1fr)] gap-2">
          <span />
          <div className="relative h-4" aria-hidden>
            {dur && ws && visibleMarks.map((m) => {
              const mine = !!selectedId && m.tracks.includes(selectedId);
              return (
                <button key={m.id} type="button" data-event={m.kind} data-pass={m.kind === "Ball Won" || m.kind === "Shots" ? undefined : m.id}
                  aria-label={dict.body.workspace.eventAtClock.replace("{a}", cap(KIND(dict)[m.kind].noun)).replace("{b}", clock(m.at))}
                  onClick={() => watch(m)}
                  title={m.detail ? dict.body.workspace.eventAtClockDetail.replace("{a}", cap(KIND(dict)[m.kind].noun)).replace("{b}", clock(m.at)).replace("{c}", m.detail) : `${dict.body.workspace.eventAtClock.replace("{a}", cap(KIND(dict)[m.kind].noun)).replace("{b}", clock(m.at))} · ${dict.body.workspace.clickToWatch}`}
                  className="group absolute top-0 h-4 w-3"
                  style={{ left: `calc(${pct(m.at)}% - 6px)`, background: "transparent", border: 0, padding: 0, cursor: "pointer", zIndex: mine ? 2 : 1 }}>
                  <span className="absolute left-[4.5px] top-[3px] h-[10px] w-[3px] transition-transform group-hover:scale-x-[2.5]"
                    style={{ background: mine ? "#ffffff" : KIND(dict)[m.kind].color, opacity: mine || !selectedId ? 0.9 : 0.45 }} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-[minmax(150px,190px)_minmax(0,1fr)] gap-2" data-lanes-area>
          <div className="flex flex-col">
            {mode === "players" && empty && <p className="py-4 text-sm text-muted">{ws?.video ? (finished ? (ws.tracks ? dict.body.workspace.noPeopleTracksTeam : dict.body.workspace.readingTracks) : dict.body.workspace.noTracksYetRun) : dict.body.workspace.noTracksYetRun}</p>}
            {mode === "players" && !empty && Array.from({ length: ROWS }, (_, i) => {
              const tr = rows[i];
              const chosen = !!tr && tr.track_id === selectedId;
              return (
                <div key={i} data-lane={tr?.track_number ?? ""} className="flex h-[26px] min-w-0 items-center gap-2 text-sm">
                  <button type="button" aria-label={tr ? dict.body.workspace.selectTrack.replace("{a}", tr.label) : dict.body.workspace.noTrack}
                    disabled={!tr || !ws} onClick={() => { if (tr && ws) { ws.select(tr.track_id); ws.seek(tr.first_pts_us); } }}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs text-white ${chosen ? "border-[#1a8cff] bg-[#1a8cff]" : "border-[#4a6a96] bg-transparent"}`}>{chosen ? "✓" : ""}</button>
                  <span className="w-6 shrink-0 text-[#cfdcf0]">{tr ? tr.track_number : "—"}</span>
                  <span className="min-w-0 truncate text-[#dbe8f8]">{tr ? tr.label.split(" · ")[0] : dict.body.workspace.playerTrack}</span>
                </div>
              );
            })}
            {mode === "players" && [0, 1].map((i) => (
              <div key={i} title={notBuilt(dict.body.workspace.teamShapesNeedPitch)} aria-disabled className="flex h-[26px] items-center gap-2 text-sm opacity-60">
                <span aria-hidden className="h-5 w-5 rounded border-2 border-[#f5b82e]" />
                <span className="text-muted">{i === 0 ? dict.body.workspace.teamShapeHome : dict.body.workspace.teamShapeAway}</span>
              </div>
            ))}
            {mode === "engine" && (
              <>
                {LANE_LABELS.map((l, i) => (
                  <div key={l} className="flex h-[26px] items-center text-sm text-[#cfdcf0]">
                    <span className="truncate">{i === 3 && selRow ? dict.body.workspace.playerLabel.replace("{a}", String(selRow.track_number)) : l}</span>
                  </div>
                ))}
                <div className="flex h-[26px] items-center">
                  <button type="button" aria-label={dict.body.workspace.markersAddNote} disabled={!ws?.video} title={ws?.video ? undefined : dict.body.workspace.chooseVideoFirstNoDot}
                    onClick={() => setEngineNoteOpen(true)} className="rounded border border-[#ff7ad9] px-2 py-0.5 text-xs text-[#ffd1f2] disabled:opacity-50">{dict.body.workspace.addNote}</button>
                </div>
              </>
            )}
          </div>
          <div className="relative">
            {dur && ws && (
              <button type="button" aria-label={dict.body.workspace.seekTimeline} onClick={(e) => ws.seek(usAt(e.clientX, e.currentTarget))}
                className="absolute inset-0 z-0 cursor-pointer border-0 bg-transparent p-0" />
            )}
            {mode === "players" && !empty && Array.from({ length: ROWS }, (_, i) => {
              const tr = rows[i];
              const chosen = !!tr && tr.track_id === selectedId;
              return (
                <div key={i} className="relative flex h-[26px] items-center">
                  <div className="relative h-[10px] w-full rounded-sm bg-raised/40">
                    {tr && dur && (
                      chosen && spans.length ? spans.filter(([a, b]) => b >= lo && a <= hi).map(([a, b]) => (
                        <span key={a} className="absolute top-0 h-[10px] rounded-sm bg-[#19d3ff] opacity-85" style={{ left: `${pct(a)}%`, width: `max(2px, ${pct(b + interval) - pct(a)}%)` }} />
                      )) : <span className="absolute top-0 h-[10px] rounded-sm bg-[#19d3ff]" style={{ left: `${pct(tr.first_pts_us)}%`, width: `max(2px, ${pct(tr.last_pts_us) - pct(tr.first_pts_us)}%)`, opacity: chosen ? 0.85 : 0.45 }} />
                    )}
                  </div>
                </div>
              );
            })}
            {mode === "players" && [0, 1].map((i) => <div key={i} className="h-[26px]" />)}
            {mode === "engine" && (
              <EngineLanesFlow s={s} pct={pct} lo={lo} hi={hi} spans={spans} selectedLabel={selRow ? String(selRow.track_number) : null} lanes={lanes} setMarkers={setMarkers} noteOpen={engineNoteOpen} setNoteOpen={setEngineNoteOpen} />
            )}
            {dur && ws && <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-[#f5b82e]" style={{ left: `${pct(t)}%` }} />}
          </div>
        </div>

        <div className="flex flex-wrap items-start gap-x-6 gap-y-1 text-xs">
          <span className="font-normal text-sm">{dict.body.workspace.eventTypes}</span>
          {LEGEND(dict).map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5 text-muted"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>
          ))}
          <span className="min-w-[200px] flex-1 text-muted">{eventsLine(ev, dict)}</span>
        </div>

        {ws && shown.length > 0 && (() => {
          const noun = filter ? KIND(dict)[filter].noun : dict.body.workspace.eventNoun, plural = filter ? KIND(dict)[filter].plural : dict.body.workspace.eventsNoun;
          const { at, next, prev, cur } = nav;
          return (
            <div data-pass-nav data-event-nav className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={!prev} title={prev ? dict.body.workspace.prevLabel.replace("{a}", noun) : dict.body.workspace.noMoreThisWay.replace("{a}", plural)}
                onClick={() => prev && watch(prev)} className="rounded-md border border-[#2f7a3e] bg-[#0f2e1a] px-3 py-1.5 text-sm text-[#d8f5cf] disabled:opacity-40">
                {dict.body.workspace.prevBtn.replace("{a}", noun)}
              </button>
              <span className="flex-1 text-center text-sm text-muted">
                {cur ? `${cap(KIND(dict)[cur.kind].noun)} · ${dict.body.workspace.navOf.replace("{a}", String(at + 1)).replace("{b}", String(shown.length))} · ${clock(cur.at)}${cur.detail ? ` · ${cur.detail}` : ""}`
                  : `${shown.length} ${plural} · ${dict.body.workspace.watchOneByOne}`}
              </span>
              <button type="button" disabled={next < 0} title={next >= 0 ? dict.body.workspace.nextLabel.replace("{a}", noun) : dict.body.workspace.noMoreThisWay.replace("{a}", plural)}
                onClick={() => next >= 0 && watch(shown[next]!)} className="rounded-md border border-[#2f7a3e] bg-[#0f2e1a] px-3 py-1.5 text-sm text-[#d8f5cf] disabled:opacity-40">
                {dict.body.workspace.nextBtn.replace("{a}", noun)}
              </button>
            </div>
          );
        })()}
        {ws && shown.length === 0 && finished && ev && (
          <p className="text-sm text-muted">{filter ? dict.body.workspace.noKindPlural.replace("{a}", KIND(dict)[filter].plural) : dict.body.workspace.noEventsYet}</p>
        )}
      </div>
    </section>
  );
}

/** The halves on the timeline: coloured spans with a handle at each end (drag to correct; Confirm is in Time Range). */
function PeriodBar({ per, pct, usAt, canEdit }: { per: PeriodsState; pct: (us: number) => number; usAt: (cx: number, el: Element) => number; canEdit: boolean }) {
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
    <div ref={setBar} data-period-bar className="relative h-[26px]">
      {spans.map(([k, l]) => {
        const p = per.shown[k];
        if (!p) return null;
        const a = pct(p.start_us), b = pct(p.end_us);
        if (b - a < 1) return null;
        return (
          <div key={k} data-period={k} className="absolute top-0 flex h-[26px] items-center justify-center overflow-hidden whitespace-nowrap rounded text-sm text-white"
            style={{ left: `${a}%`, width: `${b - a}%`, background: per.data?.state === "CONFIRMED" && !per.dirty ? "#1d5a2e" : "#5a4a0a",
              border: `1px solid ${per.data?.state === "CONFIRMED" && !per.dirty ? "#2ee86a" : "#ffd400"}` }}>
            {l} · {clock(p.start_us)}–{clock(p.end_us)}
            {(["start_us", "end_us"] as const).map((edge) => (
              <span key={edge} role="slider" aria-label={edge === "start_us" ? dict.body.workspace.periodStart.replace("{a}", l) : dict.body.workspace.periodEnd.replace("{a}", l)} aria-valuenow={Math.round(p[edge] / 1e6)} onPointerDown={start(k, edge)}
                className="absolute top-0 h-full w-[10px] bg-white/70" style={{ [edge === "start_us" ? "left" : "right"]: 0, cursor: canEdit ? "ew-resize" : "default" }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** v3 Phase B.3 (ADR-082): the engine lanes, in flow — shots / cuts, ball found, pitch measured, selected player, markers & notes.
 *  This renders only the track column (the labels live in the parent's label column, so the rows stay aligned); the Add-note button
 *  lives there too and opens this dialog through `noteOpen`. */
function EngineLanesFlow({ s, pct, lo, hi, spans, selectedLabel, lanes, setMarkers, noteOpen, setNoteOpen }: {
  s: Shared; pct: (us: number) => number; lo: number; hi: number; spans: [number, number][]; selectedLabel: string | null;
  lanes: VideoLanes | null; setMarkers(m: VideoMarker[]): void; noteOpen: boolean; setNoteOpen(o: boolean): void;
}) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const inView = (a: number, b: number) => b >= lo && a <= hi;
  const bar = (key: string | number, a: number, b: number, color: string, opacity = 0.85, title?: string) => (
    <span key={key} className="absolute top-0 h-[10px] rounded-sm" style={{ left: `${pct(a)}%`, width: `max(2px, ${pct(b) - pct(a)}%)`, background: color, opacity }} {...(title ? { title } : {})} />
  );
  const note = (text: string) => <span className="text-xs text-[#6f86a6]">{text}</span>;
  const L = lanes;
  const lane = (i: number) => {
    if (!L) return i === 0 ? note(ws?.video ? dict.body.workspace.readingLanes : dict.body.workspace.chooseVideo) : null;
    if (i === 0) return (
      <div data-lane-shots={L.shots.length}>
        {L.shots.length ? L.shots.filter((k) => inView(k.start_us, k.end_us)).map((k) => bar(`s${k.shot_number}`, k.start_us, k.end_us, k.shot_number % 2 ? "#4a7fd0" : "#2a4f8a", 0.9, dict.body.workspace.shotTitle.replace("{a}", String(k.shot_number)).replace("{b}", clock(k.start_us)).replace("{c}", clock(k.end_us))))
          : note(L.run_id ? dict.body.workspace.noShotsRecorded : dict.body.workspace.noFinishedYet)}
      </div>
    );
    if (i === 1) return (
      <div data-lane-ball={L.ball?.length ?? "none"}>
        {L.ball === null ? note(dict.body.workspace.noBallTrackYet) : L.ball.length ? L.ball.filter((k) => inView(k.start_us, k.end_us)).map((k) => bar(`b${k.start_us}`, k.start_us, k.end_us, "#ffd400", 0.85))
          : note(dict.body.workspace.ballTrackNoSee)}
      </div>
    );
    if (i === 2) return (
      <div data-lane-pitch={L.calibrated.length}>
        {L.calibrated.length ? L.calibrated.filter((k) => inView(k.start_us, k.end_us)).map((k) => bar(`c${k.start_us}`, k.start_us, k.end_us, "#2ee86a", 0.35 + 0.55 * Math.min(1, Math.max(0, k.quality ?? 0.5)),
          dict.body.workspace.pitchMeasuredRange.replace("{a}", clock(k.start_us)).replace("{b}", clock(k.end_us)).replace("{c}", k.quality !== null ? dict.body.workspace.pitchQualityPart.replace("{a}", String(Math.round(k.quality * 100))) : "")))
          : note(dict.body.workspace.pitchNotMeasuredLane)}
      </div>
    );
    if (i === 3) return (
      <div data-lane-player={spans.length}>
        {selectedLabel ? spans.filter(([a, b]) => inView(a, b)).map(([a, b]) => bar(`p${a}`, a, b, "#19d3ff")) : note(dict.body.workspace.selectPlayerSeen)}
      </div>
    );
    return (
      <div data-lane-markers={L.markers.length} className="relative h-[10px]">
        {L.markers.length === 0 && note(dict.body.workspace.noMarkersLane)}
        {ws && L.markers.filter((m) => m.at_pts_us >= lo && m.at_pts_us <= hi).map((m) => (
          <button key={m.id} type="button" data-marker={m.id} aria-label={dict.body.workspace.markerAt.replace("{a}", clock(m.at_pts_us)).replace("{b}", m.body)} title={`${clock(m.at_pts_us)} · ${m.body}${m.author ? ` · ${m.author.name}` : ""}`}
            onClick={() => ws.seek(m.at_pts_us)}
            className="absolute top-[-9px] h-[18px] w-3 border-0 bg-transparent p-0" style={{ left: `calc(${pct(m.at_pts_us)}% - 6px)`, cursor: "pointer", zIndex: 3 }}>
            <span className="absolute left-[1px] top-0 h-0 w-0 border-x-[5px] border-t-[9px] border-x-transparent border-t-[#ff7ad9]" />
            <span className="absolute left-[5px] top-2 h-[10px] w-[2px] bg-[#ff7ad9]" />
          </button>
        ))}
      </div>
    );
  };
  return (
    <div data-engine-lanes className="flex flex-col">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="relative flex h-[26px] items-center">
          <div className="relative h-[10px] w-full">{lane(i)}</div>
        </div>
      ))}
      <div className="h-[26px]" />
      <MarkerDialog s={s} open={noteOpen} onOpenChange={setNoteOpen} markers={L?.markers ?? []} setMarkers={setMarkers} />
    </div>
  );
}

function MarkerDialog({ s, open, onOpenChange, markers, setMarkers }: { s: Shared; open: boolean; onOpenChange(o: boolean): void; markers: VideoMarker[]; setMarkers(m: VideoMarker[]): void }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const at = Math.round(ws?.timeUs ?? 0);
  const vid = ws?.video?.id;
  const go = async (f: () => Promise<VideoMarker[]>) => {
    setBusy(true); setErr(null);
    try { setMarkers(await f()); return true; } catch (x) { setErr(x instanceof ApiProblem ? x.message : dict.body.analysis.thatDidNotWork); return false; } finally { setBusy(false); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setErr(null); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="markers" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(620px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="t-panel">{dict.body.workspace.markersNotes}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{dict.body.workspace.notePinned}</Dialog.Description>
          {ws?.canWrite ? (
            <form className="mb-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (vid && body.trim()) void go(() => api<VideoMarker[]>(`/v1/videos/${vid}/markers`, { method: "POST", json: { at_pts_us: at, body: body.trim() } })).then((ok) => ok && setBody("")); }}>
              <label className="block text-xs text-muted" htmlFor="marker-body">{dict.body.workspace.noteAtPlayhead.replace("{a}", clock(at))}</label>
              <textarea id="marker-body" data-marker-body value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={2} className="w-full rounded-ctl border border-line bg-raised p-2" />
              <button type="submit" data-marker-add disabled={busy || !body.trim()} className="rounded-ctl border border-primary bg-primary/20 px-3 py-1.5 font-normal disabled:opacity-40">{dict.body.workspace.pinAt.replace("{a}", clock(at))}</button>
            </form>
          ) : <p className="mb-3 text-xs text-muted">{dict.body.workspace.roleReadMarkers}</p>}
          {err && <p className="mb-2 text-xs text-[#ff8a8a]" role="alert">{err}</p>}
          {markers.length === 0 ? <p className="text-xs text-muted">{dict.body.workspace.noMarkersYet}</p> : (
            <ol className="space-y-1" data-marker-list>
              {markers.map((m) => (
                <li key={m.id} className="flex items-center gap-2 rounded-ctl border border-line/60 px-2.5 py-1.5">
                  <button type="button" className="shrink-0 font-mono text-xs text-[#ffd1f2]" onClick={() => { ws?.seek(m.at_pts_us); onOpenChange(false); }}>{clock(m.at_pts_us)}</button>
                  <span className="min-w-0 flex-1"><span className="block break-words">{m.body}</span><span className="block text-xs text-muted">{m.author?.name ?? dict.body.workspace.someoneLabel}</span></span>
                  {ws?.canWrite && vid && (
                    <button type="button" data-marker-remove={m.id} disabled={busy} onClick={() => void go(() => api<VideoMarker[]>(`/v1/videos/${vid}/markers/${m.id}`, { method: "DELETE" }))}
                      className="shrink-0 rounded-ctl border border-line px-2 py-1 text-xs disabled:opacity-40">{dict.body.upload.removeVerb}</button>
                  )}
                </li>
              ))}
            </ol>
          )}
          <div className="mt-3 text-right"><Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.close}</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
