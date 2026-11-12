"use client";
/**
 * Page 06 Sections 08-12 — inspector tabs, Spotlight Controls, Player Targeting, Overlays, Branding and the output actions
 * (approved reference 06_REEL_BUILDER, right column).
 *
 * Every control is real (ADR-044); all are part of the reel's saved look and take effect in the next render:
 *   Spotlight Intensity = how bright the beam of light onto him is (the rest dims a little), Ray Width = the beam's width, Vignette = darker
 *   corners, Glow = softness of the beam's edges, Target Lock Sensitivity = how readily the spotlight bridges a moment where he was not found (it never follows
 *   anyone else); Auto Track on = he is re-found 10 times a second (smooth, slower render), off = the analysis positions only.
 *   Overlays: Player Info Card = name caption above him; Match Score & Time = team names and the clock (only from halves a person confirmed;
 *   the score is not measured, so not shown); Competition Logo = a logo uploaded with a rights declaration; Animated Lower Third = name, ID
 *   and club sliding in at the start of each clip. Branding: OTSI VIE watermark, a custom logo, a 3-second end screen.
 * The reel is locked to the player a person confirmed; Re-detect Player refreshes the followed tracks. Generate Reel queues the real render;
 * Preview Render plays the latest render in the player; Save Project saves the title and the look. While a render runs, the same button
 * stops it (owner 2026-11-02): one click asks, a second click within 4 s stops it; the reel can then be generated again.
 */
import { BRAND_MAX_BYTES, presetOf, SPOTLIGHT_PRESETS, type BrandAsset, type BrandAssetKind, type BrandRightsBasis, type Reel, type SpotlightSettings } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, apiBlob } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { ConfirmRender } from "./ConfirmRender";
import { ReelExtras } from "./ReelExtras";
import { DEFAULTS, Switch, useStage } from "./shared";

const TABS: [string, string][] = [["Spotlight", "p06-spotlight"], ["Overlays", "p06-overlays"], ["Branding", "p06-branding"]];
type Key = "dim" | "size" | "feather" | "vignette" | "lock";
const SLIDERS: [string, Key, number, number][] = [
  ["Spotlight Intensity", "dim", 0, 0.9],
  ["Ray Width", "size", 0.8, 3],
  ["Vignette Strength", "vignette", 0, 1],
  ["Glow Amount", "feather", 0.05, 1.5],
  ["Target Lock Sensitivity", "lock", 0, 1],
];
type Toggle = "name_caption" | "score_bug" | "lower_third" | "watermark" | "end_screen";
type LogoField = "competition_logo_id" | "custom_logo_id";
const LOGO_KIND: Record<LogoField, BrandAssetKind> = { competition_logo_id: "COMPETITION_LOGO", custom_logo_id: "CUSTOM_LOGO" };
const BASIS: BrandRightsBasis[] = ["OWN_BRAND", "LICENSED", "PERMISSION"];
const FIELD = "w-full rounded-ctl border border-line2 bg-canvas px-2 py-1.5 t-body";

/** a logo's picture (fetched with the user's session) */
function LogoImg({ id, size }: { id: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true, url: string | null = null;
    void apiBlob(`/v1/brand-assets/${id}/image`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  return <div aria-hidden style={{ width: size, height: size, flexShrink: 0, borderRadius: 6, background: src ? `center / contain no-repeat url(${src}), #0b2342` : "#0b2342" }} />;
}

/** Choose a logo for the reel, or upload one with its rights declaration (Page 06: no logo without rights). */
function LogoPicker({ kind, onPick, onClose }: { kind: BrandAssetKind; onPick: (id: string) => void; onClose: () => void }) {
  const { t: dict } = useLocale();
  const [list, setList] = useState<BrandAsset[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [holder, setHolder] = useState("");
  const [basis, setBasis] = useState<BrandRightsBasis | "">("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const what = kind === "COMPETITION_LOGO" ? dict.body.reelstage.logoWhatComp : dict.body.reelstage.logoWhatCustom;
  const basisWords: Record<BrandRightsBasis, string> = { OWN_BRAND: dict.body.reelstage.basisOwnLogo, LICENSED: dict.body.reelstage.basisLicensed, PERMISSION: dict.body.reelstage.basisPermission, FREE_LICENCE: dict.body.reelstage.basisFree };
  useEffect(() => { void api<BrandAsset[]>(`/v1/brand-assets?kind=${kind}`).then(setList, () => setList([])); }, [kind]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const fileErr = file && file.size > BRAND_MAX_BYTES ? dict.body.reelstage.logoTooBig : file && !/^image\/(png|jpeg)$/.test(file.type) ? dict.body.reelstage.logoWrongType : null;
  const ready = !!file && !fileErr && name.trim().length > 0 && holder.trim().length >= 2 && !!basis && ok && !busy;
  const upload = async () => {
    if (!file || !basis) return;
    setBusy(true); setErr(null);
    try {
      const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("read")); fr.readAsDataURL(file); });
      const a = await api<BrandAsset>("/v1/brand-assets", { method: "POST", json: { kind, name: name.trim(), rights_holder: holder.trim(), rights_basis: basis, confirm_rights: true, data_base64: data } });
      onPick(a.id);
    } catch (e) { setErr(e instanceof Error ? e.message : dict.body.reelstage.logoUploadFail); } finally { setBusy(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label={dict.body.reelstage.logoChooseAria.replace("{a}", what)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-[min(520px,94vw)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#1e90ff] bg-[#071a33] p-4 text-[#e3eefb]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="t-panel">{dict.body.reelstage.logoChooseAria.replace("{a}", what)}</h2>
          <button type="button" aria-label={dict.common.close} onClick={onClose} className="t-panel px-2">✕</button></div>
        {list === null ? <p className="t-body text-muted">{dict.common.loading}</p> : list.length > 0 && (
          <ul className="flex flex-col gap-2">{list.map((a) => (
            <li key={a.id}><button type="button" data-pick-logo={a.id} disabled={!a.rights_ok} onClick={() => onPick(a.id)}
              className="t-body flex w-full items-center gap-3 rounded-ctl border border-[#1e90ff]/60 bg-[#0b2a52] px-3 py-2 text-left hover:bg-[#0d3a6e] disabled:opacity-50">
              <LogoImg id={a.id} size={40} />
              <span className="min-w-0 flex-1"><span className="block truncate font-normal">{dict.body.reelstage.logoUse.replace("{a}", a.name)}</span>
                <span className="block truncate t-small">{a.rights_ok ? dict.body.reelstage.logoRights.replace("{a}", a.rights_holder) : dict.body.reelstage.logoRightsNotOk}</span></span>
            </button></li>))}
          </ul>)}
        <div className="flex flex-col gap-2 rounded-ctl border border-[#12335f] p-3">
          <p className="t-panel">{dict.body.reelstage.logoUploadNew.replace("{a}", what)}</p>
          <input type="file" accept="image/png,image/jpeg" aria-label={dict.body.reelstage.logoFileAria} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="t-body" />
          {fileErr && <p className="text-xs text-danger">{fileErr}</p>}
          <input className={FIELD} placeholder={dict.body.reelstage.logoNamePlaceholder} aria-label={dict.body.reelstage.logoNameAria} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <input className={FIELD} placeholder={dict.body.reelstage.logoHolderPlaceholder} aria-label={dict.body.reelstage.logoHolderAria} value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="off" />
          <select className={FIELD} aria-label={dict.body.reelstage.logoBasisAria} value={basis} onChange={(e) => setBasis(e.target.value as BrandRightsBasis)}>
            <option value="">{dict.body.reelstage.logoBasisEmpty}</option>{BASIS.map((v) => <option key={v} value={v}>{basisWords[v]}</option>)}
          </select>
          <label className="flex items-start gap-2 t-body"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-1" />
            <span>{dict.body.reelstage.logoConfirm}</span></label>
          {err && <p className="text-xs text-danger">{err}</p>}
          <button type="button" data-upload-logo="" disabled={!ready} onClick={() => void upload()}
            className="t-button rounded-ctl border border-ok/60 bg-ok/15 px-3 py-2 hover:bg-ok/25 disabled:opacity-50">{busy ? dict.body.reelstage.logoUploading : dict.body.reelstage.logoUploadUse}</button>
          <p className="t-small">{dict.body.reelstage.logoFormatNote}</p>
        </div>
      </div>
    </div>
  );
}

export function Inspector() {
  const { t: dict } = useLocale();
  const { r, draft, setDraft, name, dirty, save, focus, jump, tab, mode, setMode, openProfileIntro } = useStage();
  const reel = r?.reel ?? null;
  const [codec, setCodec] = useState<"h264" | "av1" | "vp9">("h264");
  const [stopAsk, setStopAsk] = useState(false);
  useEffect(() => { if (!stopAsk) return; const t = setTimeout(() => setStopAsk(false), 4000); return () => clearTimeout(t); }, [stopAsk]);
  const [picker, setPicker] = useState<LogoField | null>(null);
  const [extras, setExtras] = useState(false);
  /** B.13 (ADR-089): Generate Reel asks first, with what the render holds and how long it may take */
  const [confirm, setConfirm] = useState(false);
  /** what Save Project shows: "Saving…" while the request runs, "Saved ✓" until the next change */
  const [saving, setSaving] = useState<"saving" | "saved" | null>(null);
  useEffect(() => { if (dirty) setSaving((s) => (s === "saved" ? null : s)); }, [dirty]);
  const tabNames = [dict.body.reels.stepSpotlight, dict.body.reelstage.summaryOverlays, dict.body.reelstage.summaryBranding];
  const sliderWords: Record<Key, [string, string]> = {
    dim: [dict.body.reelstage.sliderIntensity, dict.body.reelstage.sliderIntensityNote],
    size: [dict.body.reelstage.sliderRayWidth, dict.body.reelstage.sliderRayNote],
    vignette: [dict.body.reelstage.sliderVignette, dict.body.reelstage.sliderVignetteNote],
    feather: [dict.body.reelstage.sliderGlow, dict.body.reelstage.sliderGlowNote],
    lock: [dict.body.reelstage.sliderLock, dict.body.reelstage.sliderLockNote],
  };
  const presetWords: Record<string, [string, string]> = {
    subtle: [dict.body.reelstage.presetSubtleName, dict.body.reelstage.presetSubtleNote],
    standard: [dict.body.reelstage.presetStandardName, dict.body.reelstage.presetStandardNote],
    strong: [dict.body.reelstage.presetStrongName, dict.body.reelstage.presetStrongNote],
    cinematic: [dict.body.reelstage.presetCinematicName, dict.body.reelstage.presetCinematicNote],
  };
  const saveNow = async () => {
    setSaving("saving");
    setSaving((await save()) ? "saved" : null);
  };
  const set = draft ?? DEFAULTS;
  const canEdit = !!r?.canEdit && !r.busy && !!reel;
  const flip = (k: Toggle) => setDraft({ ...set, [k]: !set[k] });
  const logo = (f: LogoField) => (set[f] ? setDraft({ ...set, [f]: null }) : setPicker(f));
  const scoreReason = !reel?.match ? (reel?.source === "ALL_MATCHES" ? dict.body.reelstage.scoreNoMatchAll : dict.body.reelstage.scoreNoMatch) : undefined;
  /** one switch row: the label and the switch are two buttons doing the same thing, so the whole row toggles without nesting buttons */
  const row = (l: string, on: boolean, act: (() => void) | undefined, reason: string | undefined, data: Record<string, string>) => (
    <div key={l} {...data} className="flex items-center gap-2 py-1">
      <button type="button" aria-label={l} title={act ? l : reason ?? ""} disabled={!act} onClick={act}
        className={`min-w-0 flex-1 text-left t-body ${act ? "text-ink" : "text-muted"}`}>{l}</button>
      <Switch on={on} disabled={!act} label={l} onToggle={() => act?.()} />
    </div>
  );
  const editable = (reason?: string) => (canEdit && !reason ? undefined : reason ?? (reel ? dict.body.reelstage.cannotEdit : dict.body.reelstage.openReelFirst));
  const render = reel?.latest_render ?? null;
  const active = !!render && ["QUEUED", "RUNNING"].includes(render.state);
  const border = (id: string) => (focus === id ? "border-primary" : "");

  const generate = () => {
    if (!r || !reel) return;
    r.run(async () => {
      let cur: Reel = reel;
      if (dirty && draft) cur = await api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, ...(name.trim() && name.trim() !== reel.name ? { name: name.trim() } : {}), settings: draft } });
      await api(`/v1/reels/${reel.id}/renders`, { method: "POST", json: { codec, bitrate_mbps: 8 }, headers: { "idempotency-key": `render-${reel.id}-${cur.version}-${codec}-${Date.now()}` } });
      return cur;
    }, dict.body.reels.renderStarted);
  };
  const stop = () => {
    if (!r || !render) return;
    if (!stopAsk) { setStopAsk(true); return; }
    setStopAsk(false);
    r.run(async () => { await api(`/v1/renders/${render.id}/cancel`, { method: "POST" }); }, dict.body.reelstage.renderingStopped);
  };
  const genReason = !reel ? dict.body.reelstage.openReelFirst : !r?.canEdit ? dict.body.reelstage.cannotEdit : reel.stale ? dict.body.reelstage.genReasonStale
    : reel.clips.length === 0 && !active ? dict.body.reelstage.genReasonNoClips : undefined;
  const pct = render?.progress != null ? ` ${Math.round(render.progress)}%` : "";
  const genLabel = active ? (stopAsk ? dict.body.reelstage.clickAgainStop : `${dict.body.reelstage.stopRendering}${pct}`) : render?.state === "SUCCEEDED" ? dict.body.reelstage.genAgain : dict.body.reelstage.genLabel;

  return (
    <div className="flex flex-col gap-3">
      <section aria-label={dict.body.reelstage.inspectorTabsAria} data-section="p06-s08" className="vie-panel px-2 py-1">
        <div role="tablist" aria-label={dict.body.reelstage.inspectorAria} className="flex">
          {TABS.map(([l, target], i) => (
            <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => jump(target)}
              className={`flex-1 border-b-2 px-2 py-2 text-center t-body ${tab === i ? "border-primary font-normal text-primary" : "border-transparent text-muted"}`}>
              {tabNames[i] ?? l}
            </button>
          ))}
        </div>
      </section>

      <section id="p06-spotlight" aria-label={dict.body.reels.spotlightControls} data-section="p06-s09" className={`vie-panel space-y-2 p-3 ${border("p06-spotlight")}`}>
        <div className="flex items-center gap-2">
          <h2 className="t-section">{dict.body.reels.spotlightControls}</h2>
          {/* B.16 (ADR-092): built-in starting looks; any slider change makes it "Custom" */}
          <select aria-label={dict.body.reelstage.spotlightPresetAria} data-spotlight-preset={presetOf(set) ?? "custom"} value={presetOf(set) ?? ""} disabled={!canEdit}
            title={presetWords[presetOf(set) ?? ""]?.[1] ?? dict.body.reelstage.presetCustomNote}
            onChange={(e) => { const p = SPOTLIGHT_PRESETS.find((x) => x.key === e.target.value); if (p) setDraft({ ...set, ...p.look }); }}
            className={`${FIELD} ml-auto w-auto shrink-0`}>
            <option value="" disabled>{dict.body.reelstage.presetCustom}</option>
            {SPOTLIGHT_PRESETS.map((p) => <option key={p.key} value={p.key}>{presetWords[p.key]?.[0] ?? p.name}</option>)}
          </select>
          <button type="button" title={dict.body.reelstage.resetAllHit} disabled={!canEdit} onClick={() => setDraft({ ...set, dim: DEFAULTS.dim, size: DEFAULTS.size, vignette: DEFAULTS.vignette, feather: DEFAULTS.feather, lock: DEFAULTS.lock })}
            className="vie-btn vie-btn-sm shrink-0 disabled:opacity-45">{dict.body.reelstage.resetAll}</button>
        </div>
        {SLIDERS.map(([stable, key, min, max]) => {
          const [label, note] = sliderWords[key];
          const pct = (set[key] - min) / (max - min);
          const on = !!reel && !!r?.canEdit;
          return (
            <div key={stable} data-slider={stable} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={`slider-${key}`} className="t-body">{label}</label>
                <span className="t-tc">{`${Math.round(pct * 100)}%`}</span>
              </div>
              <input id={`slider-${key}`} type="range" min={0} max={100} step={1} value={Math.round(pct * 100)} disabled={!on} title={!reel ? dict.body.reelstage.sliderNoteNoReel : note}
                aria-label={label} className="vie-range w-full"
                onChange={(e) => { const p = Number(e.target.value) / 100; setDraft({ ...set, [key]: Math.round((min + p * (max - min)) * 100) / 100 }); }} />
            </div>
          );
        })}
      </section>

      <section id="p06-target" aria-label={dict.body.reels.playerTargeting} data-section="p06-s10" className={`vie-panel space-y-2 p-3 ${border("p06-target")}`}>
        <h2 className="t-section">{dict.body.reels.playerTargeting}</h2>
        <div className="flex items-center gap-2 py-1">
          <button type="button" aria-label={dict.body.reelstage.autoTrackHit} disabled={!canEdit}
            onClick={() => setDraft({ ...set, auto_track: !set.auto_track })}
            className={`min-w-0 flex-1 text-left t-body ${canEdit ? "text-ink" : "text-muted"}`}>{dict.body.reelstage.autoTrack}</button>
          <Switch on={set.auto_track} disabled={!canEdit} label={dict.body.reelstage.autoTrackHit} onToggle={() => setDraft({ ...set, auto_track: !set.auto_track })} />
        </div>
        <div className="flex items-center gap-2 py-1">
          <span className="min-w-0 flex-1 t-body">{dict.body.reelstage.lockOn}</span>
          <span className={`text-xs ${reel?.player && !reel.stale ? "text-ok" : "text-muted"}`}>{reel?.player ? (reel.stale ? dict.body.reelstage.lockNeedsRefresh : dict.body.reelstage.lockLocked) : dict.body.reelstage.lockNone}</span>
        </div>
        {(reel?.player) && (
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={openProfileIntro} data-profile-intro-open="" className="text-xs text-primary hover:underline">{dict.body.reelstage.profileIntroLink}</button>
            {reel.video_id && (
              // ADR-045: his other tracks are found on the Analysis page (look-alikes, a person says Him / Not him); Re-detect then takes them in
              // ADR-131: a cross-match reel has no single video to look in — the link is hidden for it
              <Link href={`/analysis?video=${reel.video_id}&find=${reel.player.player_id}`} data-find-more className="text-xs text-primary hover:underline">{dict.body.reelstage.findMore}</Link>
            )}
          </div>
        )}
        <button type="button" onClick={() => { const before = r?.moments?.length ?? 0; r?.run(() => api<Reel>(`/v1/reels/${reel!.id}/refresh-targets`, { method: "POST" }),
          (nr, m) => dict.body.reelstage.redetectedMsg.replace("{a}", String(nr?.targets.length ?? 0)).replace("{b}", nr?.player?.display_name ?? dict.body.reels.momentsIntroPlayer).replace("{c}", String(before)).replace("{d}", String(m?.length ?? 0))); }}
          disabled={!canEdit} title={!canEdit ? (reel ? dict.body.reelstage.cannotEdit : dict.body.reelstage.openReelFirst) : dict.body.reelstage.redetectHit}
          className="vie-btn w-full disabled:opacity-45">↻ {dict.body.reelstage.redetect}</button>
      </section>

      <section id="p06-overlays" aria-label={dict.body.reelstage.summaryOverlays} data-section="p06-s11" className={`vie-panel space-y-1 p-3 ${border("p06-overlays")}`}>
        <h2 className="t-section">{dict.body.reelstage.summaryOverlays}</h2>
        {(() => {
          const on = (k: Toggle) => (editable() ? undefined : () => flip(k));
          const sr = editable(set.score_bug ? undefined : scoreReason);
          return [
            row(dict.body.reelstage.overlayPlayerCard, set.name_caption, on("name_caption"), editable(), { "data-overlay": "Player Info Card" }),
            row(dict.body.reelstage.overlayScore, set.score_bug, sr ? undefined : () => flip("score_bug"), sr, { "data-overlay": "Match Score & Time" }),
            row(dict.body.reelstage.overlayCompLogo, !!set.competition_logo_id, editable() ? undefined : () => logo("competition_logo_id"), editable(), { "data-overlay": "Competition Logo" }),
            row(dict.body.reelstage.overlayLowerThird, set.lower_third, on("lower_third"), editable(), { "data-overlay": "Animated Lower Third" }),
          ];
        })()}
        <p className="t-small">{!reel?.match ? (reel?.source === "ALL_MATCHES" ? dict.body.reelstage.scoreNoteAll : dict.body.reelstage.scoreNoteNoMatch) : reel.match.clock === "CONFIRMED"
          ? dict.body.reelstage.scoreNoteConfirmed : dict.body.reelstage.scoreNoteUnconfirmed}</p>
      </section>

      <section id="p06-branding" aria-label={dict.body.reelstage.summaryBranding} data-section="p06-s12" className={`vie-panel space-y-1 p-3 ${border("p06-branding")}`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="t-section">{dict.body.reels.branding}</h2>
          {/* ADR-050 (owner 2026-11-02): event tags, the match card and an intro / outro video, in one dialog */}
          <button type="button" data-reel-extras="" onClick={() => setExtras(true)} disabled={!canEdit} title={canEdit ? undefined : reel ? dict.body.reelstage.cannotEdit : dict.body.reelstage.openReelFirst}
            className="text-xs text-primary hover:underline disabled:opacity-60">{set.intro_id || set.outro_id ? dict.body.reelstage.brandingExtras : dict.body.reelstage.brandingExtrasNone}</button>
        </div>
        {row(dict.body.reelstage.brandingWatermark, set.watermark, editable() ? undefined : () => flip("watermark"), editable(), { "data-branding": "Use OTSI VIE Watermark" })}
        {row(dict.body.reelstage.brandingCustomLogo, !!set.custom_logo_id, editable() ? undefined : () => logo("custom_logo_id"), editable(), { "data-branding": "Custom Logo" })}
        {row(dict.body.reelstage.brandingEndScreen, set.end_screen, editable() ? undefined : () => flip("end_screen"), editable(), { "data-branding": "End Screen" })}
      </section>
      {reel && <ConfirmRender reel={reel} settings={set} codec={codec} dirty={dirty} open={confirm} onOpenChange={setConfirm} onStart={generate} />}
      {extras && draft && <ReelExtras settings={draft} onChange={setDraft} onClose={() => setExtras(false)} />}
      {picker && <LogoPicker kind={LOGO_KIND[picker]} onClose={() => setPicker(null)} onPick={(id) => { setDraft({ ...set, [picker]: id } as SpotlightSettings); setPicker(null); }} />}

      <section aria-label={dict.body.reels.output} data-section="p06-s13" data-render-state={render?.state ?? "NONE"} className="vie-panel space-y-2 p-3">
        <div className="flex gap-2">
          <button type="button" disabled={!!genReason} title={genReason ?? (active ? (stopAsk ? dict.body.reelstage.clickAgainStopHit : dict.body.reelstage.stopRendering) : dict.body.reelstage.genLabel)}
            onClick={active ? stop : () => setConfirm(true)}
            className={`t-button min-w-0 flex-1 rounded-ctl px-3 py-2.5 text-white disabled:opacity-70 ${active && stopAsk ? "bg-danger" : "bg-primary"} hover:opacity-90`}>
            {genLabel}
          </button>
          <select aria-label={dict.body.reels.codecLabel} value={codec} onChange={(e) => setCodec(e.target.value as typeof codec)} disabled={active}
            className={`${FIELD} w-auto shrink-0 disabled:opacity-60`}>
            <option value="h264">{dict.body.reels.codecH264}</option><option value="av1">{dict.body.reels.codecAv1}</option><option value="vp9">{dict.body.reels.codecVp9}</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={render?.state !== "SUCCEEDED"} aria-label={dict.body.reels.previewRender} aria-pressed={mode === "render"}
            title={render?.state === "SUCCEEDED" ? dict.body.reels.previewRender : dict.body.reelstage.previewNoRender}
            onClick={() => setMode(mode === "render" ? "clip" : "render")}
            className={`vie-btn flex-1 disabled:opacity-45 ${mode === "render" ? "border-primary text-primary" : ""}`}>{mode === "render" ? dict.body.reelstage.showingRender : dict.body.reels.previewRender}</button>
          <button type="button" disabled={!canEdit || saving === "saving"} title={!reel ? dict.body.reelstage.openReelFirst : saving === "saving" ? dict.body.reelstage.savingDots : dict.body.reelstage.cannotEdit}
            onClick={() => void saveNow()}
            className={`vie-btn flex-1 disabled:opacity-45 ${saving === "saved" && !dirty ? "border-ok text-ok" : canEdit && dirty ? "border-primary text-primary" : ""}`}>
            {saving === "saving" ? dict.body.reelstage.savingDots : saving === "saved" && !dirty ? dict.body.reelstage.savedCheck : dict.body.reels.saveProject}
          </button>
        </div>
      </section>
    </div>
  );
}
