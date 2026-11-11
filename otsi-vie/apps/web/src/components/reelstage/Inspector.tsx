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
import { useEffect, useRef, useState } from "react";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { api, apiBlob } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { Hit } from "@/components/workspace/shared";
import { ConfirmRender } from "./ConfirmRender";
import { ReelExtras } from "./ReelExtras";
import { DEFAULTS, input, Switch, useStage } from "./shared";

const TABS: [string, number, string][] = [["Spotlight", 2146, "p06-spotlight"], ["Overlays", 2302, "p06-overlays"], ["Branding", 2459, "p06-branding"]];
type Key = "dim" | "size" | "feather" | "vignette" | "lock";
const SLIDERS: [string, string, number, number, Key, number, number][] = [
  ["Spotlight Intensity", "sun", 277, 305, "dim", 0, 0.9],
  ["Ray Width", "tri", 345, 373, "size", 0.8, 3],
  ["Vignette Strength", "ring", 413, 441, "vignette", 0, 1],
  ["Glow Amount", "spark", 482, 511, "feather", 0.05, 1.5],
  ["Target Lock Sensitivity", "tgt", 551, 578, "lock", 0, 1],
];
type Toggle = "name_caption" | "score_bug" | "lower_third" | "watermark" | "end_screen";
type LogoField = "competition_logo_id" | "custom_logo_id";
const LOGO_KIND: Record<LogoField, BrandAssetKind> = { competition_logo_id: "COMPETITION_LOGO", custom_logo_id: "CUSTOM_LOGO" };
const BASIS: BrandRightsBasis[] = ["OWN_BRAND", "LICENSED", "PERMISSION"];

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
  const field = "w-full rounded-ctl border border-[#17406f] bg-[#041022] px-2 py-1.5 text-sm";
  return (
    <div role="dialog" aria-modal="true" aria-label={dict.body.reelstage.logoChooseAria.replace("{a}", what)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-[min(520px,94vw)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#1e90ff] bg-[#071a33] p-4 text-[#e3eefb]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-base font-semibold">{dict.body.reelstage.logoChooseAria.replace("{a}", what)}</h2>
          <button type="button" aria-label={dict.common.close} onClick={onClose} className="px-2 text-lg">✕</button></div>
        {list === null ? <p className="text-sm text-[#8ea3bf]">{dict.common.loading}</p> : list.length > 0 && (
          <ul className="flex flex-col gap-2">{list.map((a) => (
            <li key={a.id}><button type="button" data-pick-logo={a.id} disabled={!a.rights_ok} onClick={() => onPick(a.id)}
              className="flex w-full items-center gap-3 rounded-ctl border border-[#1e90ff]/60 bg-[#0b2a52] px-3 py-2 text-left text-sm hover:bg-[#0d3a6e] disabled:opacity-50">
              <LogoImg id={a.id} size={40} />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{dict.body.reelstage.logoUse.replace("{a}", a.name)}</span>
                <span className="block truncate text-xs text-[#8ea3bf]">{a.rights_ok ? dict.body.reelstage.logoRights.replace("{a}", a.rights_holder) : dict.body.reelstage.logoRightsNotOk}</span></span>
            </button></li>))}
          </ul>)}
        <div className="flex flex-col gap-2 rounded-ctl border border-[#12335f] p-3">
          <p className="text-sm font-semibold">{dict.body.reelstage.logoUploadNew.replace("{a}", what)}</p>
          <input type="file" accept="image/png,image/jpeg" aria-label={dict.body.reelstage.logoFileAria} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          {fileErr && <p className="text-xs text-[#ff8a8a]">{fileErr}</p>}
          <input className={field} placeholder={dict.body.reelstage.logoNamePlaceholder} aria-label={dict.body.reelstage.logoNameAria} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <input className={field} placeholder={dict.body.reelstage.logoHolderPlaceholder} aria-label={dict.body.reelstage.logoHolderAria} value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="off" />
          <select className={field} aria-label={dict.body.reelstage.logoBasisAria} value={basis} onChange={(e) => setBasis(e.target.value as BrandRightsBasis)}>
            <option value="">{dict.body.reelstage.logoBasisEmpty}</option>{BASIS.map((v) => <option key={v} value={v}>{basisWords[v]}</option>)}
          </select>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-1" />
            <span>{dict.body.reelstage.logoConfirm}</span></label>
          {err && <p className="text-xs text-[#ff8a8a]">{err}</p>}
          <button type="button" data-upload-logo="" disabled={!ready} onClick={() => void upload()}
            className="rounded-ctl border border-ok/60 bg-ok/15 px-3 py-2 text-sm font-semibold hover:bg-ok/25 disabled:opacity-50">{busy ? dict.body.reelstage.logoUploading : dict.body.reelstage.logoUploadUse}</button>
          <p className="text-xs text-[#8ea3bf]">{dict.body.reelstage.logoFormatNote}</p>
        </div>
      </div>
    </div>
  );
}
const TX = 2157, TW = 355;

function Slider({ label, y, pct, on, onPct, note }: { label: string; y: number; pct: number; on: boolean; onPct?: (p: number) => void; note: string }) {
  const track = useRef<HTMLDivElement | null>(null);
  const at = (cx: number) => { const b = track.current?.getBoundingClientRect(); if (b && onPct) onPct(Math.max(0, Math.min(1, (cx - b.left) / b.width))); };
  const fillW = pct * TW;
  return (
    <>
      <B x={TX} y={y - 5} w={TW} h={10} style={{ background: "#0b2a4d", borderRadius: u(5), opacity: on ? 1 : 0.5 }} />
      <B x={TX} y={y - 5} w={fillW} h={10} style={{ background: "#1e90ff", borderRadius: u(5), opacity: on ? 1 : 0 }} />
      <B x={TX + fillW - 11} y={y - 11} w={22} h={22} style={{ background: "#cfe8ff", border: `${u(3)} solid #33a8ff`, borderRadius: "50%", boxSizing: "border-box", opacity: on ? 1 : 0.4 }} />
      <div ref={track} role="slider" aria-label={label} title={on ? note : note} aria-disabled={!on} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} tabIndex={on ? 0 : -1}
        onPointerDown={(e) => { if (!on) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); at(e.clientX); }}
        onPointerMove={(e) => { if (on && e.buttons === 1) at(e.clientX); }}
        onKeyDown={(e) => { if (!on || !onPct) return; if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onPct(Math.min(1, pct + 0.05)); } if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onPct(Math.max(0, pct - 0.05)); } }}
        className="absolute" style={{ left: u(TX - 12), top: u(y - 16 - 101), width: u(TW + 24), height: u(32), cursor: on ? "pointer" : "not-allowed", touchAction: "none" }} />
    </>
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
  /** one switch row: real when `onClick` is given, otherwise disabled with the reason */
  const row = (l: string, y: number, icon: string, on: boolean, act: (() => void) | undefined, reason: string | undefined, data: Record<string, string>) => (
    <div key={l} {...data}>
      <Ic x={2107} y={y} k={icon} size={32} color={act ? "#fff" : "#6a84aa"} />
      <T x={2154} y={y} size={20} color={act ? "#e3eefb" : "#8ea3bf"}>{l}</T>
      <Switch x={2461} y={y} on={on} off={!act} />
      <Hit x={2150} y={y - 18} w={375} h={36} label={l} pressed={on} {...(act ? { onClick: act } : { reason: reason ?? dict.body.reelstage.openReelEdit })} />
    </div>
  );
  const editable = (reason?: string) => (canEdit && !reason ? undefined : reason ?? (reel ? dict.body.reelstage.cannotEdit : dict.body.reelstage.openReelFirst));
  const render = reel?.latest_render ?? null;
  const active = !!render && ["QUEUED", "RUNNING"].includes(render.state);
  const border = (id: string) => (focus === id ? { borderColor: "#33a8ff" } : undefined);

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
    <>
      <section aria-label={dict.body.reelstage.inspectorTabsAria} data-section="p06-s08">
        <B x={2065} y={122} w={475} h={64} style={{ background: "#071a33", borderRadius: u(10) }} />
        <B x={2068 + tab * 158} y={183} w={157} h={3} style={{ background: "#1e90ff" }} />
        <div role="tablist" aria-label={dict.body.reelstage.inspectorAria}>
          {TABS.map(([l, x, target], i) => (
            <Hit key={l} x={2068 + i * 158} y={124} w={157} h={58} label={tabNames[i] ?? l} pressed={tab === i} onClick={() => jump(target)}>
              <T o={[2068 + i * 158, 124]} x={x} y={153} size={23} weight={tab === i ? 600 : 400} color={tab === i ? "#6cc4ff" : "#cfe0f5"} align="center" as="span">{tabNames[i] ?? l}</T>
            </Hit>
          ))}
        </div>
      </section>

      <section id="p06-spotlight" aria-label={dict.body.reels.spotlightControls} data-section="p06-s09">
        <P x={2065} y={195} w={475} h={411} style={border("p06-spotlight")} />
        <T x={2086} y={227} size={23} weight={600} as="h2">{dict.body.reels.spotlightControls}</T>
        {/* B.16 (ADR-092): built-in starting looks; any slider change makes it "Custom" */}
        <select aria-label={dict.body.reelstage.spotlightPresetAria} data-spotlight-preset={presetOf(set) ?? "custom"} value={presetOf(set) ?? ""} disabled={!canEdit}
          title={presetWords[presetOf(set) ?? ""]?.[1] ?? dict.body.reelstage.presetCustomNote}
          onChange={(e) => { const p = SPOTLIGHT_PRESETS.find((x) => x.key === e.target.value); if (p) setDraft({ ...set, ...p.look }); }}
          className="absolute" style={{ left: u(2296), top: u(212 - 101), width: u(124), height: u(32), fontSize: u(16), color: "#fff", background: "#041022",
            border: `${u(1.5)} solid #17406f`, borderRadius: u(6), padding: `0 ${u(4)}` }}>
          <option value="" disabled>{dict.body.reelstage.presetCustom}</option>
          {SPOTLIGHT_PRESETS.map((p) => <option key={p.key} value={p.key}>{presetWords[p.key]?.[0] ?? p.name}</option>)}
        </select>
        <T x={2519} y={227} size={20} color="#33a8ff" align="right">{dict.body.reelstage.resetAll}</T>
        <Hit x={2430} y={210} w={100} h={34} label={dict.body.reelstage.resetAllHit} {...(canEdit ? { onClick: () => setDraft({ ...set, dim: DEFAULTS.dim, size: DEFAULTS.size, vignette: DEFAULTS.vignette, feather: DEFAULTS.feather, lock: DEFAULTS.lock }) } : { reason: dict.body.reelstage.openReelEdit })} />
        {SLIDERS.map(([stable, icon, ly, ty, key, min, max]) => {
          const [label, note] = sliderWords[key];
          const pct = (set[key] - min) / (max - min);
          return (
            <div key={stable} data-slider={stable}>
              <Ic x={2107} y={ly + 10} k={icon} size={36} color="#33a8ff" />
              <T x={2157} y={ly} size={22} color="#e3eefb">{label}</T>
              <T x={2512} y={ly} size={21} color="#cfe0f5" align="right">{`${Math.round(pct * 100)}%`}</T>
              <Slider label={label} y={ty} pct={pct} on={!!reel && !!r?.canEdit} note={!reel ? dict.body.reelstage.sliderNoteNoReel : note}
                {...(reel ? { onPct: (p: number) => setDraft({ ...set, [key]: Math.round((min + p * (max - min)) * 100) / 100 }) } : {})} />
            </div>
          );
        })}
      </section>

      <section id="p06-target" aria-label={dict.body.reels.playerTargeting} data-section="p06-s10">
        <P x={2065} y={618} w={475} h={204} style={border("p06-target")} />
        <T x={2086} y={647} size={23} weight={600} as="h2">{dict.body.reels.playerTargeting}</T>
        <Ic x={2105} y={693} k="tgt" size={30} />
        <T x={2149} y={693} size={20}>{dict.body.reelstage.autoTrack}</T>
        <Switch x={2461} y={693} on={set.auto_track} off={!canEdit} />
        <Hit x={2145} y={675} w={380} h={36} label={dict.body.reelstage.autoTrackHit}
          pressed={set.auto_track} {...(canEdit ? { onClick: () => setDraft({ ...set, auto_track: !set.auto_track }) } : { reason: reel ? dict.body.reelstage.cannotEdit : dict.body.reelstage.openReelFirst })} />
        <Ic x={2105} y={738} k="tgt" size={30} color="#33a8ff" />
        <T x={2149} y={738} size={20} style={{ maxWidth: u(240), overflow: "hidden", textOverflow: "ellipsis" }}>{dict.body.reelstage.lockOn}</T>
        <T x={2519} y={738} size={17} color={reel?.player && !reel.stale ? "#3ee6a8" : "#8ea3bf"} align="right">{reel?.player ? (reel.stale ? dict.body.reelstage.lockNeedsRefresh : dict.body.reelstage.lockLocked) : dict.body.reelstage.lockNone}</T>
        {reel?.player && (
          <button type="button" onClick={openProfileIntro} className="absolute" data-profile-intro-open=""
            style={{ left: u(2086), top: u(634 - 101), fontSize: u(18), color: "#33a8ff" }}>{dict.body.reelstage.profileIntroLink}</button>
        )}
        {reel?.player && reel.video_id && (
          // ADR-045: his other tracks are found on the Analysis page (look-alikes, a person says Him / Not him); Re-detect then takes them in
          // ADR-131: a cross-match reel has no single video to look in — the link is hidden for it
          <Link href={`/analysis?video=${reel.video_id}&find=${reel.player.player_id}`} className="absolute" data-find-more
            style={{ left: u(2299), width: u(220), textAlign: "right", top: u(634 - 101), fontSize: u(18), color: "#33a8ff" }}>{dict.body.reelstage.findMore}</Link>
        )}
        <B x={2086} y={765} w={434} h={43} style={input} />
        <Ic x={2230} y={788} k="ref" size={22} color={reel?.stale ? "#ff8a8a" : "#fff"} />
        <T x={2255} y={788} size={20} color={reel?.stale ? "#ff8a8a" : undefined}>{dict.body.reelstage.redetect}</T>
        <Hit x={2086} y={765} w={434} h={43} label={dict.body.reelstage.redetectHit} {...(canEdit ? { onClick: () => { const before = r?.moments?.length ?? 0; r?.run(() => api<Reel>(`/v1/reels/${reel!.id}/refresh-targets`, { method: "POST" }),
          (nr, m) => dict.body.reelstage.redetectedMsg.replace("{a}", String(nr?.targets.length ?? 0)).replace("{b}", nr?.player?.display_name ?? dict.body.reels.momentsIntroPlayer).replace("{c}", String(before)).replace("{d}", String(m?.length ?? 0))); } } : { reason: reel ? dict.body.reelstage.cannotEdit : dict.body.reelstage.openReelFirst })} />
      </section>

      <section id="p06-overlays" aria-label={dict.body.reelstage.summaryOverlays} data-section="p06-s11">
        <P x={2065} y={834} w={475} h={242} style={border("p06-overlays")} />
        <T x={2086} y={864} size={23} weight={600} as="h2">{dict.body.reelstage.summaryOverlays}</T>
        {(() => {
          const on = (k: Toggle) => (editable() ? undefined : () => flip(k));
          const sr = editable(set.score_bug ? undefined : scoreReason);
          return [
            row(dict.body.reelstage.overlayPlayerCard, 912, "ball", set.name_caption, on("name_caption"), editable(), { "data-overlay": "Player Info Card" }),
            row(dict.body.reelstage.overlayScore, 957, "ball", set.score_bug, sr ? undefined : () => flip("score_bug"), sr, { "data-overlay": "Match Score & Time" }),
            row(dict.body.reelstage.overlayCompLogo, 1000, "ball", !!set.competition_logo_id, editable() ? undefined : () => logo("competition_logo_id"), editable(), { "data-overlay": "Competition Logo" }),
            row(dict.body.reelstage.overlayLowerThird, 1042, "pl", set.lower_third, on("lower_third"), editable(), { "data-overlay": "Animated Lower Third" }),
          ];
        })()}
        <T x={2154} y={1067} size={13} color="#8ea3bf" style={{ maxWidth: u(370), whiteSpace: "normal", lineHeight: 1.2 }}>{!reel?.match ? (reel?.source === "ALL_MATCHES" ? dict.body.reelstage.scoreNoteAll : dict.body.reelstage.scoreNoteNoMatch) : reel.match.clock === "CONFIRMED"
          ? dict.body.reelstage.scoreNoteConfirmed : dict.body.reelstage.scoreNoteUnconfirmed}</T>
      </section>

      <section id="p06-branding" aria-label={dict.body.reelstage.summaryBranding} data-section="p06-s12">
        <P x={2065} y={1080} w={475} h={182} style={border("p06-branding")} />
        <T x={2086} y={1108} size={23} weight={600} as="h2">{dict.body.reels.branding}</T>
        {/* ADR-050 (owner 2026-11-02): event tags, the match card and an intro / outro video, in one dialog */}
        <button type="button" data-reel-extras="" onClick={() => setExtras(true)} disabled={!canEdit} title={canEdit ? undefined : reel ? dict.body.reelstage.cannotEdit : dict.body.reelstage.openReelFirst}
          className="absolute disabled:opacity-60" style={{ left: u(2259), width: u(260), textAlign: "right", top: u(1096 - 101), fontSize: u(18), color: "#33a8ff" }}>
          {set.intro_id || set.outro_id ? dict.body.reelstage.brandingExtras : dict.body.reelstage.brandingExtrasNone}</button>
        {row(dict.body.reelstage.brandingWatermark, 1153, "ball", set.watermark, editable() ? undefined : () => flip("watermark"), editable(), { "data-branding": "Use OTSI VIE Watermark" })}
        {row(dict.body.reelstage.brandingCustomLogo, 1196, "plus", !!set.custom_logo_id, editable() ? undefined : () => logo("custom_logo_id"), editable(), { "data-branding": "Custom Logo" })}
        {row(dict.body.reelstage.brandingEndScreen, 1237, "scr", set.end_screen, editable() ? undefined : () => flip("end_screen"), editable(), { "data-branding": "End Screen" })}
      </section>
      {reel && <ConfirmRender reel={reel} settings={set} codec={codec} dirty={dirty} open={confirm} onOpenChange={setConfirm} onStart={generate} />}
      {extras && draft && <ReelExtras settings={draft} onChange={setDraft} onClose={() => setExtras(false)} />}
      {picker && <LogoPicker kind={LOGO_KIND[picker]} onClose={() => setPicker(null)} onPick={(id) => { setDraft({ ...set, [picker]: id } as SpotlightSettings); setPicker(null); }} />}

      <section aria-label={dict.body.reels.output} data-section="p06-s13" data-render-state={render?.state ?? "NONE"}>
        <B x={2083} y={1268} w={441} h={70} style={{ background: active && stopAsk ? "#c0392b" : "#0a84ff", borderRadius: u(8), opacity: genReason ? 0.7 : 1 }} />
        <B x={2468} y={1278} w={1.5} h={50} style={{ background: "#4fa8ff" }} />
        <Ic x={active ? 2150 : 2228} y={1304} k={active ? "sq" : "dl"} size={26} />
        <T x={active ? 2179 : 2257} y={1304} size={22} weight={700}>{genLabel}</T>
        {!active && <T x={2455} y={1304} size={15} color="#d6e4f7" align="right">{codec === "h264" ? "H.264" : codec === "av1" ? "AV1" : "VP9"}</T>}
        {!active && <Ic x={2496} y={1304} k="chev" size={20} />}
        <Hit x={2083} y={1268} w={385} h={70} label={active ? (stopAsk ? dict.body.reelstage.clickAgainStopHit : dict.body.reelstage.stopRendering) : dict.body.reelstage.genLabel}
          {...(genReason ? { reason: genReason } : { onClick: active ? stop : () => setConfirm(true) })} />
        {!active && <select aria-label={dict.body.reels.codecLabel} value={codec} onChange={(e) => setCodec(e.target.value as typeof codec)} className="absolute"
          style={{ left: u(2470), top: u(1268 - 101), width: u(54), height: u(70), opacity: 0, cursor: "pointer" }}>
          <option value="h264">{dict.body.reels.codecH264}</option><option value="av1">{dict.body.reels.codecAv1}</option><option value="vp9">{dict.body.reels.codecVp9}</option>
        </select>}
        <B x={2083} y={1351} w={214} h={57} style={{ ...input, opacity: render?.state === "SUCCEEDED" ? 1 : 0.7 }} />
        <Ic x={2119} y={1380} k="eye" size={26} />
        <T x={2147} y={1380} size={20} weight={600}>{mode === "render" ? dict.body.reelstage.showingRender : dict.body.reels.previewRender}</T>
        <Hit x={2083} y={1351} w={214} h={57} label={dict.body.reels.previewRender} pressed={mode === "render"} {...(render?.state === "SUCCEEDED" ? { onClick: () => setMode(mode === "render" ? "clip" : "render") } : { reason: dict.body.reelstage.previewNoRender })} />
        <B x={2311} y={1351} w={213} h={57} style={{ ...input, opacity: canEdit && dirty ? 1 : 0.8, ...(saving === "saved" && !dirty ? { borderColor: "#3ee6a8" } : canEdit && dirty ? { borderColor: "#33a8ff" } : {}) }} />
        <Ic x={2357} y={1380} k="fold" size={26} color={saving === "saved" && !dirty ? "#3ee6a8" : "#fff"} />
        <T x={2386} y={1380} size={20} weight={600} color={saving === "saved" && !dirty ? "#3ee6a8" : undefined}>
          {saving === "saving" ? dict.body.reelstage.savingDots : saving === "saved" && !dirty ? dict.body.reelstage.savedCheck : dict.body.reels.saveProject}
        </T>
        <Hit x={2311} y={1351} w={213} h={57} label={dict.body.reels.saveProject} {...(canEdit && saving !== "saving" ? { onClick: () => void saveNow() } : { reason: !reel ? dict.body.reelstage.openReelFirst : saving === "saving" ? dict.body.reelstage.savingDots : dict.body.reelstage.cannotEdit })} />
      </section>
    </>
  );
}
