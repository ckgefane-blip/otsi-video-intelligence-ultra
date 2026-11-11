"use client";
/**
 * Page 09 Section 10 — Manage Access (ADR-057). Who may see a project and everything in it (its videos, analysis, reels, renders, reports):
 * everyone in the organization, or only the people chosen here (Owners and Admins always see every project). Each person has one
 * permission: Viewer, Reviewer (identity checks and notes), Editor or Manager (also chooses who is on it). A permission never adds to a
 * person's organization role; the list says what each one can really do. Changes take effect at the person's next click, and are audited.
 * Everything shown comes from GET /v1/projects/:id/access; nothing is assumed in the browser.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { type ProjectAccessView, type ProjectPermission } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";

const PERMS: ProjectPermission[] = ["READ", "REVIEW", "EDIT", "ADMIN"];
const CAN = (d: Dictionary): Record<string, string> => ({ VIEW: d.body.library.accessCanView, REVIEW: d.body.library.accessCanReview, EDIT: d.body.library.accessCanEdit, MANAGE: d.body.library.accessCanManage });
const permName = (p: ProjectPermission, d: Dictionary): string => ({ READ: d.body.library.permViewer, REVIEW: d.body.library.permReviewer, EDIT: d.body.library.permEditor, ADMIN: d.body.library.permManager })[p];
const role = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

export function AccessDialog({ projectId, projectName, open, onOpenChange, onChanged }:
  { projectId: string | null; projectName: string; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => Promise<void> }) {
  const { t: dict } = useLocale();
  const [view, setView] = useState<ProjectAccessView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const [perm, setPerm] = useState<ProjectPermission>("READ");
  useEffect(() => {
    if (!open || !projectId) return;
    setView(null); setError(null); setPick(""); setPerm("READ");
    void api<ProjectAccessView>(`/v1/projects/${projectId}/access`).then(setView, (x) => setError(x instanceof ApiProblem ? x.message : dict.body.library.accessLoadFailed));
  }, [open, projectId]);
  const run = async (fn: () => Promise<ProjectAccessView>) => {
    setBusy(true); setError(null);
    try { setView(await fn()); await onChanged(); } catch (x) { setError(x instanceof ApiProblem ? x.message : dict.body.library.accessNotSaved); } finally { setBusy(false); }
  };
  const base = `/v1/projects/${projectId}/access`;
  const manage = !!view?.can_manage && !busy;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content data-access-dialog className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{dict.body.library.manageAccess}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            {dict.body.library.accessDesc.replace("{a}", projectName)}
          </Dialog.Description>
          {!projectId && <p className="text-muted">{dict.body.library.accessNoProject}</p>}
          {projectId && !view && !error && <p className="text-muted">{dict.common.loading}</p>}
          {error && <p role="alert" className="mb-2 rounded-ctl border border-[#a83a4a] bg-[#3a0f18] px-2 py-1 text-[#ff9aa8]">{error}</p>}
          {view && (
            <>
              <fieldset className="mb-3 space-y-1" disabled={!manage}>
                <legend className="mb-1 font-medium">{dict.body.library.accessWhoCanSee}</legend>
                {([["ORGANIZATION", dict.body.library.accessEveryone], ["RESTRICTED", dict.body.library.accessRestricted]] as const).map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2">
                    <input type="radio" name="access" value={v} checked={view.access === v}
                      onChange={() => void run(() => api<ProjectAccessView>(base, { method: "PUT", json: { access: v } }))} />
                    <span>{l}</span>
                  </label>
                ))}
                {!view.can_manage && <p className="text-xs text-muted">{dict.body.library.accessOnlyManager}</p>}
              </fieldset>
              <h3 className="mb-1 font-medium">{dict.body.library.accessPeopleOn.replace("{a}", String(view.people.length))}</h3>
              {view.people.length === 0 && <p className="mb-2 text-muted">{dict.body.library.accessNobody}</p>}
              <ul aria-label={dict.body.library.accessPeopleAria} className="mb-3 divide-y divide-line rounded-ctl border border-line">
                {view.people.map((x) => (
                  <li key={x.user_id} className="flex items-center gap-2 px-2 py-1.5" data-person={x.user_id}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{x.display_name} <span className="text-xs text-muted">· {role(x.role)}</span></div>
                      <div className="text-xs text-muted">{CAN(dict)[x.effective]}{x.granted_by_name ? ` · ${dict.body.library.accessAddedBy.replace("{a}", x.granted_by_name)}` : ""} · {new Date(x.granted_at).toLocaleDateString("en-GB")}</div>
                    </div>
                    <select aria-label={dict.body.library.accessPermOf.replace("{a}", x.display_name)} value={x.permission} disabled={!manage} className="rounded-ctl border border-line bg-[#041022] px-1 py-1"
                      onChange={(e) => void run(() => api<ProjectAccessView>(`${base}/people/${x.user_id}`, { method: "PUT", json: { permission: e.target.value } }))}>
                      {PERMS.map((p) => <option key={p} value={p}>{permName(p, dict)}</option>)}
                    </select>
                    {view.can_manage && (
                      <button type="button" disabled={busy} aria-label={dict.body.library.accessRemovePerson.replace("{a}", x.display_name)} className="rounded-ctl border border-line px-2 py-1"
                        onClick={() => void run(() => api<ProjectAccessView>(`${base}/people/${x.user_id}`, { method: "DELETE" }))}>{dict.body.matches.removeBtn}</button>
                    )}
                  </li>
                ))}
              </ul>
              {view.can_manage && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <select aria-label={dict.body.library.accessAddMemberLabel} value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-[180px] flex-1 rounded-ctl border border-line bg-[#041022] px-1 py-1">
                    <option value="">{view.addable.length ? dict.body.library.accessAddMember : dict.body.library.accessEveryMember}</option>
                    {view.addable.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name} · {role(m.role)}</option>)}
                  </select>
                  <select aria-label={dict.body.library.accessPermForNew} value={perm} onChange={(e) => setPerm(e.target.value as ProjectPermission)} className="rounded-ctl border border-line bg-[#041022] px-1 py-1">
                    {PERMS.map((p) => <option key={p} value={p}>{permName(p, dict)}</option>)}
                  </select>
                  <button type="button" disabled={!pick || busy} className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                    onClick={() => { const id = pick; setPick(""); void run(() => api<ProjectAccessView>(`${base}/people/${id}`, { method: "PUT", json: { permission: perm } })); }}>{dict.body.library.accessAdd}</button>
                </div>
              )}
              <p className="text-xs text-muted">
                {dict.body.library.accessAlwaysSee.replace("{a}", view.always.map((m) => `${m.display_name} (${role(m.role)})`).join(", ") || "—")}
                {" "}{dict.body.library.accessRoleNote}
              </p>
            </>
          )}
          <div className="mt-3 flex justify-end"><Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.close}</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
