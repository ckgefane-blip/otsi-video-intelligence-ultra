"use client";
/**
 * v3 Phase B.13 (ADR-089): the confirmation before Generate Reel. It lists what the render will hold (player, clips and length, frame,
 * spotlight, overlays, branding, music, file) from the reel and the look about to be saved, says when unsaved changes will be saved with
 * it, and how long it may take, measured from this organization's own finished renders (GET /v1/reels/:id/render-estimate). Nothing
 * starts until "Start render".
 *
 * ADR-139 Group C: the summary rows and the estimate line are built here from the dictionary (the contracts helpers renderSummary /
 * estimateLine return English strings and must not be edited), so the confirmation is translated in every locale.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { type Reel, type RenderEstimate, type SpotlightSettings } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { useMusic } from "./MusicPicker";

/** duration words from the dictionary (the contracts durationWords is English-only): "45 s" / "4 min" / "1 h 5 min". */
function durWords(d: Dictionary["body"]["reelstage"], s: number): string {
  if (s < 60) return d.durationSec.replace("{a}", String(Math.max(1, Math.round(s))));
  const m = Math.round(s / 60);
  if (m < 60) return d.durationMin.replace("{a}", String(m));
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? d.durationHourMin.replace("{a}", String(h)).replace("{b}", String(rest)) : d.durationHour.replace("{a}", String(h));
}

/** the measured estimate line, from the dictionary (same shape as the contracts estimateLine). */
function estimateText(d: Dictionary["body"]["reelstage"], e: RenderEstimate | null): string {
  if (!e) return d.estimateEstimating;
  if (e.basis === 0 || e.seconds === null) return d.estimateNoBasis;
  const range = e.low_seconds !== null && e.high_seconds !== null && e.high_seconds > e.low_seconds
    ? d.estimateRange.replace("{a}", durWords(d, e.low_seconds)).replace("{b}", durWords(d, e.high_seconds)) : "";
  const diff = e.same_tracking ? "" : d.estimateDiffTracking;
  const waiting = !e.waiting ? "" : (e.waiting === 1 ? d.estimateWaitingOne : d.estimateWaitingMany).replace("{a}", String(e.waiting));
  const tpl = e.basis === 1 ? d.estimateAboutOne : d.estimateAboutMany;
  return tpl.replace("{a}", durWords(d, e.seconds)).replace("{b}", range).replace("{c}", String(e.basis)).replace("{e}", diff).replace("{f}", waiting);
}

/** the summary rows the confirmation shows (same shape as the contracts renderSummary). */
function summaryRows(d: Dictionary["body"]["reelstage"], reel: Reel, s: SpotlightSettings, codec: string, musicName: string | null): [string, string][] {
  const overlays = [s.name_caption && d.summaryOverlayPlayerCard, s.score_bug && d.summaryOverlayScore, s.lower_third && d.summaryOverlayLowerThird,
    s.competition_logo_id && d.summaryOverlayCompLogo].filter(Boolean) as string[];
  const brand = [s.watermark && d.summaryBrandWatermark, s.custom_logo_id && d.summaryBrandLogo, s.end_screen && d.summaryBrandEnd,
    s.intro_id && d.summaryBrandIntro, s.outro_id && d.summaryBrandOutro].filter(Boolean) as string[];
  const secs = Math.round(reel.duration_us / 1e6);
  const len = secs >= 60 ? d.durationMinSec.replace("{a}", String(Math.floor(secs / 60))).replace("{b}", String(secs % 60))
    : d.durationSec.replace("{a}", String(secs));
  return [
    [d.summaryPlayer, reel.player ? `${reel.player.display_name}${reel.player.canonical_otsi_id ? ` · ${reel.player.canonical_otsi_id}` : ""}${d.summaryPlayerConfirmed}` : d.summaryPlayerNone],
    [d.summaryClips, (reel.clips.length === 1 ? d.summaryClipsOne : d.summaryClipsMany).replace("{a}", String(reel.clips.length)).replace("{b}", len)],
    [d.summaryFrame, reel.aspect],
    [d.summarySpotlight, `${s.auto_track ? d.summarySpotlightAuto : d.summarySpotlightManual}${d.summarySpotlightDim.replace("{a}", String(Math.round(s.dim * 100)))}`],
    [d.summaryOverlays, overlays.length ? overlays.join(", ") : d.summaryNone],
    [d.summaryBranding, brand.length ? brand.join(", ") : d.summaryNone],
    [d.summaryMusic, musicName ?? d.summaryMusicNone],
    [d.summaryFile, codec === "h264" ? "H.264 MP4" : codec === "av1" ? "AV1 MP4" : "VP9 WebM"],
  ];
}

export function ConfirmRender({ reel, settings, codec, dirty, open, onOpenChange, onStart }: {
  reel: Reel; settings: SpotlightSettings; codec: string; dirty: boolean; open: boolean; onOpenChange(o: boolean): void; onStart(): void;
}) {
  const { t: dict } = useLocale();
  const [est, setEst] = useState<RenderEstimate | null>(null);
  const [failed, setFailed] = useState(false);
  const [music] = useMusic();
  useEffect(() => {
    if (!open) return;
    let live = true;
    setEst(null); setFailed(false);
    api<RenderEstimate>(`/v1/reels/${reel.id}/render-estimate`).then((e) => live && setEst(e), () => live && setFailed(true));
    return () => { live = false; };
  }, [open, reel.id, reel.version]);
  const tune = settings.music_id ? (music?.find((m) => m.id === settings.music_id)?.name ?? dict.body.reelstage.musicChosenFallback) : null;
  const rows = summaryRows(dict.body.reelstage, reel, settings, codec, tune);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="confirm-render" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(560px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-semibold">{dict.body.reels.renderReel}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{dict.body.reelstage.confirmDesc}</Dialog.Description>
          <dl className="mb-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5" data-render-summary>
            {rows.map(([k, v]) => (<div key={k} className="contents" data-summary-row={k}><dt className="text-muted">{k}</dt><dd>{v}</dd></div>))}
          </dl>
          {dirty && <p className="mb-2 text-xs text-[#f5b82e]" data-unsaved>{dict.body.reelstage.unsavedFirst}</p>}
          <p className="mb-3 text-xs" data-estimate>{failed ? dict.body.reelstage.estimateNone : estimateText(dict.body.reelstage, est)}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-ctl border border-line px-3 py-1.5">{dict.body.reels.backToEditing}</button>
            <button type="button" data-start-render onClick={() => { onOpenChange(false); onStart(); }} className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">{dict.body.reels.startRender}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
