"use client";
/**
 * Page 08 Sections 07-12 — Heatmap, Event Timeline, Action Map, Comparison, Rule-built Insights (was Generated Insights, v3 Phase 0), Scouting Report
 * (approved reference 08_PLAYER_REPORT, lower half).
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
import Link from "next/link";
import { HeatPitch, measuredText } from "@/components/workspace/HeatPitch";
import { Evidence } from "@/components/evidence/Evidence";
import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { Sel } from "@/components/tactics/kit";
import { Hit } from "@/components/workspace/shared";
import type { Report } from "./Top";
import { AiAnalystPanel } from "./AiAnalystPanel";

const hl = (on: boolean) => (on ? { borderColor: "#33a8ff" } : undefined);
const sel: CSSProperties = { background: "#041022", borderColor: "#17406f", borderRadius: u(8) };

function Pitch({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const ix = w * 0.03, iy = h * 0.05;
  const line = { position: "absolute" as const, border: `${u(2)} solid rgba(255,255,255,.85)`, boxSizing: "border-box" as const };
  const pa = (left: boolean, ww: number, hh: number) => (
    <B x={left ? x + ix : x + w - ix - ww} y={y + h / 2 - hh / 2} w={ww} h={hh} style={{ ...line, [left ? "borderLeft" : "borderRight"]: "none" }} />
  );
  return (
    <>
      <B x={x} y={y} w={w} h={h} style={{ background: `repeating-linear-gradient(90deg,#1d5c25 0,#1d5c25 ${u(w / 14)},#236b2b ${u(w / 14)},#236b2b ${u((w / 14) * 2)})`, borderRadius: u(4) }} />
      <B x={x + ix} y={y + iy} w={w - 2 * ix} h={h - 2 * iy} style={line} />
      <B x={x + w / 2 - 1} y={y + iy} w={2} h={h - 2 * iy} style={{ background: "rgba(255,255,255,.85)" }} />
      <B x={x + w / 2 - h * 0.14} y={y + h / 2 - h * 0.14} w={h * 0.28} h={h * 0.28} style={{ ...line, borderRadius: "50%" }} />
      {pa(true, w * 0.15, h * 0.5)}{pa(false, w * 0.15, h * 0.5)}{pa(true, w * 0.06, h * 0.25)}{pa(false, w * 0.06, h * 0.25)}
    </>
  );
}
const Badge = ({ x, y, children }: { x: number; y: number; children: string }) => (
  <B x={x - 90} y={y - 18} w={180} h={36} style={{ background: "rgba(7,20,42,.78)", borderRadius: u(6), fontSize: u(20), color: "#e6f3ea", display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap" }}>{children}</B>
);
const Title = ({ x, y, size, bar, children }: { x: number; y: number; size: number; bar: [number, number]; children: string }) => (
  <>
    <B x={bar[0]} y={bar[1]} w={3} h={34} style={{ background: "#1e90ff" }} />
    <T x={x} y={y} size={size} weight={size >= 25 ? 700 : 600} as="h2">{children}</T>
  </>
);

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
const PassArrows = memo(function PassArrows({ ev, x, y, w, h, keyOnly }: { ev: PlayerEvents; x: number; y: number; w: number; h: number; keyOnly: boolean }) {
  const { t: dict } = useLocale();
  const ix = w * 0.03, iy = h * 0.05, L = ev.length_m, Wd = ev.width_m;
  const px = (m: number) => ix + ((m + L / 2) / L) * (w - 2 * ix), py = (m: number) => iy + ((m + Wd / 2) / Wd) * (h - 2 * iy);
  const drawn = useMemo(() => ev.items.filter((e) => e.kind === "PASS" && e.from_m && e.to_m && (!keyOnly || e.key)), [ev, keyOnly]);
  return (
    <svg data-pass-arrows={String(drawn.length)} role="img" aria-label={dict.body.reports.passesDrawnAria.replace("{a}", String(drawn.length))}
      viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", left: u(x), top: u(y - 101), width: u(w), height: u(h), overflow: "visible" }}>
      <defs>
        {["#1e90ff", "#f5b82e"].map((c) => (
          <marker key={c} id={`pa-${c.slice(1)}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>
        ))}
      </defs>
      {drawn.map((e) => {
        const c = e.key ? "#f5b82e" : "#1e90ff";
        return (
          <g key={e.id}>
            <title>{dict.body.reports.passArrowTitle.replace("{a}", describe(e, dict)).replace("{b}", matchClock(e.start_us)).replace("{c}", e.video_title).replace("{d}", e.evidence.toLowerCase())}</title>
            <line x1={px(e.from_m![0])} y1={py(e.from_m![1])} x2={px(e.to_m![0])} y2={py(e.to_m![1])} stroke={c} strokeWidth={3} markerEnd={`url(#pa-${c.slice(1)})`} opacity={0.9} />
            <circle cx={px(e.from_m![0])} cy={py(e.from_m![1])} r={4} fill={c} />
          </g>
        );
      })}
    </svg>
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
const INSIGHT_ICONS: Record<string, [string, string]> = { SPEED: ["trend", "#3ee6a8"], PASSING: ["pick", "#33a8ff"], POSITION: ["tgt", "#8a6cff"], WORK_RATE: ["dbl", "#3ee6a8"], BALL_WINNING: ["shield", "#f5b82e"] };

/** his events as a list: memoised, so a heatmap mode change does not rebuild every row */
const EventList = memo(function EventList({ listed, multiVideo }: { listed: PlayerEvent[]; multiVideo: boolean }) {
  const { t: dict } = useLocale();
  return (
    <div className="absolute" style={{ left: u(1112), top: u(716 - 101), width: u(654), height: u(368), overflowY: "auto" }}>
      <p style={{ margin: `0 0 ${u(6)}`, fontSize: u(14), color: "#8ea3bf" }}>{dict.body.reports.eventsIntro.replace("{a}", String(listed.length))}</p>
      <ul aria-label={dict.body.reports.eventsAria} data-events={String(listed.length)} style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {listed.map((e) => (
          <li key={e.id}>
            <Link href={`/analysis?video=${e.video_id}&t=${Math.max(0, Math.floor(e.start_us / 1e6) - 2)}`} data-event={e.kind}
              style={{ display: "flex", alignItems: "center", gap: u(10), padding: `${u(6)} ${u(10)}`, marginBottom: u(4), borderRadius: u(6), background: "#06142a",
                border: `${u(1.5)} solid #12335f`, color: "#e3eefb", textDecoration: "none", fontSize: u(17) }}>
              <span style={{ width: u(64), flex: "none", color: "#8ea3bf" }}>{matchClock(e.start_us)}</span>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{describe(e, dict)}</span>
              {multiVideo && <span style={{ maxWidth: u(150), fontSize: u(13), color: "#8ea3bf", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.video_title}</span>}
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
  return (
    <>
      <section id="p08-heat" aria-label={dict.body.reports.heatmap} data-section="p08-s07">
        <P x={387} y={657} w={694} h={436} style={hl(r.focus === "p08-heat")} />
        <Title x={421} y={687} size={25} bar={[401, 672]}>{dict.body.reports.heatmap}</Title>
        <B x={543} y={672} w={334} h={34} style={{ background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(8) }} />
        <B x={[543, 660, 777][mode]!} y={672} w={[117, 117, 100][mode]!} h={34} style={{ background: "#0a84ff", borderRadius: u(6) }} />
        <div role="radiogroup" aria-label={dict.body.reports.heatModeAria}>
          {([[dict.body.reports.heatmap, 543, 117, 601], [dict.body.reports.heatModeTouches, 660, 117, 714], [dict.body.reports.heatModeTerritory, 777, 100, 822]] as const).map(([l, x, w, tx], i) => (
            <div key={l}>
              <T x={mode === i ? x + w / 2 : tx} y={689} size={17} weight={mode === i ? 600 : 400} color={mode === i ? "#fff" : "#b9cbe2"} align={mode === i ? "center" : "left"}>{l}</T>
              <Hit x={x} y={672} w={w} h={34} label={l} pressed={mode === i} onClick={() => setMode(i)} />
            </div>
          ))}
        </div>
        <Sel<Range> x={889} y={670} w={179} h={38} label={dict.body.reports.heatRangeLabel} value={range} onChange={setRange} options={[["full", dict.body.library.rangeFull], noHalves ? ["h1", dict.body.library.rangeH1, noHalves] : ["h1", dict.body.library.rangeH1], noHalves ? ["h2", dict.body.library.rangeH2, noHalves] : ["h2", dict.body.library.rangeH2]]} style={sel} />
        <Pitch x={410} y={720} w={652} h={344} />
        {mode === 0 && hm?.heat ? (
          <div data-player-heat={range} style={{ position: "absolute", left: u(410), top: u(720 - 101), width: u(652), height: u(344) }}>
            <HeatPitch zones={hm.heat} label={range === "full" ? dict.body.reports.heatLabelFull : range === "h1" ? dict.body.reports.heatLabelHalf1 : dict.body.reports.heatLabelHalf2} />
            <div title={dict.body.reports.heatEndsNote} style={{ position: "absolute", left: 0, right: 0, bottom: u(4), textAlign: "center", fontSize: u(15), color: "#e8f5ec", textShadow: "0 0 3px #000" }}>{measuredText(hm.heat, dict)}{halfNote}</div>
          </div>
        ) : <Badge x={736} y={760}>{heatEmpty}</Badge>}
      </section>

      <section id="p08-events" aria-label={dict.body.reports.eventTimelineAria} data-section="p08-s08">
        <P x={1096} y={657} w={685} h={436} style={hl(r.focus === "p08-events")} />
        <Title x={1128} y={685} size={22} bar={[1111, 670]}>{dict.body.reports.eventTimeline}</Title>
        <Sel<EvFilter> x={1546} y={669} w={216} h={37} label={dict.body.reports.eventFilterLabel} value={evf} onChange={setEvf} style={sel}
          options={([["all", dict.body.reports.evFilterAll], ["pass", dict.body.reports.evFilterPasses], ["won", dict.body.reports.evFilterWon], ["press", dict.body.reports.evFilterPress], ["shot", dict.body.reports.evFilterShot], ["sp", dict.body.reports.evFilterSp]] as [EvFilter, string][])
            .map(([k, l]) => (k === "all" || has(k) ? [k, l] : [k, l, dict.body.reports.evFilterNone]) as [EvFilter, string] | [EvFilter, string, string])} />
        {!listed.length ? (
          <T x={1438} y={880} size={19} color="#8ea3bf" align="center">{!r.player ? dict.body.reports.choosePlayer : ev === undefined ? dict.common.loading : ev === null ? dict.body.reports.eventsLoadFailed
            : !ev.videos ? dict.body.reports.eventsNoBallFollowed : dict.body.reports.eventsNone}</T>
        ) : (<EventList listed={listed} multiVideo={!!ev && ev.videos > 1} />)}
      </section>

      <section id="p08-action" aria-label={dict.body.reports.actionMapAria} data-section="p08-s09">
        <P x={1797} y={657} w={741} h={436} style={hl(r.focus === "p08-action")} />
        <Title x={1835} y={687} size={25} bar={[1813, 670]}>{dict.body.reports.actionMap}</Title>
        <Sel x={2239} y={669} w={283} h={39} label={dict.body.reports.actionFilterLabel} value={act} onChange={(v) => setAct(v as typeof act)} style={sel}
          options={[["all", dict.body.reports.actFilterAll], ["pass", dict.body.reports.actFilterPasses], passes.some((e) => e.key) ? ["key", dict.body.reports.actFilterKey] : ["key", dict.body.reports.actFilterKey, dict.body.reports.actKeyNone],
            ["shot", dict.body.reports.actFilterShots, dict.body.reports.actShotsNone]]} />
        <Pitch x={1815} y={716} w={706} h={329} />
        {ev && placed.length ? (
          <>
            <PassArrows ev={ev} x={1815} y={716} w={706} h={329} keyOnly={act === "key"} />
            <div style={{ position: "absolute", left: u(1815), top: u(1020 - 101), width: u(706), textAlign: "center", fontSize: u(14), color: "#e8f5ec", textShadow: "0 0 3px #000" }}
              title={dict.body.reports.passesPlacedTip}>
              {dict.body.reports.passesPlaced.replace("{a}", String(placed.length)).replace("{b}", String(passes.length))}</div>
          </>
        ) : <Badge x={2168} y={760}>{!r.player ? dict.body.reports.choosePlayer : ev === undefined ? dict.common.loading : passes.length ? dict.body.reports.passesNotCalibrated : dict.body.reports.passesNone}</Badge>}
        {([[dict.body.reports.evPass, 1827, 1865, "#1e90ff"], [dict.body.reports.evKeyPass, 1935, 1971, "#f5b82e"], [dict.body.reports.evShot, 2068, 2105, "#ff4a3a"]] as const).map(([l, x, tx, c]) => (
          <div key={l}><B x={x} y={1060} w={20} h={20} style={{ borderRadius: "50%", background: c }} /><T x={tx} y={1070} size={18} color="#cfe0f5">{l}</T></div>
        ))}
        <Ic x={2194} y={1070} k="star" size={26} color="#3ee6a8" fill="#3ee6a8" /><T x={2228} y={1070} size={18} color="#cfe0f5">{dict.body.reports.evGoal}</T>
        <B x={2295} y={1069} w={70} h={2} style={{ background: "#fff" }} /><T x={2387} y={1070} size={18} color="#cfe0f5">{dict.body.reports.evCarry}</T>
      </section>

      <section id="p08-compare" aria-label={dict.body.reports.comparisonTitle} data-section="p08-s10">
        <P x={24} y={1108} w={829} h={299} style={hl(r.focus === "p08-compare")} />
        <T x={45} y={1137} size={26} weight={700} as="h2">{dict.body.reports.comparisonTitle}</T>
        {cmp ? (
          <Sel<CohortGroup> x={463} y={1118} w={373} h={39} label={dict.body.reports.comparisonGroupLabel} value={cmp.group} onChange={setGroup} style={sel}
            options={(["ALL", "GK", "DEF", "MID", "FWD"] as CohortGroup[]).map((g) => (cmp.groups.includes(g) ? [g, COHORT_LABEL(dict)[g]] : [g, COHORT_LABEL(dict)[g], dict.body.reports.cohortNotOne]) as [CohortGroup, string] | [CohortGroup, string, string])} />
        ) : <Sel x={463} y={1118} w={373} h={39} label={dict.body.reports.comparisonGroupLabel} value="none" options={[["none", !r.player ? dict.body.reports.compareChoosePlayer : cmp === undefined ? dict.common.loading : dict.body.reports.compareLoadFailed]]} style={sel} />}
        <B x={38} y={1166} w={800} h={1} style={{ background: "#12335f" }} />
        {(cmp?.metrics ?? [["Passes (p90)"], ["Key Passes (p90)"], ["Balls Won (p90)"], ["Distance (per 90 measured)"], ["Top Speed"]].map(([label]) => ({ label: label!, player: null, group_mean: null, max: null, unit: "", group_n: 0, key: label! }))).map((m, i) => {
          const y = [1195, 1229, 1263, 1298, 1332][i]!;
          const bar = (v: number | null, w: number) => (v === null || !m.max ? 0 : Math.max(2, (v / m.max) * w));
          const mLabel = CMP_LABEL(dict)[m.label] ?? m.label;
          return (
            <div key={m.key} data-compare={m.label} title={cmp ? (m.group_n === 1 ? dict.body.reports.cmpTitleOne : dict.body.reports.cmpTitleMany).replace("{a}", mLabel).replace("{b}", fmt(m.player, m.unit)).replace("{c}", fmt(m.group_mean, m.unit)).replace("{d}", String(m.group_n)) : undefined}>
              <T x={50} y={y} size={18} color="#d6e4f7">{mLabel}</T>
              <B x={276} y={y - 8} w={313} h={16} style={{ background: "#122b4d", borderRadius: u(3) }} />
              <B x={276} y={y - 8} w={bar(m.player, 313)} h={16} style={{ background: "#1e90ff", borderRadius: u(3) }} />
              <T x={606} y={y} size={19} weight={600} color="#33a8ff">{fmt(m.player, m.unit === "km/h" ? "" : m.unit)}</T>
              <B x={684} y={y - 8} w={89} h={16} style={{ background: "#122b4d", borderRadius: u(3) }} />
              <B x={684} y={y - 8} w={bar(m.group_mean, 89)} h={16} style={{ background: "#4d6482", borderRadius: u(3) }} />
              <T x={793} y={y} size={18} color="#cfe0f5">{fmt(m.group_mean, "")}</T>
            </div>
          );
        })}
        <B x={46} y={1363} w={24} h={24} style={{ borderRadius: "50%", background: "#1e90ff" }} /><T x={88} y={1377} size={16} color="#cfe0f5">{dict.body.reports.legendSelectedPlayer}</T>
        <B x={257} y={1365} w={24} h={24} style={{ borderRadius: "50%", background: "#4d6482" }} /><T x={300} y={1377} size={16} color="#cfe0f5">{dict.body.reports.legendComparisonGroup}</T>
        {cmp && <span title={cmp.basis} data-cohort-n={String(cmp.n)}><T x={830} y={1377} size={15} color="#8ea3bf" align="right">
          {cmp.n === 1 ? dict.body.reports.cohortLineOne.replace("{a}", cmp.group_name).replace("{b}", cmp.player_below_minimum ? dict.body.reports.cohortShortTime : "") : dict.body.reports.cohortLineMany.replace("{a}", cmp.group_name).replace("{b}", String(cmp.n)).replace("{c}", cmp.player_below_minimum ? dict.body.reports.cohortShortTime : "")}</T></span>}
      </section>

      <section aria-label={dict.body.reports.insightsAria} data-section="p08-s11">
        <P x={867} y={1108} w={913} h={299} />
        <B x={879} y={1124} w={3} h={30} style={{ background: "#1e90ff" }} />
        <T x={897} y={1136} size={24} weight={700} as="h2">{dict.body.reports.insightsTitle}</T>
        <B x={1108} y={1124} w={127} h={30} style={{ background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6) }} />
        <B x={1121} y={1134} w={11} h={11} style={{ borderRadius: "50%", background: "#33a8ff" }} />
        <span title={ins?.basis ?? dict.body.reports.insightsTip}><T x={1141} y={1139} size={15} color="#33a8ff">{dict.body.reports.insightsEngineData}</T></span>
        {([[1163, 61, "trend", "#3ee6a8"], [1230, 48, "pick", "#33a8ff"], [1285, 52, "tgt", "#8a6cff"], [1344, 53, "shield", "#f5b82e"]] as const).map(([y, h, icon0, c0], i) => {
          const it = ins?.items[i];
          const [icon, c] = it ? INSIGHT_ICONS[it.kind] ?? [icon0, c0] : [icon0, c0];
          return (
            <div key={y} data-insight={it?.kind ?? ""} title={it ? `${it.text} (${it.source})` : undefined}>
              <B x={881} y={y} w={883} h={h} style={{ background: "#071a33", border: `${u(1.5)} solid #12335f`, borderRadius: u(8) }} />
              <Ic x={924} y={y + h / 2} k={icon} size={38} color={c} />
              {it ? (
                <>
                  <T x={983} y={y + h / 2 - 9} size={17} weight={600} style={{ maxWidth: u(765), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.text}</T>
                  <T x={983} y={y + h / 2 + 13} size={13} color="#8ea3bf" style={{ maxWidth: u(765), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.source}</T>
                </>
              ) : <T x={983} y={y + h / 2} size={21} weight={600}>{i > 0 ? "—" : !r.player ? dict.body.reports.choosePlayer : ins === undefined ? dict.common.loading : ins === null ? dict.body.reports.insightsLoadFailed : dict.body.reports.insightsNone}</T>}
              {i === 0 && !it && r.player && ins !== undefined && ins !== null && <><T x={1264} y={y + 20} size={16} color="#b9cbe2">{dict.body.reports.insightsHintA}</T><T x={1264} y={y + 42} size={16} color="#b9cbe2">{dict.body.reports.insightsHintB}</T></>}
            </div>
          );
        })}
      </section>

      <section id="p08-scout" aria-label={dict.body.reports.scoutingReportAria} data-section="p08-s12">
        <P x={1797} y={1108} w={741} h={299} style={hl(r.focus === "p08-scout")} />
        <Ic x={1834} y={1140} k="doc" size={34} color="#3ee6a8" />
        <T x={1865} y={1140} size={24} weight={600} as="h2">{dict.body.reports.scoutingReport}</T>
        <B x={2343} y={1120} w={181} h={39} style={{ background: "#0a84ff", borderRadius: u(6), opacity: r.player ? 1 : 0.6 }} />
        <T x={2362} y={1140} size={17} weight={600}>{dict.body.reports.viewFullReport}</T><Ic x={2503} y={1140} k="fwd" size={16} />
        <Hit x={2343} y={1120} w={181} h={39} label={dict.body.reports.viewFullReport} onClick={() => (r.player ? r.open("read") : r.pick())} />
        <B x={1814} y={1167} w={226} h={230} style={{ background: "#06142a", border: `${u(1.5)} solid #12335f`, borderRadius: u(10) }} />
        <T x={1847} y={1189} size={18}>{dict.body.reports.overallRating}</T>
        <B x={1848} y={1203} w={144} h={144} style={{ borderRadius: "50%", boxSizing: "border-box",
          background: pub?.rating != null ? `conic-gradient(#3ee6a8 ${pub.rating * 36}deg, #0a2a52 0)` : undefined, border: pub?.rating != null ? undefined : `${u(13)} solid #0a2a52` }} />
        {pub?.rating != null && <B x={1861} y={1216} w={118} h={118} style={{ borderRadius: "50%", background: "#06142a" }} />}
        <T x={1920} y={1268} size={42} weight={700} align="center" data-rating={pub?.rating ?? ""}>{pub?.rating != null ? String(pub.rating) : "—"}</T>
        <T x={1920} y={1305} size={16} color="#8ea3bf" align="center">/ 10</T>
        <B x={2051} y={1167} w={473} h={118} style={{ background: "#06142a", border: `${u(1.5)} solid #12335f`, borderRadius: u(10) }} />
        {pub?.criteria.length ? pub.criteria.slice(0, 4).map((c, i) => {
          const y = 1188 + i * 26;
          return (
            <div key={c.name} data-criterion={c.name}>
              <T x={2068} y={y} size={15} color="#cfe0f5" style={{ maxWidth: u(170), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</T>
              <B x={2250} y={y - 6} w={220} h={12} style={{ background: "#122b4d", borderRadius: u(3) }} /><B x={2250} y={y - 6} w={22 * c.score} h={12} style={{ background: "#3ee6a8", borderRadius: u(3) }} />
              <T x={2508} y={y} size={15} align="right">{String(c.score)}</T>
            </div>
          );
        }) : <T x={2287} y={1226} size={17} color="#8ea3bf" align="center">{pub ? dict.body.reports.criteriaNone : dict.body.reports.assessmentNone}</T>}
        <B x={2051} y={1293} w={473} h={104} style={{ background: "#06142a", border: `${u(1.5)} solid #12335f`, borderRadius: u(10) }} />
        {pub?.notes ? <div className="absolute" style={{ left: u(2066), top: u(1300 - 101), width: u(445), height: u(58), overflow: "hidden", fontSize: u(15), lineHeight: 1.3, color: "#b9cbe2" }}>{pub.notes}</div>
          : <T x={2102} y={1307} size={16} color="#b9cbe2">{dict.body.reports.noScoutNotes}</T>}
        <T x={2500} y={1373} size={16} color={pub ? "#f1a824" : "#8ea3bf"} align="right" style={{ fontStyle: "italic", maxWidth: u(440), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {pub ? dict.body.reports.analystOpinionWhen.replace("{a}", r.assessment?.published_by_name ?? "").replace("{b}", r.assessment?.published_at?.slice(0, 10) ?? "") : dict.body.reports.awaitingAssessment}</T>
      </section>

      {/* AI Analyst (ADR-141): the assessment panel, below the reference's sections; the stage gets the
          extra room from ReportStage. It renders only for a chosen player. */}
      {r.player && <AiAnalystPanel playerId={r.player.player_id} canAssess={r.can.assess} />}
    </>
  );
}
export const Lower = memo(LowerInner);
