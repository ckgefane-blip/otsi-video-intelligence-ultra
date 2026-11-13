"use client";
/**
 * Home — the SOT layout (Main.dc.html) inside the app shell: the accuracy line, a three-column row (Start | live picture | Featured
 * reel), a four-number KPI row, and a three-panel row (Recent matches | Review inbox | Active jobs). Home audit fixes, owner 2026-11-13.
 *
 * Everything is real data:
 *   Start — the upload note names the organization's real plan and the real per-video limit (useTierLimit: the plan's limit, never more
 *     than the server accepts); link sources are checked on the Upload page, so none are promised here. The next action comes from
 *     GET /v1/overview/inbox, worded in the person's language from its kind.
 *   Live picture — HeroLive (a confirmed player's real frame, GET /v1/overview/hero-moment).
 *   Featured reel — GET /v1/overview/featured-reel: the newest rendered reel that may be shared now (rights and identities checked by the
 *     same rule as a share link). It plays here (VideoPlayer, the render's signed address). Share makes a real share link (POST
 *     /v1/renders/:id/share-links: view only, 7 days; the API refuses it with the reason when sharing is not allowed). None cleared:
 *     says so, and how many rendered reels wait for rights or a refresh.
 *   KPIs — GET /v1/overview/stats (reels and reports in Trash do not count); each opens its list; "+n this week" only when there is one.
 *   Recent matches — RecentMatches; Review inbox — the inbox rows (the reel's own player only), all of them on "See all";
 *   Active jobs — GET /v1/jobs, naming the job that is actually running.
 * A failed read is named, never shown as empty or as endless loading.
 */
import type { CreatedShareLink, FeaturedReelPick, HomeInbox, InboxItem, JobList, NextAction, OverviewStats } from "@otsi-vie/contracts";
import { ArrowRight, Link2, Share2, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ApiProblem, api } from "@/lib/api";
import { AccuracyBanner } from "@/components/evidence/AccuracyBanner";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { fill } from "@/lib/fill";
import { formatGB, useTierLimit } from "@/lib/uploadTier";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { HeroLive } from "./HeroLive";
import { HomeInboxProvider, useHomeInbox } from "./HomeInbox";
import { RecentMatches } from "./RecentMatches";
import { codec, quality, mmss, reelSeconds, reloadRenderedReels, useReelPlayback, useRenderedReels } from "./renderedReels";

const cap = (code: string) => code.charAt(0) + code.slice(1).toLowerCase();

/** an inbox row's title in the person's language, from its kind and count (the server's English title is the fallback) */
export function inboxTitle(t: Dictionary, it: InboxItem): string {
  const h = t.body.home;
  switch (it.kind) {
    case "IDENTITY": return fill(h.hmInboxIdentity, { a: it.player_name ?? "—", n: it.count });
    case "TEAM_SHEET": return fill(h.hmInboxTeamSheet, { n: it.count });
    case "STALE_REEL": return h.hmInboxStaleReel;
    case "FAILED_JOB": return fill(h.hmInboxFailedJob, { n: it.count });
    default: return it.title;
  }
}

/** the next action's label in the person's language */
export function nextLabel(t: Dictionary, n: NextAction, inbox: HomeInbox | null | undefined): string {
  const h = t.body.home;
  switch (n.kind) {
    case "WATCH_PROCESSING": return h.hmNextWatch;
    case "CONTINUE_REEL": return h.hmNextContinue;
    case "OPEN_REPORT": return h.hmNextReport;
    case "PICK_PLAYER": return h.hmNextPick;
    case "REVIEW": return inbox?.items[0] ? inboxTitle(t, inbox.items[0]) : n.label;
    default: return n.label;
  }
}

function Start() {
  const { t } = useLocale();
  const h = t.body.home;
  const inbox = useHomeInbox();
  const lim = useTierLimit();
  const n = inbox?.next;
  const planName = lim?.plan ? (lim.plan === "FREE" ? t.body.plans.freeName : cap(lim.plan)) : null;
  const note = lim?.maxBytes
    ? planName ? fill(h.hmUploadNotePlan, { a: planName, b: formatGB(lim.maxBytes) }) : fill(h.hmUploadNoteServer, { b: formatGB(lim.maxBytes) })
    : null;
  return (
    <section aria-label="Start" className="flex min-w-0 flex-col justify-center gap-3.5">
      <h1 className="t-page">{h.hmTitle}</h1>
      <p className="t-body m-0 text-muted">{h.hmSub}</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/upload?mode=file" className="vie-btn vie-btn-pri"><Upload className="h-4 w-4" aria-hidden />{h.hmUploadVideo}</Link>
        <Link href="/upload?mode=url" className="vie-btn"><Link2 className="h-4 w-4" aria-hidden />{h.hmPasteLink}</Link>
      </div>
      {note && <span className="t-small text-muted" data-upload-note>{note}</span>}
      {n && (
        <Link href={n.href} data-cta="next-action" data-next-kind={n.kind}
          className="flex items-center gap-2.5 border-t border-line py-2.5 text-ink hover:text-primary">
          <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="t-body min-w-0 flex-1 truncate font-normal">{nextLabel(t, n, inbox)}{n.detail ? <span className="font-normal text-muted">{` · ${n.detail}`}</span> : null}</span>
        </Link>
      )}
    </section>
  );
}

function FeaturedReel() {
  const { t } = useLocale();
  const h = t.body.home;
  const reels = useRenderedReels();
  const [pick, setPick] = useState<FeaturedReelPick | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setPick(undefined);
    void api<FeaturedReelPick>("/v1/overview/featured-reel").then((x) => { if (live) setPick(x); }, () => { if (live) setPick(null); });
    return () => { live = false; };
  }, [tick]);
  const failed = reels === null || pick === null;
  const loading = !failed && (reels === undefined || pick === undefined);
  const reel = !loading && !failed && pick?.reel_id ? (reels ?? []).find((r) => r.id === pick.reel_id) ?? null : null;
  const src = useReelPlayback(loading ? undefined : reel);
  const result = (reel?.last_good_render?.result ?? {}) as { height?: number };

  const [note, setNote] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { setMade(null); }, [pick?.render_id]);
  const flash = (s: string, ms = 4000) => { setNote(s); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), ms); };

  async function share() {
    if (!pick?.render_id) return;
    setBusy(true);
    try {
      let url = made;
      if (!url) {
        const l = await api<CreatedShareLink>(`/v1/renders/${pick.render_id}/share-links`, { method: "POST", json: {} });
        url = `${location.origin}${l.url}`;
        setMade(url);
      }
      try {
        if (!navigator.clipboard) throw new Error("no clipboard");
        await navigator.clipboard.writeText(url);
        flash(h.hmShareCopied);
      } catch { flash(fill(h.hmShareMade, { a: url }), 15000); }
    } catch (e) {
      flash(e instanceof ApiProblem ? e.message : h.hmShareFailed, 8000);
    } finally { setBusy(false); }
  }

  const empty = failed ? { title: h.couldntLoadReels, body: h.featuredLoadFailed }
    : { title: h.hmFeaturedNoneCleared, body: pick?.rendered_not_cleared ? fill(h.hmFeaturedWaiting, { n: pick.rendered_not_cleared }) : h.hmFeaturedHint };
  return (
    <section aria-label="Featured reel" className="flex min-w-0 flex-col gap-2.5" data-featured={reel ? reel.id : loading ? "loading" : failed ? "error" : "none"}>
      <span className="t-body">{h.hmFeaturedReel}</span>
      <VideoPlayer src={reel ? src : loading ? undefined : null} label={`${h.hmFeaturedReel}: ${reel?.name ?? ""}`} empty={empty} />
      {failed && (
        <button type="button" className="t-small text-left text-primary hover:underline" onClick={() => { reloadRenderedReels(); setTick((x) => x + 1); }}>
          {h.featuredLoadFailed}
        </button>
      )}
      {reel && (
        <>
          <Link href={`/reels/${reel.id}`} className="t-body block truncate font-normal hover:text-primary" title={h.hmOpenReel}>{reel.name}</Link>
          <span className="t-small block truncate text-muted" data-reel-facts>
            {[fill(t.desktop.featuredClips, { n: reel.clips.length }), reel.aspect, codec(reel), quality(result.height), mmss(reelSeconds(reel))].join(" · ")}
          </span>
          <div className="flex flex-wrap gap-2">
            <Link href={`/reels/${reel.id}`} className="vie-btn vie-btn-sm">{h.hmOpenReel}</Link>
            <button type="button" className="vie-btn vie-btn-sm" disabled={busy} onClick={() => void share()} data-share>
              <Share2 className="h-4 w-4" aria-hidden />{t.body.library.share}
            </button>
          </div>
        </>
      )}
      {note && <p role="status" className="t-small break-all text-primary">{note}</p>}
    </section>
  );
}

function KpiRow() {
  const { t } = useLocale();
  const h = t.body.home;
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void api<OverviewStats>("/v1/overview/stats").then((x) => { setStats(x); setFailed(false); }, () => setFailed(true));
  }, []);
  const week = (arr: number[]) => arr[arr.length - 1] ?? 0;
  const rows: [string, number, number, string][] = stats ? [
    [h.hmMatchesAnalysed, stats.matches_analyzed, week(stats.weekly.matches_analyzed), "/matches"],
    [h.hmPlayersConfirmed, stats.players_tracked, week(stats.weekly.players_tracked), "/players"],
    [h.hmReelsGenerated, stats.reels_generated, week(stats.weekly.reels_generated), "/reels"],
    [h.hmReportsCreated, stats.reports_created, week(stats.weekly.reports_created), "/reports"],
  ] : [];
  return (
    <div className="grid grid-cols-2 gap-6 border-y border-line py-3 md:grid-cols-4" aria-label={h.kpiStripAria}>
      {failed && <p className="t-small col-span-full text-danger">{fill(h.kpiAriaFailed, { label: h.kpiStripAria })}</p>}
      {rows.map(([label, value, d, href]) => (
        <Link key={label} href={href} className="rounded px-1 hover:bg-raised" aria-label={fill(h.hmKpiOpen, { a: label })} data-kpi={href}>
          <span className="t-small block text-muted">{label}</span>
          <span className="t-body mt-0.5 block">{value}{d > 0 && <span className="text-muted"> · {fill(h.hmThisWeek, { n: d })}</span>}</span>
        </Link>
      ))}
      {!stats && !failed && <p className="t-small col-span-full text-muted">{t.common.loading}</p>}
    </div>
  );
}

function ReviewInboxPanel() {
  const { t } = useLocale();
  const h = t.body.home;
  const inbox = useHomeInbox();
  const [all, setAll] = useState(false);
  const items = inbox?.items ?? [];
  const shown = all ? items : items.slice(0, 5);
  return (
    <section aria-label={h.hmReviewInbox} className="min-w-0 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="t-panel">{h.hmReviewInbox}</h2>
        <span className={`t-small ${inbox === null ? "text-danger" : "text-muted"}`}>
          {inbox === undefined ? t.common.loading : inbox === null ? h.hmInboxFailed : items.length ? h.inboxToDo.replace("{a}", String(items.length)) : h.inboxAllClear}
        </span>
      </div>
      {items.length === 0 && inbox && <p className="t-small py-2 text-muted">{h.inboxNothingWaits}</p>}
      <ul className="flex flex-col">
        {shown.map((it) => (
          <li key={it.id}>
            <Link href={it.href} data-inbox={it.kind} className="flex min-h-[52px] items-center gap-3 rounded px-2 py-2 hover:bg-raised">
              <span className="min-w-0 flex-1">
                <span className="t-body block truncate font-normal">{inboxTitle(t, it)}</span>
                <span className="t-small block truncate text-muted">{it.detail ?? ""}</span>
              </span>
              <span className="vie-btn vie-btn-sm">{h.hmReview}</span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <button type="button" className="t-small px-2 py-1 text-primary hover:underline" onClick={() => setAll((x) => !x)} data-inbox-all>
          {all ? h.hmShowFewer : fill(h.hmSeeAll, { n: items.length })}
        </button>
      )}
    </section>
  );
}

function ActiveJobsPanel() {
  const { t } = useLocale();
  const h = t.body.home;
  const [list, setList] = useState<JobList | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () => void api<JobList>("/v1/jobs").then((x) => { if (live) setList(x); }, () => { if (live) setList((cur) => cur ?? null); });
    load();
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  const waiting = list ? list.active - list.running : 0;
  const current = list ? list.jobs.find((j) => j.state === "RUNNING") ?? list.jobs.find((j) => j.state === "QUEUED" || j.state === "PAUSED") ?? null : null;
  return (
    <section aria-label={h.hmActiveJobs} className="min-w-0 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 className="t-panel">{h.hmActiveJobs}</h2>
        <Link href="/processing" className="t-small text-primary hover:underline">{t.desktop.jobsCenter}</Link>
      </div>
      <div className="flex min-h-[52px] flex-col justify-center py-2">
        {list === null ? <span className="t-small text-danger" role="status">{h.hmJobsFailed}</span> : (
          <>
            <span className="t-body">{list ? fill(h.inboxRunning, { a: String(list.running), b: String(waiting) }) : t.common.loading}</span>
            <span className="t-small truncate text-muted" data-current-job>
              {list && list.active === 0 ? h.inboxNoJobs : current ? `${current.kind_label}${current.subject_title ? ` · ${current.subject_title}` : ""}` : ""}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function HomeContent() {
  const { t } = useLocale();
  return (
    <div className="flex w-full flex-col gap-4 px-7 py-5" data-page="home">
      <AccuracyBanner />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(220px,1fr)_minmax(340px,1.6fr)_minmax(220px,1fr)]">
        <Start />
        <section aria-label="Live picture" className="min-w-0"><HeroLive /></section>
        <FeaturedReel />
      </div>
      <KpiRow />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label={t.body.home.hmRecentMatches} className="min-w-0"><RecentMatches /></section>
        <ReviewInboxPanel />
        <ActiveJobsPanel />
      </div>
    </div>
  );
}

export function HomeStage() {
  return (
    <HomeInboxProvider>
      <HomeContent />
    </HomeInboxProvider>
  );
}
