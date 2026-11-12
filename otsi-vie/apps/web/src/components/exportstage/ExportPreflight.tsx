"use client";
/**
 * v3 Phase B.22 (ADR-097): Export's preflight, before anything renders. It lists the files the chosen preset makes (each with its frame
 * and loudness; one already rendering is skipped), the format and quality, and the checks from GET /v1/reels/:id/preflight: what blocks
 * the export (no clips, a changed identity, rights not in force) and what will look different from what a person may expect (no shirt
 * number on the strap, no match card, no clock, music licence). Nothing starts until "Start"; then one batch request makes every file.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { outputLabel, outputLufs, shareCheck, uniqueOutputs, type ExportPreset, type Preflight, type Reel, type VideoRights } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { DeclareRightsDialog } from "@/components/upload/RightsDialog";
import { api } from "@/lib/api";

const MARK = { OK: ["✓", "#3ee6a8"], WARN: ["!", "#f5b82e"], BLOCK: ["✕", "#ff6b6b"] } as const;

export function ExportPreflight({ reel, preset, codec, bitrate, upToDate, canWrite, open, onOpenChange, onStart }: {
  reel: Reel; preset: ExportPreset; codec: string; bitrate: number; upToDate: boolean; canWrite: boolean; open: boolean; onOpenChange(o: boolean): void; onStart(): void;
}) {
  const [pf, setPf] = useState<Preflight | null>(null);
  const [failed, setFailed] = useState(false);
  // B.23 (ADR-098): the source video's rights, and recording them right here when none are (A.11's four questions, saved on the video)
  const [rights, setRights] = useState<VideoRights | null | undefined>(undefined);
  const [declare, setDeclare] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPf(null); setFailed(false); setRights(undefined);
    api<Preflight>(`/v1/reels/${reel.id}/preflight`).then((x) => live && setPf(x), () => live && setFailed(true));
    // ADR-131: a cross-match reel has no single video, so there is no one video's rights to check here — the share row stays
    // hidden (rights stay undefined) rather than inventing a video.
    if (reel.video_id) api<VideoRights>(`/v1/videos/${reel.video_id}/rights`).then((x) => live && setRights(x), () => live && setRights(null));
    return () => { live = false; };
  }, [open, reel.id, reel.version, reel.video_id]);
  const share = rights === undefined ? null : shareCheck(rights);
  const outs = uniqueOutputs(preset.spec.outputs, reel.aspect);
  const running = (o: { profile: string; aspect: string }) => !!pf?.open.some((x) => x.profile === o.profile && x.aspect === o.aspect);
  const toStart = outs.filter((o) => !running(o)).length;
  const blocked = !!pf?.checks.some((c) => c.level === "BLOCK");
  const fmt = codec === "h264" ? "MP4 (H.264)" : codec === "av1" ? "MP4 (AV1)" : "WebM (VP9)";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="export-preflight" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(600px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-normal">Export {outs.length} file{outs.length === 1 ? "" : "s"}?</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{preset.name}. Check before rendering; each file renders in turn.</Dialog.Description>
          <ul className="mb-3 space-y-1" data-preflight-outputs>
            {outs.map((o) => (
              <li key={`${o.profile}-${o.aspect}`} data-output={`${o.profile}-${o.aspect}`} data-running={running(o) ? "1" : "0"} className="flex justify-between gap-3">
                <span>{outputLabel(o, reel.aspect)}</span>
                <span className="text-muted">{running(o) ? "already rendering: skipped" : `${fmt} · ${bitrate} Mbps · ${outputLufs(o, preset.spec.loudness_lufs, reel.settings.loudness_lufs)} LUFS`}</span>
              </li>
            ))}
          </ul>
          {upToDate && <p className="mb-2 text-xs text-[#f5b82e]" data-up-to-date>The last file already matches this edit: rendering again makes the same picture.</p>}
          {failed ? <p className="mb-3 text-xs text-[#ff6b6b]">The checks could not be read.</p> : !pf ? <p className="mb-3 text-xs text-muted">Checking…</p> : (
            <ul className="mb-3 space-y-1.5" data-preflight-checks>
              {pf.checks.map((c) => (
                <li key={c.key} data-check={c.key} data-level={c.level} className="flex gap-2">
                  <span aria-label={c.level === "OK" ? "Fine" : c.level === "WARN" ? "Worth knowing" : "Blocks the export"} style={{ color: MARK[c.level][1], width: 14, flex: "none", fontWeight: 700 }}>{MARK[c.level][0]}</span>
                  <span>{c.text}</span>
                </li>
              ))}
              {share && (
                <li key="share" data-check="share" data-level={share.level} className="flex gap-2">
                  <span aria-label={share.level === "OK" ? "Fine" : "Worth knowing"} style={{ color: MARK[share.level][1], width: 14, flex: "none", fontWeight: 700 }}>{MARK[share.level][0]}</span>
                  <span>{share.text}
                    {!rights?.grant && canWrite && <button type="button" data-record-rights onClick={() => setDeclare(true)} className="ml-2 text-[#33a8ff] underline">Record the rights</button>}
                    {!!rights?.grant && share.level !== "OK" && <span className="ml-1 text-muted">An Owner or Admin changes them in Sharing &amp; rights.</span>}
                  </span>
                </li>
              )}
            </ul>
          )}
          {reel.video_id && <DeclareRightsDialog videoId={reel.video_id} name="this reel's video" open={declare} onOpenChange={setDeclare} onDone={(r) => setRights(r)} />}
          <div className="flex justify-end gap-2">
            <Dialog.Close className="rounded border border-line px-3 py-1.5">Cancel</Dialog.Close>
            <button type="button" data-start-export disabled={!pf || blocked || toStart === 0} onClick={onStart}
              className="rounded bg-primary px-3 py-1.5 font-normal text-white disabled:opacity-40">
              {blocked ? "Fix the blocked items first" : toStart === 0 ? "Every file is rendering" : `Start ${toStart} file${toStart === 1 ? "" : "s"}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
