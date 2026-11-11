"use client";
/**
 * Page 08 Sections 02-06 — report rail, player hero, Identity & Evidence (was Tracking Confidence, v3 Phase 0: identity confirmed by a
 * person or not, and evidence coverage = his on-camera time measured on a calibrated pitch; never an accuracy score), Player Role &
 * Summary, nine KPI cards
 * (approved reference 08_PLAYER_REPORT, 2560 x 1440 composition).
 *
 * Recorded: the registry's facts (name, OTSI Player ID or "provisional, no ID yet", state) and what the footage measured from the tracks a
 * person CONFIRMED as this player (`/v1/players/:id/measures`): time seen on camera, distance and top speed over measured stretches, the
 * heat map, the detector's confidence on those tracks. Club, shirt number and position come from his latest match team sheet; nationality,
 * age and foot from the Players list (a person records them there); height and weight are not recorded: "—". The Player Role & Summary card
 * shows the published scouting assessment (a person's opinion, marked so); Edit writes it. Add to Scouting Dossier, Export PDF, Share Link and
 * the rail's Notes & Tags open their dialogs (ADR-056). Rail entries move to the section they name.
 */
import { HIGH_SPEED_KMH, SPRINT_KMH, type PlayerAssessment, type PlayerIdentity, type PlayerMeasures, type PlayerProfile } from "@otsi-vie/contracts";
import Link from "next/link";
import { memo, useMemo } from "react";
import { FOOT_NAMES } from "@/components/players/PlayersList";
import { Evidence, type EvidenceLevel } from "@/components/evidence/Evidence";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { copyLink, MoreMenu } from "@/components/stage/MoreMenu";
import { Hit } from "@/components/workspace/shared";
import type { DialogName } from "./Dialogs";
import { useLocale, type Dictionary } from "@/lib/i18n";

export interface Report {
  player: PlayerIdentity | null;
  missing: string | null;
  focus: string | null;
  selected: number;
  go(i: number): void;
  pick(): void;
  /** what the footage measured about this player (null while loading or without a player) */
  measures: PlayerMeasures | null;
  /** the measures read failed (measures null then means failed, not loading) */
  measuresFailed: boolean;
  /** what a person recorded on the Players list, and his latest team sheet entry (null while loading or without a player) */
  profile: PlayerProfile | null;
  /** the scouting assessment (published version shown; null while loading or without a player) */
  assessment: PlayerAssessment | null;
  /** open one of the page's dialogs (ADR-056) */
  open(d: DialogName): void;
  /** the signed-in person's role allows: notes / tags / dossiers / PDFs, the assessment, share links */
  can: { write: boolean; assess: boolean; share: boolean };
}

export const RAIL: [string, number, string, string | null][] = [["Overview", 231, "chk", "p08-overview"], ["Performance", 296, "user", "p08-kpi"], ["Attacking Analysis", 362, "ball", "p08-kpi"],
  ["Passing Analysis", 428, "arr", "p08-action"], ["Defensive Actions", 494, "shield", "p08-action"], ["Heatmaps", 561, "grid", "p08-heat"], ["Event Timeline", 627, "ring", "p08-events"],
  ["Comparisons", 692, "user", "p08-compare"], ["Scouting Report", 762, "bag", "p08-scout"], ["Video Clips", 828, "cam", null], ["Notes & Tags", 895, "note", null]];

const KPIS: [string, number, number, string][] = [["Match Minutes", 388, 247, "clock"], ["Distance (Est.)", 647, 247, "run"], ["Top Speed", 907, 238, "dbl"], ["Sprints", 1157, 205, "dbl"],
  ["Passes", 1374, 234, "ball"], ["Key Passes", 1621, 222, "key"], ["Shots", 1856, 220, "tgt"], ["xG", 2089, 217, "bars"], ["xA", 2319, 219, "share"]];

const RAIL_LABEL = (d: Dictionary): string[] => [d.body.reports.railOverview, d.body.reports.railPerformance, d.body.reports.railAttacking, d.body.reports.railPassing,
  d.body.reports.railDefensive, d.body.reports.railHeatmaps, d.body.reports.railEvents, d.body.reports.railComparisons, d.body.reports.railScouting,
  d.body.reports.railVideoClips, d.body.reports.railNotesTags];
const KPI_LABEL = (d: Dictionary): Record<string, string> => ({
  "Match Minutes": d.body.reports.kpiMatchMinutes, "Distance (Est.)": d.body.reports.kpiDistance, "Top Speed": d.body.reports.kpiTopSpeed, Sprints: d.body.reports.kpiSprints,
  Passes: d.body.reports.kpiPasses, "Key Passes": d.body.reports.kpiKeyPasses, Shots: d.body.reports.kpiShots, xG: d.body.reports.kpiXg, xA: d.body.reports.kpiXa,
});

/** B.24 (ADR-099): what each tile's coverage line counts (xG and xA: nothing, they are not measured) */
const KPI_COVER: Record<string, "TIME" | "MOVEMENT" | "EVENTS"> = {
  "Match Minutes": "TIME", "Distance (Est.)": "MOVEMENT", "Top Speed": "MOVEMENT", Sprints: "MOVEMENT", Passes: "EVENTS", "Key Passes": "EVENTS", Shots: "EVENTS",
};

const hl = (on: boolean) => (on ? { borderColor: "#33a8ff" } : undefined);

/** how each KPI is known (ADR-063): time on camera and events are detected, movement is inferred from pitch positions; xG and xA are
 *  not measured by the engine */
const KPI_EVIDENCE: Record<string, EvidenceLevel> = {
  "Match Minutes": "DETECTED", "Distance (Est.)": "INFERRED", "Top Speed": "INFERRED", Sprints: "INFERRED", Passes: "DETECTED", "Key Passes": "DETECTED",
  Shots: "DETECTED", xG: "NOT_MEASURED", xA: "NOT_MEASURED",
};

function RailInner({ r }: { r: Report }) {
  const { t: dict } = useLocale();
  return (
    <section aria-label="Report sections" data-section="p08-s02">
      <P x={22} y={115} w={348} h={978} />
      <T x={44} y={158} size={28} weight={700} as="h2">{dict.body.reports.reportTitle}</T>
      <B x={28} y={RAIL[r.selected]![1] - 32} w={334} h={61} style={{ background: "#0a2b55", border: `${u(2)} solid #1e90ff`, borderRadius: u(8) }} />
      <nav aria-label="Report sections">
        {RAIL.map(([l, y, icon, target], i) => {
          const on = r.selected === i, label = RAIL_LABEL(dict)[i]!;
          return (
            <div key={l}>
              {icon === "chk" ? (<><B x={50} y={y - 12} w={24} h={24} style={{ border: `${u(2)} solid #fff`, borderRadius: u(4) }} /><Ic x={62} y={y} k="chk" size={16} /></>)
                : <Ic x={62} y={y} k={icon} size={28} color={on ? "#fff" : "#d6e4f7"} />}
              <T x={109} y={y} size={24} weight={on ? 600 : 400} color={on ? "#fff" : "#d6e4f7"}>{label}</T>
              <Hit x={28} y={y - 32} w={334} h={62} label={label} pressed={on} onClick={i === 10 ? () => (r.player ? r.open("notes") : r.pick()) : () => r.go(i)} />
            </div>
          );
        })}
      </nav>
    </section>
  );
}
export const Rail = memo(RailInner);

function HeroInner({ r }: { r: Report }) {
  const { t: dict } = useLocale();
  const p = r.player;
  const idText = !p ? null : p.canonical_otsi_id ?? dict.body.reports.provisionalPlayer;
  const pr = r.profile, team = pr?.latest_team ?? null;
  const foot = pr?.preferred_foot ? FOOT_NAMES(dict)[pr.preferred_foot]! : "—";
  /** the identity & evidence figures, computed once per measures read instead of on every render */
  const evidence = useMemo(() => {
    const m = r.measures, confirmed = !!m?.tracks, cov = m && m.seen_s > 0 ? Math.max(0, Math.min(1, m.measured_s / m.seen_s)) : null;
    return { confirmed, cov };
  }, [r.measures]);
  return (
    <section id="p08-overview" aria-label="Player identity" data-section="p08-s03" data-player={p?.player_id ?? ""}>
      <P x={387} y={115} w={2151} h={372} style={{ background: "linear-gradient(90deg,#0a2a5a,#071a38 55%,#06122a)", overflow: "hidden", ...hl(r.focus === "p08-overview") }} />
      <B x={420} y={115} w={485} h={372} style={{ background: "radial-gradient(circle at 50% 38%,#e8b898 0,#c98c6a 14%,transparent 15%),radial-gradient(ellipse at 50% 90%,#6fb8ee,#3a86c8 40%,transparent 60%),linear-gradient(180deg,#10244a,#0a1a38)", opacity: 0.9 }} />
      <B x={929} y={197} w={78} h={61} style={{ background: "#1e90ff", borderRadius: u(6), fontSize: u(44), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{team?.jersey_number ?? "—"}</B>
      <T x={1035} y={224} size={58} weight={700} as="h1" style={{ maxWidth: u(660), overflow: "hidden", textOverflow: "ellipsis" }}>{p?.display_name ?? dict.body.reports.noPlayerSelected}</T>
      <T x={1035} y={276} size={22} color="#33a8ff" style={{ maxWidth: u(125), overflow: "hidden", textOverflow: "ellipsis" }}>{team?.position ?? pr?.position ?? dict.body.workspace.positionDash}</T>
      {[1166, 1228, 1290].map((x, i) => <B key={x} x={x} y={265} w={[56, 55, 57][i]!} h={28} style={{ background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6), fontSize: u(17), color: "#9fc8f5", display: "flex", alignItems: "center", justifyContent: "center" }}>—</B>)}
      {idText && <T x={1390} y={276} size={20} color={p?.canonical_otsi_id ? "#3ee6a8" : "#f5b82e"} style={{ maxWidth: u(330), overflow: "hidden", textOverflow: "ellipsis" }}>{idText}</T>}
      <B x={935} y={308} w={60} h={58} style={{ borderRadius: "50%", background: "radial-gradient(circle,#f2c56b,#6cc4ff 70%,#fff)" }} />
      <T x={1015} y={338} size={24} style={{ maxWidth: u(190), overflow: "hidden", textOverflow: "ellipsis" }}>{team?.team ?? dict.body.reelstage.teamDash}</T>
      <B x={1213} y={320} w={2} h={36} style={{ background: "#2a4a75" }} />
      <B x={1241} y={318} w={58} h={39} style={{ background: "#3a5a88", borderRadius: u(4) }} />
      <T x={1314} y={338} size={24} style={{ maxWidth: u(260), overflow: "hidden", textOverflow: "ellipsis" }}>{pr?.nationality?.name ?? dict.body.reports.nationalityDash}</T>
      {p && <Link href={`/players?player=${p.player_id}`} className="absolute" style={{ left: u(1600), top: u(338 - 101 - 14), fontSize: u(19), color: "#33a8ff" }}>{dict.body.reports.editProfile}</Link>}
      {([[dict.body.reports.heroAge, 963, pr?.age ?? "—"], [dict.body.reports.heroHeight, 1082, "—"], [dict.body.reports.heroWeight, 1242, "—"], [dict.body.reports.heroFoot, 1410, foot]] as const).map(([l, x, v]) => (
        <div key={l}><T x={x} y={399} size={18} color="#b9cbe2" align="center">{l}</T><T x={x} y={431} size={26} weight={600} align="center">{String(v)}</T></div>
      ))}
      {[1017, 1168, 1320].map((x) => <B key={x} x={x} y={390} w={2} h={56} style={{ background: "#2a4a75" }} />)}

      <Hit x={1035} y={186} w={680} h={80} label={p ? dict.body.reports.chooseAnother : dict.body.reports.choosePlayer} onClick={r.pick} />
      <B x={1035} y={450} w={230} h={30} style={{ border: `${u(1.5)} solid #1f5a9c`, borderRadius: u(6), background: "#0a2a55" }} />
      <T x={1150} y={465} size={18} weight={600} color="#33a8ff" align="center">{p ? dict.body.reports.chooseAnotherChevron : dict.body.reports.choosePlayerChevron}</T>
      <Hit x={1035} y={450} w={230} h={30} label={dict.body.reports.choosePlayer} onClick={r.pick} />
      {r.missing && <T x={1290} y={465} size={18} color="#ff8a8a">{r.missing}</T>}

      <B x={1725} y={130} w={297} h={50} style={{ background: "#0a84ff", borderRadius: u(8), opacity: p ? 1 : 0.6 }} />
      <Ic x={1751} y={155} k="doc" size={28} /><T x={1778} y={155} size={21} weight={600}>{dict.body.reports.addToDossier}</T>
      <Hit x={1725} y={130} w={297} h={50} label={dict.body.reports.addToDossier} onClick={() => (p ? r.open("dossier") : r.pick())} />
      {([[dict.body.reports.exportPdf, 2040, 198, "pdf", 2078, 2110, "pdf"], [dict.body.reports.shareLink, 2256, 196, "link", 2292, 2330, "share"]] as const).map(([l, x, w, icon, ix, tx, d]) => (
        <div key={l}>
          <B x={x} y={130} w={w} h={50} style={{ background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(8), opacity: p ? 1 : 0.7 }} />
          <Ic x={ix} y={155} k={icon} size={28} /><T x={tx} y={155} size={21} weight={600}>{l}</T>
          <Hit x={x} y={130} w={w} h={50} label={l} onClick={() => (p ? r.open(d) : r.pick())} />
        </div>
      ))}
      <B x={2469} y={130} w={54} h={50} style={{ background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(8) }} />
      <MoreMenu x={2496} y={155} w={54} h={50} size={28} color="#fff" label={dict.body.reports.moreForPlayer}
        items={p ? [
          { label: dict.body.reports.menuEditProfile, href: `/players?player=${p.player_id}` },
          { label: dict.body.matches.menuMakeReel, href: "/reels" },
          { label: dict.body.reports.menuHisReels, href: `/library?q=${encodeURIComponent(p.display_name)}` },
          { label: dict.body.reports.menuCopyReportLink, run: () => copyLink(`/reports/players/${p.canonical_otsi_id ?? p.player_id}`) },
          { label: dict.body.reports.chooseAnother, run: r.pick },
        ] : [{ label: dict.body.reports.choosePlayer, run: r.pick }, { label: dict.body.reports.menuPlayersList, href: "/players" }]} />

      {/* Identity & Evidence (v3 Phase 0, was Tracking Confidence) */}
      {(() => {
        const { confirmed, cov } = evidence;
        return (
          <>
            <B x={1581} y={196} w={365} h={280} style={{ background: "rgba(4,16,34,.7)", border: `${u(1.5)} solid #12335f`, borderRadius: u(12) }} />
            <T x={1616} y={224} size={22}>{dict.body.reports.identityEvidence}</T>
            <div title={dict.body.reports.identityEvidenceTip}><Ic x={1855} y={224} k="help" size={26} color="#8ea3bf" /></div>
            <B x={1599} y={257} w={156} h={156} style={{ borderRadius: "50%", background: cov != null ? `conic-gradient(#1e90ff ${cov * 100}%,#0a2a52 0)` : "#0a2a52" }} />
            <B x={1615} y={273} w={124} h={124} style={{ borderRadius: "50%", background: "#06142a" }} />
            <T x={1677} y={325} size={34} weight={700} align="center">{cov != null ? `${Math.round(cov * 100)}%` : "—"}</T>
            <T x={1677} y={358} size={14} color="#8ea3bf" align="center">{dict.body.reports.evidenceCoverage}</T>
            <B x={1767} y={280} w={132} h={35} style={{ background: confirmed ? "#0d3a2e" : "#1a2840", border: `${u(1.5)} solid ${confirmed ? "#19c48a" : "#4a5a78"}`, borderRadius: u(6) }} />
            <B x={1779} y={293} w={11} h={11} style={{ borderRadius: "50%", background: confirmed ? "#3ee6a8" : "#8ea3bf" }} />
            <T x={1798} y={298} size={18} weight={600} color="#dfe8f5">{confirmed ? dict.body.reports.confirmedShort : dict.body.reports.unverifiedShort}</T>
          </>
        );
      })()}
      <T x={1767} y={395} size={17} color="#8ea3bf">{r.measures?.tracks ? (r.measures.tracks === 1 ? dict.body.reports.tracksOne : dict.body.reports.tracksMany.replace("{a}", String(r.measures.tracks))) : r.measuresFailed ? dict.body.reports.couldNotBeLoaded : dict.body.reports.noTrackingData}</T>
      <T x={1767} y={421} size={17} color="#8ea3bf">{r.measures?.tracks ? (r.measures.videos === 1 ? dict.body.reports.inVideosOne : dict.body.reports.inVideosMany.replace("{a}", String(r.measures.videos))) : r.measuresFailed ? dict.body.reports.choosePlayerAgain : dict.body.reports.forPlayerYet}</T>

      {/* Player Role & Summary */}
      <B x={1964} y={196} w={574} h={280} style={{ background: "rgba(4,16,34,.7)", border: `${u(1.5)} solid #12335f`, borderRadius: u(12) }} />
      <T x={1987} y={223} size={22} weight={600}>{dict.body.reports.roleSummary}</T>
      <B x={2419} y={208} w={92} h={37} style={{ background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(8), opacity: p && r.can.assess ? 1 : 0.7 }} />
      <Ic x={2445} y={227} k="edit" size={20} /><T x={2467} y={227} size={18}>{dict.body.library.editBtn}</T>
      {!p ? <Hit x={2419} y={208} w={92} h={37} label={dict.body.reports.editRoleSummary} onClick={r.pick} />
        : r.can.assess ? <Hit x={2419} y={208} w={92} h={37} label={dict.body.reports.editRoleSummary} onClick={() => r.open("assess")} />
        : <Hit x={2419} y={208} w={92} h={37} label={dict.body.reports.editRoleSummary} reason={dict.body.reports.cannotWriteAssessments} />}
      {(() => {
        const a = r.assessment?.published;
        if (!a || (!a.role && !a.summary && !a.traits.length)) return (
          <>
            <T x={1987} y={268} size={24} weight={600}>{dict.body.reports.roleNotAssessed}</T>
            <T x={1990} y={303} size={20} color="#b9cbe2">{r.assessment?.unpublished_changes && r.can.assess ? dict.body.reports.draftWritten : dict.body.reports.analystSummaryHere}</T>
            <T x={1988} y={401} size={17} color="#8ea3bf">{dict.body.reports.noTraits}</T>
          </>
        );
        return (
          <div data-role-published title={dict.body.reports.analystOpinionPublished.replace("{a}", r.assessment!.published_by_name ?? "")}>
            <T x={1987} y={268} size={24} weight={600} style={{ maxWidth: u(420), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.role || dict.body.reports.roleNotGiven}</T>
            <div className="absolute" style={{ left: u(1990), top: u(290 - 101), width: u(525), height: u(88), overflow: "hidden", fontSize: u(18), lineHeight: 1.3, color: "#b9cbe2" }}>{a.summary}</div>
            <div className="absolute" style={{ left: u(1988), top: u(388 - 101), width: u(525), height: u(30), overflow: "hidden", display: "flex", gap: u(6) }}>
              {a.traits.map((t) => <span key={t} style={{ fontSize: u(15), padding: `${u(2)} ${u(8)}`, borderRadius: u(10), border: `${u(1.5)} solid #1d4f8a`, color: "#cfe0f5", whiteSpace: "nowrap" }}>{t}</span>)}
            </div>
            <T x={1988} y={445} size={14} color="#f1a824" style={{ fontStyle: "italic" }}>{dict.body.reports.analystOpinionBy.replace("{a}", r.assessment!.published_by_name ?? "")}</T>
          </div>
        );
      })()}
    </section>
  );
}
export const Hero = memo(HeroInner);

/** the measured value and its note for a KPI card, or undefined (not measured) */
function measured(l: string, m: PlayerMeasures | null, d: Dictionary): [string, string, string] | undefined {
  if (!m || !m.tracks) return undefined;
  const min = (s: number) => d.body.reports.minSuffix.replace("{a}", String(Math.round(s / 60)));
  if (l === "Match Minutes" && m.seen_s > 0) return [min(m.seen_s), d.body.reports.kpiSeenOnCamera, d.body.reports.kpiMinutesTip];
  if (l === "Distance (Est.)" && m.distance_m != null) return [m.distance_m >= 1000 ? `${(m.distance_m / 1000).toFixed(2)} km` : `${m.distance_m} m`, d.body.reports.kpiOverMeasured.replace("{a}", min(m.measured_s)),
    d.body.reports.kpiDistanceTip.replace("{a}", min(m.measured_s)).replace("{b}", min(m.seen_s)).replace("{c}", m.dropped_steps ? d.body.reports.kpiDroppedSteps.replace("{a}", String(m.dropped_steps)) : "")];
  if (l === "Top Speed" && m.top_speed_kmh != null) return [`${m.top_speed_kmh} km/h`, d.body.reports.held2s, d.body.reports.kpiSpeedTip];
  if (l === "Sprints" && m.sprint_m != null) return [String(m.sprints), d.body.reports.kpiSprintM.replace("{a}", String(m.sprint_m)),
    d.body.reports.kpiSprintsTip.replace("{a}", String(SPRINT_KMH)).replace("{b}", String(m.high_speed_m ?? 0)).replace("{c}", String(HIGH_SPEED_KMH))];
  const e = m.events, over = e ? (e.videos === 1 ? d.body.reports.kpiBallFollowedOne : d.body.reports.kpiBallFollowedMany.replace("{a}", String(e.videos))) : "";
  if (e && l === "Passes") return [String(e.passes), d.body.reports.kpiReceived.replace("{a}", String(e.passes_received)), d.body.reports.kpiPassesTip.replace("{a}", over)];
  if (e && l === "Key Passes") return [String(e.key_passes), d.body.reports.kpiFoundByEngine, d.body.reports.kpiKeyPassesTip.replace("{a}", over)];
  if (e && l === "Shots") return [String(e.shots), d.body.reports.kpiBallsWon.replace("{a}", String(e.balls_won)), d.body.reports.kpiShotsTip.replace("{a}", over)];
  return undefined;
}

/** the coverage line under a KPI tile, in the person's language (contracts kpiCoverage, same formats) */
const coverText = (kind: "TIME" | "MOVEMENT" | "EVENTS", m: PlayerMeasures | null, d: Dictionary): string | null => {
  if (!m || !m.tracks || m.seen_s <= 0) return null;
  const videos = m.videos === 1 ? d.body.reports.coverVideoOne : d.body.reports.coverVideosMany.replace("{a}", String(m.videos));
  if (kind === "TIME") return d.body.reports.coverTime.replace("{a}", m.tracks === 1 ? d.body.reports.tracksOne : d.body.reports.tracksMany.replace("{a}", String(m.tracks))).replace("{b}", videos);
  if (kind === "MOVEMENT") return m.measured_s > 0 ? d.body.reports.coverMovement.replace("{a}", `${Math.round((100 * Math.min(m.measured_s, m.seen_s)) / m.seen_s)} %`) : null;
  const e = m.events;
  return e ? d.body.reports.coverBallFollowed.replace("{a}", String(e.videos)).replace("{b}", videos) : null;
};

/** one KPI card: measured() is computed once, not once per field, and the card only re-renders when its own inputs change */
const KpiCard = memo(function KpiCard({ label, x, w, icon, first, measures, measuresFailed, focused }: {
  label: string; x: number; w: number; icon: string; first: boolean; measures: PlayerMeasures | null; measuresFailed: boolean; focused: boolean;
}) {
  const { t: dict } = useLocale();
  const m = measured(label, measures, dict);
  const cover = m && KPI_COVER[label] ? coverText(KPI_COVER[label]!, measures, dict) : null;
  return (
    <div data-kpi={label} title={measuresFailed ? dict.body.reports.kpiLoadFailedTip : m?.[2] ?? dict.body.reports.kpiNotMeasuredYet}>
      <P x={x} y={505} w={w} h={132} style={{ ...(first ? { borderLeft: `${u(4)} solid #1e90ff` } : {}), ...hl(focused) }} />
      <T x={x + 40} y={531} size={21} color="#d6e4f7">{KPI_LABEL(dict)[label] ?? label}</T>
      <Ic x={x + 60} y={586} k={icon} size={44} color="#1e90ff" />
      {m && <B x={x + w - 32} y={520} w={20} h={20}><Evidence level={KPI_EVIDENCE[label] ?? "DETECTED"} compact size={12} /></B>}
      {measuresFailed
        ? <T x={x + 104} y={575} size={19} color="#ff8a8a">{dict.body.reports.kpiLoadFailed}</T>
        : m || !measures
          ? <T x={x + 104} y={575} size={30} weight={700}>{m?.[0] ?? "—"}</T>
          : <T x={x + 104} y={575} size={19} color="#8ea3bf">{dict.body.reports.notMeasured}</T>}
      <T x={x + 104} y={609} size={19} color="#b9cbe2">{measuresFailed ? dict.body.reports.kpiCouldNotLoad : m?.[1] ?? (measures && KPI_EVIDENCE[label] === "NOT_MEASURED" ? dict.body.reports.kpiNotMeasured : "—")}</T>
      {cover && (
        <T x={x + 14} y={628} size={13} color="#7f97b5" style={{ maxWidth: u(w - 28), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <span data-kpi-coverage>{cover}</span></T>
      )}
    </div>
  );
});

function KpisInner({ r }: { r: Report }) {
  const { t: dict } = useLocale();
  return (
    <section id="p08-kpi" aria-label={dict.body.reports.keyMetrics} data-section="p08-s06" data-cards={String(KPIS.length)}>
      {KPIS.map(([l, x, w, icon], i) => (
        <KpiCard key={l} label={l} x={x} w={w} icon={icon} first={i === 0} measures={r.measures} measuresFailed={r.measuresFailed} focused={r.focus === "p08-kpi"} />
      ))}
    </section>
  );
}
export const Kpis = memo(KpisInner);
