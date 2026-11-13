"use client";
/**
 * A shared reel (promise 10, SOT Pages 25-26): what a person opening a share link sees, no sign-in. One video
 * and nothing else of the organization. The server checks the link and the video's rights on every opening; a
 * revoked, expired or no-longer-shareable link says so plainly.
 * A link with a password asks for it (sent in the request body, never the address) — the gate is the SOT's
 * centred panel. A link that allows comments lists them in the aside and takes a new one with the person's
 * name, pinned to the moment the video is at. A link to a player report (ADR-056) shows the PDF in the page
 * instead, with a download when the link allows it.
 * The organisation name and the expiry come from the gate endpoint (GET /v1/public/share/:token/gate —
 * ShareGate: organization_name, expires_at, has_password) and from the opened view (SharedView.organization_name);
 * the player line is the player's name plus "#4 · DM · FC Ercakhu" from the view's player_jersey_number /
 * player_position / player_club. Until the server returns them, the gate keeps the generic line and no expiry,
 * and the player line is the name alone — nothing is invented. A bad link shows the OTSI logo over the message.
 */
import type { ShareGate, SharedComment, SharedView } from "@otsi-vie/contracts";
import { ClipboardList, Download, FileText, Film, MessageSquare } from "lucide-react";
import { useParams } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { VideoPlayer, clock } from "@/components/media/VideoPlayer";

const post = (path: string, json: unknown) => fetch(`/api/v1/public/share/${path}`, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
const formatOf = (mime: string | null) => (mime?.includes("quicktime") ? "MOV" : mime?.includes("pdf") ? "PDF" : "MP4");

export default function SharedReelPage() {
  const { t } = useLocale();
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<SharedView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** the link asks for a password: the field, the password that opened it, and why the last try failed */
  const [locked, setLocked] = useState<string | null>(null);
  /** what the gate may show before the link is opened (ShareGate): the organisation and the expiry */
  const [gate, setGate] = useState<ShareGate | null>(null);
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
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
    // the gate is a separate, no-sign-in read (GET /v1/public/share/:token/gate): the organisation and the
    // expiry before the link is opened. A failed gate read is not fatal — the open below says what is wrong.
    void fetch(`/api/v1/public/share/${encodeURIComponent(token)}/gate`, { credentials: "omit" }).then(async (r) => {
      if (!live || !r.ok) return;
      setGate(await r.json().catch(() => null) as ShareGate);
    }, () => undefined);
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

  if (problem) {
    return (
      <div className="grid min-h-screen place-items-center p-8" data-shared-page>
        <div role="alert" className="panel flex w-full max-w-[400px] flex-col gap-4 p-8 t-body">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/otsi-logo.png" alt="OTSI" className="h-[30px] w-auto self-start" draggable={false} />
          {problem}
        </div>
      </div>
    );
  }

  if (locked !== null && !view) {
    return (
      <div className="grid min-h-screen place-items-center p-8" data-shared-page>
        <form onSubmit={(e) => void unlock(e)} className="panel flex w-full max-w-[400px] flex-col gap-[18px] p-8" aria-labelledby="pl" data-share-password>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/otsi-logo.png" alt="OTSI" className="h-[30px] w-auto self-start" draggable={false} />
          <div className="flex flex-col gap-1.5">
            <h1 id="pl" className="h1">{t.body.auth.sharedGateTitle}</h1>
            <p className="sub sm">{gate?.organization_name && t.body.auth.sharedGateDescOrg
              ? t.body.auth.sharedGateDescOrg.replace("{a}", gate.organization_name)
              : t.body.auth.sharedGateDesc}</p>
          </div>
          <div className="field">
            <label className="lab" htmlFor="lp">{t.body.auth.password}</label>
            <div className="relative">
              <input id="lp" type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" maxLength={128}
                className="in" style={{ height: 42, paddingRight: 64 }} aria-label={t.body.auth.sharedPasswordAria} />
              <button type="button" className="btn sm gh absolute right-1 top-[6px] h-[30px]" aria-label={showPw ? t.body.auth.hidePassword : t.body.auth.showPassword}
                aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>
                {showPw ? (t.body.auth.hideShort ?? t.body.auth.hidePassword) : (t.body.auth.showShort ?? t.body.auth.showPassword)}
              </button>
            </div>
          </div>
          {locked && <p role="alert" className="t-body text-danger">{locked}</p>}
          <button className="btn pri lg w" type="submit" disabled={!pw}>{t.body.auth.sharedOpen}</button>
          {gate?.expires_at && (
            <p className="sm mu text-center">{t.body.auth.sharedExpires.replace("{a}", new Date(gate.expires_at).toLocaleDateString(undefined, { dateStyle: "medium" }))}</p>
          )}
        </form>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="grid min-h-screen place-items-center p-8" data-shared-page>
        <p className="t-small">{t.body.auth.loading}</p>
      </div>
    );
  }

  return <SharedViewPage view={view} token={token} password={opened.current} onComments={(comments) => setView({ ...view, comments })} />;
}

function SharedViewPage({ view, token, password, onComments }: { view: SharedView; token: string; password: string | null; onComments: (c: SharedComment[]) => void }) {
  const { t } = useLocale();
  const a = t.body.auth;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [now, setNow] = useState(0);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const at = Math.round(now * 10) / 10;
    const r = await post(`${encodeURIComponent(token)}/comments`, { password, name: name.trim(), body: text.trim(), at_s: at }).catch(() => null);
    const body = await r?.json().catch(() => null);
    setBusy(false);
    if (r?.ok) { setText(""); onComments(body as SharedComment[]); } else setErr(body?.message ?? a.sharedCommentFailed);
  };
  const seek = (s: number) => { if (videoRef.current) { videoRef.current.currentTime = s; void videoRef.current.play().catch(() => undefined); } };
  const expires = view.link_expires_at ? new Date(view.link_expires_at).toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
  /** the SOT's player line: name + "#4 · DM · FC Ercakhu" — the shirt, position and club from the player's own profile */
  const playerLine = [view.player_jersey_number != null ? `#${view.player_jersey_number}` : null, view.player_position, view.player_club]
    .filter(Boolean).join(" · ");

  return (
    <div className="flex min-h-screen flex-col" data-shared-page>
      <header className="flex min-h-[60px] flex-wrap items-center gap-4 border-b border-line bg-p0 px-7 py-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/otsi-logo.png" alt="OTSI" className="h-[26px] w-auto" draggable={false} />
        <span className="h-[22px] w-px bg-line2" aria-hidden />
        <span className="sm sub">{view.organization_name && a.sharedByOrgName
          ? a.sharedByOrgName.replace("{a}", view.organization_name)
          : a.sharedByOrg}</span>
        <span className="flex-1" />
        {expires && <span className="sm mu">{a.sharedExpires.replace("{a}", expires)}</span>}
        {view.download_url && <a href={view.download_url} className="btn pri"><Download className="h-4 w-4" aria-hidden />{a.sharedDownload}</a>}
      </header>

      <div className="flex flex-1 flex-wrap">
        <main className="flex min-w-0 flex-1 flex-col items-center gap-4 px-7 py-6">
          <div className="flex w-full max-w-[900px] flex-col gap-1.5">
            <span className="eb">{a.sharedPack}</span>
            <h1 className="h1">{view.title}</h1>
            {view.player_name && <span className="sm mu">{view.player_name}{playerLine ? ` · ${playerLine}` : ""}</span>}
          </div>
          <div className="w-full max-w-[900px]">
            {view.kind === "REPORT" ? (
              <iframe data-shared-report src={view.url} title={view.player_name ? a.sharedReportTitlePlayer.replace("{a}", view.player_name) : a.sharedReportTitle}
                className="h-[80vh] w-full rounded-card border border-line bg-white" />
            ) : (
              <VideoPlayer src={view.url} label={view.title} allowLocal videoRef={videoRef} onTime={setNow}
                empty={{ title: a.sharedNoFootageSot, body: a.sharedNoFootageBody }} />
            )}
          </div>
          <div className="grid w-full max-w-[900px] grid-cols-3 gap-2.5 max-md:grid-cols-1">
            <div className="flex min-w-0 items-center gap-3 border-t border-line bg-transparent px-1 py-3.5">
              <Film className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span className="flex-1"><span className="block font-medium">{a.sharedReel}</span>
                <span className="sm mu">{view.kind === "VIDEO" ? formatOf(view.mime) : a.sharedReportNotIncluded}</span></span>
              {view.kind === "VIDEO" && view.download_url && (
                <a href={view.download_url} className="ib" aria-label={a.sharedDownloadReel}><Download className="h-4 w-4" aria-hidden /></a>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-3 border-t border-line bg-transparent px-1 py-3.5">
              <FileText className="h-5 w-5 shrink-0 text-[#4F9DFF]" aria-hidden />
              <span className="flex-1"><span className="block font-medium">{a.sharedReportTitle}</span>
                <span className="sm mu">{view.kind === "REPORT" ? formatOf(view.mime) : a.sharedReportNotIncluded}</span></span>
              {view.kind === "REPORT" && view.download_url && (
                <a href={view.download_url} className="ib" aria-label={a.sharedDownload}><Download className="h-4 w-4" aria-hidden /></a>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-3 border-t border-line bg-transparent px-1 py-3.5">
              <ClipboardList className="h-5 w-5 shrink-0 text-amber" aria-hidden />
              <span className="flex-1"><span className="block font-medium">{t.body.reports.rpAiBrief}</span>
                <span className="sm mu">{a.sharedBriefNotIncluded}</span></span>
            </div>
          </div>
          <p className="t-small w-full max-w-[900px]">{view.notice}</p>
        </main>

        {view.can_comment && (
          <aside className="flex w-[360px] max-w-full shrink-0 flex-col border-l border-line bg-p0 max-md:w-full max-md:border-l-0 max-md:border-t" aria-label={a.sharedComments}>
            <div className="ph"><h2 className="h3">{a.sharedComments}</h2><span className="mu xs">{view.comments.length}</span></div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3.5">
              {view.comments.length === 0 ? (
                <div className="empty flex-1">
                  <span className="ei"><MessageSquare className="i" aria-hidden /></span>
                  <h3>{a.sharedNoComments}</h3>
                  <p>{a.sharedCommentsPinned}</p>
                </div>
              ) : (
                <ul className="grid gap-2">
                  {view.comments.map((c) => (
                    <li key={c.id} className="rounded-ctl border border-line bg-canvas px-3 py-2">
                      <span className="font-normal">{c.name}</span>
                      {c.at_s !== null && <button type="button" onClick={() => seek(c.at_s!)} className="ml-1 t-small text-primary">{a.sharedAt.replace("{a}", clock(c.at_s))}</button>}
                      <span className="t-small"> · {new Date(c.created_at).toLocaleString()}</span>
                      <p className="t-body mt-0.5">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <form onSubmit={(e) => void send(e)} className="flex flex-col gap-2.5 border-t border-line bg-p0 p-3.5">
              <div className="field">
                <label className="lab" htmlFor="cn">{a.sharedYourName}</label>
                <input id="cn" className="in" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={a.sharedNameShown} />
              </div>
              <div className="field">
                <label className="lab" htmlFor="cm">{a.sharedCommentAt.replace("{a}", clock(now))}</label>
                <textarea id="cm" className="in" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={255} placeholder={a.sharedCommentPlaceholder} />
              </div>
              {err && <p role="alert" className="t-small text-danger">{err}</p>}
              <button type="submit" disabled={busy || !name.trim() || !text.trim()} className="btn pri w">{busy ? a.sharedSending : a.sharedPostComment}</button>
            </form>
          </aside>
        )}
      </div>

      <footer className="border-t border-line bg-p0 px-7 py-3 sm mu">{a.sharedMeasuredFooter}</footer>
    </div>
  );
}
