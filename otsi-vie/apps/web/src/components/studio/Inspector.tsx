"use client";
/**
 * Page 07 Clip Studio — the clip inspector (SOT, Studio.dc.html).
 *
 * Clip: the selected clip's speed (Constant / Slow-mo / Ramp + the speed
 * slider), its zoom (Follow the player — the picture moves in on the
 * confirmed player's PIN track), the reel's look (None / Broadcast /
 * Matte / Contrast), the transitions in and out of the clip, and the
 * logo overlay. Look: the look's strength and colour controls. Brand:
 * the logo and intro / outro assets. Audio: the music and the sound
 * levels. The look names are the SOT's: Matte is the engine's FILM
 * preset, Contrast is PUNCHY. The logo's position is fixed by the
 * renderer (competition logo top-right, custom logo bottom-right), so
 * the grid shows where it goes rather than moving it.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { NEUTRAL_LOOK, isNeutral, zoomAt, type LookPreset, type TransitionKind } from "@otsi-vie/contracts";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { useLocale } from "@/lib/i18n";
import { clipMs, locate, type Placed, type Studio } from "./useStudio";
import { effectName, lookLabelOf } from "./Adjustments";
import type { Ui } from "./kit";

const LOOKS: [LookPreset, string][] = [["NONE", "lookNone"], ["BROADCAST", "lookBroadcast"], ["FILM", "csLookMatte"], ["PUNCHY", "csLookContrast"]];
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

function SpeedSection({ st, placed, can, why, ui }: { st: Studio; placed: Placed | null; can: boolean; why: () => void; ui: Ui }) {
  const { t: dict } = useLocale();
  const s = dict.body.studio;
  const c = placed?.clip ?? null;
  const e = c?.effect ?? null;
  const mode = !e || e.kind === "NONE" ? "NONE" : e.kind === "SLOW" ? "SLOW" : e.kind === "RAMP" ? "RAMP" : "NONE";
  const curSpeed = mode === "SLOW" || mode === "RAMP" ? (e?.speed ?? 1) : 1;
  const [v, setV] = useState(curSpeed);
  useEffect(() => { setV(curSpeed); }, [curSpeed, c?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const head = locate(st.items, st.playhead);
  const keyAt = c && head && head.p.clip.id === c.id && head.src > c.in_pts_us + 100_000 && head.src < c.out_pts_us - 100_000
    ? Math.round(head.src) : c ? c.in_pts_us + 1_000_000 : null;
  const apply = (kind: "NONE" | "SLOW" | "RAMP", speed: number) => {
    if (!c) return ui.say(s.selectClipFirst);
    if (!can) return why();
    if (kind === "NONE") return st.setEffect(c, { kind: "NONE", at_us: null, speed: 1, hold_ms: 0 }, s.normalSpeed);
    const snap = kind === "SLOW" ? (speed <= 0.375 ? 0.25 : 0.5) : speed <= 0.3 ? 0.25 : speed <= 0.425 ? 0.35 : 0.5;
    if (kind === "RAMP" && keyAt === null) return ui.say(s.movePlayheadMoment);
    st.setEffect(c, { kind, at_us: kind === "RAMP" ? keyAt : null, speed: snap, hold_ms: 0 },
      kind === "SLOW" ? s.slowMotion.replace("{a}", String(snap)) : s.heroRamp);
  };
  const commit = () => { if (mode !== "NONE" && v !== curSpeed) apply(mode as "SLOW" | "RAMP", v); };
  return (
    <div className="sect flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="eb">{s.speedSection}</span>
        <span className="t-small font-mono">{v.toFixed(2)}×</span>
      </div>
      <div className="seg f" role="group" aria-label={s.speedSection}>
        {([["NONE", s.csConstant], ["SLOW", s.csSlowMo], ["RAMP", s.csRamp]] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={mode === k} className={mode === k ? "on" : ""}
            onClick={() => apply(k, v)}>{l}</button>
        ))}
      </div>
      <div className="relative flex h-[18px] items-center">
        <span className="h-[3px] flex-1 rounded-full bg-raised" style={{ background: "rgb(var(--raised))" }} />
        <input type="range" min={0.25} max={2} step={0.05} value={v} disabled={mode === "NONE" || !c}
          aria-label={s.speedSection} className="vie-range absolute inset-x-0 w-full"
          onChange={(ev) => setV(Number(ev.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      </div>
      <div className="ruler"><span>0.25×</span><span>1×</span><span>2×</span></div>
      {e && e.kind !== "NONE" && <p className="t-small text-muted">{effectName(e, dict)}</p>}
    </div>
  );
}

function ZoomSection({ st, placed, can, why, ui }: { st: Studio; placed: Placed | null; can: boolean; why: () => void; ui: Ui }) {
  const { t: dict } = useLocale();
  const s = dict.body.studio;
  const c = placed?.clip ?? null;
  const keys = c?.fx.zoom ?? [];
  const ms = c ? clipMs(st.items, st.playhead, c.id) : null;
  const now = keys.length && ms !== null ? zoomAt(keys, ms) : 1;
  const on = keys.length > 0;
  const toggle = () => {
    if (!c) return ui.say(s.selectClipFirst);
    if (!can) return why();
    if (on) return st.setFx(c, { ...c.fx, zoom: [] }, s.zoomSection);
    const at = ms ?? 0;
    st.setFx(c, { ...c.fx, zoom: [...keys.filter((k) => Math.abs(k.at_ms - at) > 40), { at_ms: at, zoom: 1.5, ease: "EASE" as const }].sort((a, b) => a.at_ms - b.at_ms) },
      s.zoomAtLabel.replace("{a}", "1.5").replace("{b}", `${(at / 1000).toFixed(1)} s`));
  };
  return (
    <div className="sect">
      <div className="flex items-center justify-between">
        <span className="eb">{s.zoomSection}</span>
        <span className="t-small font-mono">{Math.round(now * 100)}%</span>
      </div>
      <div className="flex items-center gap-2.5">
        <button type="button" role="switch" aria-checked={on} aria-label={s.csFollowPlayer} className={`vie-sw ${on ? "on" : ""}`} onClick={toggle} />
        <span id="cs-follow" className="t-small">{s.csFollowPlayer} <span className="t-small text-muted">· {s.csUsesPinTrack}</span></span>
      </div>
    </div>
  );
}

function LookSection({ st, can, why }: { st: Studio; can: boolean; why: () => void }) {
  const { t: dict } = useLocale();
  const s = dict.body.studio;
  const reel = st.reel;
  const look = reel?.settings.look;
  const preset = look?.preset ?? "NONE";
  const set = (p: LookPreset) => {
    if (!reel) return;
    if (!can) return why();
    st.setSettings({ look: { ...(look ?? NEUTRAL_LOOK), preset: p } }, lookLabelOf(p, dict));
  };
  return (
    <div className="sect">
      <span className="eb">{s.csLook}</span>
      <div className="grid grid-cols-4 gap-1.5">
        {LOOKS.map(([p, key]) => {
          const on = preset === p;
          const bg = p === "NONE" ? "rgb(var(--raised))" : p === "BROADCAST" ? "#17222A" : p === "FILM" ? "#1F1E1B" : "#101010";
          return (
            <button key={p} type="button" aria-pressed={on}
              style={{ padding: 0, border: on ? "1.5px solid rgb(var(--primary))" : "1px solid rgb(var(--line2))", borderRadius: 6, background: bg, height: 40, color: on ? "rgb(var(--ink))" : "rgb(var(--ink2))", font: "500 10px Inter, sans-serif", cursor: "pointer" }}
              onClick={() => set(p)}>
              {key === "lookNone" ? s.lookNone : key === "lookBroadcast" ? s.lookBroadcast : s[key as "csLookMatte" | "csLookContrast"]}
            </button>
          );
        })}
      </div>
      {look && !isNeutral(look) && <p className="t-small text-muted">{lookLabelOf(preset, dict)} · {Math.round(look.strength * 100)}%</p>}
    </div>
  );
}

function TransitionsSection({ st, placed, can, why }: { st: Studio; placed: Placed | null; can: boolean; why: () => void }) {
  const { t: dict } = useLocale();
  const s = dict.body.studio;
  const reel = st.reel;
  const KINDS: [TransitionKind | null, string][] = [[null, s.cutLabel], ["FADE", s.fadeLabel], ["DISSOLVE", s.dissolveLabel], ["ZOOM", s.zoomLabel2], ["SPIN", s.spinLabel]];
  const inT = placed ? reel?.transitions.find((t) => t.clip_id === placed.clip.id) ?? null : null;
  const next = placed ? st.items[placed.index + 1] ?? null : null;
  const outT = next ? reel?.transitions.find((t) => t.clip_id === next.clip.id) ?? null : null;
  const setIn = (k: TransitionKind | null) => {
    if (!placed || !reel) return;
    if (!can) return why();
    if (placed.index === 0 && k) return;
    st.setTransition(placed.clip.id, k);
  };
  const setOut = (k: TransitionKind | null) => {
    if (!next || !reel) return;
    if (!can) return why();
    st.setTransition(next.clip.id, k);
  };
  const sel = "in h-9 w-full rounded-ctl border border-line bg-canvas px-2 text-sm outline-none focus:border-primary";
  return (
    <div className="sect">
      <span className="eb">{s.transitionsSection}</span>
      <div className="grid grid-cols-2 gap-2">
        <div className="field">
          <label className="lab" htmlFor="cs-tin">{s.csTransIn}</label>
          <select id="cs-tin" className={sel} value={inT?.kind ?? ""} disabled={!placed || placed.index === 0}
            onChange={(e) => setIn((e.target.value || null) as TransitionKind | null)}>
            {KINDS.map(([k, l]) => <option key={k ?? "cut"} value={k ?? ""}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="lab" htmlFor="cs-tout">{s.csTransOut}</label>
          <select id="cs-tout" className={sel} value={outT?.kind ?? ""} disabled={!next}
            onChange={(e) => setOut((e.target.value || null) as TransitionKind | null)}>
            {KINDS.map(([k, l]) => <option key={k ?? "cut"} value={k ?? ""}>{l}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

function LogoSection({ st, can, why }: { st: Studio; can: boolean; why: () => void }) {
  const { t: dict } = useLocale();
  const s = dict.body.studio;
  const reel = st.reel;
  const comp = reel?.settings.competition_logo_id ?? null;
  const custom = reel?.settings.custom_logo_id ?? null;
  const on = !!(comp || custom);
  // the renderer draws the competition logo top-right and the custom logo bottom-right; the grid shows where the logo goes
  const pos = comp ? 2 : custom ? 5 : 2;
  const toggle = () => {
    if (!reel) return;
    if (!can) return why();
    if (on) st.setSettings({ competition_logo_id: null, custom_logo_id: null }, s.assetRemoved.replace("{a}", s.logoLabel));
    else if (comp || custom) st.setSettings({}, s.logoLabel);
  };
  const where = reel ? `/reels/${reel.id}` : "/reels";
  return (
    <div className="sect" style={{ borderBottom: 0 }}>
      <div className="flex items-center justify-between">
        <span className="eb">{s.csLogoOverlay}</span>
        <button type="button" role="switch" aria-checked={on} aria-label={s.csLogoOverlay} className={`vie-sw ${on ? "on" : ""}`} onClick={toggle} />
      </div>
      <div className="grid grid-cols-3 gap-1" role="group" aria-label={s.csLogoOverlay} style={{ width: 86 }}>
        {["Top left", "Top centre", "Top right", "Bottom left", "Bottom centre", "Bottom right"].map((label, i) => (
          <span key={label} aria-label={label} title={label}
            style={{ height: 18, borderRadius: 3, border: i === pos && on ? "1px solid rgb(var(--primary))" : "1px solid rgb(var(--line2))",
              background: i === pos && on ? "rgba(43,212,176,.25)" : "rgb(var(--panel))" }} />
        ))}
      </div>
      <div className="flex gap-1.5">
        <Link href={`${where}#branding`} className="vie-btn vie-btn-sm">{s.csUploadLogo}</Link>
        <Link href={`${where}#branding`} className="vie-btn vie-btn-sm">{s.csIntroOutro}</Link>
      </div>
      <span className="hint">{s.csRightsRecorded}</span>
    </div>
  );
}

function LookDetail({ st, can, why }: { st: Studio; can: boolean; why: () => void }) {
  const { t: dict } = useLocale();
  const s = dict.body.studio;
  const reel = st.reel;
  const look = reel?.settings.look;
  if (!reel || !look) return <p className="t-body px-2 py-4 text-center text-muted">{s.chooseReelAdjust}</p>;
  const set = (patch: Partial<typeof look>, label: string) => (can ? st.setSettings({ look: { ...look, ...patch } }, label) : why());
  const rows: [string, number, number, number, number, (v: number) => void, (v: number) => string][] = [
    [s.lookStrength, 0, 1, 0.05, look.strength, (v) => set({ strength: v }, s.lookStrength), (v) => `${Math.round(v * 100)}%`],
    [s.lookExposure, -1, 1, 0.05, look.exposure, (v) => set({ exposure: v }, s.lookExposure), (v) => v.toFixed(2)],
    [s.lookContrast, 0.5, 1.5, 0.05, look.contrast, (v) => set({ contrast: v }, s.lookContrast), (v) => v.toFixed(2)],
    [s.lookSaturation, 0, 2, 0.05, look.saturation, (v) => set({ saturation: v }, s.lookSaturation), (v) => v.toFixed(2)],
    [s.lookWarmth, -1, 1, 0.05, look.temperature, (v) => set({ temperature: v }, s.lookWarmth), (v) => v.toFixed(2)],
  ];
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="grid grid-cols-4 gap-1.5">
        {LOOKS.map(([p, key]) => (
          <button key={p} type="button" aria-pressed={look.preset === p}
            className={`vie-btn vie-btn-sm ${look.preset === p ? "border-primary text-primary" : ""}`}
            onClick={() => { if (!can) return why(); set({ preset: p }, lookLabelOf(p, dict)); }}>
            {key === "lookNone" ? s.lookNone : key === "lookBroadcast" ? s.lookBroadcast : s[key as "csLookMatte" | "csLookContrast"]}
          </button>
        ))}
      </div>
      {rows.map(([label, min, max, step, value, save, fmt]) => (
        <label key={label} className="t-body grid items-center gap-2" style={{ gridTemplateColumns: "110px 1fr 52px" }}>
          <span>{label}</span>
          <input type="range" className="vie-range w-full" min={min} max={max} step={step} value={value} disabled={!can} aria-label={label}
            onChange={(e) => { const v = Number(e.target.value); }} onPointerUp={(e) => save(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => save(Number((e.target as HTMLInputElement).value))} />
          <span style={{ textAlign: "right" }}>{fmt(value)}</span>
        </label>
      ))}
      <p className="t-small text-muted">{lookLabelOf(look.preset, dict)}</p>
    </div>
  );
}

export function Inspector({ r, st, ui }: { r: ReelState | null; st: Studio; ui: Ui }) {
  const { t: dict } = useLocale();
  const s = dict.body.studio;
  const [tab, setTab] = useState(0);
  const TABS = [s.clipInspectorTab, s.csLook, s.brandingLabel, dict.body.reels.music];
  const reel = st.reel;
  const placed = st.items.find((p) => p.clip.id === r?.selectedClip) ?? locate(st.items, st.playhead)?.p ?? null;
  const can = !!reel && !!r?.canEdit && !r.busy;
  const why = () => ui.say(!r?.canEdit ? s.roleViewReel : s.savingPrevChange);
  const where = reel ? `/reels/${reel.id}` : "/reels";

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-line" aria-label={s.clipInspectorAria}>
      <div className="tabs flex flex-nowrap gap-0 border-b border-line px-1.5" role="tablist">
        {TABS.map((l, i) => (
          <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className={`tab ${tab === i ? "on" : ""}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 0 && (
          <>
            <SpeedSection st={st} placed={placed} can={can} why={why} ui={ui} />
            <ZoomSection st={st} placed={placed} can={can} why={why} ui={ui} />
            <LookSection st={st} can={can} why={why} />
            <TransitionsSection st={st} placed={placed} can={can} why={why} />
            <LogoSection st={st} can={can} why={why} />
          </>
        )}
        {tab === 1 && <LookDetail st={st} can={can} why={why} />}
        {tab === 2 && (
          <div className="flex flex-col gap-3 p-4">
            <LogoSection st={st} can={can} why={why} />
            <div className="flex flex-col gap-1.5">
              <span className="t-th">{s.introOutroVideo}</span>
              <Link href={`${where}#branding`} className="vie-btn vie-btn-sm self-start">{s.csIntroOutro}</Link>
            </div>
          </div>
        )}
        {tab === 3 && (
          <div className="flex flex-col gap-3 p-4">
            <span className="t-th">{dict.body.reels.music}</span>
            {reel?.settings.music_id ? (
              <>
                <p className="t-body">{st.brand?.find((a) => a.id === reel.settings.music_id)?.name ?? s.chosenWord}</p>
                <button type="button" disabled={!can} onClick={() => st.setSettings({ music_id: null }, s.musicRemoved)} className="vie-btn vie-btn-sm self-start disabled:opacity-50">
                  {s.noMusicUseMatch}
                </button>
              </>
            ) : <p className="t-body text-muted">{s.noMusicCheck}</p>}
            <label className="t-body grid items-center gap-2" style={{ gridTemplateColumns: "110px 1fr 52px" }}>
              <span>{dict.body.reelstage.musicVolume}</span>
              <input type="range" className="vie-range w-full" min={0} max={1} step={0.05} value={reel?.settings.music_volume ?? 0.8} disabled={!can || !reel?.settings.music_id}
                aria-label={dict.body.reelstage.musicVolume}
                onPointerUp={(e) => st.setSettings({ music_volume: Number((e.target as HTMLInputElement).value) }, dict.body.reelstage.musicVolume)}
                onKeyUp={(e) => st.setSettings({ music_volume: Number((e.target as HTMLInputElement).value) }, dict.body.reelstage.musicVolume)}
                onChange={() => undefined} />
              <span style={{ textAlign: "right" }}>{Math.round((reel?.settings.music_volume ?? 0.8) * 100)}%</span>
            </label>
            <label className="t-body grid items-center gap-2" style={{ gridTemplateColumns: "110px 1fr 52px" }}>
              <span>{s.matchSound}</span>
              <input type="range" className="vie-range w-full" min={0} max={1} step={0.05} value={reel?.settings.match_volume ?? 0.3} disabled={!can}
                aria-label={s.matchSound}
                onPointerUp={(e) => st.setSettings({ match_volume: Number((e.target as HTMLInputElement).value) }, s.matchSound)}
                onKeyUp={(e) => st.setSettings({ match_volume: Number((e.target as HTMLInputElement).value) }, s.matchSound)}
                onChange={() => undefined} />
              <span style={{ textAlign: "right" }}>{Math.round((reel?.settings.match_volume ?? 0.3) * 100)}%</span>
            </label>
            <Link href={`${where}#branding`} className="vie-btn vie-btn-sm self-start">{s.csUploadMusic}</Link>
          </div>
        )}
      </div>
    </aside>
  );
}
