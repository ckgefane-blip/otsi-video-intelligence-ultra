"use client";
/**
 * Page 10 Sections 02-05 — workflow, Project Summary, reel preview with transport, Highlight Chapters
 * (approved reference 10_EXPORT_DELIVERY, left and centre), laid out in the page's flow on the Desktop UI components.
 *
 * The preview plays the chosen reel's finished render through the shared VideoPlayer; without one it shows the honest empty
 * state with the truthful state (reel name, render state, what to do next). Chapters are the reel's clips (a clip is a chapter):
 * choosing one seeks the render to where that clip begins (the player restarts at that second). Of the three metric overlays,
 * Key Passes is the reel player's count from the engine's events (GET /v1/players/:id/measures, owner 2026-11-02); progressive
 * passes and chance creation are not measured ("—"). Workflow step 3 starts the render with the settings on the right.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { actionClips, clipOutputUs, gapUs, slotUs, type PlayerEvents, type PlayerMeasures } from "@otsi-vie/contracts";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Captions, Check, ChevronLeft, ChevronRight, Film } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { sec, useExport } from "./state";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { notBuilt } from "@/lib/devMode";

const WF: [string, string][] = [["Edit & Finalize", "Review highlights and settings"], ["Export Settings", "Choose format, branding and output"],
  ["Render & Process", "Generate high-quality video"], ["Deliver & Share", "Send to clients and collaborators"]];

/** the render state as a word in the current language (API states are codes, never shown raw) */
const renderWord = (state: string | null | undefined, d: Dictionary["body"]["reels"]) =>
  state === "SUCCEEDED" ? d.renderStateSucceeded : state === "FAILED" ? d.renderStateFailed : state === "QUEUED" ? d.renderStateQueued : state === "RUNNING" ? d.renderStateRunning : d.renderStateNotRendered;

export function Workflow() {
  const { t: dict } = useLocale();
  const e = useExport();
  const r = e.reel?.latest_render ?? null;
  // v3 Phase 0: step 2 is done once a render used the settings, step 4 once the reel was delivered (handed to a mail app)
  const delivered = !!e.outbox.deliveries?.some((d) => d.state === "SUCCEEDED");
  const ready = r?.state === "SUCCEEDED" && !!e.links;
  const done = [!!e.reel && e.reel.clips.length > 0, !!r, r?.state === "SUCCEEDED", delivered];
  const cur = !e.reel ? 0 : r?.state === "SUCCEEDED" ? 3 : r && ["QUEUED", "RUNNING"].includes(r.state) ? 2 : e.reel.clips.length ? 1 : 0;
  const canRender = !!e.reel && e.canEdit && !e.busy && e.reel.clips.length > 0 && !e.reel.stale && !(r && ["QUEUED", "RUNNING"].includes(r.state));
  const [note, setNote] = useState<string | null>(null);
  const act = [() => e.reel && (window.location.href = `/reels/${e.reel.id}`), () => e.jump(0), canRender ? () => e.render() : undefined,
    ready && e.canEdit ? () => e.outbox.setDialog(true) : undefined] as const;
  const why = [dict.body.exportstage.wfWhyOpenReel, "", !e.reel ? dict.body.exportstage.wfWhyOpenReel : e.reel.clips.length === 0 ? dict.body.exportstage.wfWhyNoClips : e.reel.stale ? dict.body.exportstage.wfWhyStale : r && ["QUEUED", "RUNNING"].includes(r.state) ? dict.body.exportstage.wfWhyRunning : dict.body.exportstage.wfWhyNoEdit,
    !ready ? dict.body.exportstage.wfWhyNotReady : dict.body.exportstage.wfWhyNoDeliver];
  const wfWords: [string, string][] = [
    [dict.body.exportstage.wfEdit, dict.body.exportstage.wfEditSub],
    [dict.body.exportstage.wfSettings, dict.body.exportstage.wfSettingsSub],
    [dict.body.exportstage.wfRender, dict.body.exportstage.wfRenderSub],
    [dict.body.exportstage.wfDeliver, dict.body.exportstage.wfDeliverSub],
  ];
  return (
    <section aria-label={dict.body.exportstage.workflowAria} data-section="p10-s02" className="vie-panel p-3">
      <h1 className="text-base font-semibold">{dict.body.exportstage.workflowTitle}</h1>
      <p className="mt-1 text-sm text-muted">{dict.body.exportstage.workflowSub1}</p>
      <p className="text-sm text-muted">{dict.body.exportstage.workflowSub2}</p>
      <ol aria-label={dict.body.exportstage.exportStepsAria} className="mt-3 flex flex-col gap-1">
        {WF.map(([t, s], i) => {
          const [wt, ws] = wfWords[i] ?? [t, s];
          const on = act[i];
          return (
            <li key={t} data-step={t} data-done={done[i] ? "1" : "0"} aria-current={cur === i ? "step" : undefined}>
              <button type="button" aria-label={`${wt}: ${ws}`} aria-pressed={cur === i}
                onClick={on ?? (() => setNote(why[i]!))}
                title={on ? undefined : why[i]}
                className={`flex w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left ${cur === i ? "border-primary bg-raised" : "border-line bg-transparent hover:bg-raised"}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done[i] ? "bg-ok text-white" : cur === i ? "bg-primary text-white" : "border border-line bg-raised text-ink"}`} aria-hidden>
                  {done[i] ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{wt}</span>
                  <span className="block truncate text-xs text-muted">{ws}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {note && <p role="status" className="mt-2 text-xs text-muted">{note}</p>}
    </section>
  );
}

function Picker({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t: dict } = useLocale();
  const e = useExport();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl" data-dialog="choose-reel">
          <Dialog.Title className="text-base font-semibold">{dict.body.exports.openReelToExport}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{dict.body.exportstage.pickerDesc}</Dialog.Description>
          {e.reels === null && !e.reelsFailed && <p className="text-muted">{dict.common.loading}</p>}
          {e.reelsFailed && (<><p className="text-muted">{dict.body.reels.reelsNotLoaded}</p>
            <button type="button" onClick={() => void e.reload()} className="rounded-ctl border border-line px-3 py-1.5">{dict.common.retry}</button></>)}
          {e.reels?.length === 0 && !e.reelsFailed && <p className="text-muted">{dict.body.studio.noReelsYet}</p>}
          <ul aria-label={dict.pages.reels.title} className="space-y-1">
            {e.reels?.map((r) => (
              <li key={r.id}>
                <Link href={`/exports?reel=${r.id}`} data-reel={r.id} onClick={() => onOpenChange(false)} className="flex items-center justify-between gap-3 rounded-ctl border border-line/70 px-3 py-2 hover:border-primary/60">
                  <span className="min-w-0 truncate font-medium">{r.name}</span>
                  <span className="shrink-0 text-xs text-muted">{(r.clips.length === 1 ? dict.body.exportstage.pickerClipsOne : dict.body.exportstage.pickerClipsMany).replace("{a}", String(r.clips.length))} · {renderWord(r.latest_render?.state, dict.body.reels)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Summary() {
  const { t: dict } = useLocale();
  const e = useExport();
  const [open, setOpen] = useState(false);
  const rows: [string, string][] = [[dict.body.exportstage.summaryRowSource, e.match?.title ?? "—"], [dict.body.exportstage.summaryRowCompetition, e.match?.competition ?? "—"],
    [dict.body.exportstage.summaryRowDate, e.match?.date ?? "—"], [dict.body.exportstage.summaryRowDuration, e.reel ? sec(e.reel.duration_us) : "—"]];
  return (
    <section aria-label={dict.body.exportstage.summaryAria} data-section="p10-s03" data-reel={e.reel?.id ?? ""} className="vie-panel p-3">
      <h2 className="t-panel">{dict.body.exports.projectSummary}</h2>
      <button type="button" aria-label={dict.body.exports.openReelToExport} onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center gap-3 rounded-md border border-line bg-raised p-2.5 text-left hover:border-primary/60">
        <span className="grid h-16 w-[104px] shrink-0 place-items-center rounded border border-line bg-p0 text-muted" aria-hidden>
          <Film className="h-6 w-6" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{e.reel?.name ?? dict.body.exportstage.summaryNoProject}</span>
          <span className="block truncate text-sm">{e.reel ? (e.reel.player?.display_name ?? dict.body.exportstage.summaryNoPlayer) : dict.body.exports.openReelToExport}</span>
        </span>
      </button>
      <dl className="mt-2 flex flex-col">
        {rows.map(([l, v]) => (
          <div key={l} className="flex items-baseline gap-2 border-b border-line/40 py-1 text-sm last:border-0">
            <dt className="w-28 shrink-0 text-muted">{l}</dt>
            <dd className="m-0 min-w-0 flex-1 truncate">{v}</dd>
          </div>
        ))}
        <div className="flex items-baseline gap-2 py-1 text-sm">
          <dt className="w-28 shrink-0 text-muted">{dict.body.exportstage.tagsLabel}</dt>
          <dd className="m-0">—</dd>
        </div>
      </dl>
      <Picker open={open} onOpenChange={setOpen} />
    </section>
  );
}

export function Preview() {
  const { t: dict } = useLocale();
  const e = useExport();
  const playerId = e.reel?.player?.player_id ?? null;
  const [measures, setMeasures] = useState<PlayerMeasures | null>(null);
  useEffect(() => { setMeasures(null); if (playerId) void api<PlayerMeasures>(`/v1/players/${playerId}/measures`).then(setMeasures, () => setMeasures(null)); }, [playerId]);
  const keyPasses = measures?.events ? String(measures.events.key_passes) : null;
  const metricWords = [dict.body.exportstage.metricKeyPasses, dict.body.exportstage.metricProgPasses, dict.body.exportstage.metricChance];
  const r = e.reel?.latest_render ?? null;
  const url = e.links?.url ?? null;
  const res = (r?.result ?? null) as { width?: number; height?: number } | null;
  const line1 = e.reel ? e.reel.name : dict.body.exportstage.previewEmptyLine1;
  const line2 = !e.reel ? dict.body.exportstage.previewLineNotRendered : !r ? dict.body.exportstage.previewLineNotRendered : r.state === "SUCCEEDED" ? dict.body.exportstage.previewLineRendered : r.state === "FAILED" ? dict.body.exportstage.previewLineFailed : r.state === "QUEUED" ? dict.body.exportstage.previewLineWaiting : r.progress != null ? dict.body.exportstage.previewLineRendering.replace("{a}", String(Math.round(r.progress))) : dict.body.exportstage.previewLineRenderingNoPct;
  const line3 = !e.reel ? dict.body.exportstage.previewLineOpenReel : r?.state === "SUCCEEDED" ? "" : dict.body.exportstage.previewLineUseRender;
  // a chapter seek restarts the shared player at that second (the player exposes no seek handle)
  const [seekAt, setSeekAt] = useState<number | null>(null);
  const [seekNonce, setSeekNonce] = useState(0);
  const seek = useCallback((us: number) => { setSeekAt(us / 1e6); setSeekNonce((n) => n + 1); }, []);
  return (
    <section aria-label={dict.body.exportstage.previewAria2} data-section="p10-s04" data-preview={url ? "render" : "none"} className="vie-panel flex min-w-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-panel">{line1}</h2>
        {res?.height ? <span className="rounded border border-amber/60 px-1.5 py-0.5 text-xs font-semibold text-amber">{res.height}p{res.width ? ` · ${res.width}×${res.height}` : ""}</span> : null}
      </div>
      <p className="text-sm text-muted">{[line2, line3].filter(Boolean).join(" ")}</p>
      <VideoPlayer key={`${seekAt ?? "main"}-${seekNonce}`} src={url} label={dict.body.reels.previewRenderedAria}
        autoPlay={seekAt !== null} startAt={seekAt ?? undefined}
        empty={{ title: line1, body: [line2, line3].filter(Boolean).join(" ") }} />
      <div className="flex flex-wrap items-center gap-2" aria-label={dict.body.exportstage.playerAria2}>
        {[keyPasses ?? "—", "—", "—"].map((v, i) => (
          <span key={metricWords[i]} title={i === 0 && keyPasses !== null ? dict.body.exportstage.metricKeyPassesTitle : dict.body.exportstage.metricNotMeasuredTitle}
            className="rounded-md border border-line bg-raised px-2.5 py-1.5 text-sm">
            <span className="mr-2 t-metric">{v}</span>
            <span className="text-muted">{metricWords[i]}</span>
          </span>
        ))}
        <span className="flex-1" />
        <button type="button" disabled title={notBuilt("the reel has no captions")} className="vie-btn vie-btn-sm disabled:opacity-60">
          <Captions className="h-4 w-4" aria-hidden />{dict.body.exportstage.captions}
        </button>
      </div>
      <ChaptersBox seek={seek} canSeek={!!url} />
    </section>
  );
}

const ChaptersBox = memo(function ChaptersBox({ seek, canSeek }: { seek(us: number): void; canSeek: boolean }) {
  const { t: dict } = useLocale();
  const e = useExport();
  const row = useRef<HTMLDivElement | null>(null);
  const all = e.autoChapters ? e.reel?.clips ?? [] : [];
  // the chapter offsets and the shown list are memoised: Preview re-renders on every video timeupdate, and this box must not rebuild them then
  const allOffs = useMemo(() => { let acc = 0; return all.map((c) => { const o = acc + gapUs(c); acc += slotUs(c); return o; }); }, [all]);   // B.19: a chapter starts after its clip's spacer     // E2: reel time, with speed effects
  // B.23 (ADR-098): "Hide no-action" leaves out the chapters with no event of the reel's player that the engine recorded. With none of his
  // events recorded in this video it is not known which have action, and the filter stays off (unknown beats wrong).
  const pid = e.reel?.player?.player_id ?? null;
  const [events, setEvents] = useState<PlayerEvents | null>(null);
  const [hide, setHide] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setEvents(null);
    if (!pid) return;
    let live = true;
    api<PlayerEvents>(`/v1/players/${pid}/events`).then((x) => live && setEvents(x), () => live && setEvents(null));
    return () => { live = false; };
  }, [pid]);
  // ADR-131: a cross-match reel has no single video, so the single-video action filter cannot apply — the filter stays off
  // (unknown beats wrong), as it does when no event of his was recorded in the video.
  const acts = useMemo(() => (e.reel && events && e.reel.video_id ? actionClips(e.reel.video_id, all, events.items) : null), [e.reel, events, all]);
  const shown = useMemo(() => all.map((c, i) => ({ c, i, at: allOffs[i]! })).filter((x) => !(hide && acts) || acts.has(x.c.id)), [all, allOffs, acts, hide]);
  const clips = useMemo(() => shown.map((x) => x.c), [shown]), offs = useMemo(() => shown.map((x) => x.at), [shown]);
  const hidden = all.length - clips.length;
  const hideWhy = !pid ? dict.body.exportstage.hideNoActionNoPlayer : !events ? dict.body.exportstage.hideNoActionReading : dict.body.exportstage.hideNoActionNoEvents;
  return (
    <div className="rounded-md border border-line bg-raised/40 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">{hidden ? dict.body.exportstage.chaptersTitleOf.replace("{a}", String(clips.length)).replace("{b}", String(all.length)) : dict.body.exportstage.chaptersTitle.replace("{a}", String(clips.length))}</h2>
        <label className="flex items-center gap-2 text-xs text-muted">
          {dict.body.exportstage.autoChapters}
          <button type="button" role="switch" aria-checked={e.autoChapters} aria-label={dict.body.exportstage.autoChapters} className="vie-sw"
            onClick={() => e.setAutoChapters(!e.autoChapters)} />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          {dict.body.exportstage.hideNoAction}
          <button type="button" role="switch" aria-checked={hide && !!acts} aria-label={dict.body.exportstage.hideNoActionHit} title={acts ? undefined : hideWhy} className="vie-sw"
            onClick={() => (acts ? setHide(!hide) : setNote(hideWhy))} />
        </label>
        <span className="flex-1" />
        <button type="button" aria-label={dict.body.exportstage.editChaptersHit}
          title={e.reel ? undefined : dict.body.reelstage.openReelFirst}
          onClick={() => (e.reel ? (window.location.href = `/reels/${e.reel!.id}`) : setNote(dict.body.reelstage.openReelFirst))}
          className="vie-btn vie-btn-sm">{dict.body.exportstage.editChapters}</button>
      </div>
      {note && <p role="status" className="mt-1.5 text-xs text-muted">{note}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button type="button" aria-label={dict.body.exportstage.prevChapters} disabled={clips.length <= 4} title={clips.length > 4 ? undefined : dict.body.exportstage.noMoreChapters}
          onClick={() => row.current?.scrollBy({ left: -600, behavior: "smooth" })} className="vie-ib shrink-0 disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <div ref={row} role="list" aria-label={dict.body.exportstage.chaptersAria} className="flex min-w-0 flex-1 gap-3 overflow-x-auto py-0.5">
          {clips.length === 0 && <p className="py-4 text-sm text-muted">{hidden ? dict.body.exportstage.chaptersEmptyHidden : e.reel && !e.autoChapters ? dict.body.exportstage.chaptersEmptyOff : e.reel ? dict.body.exportstage.chaptersEmptyNoClips : dict.body.exportstage.chaptersEmptyNoReel}</p>}
          {clips.map((c, i) => (
            <button key={c.id} role="listitem" type="button" data-chapter={shown[i]!.i + 1} data-action={acts ? (acts.has(c.id) ? "1" : "0") : "unknown"} disabled={!canSeek} title={canSeek ? dict.body.exportstage.chapterSeek : dict.body.exportstage.chapterSeekNoRender} onClick={() => seek(offs[i]!)}
              className="w-[200px] shrink-0 rounded-md border border-line bg-panel p-2 text-left hover:border-primary/60 disabled:opacity-60">
              <span className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-white">{shown[i]!.i + 1}</span>
                <span className="ml-auto rounded-sm bg-black/75 px-1.5 py-0.5 text-xs tabular-nums text-white">{dict.body.reelstage.durS.replace("{a}", String(Math.round(clipOutputUs(c) / 1e6)))}</span>
              </span>
              <span className="mt-2 block truncate text-sm font-semibold">{c.label ?? `${dict.body.reelstage.clipListFallback} ${shown[i]!.i + 1}`}</span>
            </button>
          ))}
        </div>
        <button type="button" aria-label={dict.body.exportstage.nextChapters} disabled={clips.length <= 4} title={clips.length > 4 ? undefined : dict.body.exportstage.noMoreChapters}
          onClick={() => row.current?.scrollBy({ left: 600, behavior: "smooth" })} className="vie-ib shrink-0 disabled:opacity-40">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
});
