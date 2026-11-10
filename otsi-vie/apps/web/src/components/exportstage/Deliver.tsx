"use client";
/**
 * Page 10 Output & Reports, Team Collaboration notify / message, Download All and Deliver to Client (ADR-058, contract `exports.ts`).
 *
 * Output & Reports: tick the files to make with the finished render (Performance Report PDF, Clip Sheet PDF, Event List CSV, Heatmap PNG);
 * "Make files" makes them (POST /v1/reels/:id/bundles); each row then says what was made, failed or is not measured, with Preview / Save.
 * Download All gives one ZIP of the render and the made files with a manifest (POST …/bundles/:id/zip), making the ticked files first when
 * they are not made for this render yet; with nothing ticked it downloads the render alone.
 * Deliver to Client opens the delivery: the client's name and email and / or chosen team members, the message, and the link's expiry and
 * download choice. The server checks the rights, makes a share link, records the delivery and returns the email; the page opens the sender's
 * own mail app with it (mailto). The server cannot know the email was sent: it records "handed to your mail app" and counts link openings.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { BUNDLE_ITEM_NAMES, type BundleItemKind, type CreatedDelivery, type Delivery, type ExportBundle } from "@otsi-vie/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { B, T, u } from "@/components/stage/DesignStage";
import { Hit } from "@/components/workspace/shared";
import { api, ApiProblem } from "@/lib/api";
import type { ExportState } from "./state";
import { ReportPreviewDialog } from "./ReportPreview";

export const KINDS: BundleItemKind[] = ["PERFORMANCE_PDF", "CLIP_SHEET_PDF", "EVENTS_CSV", "HEATMAP_PNG"];
const COLOR: Record<BundleItemKind, string> = { PERFORMANCE_PDF: "#d22", CLIP_SHEET_PDF: "#1e6fe0", EVENTS_CSV: "#1fa862", HEATMAP_PNG: "#2a8af0" };
const DAYS = [1, 3, 7, 14, 30];
export const MESSAGE_MAX = 2000;
const kb = (n: number | null) => (n == null ? "—" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const why = (x: unknown, d: string) => (x instanceof ApiProblem ? x.message : d);

export interface Outbox {
  picks: BundleItemKind[];
  toggle(k: BundleItemKind): void;
  /** the newest bundle made for the render on screen */
  bundle: ExportBundle | null;
  making: boolean;
  err: string | null;
  make(): Promise<ExportBundle | null>;
  downloadAll(): void;
  notifyTeam: boolean;
  setNotifyTeam(b: boolean): void;
  notifyClient: boolean;
  setNotifyClient(b: boolean): void;
  message: string;
  setMessage(s: string): void;
  dialog: boolean;
  setDialog(b: boolean): void;
  deliveries: Delivery[] | null;
  reloadDeliveries(): Promise<void>;
}

export function useOutbox(e: Pick<ExportState, "reel" | "links">): Outbox {
  const reelId = e.reel?.id ?? null;
  const renderId = e.reel?.last_good_render?.has_output ? e.reel.last_good_render.id : null;
  const [picks, setPicks] = useState<BundleItemKind[]>(["PERFORMANCE_PDF", "CLIP_SHEET_PDF"]);
  const [bundles, setBundles] = useState<ExportBundle[] | null>(null);
  const [making, setMaking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notifyTeam, setNotifyTeam] = useState(false);
  const [notifyClient, setNotifyClient] = useState(false);
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);

  const load = useCallback(async () => {
    if (!reelId) { setBundles(null); setDeliveries(null); return; }
    await Promise.all([
      api<ExportBundle[]>(`/v1/reels/${reelId}/bundles`).then(setBundles, () => setBundles([])),
      api<Delivery[]>(`/v1/reels/${reelId}/deliveries`).then(setDeliveries, () => setDeliveries([])),
    ]);
  }, [reelId]);
  useEffect(() => { setErr(null); void load(); }, [load, renderId]);

  const bundle = (bundles ?? []).filter((b) => b.render_id === renderId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  // the outbox object is memoised (with the provider value): the page polls the reels every 2 s while a render runs
  const toggle = useCallback((k: BundleItemKind) => setPicks((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k])), []);
  const make = useCallback(async () => {
    if (!reelId || !picks.length) return null;
    setMaking(true); setErr(null);
    try {
      const b = await api<ExportBundle>(`/v1/reels/${reelId}/bundles`, { method: "POST", json: { items: KINDS.filter((k) => picks.includes(k)) } });
      setBundles((x) => [b, ...(x ?? []).filter((y) => y.id !== b.id)]);
      return b;
    } catch (x) { setErr(why(x, "The files could not be made.")); return null; } finally { setMaking(false); }
  }, [reelId, picks]);
  const downloadAll = useCallback(() => {
    if (!picks.length) { if (e.links) window.location.href = e.links.download_url; return; }
    void (async () => {
      const same = bundle && bundle.completed_at && bundle.requested.length === picks.length && picks.every((k) => bundle.requested.includes(k)) ? bundle : null;
      const b = same ?? (await make());
      if (!b || !reelId) return;
      let z = b.zip;
      if (!z) {
        setMaking(true); setErr(null);
        try {
          const nb = await api<ExportBundle>(`/v1/reels/${reelId}/bundles/${b.id}/zip`, { method: "POST" });
          setBundles((x) => [nb, ...(x ?? []).filter((y) => y.id !== nb.id)]);
          z = nb.zip;
        } catch (x) { setErr(why(x, "The ZIP could not be made.")); return; } finally { setMaking(false); }
      }
      if (z) window.location.href = z.download_url;
    })();
  }, [picks, bundle, make, reelId, e.links]);
  const setMessageCapped = useCallback((s: string) => setMessage(s.slice(0, MESSAGE_MAX)), []);
  return useMemo(() => ({
    picks, toggle, bundle, making, err, make, downloadAll,
    notifyTeam, setNotifyTeam, notifyClient, setNotifyClient, message, setMessage: setMessageCapped, dialog, setDialog, deliveries,
    reloadDeliveries: load,
  }), [picks, toggle, bundle, making, err, make, downloadAll, notifyTeam, notifyClient, message, setMessageCapped, dialog, deliveries, load]);
}

/** Section 10 Output & Reports: the four companion files of the finished render */
export function Reports({ e, o }: { e: ExportState; o: Outbox }) {
  const renderId = e.reel?.last_good_render?.has_output ? e.reel.last_good_render.id : null;
  const can = e.canEdit && !!renderId && !o.making;
  const off = !e.reel ? "Open a reel first" : !renderId ? "Render the reel first: the files belong to a finished render" : !e.canEdit ? "Your role can look, not make files" : "Making the files…";
  // B.23 (ADR-098): a report not made yet can be previewed (rule-built now, nothing saved); a made one opens its file
  const [preview, setPreview] = useState<"PERFORMANCE_PDF" | "CLIP_SHEET_PDF" | null>(null);
  const canPreview = !!e.reel?.player;
  return (
    <>
      <T x={1597} y={1009} size={18} color={can && o.picks.length ? "#33a8ff" : "#8ea3bf"} align="right">{o.making ? "Making…" : "Make files"}</T>
      <Hit x={1490} y={994} w={115} h={30} label={`Make the ticked files (${o.picks.length})`} {...(can && o.picks.length ? { onClick: () => void o.make() } : { reason: can ? "Tick at least one file" : off })} />
      {KINDS.map((k, i) => {
        const y = [1058, 1124, 1192, 1251][i]!, h = i < 2 ? 64 : 58;
        const [t, sub] = BUNDLE_ITEM_NAMES[k];
        const on = o.picks.includes(k);
        const item = o.bundle?.items.find((x) => x.kind === k) ?? null;
        const line = !item ? sub : item.state === "SUCCEEDED" ? `Made · ${kb(item.bytes)}` : `${item.state === "NOT_MEASURED" ? "Not measured" : "Failed"}: ${item.failure ?? "—"}`;
        const tone = !item ? "#9fb3cc" : item.state === "SUCCEEDED" ? "#3ee6a8" : item.state === "NOT_MEASURED" ? "#ffb21a" : "#ff8a8a";
        const open = item?.state === "SUCCEEDED" ? (k === "EVENTS_CSV" ? item.download_url : item.view_url) : null;
        const pdf = k === "PERFORMANCE_PDF" || k === "CLIP_SHEET_PDF";
        const look = !open && pdf && canPreview;
        return (
          <div key={k} data-report={k} data-picked={String(on)} data-state={item?.state ?? "NONE"}>
            <B x={1210} y={y - 30} w={399} h={h} style={{ background: "#06142a", border: `${u(1.5)} solid ${on ? "#1d4f8a" : "#12335f"}`, borderRadius: u(8) }} />
            <B x={1221} y={y - 13} w={26} h={26} style={{ border: `${u(2)} solid ${on ? "#1e90ff" : "#8ea3bf"}`, background: on ? "#1e90ff" : "transparent", borderRadius: u(4), color: "#fff", fontSize: u(16), display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : ""}</B>
            <B x={1260} y={y - 20} w={34} h={40} style={{ background: COLOR[k], borderRadius: u(4) }} />
            <T x={1314} y={y - 1} size={17} weight={600} color="#e3eefb">{t}</T>
            <T x={1314} y={y + 20} size={14} color={tone} style={{ maxWidth: u(open || look ? 215 : 285), overflow: "hidden", textOverflow: "ellipsis" }}>{line}</T>
            <Hit x={1210} y={y - 30} w={open || look ? 320 : 399} h={h} label={`${on ? "Leave out" : "Include"} ${t}`} pressed={on} {...(e.canEdit ? { onClick: () => o.toggle(k) } : { reason: "Your role can look, not make files" })} />
            {open && (
              <a href={open} target={k === "EVENTS_CSV" ? undefined : "_blank"} rel="noreferrer" aria-label={`${k === "EVENTS_CSV" ? "Save" : "Preview"} ${t}`} className="absolute"
                style={{ left: u(1539), top: u(y - 14 - 101), width: u(58), height: u(32), boxSizing: "border-box", background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6), color: "#33a8ff", fontSize: u(14), display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>
                {k === "EVENTS_CSV" ? "Save" : "Preview"}</a>
            )}
            {look && (
              <button type="button" data-report-preview={k} onClick={() => setPreview(k)} aria-label={`Preview ${t} before making it`} className="absolute"
                style={{ left: u(1539), top: u(y - 14 - 101), width: u(58), height: u(32), boxSizing: "border-box", background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6), color: "#33a8ff", fontSize: u(14), cursor: "pointer", fontFamily: "inherit" }}>
                Preview</button>
            )}
          </div>
        );
      })}
      {e.reel && <ReportPreviewDialog reelId={e.reel.id} kind={preview} onClose={() => setPreview(null)} />}
      {o.err && <T x={1231} y={1290} size={14} color="#ff8a8a" style={{ maxWidth: u(375), overflow: "hidden", textOverflow: "ellipsis" }}>{o.err}</T>}
    </>
  );
}

/** Deliver to Client: who gets it, the link's terms, then the sender's own mail app */
export function DeliverDialog({ e, o }: { e: ExportState; o: Outbox }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [team, setTeam] = useState<string[]>([]);
  const [days, setDays] = useState(7);
  const [download, setDownload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; mailto: string } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (o.dialog) { setErr(null); setMade(null); setCopied(false); void o.reloadDeliveries(); } }, [o.dialog]); // eslint-disable-line react-hooks/exhaustive-deps
  const reelId = e.reel?.id;
  const send = async () => {
    if (!reelId) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<CreatedDelivery>(`/v1/reels/${reelId}/deliveries`, { method: "POST", json: {
        notify_client: o.notifyClient, recipient_name: o.notifyClient ? name.trim() || null : null, recipient_email: o.notifyClient ? email.trim() || null : null,
        notify_team: o.notifyTeam, team_user_ids: o.notifyTeam ? team : [], message: o.message, link: { expires_in_days: days, can_download: download } } });
      const url = `${location.origin}${r.url}`;
      const q = [r.mail.bcc.length ? `bcc=${r.mail.bcc.map(encodeURIComponent).join(",")}` : "", `subject=${encodeURIComponent(r.mail.subject)}`, `body=${encodeURIComponent(`${r.mail.body}\n${url}\n`)}`].filter(Boolean).join("&");
      const mailto = `mailto:${r.mail.to.map(encodeURIComponent).join(",")}?${q}`;
      setMade({ url, mailto });
      await o.reloadDeliveries();
      window.location.href = mailto;
    } catch (x) { setErr(why(x, "The delivery could not be made.")); await o.reloadDeliveries(); } finally { setBusy(false); }
  };
  const field = "rounded-ctl border border-line bg-transparent px-2 py-1";
  return (
    <Dialog.Root open={o.dialog} onOpenChange={o.setDialog}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="deliver" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(640px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-semibold">Deliver to Client</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            A private link to the finished reel is made only when the video&apos;s rights allow sharing (checked again whenever it is opened). Your own mail app opens
            with the email ready: you send it. The delivery is recorded; the app counts how often the link is opened.
          </Dialog.Description>
          {made ? (
            <div className="grid gap-2" data-delivered>
              <p className="text-xs">Your mail app should open now. If it did not, copy the link (it is shown only once) or open the mail app again.</p>
              <code className="break-all rounded-ctl border border-line px-2 py-1 text-xs">{made.url}</code>
              <div className="flex gap-2">
                <button type="button" onClick={() => void navigator.clipboard?.writeText(made.url).then(() => setCopied(true), () => setErr("Copy failed"))} className="rounded-ctl border border-line px-3 py-1.5">{copied ? "Copied" : "Copy link"}</button>
                <a href={made.mailto} className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">Open my mail app again</a>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={o.notifyClient} onChange={(x) => o.setNotifyClient(x.target.checked)} />Notify client</label>
              {o.notifyClient && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="grid gap-1">Client&apos;s name<input aria-label="Client name" value={name} maxLength={255} onChange={(x) => setName(x.target.value)} className={field} /></label>
                  <label className="grid gap-1">Client&apos;s email<input aria-label="Client email" type="email" value={email} maxLength={255} onChange={(x) => setEmail(x.target.value)} className={field} /></label>
                </div>
              )}
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={o.notifyTeam} onChange={(x) => o.setNotifyTeam(x.target.checked)} />Notify team</label>
              {o.notifyTeam && (
                <ul className="grid max-h-40 gap-1 overflow-y-auto text-xs" aria-label="Team members">
                  {(e.members ?? []).map((m) => (
                    <li key={m.user_id}><label className="flex items-center gap-2"><input type="checkbox" checked={team.includes(m.user_id)}
                      onChange={(x) => setTeam((t) => (x.target.checked ? [...t, m.user_id] : t.filter((y) => y !== m.user_id)))} />{m.display_name}<span className="text-muted">{m.role.toLowerCase()}</span></label></li>
                  ))}
                </ul>
              )}
              <label className="grid gap-1 text-xs">Message (optional)
                <textarea aria-label="Delivery message" value={o.message} rows={3} maxLength={MESSAGE_MAX} onChange={(x) => o.setMessage(x.target.value)} className={field} />
                <span className="justify-self-end text-muted">{o.message.length}/{MESSAGE_MAX}</span>
              </label>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-2">Link works for
                  <select aria-label="Link expiry" value={days} onChange={(x) => setDays(Number(x.target.value))} className={field}>{DAYS.map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}</select>
                </label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={download} onChange={(x) => setDownload(x.target.checked)} />Allow download</label>
              </div>
              <button type="button" data-deliver onClick={() => void send()} disabled={busy || (!o.notifyClient && !o.notifyTeam)}
                className="justify-self-start rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white disabled:opacity-50">{busy ? "Checking the rights…" : "Make the link and open my mail app"}</button>
            </div>
          )}
          {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
          <h3 className="mb-1 mt-4 font-semibold">Deliveries of this reel</h3>
          {!o.deliveries?.length ? <p className="text-xs text-muted">None yet.</p> : (
            <ul className="grid gap-1 text-xs" aria-label="Deliveries">
              {o.deliveries.map((d) => (
                <li key={d.id} data-delivery={d.state} className="rounded-ctl border border-line px-2 py-1">
                  {new Date(d.created_at).toLocaleString()} · {d.requested_by_name} ·{" "}
                  {d.state === "BLOCKED" ? <span className="text-danger">blocked: {d.failure ?? "—"}</span> : "handed to the mail app"}
                  {d.recipient_email ? ` · ${d.recipient_name ?? ""} <${d.recipient_email}>` : ""}{d.team.length ? ` · team: ${d.team.map((t) => t.display_name).join(", ")}` : ""}
                  {d.link ? ` · link ${d.link.revoked ? "revoked" : d.link.expired ? "expired" : "active"}, opened ${d.link.opened}×` : ""}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-end"><Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">Close</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
