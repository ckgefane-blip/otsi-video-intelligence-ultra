"use client";
/**
 * SOT UI rebuild Page 9 of 31: Export & Scouting Pack (Export.dc.html).
 *
 * The SOT's page: a header (Export / "Deliver {reel}" / Reel | Scouting
 * Pack seg), three panels — Render, Delivery, Scouting Pack — and a
 * bottom bar (cost, render queue, balance, Render only / Render & send).
 * The reel comes from the address (?reel=); without one the page opens
 * on the reel being rendered, else the newest reel with a render. Reels
 * are polled while one renders. A failed reels read is named, never
 * shown as empty.
 *
 * What maps to the engine, and what does not (reported plainly):
 * - Preset: the SOT's four options set the engine's preset, codec and
 *   bitrate. Club delivery = the Highlights Reel at High (8 Mbps);
 *   Quick share = the Highlights Reel at Draft (4 Mbps); Archive
 *   master = the Archive master at Master (16 Mbps); Custom = the
 *   settings below, unchanged.
 * - Format: MP4 is what the engine renders (H.264/AV1 in an MP4 file).
 *   MOV is shown because the SOT shows it, but the engine does not
 *   produce MOV files; choosing it says so and keeps MP4.
 * - Quality: Draft / High / Master = 4 / 8 / 16 Mbps. This is the
 *   engine's bitrate.
 * - Codec: H.264 is the engine's codec. H.265 / HEVC and ProRes 422
 *   are shown because the SOT shows them, but the engine does not
 *   render them; they are disabled and the note says so.
 * - Resolution and frame rate: the engine renders the reel's own
 *   frame at the source frame rate. The selects show the SOT's
 *   options; they do not change the render.
 * - File name: the engine names the finished file. The input is the
 *   name the SOT shows; it does not rename the render.
 * - Delivery: the send-to, email, expiry, password, message and the
 *   two switches are the delivery the API makes (POST
 *   /v1/reels/:id/deliveries). The password and the time-pinned
 *   comments are the share link's own fields. "File only" makes the
 *   link and notifies nobody.
 * - Scouting Pack: the reel is always in the Pack; the report and the
 *   brief are included only when they exist (the report must be
 *   created, the brief must be published). The manifest stamps Best
 *   Moment Rule v2.1. Building the Pack is 10 tokens, the same as a
 *   render.
 * The old page's preset library, interchange and Output & Reports are
 * not in the SOT, so they are not on this page; those components
 * remain in the repo, unrouted.
 */
import { BUILTIN_PRESETS, SCOUTING_PACK_COST_TOKENS, TOKEN_COSTS, type BrandAsset, type CreatedDelivery, type ExportPreset, type Member, type Reel, type ScoutingPack } from "@otsi-vie/contracts";
import { renderedState } from "@/components/studio/spotlight";
import { ExportPreflight } from "./ExportPreflight";
import { ScoutingPackDialog } from "./ScoutingPackDialog";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { isUuid } from "@/lib/identity";
import { useWalletBalance } from "@/lib/wallet";
import { typing } from "@/lib/keymap";
import { Link2 } from "lucide-react";
import Link from "next/link";

const WRITERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR"];
type SendTo = "client" | "team" | "file";
type ExportType = "reel" | "pack";
type PresetChoice = "club" | "quick" | "archive" | "custom";
type FormatChoice = "mp4" | "mov";
type QualityChoice = "draft" | "high" | "master";
const BITRATE: Record<QualityChoice, number> = { draft: 4, high: 8, master: 16 };
const QUALITY_OF: Record<number, QualityChoice> = { 4: "draft", 8: "high", 16: "master" };
const DAYS: Record<"7" | "1" | "30", number> = { "7": 7, "1": 1, "30": 30 };

export function ExportStage() {
  const { organization } = useAuth();
  const { t: dict } = useLocale();
  const s = dict.body.exports;
  const router = useRouter();
  const want = useSearchParams().get("reel");
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [reelsErr, setReelsErr] = useState(false);
  const [presets, setPresets] = useState<ExportPreset[]>(BUILTIN_PRESETS);
  const [brand, setBrand] = useState<BrandAsset[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [exportType, setExportType] = useState<ExportType>("reel");
  const [presetChoice, setPresetChoice] = useState<PresetChoice>("club");
  const [preset, setPresetId] = useState<string>("builtin-reel");
  const [codec, setCodec] = useState<"h264" | "av1" | "vp9">("h264");
  const [bitrate, setBitrate] = useState(8);
  const [format, setFormat] = useState<FormatChoice>("mp4");
  const [resolution, setResolution] = useState("1920 × 1080");
  const [frameRate, setFrameRate] = useState("Source");
  const [fileName, setFileName] = useState("");
  const [sendTo, setSendTo] = useState<SendTo>("client");
  const [email, setEmail] = useState("");
  const [team, setTeam] = useState<string[]>([]);
  const [days, setDays] = useState<"7" | "1" | "30">("7");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [canComment, setCanComment] = useState(true);
  const [canDownload, setCanDownload] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [pack, setPack] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [delivered, setDelivered] = useState<{ url: string; mailto: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingSend, setPendingSend] = useState(false);
  const [packs, setPacks] = useState<ScoutingPack[] | null>(null);
  const [reportCount, setReportCount] = useState<number | null>(null);
  const [briefPublished, setBriefPublished] = useState<boolean | null>(null);
  const [includeReport, setIncludeReport] = useState(false);
  const [includeBrief, setIncludeBrief] = useState(false);
  const wallet = useWalletBalance();

  const loadPresets = useCallback(() => api<ExportPreset[]>("/v1/export-presets").then(setPresets, () => setPresets(BUILTIN_PRESETS)), []);
  useEffect(() => { void loadPresets(); }, [loadPresets]);
  useEffect(() => {
    void api<BrandAsset[]>("/v1/brand-assets").then(setBrand, () => setBrand([]));
    void api<Member[]>("/v1/members").then(setMembers, () => setMembers([]));
  }, []);
  const load = useCallback(() => api<Reel[]>("/v1/reels").then((r) => { setReels(r); setReelsErr(false); }, () => setReelsErr(true)), []);
  useEffect(() => { void load(); }, [load]);
  /** [ / ] switch between the Reel and Scouting Pack export types (lib/keymap.ts, Exports scope) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "]") setExportType("pack");
      else if (e.key === "[") setExportType("reel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const anyActive = !!reels?.some((r) => !!r.latest_render && ["QUEUED", "RUNNING"].includes(r.latest_render.state));
  useEffect(() => { if (!anyActive) return; const t = setInterval(() => void load(), 2000); return () => clearInterval(t); }, [anyActive, load]);

  const valid = !!want && isUuid(want);
  const reel = valid ? reels?.find((r) => r.id === want) ?? null : null;
  useEffect(() => {
    if (valid || !reels?.length) return;
    const pick = reels.find((r) => !!r.latest_render && ["QUEUED", "RUNNING"].includes(r.latest_render.state))
      ?? reels.find((r) => !!r.last_good_render) ?? null;
    if (pick) router.replace(`/exports?reel=${pick.id}`, { scroll: false });
  }, [valid, reels, router]);

  const player = reel?.player ?? null;
  const chosen = useMemo(() => presets.find((p) => p.id === preset) ?? BUILTIN_PRESETS[0]!, [presets, preset]);
  const renderId = reel?.last_good_render?.has_output ? reel.last_good_render.id : null;
  const activeCount = useMemo(() => (reels ?? []).filter((r) => !!r.latest_render && ["QUEUED", "RUNNING"].includes(r.latest_render.state)).length, [reels]);
  const canEdit = !!organization && WRITERS.includes(organization.role);
  const fail = useCallback((x: unknown, d: string) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : d }), []);

  // the Scouting Pack panel: the player's packs, report count and whether a brief is published
  useEffect(() => {
    if (!player) { setPacks(null); setReportCount(null); setBriefPublished(null); return; }
    void api<ScoutingPack[]>(`/v1/players/${player.player_id}/scouting-packs`).then(setPacks, () => setPacks([]));
    void api<unknown[]>(`/v1/players/${player.player_id}/reports`).then((r) => setReportCount(r.length), () => setReportCount(null));
    void api<{ briefs?: { state?: string }[] }>(`/v1/players/${player.player_id}/insights`).then(
      (x) => setBriefPublished((x.briefs ?? []).some((b) => b.state === "PUBLISHED")), () => setBriefPublished(null));
  }, [player]);
  const packItems = (includeReport && (reportCount ?? 0) > 0 ? 1 : 0) + (includeBrief && briefPublished ? 1 : 0);
  const includedCount = 1 + packItems;

  const applyPreset = useCallback((c: PresetChoice) => {
    setPresetChoice(c);
    if (c === "club") { setPresetId("builtin-reel"); setCodec("h264"); setBitrate(8); setFormat("mp4"); }
    else if (c === "quick") { setPresetId("builtin-reel"); setCodec("h264"); setBitrate(4); setFormat("mp4"); }
    else if (c === "archive") { setPresetId("builtin-archive"); setCodec("h264"); setBitrate(16); setFormat("mp4"); }
  }, []);
  const quality: QualityChoice = QUALITY_OF[bitrate] ?? "high";
  const setQuality = (q: QualityChoice) => { setBitrate(BITRATE[q]); setPresetChoice("custom"); };

  const start = () => {
    if (!reel) return;
    setConfirm(false); setBusy(true); setMsg(null);
    void api<{ started: unknown[]; skipped: unknown[] }>(`/v1/reels/${reel.id}/renders/batch`, { method: "POST", json: { outputs: chosen.spec.outputs, codec, bitrate_mbps: bitrate, loudness_lufs: chosen.spec.loudness_lufs },
      headers: { "idempotency-key": `batch-${reel.id}-${reel.version}-${chosen.id}-${codec}-${bitrate}-${Date.now()}` } })
      .then((r) => {
        const n = r.started.length, sk = r.skipped.length;
        setMsg({ ok: n > 0, text: n ? (n === 1 ? s.renderingFilesOne : s.renderingFilesMany.replace("{a}", String(n))) + (sk ? s.renderingSkipped.replace("{a}", String(sk)) : "") : s.renderingAllRunning });
        return load();
      }, (x) => { fail(x, s.renderCouldNotStart); return load(); }).finally(() => setBusy(false));
  };
  const sendDelivery = useCallback(async () => {
    if (!reel) return;
    setBusy(true); setMsg(null); setDelivered(null); setCopied(false);
    try {
      const r = await api<CreatedDelivery>(`/v1/reels/${reel.id}/deliveries`, { method: "POST", json: {
        notify_client: sendTo === "client", recipient_name: null, recipient_email: sendTo === "client" ? email.trim() || null : null,
        notify_team: sendTo === "team", team_user_ids: sendTo === "team" ? team : [], message,
        link: { expires_in_days: DAYS[days], can_download: canDownload, password: password.trim() || undefined, can_comment: canComment } } });
      const url = `${location.origin}${r.url}`;
      const q = [r.mail.bcc.length ? `bcc=${r.mail.bcc.map(encodeURIComponent).join(",")}` : "", `subject=${encodeURIComponent(r.mail.subject)}`, `body=${encodeURIComponent(`${r.mail.body}\n${url}\n`)}`].filter(Boolean).join("&");
      const mailto = `mailto:${r.mail.to.map(encodeURIComponent).join(",")}?${q}`;
      setDelivered({ url, mailto });
      setMsg({ ok: true, text: s.deliverToClient });
      window.location.href = mailto;
    } catch (x) { fail(x, s.renderCouldNotStart); } finally { setBusy(false); }
  }, [reel, sendTo, email, team, message, days, canDownload, password, canComment, fail, s]);
  // "Render & send": render first when there is no finished file, then send once the render lands
  const renderAndSend = () => {
    if (!reel) return;
    if (renderId) { void sendDelivery(); return; }
    setPendingSend(true);
    setConfirm(true);
  };
  const renderIdRef = useRef(renderId);
  useEffect(() => {
    const was = renderIdRef.current;
    renderIdRef.current = renderId;
    if (pendingSend && renderId && !was) { setPendingSend(false); void sendDelivery(); }
  }, [pendingSend, renderId, sendDelivery]);

  const brandName = (id: string | null | undefined) => (brand ?? []).find((b) => b.id === id)?.name ?? null;
  const logoName = brandName(reel?.settings.custom_logo_id ?? reel?.settings.competition_logo_id);
  const introName = brandName(reel?.settings.intro_id) ?? brandName(reel?.settings.outro_id);
  const musicName = brandName(reel?.settings.music_id);
  const cost = exportType === "pack" ? SCOUTING_PACK_COST_TOKENS : TOKEN_COSTS.reelRender;
  const balance = wallet == null ? null : wallet.balance;
  const ruleVersion = reel?.best_moments_rule_version ?? "2.1";
  const reelHref = reel ? `/reels/${reel.id}#branding` : "/reels";
  const reportHref = player ? `/reports/players/${encodeURIComponent(player.canonical_otsi_id ?? player.player_id)}` : "/reports";
  const field = "rounded-ctl border border-line bg-transparent px-2 py-1.5 text-sm";

  return (
    <div className="flex flex-1 flex-col gap-3.5 px-8 py-5" data-page="exports">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="eb">Export</span>
          <h1 className="t-page">{reel ? s.exDeliver.replace("{a}", reel.name) : s.exDeliver.replace("{a}", "—")}</h1>
        </div>
        <div className="seg" role="group" aria-label="Export type">
          <button type="button" className={exportType === "reel" ? "on" : ""} onClick={() => setExportType("reel")}>{s.exReel}</button>
          <button type="button" className={exportType === "pack" ? "on" : ""} onClick={() => setExportType("pack")}>{s.exScoutingPack}</button>
        </div>
      </div>

      {reelsErr && (
        <p role="alert" className="text-sm text-danger">{s.renderQueueNotLoaded}{" "}
          <button type="button" className="underline" onClick={() => void load()}>{dict.common.retry}</button>
        </p>
      )}
      {!reels ? (
        <p className="text-sm text-muted">{dict.common.loading}</p>
      ) : !reel ? (
        <p className="text-sm text-muted">{s.openReelToExport}</p>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-3">
          <section className="vie-panel flex flex-col" aria-labelledby="ex-render">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 id="ex-render" className="t-panel">{s.exRender}</h2>
              <span className="t-small text-muted">{s.exRunsOnThisComputer}</span>
            </div>
            <div className="flex flex-col gap-3 px-4 py-3">
              <label className="grid gap-1">
                <span className="t-label text-muted">{s.exPreset}</span>
                <select aria-label={s.exPreset} value={presetChoice} onChange={(e) => applyPreset(e.target.value as PresetChoice)} disabled={!canEdit} className={field}>
                  <option value="club">{s.exPresetClub}</option>
                  <option value="quick">{s.exPresetQuick}</option>
                  <option value="archive">{s.exPresetArchive}</option>
                  <option value="custom">{s.exPresetCustom}</option>
                </select>
              </label>
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2.5">
                <div className="grid gap-1">
                  <span className="t-label text-muted" id="ex-format">{s.exFormat}</span>
                  <div className="seg f" role="group" aria-labelledby="ex-format">
                    <button type="button" className={format === "mp4" ? "on" : ""} onClick={() => { setFormat("mp4"); setCodec("h264"); }} disabled={!canEdit}>MP4</button>
                    <button type="button" className={format === "mov" ? "on" : ""} onClick={() => setFormat("mov")} disabled={!canEdit} title="The engine renders MP4.">MOV</button>
                  </div>
                  {format === "mov" && <span className="t-small text-amber">The engine renders MP4.</span>}
                </div>
                <div className="grid gap-1">
                  <span className="t-label text-muted" id="ex-quality">{s.quality}</span>
                  <div className="seg f" role="group" aria-labelledby="ex-quality">
                    <button type="button" className={quality === "draft" ? "on" : ""} onClick={() => setQuality("draft")} disabled={!canEdit}>{s.exQualityDraft}</button>
                    <button type="button" className={quality === "high" ? "on" : ""} onClick={() => setQuality("high")} disabled={!canEdit}>{s.exQualityHigh}</button>
                    <button type="button" className={quality === "master" ? "on" : ""} onClick={() => setQuality("master")} disabled={!canEdit}>{s.exQualityMaster}</button>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <label className="grid gap-1">
                  <span className="t-label text-muted">{s.exCodec}</span>
                  <select aria-label={s.exCodec} value={codec} onChange={(e) => setCodec(e.target.value as "h264")} disabled={!canEdit} className={field}>
                    <option value="h264">H.264</option>
                    <option value="h265" disabled>H.265 / HEVC</option>
                    <option value="prores" disabled>ProRes 422</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="t-label text-muted">{s.resolution}</span>
                  <select aria-label={s.resolution} value={resolution} onChange={(e) => setResolution(e.target.value)} disabled={!canEdit} className={field}>
                    <option>1920 × 1080</option>
                    <option>3840 × 2160</option>
                    <option>1280 × 720</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="t-label text-muted">{s.exFrameRate}</span>
                  <select aria-label={s.exFrameRate} value={frameRate} onChange={(e) => setFrameRate(e.target.value)} disabled={!canEdit} className={field}>
                    <option>{s.exFrameRateSource}</option>
                    <option>25</option>
                    <option>30</option>
                    <option>50</option>
                    <option>60</option>
                  </select>
                </label>
              </div>
              <p className="t-small text-muted">The engine renders the reel&apos;s own frame at the source frame rate; the codec is H.264.</p>
              <label className="grid gap-1">
                <span className="t-label text-muted">{s.exFileName}</span>
                <input aria-label={s.exFileName} value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder={s.exFileNamePh} disabled={!canEdit} className={`${field} font-mono text-xs`} />
              </label>
            </div>
            <div className="mt-auto border-t border-line px-4 py-3">
              <span className="eb">{dict.body.studio.brandingLabel}</span>
              {([
                [dict.body.studio.logoLabel, logoName, "logo"],
                [s.exIntroOutro, introName, "intro"],
                [dict.body.reels.music, musicName, "music"],
              ] as const).map(([label, name, kind]) => (
                <div key={kind} className="flex min-h-[34px] items-center gap-2 border-0 p-0">
                  <span className="flex-1 text-sm">{label}</span>
                  <span className="t-small text-muted">{name ?? dict.body.studio.lookNone}</span>
                  <Link href={reelHref} className="vie-btn vie-btn-sm">{s.exUpload}</Link>
                </div>
              ))}
              <p className="t-small mt-1 text-muted">{s.exRightsRecorded}</p>
            </div>
          </section>

          <section className="vie-panel flex flex-col" aria-labelledby="ex-delivery">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 id="ex-delivery" className="t-panel">{s.exDelivery}</h2>
            </div>
            <div className="flex flex-1 flex-col gap-3.5 px-4 py-3">
              <div className="grid gap-1">
                <span className="t-label text-muted" id="ex-send-to">{s.exSendTo}</span>
                <div className="seg f" role="group" aria-labelledby="ex-send-to">
                  <button type="button" className={sendTo === "client" ? "on" : ""} onClick={() => setSendTo("client")} disabled={!canEdit}>{s.exSendClient}</button>
                  <button type="button" className={sendTo === "team" ? "on" : ""} onClick={() => setSendTo("team")} disabled={!canEdit}>{s.exSendTeam}</button>
                  <button type="button" className={sendTo === "file" ? "on" : ""} onClick={() => setSendTo("file")} disabled={!canEdit}>{s.exSendFile}</button>
                </div>
              </div>
              {sendTo === "client" && (
                <label className="grid gap-1">
                  <span className="t-label text-muted">{s.exRecipientEmail}</span>
                  <input aria-label={s.exRecipientEmail} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={s.exRecipientEmailPh} disabled={!canEdit} className={field} />
                </label>
              )}
              {sendTo === "team" && (
                <div className="grid gap-1">
                  <span className="t-label text-muted">{s.exSendTeam}</span>
                  <ul className="grid max-h-32 gap-1 overflow-y-auto text-sm" aria-label={s.exSendTeam}>
                    {(members ?? []).map((m) => (
                      <li key={m.user_id}><label className="flex items-center gap-2"><input type="checkbox" checked={team.includes(m.user_id)} disabled={!canEdit}
                        onChange={(e) => setTeam((t) => (e.target.checked ? [...t, m.user_id] : t.filter((y) => y !== m.user_id)))} />{m.display_name}<span className="text-muted">{m.role.toLowerCase()}</span></label></li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                <label className="grid gap-1">
                  <span className="t-label text-muted">{s.exLinkExpires}</span>
                  <select aria-label={s.exLinkExpires} value={days} onChange={(e) => setDays(e.target.value as "7" | "1" | "30")} disabled={!canEdit} className={field}>
                    <option value="7">{s.exExpires7}</option>
                    <option value="1">{s.exExpires24}</option>
                    <option value="30">{s.exExpires30}</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="t-label text-muted">{s.exPassword}</span>
                  <input aria-label={s.exPassword} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={s.exPasswordPh} disabled={!canEdit} className={field} />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="t-label text-muted">{s.exMessage}</span>
                <textarea aria-label={s.exMessage} value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder={s.exMessagePh} disabled={!canEdit} className={field} />
              </label>
              <div className="flex items-center gap-2.5">
                <button type="button" role="switch" aria-checked={canComment} aria-label={s.exAllowComments} disabled={!canEdit}
                  className="vie-sw" onClick={() => setCanComment((v) => !v)} />
                <span className="text-sm">{s.exAllowComments}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <button type="button" role="switch" aria-checked={canDownload} aria-label={s.exAllowDownload} disabled={!canEdit}
                  className="vie-sw" onClick={() => setCanDownload((v) => !v)} />
                <span className="text-sm">{s.exAllowDownload}</span>
              </div>
              {delivered && (
                <div className="grid gap-2" data-delivered>
                  <p className="text-xs text-muted">Your mail app should open now. If it did not, copy the link (it is shown only once).</p>
                  <code className="break-all rounded-ctl border border-line px-2 py-1 text-xs">{delivered.url}</code>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void navigator.clipboard?.writeText(delivered.url).then(() => setCopied(true), () => setMsg({ ok: false, text: "Copy failed" }))} className="vie-btn vie-btn-sm">{copied ? "Copied" : "Copy link"}</button>
                    <a href={delivered.mailto} className="vie-btn vie-btn-sm vie-btn-pri">Open my mail app again</a>
                  </div>
                </div>
              )}
              <div className="mt-auto flex items-center gap-3 rounded-lg border border-line bg-canvas p-3">
                <Link2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="flex-1 text-sm text-muted">{s.exRecipientsNote}</span>
              </div>
            </div>
          </section>

          <section className="vie-panel flex flex-col" aria-labelledby="ex-pack">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <h2 id="ex-pack" className="t-panel">{s.exScoutingPack}</h2>
              <span className="vie-chip">{s.exOneBundle}</span>
            </div>
            <div className="flex flex-1 flex-col gap-2.5 px-4 py-3">
              <p className="t-small text-muted">{s.exPackSub}</p>
              <ul className="flex flex-col gap-1.5">
                <li className="flex items-center gap-3 rounded-lg border border-line bg-raised p-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded border border-primary bg-primary text-xs text-white" aria-hidden>✓</span>
                  <span className="flex-1">
                    <span className="block text-sm font-normal">{s.exHighlightReel}</span>
                    <span className="t-small text-muted">{reel.name}</span>
                  </span>
                  <span className="vie-chip ev ev-c">{dict.body.upload.ready}</span>
                </li>
                <li className="flex items-center gap-3 rounded-lg border border-dashed border-line2 bg-panel p-3">
                  <button type="button" role="checkbox" aria-checked={includeReport} aria-label={s.exPlayerReport} disabled={!canEdit || (reportCount ?? 0) === 0}
                    onClick={() => setIncludeReport((v) => !v)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${includeReport ? "border-primary bg-primary text-white" : "border-muted text-transparent"}`}>{includeReport ? "✓" : ""}</button>
                  <span className="flex-1">
                    <span className="block text-sm text-ink2">{s.exPlayerReport}</span>
                    <span className="t-small text-muted">{reportCount == null ? s.exReportNotCreated : reportCount === 0 ? s.exReportNotCreated : `${reportCount} ${reportCount === 1 ? "report" : "reports"}`}</span>
                  </span>
                  <Link href={reportHref} className="vie-btn vie-btn-sm">{dict.body.reels.createBtn}</Link>
                </li>
                <li className="flex items-center gap-3 rounded-lg border border-dashed border-line2 bg-panel p-3">
                  <button type="button" role="checkbox" aria-checked={includeBrief} aria-label={s.exBrief} disabled={!canEdit || !briefPublished}
                    onClick={() => setIncludeBrief((v) => !v)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${includeBrief ? "border-primary bg-primary text-white" : "border-muted text-transparent"}`}>{includeBrief ? "✓" : ""}</button>
                  <span className="flex-1">
                    <span className="block text-sm text-ink2">{s.exBrief}</span>
                    <span className="t-small text-muted">{s.exBriefPublishedOnly}</span>
                  </span>
                  <Link href={reportHref} className="vie-btn vie-btn-sm">{dict.body.aiAnalyst.publish}</Link>
                </li>
              </ul>
              <div className="mt-auto flex flex-col gap-1.5 rounded-lg border border-line bg-canvas p-3">
                <span className="eb">{s.exManifest}</span>
                <dl className="grid gap-1 font-mono text-xs">
                  <div className="flex justify-between gap-3"><dt className="font-sans text-muted">{s.exBestMomentRule}</dt><dd>v{ruleVersion}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="font-sans text-muted">{s.exPlayer}</dt><dd>{player?.display_name ?? "—"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="font-sans text-muted">{s.exItems}</dt><dd>{s.exItemsOf.replace("{a}", String(includedCount)).replace("{b}", "3")}</dd></div>
                </dl>
              </div>
              <button type="button" className="vie-btn" disabled={!canEdit || !renderId} onClick={() => setPack(true)}
                title={renderId ? undefined : "Render the reel first"}>
                {exportType === "pack" ? `Build the Scouting Pack — ${SCOUTING_PACK_COST_TOKENS} tokens` : s.exScoutingPack}
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 border-t border-line bg-panel px-8 py-3">
        <div className="flex flex-1 flex-wrap gap-5 text-sm">
          <span><span className="text-muted">{s.exCost}</span> <span className="font-mono">{s.exTokens.replace("{a}", String(cost))}</span></span>
          <span><span className="text-muted">{s.exRenderQueue}</span> {reelsErr ? "—" : activeCount === 0 ? s.exQueueEmpty : `${activeCount} rendering`}</span>
          <span><span className="text-muted">{dict.body.wallet.balance}</span> <span className="font-mono">{balance == null ? "—" : s.exTokens.replace("{a}", String(balance))}</span></span>
          {pendingSend && <span className="text-amber">Rendering… the delivery will be sent when the render finishes.</span>}
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-primary" : "text-danger"}`}>{msg.text}</p>}
        <button type="button" className="vie-btn" disabled={!canEdit || !reel || busy} onClick={() => setConfirm(true)}>{s.exRenderOnly}</button>
        <button type="button" className="vie-btn vie-btn-pri" disabled={!canEdit || !reel || busy} onClick={renderAndSend}>{s.exRenderSend}</button>
      </div>

      {reel && <ExportPreflight reel={reel} preset={chosen} codec={codec} bitrate={bitrate} upToDate={renderedState(reel).reel.state === "RENDERED"} canWrite={canEdit} open={confirm} onOpenChange={setConfirm} onStart={start} />}
      <ScoutingPackDialog reel={reel} canWrite={canEdit} open={pack} onOpenChange={setPack} />
    </div>
  );
}
