"use client";
/**
 * "Who is this player?" on Page 04 (owner, 2026-11-01: identify the selected player where he already is, not on another page). The same
 * selected-track panel as the Analysis Workspace page (identity decision with history, shirt number, roster suggestions, the same person in
 * other tracks, highlight reel), shown in a window over the approved composition for the player selected on the video or in the list.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { SelectedTrack } from "@/components/analysis/AnalysisWorkspace";

export function IdentifyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content data-dialog="identify" className="fixed right-4 top-1/2 z-50 max-h-[92vh] w-[min(560px,96vw)] -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 shadow-xl">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-semibold">Who is this player?</Dialog.Title>
              <Dialog.Description className="text-xs text-muted">
                Name him once here; then confirm the same person in his other tracks so his whole match counts. The video stays where it is.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-ctl bg-primary px-3 py-1 text-sm font-semibold text-white">Done</Dialog.Close>
          </div>
          <SelectedTrack />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
