"use client";
/**
 * Page 07 Clip Studio (SOT, Studio.dc.html).
 *
 * The reel comes from the address (?reel=); its data and actions come
 * from the Reel Builder hook (useReel, ADR-035), so the studio and the
 * Reel Builder edit the same saved reel. Opened without one, it opens
 * the most recently edited reel; with no reels at all the sections show
 * the empty state and the Media Bin offers the reel chooser. The layout
 * is the SOT's: a top row (Media Bin | centre with the telestration bar
 * over the preview | inspector) and the four-lane timeline at the
 * bottom. There is no header here — the undo / redo shortcuts
 * (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) live in this file. The preview is
 * the working compositor (its own transport, spotlight, zoom and
 * drawings); the SOT's simpler control bar is not a replacement for it.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Reel } from "@otsi-vie/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ReelBuilder, useReel, type ReelState } from "@/components/reels/ReelBuilder";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/identity";
import { Inspector } from "./Inspector";
import { MediaBin } from "./MediaBin";
import { Preview } from "./Preview";
import { TelestrationBar } from "./TelestrationBar";
import { Timeline } from "./Timeline";
import type { Ui } from "./kit";
import { useStudio } from "./useStudio";

function ReelPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t: dict } = useLocale();
  const router = useRouter();
  const [reels, setReels] = useState<Reel[] | null | undefined>(undefined);
  useEffect(() => { if (open) void api<Reel[]>("/v1/reels").then(setReels, () => setReels(null)); }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 t-body shadow-2xl">
          <Dialog.Title className="t-panel">{dict.body.studio.chooseReel}</Dialog.Title>
          <Dialog.Description className="mb-3 t-small">Reels are made in the Reel Builder for a confirmed player; edit their clips here.</Dialog.Description>
          {reels === undefined && <p className="text-muted">{dict.common.loading}</p>}
          {reels === null && <p role="alert" className="text-danger">{dict.body.studio.reelsLoadFailed}</p>}
          {reels?.length === 0 && <p className="text-muted">{dict.body.studio.noReelsYet} <a className="text-primary underline" href="/reels">{dict.body.studio.makeInReelBuilder}</a>.</p>}
          <ul className="space-y-1" aria-label={dict.pages.reels.title}>
            {reels?.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => { onOpenChange(false); router.replace(`/studio?reel=${r.id}`); }}
                  className="flex w-full justify-between gap-3 rounded-ctl border border-line/70 px-3 py-2 text-left hover:border-primary/60">
                  <span className="min-w-0 truncate font-normal">{r.name}</span>
                  <span className="shrink-0 t-small">{r.player?.display_name ?? "—"} · {r.clips.length} clips</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Sections({ r }: { r: ReelState | null }) {
  const st = useStudio(r);
  const [picking, setPicking] = useState(false);
  const [binTab, setBinTab] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ui: Ui = {
    say: (t) => { setNote(t); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 3500); },
    pick: () => setPicking(true),
  };
  // undo / redo (was in the old StudioHeader; the SOT has no header)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, select, textarea, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); }
      if (e.key === "y" || e.key === "Y") { e.preventDefault(); st.redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [st]);
  return (
    <div className="flex min-h-full w-full flex-col" data-stage="studio" data-page="studio">
      <div className="flex min-h-0 flex-1">
        <MediaBin r={r} st={st} onPick={() => setPicking(true)} say={ui.say} binTab={binTab} setBinTab={setBinTab} />
        <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto bg-canvas p-2.5">
          <TelestrationBar st={st} ui={ui} />
          <Preview st={st} ui={ui} />
          {note && <p role="status" className="t-small text-center text-muted">{note}</p>}
        </main>
        <Inspector r={r} st={st} ui={ui} />
      </div>
      <Timeline r={r} st={st} ui={ui} setBinTab={setBinTab} />
      <ReelPicker open={picking} onOpenChange={setPicking} />
    </div>
  );
}

function WithReel() {
  return <Sections r={useReel()} />;
}

export function StudioStage() {
  const reel = useSearchParams().get("reel");
  const router = useRouter();
  const wanted = !!reel && isUuid(reel);
  useEffect(() => {
    if (wanted) return;
    void api<Reel[]>("/v1/reels").then((all) => {
      const last = [...all].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      if (last) router.replace(`/studio?reel=${last.id}`);
    }, () => undefined);
  }, [wanted, router]);
  if (!wanted) return <Sections r={null} />;
  return <ReelBuilder key={reel} reelId={reel}><WithReel /></ReelBuilder>;
}
