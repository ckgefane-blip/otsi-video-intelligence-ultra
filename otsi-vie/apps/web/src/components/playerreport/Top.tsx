"use client";
/**
 * Page 08 Sections 02-06 — report rail, player hero, Identity & Evidence (was Tracking Confidence, v3 Phase 0: identity confirmed by a
 * person or not, and evidence coverage = his on-camera time measured on a calibrated pitch; never an accuracy score), Player Role &
 * Summary, nine KPI cards.
 *
 * Drop 1 layout: the same sections, controls and API reads as the 2560-px DesignStage composition, laid out in the page's flow on the
 * Desktop UI shell (AppRail / AppTopBar / StatusBar from the (app) layout) with the shared `vie-panel` / `vie-btn` classes and the
 * Drop 1 `ActionsMenu` for the hero's More menu. Nothing was removed or rewired.
 *
 * Recorded: the registry's facts (name, OTSI Player ID or "provisional, no ID yet", state) and what the footage measured from the tracks a
 * person CONFIRMED as this player (`/v1/players/:id/measures`): time seen on camera, distance and top speed over measured stretches, the
 * heat map, the detector's confidence on those tracks. Club, shirt number and position come from his latest match team sheet; nationality,
 * age and foot from the Players list (a person records them there); height and weight from the profile details he entered there, "—" when
 * not entered. The Player Role & Summary card shows the published scouting assessment (a person's opinion, marked so); Edit writes it.
 * Add to Scouting Dossier, Export PDF, Share Link and the rail's Notes & Tags open their dialogs (ADR-056). Rail entries move to the
 * section they name. The hero photo is the photo he uploaded on the Players list (`profile.details.photo_url`); with no photo it says so
 * in words — never a gradient stand-in.
 */
import { HIGH_SPEED_KMH, SPRINT_KMH, type PlayerAssessment, type PlayerIdentity, type PlayerMeasures, type PlayerProfile } from "@otsi-vie/contracts";
import { ArrowLeftRight, BarChart3, CheckSquare, Clapperboard, Clock, FileText, Gauge, KeyRound, LayoutGrid, ListOrdered, Route, Send, Share2, Shield, StickyNote, Target, User, Users, Zap, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { memo, useMemo, type ComponentType } from "react";
import { ActionsMenu } from "@/components/media/ActionsMenu";
import { FOOT_NAMES } from "@/components/players/PlayersList";
import { Evidence, type EvidenceLevel } from "@/components/evidence/Evidence";
import { copyLink, type MoreItem } from "@/components/stage/MoreMenu";
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

const RAIL_ICONS: LucideIcon[] = [CheckSquare, User, Target, ArrowLeftRight, Shield, LayoutGrid, ListOrdered, Users, FileText, Clapperboard, StickyNote];

const KPIS: [string, ComponentType<{ className?: string }>][] = [["Match Minutes", Clock], ["Distance (Est.)", Route], ["Top Speed", Gauge], ["Sprints", Zap],
  ["Passes", Send], ["Key Passes", KeyRound], ["Shots", Target], ["xG", BarChart3], ["xA", Share2]];

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

/** how each KPI is known (ADR-063): time on camera and events are detected, movement is inferred from pitch positions; xG and xA are
 *  not measured by the engine */
const KPI_EVIDENCE: Record<string, EvidenceLevel> = {
  "Match Minutes": "DETECTED", "Distance (Est.)": "INFERRED", "Top Speed": "INFERRED", Sprints: "INFERRED", Passes: "DETECTED", "Key Passes": "DETECTED",
  Shots: "DETECTED", xG: "NOT_MEASURED", xA: "NOT_MEASURED",
};

function RailInner({ r }: { r: Report }) {
  const { t: dict } = useLocale();
  const link = "flex h-9 items-center gap-3 rounded-md px-2.5 text-[13px] font-normal leading-5 text-[rgb(var(--ink2))] hover:bg-raised hover:text-ink";
  const on = "bg-raised text-ink shadow-[inset_2px_0_0_rgb(var(--primary))]";
  return (
    <aside aria-label="Report sections" data-section="p08-s02" className="w-full shrink-0 lg:w-60">
      <div className="min-w-0 border-t border-line pt-3 lg:sticky lg:top-4">
        <div className="flex items-center justify-between gap-2 pb-1"><h2 className="t-panel">{dict.body.reports.reportTitle}</h2></div>
        <nav aria-label="Report sections" className="flex flex-col gap-0.5 p-2">
          {RAIL.map(([l, , ,], i) => {
            const selected = r.selected === i, label = RAIL_LABEL(dict)[i]!;
            const Icon = RAIL_ICONS[i]!;
            return (
              <button key={l} type="button" aria-label={label} aria-pressed={selected} aria-current={selected ? "true" : undefined}
                onClick={i === 10 ? () => (r.player ? r.open("notes") : r.pick()) : () => r.go(i)}
                className={`${link} ${selected ? on : ""}`}>
                <Icon className={`h-[18px] w-[18px] shrink-0 ${selected ? "text-primary" : ""}`} aria-hidden />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
export const Rail = memo(RailInner);

function HeroInner({ r }: { r: Report }) {
  const { t: dict } = useLocale();
  const p = r.player;
  const idText = !p ? null : p.canonical_otsi_id ?? dict.body.reports.provisionalPlayer;
  const pr = r.profile, team = pr?.latest_team ?? null;
  const foot = pr?.preferred_foot ? FOOT_NAMES(dict)[pr.preferred_foot]! : "—";
  const height = pr?.details?.height_cm != null ? `${pr.details.height_cm} cm` : "—";
  const weight = pr?.details?.weight_kg != null ? `${pr.details.weight_kg} kg` : "—";
  const photo = pr?.details?.photo_url ?? null;
  /** the identity & evidence figures, computed once per measures read instead of on every render */
  const evidence = useMemo(() => {
    const m = r.measures, confirmed = !!m?.tracks, cov = m && m.seen_s > 0 ? Math.max(0, Math.min(1, m.measured_s / m.seen_s)) : null;
    return { confirmed, cov };
  }, [r.measures]);
  const { confirmed, cov } = evidence;
  const moreItems: MoreItem[] = p ? [
    { label: dict.body.reports.menuEditProfile, href: `/players?player=${p.player_id}` },
    { label: dict.body.matches.menuMakeReel, href: "/reels" },
    { label: dict.body.reports.menuHisReels, href: `/library?q=${encodeURIComponent(p.display_name)}` },
    { label: dict.body.reports.menuCopyReportLink, run: () => copyLink(`/reports/players/${p.canonical_otsi_id ?? p.player_id}`) },
    { label: dict.body.reports.chooseAnother, run: r.pick },
  ] : [{ label: dict.body.reports.choosePlayer, run: r.pick }, { label: dict.body.reports.menuPlayersList, href: "/players" }];
  const a = r.assessment?.published ?? null;
  return (
    <section id="p08-overview" aria-label="Player identity" data-section="p08-s03" data-player={p?.player_id ?? ""}
      className={`min-w-0 border-t border-line pt-3 ${r.focus === "p08-overview" ? "border-primary" : ""}`}>
      <div className="flex flex-wrap gap-5 p-4">
        <div className="w-28 shrink-0">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt={p?.display_name ?? ""} className="h-36 w-28 rounded-ctl border border-line object-cover" />
          ) : (
            <div className="grid h-36 w-28 place-items-center rounded-ctl border border-line p-2 text-center t-small">{dict.body.players.noPhotoYet}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-ctl bg-primary t-metric text-white" aria-label={dict.body.players.teamNumber}>{team?.jersey_number ?? "—"}</span>
            <h1 className="min-w-0 truncate t-page">{p?.display_name ?? dict.body.reports.noPlayerSelected}</h1>
            <span className="t-section text-primary">{team?.position ?? pr?.position ?? dict.body.workspace.positionDash}</span>
          </div>
          {idText && <p className={`mt-1 truncate t-panel ${p?.canonical_otsi_id ? "text-ok" : "text-amber"}`}>{idText}</p>}
          <p className="mt-1 truncate t-body text-muted">{team?.team ?? dict.body.reelstage.teamDash} · {pr?.nationality?.name ?? dict.body.reports.nationalityDash}</p>
          <dl className="mt-3 grid max-w-md grid-cols-4 gap-3 text-center">
            {([[dict.body.reports.heroAge, pr?.age ?? "—"], [dict.body.reports.heroHeight, height], [dict.body.reports.heroWeight, weight], [dict.body.reports.heroFoot, foot]] as const).map(([l, v]) => (
              <div key={l}><dt className="t-small">{l}</dt><dd className="mt-0.5 t-panel">{String(v)}</dd></div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={r.pick} className="vie-btn">{p ? dict.body.reports.chooseAnotherChevron : dict.body.reports.choosePlayerChevron}</button>
            <button type="button" onClick={() => (p ? r.open("dossier") : r.pick())} className="vie-btn vie-btn-pri">{dict.body.reports.addToDossier}</button>
            <button type="button" onClick={() => (p ? r.open("pdf") : r.pick())} className="vie-btn">{dict.body.reports.exportPdf}</button>
            <button type="button" onClick={() => (p ? r.open("share") : r.pick())} className="vie-btn">{dict.body.reports.shareLink}</button>
            {p && <Link href={`/players?player=${p.player_id}`} className="vie-btn">{dict.body.reports.editProfile}</Link>}
            <ActionsMenu label={dict.body.reports.moreForPlayer} items={moreItems} />
          </div>
          {r.missing && <p role="alert" className="mt-2 t-body text-danger">{r.missing}</p>}
        </div>
        {/* Identity & Evidence (v3 Phase 0, was Tracking Confidence) */}
        <div className="w-full rounded-ctl border border-line bg-canvas/60 p-3 sm:w-72" title={dict.body.reports.identityEvidenceTip}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="t-panel">{dict.body.reports.identityEvidence}</h2>
            <span className={`rounded px-1.5 py-0.5 text-xs font-normal ${confirmed ? "bg-ok/20 text-ok" : "bg-raised text-muted"}`}>{confirmed ? dict.body.reports.confirmedShort : dict.body.reports.unverifiedShort}</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="relative grid h-[104px] w-[104px] shrink-0 place-items-center rounded-full" style={{ background: cov != null ? `conic-gradient(#1e90ff ${cov * 100}%,#0a2a52 0)` : "#0a2a52" }}>
              <div className="grid h-[80px] w-[80px] place-items-center rounded-full bg-[#06142a]">
                <div className="text-center"><div className="t-metric">{cov != null ? `${Math.round(cov * 100)}%` : "—"}</div>
                <div className="mt-0.5 t-small text-muted">{dict.body.reports.evidenceCoverage}</div></div>
              </div>
            </div>
            <div className="min-w-0 t-body text-muted">
              <p>{r.measures?.tracks ? (r.measures.tracks === 1 ? dict.body.reports.tracksOne : dict.body.reports.tracksMany.replace("{a}", String(r.measures.tracks))) : r.measuresFailed ? dict.body.reports.couldNotBeLoaded : dict.body.reports.noTrackingData}</p>
              <p className="mt-1">{r.measures?.tracks ? (r.measures.videos === 1 ? dict.body.reports.inVideosOne : dict.body.reports.inVideosMany.replace("{a}", String(r.measures.videos))) : r.measuresFailed ? dict.body.reports.choosePlayerAgain : dict.body.reports.forPlayerYet}</p>
            </div>
          </div>
        </div>
      </div>
      {/* Player Role & Summary */}
      <div className="border-t border-line p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="t-panel">{dict.body.reports.roleSummary}</h2>
          {!p ? <button type="button" onClick={r.pick} className="vie-btn vie-btn-sm">{dict.body.library.editBtn}</button>
            : r.can.assess ? <button type="button" onClick={() => r.open("assess")} className="vie-btn vie-btn-sm">{dict.body.library.editBtn}</button>
            : <button type="button" disabled title={dict.body.reports.cannotWriteAssessments} className="vie-btn vie-btn-sm">{dict.body.library.editBtn}</button>}
        </div>
        {!a || (!a.role && !a.summary && !a.traits.length) ? (
          <div className="mt-2">
            <p className="font-normal">{dict.body.reports.roleNotAssessed}</p>
            <p className="mt-1 t-body text-muted">{r.assessment?.unpublished_changes && r.can.assess ? dict.body.reports.draftWritten : dict.body.reports.analystSummaryHere}</p>
            <p className="mt-2 t-body text-muted">{dict.body.reports.noTraits}</p>
          </div>
        ) : (
          <div data-role-published title={dict.body.reports.analystOpinionPublished.replace("{a}", r.assessment!.published_by_name ?? "")}>
            <p className="mt-2 truncate t-section font-normal">{a.role || dict.body.reports.roleNotGiven}</p>
            <p className="mt-1 whitespace-pre-wrap t-body text-muted">{a.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {a.traits.map((t) => <span key={t} className="rounded-full border border-primary/50 px-2 py-0.5 text-xs">{t}</span>)}
            </div>
            <p className="mt-2 text-xs italic text-amber">{dict.body.reports.analystOpinionBy.replace("{a}", r.assessment!.published_by_name ?? "")}</p>
          </div>
        )}
      </div>
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
const KpiCard = memo(function KpiCard({ label, Icon, first, measures, measuresFailed, focused }: {
  label: string; Icon: ComponentType<{ className?: string }>; first: boolean; measures: PlayerMeasures | null; measuresFailed: boolean; focused: boolean;
}) {
  const { t: dict } = useLocale();
  const m = measured(label, measures, dict);
  const cover = m && KPI_COVER[label] ? coverText(KPI_COVER[label]!, measures, dict) : null;
  return (
    <div data-kpi={label} title={measuresFailed ? dict.body.reports.kpiLoadFailedTip : m?.[2] ?? dict.body.reports.kpiNotMeasuredYet}
      className={`min-w-0 border-t border-line pt-2 ${first ? "border-l-4 border-l-primary pl-2" : ""} ${focused ? "border-primary" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="t-small">{KPI_LABEL(dict)[label] ?? label}</span>
        {m && <Evidence level={KPI_EVIDENCE[label] ?? "DETECTED"} compact size={12} />}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Icon className="h-6 w-6 shrink-0 text-primary" aria-hidden />
        {measuresFailed
          ? <span className="t-panel text-danger">{dict.body.reports.kpiLoadFailed}</span>
          : m || !measures
            ? <span className="truncate t-metric">{m?.[0] ?? "—"}</span>
            : <span className="t-body text-muted">{dict.body.reports.notMeasured}</span>}
      </div>
      <p className="mt-1 truncate t-small">{measuresFailed ? dict.body.reports.kpiCouldNotLoad : m?.[1] ?? (measures && KPI_EVIDENCE[label] === "NOT_MEASURED" ? dict.body.reports.kpiNotMeasured : "—")}</p>
      {cover && <p className="mt-0.5 truncate t-small text-muted"><span data-kpi-coverage>{cover}</span></p>}
    </div>
  );
});

function KpisInner({ r }: { r: Report }) {
  const { t: dict } = useLocale();
  return (
    <section id="p08-kpi" aria-label={dict.body.reports.keyMetrics} data-section="p08-s06" data-cards={String(KPIS.length)}
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-9">
      {KPIS.map(([l, Icon], i) => (
        <KpiCard key={l} label={l} Icon={Icon} first={i === 0} measures={r.measures} measuresFailed={r.measuresFailed} focused={r.focus === "p08-kpi"} />
      ))}
    </section>
  );
}
export const Kpis = memo(KpisInner);

/** a subset of the KPI cards, for the Attacking / Passing / Defensive tabs (SOT Page 17) */
export function KpiSubset({ r, labels }: { r: Report; labels: string[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-cards={String(labels.length)}>
      {labels.map((l) => {
        const found = KPIS.find(([name]) => name === l);
        if (!found) return null;
        const [, Icon] = found;
        return <KpiCard key={l} label={l} Icon={Icon} first={false} measures={r.measures} measuresFailed={r.measuresFailed} focused={false} />;
      })}
    </div>
  );
}
