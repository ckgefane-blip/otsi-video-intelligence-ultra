"use client";
/**
 * Page 03: choose which video's processing to show (contextual dialog). Lists the organization's videos (GET /v1/videos) with their
 * real state; choosing one puts it in the address (?video=), so the page can be bookmarked and shared inside the organization.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Video } from "@otsi-vie/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { useLocale } from "@/lib/i18n";

/** `basePath`: the page that shows the chosen video (Processing by default, Tactical uses its own) */
export function VideoPicker({ open, onOpenChange, current, basePath = "/processing" }:
  { open: boolean; onOpenChange: (o: boolean) => void; current: string | null; basePath?: string }) {
  const { t: dict } = useLocale();
  const d = dict.body.processing;
  const u = dict.body.upload;
  const router = useRouter();
  const [videos, setVideos] = useState<Video[] | null | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    void api<Video[]>("/v1/videos").then(setVideos, () => setVideos(null));
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl"
          data-dialog="choose-video">
          <Dialog.Title className="text-base font-normal">{d.chooseVideoTitle}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{d.chooseVideoDesc}</Dialog.Description>
          {videos === undefined && <p className="text-muted">{dict.common.loading}</p>}
          {videos === null && <p role="alert" className="text-danger">{d.couldNotLoadVideos2}</p>}
          {videos?.length === 0 && <p className="text-muted">{d.noVideosYet} <a className="text-primary underline" href="/upload">{d.uploadOne}</a>.</p>}
          <ul className="space-y-1" aria-label={u.videos}>
            {videos?.map((v) => (
              <li key={v.id}>
                <button type="button" data-video={v.id} aria-current={v.id === current}
                  onClick={() => { onOpenChange(false); router.replace(`${basePath}?video=${v.id}`); }}
                  className={`flex w-full items-center justify-between gap-3 rounded-ctl border px-3 py-2 text-left hover:border-primary/60 ${v.id === current ? "border-primary bg-primary/5" : "border-line/70"}`}>
                  <span className="min-w-0 truncate font-normal">{v.title ?? v.original_filename ?? u.untitledVideo}</span>
                  <span className="shrink-0 text-xs text-muted">{formatDuration(v.duration_us)} · {v.state === "INGESTED" ? d.readyState : v.state.toLowerCase()}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
