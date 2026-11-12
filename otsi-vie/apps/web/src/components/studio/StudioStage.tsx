"use client";
/**
 * Page 07 Clip Studio / Timeline Editor on the approved composition (corrected reference 07_CLIP_STUDIO). The reel comes from the
 * address (?reel=); its data and actions come from the Reel Builder hook (useReel, ADR-035), so the studio and the Reel Builder edit
 * the same saved reel. Opened without one, it opens the most recently edited reel (owner 2026-11-02: "page 07 needs populating"); with no
 * reels at all the sections show the reference's empty state and the Media Bin offers the reel chooser.
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
import { StudioHeader } from "./StudioHeader";
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
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ui: Ui = {
    say: (t) => { setNote(t); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 3500); },
    pick: () => setPicking(true),
  };
  return (
    <div className="flex h-[calc(100dvh-180px)] min-h-[640px] flex-col gap-3">
      <StudioHeader r={r} st={st} ui={ui} note={note} />
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_320px] gap-3">
        <MediaBin r={r} st={st} onPick={() => setPicking(true)} say={ui.say} />
        <Preview st={st} ui={ui} />
        <Inspector r={r} st={st} ui={ui} />
      </div>
      <Timeline r={r} st={st} ui={ui} />
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
