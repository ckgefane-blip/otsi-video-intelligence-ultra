"use client";
/**
 * v3 Phase B.13 (ADR-089): the confirmation before Generate Reel. It lists what the render will hold (player, clips and length, frame,
 * spotlight, overlays, branding, music, file) from the reel and the look about to be saved, says when unsaved changes will be saved with
 * it, and how long it may take, measured from this organization's own finished renders (GET /v1/reels/:id/render-estimate). Nothing
 * starts until "Start render".
 */
import * as Dialog from "@radix-ui/react-dialog";
import { estimateLine, renderSummary, type Reel, type RenderEstimate, type SpotlightSettings } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useMusic } from "./MusicPicker";

export function ConfirmRender({ reel, settings, codec, dirty, open, onOpenChange, onStart }: {
  reel: Reel; settings: SpotlightSettings; codec: string; dirty: boolean; open: boolean; onOpenChange(o: boolean): void; onStart(): void;
}) {
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
  const tune = settings.music_id ? (music?.find((m) => m.id === settings.music_id)?.name ?? "Music chosen") : null;
  const rows = renderSummary(reel, settings, codec, tune);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="confirm-render" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(560px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-semibold">Render this reel?</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">Check what goes into the video. You can stop the render while it runs.</Dialog.Description>
          <dl className="mb-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5" data-render-summary>
            {rows.map(([k, v]) => (<div key={k} className="contents" data-summary-row={k}><dt className="text-muted">{k}</dt><dd>{v}</dd></div>))}
          </dl>
          {dirty && <p className="mb-2 text-xs text-[#f5b82e]" data-unsaved>Your unsaved changes are saved first, then rendered.</p>}
          <p className="mb-3 text-xs" data-estimate>{failed ? "No estimate: it could not be read." : estimateLine(est)}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-ctl border border-line px-3 py-1.5">Back to editing</button>
            <button type="button" data-start-render onClick={() => { onOpenChange(false); onStart(); }} className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">Start render</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
