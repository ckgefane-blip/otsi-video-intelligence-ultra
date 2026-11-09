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
import { Hit } from "@/components/workspace/shared";
import { ConfirmRender } from "./ConfirmRender";
import { ReelExtras } from "./ReelExtras";
import { DEFAULTS, input, Switch, useStage } from "./shared";

const TABS: [string, number, string][] = [["Spotlight", 2146, "p06-spotlight"], ["Overlays", 2302, "p06-overlays"], ["Branding", 2459, "p06-branding"]];
type Key = "dim" | "size" | "feather" | "vignette" | "lock";
const SLIDERS: [string, string, number, number, Key, number, number, string][] = [
  ["Spotlight Intensity", "sun", 277, 305, "dim", 0, 0.9, "How bright the beam of light on the player is; the rest of the picture dims a little"],
  ["Ray Width", "tri", 345, 373, "size", 0.8, 3, "Width of the beam of light on the player"],
  ["Vignette Strength", "ring", 413, 441, "vignette", 0, 1, "How much the corners of the picture are darkened"],
  ["Glow Amount", "spark", 482, 511, "feather", 0.05, 1.5, "Softness of the beam's edges"],
  ["Target Lock Sensitivity", "tgt", 551, 578, "lock", 0, 1, "Low: the spotlight shows only where he was clearly found. High: it also bridges short moments he was hidden. It never follows another player."],
];
type Toggle = "name_caption" | "score_bug" | "lower_third" | "watermark" | "end_screen";
type LogoField = "competition_logo_id" | "custom_logo_id";
const LOGO_KIND: Record<LogoField, BrandAssetKind> = { competition_logo_id: "COMPETITION_LOGO", custom_logo_id: "CUSTOM_LOGO" };
const BASIS: [BrandRightsBasis, string][] = [["OWN_BRAND", "It is our own logo"], ["LICENSED", "We have a licence for it"], ["PERMISSION", "The owner gave us written permission"]];

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
  const [list, setList] = useState<BrandAsset[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [holder, setHolder] = useState("");
  const [basis, setBasis] = useState<BrandRightsBasis | "">("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const what = kind === "COMPETITION_LOGO" ? "competition logo" : "custom logo";
  useEffect(() => { void api<BrandAsset[]>(`/v1/brand-assets?kind=${kind}`).then(setList, () => setList([])); }, [kind]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const fileErr = file && file.size > BRAND_MAX_BYTES ? "The picture is larger than 512 KB." : file && !/^image\/(png|jpeg)$/.test(file.type) ? "Choose a PNG or JPEG picture." : null;
  const ready = !!file && !fileErr && name.trim().length > 0 && holder.trim().length >= 2 && !!basis && ok && !busy;
  const upload = async () => {
    if (!file || !basis) return;
    setBusy(true); setErr(null);
    try {
      const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("read")); fr.readAsDataURL(file); });
      const a = await api<BrandAsset>("/v1/brand-assets", { method: "POST", json: { kind, name: name.trim(), rights_holder: holder.trim(), rights_basis: basis, confirm_rights: true, data_base64: data } });
      onPick(a.id);
    } catch (e) { setErr(e instanceof Error ? e.message : "The upload failed."); } finally { setBusy(false); }
  };
  const field = "w-full rounded-ctl border border-[#17406f] bg-[#041022] px-2 py-1.5 text-sm";
  return (
    <div role="dialog" aria-modal="true" aria-label={`Choose a ${what}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-[min(520px,94vw)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#1e90ff] bg-[#071a33] p-4 text-[#e3eefb]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Choose a {what}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="px-2 text-lg">✕</button></div>
        {list === null ? <p className="text-sm text-[#8ea3bf]">Loading…</p> : list.length > 0 && (
          <ul className="flex flex-col gap-2">{list.map((a) => (
            <li key={a.id}><button type="button" data-pick-logo={a.id} disabled={!a.rights_ok} onClick={() => onPick(a.id)}
              className="flex w-full items-center gap-3 rounded-ctl border border-[#1e90ff]/60 bg-[#0b2a52] px-3 py-2 text-left text-sm hover:bg-[#0d3a6e] disabled:opacity-50">
              <LogoImg id={a.id} size={40} />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">Use {a.name}</span>
                <span className="block truncate text-xs text-[#8ea3bf]">{a.rights_ok ? `Rights: ${a.rights_holder}` : "Rights not in force"}</span></span>
            </button></li>))}
          </ul>)}
        <div className="flex flex-col gap-2 rounded-ctl border border-[#12335f] p-3">
          <p className="text-sm font-semibold">Upload a new {what}</p>
          <input type="file" accept="image/png,image/jpeg" aria-label="Logo file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          {fileErr && <p className="text-xs text-[#ff8a8a]">{fileErr}</p>}
          <input className={field} placeholder="Name, e.g. Premier League" aria-label="Logo name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <input className={field} placeholder="Who owns this logo?" aria-label="Rights holder" value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="off" />
          <select className={field} aria-label="Why you may use it" value={basis} onChange={(e) => setBasis(e.target.value as BrandRightsBasis)}>
            <option value="">Why may you use it?</option>{BASIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-1" />
            <span>I confirm we have the right to show this logo in our reels.</span></label>
          {err && <p className="text-xs text-[#ff8a8a]">{err}</p>}
          <button type="button" data-upload-logo="" disabled={!ready} onClick={() => void upload()}
            className="rounded-ctl border border-ok/60 bg-ok/15 px-3 py-2 text-sm font-semibold hover:bg-ok/25 disabled:opacity-50">{busy ? "Uploading…" : "Upload and use"}</button>
          <p className="text-xs text-[#8ea3bf]">PNG or JPEG, up to 512 KB. Your statement is recorded with your name.</p>
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
  const { r, draft, setDraft, name, dirty, save, focus, jump, tab, mode, setMode } = useStage();
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
  const saveNow = async () => {
    setSaving("saving");
    setSaving((await save()) ? "saved" : null);
  };
  const set = draft ?? DEFAULTS;
  const canEdit = !!r?.canEdit && !r.busy && !!reel;
  const flip = (k: Toggle) => setDraft({ ...set, [k]: !set[k] });
  const logo = (f: LogoField) => (set[f] ? setDraft({ ...set, [f]: null }) : setPicker(f));
  const scoreReason = !reel?.match ? "Link this video to a match first: the team names come from the match" : undefined;
  /** one switch row: real when `onClick` is given, otherwise disabled with the reason */
  const row = (l: string, y: number, icon: string, on: boolean, act: (() => void) | undefined, reason: string | undefined, data: Record<string, string>) => (
    <div key={l} {...data}>
      <Ic x={2107} y={y} k={icon} size={32} color={act ? "#fff" : "#6a84aa"} />
      <T x={2154} y={y} size={20} color={act ? "#e3eefb" : "#8ea3bf"}>{l}</T>
      <Switch x={2461} y={y} on={on} off={!act} />
      <Hit x={2150} y={y - 18} w={375} h={36} label={l} pressed={on} {...(act ? { onClick: act } : { reason: reason ?? "Open a reel you can edit" })} />
    </div>
  );
  const editable = (reason?: string) => (canEdit && !reason ? undefined : reason ?? (reel ? "You cannot edit this reel" : "Open a reel first"));
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
    }, "Rendering started.");
  };
  const stop = () => {
    if (!r || !render) return;
    if (!stopAsk) { setStopAsk(true); return; }
    setStopAsk(false);
    r.run(async () => { await api(`/v1/renders/${render.id}/cancel`, { method: "POST" }); }, "Rendering stopped. Change the clips, then Generate Reel again.");
  };
  const genReason = !reel ? "Open a reel first" : !r?.canEdit ? "You cannot edit this reel" : reel.stale ? "An identity this reel follows was corrected: re-detect the player first"
    : reel.clips.length === 0 && !active ? "Add at least one moment first" : undefined;
  const pct = render?.progress != null ? ` ${Math.round(render.progress)}%` : "";
  const genLabel = active ? (stopAsk ? "Click again to stop" : `Stop rendering${pct}`) : render?.state === "SUCCEEDED" ? "Generate Reel again" : "Generate Reel";

  return (
    <>
      <section aria-label="Inspector tabs" data-section="p06-s08">
        <B x={2065} y={122} w={475} h={64} style={{ background: "#071a33", borderRadius: u(10) }} />
        <B x={2068 + tab * 158} y={183} w={157} h={3} style={{ background: "#1e90ff" }} />
        <div role="tablist" aria-label="Inspector">
          {TABS.map(([l, x, target], i) => (
            <Hit key={l} x={2068 + i * 158} y={124} w={157} h={58} label={l} pressed={tab === i} onClick={() => jump(target)}>
              <T o={[2068 + i * 158, 124]} x={x} y={153} size={23} weight={tab === i ? 600 : 400} color={tab === i ? "#6cc4ff" : "#cfe0f5"} align="center" as="span">{l}</T>
            </Hit>
          ))}
        </div>
      </section>

      <section id="p06-spotlight" aria-label="Spotlight controls" data-section="p06-s09">
        <P x={2065} y={195} w={475} h={411} style={border("p06-spotlight")} />
        <T x={2086} y={227} size={23} weight={600} as="h2">Spotlight Controls</T>
        {/* B.16 (ADR-092): built-in starting looks; any slider change makes it "Custom" */}
        <select aria-label="Spotlight preset" data-spotlight-preset={presetOf(set) ?? "custom"} value={presetOf(set) ?? ""} disabled={!canEdit}
          title={SPOTLIGHT_PRESETS.find((p) => p.key === presetOf(set))?.note ?? "Custom: your own slider values"}
          onChange={(e) => { const p = SPOTLIGHT_PRESETS.find((x) => x.key === e.target.value); if (p) setDraft({ ...set, ...p.look }); }}
          className="absolute" style={{ left: u(2296), top: u(212 - 101), width: u(124), height: u(32), fontSize: u(16), color: "#fff", background: "#041022",
            border: `${u(1.5)} solid #17406f`, borderRadius: u(6), padding: `0 ${u(4)}` }}>
          <option value="" disabled>Custom</option>
          {SPOTLIGHT_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
        <T x={2519} y={227} size={20} color="#33a8ff" align="right">Reset All</T>
        <Hit x={2430} y={210} w={100} h={34} label="Reset all spotlight controls" {...(canEdit ? { onClick: () => setDraft({ ...set, dim: DEFAULTS.dim, size: DEFAULTS.size, vignette: DEFAULTS.vignette, feather: DEFAULTS.feather, lock: DEFAULTS.lock }) } : { reason: "Open a reel you can edit" })} />
        {SLIDERS.map(([label, icon, ly, ty, key, min, max, note]) => {
          const pct = (set[key] - min) / (max - min);
          return (
            <div key={label} data-slider={label}>
              <Ic x={2107} y={ly + 10} k={icon} size={36} color="#33a8ff" />
              <T x={2157} y={ly} size={22} color="#e3eefb">{label}</T>
              <T x={2512} y={ly} size={21} color="#cfe0f5" align="right">{`${Math.round(pct * 100)}%`}</T>
              <Slider label={label} y={ty} pct={pct} on={!!reel && !!r?.canEdit} note={!reel ? "Open a reel first: a reel is created from a player a person confirmed" : note}
                {...(reel ? { onPct: (p: number) => setDraft({ ...set, [key]: Math.round((min + p * (max - min)) * 100) / 100 }) } : {})} />
            </div>
          );
        })}
      </section>

      <section id="p06-target" aria-label="Player targeting" data-section="p06-s10">
        <P x={2065} y={618} w={475} h={204} style={border("p06-target")} />
        <T x={2086} y={647} size={23} weight={600} as="h2">Player Targeting</T>
        <Ic x={2105} y={693} k="tgt" size={30} />
        <T x={2149} y={693} size={20}>Auto Track Player</T>
        <Switch x={2461} y={693} on={set.auto_track} off={!canEdit} />
        <Hit x={2145} y={675} w={380} h={36} label="Auto Track Player: on = he is re-found 10 times a second in every clip (smooth spotlight, slower render); off = the analysis positions only (faster)"
          pressed={set.auto_track} {...(canEdit ? { onClick: () => setDraft({ ...set, auto_track: !set.auto_track }) } : { reason: reel ? "You cannot edit this reel" : "Open a reel first" })} />
        <Ic x={2105} y={738} k="tgt" size={30} color="#33a8ff" />
        <T x={2149} y={738} size={20} style={{ maxWidth: u(240), overflow: "hidden", textOverflow: "ellipsis" }}>Lock on confirmed player</T>
        <T x={2519} y={738} size={17} color={reel?.player && !reel.stale ? "#3ee6a8" : "#8ea3bf"} align="right">{reel?.player ? (reel.stale ? "needs refresh" : "locked") : "none"}</T>
        {reel?.player && (
          // ADR-045: his other tracks are found on the Analysis page (look-alikes, a person says Him / Not him); Re-detect then takes them in
          <Link href={`/analysis?video=${reel.video_id}&find=${reel.player.player_id}`} className="absolute" data-find-more
            style={{ left: u(2299), width: u(220), textAlign: "right", top: u(634 - 101), fontSize: u(18), color: "#33a8ff" }}>Find more of him ›</Link>
        )}
        <B x={2086} y={765} w={434} h={43} style={input} />
        <Ic x={2230} y={788} k="ref" size={22} color={reel?.stale ? "#ff8a8a" : "#fff"} />
        <T x={2255} y={788} size={20} color={reel?.stale ? "#ff8a8a" : undefined}>Re-detect Player</T>
        <Hit x={2086} y={765} w={434} h={43} label="Re-detect player: refresh the followed tracks" {...(canEdit ? { onClick: () => { const before = r?.moments?.length ?? 0; r?.run(() => api<Reel>(`/v1/reels/${reel!.id}/refresh-targets`, { method: "POST" }),
          (nr, m) => `Re-detected: following ${nr?.targets.length ?? 0} confirmed tracks of ${nr?.player?.display_name ?? "the player"}; suggested moments ${before} → ${m?.length ?? 0}.`); } } : { reason: reel ? "You cannot edit this reel" : "Open a reel first" })} />
      </section>

      <section id="p06-overlays" aria-label="Overlays" data-section="p06-s11">
        <P x={2065} y={834} w={475} h={242} style={border("p06-overlays")} />
        <T x={2086} y={864} size={23} weight={600} as="h2">Overlays</T>
        {(() => {
          const on = (k: Toggle) => (editable() ? undefined : () => flip(k));
          const sr = editable(set.score_bug ? undefined : scoreReason);
          return [
            row("Player Info Card", 912, "ball", set.name_caption, on("name_caption"), editable(), { "data-overlay": "Player Info Card" }),
            row("Match Score & Time", 957, "ball", set.score_bug, sr ? undefined : () => flip("score_bug"), sr, { "data-overlay": "Match Score & Time" }),
            row("Competition Logo", 1000, "ball", !!set.competition_logo_id, editable() ? undefined : () => logo("competition_logo_id"), editable(), { "data-overlay": "Competition Logo" }),
            row("Animated Lower Third", 1042, "pl", set.lower_third, on("lower_third"), editable(), { "data-overlay": "Animated Lower Third" }),
          ];
        })()}
        <T x={2154} y={1067} size={13} color="#8ea3bf" style={{ maxWidth: u(370), whiteSpace: "normal", lineHeight: 1.2 }}>{!reel?.match ? "Score & Time needs the video linked to a match." : reel.match.clock === "CONFIRMED"
          ? "Score & Time: team names and match clock (score not measured)." : "Score & Time: team names; confirm the halves on Analysis for the clock."}</T>
      </section>

      <section id="p06-branding" aria-label="Branding" data-section="p06-s12">
        <P x={2065} y={1080} w={475} h={182} style={border("p06-branding")} />
        <T x={2086} y={1108} size={23} weight={600} as="h2">Branding</T>
        {/* ADR-050 (owner 2026-11-02): event tags, the match card and an intro / outro video, in one dialog */}
        <button type="button" data-reel-extras="" onClick={() => setExtras(true)} disabled={!canEdit} title={canEdit ? undefined : reel ? "You cannot edit this reel" : "Open a reel first"}
          className="absolute disabled:opacity-60" style={{ left: u(2259), width: u(260), textAlign: "right", top: u(1096 - 101), fontSize: u(18), color: "#33a8ff" }}>
          {set.intro_id || set.outro_id ? "Intro / outro ✓, tags ›" : "Intro, outro, tags ›"}</button>
        {row("Use OTSI VIE Watermark", 1153, "ball", set.watermark, editable() ? undefined : () => flip("watermark"), editable(), { "data-branding": "Use OTSI VIE Watermark" })}
        {row("Custom Logo", 1196, "plus", !!set.custom_logo_id, editable() ? undefined : () => logo("custom_logo_id"), editable(), { "data-branding": "Custom Logo" })}
        {row("End Screen", 1237, "scr", set.end_screen, editable() ? undefined : () => flip("end_screen"), editable(), { "data-branding": "End Screen" })}
      </section>
      {reel && <ConfirmRender reel={reel} settings={set} codec={codec} dirty={dirty} open={confirm} onOpenChange={setConfirm} onStart={generate} />}
      {extras && draft && <ReelExtras settings={draft} onChange={setDraft} onClose={() => setExtras(false)} />}
      {picker && <LogoPicker kind={LOGO_KIND[picker]} onClose={() => setPicker(null)} onPick={(id) => { setDraft({ ...set, [picker]: id } as SpotlightSettings); setPicker(null); }} />}

      <section aria-label="Output" data-section="p06-s13" data-render-state={render?.state ?? "NONE"}>
        <B x={2083} y={1268} w={441} h={70} style={{ background: active && stopAsk ? "#c0392b" : "#0a84ff", borderRadius: u(8), opacity: genReason ? 0.7 : 1 }} />
        <B x={2468} y={1278} w={1.5} h={50} style={{ background: "#4fa8ff" }} />
        <Ic x={active ? 2150 : 2228} y={1304} k={active ? "sq" : "dl"} size={26} />
        <T x={active ? 2179 : 2257} y={1304} size={22} weight={700}>{genLabel}</T>
        {!active && <T x={2455} y={1304} size={15} color="#d6e4f7" align="right">{codec === "h264" ? "H.264" : codec === "av1" ? "AV1" : "VP9"}</T>}
        {!active && <Ic x={2496} y={1304} k="chev" size={20} />}
        <Hit x={2083} y={1268} w={385} h={70} label={active ? (stopAsk ? "Click again to stop the render" : "Stop rendering") : "Generate Reel"}
          {...(genReason ? { reason: genReason } : { onClick: active ? stop : () => setConfirm(true) })} />
        {!active && <select aria-label="Video codec" value={codec} onChange={(e) => setCodec(e.target.value as typeof codec)} className="absolute"
          style={{ left: u(2470), top: u(1268 - 101), width: u(54), height: u(70), opacity: 0, cursor: "pointer" }}>
          <option value="h264">H.264 MP4 (plays everywhere)</option><option value="av1">AV1 MP4 (royalty-free)</option><option value="vp9">VP9 WebM (royalty-free)</option>
        </select>}
        <B x={2083} y={1351} w={214} h={57} style={{ ...input, opacity: render?.state === "SUCCEEDED" ? 1 : 0.7 }} />
        <Ic x={2119} y={1380} k="eye" size={26} />
        <T x={2147} y={1380} size={20} weight={600}>{mode === "render" ? "Showing render" : "Preview Render"}</T>
        <Hit x={2083} y={1351} w={214} h={57} label="Preview Render" pressed={mode === "render"} {...(render?.state === "SUCCEEDED" ? { onClick: () => setMode(mode === "render" ? "clip" : "render") } : { reason: "No finished render yet: Generate Reel first" })} />
        <B x={2311} y={1351} w={213} h={57} style={{ ...input, opacity: canEdit && dirty ? 1 : 0.8, ...(saving === "saved" && !dirty ? { borderColor: "#3ee6a8" } : canEdit && dirty ? { borderColor: "#33a8ff" } : {}) }} />
        <Ic x={2357} y={1380} k="fold" size={26} color={saving === "saved" && !dirty ? "#3ee6a8" : "#fff"} />
        <T x={2386} y={1380} size={20} weight={600} color={saving === "saved" && !dirty ? "#3ee6a8" : undefined}>
          {saving === "saving" ? "Saving…" : saving === "saved" && !dirty ? "Saved ✓" : "Save Project"}
        </T>
        <Hit x={2311} y={1351} w={213} h={57} label="Save Project" {...(canEdit && saving !== "saving" ? { onClick: () => void saveNow() } : { reason: !reel ? "Open a reel first" : saving === "saving" ? "Saving…" : "You cannot edit this reel" })} />
      </section>
    </>
  );
}
