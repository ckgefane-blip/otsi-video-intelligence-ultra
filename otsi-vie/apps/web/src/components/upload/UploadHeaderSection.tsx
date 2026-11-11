"use client";
/**
 * Page 02 Section 01 — upload page header and source-mode tabs (approved reference 02_UPLOAD_INGEST, "centre": title, help, tabs).
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
import { B, Ic, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { useLocale } from "@/lib/i18n";
import { IN } from "./page02";

/** tab x origin, width, icon x, icon key, label x */
const TAB: Record<SourceMode, [number, number, number, string, number]> = {
  file: [438, 485, 619, "cloud", 658], url: [923, 484, 1078, "yt", 1119], batch: [1407, 484, 1573, "layers", 1610],
};

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
    <section aria-label={d.uploadHeaderAria} data-section="p02-s01" data-mode={mode}>
      <B x={442} y={128} w={50} h={50} style={{ border: `${u(2)} solid #33a8ff`, borderRadius: u(10) }} />
      <Ic x={468} y={153} k="hl" size={30} color="#33a8ff" />
      <T x={513} y={150} size={46} weight={700} as="h1">{d.uploadIngest}</T>
      <T x={513} y={198} size={24} color="#cfe0f5">{d.uploadSubtitle}</T>
      <button type="button" onClick={() => setHelp(true)} className={`${s.a} ${s.framed}`}
        style={{ left: u(1691), top: u(135 - 101), width: u(200), height: u(65), padding: 0, border: 0, color: "inherit", font: "inherit", cursor: "pointer", ...IN }}>
        <Ic o={[1691, 135]} x={1730} y={168} k="help" size={34} color="#cfe0f5" />
        <T o={[1691, 135]} x={1760} y={168} size={22} color="#e3eefb" as="span">{d.needHelp}</T>
      </button>

      <B x={438} y={238} w={1453} h={73} style={{ background: "#06142a", border: `${u(1.5)} solid #12335f`, borderRadius: u(10) }} />
      <B x={TAB[mode][0]} y={238} w={TAB[mode][1]} h={73} style={{ background: "linear-gradient(#0a2b55,#083a70)", borderBottom: `${u(4)} solid #1e90ff`,
        borderRadius: mode === "file" ? `${u(10)} 0 0 0` : mode === "batch" ? `0 ${u(10)} 0 0` : 0 }} />
      <B x={1409} y={255} w={1.5} h={40} style={{ background: "#12335f" }} />
      <div role="tablist" aria-label={d.source}>
        {SOURCE_MODES.map(({ mode: m }) => {
          const [x, w, ix, icon, tx] = TAB[m], on = mode === m;
          return (
            <button key={m} type="button" role="tab" aria-selected={on} onClick={() => setMode(m)} className="absolute"
              style={{ left: u(x), top: u(238 - 101), width: u(w), height: u(73), padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" }}>
              <Ic o={[x, 238]} x={ix} y={m === "file" ? 274 : 275} k={icon} size={m === "file" ? 44 : 40} color={on ? "#33a8ff" : m === "batch" ? "#cfe0f5" : "#33a8ff"}
                {...(m === "file" && on ? { fill: "#33a8ff" } : {})} />
              <T o={[x, 238]} x={tx} y={275} size={on ? 27 : 26} weight={on ? 600 : 400} color={on ? "#33a8ff" : "#e3eefb"} as="span">{LABEL[m]}</T>
            </button>
          );
        })}
      </div>

      <Dialog.Root open={help} onOpenChange={setHelp}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-semibold">{d.bringingFootageIn}</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">{d.whatEachSourceDoes}</Dialog.Description>
            <ul className="mb-3 space-y-2">
              {SOURCE_MODES.map((m) => <li key={m.mode}><span className="font-semibold">{LABEL[m.mode]}:</span> <span className="text-muted">{NOTE[m.mode]}</span></li>)}
            </ul>
            <p className="mb-1 font-semibold">{d.linksCanBeImported}</p>
            <ul className="space-y-1 text-xs" aria-label={d.linkSupportHelp}>
              {IMPORT_PROVIDERS.map((p) => (
                <li key={p.id}><span className="font-medium">{p.name}</span>: <span className="text-muted">{p.status === "supported" ? d.providerWorks : p.status === "needs_authorization" ? d.providerNeedsToken : d.providerNotPossible.replace("{alternative}", p.alternative ?? "")}</span></li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{d.everyFileChecksummed}</p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
