"use client";
/**
 * A shared reel (promise 10): what a person opening a share link sees, no sign-in. One video and nothing else of the organization. The
 * server checks the link and the video's rights on every opening; a revoked, expired or no-longer-shareable link says so plainly.
 * A link with a password asks for it (sent in the request body, never the address). A link that allows comments lists them and takes a
 * new one with the person's name, pinned to the moment in the video when they choose.
 * A link to a player report (ADR-056) shows the PDF in the page instead, with a download when the link allows it.
 */
import type { SharedComment, SharedView } from "@otsi-vie/contracts";
import { useParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";

const post = (path: string, json: unknown) => fetch(`/api/v1/public/share/${path}`, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });

export default function SharedReelPage() {
  const { t } = useLocale();
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<SharedView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** the link asks for a password: the field, the password that opened it, and why the last try failed */
  const [locked, setLocked] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const opened = useRef<string | null>(null);
  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    const r = await post(`${encodeURIComponent(token)}/open`, { password: pw }).catch(() => null);
    const body = await r?.json().catch(() => null);
    if (r?.ok) { opened.current = pw; setView(body as SharedView); setLocked(null); }
    else if (r?.status === 401 || r?.status === 429) setLocked(body?.message ?? t.body.auth.sharedPwWrong);
    else setProblem(body?.message ?? t.body.auth.sharedUnavailable);
  };
  useEffect(() => {
    let live = true;
    void fetch(`/api/v1/public/share/${encodeURIComponent(token)}`, { credentials: "omit" }).then(async (r) => {
      const body = await r.json().catch(() => null);
      if (!live) return;
      if (r.ok) setView(body as SharedView);
      else if (r.status === 401 && body?.code === "PASSWORD_REQUIRED") setLocked("");
      else if (r.status === 429) setLocked(body?.message ?? t.body.auth.sharedTooMany);
      else setProblem(r.status === 404 ? t.body.auth.sharedNoLink : body?.message ?? t.body.auth.sharedUnavailable);
    }, () => { if (live) setProblem(t.body.auth.sharedUnreachable); });
    return () => { live = false; };
  }, [token]);
  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-3 py-8" data-shared-page>
      <p className="flex items-center gap-2 t-small font-normal">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/otsi-mark.png" alt="" className="h-5 w-auto" draggable={false} />
        OTSI VIE · {view?.kind === "REPORT" ? t.body.auth.sharedReport : t.body.auth.sharedVideo}
      </p>
      {problem ? (
        <div role="alert" className="vie-panel p-6 t-body">{problem}</div>
      ) : locked !== null && !view ? (
        <form onSubmit={(e) => void unlock(e)} className="grid max-w-sm gap-2 vie-panel p-6 t-body" data-share-password>
          <label className="t-label grid gap-1">{t.body.auth.sharedProtected}
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" maxLength={128}
              className="rounded-ctl border border-line bg-canvas px-2 py-1.5 t-body text-ink outline-none focus:border-primary" aria-label={t.body.auth.sharedPasswordAria} />
          </label>
          {locked && <p role="alert" className="t-body text-danger">{locked}</p>}
          <button type="submit" disabled={!pw} className="vie-btn vie-btn-pri justify-self-start">{t.body.auth.sharedOpen}</button>
        </form>
      ) : !view ? (
        <p className="t-small">{t.body.auth.loading}</p>
      ) : (
        <>
          <h1 className="t-page">{view.title}</h1>
          {view.player_name && <p className="t-small">{view.player_name}</p>}
          {view.kind === "REPORT"
            ? <iframe data-shared-report src={view.url} title={view.player_name ? t.body.auth.sharedReportTitlePlayer.replace("{a}", view.player_name) : t.body.auth.sharedReportTitle} className="h-[80vh] w-full rounded-card border border-line bg-white" />
            : <Player view={view} token={token} password={opened.current} onComments={(comments) => setView({ ...view, comments })} />}
          <div className="flex flex-wrap items-center gap-3 t-small">
            {view.download_url && <a href={view.download_url} className="vie-btn vie-btn-sm">{t.body.auth.sharedDownload}</a>}
            {view.link_expires_at && <span>{t.body.auth.sharedValidUntil.replace("{a}", new Date(view.link_expires_at).toLocaleString())}</span>}
          </div>
          <p className="t-small">{view.notice}</p>
        </>
      )}
    </div>
  );
}
/** the shared video and, when the link allows it, its comments and a field to add one */
function Player({ view, token, password, onComments }: { view: SharedView; token: string; password: string | null; onComments: (c: SharedComment[]) => void }) {
  const { t } = useLocale();
  const ref = useRef<HTMLVideoElement>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [atNow, setAtNow] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const at = atNow && ref.current ? Math.round(ref.current.currentTime * 10) / 10 : null;
    const r = await post(`${encodeURIComponent(token)}/comments`, { password, name: name.trim(), body: text.trim(), at_s: at }).catch(() => null);
    const body = await r?.json().catch(() => null);
    setBusy(false);
    if (r?.ok) { setText(""); onComments(body as SharedComment[]); } else setErr(body?.message ?? t.body.auth.sharedCommentFailed);
  };
  const seek = (s: number) => { if (ref.current) { ref.current.currentTime = s; void ref.current.play().catch(() => undefined); } };
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <>
      <video ref={ref} data-shared-video src={view.url} controls playsInline className="w-full rounded-card bg-black" />
      {view.can_comment && (
        <section aria-label={t.body.auth.sharedComments} className="grid gap-2 vie-panel p-4 t-body" data-shared-comments={String(view.comments.length)}>
          <h2 className="t-section">{t.body.auth.sharedComments}</h2>
          {!view.comments.length ? <p className="t-small">{t.body.auth.sharedNoComments}</p> : (
            <ul className="grid gap-2">
              {view.comments.map((c) => (
                <li key={c.id}>
                  <span className="font-normal">{c.name}</span>
                  {c.at_s !== null && <button type="button" onClick={() => seek(c.at_s!)} className="ml-1 t-small text-primary">{t.body.auth.sharedAt.replace("{a}", clock(c.at_s))}</button>}
                  <span className="t-small"> · {new Date(c.created_at).toLocaleString()}</span>
                  <p>{c.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(e) => void send(e)} className="grid gap-2 border-t border-line pt-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t.body.auth.sharedYourName} aria-label={t.body.auth.sharedYourName} className="rounded-ctl border border-line bg-canvas px-2 py-1.5 outline-none focus:border-primary" />
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={255} rows={2} placeholder={t.body.auth.sharedYourComment} aria-label={t.body.auth.sharedYourComment} className="rounded-ctl border border-line bg-canvas px-2 py-1.5 outline-none focus:border-primary" />
            <label className="flex items-center gap-2 t-small"><input type="checkbox" checked={atNow} onChange={(e) => setAtNow(e.target.checked)} />{t.body.auth.sharedPin}</label>
            {err && <p role="alert" className="t-small text-danger">{err}</p>}
            <button type="submit" disabled={busy || !name.trim() || !text.trim()} className="vie-btn vie-btn-pri vie-btn-sm justify-self-start">{busy ? t.body.auth.sharedSending : t.body.auth.sharedSend}</button>
          </form>
        </section>
      )}
    </>
  );
}
