"use client";
/**
 * Page 08 Player Report — SOT UI rebuild Page 17 of 31 (Report.dc.html).
 *
 * The SOT's page: a header (photo, name, OTSI PIN, "Identity confirmed", "#4 · DM · FC Ercakhu · Nigeria · 2 videos analysed",
 * Edit profile / Add to dossier / Share link / Create report · 10 tokens), ten tabs (Overview / Attacking / Passing / Defensive /
 * Heatmaps / Events / Compare / Scouting / Clips / Notes & tags), and the Overview tab's body: stat tiles (On camera, Events, Confirmed
 * tracks, Evidence coverage, Goals, Assists, Recent form), a Heatmap panel, an Events panel, and a right sidebar (AI Analyst brief,
 * Clips, Notes & tags). The other tabs show the page's existing sections (Heatmap, Event Timeline, Action Map, Comparison, Insights,
 * Scouting Report, AI Analyst) and the player's reels / notes. [ / ] move between tabs, only on this page, never while typing.
 *
 * Measured only (ADR-124): Goals counts the GOAL events on his confirmed tracks; Assists is "Not measured" — the engine does not link a
 * pass to a goal — and Recent form is "Not measured" (no rating model). The stat tiles' values come from /v1/players/:id/measures and
 * /v1/players/:id/events; a failed read is named, never shown as empty.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { AiAnalystAssessment, AiAnalystProviderStatus, PlayerAssessment, PlayerEvents, PlayerIdentity, PlayerListEntry, PlayerMeasures, PlayerProfile, Reel } from "@otsi-vie/contracts";
import { ListOrdered, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { parsePlayerRef, type PlayerRef } from "@/lib/identity";
import { typing } from "@/lib/keymap";
import { ActionMapSection, CompareSection, EventsSection, HeatmapSection, InsightsSection, ScoutingSection, usePlayerEvents } from "./Bottom";
import { AssessmentDialog, DossierDialog, NotesDialog, ReportDialog, type DialogName } from "./Dialogs";
import { AiAnalystPanel } from "./AiAnalystPanel";
import { Hero, KpiSubset, RAIL, type Report } from "./Top";
import { HeatPitch } from "@/components/workspace/HeatPitch";

const TABS = ["overview", "attacking", "passing", "defensive", "heatmaps", "events", "compare", "scouting", "clips", "notes"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL = (d: Dictionary): Record<Tab, string> => ({
  overview: d.body.reports.railOverview, attacking: d.body.reports.rpTabAttacking, passing: d.body.reports.rpTabPassing,
  defensive: d.body.reports.rpTabDefensive, heatmaps: d.body.reports.railHeatmaps, events: d.body.reports.rpTabEvents,
  compare: d.body.reports.rpTabCompare, scouting: d.body.reports.rpTabScouting, clips: d.body.reports.rpTabClips,
  notes: d.body.reports.rpTabNotesTags,
});

function PlayerPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t: dict } = useLocale();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Pick<PlayerIdentity, "player_id" | "display_name" | "canonical_otsi_id" | "canonical_state">[] | null | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    // B.24 (ADR-099): the search needs two characters; before that the picker lists the organization's players (the Players list)
    const t = q.trim();
    const h = setTimeout(() => void (t.length >= 2 ? api<PlayerIdentity[]>(`/v1/players?q=${encodeURIComponent(t)}`)
      : api<PlayerListEntry[]>("/v1/player-list").then((l) => l.filter((x) => !t || x.display_name.toLowerCase().startsWith(t.toLowerCase())).slice(0, 50)
        .map((x) => ({ player_id: x.player_id, display_name: x.display_name, canonical_otsi_id: x.canonical_otsi_id, canonical_state: x.canonical_otsi_id ? "REGISTERED" as const : "PROVISIONAL" as const }))))
      .then(setHits, () => setHits(null)), 200);
    return () => clearTimeout(h);
  }, [open, q]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 t-body shadow-2xl" data-dialog="choose-player">
          <Dialog.Title className="t-section">{dict.body.reports.choosePlayer}</Dialog.Title>
          <Dialog.Description className="mb-3 t-small">{dict.body.reports.pickerDesc}
            {" "}<Link href="/players" className="text-primary hover:underline">{dict.body.reports.playersListLink}</Link></Dialog.Description>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label={dict.body.reports.pickerSearchAria} placeholder={dict.body.reports.searchPlayers} className="mb-2 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
          {hits === undefined && <p className="text-muted">{dict.common.loading}</p>}
          {hits === null && <p role="alert" className="text-danger">{dict.body.reports.playersNotLoaded}</p>}
          {hits?.length === 0 && <p className="text-muted">{dict.body.reports.noPlayerFound}</p>}
          <ul aria-label={dict.body.players.playersListAria} className="space-y-1">
            {hits?.map((p) => (
              <li key={p.player_id}>
                <button type="button" data-player={p.player_id} onClick={() => { onOpenChange(false); router.push(`/reports/players/${p.canonical_otsi_id ?? p.player_id}`); }}
                  className="flex w-full items-center justify-between gap-3 rounded-ctl border border-line/70 px-3 py-2 text-left hover:border-primary/60">
                  <span className="min-w-0 truncate font-normal">{p.display_name}</span>
                  <span className="shrink-0 t-small" data-player-state={p.canonical_state}>{p.canonical_otsi_id ?? dict.body.reports.provisionalNoIdShort}{p.canonical_state === "RETIRED" ? dict.body.reports.retiredSuffix : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** the seven stat tiles of the Overview tab, from the measures and the events read; with no player chosen the tiles show
 *  honest empty values ("—"), never "Loading…" — nothing is being read then */
function StatTiles({ r, ev }: { r: Report; ev: PlayerEvents | null | undefined }) {
  const { t: dict } = useLocale();
  const m = r.measures;
  const noPlayer = !r.player;
  const minutes = m && m.seen_s > 0 ? `${Math.round(m.seen_s / 60)} min` : null;
  const eventsCount = ev?.items.length ?? null;
  const goals = ev ? ev.items.filter((e) => e.kind === "GOAL").length : null;
  const cov = m && m.seen_s > 0 ? Math.round((100 * Math.min(m.measured_s, m.seen_s)) / m.seen_s) : null;
  const tiles: [string, string | null, boolean][] = [
    [dict.body.reports.rpOnCamera, minutes, false],
    [dict.body.reports.rpEvents, eventsCount === null ? null : String(eventsCount), false],
    [dict.body.reports.rpConfirmedTracks, m ? String(m.tracks) : null, false],
    [dict.body.reports.rpEvidenceCoverage, cov === null ? null : `${cov}%`, false],
    [dict.body.reports.rpGoals, goals === null ? null : String(goals), false],
    [dict.body.reports.rpAssists, null, true],
    [dict.body.reports.rpRecentForm, null, true],
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map(([label, value, notMeasured]) => (
        <div key={label} className="border-t border-line pt-2">
          <p className="t-small">{label}</p>
          {value === null && !notMeasured ? (
            <p className="mt-1 t-metric text-muted">{noPlayer ? "—" : r.measuresFailed || ev === null ? dict.body.reports.couldNotBeLoaded : dict.common.loading}</p>
          ) : notMeasured ? (
            <p className="mt-1 t-metric text-muted italic">{dict.body.reports.notMeasured}</p>
          ) : (
            <p className="mt-1 t-metric">{value}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/** the Overview tab's Heatmap panel: the pitch, with the measured heat or "Not measured" over it */
function OverviewHeatmap({ r }: { r: Report }) {
  const { t: dict } = useLocale();
  const [range, setRange] = useState<"full" | "h1" | "h2">("full");
  const [m, setM] = useState<PlayerMeasures | null | undefined>(undefined);
  const id = r.player?.player_id;
  useEffect(() => {
    setM(undefined);
    if (!id || range === "full") return;
    let live = true;
    void api<PlayerMeasures>(`/v1/players/${id}/measures?half=${range === "h1" ? 1 : 2}`).then((x) => { if (live) setM(x); }, () => { if (live) setM(null); });
    return () => { live = false; };
  }, [id, range]);
  const heat = range === "full" ? r.measures?.heat ?? null : m?.heat ?? null;
  const loading = range !== "full" && m === undefined;
  return (
    <section aria-label={dict.body.reports.heatmap} className="flex min-w-0 flex-[1_1_340px] flex-col border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="t-panel">{dict.body.reports.heatmap}</h2>
        <div className="seg" role="tablist" aria-label={dict.body.reports.heatRangeLabel}>
          {([["full", dict.body.reports.rpMatch], ["h1", dict.body.reports.rpFirstHalf], ["h2", dict.body.reports.rpSecondHalf]] as const).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={range === v} onClick={() => setRange(v)} className={range === v ? "on" : ""}>{l}</button>
          ))}
        </div>
      </div>
      <div className="relative flex-1 py-1">
        {heat ? (
          <div className="aspect-[105/68] w-full"><HeatPitch zones={heat} label={dict.body.reports.heatmap} /></div>
        ) : (
          <div className="relative aspect-[105/68] w-full">
            <svg viewBox="0 0 105 68" role="img" aria-label={dict.body.reports.heatmap} className="block h-auto w-full">
              <rect x={0} y={0} width={105} height={68} fill="#0E1512" />
              <rect x={1.5} y={2.5} width={102} height={63} fill="none" stroke="#2A3A31" strokeWidth={0.4} />
              <line x1={52.5} y1={2.5} x2={52.5} y2={65.5} stroke="#2A3A31" strokeWidth={0.4} />
              <circle cx={52.5} cy={34} r="9.15" fill="none" stroke="#2A3A31" strokeWidth={0.4} />
              <rect x={1.5} y={13.84} width={16.5} height={40.32} fill="none" stroke="#2A3A31" strokeWidth={0.4} />
              <rect x={87} y={13.84} width={16.5} height={40.32} fill="none" stroke="#2A3A31" strokeWidth={0.4} />
            </svg>
            <p className="absolute inset-0 grid place-items-center"><span className="t-small text-muted">• {loading ? dict.common.loading : dict.body.reports.notMeasured}</span></p>
          </div>
        )}
      </div>
    </section>
  );
}

/** the Overview tab's Events panel: how many events he took part in, and where to review them */
function OverviewEvents({ r, ev }: { r: Report; ev: PlayerEvents | null | undefined }) {
  const { t: dict } = useLocale();
  const count = ev?.items.length ?? null;
  const videos = r.measures?.videos ?? ev?.videos ?? 0;
  return (
    <section aria-label={dict.body.reports.rpEvents} className="flex min-w-0 flex-[1_1_300px] flex-col border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="t-panel">{dict.body.reports.rpEvents}</h2>
        <span className="t-small">{count === null ? (!r.player ? "—" : ev === null ? dict.body.reports.couldNotBeLoaded : dict.common.loading) : dict.body.reports.rpEventsAcross.replace("{a}", String(count)).replace("{b}", String(videos))}</span>
      </div>
      <div className="empty flex-1">
        <span className="ei"><ListOrdered className="h-5 w-5" aria-hidden /></span>
        <h3>{count === null ? dict.body.reports.rpEvents : dict.body.reports.rpEventsRecorded.replace("{a}", String(count))}</h3>
        <p>{dict.body.reports.rpReviewEvents}</p>
        <Link href="/analysis" className="vie-btn vie-btn-sm">{dict.body.reports.rpOpenInAnalysis}</Link>
      </div>
      <div className="border-t border-line p-3">
        <Link href="/reels" className="vie-btn w-full">{dict.body.reports.rpBuildReel}</Link>
      </div>
    </section>
  );
}

/** the sidebar's AI Analyst brief panel: the Draft → Reviewed → Published steps, consent, Generate / Publish */
function AiBriefPanel({ r }: { r: Report }) {
  const { t: dict, locale } = useLocale();
  const id = r.player?.player_id;
  const [status, setStatus] = useState<AiAnalystProviderStatus | null | undefined>(undefined);
  const [assessment, setAssessment] = useState<AiAnalystAssessment | null | undefined>(undefined);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!id) return;
    setAssessment(undefined); setErr(null);
    void api<AiAnalystProviderStatus>(`/v1/players/${id}/ai-analysis/status`).then(setStatus, () => setStatus(null));
    void api<AiAnalystAssessment>(`/v1/players/${id}/ai-analysis`).then(setAssessment, (x) => {
      setAssessment(null);
      if (!(x instanceof ApiProblem && x.status === 404)) setErr(x instanceof Error ? x.message : dict.body.aiAnalyst.couldNotVerify);
    });
  }, [id, dict.body.aiAnalyst.couldNotVerify]);
  useEffect(load, [load]);
  const a = assessment ?? null;
  const step = !a ? 0 : a.status === "PUBLISHED" ? 3 : 1;
  const act = async (fn: () => Promise<AiAnalystAssessment>) => {
    setBusy(true); setErr(null);
    try { setAssessment(await fn()); } catch (x) { setErr(x instanceof ApiProblem ? x.message : dict.body.aiAnalyst.couldNotVerify); } finally { setBusy(false); }
  };
  const generate = () => id && act(() => api<AiAnalystAssessment>(`/v1/players/${id}/ai-analysis`, { method: "POST", json: { language: locale, consent_acknowledged: true, regenerate: !!a } }));
  const publish = () => id && a && act(() => api<AiAnalystAssessment>(`/v1/players/${id}/ai-analysis/${a.id}/publish`, { method: "POST", json: {} }));
  return (
    <section aria-label={dict.body.reports.rpAiBrief} className="min-w-0 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="t-panel">{dict.body.reports.rpAiBrief}</h2>
        <span className="t-small text-muted"><span className={a?.status === "PUBLISHED" ? "text-primary" : "text-muted"} aria-hidden>•</span> {!a ? dict.body.reports.rpNotGenerated : a.status === "PUBLISHED" ? dict.body.aiAnalyst.published : dict.body.aiAnalyst.draft}</span>
      </div>
      <div className="flex flex-col gap-2.5 py-1">
        <ol className="m-0 flex list-none items-center gap-2 p-0">
          {[dict.body.reports.rpDraft, dict.body.reports.rpReviewed, dict.body.reports.rpPublished].map((l, i) => (
            <Fragment key={l}>
              {i > 0 && <span aria-hidden className="h-px min-w-4 flex-1 bg-line2" />}
              <li aria-current={step === i + 1 ? "step" : undefined} className={`whitespace-nowrap text-xs ${step === i + 1 ? "text-ink" : "text-muted"}`}>{l}</li>
            </Fragment>
          ))}
        </ol>
        <p className="t-small">{dict.body.reports.rpMeasuredOnly}</p>
        {id && status === undefined && <p className="t-body text-muted">{dict.common.loading}</p>}
        {status === null && <p role="alert" className="t-body text-danger">{dict.body.aiAnalyst.notConfigured}</p>}
        {status !== undefined && status !== null && !status.configured && <p className="t-body text-muted">{dict.body.aiAnalyst.notConfigured}</p>}
        {r.can.assess ? (
          <>
            <label className="flex items-start gap-2 t-body text-muted">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
              <span>{dict.body.reports.rpConsent}</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy || !id || !consent} onClick={generate} className="vie-btn vie-btn-pri">{dict.body.reports.rpGenerateBrief}</button>
              <button type="button" disabled={busy || !a || a.status !== "DRAFT"} onClick={publish} className="vie-btn">{dict.body.reports.rpPublishBrief}</button>
            </div>
          </>
        ) : <p className="t-body text-muted">{dict.body.reports.cannotWriteAssessments}</p>}
        <p className="t-small">{dict.body.reports.rpReviewToPublish}</p>
        {err && <p role="alert" className="t-body text-danger">{err}</p>}
      </div>
    </section>
  );
}

/** the sidebar's Clips panel: how many reels he has, and a link to the Reel Builder */
function ClipsPanel({ r }: { r: Report }) {
  const { t: dict } = useLocale();
  const id = r.player?.player_id;
  const [reels, setReels] = useState<Reel[] | null | undefined>(undefined);
  useEffect(() => {
    setReels(undefined);
    if (!id) return;
    let live = true;
    void api<Reel[]>("/v1/reels").then((all) => { if (live) setReels(all.filter((x) => x.player?.player_id === id)); }, () => { if (live) setReels(null); });
    return () => { live = false; };
  }, [id]);
  const count = reels?.length ?? null;
  return (
    <section aria-label={dict.body.reports.rpClips} className="min-w-0 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="t-panel">{dict.body.reports.rpClips}</h2>
        <Link href="/reels" className="t-small text-primary hover:underline">{dict.body.reports.rpReelBuilder}</Link>
      </div>
      <div className="flex flex-col gap-1 py-1">
        <span className="t-section">{count === null ? (!id ? "—" : reels === null ? dict.body.reports.couldNotBeLoaded : dict.common.loading) : count === 1 ? dict.body.reports.rpReelGenerated : dict.body.reports.rpReelsGenerated.replace("{a}", String(count))}</span>
        <span className="t-small">{dict.body.reports.rpOpenInReelBuilder}</span>
      </div>
    </section>
  );
}

/** the sidebar's Notes & tags panel: a note box and an add-tag button, both opening the Notes & Tags dialog */
function NotesTagsPanel({ r }: { r: Report }) {
  const { t: dict } = useLocale();
  return (
    <section aria-label={dict.body.reports.rpNotesTags} className="flex min-w-0 flex-1 flex-col border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="t-panel">{dict.body.reports.rpNotesTags}</h2>
        <span className="t-small">{dict.body.reports.rpPrivateOrg}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 py-1">
        <textarea aria-label={dict.body.reports.rpAddNote} placeholder={dict.body.reports.rpAddNote} readOnly rows={6}
          onClick={() => (r.player ? r.open("notes") : r.pick())}
          className="in min-h-[140px] flex-1 cursor-pointer resize-none" />
        <button type="button" onClick={() => (r.player ? r.open("notes") : r.pick())}
          className="self-start rounded-ctl border border-dashed border-line2 px-2.5 py-1 text-xs text-muted hover:border-primary hover:text-primary">{dict.body.reports.rpAddTag}</button>
      </div>
    </section>
  );
}

export function ReportStage({ playerRef }: { playerRef?: string }) {
  const { t: dict } = useLocale();
  const ref: PlayerRef | null = playerRef ? parsePlayerRef(playerRef) : null;
  const [player, setPlayer] = useState<PlayerIdentity | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);                   // SOT: the landing without a player shows the page; a click opens the picker
  const [tab, setTab] = useState<Tab>("overview");
  const [measures, setMeasures] = useState<PlayerMeasures | null>(null);
  /** the measures read failed (null then means failed, not loading): the tiles name it instead of showing "—" */
  const [measuresFailed, setMeasuresFailed] = useState(false);
  useEffect(() => {                                  // what the footage measured: tracks a person confirmed as this player only
    setMeasures(null); setMeasuresFailed(false);
    if (player) void api<PlayerMeasures>(`/v1/players/${player.player_id}/measures`).then(setMeasures, () => { setMeasures(null); setMeasuresFailed(true); });
  }, [player]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  useEffect(() => {
    setProfile(null);
    if (player) void api<PlayerProfile>(`/v1/players/${player.player_id}/profile`).then(setProfile, () => setProfile(null));
  }, [player]);
  const [assessment, setAssessment] = useState<PlayerAssessment | null>(null);
  useEffect(() => {
    setAssessment(null);
    if (player) void api<PlayerAssessment>(`/v1/players/${player.player_id}/assessment`).then(setAssessment, () => setAssessment(null));
  }, [player]);
  const ev = usePlayerEvents(player?.player_id ?? null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const role = useAuth().organization?.role ?? "VIEWER";
  const can = useMemo(() => ({ write: ["OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT"].includes(role), assess: ["OWNER", "ADMIN", "ANALYST", "SCOUT"].includes(role), share: ["OWNER", "ADMIN", "ANALYST", "EDITOR"].includes(role) }), [role]);
  const [focus, setFocus] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const key = ref ? `${ref.kind}:${ref.id}` : "";
  useEffect(() => {
    setPlayer(null); setMissing(null);
    if (!ref) return;
    const path = ref.kind === "canonical" ? `/v1/players/by-otsi-id/${ref.id}` : `/v1/players/${ref.id}`;
    void api<PlayerIdentity>(path).then(setPlayer, (x) => setMissing(x instanceof ApiProblem && x.status === 404 ? dict.body.reports.noSuchPlayer : dict.body.reports.playerLoadFailed));
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const go = useCallback((i: number) => {
    setSelected(i);
    const [label, , , target] = RAIL[i]!;
    if (!target) { if (label === "Video Clips") router.push("/reels"); return; }
    setFocus(target);
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocus((f) => (f === target ? null : f)), 1600);
  }, [router]);
  const [selected, setSelected] = useState(0);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);   // the focus highlight never outlives the page
  const pick = useCallback(() => setPicking(true), []);
  const close = useCallback(() => setDialog(null), []);
  const setTabAndFocus = useCallback((t: Tab) => {
    setTab(t);
    if (t === "notes") { if (player) setDialog("notes"); else setPicking(true); }
    if (t === "clips") router.push("/reels");
  }, [player, router]);
  // [ / ] move between the tabs (lib/keymap.ts, Reports scope): only on this page, never while typing or with a dialog open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || dialog !== null || picking) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const i = TABS.indexOf(tab);
      if (e.key === "]") setTabAndFocus(TABS[Math.min(TABS.length - 1, i + 1)]!);
      else if (e.key === "[") setTabAndFocus(TABS[Math.max(0, i - 1)]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, setTabAndFocus, dialog, picking]);
  // the Report object is memoised so opening a dialog or the picker does not re-render the sections (they are memoised)
  const r: Report = useMemo(() => ({ player, missing, focus, selected, go, pick, measures, measuresFailed, profile, assessment, open: setDialog, can }),
    [player, missing, focus, selected, go, pick, measures, measuresFailed, profile, assessment, can]);
  const p = player;
  const pr = profile, team = pr?.latest_team ?? null;
  const sub = p ? [
    team?.jersey_number != null ? `#${team.jersey_number}` : null,
    team?.position ?? pr?.position ?? null,
    team?.team ?? null,
    pr?.nationality?.name ?? null,
    measures ? dict.body.reports.rpVideosAnalysed.replace("{a}", String(measures.videos)) : null,
  ].filter(Boolean).join(" · ") : null;
  const photo = pr?.details?.photo_url ?? null;
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-page="reports" data-stage>
      {/* header: photo, name, PIN, identity chip, sub, actions */}
      <header className="border-b border-line bg-[#0F1114] px-7 pb-2.5 pt-3.5">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-raised">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={p?.display_name ?? ""} className="h-full w-full object-cover" />
            ) : (
              <User className="h-6 w-6 text-muted" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="t-page">{p?.display_name ?? dict.body.reports.noPlayerSelected}</h1>
              {p?.canonical_otsi_id && <span className="rounded-ctl border border-primary/50 px-2 py-0.5 text-xs text-primary">{p.canonical_otsi_id}</span>}
              {p?.canonical_otsi_id && <span className="t-small text-muted"><span className="text-primary" aria-hidden>•</span> {dict.body.reports.rpIdentityConfirmed}</span>}
              {p && !p.canonical_otsi_id && <span className="t-small text-muted">• {dict.body.reports.provisionalPlayer}</span>}
            </div>
            {sub && <p className="mt-0.5 truncate t-small">{sub}</p>}
            {missing && <p role="alert" className="mt-1 t-body text-danger">{missing}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {p && <Link href={`/players?player=${p.player_id}`} className="vie-btn vie-btn-sm">{dict.body.reports.rpEditProfile}</Link>}
            <button type="button" onClick={() => (p ? setDialog("dossier") : setPicking(true))} className="vie-btn vie-btn-sm">{dict.body.reports.rpAddToDossier}</button>
            <button type="button" onClick={() => (p ? setDialog("share") : setPicking(true))} className="vie-btn vie-btn-sm">{dict.body.reports.rpShareLink}</button>
            <button type="button" onClick={() => (p ? setDialog("pdf") : setPicking(true))} className="vie-btn vie-btn-sm vie-btn-pri">{dict.body.reports.rpCreateReport}</button>
          </div>
        </div>
      </header>
      {/* tabs */}
      <div className="tabs border-b border-line bg-[#0F1114] px-5" role="tablist" aria-label={dict.body.reports.reportTitle}>
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} aria-label={TAB_LABEL(dict)[t]}
            onClick={() => setTabAndFocus(t)} className={`tab ${tab === t ? "on" : ""}`}>{TAB_LABEL(dict)[t]}</button>
        ))}
      </div>
      {/* body: the overview's main column and sidebar stretch to the page height, so the Heatmap / Events panels
          and the sidebar's last panel run full height */}
      <div className="flex min-h-0 flex-1 flex-wrap items-stretch gap-3.5 overflow-auto p-3.5 px-7">
        {tab === "overview" ? (
          <>
            <main className="flex min-w-0 flex-[2_1_600px] flex-col gap-3.5">
              <StatTiles r={r} ev={ev} />
              <div className="flex flex-1 flex-wrap items-stretch gap-3.5">
                <OverviewHeatmap r={r} />
                <OverviewEvents r={r} ev={ev} />
              </div>
            </main>
            <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-3.5" style={{ maxWidth: 400 }}>
              <AiBriefPanel r={r} />
              <ClipsPanel r={r} />
              <NotesTagsPanel r={r} />
            </aside>
          </>
        ) : tab === "attacking" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <KpiSubset r={r} labels={["Passes", "Key Passes", "Shots"]} />
            <ActionMapSection r={r} ev={ev} />
          </div>
        ) : tab === "passing" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <KpiSubset r={r} labels={["Passes", "Key Passes"]} />
            <ActionMapSection r={r} ev={ev} />
          </div>
        ) : tab === "defensive" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <EventsSection r={r} ev={ev} />
          </div>
        ) : tab === "heatmaps" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4"><HeatmapSection r={r} /></div>
        ) : tab === "events" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4"><EventsSection r={r} ev={ev} /></div>
        ) : tab === "compare" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4"><CompareSection r={r} /></div>
        ) : tab === "scouting" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <ScoutingSection r={r} />
            <InsightsSection r={r} />
            {p && <AiAnalystPanel playerId={p.player_id} canAssess={can.assess} />}
          </div>
        ) : tab === "clips" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <ClipsPanel r={r} />
            <p className="t-body text-muted"><Link href="/reels" className="text-primary hover:underline">{dict.body.reports.rpOpenInReelBuilder}</Link></p>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <NotesTagsPanel r={r} />
          </div>
        )}
      </div>
      <PlayerPicker open={picking} onOpenChange={setPicking} />
      {player && (
        <>
          <NotesDialog player={player} open={dialog === "notes"} onClose={close} />
          <DossierDialog player={player} open={dialog === "dossier"} onClose={close} canWrite={can.write} />
          <ReportDialog player={player} open={dialog === "pdf" || dialog === "share"} share={dialog === "share"} onClose={close} canMake={can.write} canShare={can.share} />
          <AssessmentDialog player={player} open={dialog === "assess" || dialog === "read"} edit={dialog === "assess"} onClose={close} onSaved={setAssessment} confirmed={!!measures?.tracks} />
        </>
      )}
    </div>
  );
}
