"use client";
/**
 * SOT UI rebuild Page 15 of 31: Media — upload & ingest.
 *
 * The SOT's Media page is two columns: the centre (drop zone, tier alert + tier cards, add from a link, ingest queue) and a right
 * inspector (ingest settings: analysis profile, visual filters / overlays / ingest switches, footage rights, link to match, and the
 * token cost + Start analysis footer). The data layer is the same UploadWorkspace (useUpload: projects, resumable uploads, link import,
 * videos with measured facts) + Page02Controller (usePage02: the viewer's ingest preferences, the chosen match, the status line).
 *
 * What maps where, and what does not (read before editing):
 *   - Drop zone: the DropZone logic (file drop + browse, MP4/MOV + tier-limit check before any byte is sent). The tier note and chip use
 *     the real plan limit (useTierLimit: the approved per-plan limit per video, capped by the server's own limit).
 *   - Tier alert: the data layer's `error` (a file too large for the tier, or the wrong type), shown as the SOT's danger alert. The error
 *     is one string ("Title. Body"), split on the first ". " for the alert's title and body. Dismiss hides it for this visit; a new
 *     error shows again.
 *   - Plan row: every plan with its limit per video (approved price list, 2026-11-13); the caller's plan is highlighted.
 *   - Add from a link: the UrlImport logic (URL input, the provider policy, the access token for Vimeo / Google Drive). The Accepted /
 *     Refused chips are short labels for the IMPORT_PROVIDERS policy (supported + needs_authorization = Accepted; unsupported = Refused,
 *     struck through). Owner 2026-11-13 (ADR-145): "The app should be able to accept all links especially YouTube and VK" — every video
 *     site is now Accepted (video-page links go through the yt-dlp extractor), plus "Any other video page"; the Refused column shows only
 *     while the policy still refuses something (nothing at present), so the SOT's struck-through YouTube/Facebook/… chips are gone.
 *   - Ingest queue: the transfers in progress (top) + the videos (newest first). File / Size / Duration / Match / Rights / Status.
 *     Duration is "—" until the media probe measures it. Match is the linked match's title, "—" when unlinked. Rights is the recorded
 *     grant's uses (GET /v1/videos/:id/rights), "—" until read. Status is the video's real state (videoStatusText).
 *   - Analysis profile: the ProfileCard choices (Recommended / Standard / High Accuracy / Ultra-Sensitive) + the viewer's preference.
 *     Choosing one sets Stabilize the same way ProfileCard does (High accuracy and Ultra-sensitive stabilise; Standard does not).
 *   - Visual filters / Overlays / Ingest switches: the IngestConfigPanel toggle rows, as three expandable rows. The status is Off when
 *     nothing in the group is on, Defaults when the ingest group is at its defaults. A "not built" switch that is on says
 *     "saved · not performed yet" (the engine cannot do the step yet), exactly as the old panel did.
 *   - Footage rights: the SOT's inline rights (holder name + basis + a minor switch). The engine's rights are the four questions
 *     (UploadRights: analyse / share / download / guardian consent). This section maps to them as: analyse yes, share and download no
 *     (internal only; sharing is decided in Export), guardian consent PENDING when a minor appears, NOT_APPLICABLE otherwise, confirmed.
 *     The holder name and basis are the person's declaration of entitlement; the API's UploadRights carries no holder/basis field, so
 *     they are kept in this page's state and shown in the summary, not sent to the server. When the holder and basis are filled, the
 *     rights are recorded for the next upload or import (setRights), which also starts any files waiting on them.
 *   - Link to match: the matches + the chosen match (usePage02.chooseMatch). "Create a new match…" opens the MatchLinker for the
 *     selected video; with no video selected it links the match to the next upload.
 *   - Start analysis: POST /v1/videos/:id/analysis-runs with the chosen profile. Recommended starts with Standard (the server's
 *     automatic analysis is the one that uses the footage check's recommendation). Disabled until a video is selected and the rights are
 *     recorded; the title says so.
 *
 * The old three-column Upload page (UploadHeaderSection, DropZoneSection, UrlInputSection, SupportedFormatsSection,
 * PipelinePreviewSection, RecentUploadsSection, SelectedPreviewSection, MatchContextSection, IngestConfigPanel, ProfileCard's ThisVideo
 * and the rights dialog) is NOT routed by /upload any more; the files stay in the repo. The UploadRightsDialog is still rendered here,
 * because a file dropped while Send to Analysis is on still needs the four questions answered before it uploads.
 */
import { AlertTriangle, ChevronRight, Download, Film, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACCEPTED_EXTENSIONS, IMPORT_PROVIDERS, type AnalysisProfile, type AnalysisRun, type Match, type UploadProfile, type UploadRights, type Video, type VideoRights } from "@otsi-vie/contracts";
import { api, ApiProblem } from "@/lib/api";
import { fill } from "@/lib/fill";
import { formatBytes, formatDuration } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { formatGB, PLAN_LIMITS, useTierLimit } from "@/lib/uploadTier";
import { MatchLinker } from "@/components/matches/MatchPanels";
import { usePage02 } from "./page02";
import { rowsFor, ToggleRow } from "./IngestConfigPanel";
import { profileLabel } from "./ProfileCard";
import { UploadRightsDialog, rightsSummary } from "./RightsDialog";
import { useUpload, videoStatusText } from "./UploadWorkspace";

const ACCEPT = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",");

/** the SOT's short chip labels for each import provider (the policy's names are longer) */
const PROVIDER_LABEL: Record<string, string[]> = {
  direct: ["Direct link"], hls: ["HLS stream"], wikimedia: ["Wikimedia"], archive_org: ["Internet Archive"], dropbox: ["Dropbox"],
  vimeo: ["Vimeo · your token"], google_drive: ["Google Drive · your token"],
  youtube: ["YouTube"], vk: ["VK"], rutube: ["Rutube"], ok_ru: ["OK.ru"], facebook_instagram: ["Facebook", "Instagram"], tiktok: ["TikTok"],
  x_twitter: ["X"], twitch: ["Twitch"], dailymotion: ["Dailymotion"], hudl_wyscout_veo: ["Hudl", "Wyscout", "Veo"], onedrive: ["OneDrive"],
  streamable: ["Streamable"],
};

/** the profile a manual Start analysis posts: Recommended has no concrete profile, so it starts with Standard (the server's automatic
    analysis is the one that uses the footage check's recommendation) */
const startProfile = (p: UploadProfile): AnalysisProfile =>
  p === "STANDARD" ? "STANDARD" : p === "HIGH_ACCURACY" ? "HIGH_ACCURACY" : p === "ULTRA_SENSITIVE" ? "ULTRA_SENSITIVE" : "STANDARD";

/** "Title. Body" -> [title, body] (the data layer's error is one string) */
const splitError = (e: string): [string, string] => {
  const i = e.indexOf(". ");
  return i < 0 ? [e, ""] : [e.slice(0, i + 1), e.slice(i + 2)];
};

export function MediaStage() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const up = useUpload();
  const { prefs, setPrefs, say, matches, matchId, chooseMatch, note } = usePage02();
  const tierLimit = useTierLimit();
  const tier = tierLimit?.plan ?? "FREE";
  const tierBytes = tierLimit?.maxBytes ?? PLAN_LIMITS[0]!.bytes!;
  const tierName = tierLimit?.tier ?? PLAN_LIMITS[0]!.label;   // the plan's name ("Free", "Club"), never its code
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<"visual" | "overlays" | "ingest" | null>(null);
  const [holder, setHolder] = useState("");
  const [basis, setBasis] = useState<"" | "OWN" | "LICENSED" | "PERMISSION">("");
  const [minor, setMinor] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [startBusy, setStartBusy] = useState(false);
  const [startMsg, setStartMsg] = useState<string | null>(null);
  const [rightsByVideo, setRightsByVideo] = useState<Record<string, string>>({});

  /* the tier alert: a new error shows again even after one was dismissed */
  const error = up.error && dismissed !== up.error ? up.error : null;
  useEffect(() => { if (up.error) setDismissed(null); }, [up.error]);

  /* the SOT's inline rights -> the engine's UploadRights (see the header comment) */
  const rightsRecorded = holder.trim().length >= 2 && basis !== "";
  const mappedRights: UploadRights | null = rightsRecorded
    ? { analyse: true, share: false, download: false, guardian_consent: minor ? "PENDING" : "NOT_APPLICABLE", confirm: true }
    : null;
  const rightsKey = mappedRights ? `${holder.trim()}|${basis}|${minor}` : "";
  const lastRights = useRef("");
  useEffect(() => {
    if (!mappedRights || rightsKey === lastRights.current) return;
    lastRights.current = rightsKey;
    up.setRights(mappedRights);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightsKey]);

  /* the queue: transfers in progress, then the videos newest first */
  const queueVideos = useMemo(() => [...(up.videos ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 12), [up.videos]);
  useEffect(() => {
    let live = true;
    void Promise.all(queueVideos.map(async (v) => {
      try { const r = await api<VideoRights>(`/v1/videos/${v.id}/rights`); return [v.id, r] as const; } catch { return null; }
    })).then((rows) => {
      if (!live) return;
      setRightsByVideo((cur) => {
        const next = { ...cur };
        for (const row of rows) {
          if (!row) continue;
          const [id, r] = row;
          next[id] = "grant" in r && r.grant ? r.grant.allowed_uses.join(", ") : d.viewOnly;
        }
        return next;
      });
    });
    return () => { live = false; };
  }, [queueVideos, d]);
  const matchTitle = (id: string | null | undefined) => (id ? matches?.find((m) => m.id === id) : null);
  const matchName = (m: Match | null | undefined) => (m ? `${m.home?.name ?? "?"} vs ${m.away?.name ?? "?"}` : "—");
  const queueCount = up.transfers.length + queueVideos.length;

  /* the profile choices in this language (the contract labels stay; only the Recommended words are translated) */
  const choices: [UploadProfile, string, string][] = [
    ["RECOMMENDED", d.recommended, d.mdRecommendedWhy],
    ["STANDARD", d.mdProfileStandard, d.mdStandardWhy],
    ["HIGH_ACCURACY", d.mdProfileHighAcc, d.mdHighAccWhy],
    ["ULTRA_SENSITIVE", d.mdProfileUltra, d.mdUltraWhy],
  ];
  const chooseProfile = (p: UploadProfile) => {
    setPrefs({ ...prefs, profile: p, stabilize: p === "RECOMMENDED" ? prefs.stabilize : p !== "STANDARD" });
    say(d.analysisProfileNextSay.replace("{label}", profileLabel(p, d)));
  };

  /* the three switch groups, and whether each is off / at its defaults */
  const groups = rowsFor(d);
  const groupOn = (list: ReturnType<typeof rowsFor>["visual"]) =>
    list.some(([label, kind, , pref]) => (kind === "always" ? false : pref ? prefs[pref] : false));
  const ingestDefaults = !prefs.autoMatch && !prefs.highlights;
  const groupRows = (key: "visual" | "overlays" | "ingest") => {
    const list = groups[key];
    return list.map(([label, kind, why, pref]) => (
      <ToggleRow key={label} label={label} kind={kind} why={why} say={say} on={pref ? prefs[pref] : kind === "always"}
        {...(pref ? { onToggle: () => {
          const next = { ...prefs, [pref]: !prefs[pref] };
          if (pref === "stabilize" && prefs.profile !== "RECOMMENDED") next.profile = next.stabilize ? (prefs.profile === "STANDARD" ? "HIGH_ACCURACY" : prefs.profile) : "STANDARD";
          setPrefs(next);
        } } : {})} />
    ));
  };

  /* Start analysis on the selected video */
  const canStart = !!up.selected && !!mappedRights && up.selected.state === "INGESTED";
  const start = async () => {
    if (!up.selected || !canStart) return;
    setStartBusy(true); setStartMsg(null);
    try {
      const run = await api<AnalysisRun>(`/v1/videos/${up.selected.id}/analysis-runs`, { method: "POST", json: { profile: startProfile(prefs.profile) } });
      setStartMsg(d.analysisStartedServer.replace("{name}", up.selected.title ?? up.selected.original_filename ?? d.thisVideo));
      void up.reloadVideos();
      void api<AnalysisRun[]>(`/v1/videos/${up.selected.id}/analysis-runs`).catch(() => undefined);
      void run;
    } catch (x) { setStartMsg(x instanceof ApiProblem ? x.message : d.couldNotStartCheck); }
    finally { setStartBusy(false); }
  };

  /* the link import (the UrlImport logic, in the SOT's panel) */
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const provider = useMemo(() => {
    try { const u = new URL(url.trim()); return IMPORT_PROVIDERS.find((p) => p.hosts.some((x) => u.hostname.toLowerCase() === x || u.hostname.toLowerCase().endsWith(`.${x}`))) ?? IMPORT_PROVIDERS.find((p) => p.id === (u.pathname.toLowerCase().endsWith(".m3u8") ? "hls" : "direct"))!; }
    catch { return null; }
  }, [url]);
  const accepted = IMPORT_PROVIDERS.filter((p) => p.status !== "unsupported");
  // the SOT's Refused list shows only YouTube, Facebook, TikTok, X, Twitch, Hudl and Wyscout — Dailymotion, OneDrive /
  // SharePoint and Streamable are refused by the policy but are not chips here (a pasted link from one still shows the refusal).
  const refused = IMPORT_PROVIDERS.filter((p) => p.status === "unsupported");

  const [title, body] = error ? splitError(error) : ["", ""];

  return (
    <div className="flex min-h-0 flex-1" data-page="upload" data-stage>
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto px-8 py-5">
        <div className="flex flex-col gap-1.5">
          <span className="eb">{d.mediaEyebrow}</span>
          <h1 className="h1">{d.mdAddMatchVideos}</h1>
        </div>

        {/* drop zone: the SOT's is a dashed outline only, no filled background */}
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-dashed border-line2 px-5 py-4"
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) up.addFiles(e.dataTransfer.files); }}
          style={over ? { borderColor: "rgb(var(--primary))", background: "rgba(43,212,176,.06)" } : undefined}>
          <span className="grid h-12 w-12 place-items-center rounded-xl border border-line2 bg-[rgb(var(--raised))] text-[rgb(var(--primary))]">
            <Download className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="h2">{d.mdDropVideos}</div>
            <div className="sm mu">{fill(d.mdDropSub, { a: tierName, b: formatGB(tierBytes) })}</div>
          </div>
          {/* the tier note is plain text (SOT), not a chip */}
          <span className="t-small text-muted">{fill(d.mdTierChip, { a: tierName, b: formatGB(tierBytes) })}</span>
          {up.canWrite && (
            <button type="button" disabled={!up.projectId} onClick={() => input.current?.click()} className="vie-btn vie-btn-pri">{d.mdBrowseFiles}</button>
          )}
          <input ref={input} type="file" accept={ACCEPT} multiple hidden aria-label={d.videoFilesLabel}
            onChange={(e) => { if (e.target.files?.length) up.addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {!up.canWrite && <p className="text-sm text-muted">{d.viewVideosOnly}</p>}

        {/* tier alert (a file too large, or the wrong type) */}
        {error && (
          <div role="alert" className="alert">
            <AlertTriangle className="i h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="block font-normal">{title}</span>
              <span className="sm block text-ink2">{body}</span>
            </div>
            <button type="button" aria-label={dict.common.close} onClick={() => setDismissed(error)} className="vie-ib h-7 w-7 shrink-0"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* tier row: the SOT's is one plain row, not three cards; regular type throughout */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          {/* every plan's limit per video, from the approved price list (owner 2026-11-13); the caller's plan is marked */}
          {PLAN_LIMITS.map((t) => (
            <span key={t.code} className={t.code === tier ? undefined : "text-muted"} data-plan-limit={t.code}>
              <span>{t.label}</span> · <span>{t.bytes === null ? dict.body.wallet.blNoPlanLimit : formatGB(t.bytes)}</span>
              {t.code === tier && <span className="text-muted"> {d.mdYourTier}</span>}
            </span>
          ))}
        </div>

        {/* add from a link: a flat open section (SOT), not a boxed panel */}
        <section aria-labelledby="md-link" style={{ background: "transparent", border: 0, borderTop: "1px solid rgb(var(--line))", borderRadius: 0 }}>
          <div className="vie-ph"><h2 id="md-link" className="h3">{d.mdAddFromLink}</h2></div>
          <div className="flex flex-col gap-3.5 p-3.5">
            <form className="flex flex-wrap gap-2" onSubmit={(e) => {
              e.preventDefault();
              setLinkBusy(true); setLinkMsg(null);
              void up.importLink(url, provider?.status === "needs_authorization" ? token : undefined).then(
                () => { setUrl(""); setToken(""); setLinkMsg({ ok: true, text: d.importStarted }); },
                (x) => setLinkMsg({ ok: false, text: x instanceof ApiProblem ? x.message : d.couldNotStartImport }),
              ).finally(() => setLinkBusy(false));
            }}>
              <label htmlFor="md-url" className="sr-only">{d.videoUrl}</label>
              <input id="md-url" value={url} onChange={(e) => setUrl(e.target.value)} type="url" required placeholder={d.mdLinkPh}
                aria-label={d.videoUrl} className="in mono min-w-0 flex-1 text-xs" />
              <button type="submit" disabled={linkBusy || !up.projectId || provider?.status === "unsupported" || !up.canWrite}
                className="vie-btn disabled:opacity-50">{linkBusy ? dict.common.loading : d.mdAddLink}</button>
            </form>
            {provider && url.length > 10 && (
              <div data-provider={provider.id} data-provider-status={provider.status}
                className={`rounded-ctl border p-2 text-xs ${provider.status === "unsupported" ? "border-danger/40 bg-danger/10" : "border-line bg-raised/40"}`}>
                <p className="font-normal">{provider.name}: {provider.status === "supported" ? d.providerCanImport : provider.status === "needs_authorization" ? d.providerNeedsAuth : d.providerCannotImport}</p>
                <p className="mt-0.5 text-muted">{provider.status === "unsupported" ? `${provider.reason} ${provider.alternative}` : provider.method}</p>
                {provider.status === "needs_authorization" && (
                  <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" required minLength={8}
                    placeholder={d.yourAccessToken.replace("{name}", provider.name)} aria-label={d.accessToken}
                    className="mt-2 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm" />
                )}
              </div>
            )}
            {linkMsg && <p role={linkMsg.ok ? "status" : "alert"} className={`text-xs ${linkMsg.ok ? "text-ok" : "text-danger"}`}>{linkMsg.text}</p>}
            <div className={`grid gap-4 ${refused.length ? "md:grid-cols-2" : ""}`}>
              <div className="flex flex-col gap-2" data-link-accepted>
                <span className="eb">{d.mdAccepted}</span>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                  {accepted.flatMap((p) => (PROVIDER_LABEL[p.id] ?? [p.name]).map((label) => <span key={`${p.id}-${label}`} className="t-small">{label}</span>))}
                  <span className="t-small text-muted">{d.mdAnyVideoPage}</span>
                </div>
              </div>
              {refused.length > 0 && <div className="flex flex-col gap-2" data-link-refused>
                <span className="eb">{d.mdRefused}</span>
                <div className="flex flex-wrap gap-1.5">
                  {refused.flatMap((p) => (PROVIDER_LABEL[p.id] ?? [p.name]).map((label) => (
                    <span key={`${p.id}-${label}`} className="t-small" style={{ color: "rgb(var(--muted))", textDecoration: "line-through" }}>{label}</span>
                  )))}
                </div>
              </div>}
            </div>
          </div>
        </section>

        {/* ingest queue: a flat open section (SOT), not a boxed panel */}
        <section className="flex flex-1 flex-col" aria-labelledby="md-queue" style={{ background: "transparent", border: 0, borderTop: "1px solid rgb(var(--line))", borderRadius: 0 }}>
          <div className="vie-ph"><h2 id="md-queue" className="h3">{d.mdIngestQueue}</h2><span className="mu xs">{fill(d.mdQueueCount, { a: String(queueCount) })}</span></div>
          <div className="overflow-x-auto">
            <div className="eb grid min-w-[760px] grid-cols-[minmax(220px,2fr)_90px_90px_minmax(140px,1fr)_110px_100px] gap-3 border-b border-line px-3" style={{ height: 32, alignItems: "center" }}>
              <span>{d.mdQueueFile}</span><span>{d.mdQueueSize}</span><span>{d.duration}</span><span>{dict.body.analysis.match}</span><span>{d.mdQueueRights}</span><span>{d.mdQueueStatus}</span>
            </div>
            {queueCount === 0 && (
              <div className="empty" style={{ padding: 32 }}>
                <span className="ei"><Film className="h-5 w-5" /></span>
                <h3>{d.mdNoVideos}</h3>
                <p>{d.mdDropOrPaste}</p>
              </div>
            )}
            {up.transfers.map((t) => {
              const pct = t.progress ? Math.floor((100 * t.progress.sentBytes) / t.progress.totalBytes) : 0;
              return (
                <div key={t.id} className="grid min-w-[760px] grid-cols-[minmax(220px,2fr)_90px_90px_minmax(140px,1fr)_110px_100px] gap-3 border-b border-line/60 px-3 py-2" data-transfer-state={t.state}>
                  <span className="min-w-0 truncate text-sm font-normal">{t.file.name}</span>
                  <span className="sm mu">{formatBytes(t.file.size)}</span>
                  <span className="sm mu">—</span>
                  <span className="sm mu truncate">{matchName(matchTitle(matchId))}</span>
                  <span className="sm mu truncate">{mappedRights ? rightsSummary(mappedRights, d) : "—"}</span>
                  <span className="sm">{t.state === "done" ? d.uploadedVerifying : t.state === "paused" ? d.pausedAt.replace("{n}", String(pct)) : t.state === "error" ? (t.error ?? d.uploadStopped) : d.uploadingPct.replace("{n}", String(pct))}</span>
                </div>
              );
            })}
            {queueVideos.map((v) => {
              const s = videoStatusText(v, d);
              return (
                <div key={v.id} className="grid min-w-[760px] grid-cols-[minmax(220px,2fr)_90px_90px_minmax(140px,1fr)_110px_100px] gap-3 border-b border-line/60 px-3 py-2">
                  <button type="button" onClick={() => up.select(v.id)} className="min-w-0 truncate text-left text-sm font-normal hover:underline">{v.title ?? v.original_filename}</button>
                  <span className="sm mu">{v.byte_size ? formatBytes(v.byte_size) : "—"}</span>
                  <span className="sm mu">{formatDuration(v.duration_us)}</span>
                  <span className="sm mu truncate">{matchName(matchTitle(v.match_id))}</span>
                  <span className="sm mu truncate">{rightsByVideo[v.id] ?? "—"}</span>
                  <span className="sm" data-video-state={v.state}>{s.label}</span>
                </div>
              );
            })}
          </div>
        </section>
        {note && <p role="status" className={`text-sm ${note.bad ? "text-danger" : "text-amber"}`}>{note.text}</p>}
      </main>

      {/* ingest settings inspector */}
      <aside className="insp" aria-label={d.mdIngestSettings}>
        <div className="vie-ph" style={{ minHeight: 44 }}><h2 className="h3">{d.mdIngestSettings}</h2><span className="mu xs">{d.mdAppliesQueued}</span></div>

        <div className="sect">
          <span className="eb">{d.mdAnalysisProfile}</span>
          <div role="radiogroup" aria-label={d.analysisProfileNext} className="flex flex-col gap-1">
            {choices.map(([k, label, why]) => {
              const on = prefs.profile === k;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => chooseProfile(k)} data-profile={k} title={why}
                  className={`radio ${on ? "on" : ""}`} style={{ padding: "9px 10px", alignItems: "center" }}>
                  <span className="o" style={{ margin: 0 }} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-normal">{label}{k === "RECOMMENDED" && <span className="mu xs font-normal"> {d.mdRecommendedDefault}</span>}</span>
                    <span className="mu xs block">{why}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="sect" style={{ gap: 0, padding: "4px 0" }}>
          {([
            ["visual", d.mdVisualFilters, groupOn(groups.visual) ? d.toggleOn : d.mdOff],
            ["overlays", d.tabOverlays, groupOn(groups.overlays) ? d.toggleOn : d.mdOff],
            ["ingest", d.mdIngestSwitches, ingestDefaults ? d.mdDefaults : d.toggleOn],
          ] as const).map(([key, label, status]) => (
            <div key={key}>
              <button type="button" aria-expanded={openGroup === key} onClick={() => setOpenGroup(openGroup === key ? null : key)}
                className="lr flex w-full items-center gap-2 border-b border-line bg-transparent px-3.5 text-left" style={{ minHeight: 36 }}>
                <span className="min-w-0 flex-1 font-normal">{label}</span>
                <span className="mu xs">{status}</span>
                <ChevronRight className="h-4 w-4 text-muted transition-transform" style={openGroup === key ? { transform: "rotate(90deg)" } : undefined} />
              </button>
              {openGroup === key && <div className="space-y-1 px-3.5 py-2">{groupRows(key)}</div>}
            </div>
          ))}
        </div>

        <div className="sect">
          <div className="flex items-center justify-between">
            <span className="eb">{d.mdFootageRights}</span>
            {/* "Required" is plain text with a dot (SOT §B), keeping the amber colour */}
            <span className="t-small" style={{ color: "rgb(var(--amber))" }}>• {d.mdRequired}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="field">
              <label className="lab" htmlFor="md-holder">{d.mdRightsHolder}</label>
              <input id="md-holder" value={holder} onChange={(e) => setHolder(e.target.value)} placeholder={d.mdRightsHolderPh} className="in" />
            </div>
            <div className="field">
              <label className="lab" htmlFor="md-basis">{d.mdBasis}</label>
              <select id="md-basis" value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)} className="in">
                <option value="">{d.mdBasisChoose}</option>
                <option value="OWN">{d.mdBasisOwn}</option>
                <option value="LICENSED">{d.mdBasisLicensed}</option>
                <option value="PERMISSION">{d.mdBasisPermission}</option>
              </select>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <button type="button" role="switch" aria-checked={minor} aria-labelledby="md-minor" onClick={() => setMinor((v) => !v)} className="vie-sw" />
            <div>
              <div id="md-minor" className="sm font-normal">{d.mdMinor}</div>
              <div className="hint">{d.mdMinorHint}</div>
            </div>
          </div>
          {mappedRights && <p className="t-small">{d.rightsLabel} <span className="text-ink">{rightsSummary(mappedRights, d)}</span></p>}
        </div>

        <div className="sect">
          <div className="flex items-center gap-2.5">
            <label className="lab" htmlFor="md-match" style={{ flex: "none" }}>{d.mdLinkToMatch}</label>
            <select id="md-match" value={linkValue || matchId || ""} className="in flex-1" onChange={(e) => {
              const v = e.target.value;
              setLinkValue(v);
              if (v === "__new__") return;
              chooseMatch(v || null);
            }}>
              <option value="">{d.mdLeaveUnlinked}</option>
              <option value="__new__">{d.mdCreateMatch}</option>
              {(matches ?? []).map((m) => <option key={m.id} value={m.id}>{matchName(m)}</option>)}
            </select>
          </div>
          {linkValue === "__new__" && up.selected && (
            <MatchLinker videoId={up.selected.id} matchId={up.selected.match_id} canWrite={up.canWrite}
              onLinked={(m) => { setLinkValue(m.id); chooseMatch(m.id); }} />
          )}
          {linkValue === "__new__" && !up.selected && <p className="t-small">{d.matchLinkedNextUpload}</p>}
        </div>

        <div style={{ marginTop: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid rgb(var(--line))", background: "rgb(var(--panel))" }}>
          <div className="sm flex justify-between"><span>{d.mdTokenPerMinute}</span><span className="mu">{d.mdCostAfterCheck}</span></div>
          <button type="button" disabled={!canStart || startBusy} title={d.mdStartAnalysisHint} onClick={() => void start()}
            className="vie-btn vie-btn-pri vie-btn-lg w-full disabled:opacity-50">
            {startBusy ? <UploadCloud className="h-4 w-4 animate-pulse" /> : d.mdStartAnalysis}
          </button>
          {startMsg && <p role="status" className="text-xs text-muted">{startMsg}</p>}
          {up.selected && up.selected.state !== "INGESTED" && <p className="text-xs text-muted">{dict.body.processing.notVerifiedYet.replace("{state}", up.selected.state)}</p>}
        </div>
      </aside>
      <UploadRightsDialog />
    </div>
  );
}
