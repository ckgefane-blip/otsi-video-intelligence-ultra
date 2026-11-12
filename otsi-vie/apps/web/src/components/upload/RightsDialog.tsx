"use client";
/**
 * v3 Phase A.11 (ADR-077): Upload's rights block, four plain questions and a confirmation.
 *   - For the next uploads and link imports on this page (kept in page state only, never in the browser's storage): the answers go with
 *     each one and the server records them as the video's rights grant. With Send to Analysis on, they are needed before the upload starts.
 *   - For a video that has no rights recorded yet (DeclareRightsDialog): the same questions, saved on that video
 *     (POST /v1/videos/:id/rights/declaration). A recorded grant is changed by an Owner or Admin in Export › Sharing & rights.
 * A video is analysed only when its rights allow it (the server checks at every start).
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { GuardianConsent, UploadRights, VideoRights } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { usePage02 } from "./page02";
import { useUpload } from "./UploadWorkspace";

/** The dictionary subsection these words come from (ADR-139 Group A). */
export type UploadDict = Dictionary["body"]["upload"];

interface Draft { analyse: boolean | null; share: boolean | null; download: boolean | null; guardian_consent: GuardianConsent | null; confirm: boolean }
const EMPTY: Draft = { analyse: null, share: null, download: null, guardian_consent: null, confirm: false };
const draftOf = (r: UploadRights | null): Draft => (r ? { ...r } : EMPTY);

/** the answers, complete (null while something is unanswered) */
export function rightsOf(d: Draft): UploadRights | null {
  if (d.analyse === null || d.share === null || d.guardian_consent === null || !d.confirm) return null;
  const download = d.share ? d.download : false;
  if (download === null) return null;
  return { analyse: d.analyse, share: d.share, download, guardian_consent: d.guardian_consent, confirm: true };
}

/** "analyse · internal only", "analyse · share + download · consent pending" — for a dictionary, in its words. */
export function rightsSummary(r: UploadRights, d?: UploadDict): string {
  const parts = [r.analyse ? (d?.sumAnalyse ?? "analyse") : (d?.sumNoAnalysis ?? "no analysis"),
    r.share ? (r.download ? (d?.sumShareDownload ?? "share + download") : (d?.sumShare ?? "share")) : (d?.sumInternal ?? "internal only")];
  if (r.guardian_consent === "PENDING") parts.push(d?.sumConsentPending ?? "consent pending");
  return parts.join(" · ");
}

/** the four questions for a dictionary (ADR-139 Group A); without one they stay English. */
const questions = (d?: UploadDict): { key: "analyse" | "share" | "download"; q: string; hint: string }[] => [
  { key: "analyse", q: d?.qAnalyse ?? "May the engine analyse this video?", hint: d?.qAnalyseHint ?? "Detects and tracks players and the ball, reads shirt numbers and suggests identities for your review." },
  { key: "share", q: d?.qShare ?? "May reels and reports made from it be shared outside your organization?", hint: d?.qShareHint ?? "Private links from Export. With No, everything stays inside your organization." },
  { key: "download", q: d?.qDownload ?? "May people with a link download the file?", hint: d?.qDownloadHint ?? "Only with sharing. With No, a link plays the video but offers no download." },
];
const minors = (d?: UploadDict): [GuardianConsent, string][] => [
  ["NOT_APPLICABLE", d?.minorsNone ?? "No minors in it"],
  ["VERIFIED", d?.minorsVerified ?? "Minors, guardian consent on file"],
  ["PENDING", d?.minorsPending ?? "Minors, consent asked for but not given yet"],
];

function Choice({ label, on, disabled, onClick, data }: { label: string; on: boolean; disabled?: boolean; onClick(): void; data: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onClick} data-choice={data}
      className={`rounded-ctl border px-3 py-1 text-sm ${on ? "border-primary bg-primary/20 font-normal" : "border-line hover:border-primary/60"} disabled:opacity-40`}>{label}</button>
  );
}

function RightsForm({ initial, analysisAsked, submitLabel, busy, onSubmit, onCancel }: {
  initial: UploadRights | null; analysisAsked: boolean; submitLabel: string; busy?: boolean; onSubmit(r: UploadRights): void; onCancel(): void;
}) {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const [draft, setD] = useState<Draft>(draftOf(initial));
  const done = rightsOf(draft);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p, ...(p.share === false ? { download: false } : {}) }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (done) onSubmit(done); }} className="space-y-3">
      {questions(d).map(({ key, q, hint }) => {
        const off = key === "download" && draft.share !== true;
        return (
          <fieldset key={key} data-question={key} className={off ? "opacity-60" : ""}>
            <legend className="font-normal">{q}</legend>
            <p className="mb-1 text-xs text-muted">{hint}</p>
            <div role="radiogroup" aria-label={q} className="flex gap-2">
              <Choice label={d.yes} data="yes" on={draft[key] === true} disabled={off} onClick={() => set({ [key]: true })} />
              <Choice label={d.no} data="no" on={draft[key] === false} disabled={off} onClick={() => set({ [key]: false })} />
            </div>
          </fieldset>
        );
      })}
      <fieldset data-question="guardian_consent">
        <legend className="font-normal">{d.qMinors}</legend>
        <div role="radiogroup" aria-label={d.qMinors} className="mt-1 flex flex-wrap gap-2">
          {minors(d).map(([k, label]) => <Choice key={k} label={label} data={k} on={draft.guardian_consent === k} onClick={() => set({ guardian_consent: k })} />)}
        </div>
        {draft.guardian_consent === "PENDING" && <p className="mt-1 text-xs text-amber">{d.minorsPendingNote}</p>}
      </fieldset>
      {analysisAsked && draft.analyse === false && <p className="text-xs text-amber">{d.analysisOnNoNote}</p>}
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={draft.confirm} onChange={(e) => set({ confirm: e.target.checked })} aria-label={d.confirmShort} className="mt-1" />
        <span>{d.confirmRights}</span>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</button>
        <button type="submit" disabled={!done || busy} className="rounded-ctl bg-primary px-3 py-1.5 font-normal text-white disabled:opacity-50">{busy ? d.saving : submitLabel}</button>
      </div>
    </form>
  );
}

function Shell({ open, onOpenChange, title, children }: { open: boolean; onOpenChange(o: boolean): void; title: string; children: React.ReactNode }) {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl"
          data-dialog="rights">
          <Dialog.Title className="text-base font-normal">{title}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">{d.rightsRecordedDesc}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** the page's answers for the next uploads and imports */
export function UploadRightsDialog() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { rights, setRights, rightsDialog, setRightsDialog } = useUpload();
  const { prefs, say } = usePage02();
  return (
    <Shell open={rightsDialog} onOpenChange={setRightsDialog} title={d.rightsForUploads}>
      <RightsForm key={String(rightsDialog)} initial={rights} analysisAsked={prefs.sendToAnalysis} submitLabel={d.useForUploads}
        onCancel={() => setRightsDialog(false)}
        onSubmit={(r) => { setRights(r); setRightsDialog(false); say(d.rightsNextUploads.replace("{summary}", rightsSummary(r, d))); }} />
    </Shell>
  );
}

/** a video without recorded rights: declare them now */
export function DeclareRightsDialog({ videoId, name, open, onOpenChange, onDone }: { videoId: string; name: string; open: boolean; onOpenChange(o: boolean): void; onDone(r: VideoRights): void }) {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) setErr(null); }, [open]);
  const save = async (r: UploadRights) => {
    setBusy(true); setErr(null);
    try { onDone(await api<VideoRights>(`/v1/videos/${videoId}/rights/declaration`, { method: "POST", json: r })); onOpenChange(false); }
    catch (x) { setErr(x instanceof ApiProblem ? x.message : d.couldNotSaveRights); }
    finally { setBusy(false); }
  };
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={d.rightsForVideo.replace("{name}", name)}>
      <RightsForm key={String(open)} initial={null} analysisAsked={false} submitLabel={d.recordRights} busy={busy} onCancel={() => onOpenChange(false)} onSubmit={(r) => void save(r)} />
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
    </Shell>
  );
}
