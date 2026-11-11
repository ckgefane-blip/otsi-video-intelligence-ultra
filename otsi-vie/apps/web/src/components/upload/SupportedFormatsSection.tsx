"use client";
/**
 * Page 02 Section 07 — supported formats strip (approved reference 02_UPLOAD_INGEST, "formats"). The eight tiles are containers the
 * server accepts (each is in its accepted list); "View all formats" lists every accepted extension and the server's real size limit
 * (GET /v1/upload-limits). A tile opens the file chooser, like Browse Files.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { Ic, P, T, u } from "@/components/stage/DesignStage";
import { useLocale } from "@/lib/i18n";
import { usePage02 } from "./page02";

const TILES: [string, string, number, number][] = [["MP4", "H.264/H.265", 463, 164], ["MOV", "Apple ProRes", 643, 173], ["AVI", "H.264", 832, 146], ["MKV", "H.264/H.265", 994, 171],
  ["MPEG", "MPEG-2", 1181, 165], ["FLV", "H.264", 1362, 158], ["TS", "MPEG-TS", 1536, 163], ["WEBM", "VP9", 1715, 155]];

export function SupportedFormatsSection() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { limits } = usePage02();
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={d.supportedFormatsStrip} data-section="p02-s07">
      <P x={438} y={886} w={1455} h={162} />
      <T x={459} y={913} size={24} weight={600} as="h2">{d.supportedFormats}</T>
      <button type="button" onClick={() => setOpen(true)} className="absolute"
        style={{ left: u(1869 - 170), top: u(913 - 101 - 13), width: u(170), height: u(26), padding: 0, border: 0, background: "transparent", color: "#33a8ff",
          fontSize: u(20), fontFamily: "inherit", cursor: "pointer", textAlign: "right", whiteSpace: "nowrap" }}>{d.viewAllFormats}</button>
      <ul aria-label={d.supportedFormats} style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {TILES.map(([name, codec, x, w]) => (
          <li key={name}>
            {/* informational, as in the approved reference: the cards state what is accepted; only "View all formats" is interactive */}
            <div className="absolute"
              style={{ left: u(x), top: u(940 - 101), width: u(w), height: u(90), padding: 0, background: "#06142a", border: `${u(1.5)} solid #12335f`, borderRadius: u(8),
                color: "inherit", font: "inherit" }}>
              <Ic o={[x + 1.5, 941.5]} x={x + 36} y={972} k="file" size={40} color="#1e90ff" fill="#1e90ff" />
              <T o={[x + 1.5, 941.5]} x={x + 72} y={970} size={20} weight={600} as="span">{name}</T>
              <T o={[x + 1.5, 941.5]} x={x + 72} y={1000} size={17} color="#8ea3bf" as="span">{codec}</T>
            </div>
          </li>
        ))}
      </ul>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(460px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-semibold">{d.acceptedVideoFiles}</Dialog.Title>
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
