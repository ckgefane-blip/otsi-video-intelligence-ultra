"use client";
/**
 * Page 08 dialogs (ADR-056): Notes & Tags (rail), Add to Scouting Dossier, Export PDF and Share Link (hero), and the scouting assessment
 * (hero Edit, Scouting Report "View Full Report"). Each reads and writes through the API; nothing is kept only in the page.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { DEFAULT_REPORT_DESIGN, REPORT_SECTIONS, TOKEN_COSTS, type AssessmentBody, type CreatedReportShareLink, type Dossier, type PlayerAssessment, type PlayerIdentity, type PlayerNotes, type PlayerReportJob,
  type ReportDesign, type ReportGate, type ReportShareLink } from "@otsi-vie/contracts";
import { ReportDesigner } from "./ReportDesigner";
import { CostPreviewDialog } from "@/components/wallet/CostPreview";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

export type DialogName = "notes" | "dossier" | "pdf" | "share" | "assess" | "read" | null;
const why = (x: unknown, fallback: string) => (x instanceof ApiProblem ? x.message : fallback);
const btn = "rounded-ctl bg-primary px-3 py-1.5 font-normal text-white disabled:opacity-50";
const ghost = "rounded-ctl border border-line px-3 py-1.5 disabled:opacity-50";
const field = "w-full rounded-ctl border border-line bg-canvas px-2 py-1.5";
const when = (s: string) => new Date(s).toLocaleString();

function Shell({ open, onClose, title, desc, name, children, wide }: { open: boolean; onClose: () => void; title: string; desc: string; name: string; children: ReactNode; wide?: boolean }) {
  const { t: dict } = useLocale();
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content data-dialog={name} className={`fixed left-1/2 top-1/2 z-50 max-h-[88vh] ${wide ? "w-[min(760px,96vw)]" : "w-[min(560px,94vw)]"} -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 t-body shadow-2xl`}>
          <Dialog.Title className="t-section">{title}</Dialog.Title>
          <Dialog.Description className="mb-3 t-small">{desc}</Dialog.Description>
          {children}
          <div className="mt-4 flex justify-end"><Dialog.Close className={ghost}>{dict.common.close}</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ------------------------------------------------------------------ notes and tags
export function NotesDialog({ player, open, onClose }: { player: PlayerIdentity; open: boolean; onClose: () => void }) {
  const { t: dict } = useLocale();
  const [d, setD] = useState<PlayerNotes | null | undefined>(undefined);
  const [text, setText] = useState(""), [tag, setTag] = useState(""), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const base = `/v1/players/${player.player_id}`;
  useEffect(() => { if (open) void api<PlayerNotes>(`${base}/notes`).then(setD, () => setD(null)); }, [open, base]);
  const run = async (f: () => Promise<PlayerNotes>, fail: string) => {
    setBusy(true); setErr(null);
    try { setD(await f()); return true; } catch (x) { setErr(why(x, fail)); return false; } finally { setBusy(false); }
  };
  const tags = (t: string[]) => run(() => api<PlayerNotes>(`${base}/tags`, { method: "PUT", json: { tags: t } }), dict.body.reports.tagsSaveFailed);
  return (
    <Shell open={open} onClose={onClose} name="notes" title={dict.body.reports.notesTitle.replace("{a}", player.display_name)} desc={dict.body.reports.notesDesc}>
      {d === undefined ? <p className="text-muted">{dict.common.loading}</p> : d === null ? <p role="alert" className="text-danger">{dict.body.reports.notesLoadFailed}</p> : (
        <div className="grid gap-4">
          <section aria-label={dict.body.reports.notesTags} className="grid gap-2">
            <h3 className="font-normal">{dict.body.reports.notesTags}</h3>
            <div className="flex flex-wrap gap-2" data-tags={String(d.tags.length)}>
              {!d.tags.length && <span className="t-small">{dict.body.reports.notesNoTags}</span>}
              {d.tags.map((t) => (
                <span key={t} className="flex items-center gap-1 rounded-full border border-primary/50 px-2 py-0.5 text-xs">{t}
                  {d.can_write && <button type="button" aria-label={dict.body.reports.removeTagAria.replace("{a}", t)} disabled={busy} onClick={() => void tags(d.tags.filter((x) => x !== t))} className="text-muted hover:text-danger">✕</button>}
                </span>
              ))}
            </div>
            {d.can_write && (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = tag.trim(); if (t) void tags([...d.tags, t]).then((ok) => { if (ok) setTag(""); }); }}>
                <input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={40} placeholder={dict.body.reports.tagPlaceholder} aria-label={dict.body.reports.newTagAria} className={field} />
                <button type="submit" disabled={busy || !tag.trim() || d.tags.length >= 20} className={ghost}>{dict.body.matches.addBtn}</button>
              </form>
            )}
          </section>
          <section aria-label={dict.body.reports.notesHeading} className="grid gap-2">
            <h3 className="font-normal">{dict.body.reports.notesHeading}</h3>
            {d.can_write && (
              <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void run(() => api<PlayerNotes>(`${base}/notes`, { method: "POST", json: { body: text.trim() } }), dict.body.reports.noteSaveFailed).then((ok) => { if (ok) setText(""); }); }}>
                <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3} placeholder={dict.body.reports.notePlaceholder} aria-label={dict.body.reports.newNoteAria} className={field} />
                <button type="submit" data-add-note disabled={busy || !text.trim()} className={`${btn} justify-self-start`}>{busy ? dict.body.players.saving : dict.body.reports.addNote}</button>
              </form>
            )}
            {!d.notes.length ? <p className="t-small">{dict.body.reports.notesNone}</p> : (
              <ul className="grid gap-2" data-notes={String(d.notes.length)}>
                {d.notes.map((n) => (
                  <li key={n.id} className="rounded-ctl border border-line/70 p-2">
                    <div className="flex items-center gap-2 t-small"><span className="font-normal text-ink">{n.author_name}</span><span>{when(n.created_at)}</span>
                      {n.can_delete && <button type="button" disabled={busy} onClick={() => void run(() => api<PlayerNotes>(`${base}/notes/${n.id}`, { method: "DELETE" }), dict.body.reports.noteDeleteFailed)} className="ml-auto hover:text-danger">{dict.body.reports.deleteBtn}</button>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {!d.can_write && <p className="t-small">{dict.body.reports.notesReadOnly}</p>}
          {err && <p role="alert" className="text-danger">{err}</p>}
        </div>
      )}
    </Shell>
  );
}

// ------------------------------------------------------------------ scouting dossiers
export function DossierDialog({ player, open, onClose, canWrite }: { player: PlayerIdentity; open: boolean; onClose: () => void; canWrite: boolean }) {
  const { t: dict } = useLocale();
  const [list, setList] = useState<Dossier[] | null | undefined>(undefined);
  const [name, setName] = useState(""), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [sure, setSure] = useState<string | null>(null);
  const load = useCallback(() => api<Dossier[]>("/v1/dossiers").then(setList, () => setList(null)), []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const run = async (f: () => Promise<unknown>, fail: string) => {
    setBusy(true); setErr(null);
    try { await f(); await load(); return true; } catch (x) { setErr(why(x, fail)); return false; } finally { setBusy(false); }
  };
  return (
    <Shell open={open} onClose={onClose} name="dossier" title={dict.body.reports.dossiersTitle} desc={dict.body.reports.dossiersDesc.replace("{a}", player.display_name)}>
      {list === undefined ? <p className="text-muted">{dict.common.loading}</p> : list === null ? <p role="alert" className="text-danger">{dict.body.reports.dossiersLoadFailed}</p> : (
        <div className="grid gap-3">
          {canWrite && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (n) void run(async () => { const d = await api<Dossier>("/v1/dossiers", { method: "POST", json: { name: n } }); await api(`/v1/dossiers/${d.id}/players/${player.player_id}`, { method: "PUT" }); }, dict.body.reports.dossierCreateFailed).then((ok) => { if (ok) setName(""); }); }}>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={dict.body.reports.dossierPlaceholder} aria-label={dict.body.reports.dossierNameAria} className={field} />
              <button type="submit" data-new-dossier disabled={busy || !name.trim()} className={btn}>{dict.body.reports.dossierCreateAdd}</button>
            </form>
          )}
          {!list.length ? <p className="t-small">{dict.body.reports.dossiersNone}</p> : (
            <ul className="grid gap-2" data-dossiers={String(list.length)}>
              {list.map((d) => {
                const inIt = d.players.some((x) => x.player_id === player.player_id);
                return (
                  <li key={d.id} className="rounded-ctl border border-line/70 p-2" data-dossier={d.id}>
                    <div className="flex items-center gap-2">
                      <label className="flex min-w-0 flex-1 items-center gap-2 font-normal">
                        <input type="checkbox" checked={inIt} disabled={!canWrite || busy} aria-label={dict.body.reports.playerInDossier.replace("{a}", player.display_name).replace("{b}", d.name)}
                          onChange={(e) => void run(() => api(`/v1/dossiers/${d.id}/players/${player.player_id}`, { method: e.target.checked ? "PUT" : "DELETE" }), dict.body.reports.dossierChangeFailed)} />
                        <span className="truncate">{d.name}</span><span className="t-small">{d.players.length === 1 ? dict.body.reports.dossierPlayersOne : dict.body.reports.dossierPlayersMany.replace("{a}", String(d.players.length))}</span>
                      </label>
                      {canWrite && (sure === d.id
                        ? <><button type="button" className="text-xs text-danger" onClick={() => void run(() => api(`/v1/dossiers/${d.id}`, { method: "DELETE" }), dict.body.reports.dossierDeleteFailed).then(() => setSure(null))}>{dict.body.reports.dossierDelete}</button><button type="button" className="text-xs" onClick={() => setSure(null)}>{dict.body.reports.keepBtn}</button></>
                        : <button type="button" aria-label={dict.body.reports.deleteDossierAria.replace("{a}", d.name)} className="t-small hover:text-danger" onClick={() => setSure(d.id)}>✕</button>)}
                    </div>
                    {d.players.length > 0 && (
                      <p className="mt-1 t-small">{d.players.map((x, i) => <span key={x.player_id}>{i ? ", " : ""}<Link href={`/reports/players/${x.canonical_otsi_id ?? x.player_id}`} className="text-primary hover:underline" onClick={onClose}>{x.display_name}</Link></span>)}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!canWrite && <p className="t-small">{dict.body.reports.dossiersReadOnly}</p>}
          {err && <p role="alert" className="text-danger">{err}</p>}
        </div>
      )}
    </Shell>
  );
}

// ------------------------------------------------------------------ PDF report and its share links
export function ReportDialog({ player, open, share, onClose, canMake, canShare }: { player: PlayerIdentity; open: boolean; share: boolean; onClose: () => void; canMake: boolean; canShare: boolean }) {
  const { t: dict } = useLocale();
  const [jobs, setJobs] = useState<PlayerReportJob[] | null | undefined>(undefined);
  const [links, setLinks] = useState<ReportShareLink[] | null>(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(7), [download, setDownload] = useState(false), [pw, setPw] = useState<string | null>(null), [made, setMade] = useState<string | null>(null), [copied, setCopied] = useState(false);
  // billing blueprint §4.2(2): a player report costs 10 tokens — the Make button asks first.
  const [preview, setPreview] = useState(false);
  // B.24 (ADR-099): the design of the next PDF, and whether a report may leave the page (a person confirmed a track as him)
  const [design, setDesign] = useState<ReportDesign>(DEFAULT_REPORT_DESIGN);
  const [gate, setGate] = useState<ReportGate | null>(null);
  const blocked = !!gate && !gate.ok;
  const base = `/v1/players/${player.player_id}/reports`;
  const latest = jobs?.find((j) => j.state === "SUCCEEDED") ?? null;
  const load = useCallback(() => api<PlayerReportJob[]>(base).then(setJobs, () => setJobs(null)), [base]);
  useEffect(() => { if (open) { setMade(null); setErr(null); void load(); } }, [open, load]);
  useEffect(() => { if (open && latest) void api<ReportShareLink[]>(`/v1/reports/${latest.id}/share-links`).then(setLinks, () => setLinks(null)); else setLinks(null); }, [open, latest?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const make = async () => {
    setBusy(true); setErr(null);
    try { await api<PlayerReportJob>(base, { method: "POST", json: { design } }); await load(); } catch (x) { setErr(why(x, dict.body.reports.pdfMakeFailed)); await load(); } finally { setBusy(false); }
  };
  const link = async () => {
    if (!latest) return;
    if (pw !== null && pw.length < 8) { setErr(dict.body.reports.passwordShort); return; }
    setBusy(true); setErr(null); setCopied(false);
    try {
      const l = await api<CreatedReportShareLink>(`/v1/reports/${latest.id}/share-links`, { method: "POST", json: { expires_in_days: days, can_download: download, password: pw } });
      setMade(`${window.location.origin}${l.url}`); setPw(null);
      setLinks(await api<ReportShareLink[]>(`/v1/reports/${latest.id}/share-links`));
    } catch (x) { setErr(why(x, dict.body.reports.shareLinkFailed)); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setErr(null);
    try { await api(`/v1/share-links/${id}`, { method: "DELETE" }); if (latest) setLinks(await api<ReportShareLink[]>(`/v1/reports/${latest.id}/share-links`)); } catch (x) { setErr(why(x, dict.body.reports.revokeFailed)); } finally { setBusy(false); }
  };
  return (
    <Shell open={open} onClose={onClose} name={share ? "share-report" : "export-pdf"} title={share ? dict.body.reports.shareReportTitle.replace("{a}", player.display_name) : dict.body.reports.exportPdfTitle.replace("{a}", player.display_name)}
      desc={dict.body.reports.pdfDesc}>
      {jobs === undefined ? <p className="text-muted">{dict.common.loading}</p> : jobs === null ? <p role="alert" className="text-danger">{dict.body.reports.reportsLoadFailed}</p> : (
        <div className="grid gap-4">
          {!share && canMake && <ReportDesigner playerId={player.player_id} design={design} onDesign={setDesign} onGate={setGate} />}
          <section aria-label={dict.body.reports.pdfReports} className="grid gap-2">
            <div className="flex items-center gap-2">
              <h3 className="font-normal">{dict.body.reports.pdfReports}</h3>
              {canMake && !share && <button type="button" data-make-pdf disabled={busy || blocked} title={blocked ? gate!.reasons.join(" ") : undefined} onClick={() => setPreview(true)} className={`${btn} ml-auto`}>{busy ? dict.body.reports.makingPdf : blocked ? dict.body.reports.identityNotConfirmed : latest ? dict.body.reports.makeNewPdf : dict.body.reports.makePdf}</button>}
            </div>
            <CostPreviewDialog
              action={dict.body.wallet.cpPlayerReport.replace("{a}", player.display_name)}
              cost={TOKEN_COSTS.playerReport} open={preview} onOpenChange={setPreview} onConfirm={() => void make()} />
            {!jobs.length ? <p className="t-small">{dict.body.reports.pdfNone}</p> : (
              <ul className="grid gap-1" data-reports={String(jobs.length)}>
                {jobs.slice(0, 6).map((j) => (
                  <li key={j.id} className="flex items-center gap-2 rounded-ctl border border-line/70 px-2 py-1.5 text-xs" data-report={j.state}>
                    <span>{when(j.created_at)}</span><span className="text-muted">{dict.body.reports.pdfBy.replace("{a}", j.requested_by_name)}</span>
                    {(j.title || j.sections < REPORT_SECTIONS.length) && <span className="truncate text-muted" data-report-design>{j.title ?? ""}{j.sections < REPORT_SECTIONS.length ? `${j.title ? " · " : ""}${dict.body.reports.pdfSections.replace("{a}", String(j.sections)).replace("{b}", String(REPORT_SECTIONS.length))}` : ""}</span>}
                    {j.state === "SUCCEEDED" && j.bytes !== null && <span className="text-muted">{Math.max(1, Math.round(j.bytes / 1024))} KB</span>}
                    {j.state === "FAILED" && <span className="text-danger">{j.failure ?? dict.body.reports.pdfFailedWord}</span>}
                    {j.download_url && <a href={j.download_url} className="ml-auto text-primary hover:underline" data-download-pdf>{dict.body.library.download}</a>}
                  </li>
                ))}
              </ul>
            )}
            {!canMake && <p className="t-small">{dict.body.reports.pdfReadOnly}</p>}
          </section>
          <section aria-label={dict.body.reports.shareLinkHeading} className="grid gap-2 border-t border-line pt-3">
            <h3 className="font-normal">{dict.body.reports.shareLinkHeading}</h3>
            <p className="t-small">{dict.body.reports.shareLinkDesc}</p>
            {!latest ? <p className="t-small">{dict.body.reports.shareNeedPdf}</p> : !canShare ? <p className="t-small">{dict.body.reports.shareReadOnly}</p> : (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1">{dict.body.reports.validFor}
                    <select aria-label={dict.body.reports.validForAria} value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-ctl border border-line bg-transparent px-1 py-0.5">{[1, 7, 14, 30].map((d) => <option key={d} value={d}>{d === 1 ? dict.body.reports.validDayOne : dict.body.reports.validDaysMany.replace("{a}", String(d))}</option>)}</select>
                  </label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} />{dict.body.reports.allowDownload}</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={pw !== null} onChange={(e) => setPw(e.target.checked ? "" : null)} />{dict.body.reports.passwordLabel}</label>
                  {pw !== null && <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} maxLength={128} placeholder={dict.body.reports.passwordPlaceholder} aria-label={dict.body.reports.linkPasswordAria} autoComplete="new-password" className="rounded-ctl border border-line bg-canvas px-2 py-0.5" />}
                </div>
                <button type="button" data-make-report-link disabled={busy} onClick={() => void link()} className={`${btn} justify-self-start`}>{busy ? dict.body.reports.checkingRights : dict.body.reports.createShareLink}</button>
                {made && (
                  <div className="flex items-center gap-2 rounded-ctl border border-primary/60 p-2 text-xs" data-made-link>
                    <span className="min-w-0 flex-1 truncate">{made}</span>
                    <button type="button" className={ghost} onClick={() => void navigator.clipboard.writeText(made).then(() => setCopied(true), () => setErr(dict.body.reports.copyFailedLong))}>{copied ? dict.body.reports.copiedShort : dict.body.reports.copyBtn}</button>
                  </div>
                )}
                {!!links?.length && (
                  <ul className="grid gap-1 text-xs" data-report-links={String(links.length)}>
                    {links.map((l) => (
                      <li key={l.id} className="flex items-center gap-2"><span>{when(l.created_at)}</span><span className="text-muted">{l.state.toLowerCase()} · {dict.body.reports.linkOpened.replace("{a}", String(l.opened))}{l.has_password ? dict.body.reports.linkHasPassword : ""}{l.can_download ? dict.body.reports.linkCanDownload : ""}</span>
                        {l.state === "ACTIVE" && <button type="button" disabled={busy} onClick={() => void revoke(l.id)} className="ml-auto text-muted hover:text-danger">{dict.body.reports.revokeBtn}</button>}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
          {err && <p role="alert" className="text-danger">{err}</p>}
        </div>
      )}
    </Shell>
  );
}

// ------------------------------------------------------------------ assessment
const EMPTY: AssessmentBody = { role: "", summary: "", traits: [], rating: null, criteria: [], notes: "" };

export function AssessmentView({ a }: { a: AssessmentBody }) {
  const { t: dict } = useLocale();
  return (
    <div className="grid gap-2">
      {a.role && <p><span className="text-muted">{dict.body.reports.assessRoleLabel}</span><span className="font-normal">{a.role}</span></p>}
      {a.summary && <p className="whitespace-pre-wrap">{a.summary}</p>}
      {!!a.traits.length && <div className="flex flex-wrap gap-1">{a.traits.map((t) => <span key={t} className="rounded-full border border-primary/50 px-2 py-0.5 text-xs">{t}</span>)}</div>}
      {a.rating !== null && <p><span className="text-muted">{dict.body.reports.assessRatingLabel}</span><span className="font-normal">{dict.body.reports.assessRatingValue.replace("{a}", String(a.rating))}</span></p>}
      {!!a.criteria.length && (
        <ul className="grid gap-1">{a.criteria.map((c) => (
          <li key={c.name} className="flex items-center gap-2 text-xs"><span className="w-40 truncate">{c.name}</span>
            <span className="h-2 flex-1 rounded bg-canvas"><span className="block h-2 rounded bg-primary" style={{ width: `${c.score * 10}%` }} /></span><span className="w-10 text-right">{dict.body.reports.criterionScore.replace("{a}", String(c.score))}</span></li>
        ))}</ul>
      )}
      {a.notes && <p className="whitespace-pre-wrap text-xs">{a.notes}</p>}
    </div>
  );
}

export function AssessmentDialog({ player, open, edit, onClose, onSaved, confirmed }: { player: PlayerIdentity; open: boolean; edit: boolean; onClose: () => void; onSaved: (a: PlayerAssessment) => void; confirmed: boolean }) {
  const { t: dict } = useLocale();
  const [a, setA] = useState<PlayerAssessment | null | undefined>(undefined);
  const [d, setD] = useState<AssessmentBody>(EMPTY);
  const [trait, setTrait] = useState(""), [crit, setCrit] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const base = `/v1/players/${player.player_id}/assessment`;
  useEffect(() => {
    if (!open) return;
    setErr(null);
    void api<PlayerAssessment>(base).then((x) => { setA(x); setD(x.draft ?? x.published ?? EMPTY); }, () => setA(null));
  }, [open, base]);
  const save = async (publish: boolean) => {
    if (!a) return;
    setBusy(true); setErr(null);
    try { const x = await api<PlayerAssessment>(base, { method: "PUT", json: { version: a.version, draft: d, publish } }); setA(x); setD(x.draft ?? EMPTY); onSaved(x); }
    catch (x) { setErr(why(x, dict.body.reports.assessmentSaveFailed)); } finally { setBusy(false); }
  };
  const withdraw = async () => {
    setBusy(true); setErr(null);
    try { const x = await api<PlayerAssessment>(`${base}/published`, { method: "DELETE" }); setA(x); onSaved(x); } catch (x) { setErr(why(x, dict.body.reports.withdrawFailed)); } finally { setBusy(false); }
  };
  const writing = edit && !!a?.can_write;
  return (
    <Shell wide open={open} onClose={onClose} name={writing ? "assessment-edit" : "assessment"} title={dict.body.reports.assessmentTitle.replace("{a}", player.display_name)}
      desc={dict.body.reports.assessmentDesc}>
      {a === undefined ? <p className="text-muted">{dict.common.loading}</p> : a === null ? <p role="alert" className="text-danger">{dict.body.reports.assessmentLoadFailed}</p> : !writing ? (
        a.published ? (
          <div className="grid gap-2" data-assessment="published">
            <p className="text-xs italic text-amber">{dict.body.reports.analystOpinionPublishedWhen.replace("{a}", a.published_by_name ?? "").replace("{b}", a.published_at ? when(a.published_at) : "")}</p>
            <AssessmentView a={a.published} />
          </div>
        ) : <p className="text-muted">{dict.body.reports.assessmentNonePublished}{a.can_write ? dict.body.reports.assessmentWriteHint : ""}</p>
      ) : (
        <div className="grid gap-3" data-assessment="edit">
          <p className="t-small">{a.published ? dict.body.reports.publishedByWhen.replace("{a}", a.published_by_name ?? "").replace("{b}", a.published_at ? when(a.published_at) : "") : dict.body.reports.notPublishedYet}{a.unpublished_changes ? dict.body.reports.draftUnpublished : ""}</p>
          <label className="grid gap-1">{dict.body.reports.assessRoleField}<input value={d.role} onChange={(e) => setD({ ...d, role: e.target.value })} maxLength={80} placeholder={dict.body.reports.roleExample} className={field} /></label>
          <label className="grid gap-1">{dict.body.reports.assessSummary}<textarea value={d.summary} onChange={(e) => setD({ ...d, summary: e.target.value })} maxLength={600} rows={3} className={field} /></label>
          <div className="grid gap-1">{dict.body.reports.assessTraits}
            <div className="flex flex-wrap gap-1">{d.traits.map((t) => <span key={t} className="flex items-center gap-1 rounded-full border border-primary/50 px-2 py-0.5 text-xs">{t}<button type="button" aria-label={dict.body.reports.removeTraitAria.replace("{a}", t)} onClick={() => setD({ ...d, traits: d.traits.filter((x) => x !== t) })}>✕</button></span>)}</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = trait.trim(); if (t && !d.traits.includes(t) && d.traits.length < 8) { setD({ ...d, traits: [...d.traits, t] }); setTrait(""); } }}>
              <input value={trait} onChange={(e) => setTrait(e.target.value)} maxLength={30} placeholder={dict.body.reports.traitPlaceholder} aria-label={dict.body.reports.newTraitAria} className={field} /><button type="submit" disabled={!trait.trim() || d.traits.length >= 8} className={ghost}>{dict.body.matches.addBtn}</button>
            </form>
          </div>
          <label className="flex items-center gap-2">{dict.body.reports.assessRating}
            <select aria-label={dict.body.reports.assessRating} value={d.rating === null ? "" : String(d.rating)} onChange={(e) => setD({ ...d, rating: e.target.value === "" ? null : Number(e.target.value) })} className="rounded-ctl border border-line bg-transparent px-2 py-1">
              <option value="">{dict.body.reports.notRated}</option>{Array.from({ length: 21 }, (_, i) => i / 2).map((v) => <option key={v} value={v}>{dict.body.reports.assessRatingValue.replace("{a}", String(v))}</option>)}
            </select>
          </label>
          <div className="grid gap-1">{dict.body.reports.criteriaHeading}
            {d.criteria.map((c, i) => (
              <div key={c.name} className="flex items-center gap-2 text-xs"><span className="w-44 truncate">{c.name}</span>
                <input type="range" min={1} max={10} value={c.score} aria-label={dict.body.reports.criterionScoreAria.replace("{a}", c.name)} onChange={(e) => setD({ ...d, criteria: d.criteria.map((x, j) => (j === i ? { ...x, score: Number(e.target.value) } : x)) })} className="flex-1" />
                <span className="w-8 text-right">{c.score}</span><button type="button" aria-label={dict.body.reports.removeCriterionAria.replace("{a}", c.name)} onClick={() => setD({ ...d, criteria: d.criteria.filter((_, j) => j !== i) })}>✕</button></div>
            ))}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = crit.trim(); if (n && !d.criteria.some((x) => x.name === n) && d.criteria.length < 8) { setD({ ...d, criteria: [...d.criteria, { name: n, score: 5 }] }); setCrit(""); } }}>
              <input value={crit} onChange={(e) => setCrit(e.target.value)} maxLength={40} placeholder={dict.body.reports.criterionPlaceholder} aria-label={dict.body.reports.newCriterionAria} className={field} /><button type="submit" disabled={!crit.trim() || d.criteria.length >= 8} className={ghost}>{dict.body.matches.addBtn}</button>
            </form>
          </div>
          <label className="grid gap-1">{dict.body.reports.scoutNotes}<textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} maxLength={2000} rows={4} className={field} /></label>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-save-draft disabled={busy} onClick={() => void save(false)} className={ghost}>{dict.body.reports.saveDraft}</button>
            <button type="button" data-publish disabled={busy || !confirmed} title={confirmed ? undefined : dict.body.reports.publishBlockedWhy}
              onClick={() => void save(true)} className={btn}>{busy ? dict.body.players.saving : dict.body.reports.savePublish}</button>
            {a.published && <button type="button" data-withdraw disabled={busy} onClick={() => void withdraw()} className={`${ghost} ml-auto`}>{dict.body.reports.takeOffReport}</button>}
          </div>
          {err && <p role="alert" className="text-danger">{err}</p>}
        </div>
      )}
    </Shell>
  );
}
