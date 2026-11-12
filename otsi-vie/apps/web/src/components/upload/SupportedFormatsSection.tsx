"use client";
/**
 * Page 02 Section 07 — supported formats strip, on the Desktop UI flow layout. The eight tiles are containers the
 * server accepts (each is in its accepted list); "View all formats" lists every accepted extension and the server's real size limit
 * (GET /v1/upload-limits). The tiles state what is accepted; only "View all formats" is interactive.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import { usePage02 } from "./page02";

const TILES: [string, string][] = [["MP4", "H.264/H.265"], ["MOV", "Apple ProRes"], ["AVI", "H.264"], ["MKV", "H.264/H.265"],
  ["MPEG", "MPEG-2"], ["FLV", "H.264"], ["TS", "MPEG-TS"], ["WEBM", "VP9"]];

export function SupportedFormatsSection() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { limits } = usePage02();
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={d.supportedFormatsStrip} data-section="p02-s07" className="vie-panel">
      <div className="vie-ph">
        <h2 className="t-panel">{d.supportedFormats}</h2>
        <button type="button" onClick={() => setOpen(true)} className="text-sm text-primary">{d.viewAllFormats}</button>
      </div>
      <ul aria-label={d.supportedFormats} className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        {TILES.map(([name, codec]) => (
          <li key={name} className="rounded-ctl border border-line/70 bg-raised/40 px-3 py-2">
            <span className="block text-sm font-normal">{name}</span>
            <span className="block text-xs text-muted">{codec}</span>
          </li>
        ))}
      </ul>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(460px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-normal">{d.acceptedVideoFiles}</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">
              {limits ? d.upToGbPerFile.replace("{n}", String(Math.round(limits.max_upload_bytes / 1024 ** 3))) + " " : ""}{d.everyFileVerified}
            </Dialog.Description>
            <ul aria-label={d.acceptedExtensions} className="flex flex-wrap gap-1.5">
              {(limits?.accepted_extensions ?? []).map((e) => <li key={e} className="rounded border border-line px-2 py-0.5 font-mono text-xs">.{e}</li>)}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
