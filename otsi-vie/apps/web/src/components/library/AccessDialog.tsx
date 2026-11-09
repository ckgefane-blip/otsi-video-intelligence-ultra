"use client";
/**
 * Page 09 Section 10 — Manage Access (ADR-057). Who may see a project and everything in it (its videos, analysis, reels, renders, reports):
 * everyone in the organization, or only the people chosen here (Owners and Admins always see every project). Each person has one
 * permission: Viewer, Reviewer (identity checks and notes), Editor or Manager (also chooses who is on it). A permission never adds to a
 * person's organization role; the list says what each one can really do. Changes take effect at the person's next click, and are audited.
 * Everything shown comes from GET /v1/projects/:id/access; nothing is assumed in the browser.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { PERMISSION_NAMES, type ProjectAccessView, type ProjectPermission } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";

const PERMS: ProjectPermission[] = ["READ", "REVIEW", "EDIT", "ADMIN"];
const CAN: Record<string, string> = { VIEW: "can view", REVIEW: "can view and check identities", EDIT: "can edit", MANAGE: "can edit and manage access" };
const role = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

export function AccessDialog({ projectId, projectName, open, onOpenChange, onChanged }:
  { projectId: string | null; projectName: string; open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => Promise<void> }) {
  const [view, setView] = useState<ProjectAccessView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const [perm, setPerm] = useState<ProjectPermission>("READ");
  useEffect(() => {
    if (!open || !projectId) return;
    setView(null); setError(null); setPick(""); setPerm("READ");
    void api<ProjectAccessView>(`/v1/projects/${projectId}/access`).then(setView, (x) => setError(x instanceof ApiProblem ? x.message : "Access could not be loaded"));
  }, [open, projectId]);
  const run = async (fn: () => Promise<ProjectAccessView>) => {
    setBusy(true); setError(null);
    try { setView(await fn()); await onChanged(); } catch (x) { setError(x instanceof ApiProblem ? x.message : "The change was not saved"); } finally { setBusy(false); }
  };
  const base = `/v1/projects/${projectId}/access`;
  const manage = !!view?.can_manage && !busy;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content data-access-dialog className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
          <Dialog.Title className="text-base font-semibold">Manage Access</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            {projectName}: who can see this project and everything in it (videos, analysis, reels, rendered files, reports).
          </Dialog.Description>
          {!projectId && <p className="text-muted">This item is not in a project, so it has no access list.</p>}
          {projectId && !view && !error && <p className="text-muted">Loading…</p>}
          {error && <p role="alert" className="mb-2 rounded-ctl border border-[#a83a4a] bg-[#3a0f18] px-2 py-1 text-[#ff9aa8]">{error}</p>}
          {view && (
            <>
              <fieldset className="mb-3 space-y-1" disabled={!manage}>
                <legend className="mb-1 font-medium">Who can see it</legend>
                {([["ORGANIZATION", "Everyone in your organization"], ["RESTRICTED", "Only the people listed below (and Owners / Admins)"]] as const).map(([v, l]) => (
                  <label key={v} className="flex items-center gap-2">
                    <input type="radio" name="access" value={v} checked={view.access === v}
                      onChange={() => void run(() => api<ProjectAccessView>(base, { method: "PUT", json: { access: v } }))} />
                    <span>{l}</span>
                  </label>
                ))}
                {!view.can_manage && <p className="text-xs text-muted">Only an Owner, an Admin or this project&apos;s Manager can change this.</p>}
              </fieldset>
              <h3 className="mb-1 font-medium">People on this project ({view.people.length})</h3>
              {view.people.length === 0 && <p className="mb-2 text-muted">Nobody is listed yet.</p>}
              <ul aria-label="People on this project" className="mb-3 divide-y divide-line rounded-ctl border border-line">
                {view.people.map((x) => (
                  <li key={x.user_id} className="flex items-center gap-2 px-2 py-1.5" data-person={x.user_id}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{x.display_name} <span className="text-xs text-muted">· {role(x.role)}</span></div>
                      <div className="text-xs text-muted">{CAN[x.effective]}{x.granted_by_name ? ` · added by ${x.granted_by_name}` : ""} · {new Date(x.granted_at).toLocaleDateString("en-GB")}</div>
                    </div>
                    <select aria-label={`Permission of ${x.display_name}`} value={x.permission} disabled={!manage} className="rounded-ctl border border-line bg-[#041022] px-1 py-1"
                      onChange={(e) => void run(() => api<ProjectAccessView>(`${base}/people/${x.user_id}`, { method: "PUT", json: { permission: e.target.value } }))}>
                      {PERMS.map((p) => <option key={p} value={p}>{PERMISSION_NAMES[p]}</option>)}
                    </select>
                    {view.can_manage && (
                      <button type="button" disabled={busy} aria-label={`Remove ${x.display_name}`} className="rounded-ctl border border-line px-2 py-1"
                        onClick={() => void run(() => api<ProjectAccessView>(`${base}/people/${x.user_id}`, { method: "DELETE" }))}>Remove</button>
                    )}
                  </li>
                ))}
              </ul>
              {view.can_manage && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <select aria-label="Member to add" value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-[180px] flex-1 rounded-ctl border border-line bg-[#041022] px-1 py-1">
                    <option value="">{view.addable.length ? "Add a member…" : "Every member is listed"}</option>
                    {view.addable.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name} · {role(m.role)}</option>)}
                  </select>
                  <select aria-label="Permission for the new person" value={perm} onChange={(e) => setPerm(e.target.value as ProjectPermission)} className="rounded-ctl border border-line bg-[#041022] px-1 py-1">
                    {PERMS.map((p) => <option key={p} value={p}>{PERMISSION_NAMES[p]}</option>)}
                  </select>
                  <button type="button" disabled={!pick || busy} className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                    onClick={() => { const id = pick; setPick(""); void run(() => api<ProjectAccessView>(`${base}/people/${id}`, { method: "PUT", json: { permission: perm } })); }}>Add</button>
                </div>
              )}
              <p className="text-xs text-muted">
                Always see every project: {view.always.map((m) => `${m.display_name} (${role(m.role)})`).join(", ") || "—"}.
                {" "}A permission never adds to someone&apos;s role: a Viewer stays a viewer. To add someone new to the organization, invite them from Team.
              </p>
            </>
          )}
          <div className="mt-3 flex justify-end"><Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">Close</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
