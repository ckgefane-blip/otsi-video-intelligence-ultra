"use client";
/**
 * Page 10 Section 11 "Shareable Link" (promise 10, contract `sharing.ts`): a private link to the reel's finished render.
 *
 * Rights first: the badge says what is missing (a finished render, rights that allow sharing); a link is made only when the server's rule
 * allows it and the server checks it again whenever the link is opened. The link is shown once, when made (only its hash is stored): copy it
 * then. Expiry (1-30 days), "Allow Download", "Password Protection" (the person opening it types it; stored as a hash only; 10 wrong tries
 * lock the link for 15 minutes) and "Allow Comments" (people opening it leave a comment with their name) are real choices. "Sharing & rights"
 * lists the links (revoke, read their comments) and, for an Owner or Admin, records the video's rights with a reason (audited; history kept).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { rightsAllowShare, type CreatedShareLink, type SharedComment, type ShareLink, type VideoRights } from "@otsi-vie/contracts";
import { useCallback, useEffect, useState } from "react";
import { Calendar, Download, FileText, Lock, StickyNote } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useExport } from "./state";

const DAYS = [1, 3, 7, 14, 30];
const shareable = (r: VideoRights | null) => rightsAllowShare(r);          // B.23 (ADR-098): one rule, shared with the preflight
const STATE_WORDS: Record<string, string> = { ANALYSIS_ONLY: "Analysis only", INTERNAL: "Internal only", EXPORT_ALLOWED: "Export allowed", PUBLIC: "Public", UNKNOWN: "Unknown", EXPIRED: "Expired" };

export function SharePanel({ focus }: { focus: boolean }) {
  const { t: dict } = useLocale();
  const e = useExport();
  const { organization } = useAuth();
  const admin = !!organization && ["OWNER", "ADMIN"].includes(organization.role);
  const renderId = e.reel?.last_good_render?.has_output ? e.reel.last_good_render.id : null;
  const videoId = e.reel?.video_id ?? null;
  const [rights, setRights] = useState<VideoRights | null>(null);
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [days, setDays] = useState(7);
  const [download, setDownload] = useState(false);
  /** null: no password; a string: the password being typed (8+ characters) */
  const [password, setPassword] = useState<string | null>(null);
  const [comments, setComments] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    if (videoId) await api<VideoRights>(`/v1/videos/${videoId}/rights`).then(setRights, () => setRights(null));
    if (renderId) await api<ShareLink[]>(`/v1/renders/${renderId}/share-links`).then(setLinks, () => setLinks(null)); else setLinks(null);
  }, [videoId, renderId]);
  useEffect(() => { setMade(null); setErr(null); void reload(); }, [reload]);

  const live = (links ?? []).filter((l) => l.state === "ACTIVE");
  const ok = !!renderId && shareable(rights);
  const badge: [string, string] = !renderId ? ["Not ready", "#8ea3bf"] : !shareable(rights) ? ["Rights needed", "#ffb21a"] : live.length ? [`Shared · ${live.length}`, "#19e6a0"] : ["Ready", "#33a8ff"];
  const canDownload = !!rights?.grant?.allowed_uses.includes("DOWNLOAD");

  const create = async () => {
    if (!renderId) return;
    if (password !== null && password.length < 8) { setErr("The password needs at least 8 characters."); return; }
    setBusy(true); setErr(null); setCopied(false);
    try {
      const l = await api<CreatedShareLink>(`/v1/renders/${renderId}/share-links`, { method: "POST",
        json: { expires_in_days: days, can_download: download, password, can_comment: comments } });
      setPassword(null);
      setMade(`${window.location.origin}${l.url}`);
      await reload();
    } catch (x) { setErr(x instanceof ApiProblem ? x.message : "The link could not be made."); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!made) return;
    try { await navigator.clipboard.writeText(made); setCopied(true); } catch { setErr("Copy failed: select the link and copy it."); }
  };
  const fieldText = made ?? (!renderId ? "Link available after export" : !shareable(rights) ? (admin ? "Record the video's rights first" : "The video's rights do not allow sharing") : "Create a share link");
  const [note, setNote] = useState<string | null>(null);
  const fieldClick = () => {
    if (made) return void copy();
    if (ok && e.canEdit) return void create();
    if (!renderId) return setNote("Render the reel first");
    if (admin && !shareable(rights)) return setOpen(true);
    setNote(!e.canEdit ? "Your role can look, not share" : "The video's rights do not allow sharing: an Owner or Admin records them");
  };

  return (
    <section id="p10-delivery" aria-label="Shareable link" data-section="p10-s11" data-share-state={badge[0]}
      className={`vie-panel p-3 ${focus ? "border-primary" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="t-panel">{dict.body.exports.shareableLink}</h2>
        <span className="flex items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-1 text-xs">
          <span className="h-3 w-3 rounded-full" style={{ background: badge[1] }} aria-hidden />{badge[0]}
        </span>
      </div>

      <button type="button" aria-label={made ? (copied ? "Link copied" : "Copy the share link") : ok && e.canEdit ? "Create share link" : "Share link"}
        onClick={fieldClick}
        className="mt-2 flex w-full items-center gap-2 rounded-md border border-line bg-canvas px-2.5 py-2.5 text-left text-sm hover:border-primary/60">
        <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className={`min-w-0 flex-1 truncate ${made ? "text-ink" : ok ? "text-primary" : "text-muted"}`}>{busy ? "Making the link…" : fieldText}</span>
      </button>

      <div data-share="password" className="mt-2 flex items-center gap-2 text-sm">
        <Lock className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        {password === null ? <span className="flex-1">Password protection</span> : (
          <input aria-label="Password for the link (8 or more characters)" type="password" autoComplete="new-password" value={password} maxLength={128} autoFocus
            onChange={(x) => setPassword(x.target.value)} placeholder="Password (8+ characters)"
            className="min-w-0 flex-1 rounded-ctl border border-primary bg-canvas px-2 py-1 text-sm text-ink outline-none" />
        )}
        <button type="button" role="switch" aria-checked={password !== null} aria-label="Password protection" className="vie-sw"
          onClick={() => (e.canEdit ? setPassword((p) => (p === null ? "" : null)) : setNote("Your role can look, not share"))} />
      </div>
      <div data-share="expiry" className="mt-2 flex items-center gap-2 text-sm">
        <Calendar className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="flex-1">Link expires after</span>
        <button type="button" aria-label={`Link expires after ${days} days (click to change)`}
          onClick={() => setDays(DAYS[(DAYS.indexOf(days) + 1) % DAYS.length]!)}
          className="font-normal text-primary hover:underline">{days} day{days === 1 ? "" : "s"}</button>
      </div>
      <div data-share="download" title={canDownload ? undefined : "The video's rights do not allow downloads"} className="mt-2 flex items-center gap-2 text-sm">
        <Download className={`h-4 w-4 shrink-0 ${canDownload ? "text-muted" : "text-muted/50"}`} aria-hidden />
        <span className={`flex-1 ${canDownload ? "" : "text-muted"}`}>Allow download</span>
        <button type="button" role="switch" aria-checked={download && canDownload} aria-label="Allow download" className="vie-sw"
          onClick={() => (canDownload ? setDownload((d) => !d) : setNote("The video's rights do not allow downloads"))} />
      </div>
      <div data-share="comments" className="mt-2 flex items-center gap-2 text-sm">
        <StickyNote className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="flex-1">Allow comments</span>
        <button type="button" role="switch" aria-checked={comments} aria-label="Allow comments" className="vie-sw"
          onClick={() => (e.canEdit ? setComments((c) => !c) : setNote("Your role can look, not share"))} />
      </div>
      <p className={`mt-2 truncate text-xs ${err ? "text-danger" : "text-muted"}`}>
        {err ?? (copied ? "Link copied. It is shown only once." : made ? "Click the link to copy it. It is shown only once." : rights?.grant ? `Rights: ${STATE_WORDS[rights.grant.rights_state]}` : "No rights recorded")}
      </p>
      {note && <p role="status" className="mt-1 text-xs text-muted">{note}</p>}
      <div className="mt-2 flex justify-end">
        <button type="button" aria-label="Sharing and rights" onClick={() => setOpen(true)} className="text-sm text-primary hover:underline">Sharing &amp; rights</button>
      </div>
      <ShareDialog open={open} onOpenChange={setOpen} rights={rights} links={links} admin={admin} canEdit={e.canEdit} videoId={videoId} onChanged={reload} />
    </section>
  );
}

function ShareDialog({ open, onOpenChange, rights, links, admin, canEdit, videoId, onChanged }: {
  open: boolean; onOpenChange(o: boolean): void; rights: VideoRights | null; links: ShareLink[] | null; admin: boolean; canEdit: boolean; videoId: string | null; onChanged(): Promise<void>;
}) {
  const { t: dict } = useLocale();
  const [state, setState] = useState<"EXPORT_ALLOWED" | "PUBLIC" | "INTERNAL" | "ANALYSIS_ONLY">("EXPORT_ALLOWED");
  const [uses, setUses] = useState<string[]>(["VIEW", "SHARE"]);
  const [until, setUntil] = useState("");
  const [minor, setMinor] = useState<"NOT_APPLICABLE" | "PENDING" | "VERIFIED" | "REVOKED">("NOT_APPLICABLE");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!videoId) return;
    setBusy(true); setErr(null);
    try {
      await api(`/v1/videos/${videoId}/rights`, { method: "POST", json: { rights_state: state, allowed_uses: uses, valid_until: until ? new Date(until).toISOString() : null, guardian_consent_state: minor, reason } });
      setReason(""); await onChanged();
    } catch (x) { setErr(x instanceof ApiProblem ? x.message : "The rights could not be recorded."); } finally { setBusy(false); }
  };
  const [reading, setReading] = useState<{ id: string; list: SharedComment[] | null } | null>(null);
  const read = (id: string) => {
    setReading({ id, list: null });
    void api<SharedComment[]>(`/v1/share-links/${id}/comments`).then((list) => setReading({ id, list }), () => { setReading(null); setErr("The comments could not be loaded."); });
  };
  const revoke = async (id: string) => {
    setErr(null);
    try { await api(`/v1/share-links/${id}`, { method: "DELETE" }); await onChanged(); } catch (x) { setErr(x instanceof ApiProblem ? x.message : "The link could not be revoked."); }
  };
  const g = rights?.grant;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="sharing" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(720px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-normal">Sharing &amp; rights</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            A share link works only while the source video&apos;s rights allow sharing; the rights are checked again every time a link is opened.
            Every change is recorded in the audit log.
          </Dialog.Description>

          <h3 className="mb-1 font-normal">The video&apos;s rights</h3>
          <p className="mb-2 text-xs" data-rights-now>{g
            ? `${STATE_WORDS[g.rights_state]} · uses: ${g.allowed_uses.join(", ").toLowerCase() || "none"}${g.valid_until ? ` · until ${new Date(g.valid_until).toLocaleDateString()}` : ""}${g.guardian_consent_state !== "NOT_APPLICABLE" ? ` · guardian consent ${g.guardian_consent_state.toLowerCase()}` : ""} · recorded ${new Date(g.created_at).toLocaleString()}`
            : "No rights recorded: nothing from this video can be shared."}</p>
          {admin ? (
            <div className="mb-4 grid gap-2 rounded-ctl border border-line p-3 text-xs">
              <label className="flex items-center gap-2">State
                <select aria-label="Rights state" value={state} onChange={(x) => setState(x.target.value as typeof state)} className="rounded-ctl border border-line bg-transparent px-2 py-1">
                  <option value="EXPORT_ALLOWED">Export allowed</option><option value="PUBLIC">Public</option><option value="INTERNAL">Internal only</option><option value="ANALYSIS_ONLY">Analysis only</option>
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-3">Allowed uses
                {["VIEW", "SHARE", "DOWNLOAD", "EXPORT", "DELIVER"].map((x) => (
                  <label key={x} className="flex items-center gap-1"><input type="checkbox" checked={uses.includes(x)} onChange={(c) => setUses((u2) => c.target.checked ? [...u2, x] : u2.filter((y) => y !== x))} />{x.toLowerCase()}</label>
                ))}
              </div>
              <label className="flex items-center gap-2">Valid until (optional)<input aria-label="Valid until" type="date" value={until} onChange={(x) => setUntil(x.target.value)} className="rounded-ctl border border-line bg-transparent px-2 py-1" /></label>
              <label className="flex items-center gap-2">Players under 18
                <select aria-label="Guardian consent" value={minor} onChange={(x) => setMinor(x.target.value as typeof minor)} className="rounded-ctl border border-line bg-transparent px-2 py-1">
                  <option value="NOT_APPLICABLE">Not applicable</option><option value="VERIFIED">Guardian consent verified</option><option value="PENDING">Guardian consent pending</option><option value="REVOKED">Guardian consent revoked</option>
                </select>
              </label>
              <label className="grid gap-1">Reason / evidence (required)<textarea aria-label="Reason" value={reason} onChange={(x) => setReason(x.target.value)} rows={2} placeholder="e.g. licence from the league, clause 4; club owns the footage" className="rounded-ctl border border-line bg-transparent px-2 py-1" /></label>
              <button type="button" data-record-rights onClick={() => void save()} disabled={busy || reason.trim().length < 3} className="justify-self-start rounded-ctl bg-primary px-3 py-1.5 font-normal text-white disabled:opacity-50">{busy ? "Recording…" : "Record these rights"}</button>
            </div>
          ) : <p className="mb-4 text-xs text-muted">Only an Owner or Admin records a video&apos;s rights.</p>}

          <h3 className="mb-1 font-normal">Links to this render</h3>
          {!links?.length ? <p className="text-xs text-muted">{dict.body.exports.noLinksYet}</p> : (
            <ul className="grid gap-1 text-xs" aria-label="Share links">
              {links.map((l) => (
                <li key={l.id} data-link={l.state} className="flex items-center justify-between gap-2 rounded-ctl border border-line px-2 py-1">
                  <span>{l.state === "ACTIVE" ? "Active" : l.state === "REVOKED" ? "Revoked" : "Expired"} · made {new Date(l.created_at).toLocaleString()}{l.expires_at ? ` · expires ${new Date(l.expires_at).toLocaleString()}` : ""} · {l.can_download ? "download allowed" : "watch only"}{l.has_password ? " · password" : ""} · opened {l.opened}×</span>
                  <span className="flex shrink-0 gap-2">
                    {(l.can_comment || l.comments > 0) && <button type="button" onClick={() => read(l.id)} className="text-primary">{`Comments (${l.comments})`}</button>}
                    {l.state === "ACTIVE" && canEdit && <button type="button" onClick={() => void revoke(l.id)} className="text-danger">Revoke</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {reading && (
            <div className="mt-3 rounded-ctl border border-line p-2 text-xs" data-link-comments={reading.id}>
              <h3 className="mb-1 font-normal">Comments left through this link</h3>
              {!reading.list ? <p className="text-muted">Loading…</p> : !reading.list.length ? <p className="text-muted">No comments yet.</p> : (
                <ul className="grid gap-1">
                  {reading.list.map((c) => (
                    <li key={c.id}><span className="font-normal">{c.name}</span>{c.at_s !== null ? <span className="text-muted"> at {Math.floor(c.at_s / 60)}:{String(Math.floor(c.at_s % 60)).padStart(2, "0")}</span> : null}
                      <span className="text-muted"> · {new Date(c.created_at).toLocaleString()}</span><br />{c.body}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
          <div className="mt-3 flex justify-end"><Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">Close</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
