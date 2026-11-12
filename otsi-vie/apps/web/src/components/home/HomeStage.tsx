"use client";
/**
 * Home — SOT rebuild (page 11, alphabetical).
 * The SOT's Home (Main.dc.html) inside the app shell: an accuracy banner is
 * already in the (app) layout (AccuracyBanner), so this page is the content
 * below it — a three-column row (Start | live picture | Featured reel), a
 * four-number KPI row, and a three-panel row (Recent matches | Review inbox |
 * Active jobs). The old page's Sample Reels, Capabilities, How It Works and
 * TrustStrip are not in the SOT, so they are not here (those components
 * remain in the repo, unrouted by this page).
 *
 * Everything is real data from the same endpoints the old page used:
 *   Start — the inbox's next action (GET /v1/overview/inbox), the upload
 *     tier limit for the note; the live picture is HeroLive (the rotating
 *     real frame, GET /v1/overview/hero-moment, a new confirmed moment
 *     every 12 s) with the SOT's caption; Featured reel — the newest
 *     rendered reel (GET /v1/reels), the quality select shows the four
 *     sizes with the rendered one marked, Play opens the reel and Share
 *     copies its link; KPIs — GET /v1/overview/stats, the delta is the
 *     most recent week; Recent matches — the existing component (GET
 *     /v1/overview/recent-matches, real thumbnails); Review inbox — the
 *     inbox items, each with a Review button; Active jobs — GET /v1/jobs.
 * A failed read is named, never shown as empty.
 */
import type { JobList, OverviewStats } from "@otsi-vie/contracts";
import { ArrowRight, Link2, Play, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fill } from "@/lib/fill";
import { formatGB, useTierLimit } from "@/lib/uploadTier";
import { useLocale } from "@/lib/i18n";
import { HeroLive } from "./HeroLive";
import { HomeInboxProvider, useHomeInbox } from "./HomeInbox";
import { RecentMatches } from "./RecentMatches";
import { codec, quality, mmss, reelSeconds, reloadRenderedReels, useReelPlayback, useRenderedReels } from "./renderedReels";

type Quality = "sd" | "hd" | "fhd" | "uhd";
const QUALITIES: Quality[] = ["sd", "hd", "fhd", "uhd"];
/** the rendered file's quality from its height (the same bands as FeaturedReel.quality) */
const renderedQuality = (h: number | undefined | null): Quality => (!h ? "sd" : h >= 2160 ? "uhd" : h >= 1080 ? "fhd" : h >= 720 ? "hd" : "sd");

function Start() {
  const { t } = useLocale();
  const inbox = useHomeInbox();
  const lim = useTierLimit();
  const tier = lim?.tier === "Free" ? t.desktop.tierFree : lim?.tier === "Pro" ? t.desktop.tierPro : lim?.tier === "Enterprise" ? t.desktop.tierEnterprise : lim?.plan ?? "—";
  const n = inbox?.next;
  return (
    <section aria-label="Start" className="flex min-w-0 flex-col justify-center gap-3.5">
      <h1 className="t-page">{t.body.home.hmTitle}</h1>
      <p className="t-body m-0 text-muted">{t.body.home.hmSub}</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/upload?mode=file" className="vie-btn vie-btn-pri"><Upload className="h-4 w-4" aria-hidden />{t.body.home.hmUploadVideo}</Link>
        <Link href="/upload?mode=url" className="vie-btn"><Link2 className="h-4 w-4" aria-hidden />{t.body.home.hmPasteLink}</Link>
      </div>
      <span className="t-small text-muted">
        {lim?.maxBytes ? fill(t.body.home.hmUploadNote, { a: tier, b: formatGB(lim.maxBytes) }) : t.body.home.hmUploadNote.replace("{a}", tier).replace("{b}", "—")}
      </span>
      {n && (
        <Link href={n.href} data-cta="next-action" data-next-kind={n.kind}
          className="flex items-center gap-2.5 border-t border-line py-2.5 text-ink hover:text-primary">
          <ArrowRight className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span className="t-body min-w-0 flex-1 truncate font-normal">{n.label}{n.detail ? <span className="font-normal text-muted">{` · ${n.detail}`}</span> : null}</span>
        </Link>
      )}
    </section>
  );
}

function FeaturedReel() {
  const { t } = useLocale();
  const reels = useRenderedReels();
  const reel = reels === undefined ? undefined : (reels?.[0] ?? null);
  const failed = reels === null;
  const src = useReelPlayback(failed ? null : reel);
  const result = (reel?.last_good_render?.result ?? {}) as { height?: number };
  const rendered = renderedQuality(result.height);
  const [selected, setSelected] = useState<Quality>(rendered);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setSelected(rendered); }, [rendered]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = (s: string) => { setNote(s); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 2000); };
  const qualityLabel = (q: Quality) => ({ sd: t.body.home.hmQualitySd, hd: t.body.home.hmQualityHd, fhd: t.body.home.hmQualityFhd, uhd: t.body.home.hmQualityUhd })[q];
  const short = (q: Quality) => q.toUpperCase();
  const isRendered = selected === rendered;
  return (
    <section aria-label="Featured reel" className="flex min-w-0 flex-col gap-2.5" data-featured={reel ? reel.id : reel === null ? "none" : "loading"}>
      <div className="flex items-center justify-between gap-2">
        <span className="t-body">{t.body.home.hmFeaturedReel}</span>
        <select aria-label={t.body.home.hmQuality} value={selected} onChange={(e) => setSelected(e.target.value as Quality)}
          className="h-7 w-auto rounded-ctl border border-line2 bg-panel px-2 t-small text-ink outline-none focus:border-primary">
          {QUALITIES.map((q) => (
            <option key={q} value={q}>{qualityLabel(q)} · {q === rendered ? t.body.home.hmRendered : t.body.home.hmNotRendered}</option>
          ))}
        </select>
      </div>
      {failed ? (
        <button type="button" className="t-body text-left text-primary hover:underline" onClick={() => reloadRenderedReels()}>
          {t.body.home.featuredLoadFailed}
        </button>
      ) : reel ? (
        <>
          <Link href={`/reels/${reel.id}`} className="relative grid aspect-video place-items-center overflow-hidden rounded-md bg-black text-ink"
            aria-label={`${t.body.reelstage.playBtn}: ${reel.name}`}>
            {src ? <video src={src} className="absolute inset-0 h-full w-full object-cover" muted playsInline preload="metadata" /> : null}
            <span className="relative grid h-11 w-11 place-items-center rounded-full bg-white/10"><Play className="h-5 w-5" aria-hidden /></span>
            <span className="t-mono absolute bottom-2 right-2 rounded-sm bg-black/70 px-1.5 text-[12px] leading-5">{mmss(reelSeconds(reel))}</span>
          </Link>
          <span className="t-body block truncate font-normal">{reel.name}</span>
          <span className="t-small block truncate text-muted">
            {[fill(t.desktop.featuredClips, { n: reel.clips.length }), reel.aspect, codec(reel), quality(result.height)].join(" · ")}
          </span>
          <span className="t-small text-muted">
            {isRendered ? fill(t.body.home.hmPlaying, { a: short(selected) }) : <>{qualityLabel(selected)} · {t.body.home.hmNotRendered}. <Link href="/exports" className="text-primary hover:underline">{t.nav.export}</Link></>}
          </span>
          <div className="flex gap-2">
            <Link href={`/reels/${reel.id}`} className="vie-btn vie-btn-sm">{t.body.reelstage.playBtn}</Link>
            <button type="button" className="vie-btn vie-btn-sm"
              onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/reels/${reel.id}`).then(() => flash("Link copied"), () => flash("Copy failed")); }}>
              {t.body.library.share}
            </button>
          </div>
          {note && <p role="status" className="t-small text-primary">{note}</p>}
        </>
      ) : (
        <p className="t-small text-muted">{reel === null ? t.body.home.noFeaturedReel : t.common.loading}</p>
      )}
    </section>
  );
}

function KpiRow() {
  const { t } = useLocale();
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void api<OverviewStats>("/v1/overview/stats").then((x) => { setStats(x); setFailed(false); }, () => setFailed(true));
  }, []);
  const delta = (arr: number[]) => arr[arr.length - 1] ?? 0;
  const rows: [string, number, number][] = stats ? [
    [t.body.home.hmMatchesAnalysed, stats.matches_analyzed, delta(stats.weekly.matches_analyzed)],
    [t.body.home.hmPlayersTracked, stats.players_tracked, delta(stats.weekly.players_tracked)],
    [t.body.home.hmReelsGenerated, stats.reels_generated, delta(stats.weekly.reels_generated)],
    [t.body.home.hmReportsCreated, stats.reports_created, delta(stats.weekly.reports_created)],
  ] : [];
  return (
    <div className="grid grid-cols-2 gap-6 border-y border-line py-3 md:grid-cols-4" aria-label={t.body.home.kpiStripAria}>
      {failed && <p className="t-small col-span-full text-danger">{fill(t.body.home.kpiAriaFailed, { label: t.body.home.kpiStripAria })}</p>}
      {rows.map(([label, value, d]) => (
        <div key={label}>
          <span className="t-small block text-muted">{label}</span>
          <div className="t-body mt-0.5">{stats ? value : "—"} <span className="text-muted">· +{d}</span></div>
        </div>
      ))}
      {!stats && !failed && <p className="t-small col-span-full text-muted">{t.common.loading}</p>}
    </div>
  );
}

function ReviewInboxPanel() {
  const { t } = useLocale();
  const inbox = useHomeInbox();
  const items = inbox?.items ?? [];
  return (
    <section aria-label={t.body.home.hmReviewInbox} className="vie-panel min-w-0">
      <div className="vie-ph">
        <h2 className="t-panel">{t.body.home.hmReviewInbox}</h2>
        <span className="t-small text-muted">
          {inbox === undefined ? t.common.loading : inbox === null ? t.body.home.matchesLoadFailed : items.length ? t.body.home.inboxToDo.replace("{a}", String(items.length)) : t.body.home.inboxAllClear}
        </span>
      </div>
      {items.length === 0 && inbox !== undefined && inbox !== null && <p className="t-small p-3 text-muted">{t.body.home.inboxNothingWaits}</p>}
      <ul className="flex flex-col p-1.5">
        {items.slice(0, 5).map((it, i) => (
          <li key={`${it.kind}-${i}`}>
            <Link href={it.href} data-inbox={it.kind} className="flex min-h-[52px] items-center gap-3 rounded px-2 py-2 hover:bg-raised">
              <span className="min-w-0 flex-1">
                <span className="t-body block truncate font-normal">{it.title}</span>
                <span className="t-small block truncate text-muted">{it.detail ?? ""}</span>
              </span>
              <span className="vie-btn vie-btn-sm">{t.body.home.hmReview}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActiveJobsPanel() {
  const { t } = useLocale();
  const [list, setList] = useState<JobList | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api<JobList>("/v1/jobs").then((x) => { if (live) setList(x); }, () => undefined);
    load();
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);
  const waiting = list ? list.active - list.running : 0;
  return (
    <section aria-label={t.body.home.hmActiveJobs} className="vie-panel min-w-0">
      <div className="vie-ph">
        <h2 className="t-panel">{t.body.home.hmActiveJobs}</h2>
        <Link href="#jobs-center" className="t-small text-primary hover:underline" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent("otsi-jobs-open")); }}>
          {t.desktop.jobsCenter}
        </Link>
      </div>
      <div className="flex min-h-[52px] flex-col justify-center px-3 py-2">
        <span className="t-body">
          {list ? fill(t.body.home.inboxRunning, { a: String(list.running), b: String(waiting) }) : t.common.loading}
        </span>
        <span className="t-small text-muted">
          {list && list.active === 0 ? t.body.home.inboxNoJobs : list?.jobs[0]?.subject_title ?? ""}
        </span>
      </div>
    </section>
  );
}

function HomeContent() {
  const { t } = useLocale();
  return (
    <div className="flex w-full flex-col gap-4 px-7 py-5" data-page="home">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(220px,1fr)_minmax(340px,1.6fr)_minmax(220px,1fr)]">
        <Start />
        <section aria-label="Live picture" className="min-w-0"><HeroLive /></section>
        <FeaturedReel />
      </div>
      <KpiRow />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label={t.body.home.hmRecentMatches} className="min-w-0">
          <RecentMatches />
          <p className="t-small mt-1.5 text-muted">{t.body.home.hmThumbNote}</p>
        </section>
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
