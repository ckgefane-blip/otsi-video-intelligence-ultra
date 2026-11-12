"use client";
/**
 * Page 02 Section 01 — upload page header and source-mode tabs, on the Desktop UI flow layout.
 *
 * The three tabs are the real source modes, kept in the address (?mode=file|url|batch) so Home's buttons open the right one: Upload File
 * (one file, resumable), YouTube / URL (import a link: the link field below is focused) and Batch Upload (several files at once).
 * Need help? explains what each mode really does and which links can be imported (the server's own provider list).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { IMPORT_PROVIDERS } from "@otsi-vie/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SOURCE_MODES, sourceMode, type SourceMode } from "@/components/page/SourceModeTabs";
import { useLocale } from "@/lib/i18n";

export function useSourceMode(): [SourceMode, (m: SourceMode) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mode = sourceMode(params.get("mode"));
  const set = (m: SourceMode) => {
    const next = new URLSearchParams(params.toString());
    if (m === "file") next.delete("mode"); else next.set("mode", m);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  return [mode, set];
}

export function UploadHeaderSection() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  // SourceModeTabs (components/page) is outside this scope: its English labels/notes are re-mapped here.
  const LABEL: Record<SourceMode, string> = { file: d.sourceFile, url: "YouTube / URL", batch: d.sourceBatch };
  const NOTE: Record<SourceMode, string> = { file: d.sourceFileNote, url: d.sourceUrlNote, batch: d.sourceBatchNote };
  const [mode, setMode] = useSourceMode();
  const [help, setHelp] = useState(false);
  return (
    <section aria-label={d.uploadHeaderAria} data-section="p02-s01" data-mode={mode} className="vie-panel">
      <div className="vie-ph flex-wrap gap-2 py-2">
        <div className="min-w-0">
          <h1 className="t-page">{d.uploadIngest}</h1>
          <p className="t-small">{d.uploadSubtitle}</p>
        </div>
        <button type="button" onClick={() => setHelp(true)} className="vie-btn vie-btn-sm">{d.needHelp}</button>
      </div>
      <div role="tablist" aria-label={d.source} className="flex gap-1 px-3 py-2">
        {SOURCE_MODES.map(({ mode: m }) => {
          const on = mode === m;
          return (
            <button key={m} type="button" role="tab" aria-selected={on} onClick={() => setMode(m)}
              className={`rounded-ctl px-3 py-1.5 text-sm font-normal ${on ? "bg-primary text-white" : "text-ink2 hover:bg-raised hover:text-ink"}`}>
              {LABEL[m]}
            </button>
          );
        })}
      </div>

      <Dialog.Root open={help} onOpenChange={setHelp}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-normal">{d.bringingFootageIn}</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">{d.whatEachSourceDoes}</Dialog.Description>
            <ul className="mb-3 space-y-2">
              {SOURCE_MODES.map((m) => <li key={m.mode}><span className="font-normal">{LABEL[m.mode]}:</span> <span className="text-muted">{NOTE[m.mode]}</span></li>)}
            </ul>
            <p className="mb-1 font-normal">{d.linksCanBeImported}</p>
            <ul className="space-y-1 text-xs" aria-label={d.linkSupportHelp}>
              {IMPORT_PROVIDERS.map((p) => (
                <li key={p.id}><span className="font-normal">{p.name}</span>: <span className="text-muted">{p.status === "supported" ? d.providerWorks : p.status === "needs_authorization" ? d.providerNeedsToken : d.providerNotPossible.replace("{alternative}", p.alternative ?? "")}</span></li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{d.everyFileChecksummed}</p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
