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
import { usePage02 } from "./page02";
import { useUpload } from "./UploadWorkspace";

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

/** "analyse · internal only", "analyse · share + download · consent pending" */
export function rightsSummary(r: UploadRights): string {
  const parts = [r.analyse ? "analyse" : "no analysis", r.share ? (r.download ? "share + download" : "share") : "internal only"];
  if (r.guardian_consent === "PENDING") parts.push("consent pending");
  return parts.join(" · ");
}

const QUESTIONS: { key: "analyse" | "share" | "download"; q: string; hint: string }[] = [
  { key: "analyse", q: "May the engine analyse this video?", hint: "Detects and tracks players and the ball, reads shirt numbers and suggests identities for your review." },
  { key: "share", q: "May reels and reports made from it be shared outside your organization?", hint: "Private links from Export. With No, everything stays inside your organization." },
  { key: "download", q: "May people with a link download the file?", hint: "Only with sharing. With No, a link plays the video but offers no download." },
];
const MINORS: [GuardianConsent, string][] = [
  ["NOT_APPLICABLE", "No minors in it"],
  ["VERIFIED", "Minors, guardian consent on file"],
  ["PENDING", "Minors, consent asked for but not given yet"],
];

function Choice({ label, on, disabled, onClick, data }: { label: string; on: boolean; disabled?: boolean; onClick(): void; data: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onClick} data-choice={data}
      className={`rounded-ctl border px-3 py-1 text-sm ${on ? "border-primary bg-primary/20 font-semibold" : "border-line hover:border-primary/60"} disabled:opacity-40`}>{label}</button>
  );
}

function RightsForm({ initial, analysisAsked, submitLabel, busy, onSubmit, onCancel }: {
  initial: UploadRights | null; analysisAsked: boolean; submitLabel: string; busy?: boolean; onSubmit(r: UploadRights): void; onCancel(): void;
}) {
  const [d, setD] = useState<Draft>(draftOf(initial));
  const done = rightsOf(d);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p, ...(p.share === false ? { download: false } : {}) }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (done) onSubmit(done); }} className="space-y-3">
      {QUESTIONS.map(({ key, q, hint }) => {
        const off = key === "download" && d.share !== true;
        return (
          <fieldset key={key} data-question={key} className={off ? "opacity-60" : ""}>
            <legend className="font-medium">{q}</legend>
            <p className="mb-1 text-xs text-muted">{hint}</p>
            <div role="radiogroup" aria-label={q} className="flex gap-2">
              <Choice label="Yes" data="yes" on={d[key] === true} disabled={off} onClick={() => set({ [key]: true })} />
              <Choice label="No" data="no" on={d[key] === false} disabled={off} onClick={() => set({ [key]: false })} />
            </div>
          </fieldset>
        );
      })}
      <fieldset data-question="guardian_consent">
        <legend className="font-medium">Are minors (under 18) in this video?</legend>
        <div role="radiogroup" aria-label="Are minors (under 18) in this video?" className="mt-1 flex flex-wrap gap-2">
          {MINORS.map(([k, label]) => <Choice key={k} label={label} data={k} on={d.guardian_consent === k} onClick={() => set({ guardian_consent: k })} />)}
        </div>
        {d.guardian_consent === "PENDING" && <p className="mt-1 text-xs text-amber">It is not analysed until an Owner or Admin records the consent (Export › Sharing &amp; rights).</p>}
      </fieldset>
      {analysisAsked && d.analyse === false && <p className="text-xs text-amber">Send to Analysis is on, but with No the video is uploaded and not analysed.</p>}
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={d.confirm} onChange={(e) => set({ confirm: e.target.checked })} aria-label="I confirm" className="mt-1" />
        <span>I confirm that I am entitled to declare these rights for this video. They are recorded with my name.</span>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-ctl border border-line px-3 py-1.5">Cancel</button>
        <button type="submit" disabled={!done || busy} className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}

function Shell({ open, onOpenChange, title, children }: { open: boolean; onOpenChange(o: boolean): void; title: string; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl"
          data-dialog="rights">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">Recorded as the video&apos;s rights. A video is analysed only when its rights allow it; sharing and downloads follow these answers.</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** the page's answers for the next uploads and imports */
export function UploadRightsDialog() {
  const { rights, setRights, rightsDialog, setRightsDialog } = useUpload();
  const { prefs, say } = usePage02();
  return (
    <Shell open={rightsDialog} onOpenChange={setRightsDialog} title="Rights for your uploads">
      <RightsForm key={String(rightsDialog)} initial={rights} analysisAsked={prefs.sendToAnalysis} submitLabel="Use for my uploads"
        onCancel={() => setRightsDialog(false)}
        onSubmit={(r) => { setRights(r); setRightsDialog(false); say(`Rights for the next uploads: ${rightsSummary(r)}`); }} />
    </Shell>
  );
}

/** a video without recorded rights: declare them now */
export function DeclareRightsDialog({ videoId, name, open, onOpenChange, onDone }: { videoId: string; name: string; open: boolean; onOpenChange(o: boolean): void; onDone(r: VideoRights): void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) setErr(null); }, [open]);
  const save = async (r: UploadRights) => {
    setBusy(true); setErr(null);
    try { onDone(await api<VideoRights>(`/v1/videos/${videoId}/rights/declaration`, { method: "POST", json: r })); onOpenChange(false); }
    catch (x) { setErr(x instanceof ApiProblem ? x.message : "The rights could not be saved."); }
    finally { setBusy(false); }
  };
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={`Rights for ${name}`}>
      <RightsForm key={String(open)} initial={null} analysisAsked={false} submitLabel="Record rights" busy={busy} onCancel={() => onOpenChange(false)} onSubmit={(r) => void save(r)} />
      {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
    </Shell>
  );
}
