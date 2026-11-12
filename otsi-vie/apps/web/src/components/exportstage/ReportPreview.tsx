"use client";
/**
 * v3 Phase B.23 (ADR-098): preview a rule-built report (Performance Report, Clip Sheet) before making its file. The page is built now
 * from the engine's records (GET /v1/reels/:id/bundles/preview/:kind) and shown in a sandboxed frame (no scripts); nothing is saved.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { BUNDLE_ITEM_NAMES, type PreviewKind, type ReportPreview } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";

export function ReportPreviewDialog({ reelId, kind, onClose }: { reelId: string; kind: PreviewKind | null; onClose(): void }) {
  const [doc, setDoc] = useState<ReportPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!kind) return;
    let live = true;
    setDoc(null); setErr(null);
    api<ReportPreview>(`/v1/reels/${reelId}/bundles/preview/${kind}`).then((d) => live && setDoc(d),
      (x) => live && setErr(x instanceof ApiProblem ? x.message : "The preview could not be made."));
    return () => { live = false; };
  }, [reelId, kind]);
  return (
    <Dialog.Root open={!!kind} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="report-preview" data-kind={kind ?? ""} className="fixed left-1/2 top-1/2 z-50 flex h-[90vh] w-[min(900px,96vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-normal">Preview: {kind ? BUNDLE_ITEM_NAMES[kind][0] : ""}</Dialog.Title>
          <Dialog.Description className="mb-2 text-xs text-muted">
            Built now from what the engine recorded{doc ? ` (${new Date(doc.generated_at).toLocaleTimeString()})` : ""}. Nothing is saved; the file made later shows the records as they are then.
          </Dialog.Description>
          <div className="min-h-0 flex-1 overflow-hidden rounded border border-line bg-white">
            {err ? <p className="p-3 text-[#b00]" data-preview-error>{err}</p>
              : !doc ? <p className="p-3 text-[#555]">Building the preview…</p>
              : <iframe title="Report preview" sandbox="" srcDoc={doc.html} className="h-full w-full" data-preview-frame />}
          </div>
          <div className="mt-3 flex justify-end"><Dialog.Close className="rounded border border-line px-3 py-1.5">Close</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
