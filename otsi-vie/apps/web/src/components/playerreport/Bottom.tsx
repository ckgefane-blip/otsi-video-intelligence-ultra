"use client";
/**
 * Page 08 Sections 07-12 — Heatmap, Event Timeline, Action Map, Comparison, Rule-built Insights (was Generated Insights, v3 Phase 0), Scouting Report.
 *
 * Drop 1 layout: the same sections, controls and API reads as the 2560-px DesignStage composition, laid out in the page's flow on the
 * Desktop UI shell with the shared `vie-panel` / `vie-btn` classes and native selects. Nothing was removed or rewired.
 *
 * Event Timeline and Action Map are the engine's events on tracks a person confirmed as him (GET /v1/players/:id/events): the list opens
 * the video at each moment; the map draws his passes from their stored ends where a pitch calibration covers both ends (key passes gold),
 * and says how many could not be placed. Shots: the engine has detected none, so none is drawn. All are engine readings, marked as such.
 * Comparison (ADR-056): him against his line or every player of the organization, per 90 minutes seen on camera, with the group's size.
 * Generated Insights: up to four sentences built from his measured values, each naming its source (no text model). Scouting Report: the
 * published assessment (a person's opinion); "View Full Report" opens it.
 * The heatmap's time range works: "1st Half" / "2nd Half" ask the API for that half only (GET /v1/players/:id/measures?half=1|2), using
 * the halves a person confirmed or, marked as such, the ones the engine proposed; a half that is not known for his videos is greyed.
 */
import { type CohortGroup, type PlayerComparison, type PlayerEvent, type PlayerEvents, type PlayerInsights, type PlayerMeasures } from "@otsi-vie/contracts";
import { ChevronRight, FileText, Gauge, Send, Shield, Star, Target, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { HeatPitch, measuredText } from "@/components/workspace/HeatPitch";
import { Evidence } from "@/components/evidence/Evidence";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import type { Report } from "./Top";
import { AiAnalystPanel } from "./AiAnalystPanel";

const hl = (on: boolean) => (on ? "border-primary" : "");

/** a pitch drawn as one SVG (viewBox 105 x 68 m), so overlays (passes) share its coordinates; `children` draws inside the lines */
function FlowPitch({ children, label }: { children?: ReactNode; label?: string }) {
  return (
    <svg viewBox="0 0 105 68" role="img" aria-label={label} className="block h-auto w-full">
      {Array.from({ length: 14 }, (_, i) => <rect key={i} x={i * 7.5} y={0} width={7.5} height={68} fill={i % 2 ? "#236b2b" : "#1d5c25"} />)}
      <rect x={1.5} y={2.5} width={102} height={63} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={0.4} />
      <line x1={52.5} y1={2.5} x2={52.5} y2={65.5} stroke="rgba(255,255,255,.85)" strokeWidth={0.4} />
      <circle cx={52.5} cy={34} r={9.15} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={0.4} />
      <rect x={1.5} y={13.84} width={16.5} height={40.32} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={0.4} />
      <rect x={87} y={13.84} width={16.5} height={40.32} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={0.4} />
      <rect x={1.5} y={24.84} width={5.5} height={18.32} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={0.4} />
      <rect x={98} y={24.84} width={5.5} height={18.32} fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={0.4} />
      {children}
    </svg>
  );
}

/** a labelled native select; an option that cannot be chosen yet is listed disabled with its reason */
function FlowSel<V extends string>({ label, value, onChange, options }: {
  label: string; value: V; onChange?: (v: V) => void; options: ([V, string] | [V, string, string])[];
}) {
  return (
    <label className="flex items-center gap-2 t-body">
      <span className="shrink-0 t-small">{label}</span>
      <select aria-label={label} value={value} disabled={!onChange} onChange={(e) => onChange?.(e.target.value as V)}
        className="rounded-ctl border border-line bg-canvas px-2 py-1.5 t-body disabled:opacity-60">
        {options.map(([v, l, why]) => <option key={v} value={v} disabled={!!why}>{l}{why ? ` — ${why}` : ""}</option>)}
      </select>
    </label>
  );
}

type Range = "full" | "h1" | "h2";
type EvFilter = "all" | "pass" | "won" | "press" | "shot" | "sp";

const KIND_WORDS = (d: Dictionary): Record<PlayerEvent["kind"], string> => ({ PASS: d.body.reports.evPass, PASS_RECEIVED: d.body.reports.evPassReceived, BALL_WON: d.body.reports.evBallWon, PRESSURE: d.body.reports.evPressure, SHOT: d.body.reports.evShot, SET_PIECE: d.body.reports.evSetPiece, GOAL: d.body.reports.evGoal });
const SP_WORDS = (d: Dictionary): Record<string, string> => ({ KICK_OFF: d.body.reports.spKickOff, PENALTY: d.body.reports.spPenalty, CORNER: d.body.reports.spCorner, GOAL_KICK: d.body.reports.spGoalKick, THROW_IN: d.body.reports.spThrowIn, FREE_KICK: d.body.reports.spFreeKick });
const matchClock = (us: number) => { const s = Math.floor(us / 1e6); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const FILTER: Record<EvFilter, (e: PlayerEvent) => boolean> = {
  all: () => true, pass: (e) => e.kind === "PASS" || e.kind === "PASS_RECEIVED", won: (e) => e.kind === "BALL_WON", press: (e) => e.kind === "PRESSURE",
  shot: (e) => e.kind === "SHOT" || e.kind === "GOAL", sp: (e) => e.kind === "SET_PIECE",
};
function describe(e: PlayerEvent, d: Dictionary): string {
  if (e.kind === "PASS") return `${e.key ? d.body.reports.evKeyPassShort : d.body.reports.evPass}${e.partner_name ? d.body.reports.evToPlayer.replace("{a}", e.partner_name) : ""}${e.length_m != null ? d.body.reports.evLengthM.replace("{a}", String(Math.round(e.length_m))) : ""}`;
  if (e.kind === "PASS_RECEIVED") return `${d.body.reports.evPassReceived}${e.partner_name ? d.body.reports.evFromPlayer.replace("{a}", e.partner_name) : ""}`;
  if (e.kind === "BALL_WON") return e.how ? (e.how === "TACKLE" ? d.body.reports.evBallWonTackle : d.body.reports.evBallWonInterception) : d.body.reports.evBallWon;
  if (e.kind === "PRESSURE") return e.regain ? d.body.reports.evPressureRegain : d.body.reports.evPressure;
  if (e.kind === "SET_PIECE") return e.set_piece ? SP_WORDS(d)[e.set_piece] ?? d.body.reports.evSetPiece : d.body.reports.evSetPiece;
  return KIND_WORDS(d)[e.kind];
}
const COHORT_LABEL = (d: Dictionary): Record<CohortGroup, string> => ({ ALL: d.body.reports.cohortAll, GK: d.body.reports.cohortGk, DEF: d.body.reports.cohortDef, MID: d.body.reports.cohortMid, FWD: d.body.reports.cohortFwd });
const CMP_LABEL = (d: Dictionary): Record<string, string> => ({ "Passes (p90)": d.body.reports.cmpPasses, "Key Passes (p90)": d.body.reports.cmpKeyPasses, "Balls Won (p90)": d.body.reports.cmpBallsWon, "Distance (per 90 measured)": d.body.reports.cmpDistance, "Top Speed": d.body.reports.cmpTopSpeed });

/** his events (the whole match) */
function usePlayerEvents(r: Report): PlayerEvents | null | undefined {
  const [ev, setEv] = useState<PlayerEvents | null | undefined>(undefined);
  const id = r.player?.player_id;
  useEffect(() => {
    setEv(undefined);
    if (!id) return;
    let live = true;
    void api<PlayerEvents>(`/v1/players/${id}/events`).then((x) => { if (live) setEv(x); }, () => { if (live) setEv(null); });
    return () => { live = false; };
  }, [id]);
  return ev;
}

/** his passes drawn from their stored ends (pitch metres from the centre spot) on the panel's pitch, inside its lines */
const PassArrows = memo(function PassArrows({ ev, keyOnly }: { ev: PlayerEvents; keyOnly: boolean }) {
  const { t: dict } = useLocale();
  const L = ev.length_m, Wd = ev.width_m;
  const px = (m: number) => ((m + L / 2) / L) * 105, py = (m: number) => ((m + Wd / 2) / Wd) * 68;
  const drawn = useMemo(() => ev.items.filter((e) => e.kind === "PASS" && e.from_m && e.to_m && (!keyOnly || e.key)), [ev, keyOnly]);
  return (
    <g data-pass-arrows={String(drawn.length)} role="img" aria-label={dict.body.reports.passesDrawnAria.replace("{a}", String(drawn.length))}>
      <defs>
        {["#1e90ff", "#f5b82e"].map((c) => (
          <marker key={c} id={`pa-${c.slice(1)}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="1.8" markerHeight="1.8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>
        ))}
      </defs>
      {drawn.map((e) => {
        const c = e.key ? "#f5b82e" : "#1e90ff";
        return (
          <g key={e.id}>
            <title>{dict.body.reports.passArrowTitle.replace("{a}", describe(e, dict)).replace("{b}", matchClock(e.start_us)).replace("{c}", e.video_title).replace("{d}", e.evidence.toLowerCase())}</title>
            <line x1={px(e.from_m![0])} y1={py(e.from_m![1])} x2={px(e.to_m![0])} y2={py(e.to_m![1])} stroke={c} strokeWidth={0.5} markerEnd={`url(#pa-${c.slice(1)})`} opacity={0.9} />
            <circle cx={px(e.from_m![0])} cy={py(e.from_m![1])} r={0.7} fill={c} />
          </g>
        );
      })}
    </g>
  );
});

/** the heatmap of the whole match, or of one half (fetched when chosen) */
function useHalf(r: Report, range: Range): PlayerMeasures | null | undefined {
  const [m, setM] = useState<PlayerMeasures | null | undefined>(undefined);
  const id = r.player?.player_id;
  useEffect(() => {
    setM(undefined);
    if (!id || range === "full") return;
    let live = true;
    void api<PlayerMeasures>(`/v1/players/${id}/measures?half=${range === "h1" ? 1 : 2}`).then((x) => { if (live) setM(x); }, () => { if (live) setM(null); });
    return () => { live = false; };
  }, [id, range]);
  return range === "full" ? r.measures : m;
}

/** a GET for the chosen player (undefined while loading, null on failure) */
function useFetch<X>(r: Report, path: string | null): X | null | undefined {
  const [v, setV] = useState<X | null | undefined>(undefined);
  useEffect(() => {
    setV(undefined);
    if (!path) return;
    let live = true;
    void api<X>(path).then((x) => { if (live) setV(x); }, () => { if (live) setV(null); });
    return () => { live = false; };
  }, [path]);
  return r.player ? v : undefined;
}

const fmt = (v: number | null, unit: string) => (v === null ? "—" : `${v}${unit ? ` ${unit}` : ""}`);
const INSIGHT_ICONS: Record<string, [LucideIcon, string]> = { SPEED: [TrendingUp, "#3ee6a8"], PASSING: [Send, "#33a8ff"], POSITION: [Target, "#8a6cff"], WORK_RATE: [Gauge, "#3ee6a8"], BALL_WINNING: [Shield, "#f5b82e"] };

/** his events as a list: memoised, so a heatmap mode change does not rebuild every row */
const EventList = memo(function EventList({ listed, multiVideo }: { listed: PlayerEvent[]; multiVideo: boolean }) {
  const { t: dict } = useLocale();
  return (
    <div className="mt-2">
      <p className="mb-1.5 t-small">{dict.body.reports.eventsIntro.replace("{a}", String(listed.length))}</p>
      <ul aria-label={dict.body.reports.eventsAria} data-events={String(listed.length)} className="max-h-[368px] space-y-1 overflow-y-auto">
        {listed.map((e) => (
          <li key={e.id}>
            <Link href={`/analysis?video=${e.video_id}&t=${Math.max(0, Math.floor(e.start_us / 1e6) - 2)}`} data-event={e.kind}
              className="flex items-center gap-2.5 rounded-ctl border border-line/70 bg-[#06142a] px-2.5 py-1.5 t-body text-ink no-underline hover:border-primary/60">
              <span className="w-16 shrink-0 text-muted">{matchClock(e.start_us)}</span>
              <span className="min-w-0 flex-1 truncate">{describe(e, dict)}</span>
              {multiVideo && <span className="max-w-[150px] truncate t-small">{e.video_title}</span>}
              <Evidence level={e.evidence === "INFERRED" ? "INFERRED" : "DETECTED"} size={12} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
});

function LowerInner({ r }: { r: Report }) {
  const { t: dict } = useLocale();
  const [mode, setMode] = useState(0);
  const [group, setGroup] = useState<CohortGroup | "">("");
  const pid = r.player?.player_id;
  useEffect(() => { setGroup(""); }, [pid]);
  const cmp = useFetch<PlayerComparison>(r, pid ? `/v1/players/${pid}/comparison${group ? `?group=${group}` : ""}` : null);
  const ins = useFetch<PlayerInsights>(r, pid ? `/v1/players/${pid}/insights` : null);
  const pub = r.assessment?.published ?? null;
  const ev = usePlayerEvents(r);
  const [evf, setEvf] = useState<EvFilter>("all");
  const [act, setAct] = useState<"all" | "pass" | "key">("all");
  const listed = useMemo(() => (ev?.items ?? []).filter(FILTER[evf]), [ev, evf]);
  const passes = useMemo(() => (ev?.items ?? []).filter((e) => e.kind === "PASS"), [ev]);
  const placed = useMemo(() => passes.filter((e) => e.from_m && e.to_m), [passes]);
  const has = useCallback((f: EvFilter) => (ev?.items ?? []).some(FILTER[f]), [ev]);
  const [range, setRange] = useState<Range>("full");
  const hm = useHalf(r, range);
  const hv = r.measures?.halves;
  const known = !!hv && hv.confirmed + hv.proposed > 0;
  const noHalves = !r.player ? dict.body.reports.heatChoosePlayer : !known ? dict.body.reports.heatHalvesUnknown : undefined;
  const halfNote = range !== "full" && hv && hv.proposed > 0 ? (hv.confirmed ? dict.body.reports.heatHalfSomeProposed : dict.body.reports.heatHalfProposed) : "";
  /** the heatmap's empty state names a failed read instead of calling it "no data" (a null half read means failed; null full-range measures mean failed only when the measures read failed, else still loading) */
  const heatEmpty = mode !== 0 ? (mode === 1 ? dict.body.reports.heatTouchesNeed : dict.body.reports.heatTerritoryNeed)
    : !r.player ? dict.body.reports.heatNoData
    : hm === undefined ? dict.common.loading
    : hm === null ? (range === "full" && !r.measuresFailed ? dict.common.loading : dict.body.reports.heatLoadFailed)
    : range === "full" ? dict.body.reports.heatNoData : dict.body.reports.heatNoDataHalf;
  const section = "vie-panel p-4";
  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section id="p08-heat" aria-label={dict.body.reports.heatmap} data-section="p08-s07" className={`${section} ${hl(r.focus === "p08-heat")}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="t-panel flex items-center gap-2"><span className="block h-5 w-[3px] bg-primary" aria-hidden />{dict.body.reports.heatmap}</h2>
            <FlowSel<Range> label={dict.body.reports.heatRangeLabel} value={range} onChange={setRange}
              options={[["full", dict.body.library.rangeFull], noHalves ? ["h1", dict.body.library.rangeH1, noHalves] : ["h1", dict.body.library.rangeH1], noHalves ? ["h2", dict.body.library.rangeH2, noHalves] : ["h2", dict.body.library.rangeH2]]} />
          </div>
          <div role="radiogroup" aria-label={dict.body.reports.heatModeAria} className="mt-2 flex flex-wrap gap-1">
            {([dict.body.reports.heatmap, dict.body.reports.heatModeTouches, dict.body.reports.heatModeTerritory] as const).map((l, i) => (
              <button key={l} type="button" role="radio" aria-checked={mode === i} onClick={() => setMode(i)}
                className={`rounded-ctl px-2.5 py-1 text-xs font-normal ${mode === i ? "bg-primary text-white" : "border border-line text-muted hover:text-ink"}`}>{l}</button>
            ))}
          </div>
          <div className="relative mt-3">
            {mode === 0 && hm?.heat ? (
              <div data-player-heat={range} className="aspect-[105/68] w-full">
                <HeatPitch zones={hm.heat} label={range === "full" ? dict.body.reports.heatLabelFull : range === "h1" ? dict.body.reports.heatLabelHalf1 : dict.body.reports.heatLabelHalf2} />
                <p title={dict.body.reports.heatEndsNote} className="absolute inset-x-0 bottom-1 text-center text-xs text-[#e8f5ec] [text-shadow:0_0_3px_#000]">{measuredText(hm.heat, dict)}{halfNote}</p>
              </div>
            ) : (
              <div className="aspect-[105/68] w-full"><FlowPitch label={dict.body.reports.heatmap} />
                <p className="absolute inset-0 grid place-items-center"><span className="rounded-ctl bg-[#07142a]/80 px-3 py-1.5 t-body text-[#e6f3ea]">{heatEmpty}</span></p>
              </div>
            )}
          </div>
        </section>

        <section id="p08-events" aria-label={dict.body.reports.eventTimelineAria} data-section="p08-s08" className={`${section} ${hl(r.focus === "p08-events")}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="t-panel flex items-center gap-2"><span className="block h-5 w-[3px] bg-primary" aria-hidden />{dict.body.reports.eventTimeline}</h2>
            <FlowSel<EvFilter> label={dict.body.reports.eventFilterLabel} value={evf} onChange={setEvf}
              options={([["all", dict.body.reports.evFilterAll], ["pass", dict.body.reports.evFilterPasses], ["won", dict.body.reports.evFilterWon], ["press", dict.body.reports.evFilterPress], ["shot", dict.body.reports.evFilterShot], ["sp", dict.body.reports.evFilterSp]] as [EvFilter, string][])
                .map(([k, l]) => (k === "all" || has(k) ? [k, l] : [k, l, dict.body.reports.evFilterNone]) as [EvFilter, string] | [EvFilter, string, string])} />
          </div>
          {!listed.length ? (
            <p className="mt-6 text-center t-body text-muted">{!r.player ? dict.body.reports.choosePlayer : ev === undefined ? dict.common.loading : ev === null ? dict.body.reports.eventsLoadFailed
              : !ev.videos ? dict.body.reports.eventsNoBallFollowed : dict.body.reports.eventsNone}</p>
          ) : (<EventList listed={listed} multiVideo={!!ev && ev.videos > 1} />)}
        </section>

        <section id="p08-action" aria-label={dict.body.reports.actionMapAria} data-section="p08-s09" className={`${section} ${hl(r.focus === "p08-action")}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="t-panel flex items-center gap-2"><span className="block h-5 w-[3px] bg-primary" aria-hidden />{dict.body.reports.actionMap}</h2>
            <FlowSel label={dict.body.reports.actionFilterLabel} value={act} onChange={(v) => setAct(v as typeof act)}
              options={[["all", dict.body.reports.actFilterAll], ["pass", dict.body.reports.actFilterPasses], passes.some((e) => e.key) ? ["key", dict.body.reports.actFilterKey] : ["key", dict.body.reports.actFilterKey, dict.body.reports.actKeyNone],
                ["shot", dict.body.reports.actFilterShots, dict.body.reports.actShotsNone]]} />
          </div>
          <div className="relative mt-3">
            <FlowPitch label={dict.body.reports.actionMap}>
              {ev && placed.length > 0 && <PassArrows ev={ev} keyOnly={act === "key"} />}
            </FlowPitch>
            {ev && placed.length > 0 ? (
              <p title={dict.body.reports.passesPlacedTip} className="mt-1 text-center t-small">
                {dict.body.reports.passesPlaced.replace("{a}", String(placed.length)).replace("{b}", String(passes.length))}</p>
            ) : (
              <p className="absolute inset-0 grid place-items-center"><span className="rounded-ctl bg-[#07142a]/80 px-3 py-1.5 t-body text-[#e6f3ea]">{!r.player ? dict.body.reports.choosePlayer : ev === undefined ? dict.common.loading : passes.length ? dict.body.reports.passesNotCalibrated : dict.body.reports.passesNone}</span></p>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 t-small">
            <span className="flex items-center gap-1.5"><i className="block h-3 w-3 rounded-full bg-[#1e90ff]" aria-hidden />{dict.body.reports.evPass}</span>
            <span className="flex items-center gap-1.5"><i className="block h-3 w-3 rounded-full bg-[#f5b82e]" aria-hidden />{dict.body.reports.evKeyPass}</span>
            <span className="flex items-center gap-1.5"><i className="block h-3 w-3 rounded-full bg-[#ff4a3a]" aria-hidden />{dict.body.reports.evShot}</span>
            <span className="flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-ok" aria-hidden />{dict.body.reports.evGoal}</span>
            <span className="flex items-center gap-1.5"><i className="block h-0.5 w-6 bg-white" aria-hidden />{dict.body.reports.evCarry}</span>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section id="p08-compare" aria-label={dict.body.reports.comparisonTitle} data-section="p08-s10" className={`${section} ${hl(r.focus === "p08-compare")}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="t-panel">{dict.body.reports.comparisonTitle}</h2>
            {cmp ? (
              <FlowSel<CohortGroup> label={dict.body.reports.comparisonGroupLabel} value={cmp.group} onChange={setGroup}
                options={(["ALL", "GK", "DEF", "MID", "FWD"] as CohortGroup[]).map((g) => (cmp.groups.includes(g) ? [g, COHORT_LABEL(dict)[g]] : [g, COHORT_LABEL(dict)[g], dict.body.reports.cohortNotOne]) as [CohortGroup, string] | [CohortGroup, string, string])} />
            ) : <FlowSel label={dict.body.reports.comparisonGroupLabel} value="none"
              options={[["none", !r.player ? dict.body.reports.compareChoosePlayer : cmp === undefined ? dict.common.loading : dict.body.reports.compareLoadFailed]]} />}
          </div>
          <div className="mt-3 space-y-2.5">
            {(cmp?.metrics ?? [["Passes (p90)"], ["Key Passes (p90)"], ["Balls Won (p90)"], ["Distance (per 90 measured)"], ["Top Speed"]].map(([label]) => ({ label: label!, player: null, group_mean: null, max: null, unit: "", group_n: 0, key: label! }))).map((m) => {
              const bar = (v: number | null, w: number) => (v === null || !m.max ? 0 : Math.max(2, (v / m.max) * w));
              const mLabel = CMP_LABEL(dict)[m.label] ?? m.label;
              return (
                <div key={m.key} data-compare={m.label} title={cmp ? (m.group_n === 1 ? dict.body.reports.cmpTitleOne : dict.body.reports.cmpTitleMany).replace("{a}", mLabel).replace("{b}", fmt(m.player, m.unit)).replace("{c}", fmt(m.group_mean, m.unit)).replace("{d}", String(m.group_n)) : undefined}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 t-body">
                  <span className="truncate text-muted">{mLabel}</span>
                  <span className="text-right font-normal text-primary">{fmt(m.player, m.unit === "km/h" ? "" : m.unit)}</span>
                  <span className="h-3 overflow-hidden rounded bg-[#122b4d]"><span className="block h-3 rounded bg-primary" style={{ width: `${bar(m.player, 100)}%` }} /></span>
                  <span className="flex items-center gap-2"><span className="h-3 w-[72px] overflow-hidden rounded bg-[#122b4d]"><span className="block h-3 rounded bg-[#4d6482]" style={{ width: `${bar(m.group_mean, 100)}%` }} /></span><span className="text-muted">{fmt(m.group_mean, "")}</span></span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 t-small">
            <span className="flex items-center gap-1.5"><i className="block h-3 w-3 rounded-full bg-primary" aria-hidden />{dict.body.reports.legendSelectedPlayer}</span>
            <span className="flex items-center gap-1.5"><i className="block h-3 w-3 rounded-full bg-[#4d6482]" aria-hidden />{dict.body.reports.legendComparisonGroup}</span>
            {cmp && <span title={cmp.basis} data-cohort-n={String(cmp.n)} className="ml-auto">
              {cmp.n === 1 ? dict.body.reports.cohortLineOne.replace("{a}", cmp.group_name).replace("{b}", cmp.player_below_minimum ? dict.body.reports.cohortShortTime : "") : dict.body.reports.cohortLineMany.replace("{a}", cmp.group_name).replace("{b}", String(cmp.n)).replace("{c}", cmp.player_below_minimum ? dict.body.reports.cohortShortTime : "")}</span>}
          </div>
        </section>

        <section aria-label={dict.body.reports.insightsAria} data-section="p08-s11" className={section}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="t-panel flex items-center gap-2"><span className="block h-5 w-[3px] bg-primary" aria-hidden />{dict.body.reports.insightsTitle}</h2>
            <span title={ins?.basis ?? dict.body.reports.insightsTip} className="rounded-ctl border border-line bg-canvas px-2 py-0.5 text-xs text-primary">{dict.body.reports.insightsEngineData}</span>
          </div>
          <div className="mt-3 space-y-2">
            {([0, 1, 2, 3] as const).map((i) => {
              const it = ins?.items[i];
              const [Icon, c] = it ? INSIGHT_ICONS[it.kind] ?? [TrendingUp, "#3ee6a8"] : [TrendingUp, "#3ee6a8"];
              return (
                <div key={i} data-insight={it?.kind ?? ""} title={it ? `${it.text} (${it.source})` : undefined}
                  className="flex items-center gap-3 rounded-ctl border border-line/70 bg-[#071a33] px-3 py-2">
                  <Icon className="h-6 w-6 shrink-0" style={{ color: c }} aria-hidden />
                  {it ? (
                    <div className="min-w-0"><p className="truncate t-panel">{it.text}</p><p className="truncate t-small">{it.source}</p></div>
                  ) : (
                    <div className="min-w-0"><p className="truncate t-panel">{i > 0 ? "—" : !r.player ? dict.body.reports.choosePlayer : ins === undefined ? dict.common.loading : ins === null ? dict.body.reports.insightsLoadFailed : dict.body.reports.insightsNone}</p>
                    {i === 0 && !it && r.player && ins !== undefined && ins !== null && <p className="t-small">{dict.body.reports.insightsHintA} {dict.body.reports.insightsHintB}</p>}</div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section id="p08-scout" aria-label={dict.body.reports.scoutingReportAria} data-section="p08-s12" className={`${section} ${hl(r.focus === "p08-scout")}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="t-panel flex items-center gap-2"><FileText className="h-5 w-5 text-ok" aria-hidden />{dict.body.reports.scoutingReport}</h2>
            <button type="button" onClick={() => (r.player ? r.open("read") : r.pick())}
              className="vie-btn vie-btn-pri vie-btn-sm">{dict.body.reports.viewFullReport}<ChevronRight className="h-4 w-4" aria-hidden /></button>
          </div>
          <div className="mt-3 flex gap-3">
            <div className="w-[104px] shrink-0 rounded-ctl border border-line/70 bg-[#06142a] p-2 text-center">
              <p className="t-small">{dict.body.reports.overallRating}</p>
              <div className="relative mx-auto mt-1 grid h-[72px] w-[72px] place-items-center rounded-full"
                style={pub?.rating != null ? { background: `conic-gradient(#3ee6a8 ${pub.rating * 36}deg, #0a2a52 0)` } : { border: "6px solid #0a2a52" }}>
                {pub?.rating != null && <div className="grid h-[56px] w-[56px] place-items-center rounded-full bg-[#06142a]" />}
                <div className="absolute inset-0 grid place-items-center"><div className="text-center"><div className="t-metric" data-rating={pub?.rating ?? ""}>{pub?.rating != null ? String(pub.rating) : "—"}</div><div className="t-small text-muted">/ 10</div></div></div>
              </div>
            </div>
            <div className="min-w-0 flex-1 rounded-ctl border border-line/70 bg-[#06142a] p-2">
              {pub?.criteria.length ? pub.criteria.slice(0, 4).map((c) => (
                <div key={c.name} data-criterion={c.name} className="flex items-center gap-2 py-1 text-xs">
                  <span className="w-32 shrink-0 truncate">{c.name}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded bg-[#122b4d]"><span className="block h-2 rounded bg-ok" style={{ width: `${c.score * 10}%` }} /></span>
                  <span className="w-6 shrink-0 text-right">{String(c.score)}</span>
                </div>
              )) : <p className="py-2 text-center t-body text-muted">{pub ? dict.body.reports.criteriaNone : dict.body.reports.assessmentNone}</p>}
            </div>
          </div>
          <div className="mt-3 rounded-ctl border border-line/70 bg-[#06142a] p-2">
            {pub?.notes ? <p className="whitespace-pre-wrap t-body text-muted">{pub.notes}</p> : <p className="t-body text-muted">{dict.body.reports.noScoutNotes}</p>}
          </div>
          <p className={`mt-2 text-right text-xs italic ${pub ? "text-amber" : "text-muted"}`}>
            {pub ? dict.body.reports.analystOpinionWhen.replace("{a}", r.assessment?.published_by_name ?? "").replace("{b}", r.assessment?.published_at?.slice(0, 10) ?? "") : dict.body.reports.awaitingAssessment}</p>
        </section>
      </div>

      {/* AI Analyst (ADR-141): the assessment panel, below the reference's sections. It renders only for a chosen player. */}
      {r.player && <AiAnalystPanel playerId={r.player.player_id} canAssess={r.can.assess} />}
    </>
  );
}
export const Lower = memo(LowerInner);
