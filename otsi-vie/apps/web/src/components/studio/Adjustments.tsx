"use client";
/**
 * E2 (ADR-065): the inspector's Adjustments tab, driven by the selection (the selected clip, else the clip under the playhead).
 * Sections open and close like an editor's inspector:
 *   Speed          the clip's speed effect: normal, slow motion (0.5x / 0.25x), freeze frame or hero ramp at a key moment (saved at once,
 *                  undoable; PATCH /v1/reels/:id/clips/:clipId/effect). The key moment is the playhead when it is inside the clip, else his
 *                  most important engine event in it.
 *   Strap & caption the lower third (name, shirt number, position, OTSI Player ID, club: recorded data only, the confirmed player only) and
 *                  the event caption; with a freeze or ramp they appear one second before its key moment.
 *   Spotlight      the reel's beam: darkening, size, softness, target lock, Auto Track, name above the head.
 *   Reframe        E3 (ADR-066): the reel's frame (16:9 / 9:16 / 1:1) and how fast a tall or square frame follows the player.
 *   Sound          E3: music and match sound levels, the music dipping under loud match sound; loudness is set per export file.
 *   Look           E5 (ADR-068): the reel's colour: a preset look at a strength, exposure, contrast, saturation, warmth, and match to a
 *                  reference frame (its colour statistics, from this or another reel). The preview draws it live; the render bakes it into a LUT.
 *   Zoom           E5: the clip's keyframed zoom on the player (ease, hold or linear between keys).
 *   Draw           E5: arrows, lines and circles drawn on over the picture at the playhead.
 *   Review         E5: reviewers' comments from share links of the reel's renders, on the timeline when the file still matches the edit.
 */
import { DRAW_RGB, FREEZE_MS_DEFAULT, LOOK_PRESETS, LOUDNESS_TARGETS, MUTE_DB, NEUTRAL_LOOK, RAMP_SPEED_DEFAULT, clipOutputUs, effectActive, frameStats, isNeutral, matchFrom, zoomAt,
  type ClipEffect, type DrawColor, type DrawKind, type FrameStats, type Look, type LookPreset, type SetClipEffectRequest, type SpotlightSettings, type ZoomEase } from "@otsi-vie/contracts";
import { useEffect, useState, type ReactNode } from "react";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { tc, type Ui } from "./kit";
import { clipMs, locate, reviewTime, type Placed, type Studio } from "./useStudio";
import { BlocksPanel, CutsPanel, MarkersPanel, TransitionsPanel } from "./EditPanels";
import { useLocale, type Dictionary } from "@/lib/i18n";

const REF_KEY = "otsi-look-reference";
const readRef = (): { label: string; stats: FrameStats } | null => { try { const x = sessionStorage.getItem(REF_KEY); return x ? JSON.parse(x) : null; } catch { return null; } };
const msTc = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const chip = (on: boolean, can: boolean) => `t-button rounded-md border px-2.5 py-1.5 ${on ? "border-primary bg-[#0f4f9a] text-white" : "border-line2 bg-[#0a2447] text-white"} ${can ? "cursor-pointer" : "cursor-not-allowed opacity-55"}`;
const note = "t-small leading-snug";

export const effectName = (e: ClipEffect, d?: Dictionary) =>
  e.kind === "SLOW" ? (d?.body.studio.slowEffect ?? "Slow {a}x").replace("{a}", String(e.speed))
  : e.kind === "FREEZE" ? (d?.body.studio.freezeEffect ?? "Freeze {a} s").replace("{a}", (e.hold_ms / 1000).toFixed(1))
  : e.kind === "RAMP" ? (d?.body.studio.heroRampEffect ?? "Hero ramp {a}x").replace("{a}", String(e.speed))
  : d?.body.studio.normalSpeed ?? "Normal speed";

/** contracts LOOK_PRESETS labels, translated at the render site (contracts stays English) */
export const lookLabelOf = (k: LookPreset, d: Dictionary) => k === "NONE" ? d.body.studio.lookNone : k === "BROADCAST" ? d.body.studio.lookBroadcast
  : k === "WARM" ? d.body.studio.lookWarmSun : k === "COOL" ? d.body.studio.lookCoolNight : k === "PUNCHY" ? d.body.studio.lookPunchy
  : k === "FILM" ? d.body.studio.lookFilm : d.body.studio.lookBlackWhite;
/** contracts LOUDNESS_TARGETS label / note, translated at the render site */
export const loudnessLabelOf = (lufs: number | null, d: Dictionary) => lufs === null ? d.body.studio.loudnessAuto : lufs === -23 ? d.body.studio.loudnessBroadcast
  : lufs === -16 ? d.body.studio.loudnessOnline : d.body.studio.loudnessSocial;
export const loudnessNoteOf = (lufs: number | null, d: Dictionary) => lufs === null ? d.body.studio.loudnessAutoNote : lufs === -23 ? d.body.studio.loudnessBroadcastNote
  : lufs === -16 ? d.body.studio.loudnessOnlineNote : d.body.studio.loudnessSocialNote;

function Section({ id, title, open, toggle, children, pro }: { id: string; title: string; open: boolean; toggle: (id: string) => void; children: ReactNode; pro?: boolean }) {
  return (
    <div data-adjust={id} data-pro={pro ? "" : undefined} className="border-b border-[#12335f]">
      <button type="button" aria-expanded={open} onClick={() => toggle(id)}
        className="t-panel flex w-full cursor-pointer items-center justify-between border-0 bg-transparent px-2 py-2.5 text-[#e3eefb]">
        <span>{title}</span><span aria-hidden className="text-muted">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="flex flex-col gap-2 px-2 pb-3">{children}</div>}
    </div>
  );
}

/** a slider that saves once, when it is let go */
function Slider({ label, value, min, max, step, can, save, fmt }: { label: string; value: number; min: number; max: number; step: number; can: boolean;
  save: (v: number) => void; fmt: (v: number) => string }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const commit = () => { if (v !== value) save(v); };
  return (
    <label className="t-body grid items-center gap-2" style={{ gridTemplateColumns: "150px 1fr 60px" }}>
      <span>{label}</span>
      <input type="range" className="vie-range w-full" min={min} max={max} step={step} value={v} disabled={!can} aria-label={label} onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <span style={{ textAlign: "right" }}>{fmt(v)}</span>
    </label>
  );
}

export function Adjustments({ r, st, ui, placed, suggestAt }: { r: ReelState | null; st: Studio; ui: Ui; placed: Placed | null; suggestAt: number | null }) {
  const { t: dict } = useLocale();
  const reel = st.reel;
  const KINDS: [DrawKind, string][] = [["ARROW", dict.body.studio.arrowTool], ["LINE", dict.body.studio.lineTool], ["CIRCLE", dict.body.studio.circleTool]];
  const COLOR_NAME: Record<DrawColor, string> = { YELLOW: dict.body.studio.colourYellow, WHITE: dict.body.analysis.legendWhite, CYAN: dict.body.studio.colourCyan, RED: dict.body.studio.colourRed };
  const open = st.adjOpen, setOpen = st.setAdjOpen;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [ease, setEase] = useState<ZoomEase>("EASE");
  const [ref, setRef] = useState(readRef);
  if (!reel) return <p className={note} style={{ margin: 20 }}>{dict.body.studio.chooseReelAdjust}</p>;
  const can = !!r?.canEdit && !r.busy;
  const why = () => ui.say(!r?.canEdit ? dict.body.studio.roleViewReel : dict.body.studio.savingPrevChange);
  const s = reel.settings;
  const set = (patch: Partial<SpotlightSettings>, label: string) => (can ? st.setSettings(patch, label) : why());

  // ------------------------------------------------------------------ speed (the clip)
  const c = placed?.clip ?? null;
  const e = c?.effect ?? null;
  const head = locate(st.items, st.playhead);
  const headIn = c && head && head.p.clip.id === c.id && head.src > c.in_pts_us + 100_000 && head.src < c.out_pts_us - 100_000 ? Math.round(head.src) : null;
  const keyAt = headIn ?? (c && suggestAt !== null && suggestAt > c.in_pts_us && suggestAt < c.out_pts_us ? suggestAt : null);
  const apply = (x: SetClipEffectRequest, label: string) => {
    if (!c) return ui.say(dict.body.studio.selectClipFirst);
    if (!can) return why();
    if ((x.kind === "FREEZE" || x.kind === "RAMP") && x.at_us === null) return ui.say(dict.body.studio.movePlayheadMoment);
    st.setEffect(c, x, label);
  };
  const extra = c ? clipOutputUs(c) - (c.out_pts_us - c.in_pts_us) : 0;
  const strap = [reel.player?.display_name, reel.player_roster?.jersey_number != null ? `#${reel.player_roster.jersey_number}` : null, reel.player_roster?.position,
    reel.player?.canonical_otsi_id, reel.player_club].filter(Boolean).join("  ·  ");

  return (
    <div data-adjustments={c?.id ?? "reel"} className="flex flex-col">
      <p className={note} style={{ padding: "4px 8px 6px" }}>
        {c ? `${dict.body.studio.clipIndex.replace("{a}", String(placed!.index + 1))}${c.label ? ` · ${c.label}` : ""}${r?.selectedClip === c.id ? "" : dict.body.studio.atPlayheadSuffix}` : dict.body.studio.noClipPlayhead}
      </p>

      <Section id="speed" title={`${dict.body.studio.speedSection}${e && e.kind !== "NONE" ? ` · ${effectName(e, dict)}` : ""}`} open={open.has("speed")} toggle={toggle}>
        {!c ? <p className={note}>{dict.body.studio.slowClipHint}</p> : (
          <>
            <span className="flex flex-wrap gap-1.5">
              <button type="button" data-effect="NONE" aria-pressed={e?.kind === "NONE"} className={chip(e?.kind === "NONE", can)} onClick={() => apply({ kind: "NONE", at_us: null, speed: 1, hold_ms: 0 }, dict.body.studio.normalSpeed)}>{dict.body.processing.priorityNormal}</button>
              {[0.5, 0.25].map((v) => (
                <button key={v} type="button" data-effect={`SLOW-${v}`} aria-pressed={e?.kind === "SLOW" && e.speed === v} className={chip(e?.kind === "SLOW" && e.speed === v, can)}
                  onClick={() => apply({ kind: "SLOW", at_us: null, speed: v, hold_ms: 0 }, dict.body.studio.slowMotion.replace("{a}", String(v)))}>{dict.body.studio.slowEffect.replace("{a}", String(v))}</button>
              ))}
              <button type="button" data-effect="FREEZE" aria-pressed={e?.kind === "FREEZE"} className={chip(e?.kind === "FREEZE", can)}
                onClick={() => apply({ kind: "FREEZE", at_us: keyAt, speed: 1, hold_ms: e?.kind === "FREEZE" ? e.hold_ms : FREEZE_MS_DEFAULT }, dict.body.studio.freezeFrame)}>{dict.body.studio.freezeBtn}</button>
              <button type="button" data-effect="RAMP" aria-pressed={e?.kind === "RAMP"} className={chip(e?.kind === "RAMP", can)}
                onClick={() => apply({ kind: "RAMP", at_us: keyAt, speed: e?.kind === "RAMP" ? e.speed : RAMP_SPEED_DEFAULT, hold_ms: 0 }, dict.body.studio.heroRamp)}>Hero ramp</button>
            </span>
            {/* B.19 (ADR-094): a spacer before the clip: that much black and silence in the reel */}
            <span data-gap-row="" className="t-body flex flex-wrap items-center gap-1.5"
              title={dict.body.studio.gapBeforeHint}>{dict.body.studio.gapBefore}
              {[0, 500, 1000, 2000, 3000].map((ms) => (
                <button key={ms} type="button" data-gap={ms} aria-pressed={(c.fx.gap_ms ?? 0) === ms} className={chip((c.fx.gap_ms ?? 0) === ms, can)}
                  onClick={() => { if (!can) return why(); if ((c.fx.gap_ms ?? 0) !== ms) st.setFx(c, { ...c.fx, gap_ms: ms }, ms ? dict.body.studio.gapOfSeconds.replace("{a}", (ms / 1000).toFixed(1)) : dict.body.studio.gapRemoved); }}>
                  {ms ? `${(ms / 1000).toFixed(1)} s` : dict.body.studio.lookNone}</button>
              ))}
            </span>
            {e?.kind === "FREEZE" && (
              <span className="t-body flex flex-wrap items-center gap-1.5">{dict.body.studio.holdLabel}
                {[500, 1000, 1500, 2000, 3000].map((ms) => (
                  <button key={ms} type="button" data-hold={ms} aria-pressed={e.hold_ms === ms} className={chip(e.hold_ms === ms, can)}
                    onClick={() => apply({ kind: "FREEZE", at_us: e.at_us, speed: 1, hold_ms: ms }, dict.body.studio.freezeEffect.replace("{a}", (ms / 1000).toFixed(1)))}>{(ms / 1000).toFixed(1)} s</button>
                ))}
              </span>
            )}
            {e?.kind === "RAMP" && (
              <span className="t-body flex flex-wrap items-center gap-1.5">{dict.body.studio.slowestLabel}
                {[0.5, 0.35, 0.25].map((v) => (
                  <button key={v} type="button" data-ramp={v} aria-pressed={e.speed === v} className={chip(e.speed === v, can)}
                    onClick={() => apply({ kind: "RAMP", at_us: e.at_us, speed: v, hold_ms: 0 }, dict.body.studio.heroRampEffect.replace("{a}", String(v)))}>{v}x</button>
                ))}
              </span>
            )}
            {e && (e.kind === "FREEZE" || e.kind === "RAMP") && (
              <span className="t-body flex items-center gap-2">
                {dict.body.studio.keyMomentAt.replace("{a}", e.at_us !== null ? tc(e.at_us) : "—")}
                {keyAt !== null && keyAt !== e.at_us && (
                  <button type="button" data-set-moment className={chip(false, can)} onClick={() => apply({ ...e, at_us: keyAt }, dict.body.studio.keyMomentMoved)}>
                    {headIn !== null ? dict.body.studio.moveToPlayhead : dict.body.studio.moveToEvent}</button>
                )}
              </span>
            )}
            <p className={note} data-effect-state={c && e && e.kind !== "NONE" && !effectActive(c) ? "inactive" : "ok"}>
              {e && e.kind !== "NONE" && !effectActive(c)
                ? dict.body.studio.keyMomentOutside
                : e?.kind === "FREEZE" ? dict.body.studio.freezeDesc
                : e?.kind === "RAMP" ? dict.body.studio.rampDesc
                : e?.kind === "SLOW" ? dict.body.studio.slowDesc
                : keyAt === null ? dict.body.studio.freezeRampPlayhead : dict.body.studio.freezeRampWillUse.replace("{a}", tc(keyAt))}
              {extra > 0 ? dict.body.studio.clipLongerBy.replace("{a}", (extra / 1e6).toFixed(1)) : ""}
            </p>
          </>
        )}
      </Section>

      {/* B.21 (ADR-096): transitions on this cut or every cut, the reel's markers, saved blocks of clips */}
      <Section id="trans" title={dict.body.studio.transitionsCount.replace("{a}", String(reel.transitions.length))} open={open.has("trans")} toggle={toggle}>
        <TransitionsPanel st={st} placed={placed} can={can} why={why} />
      </Section>
      <Section id="markers" title={dict.body.studio.markersCount.replace("{a}", String(st.notes.filter((n) => n.at_pts_us !== null).length))} open={open.has("markers")} toggle={toggle}>
        <MarkersPanel st={st} ui={ui} />
      </Section>
      {/* B.25 (ADR-100): suggested clip ends around his events, Inferred */}
      <Section id="cuts" title={dict.body.studio.cutsSection} open={open.has("cuts")} toggle={toggle}>
        {open.has("cuts") && <CutsPanel st={st} can={can} why={why} />}
      </Section>
      <Section id="blocks" title={dict.body.studio.blocksSection} open={open.has("blocks")} toggle={toggle}>
        <BlocksPanel st={st} ui={ui} placed={placed} can={can} why={why} />
      </Section>
      <Section id="strap" title={dict.body.studio.strapSection} open={open.has("strap")} toggle={toggle}>
        <label className="t-body flex items-center gap-2">
          <input type="checkbox" checked={s.lower_third} disabled={!can} onChange={() => set({ lower_third: !s.lower_third }, s.lower_third ? dict.body.studio.strapOff : dict.body.studio.strapOn)} />{dict.body.studio.nameStrap}
        </label>
        <p className={note} data-strap>{reel.player ? strap : dict.body.studio.noConfirmedPlayerStrap}</p>
        <label className="t-body flex items-center gap-2">
          <input type="checkbox" checked={s.event_tags} disabled={!can} onChange={() => set({ event_tags: !s.event_tags }, s.event_tags ? dict.body.studio.eventCaptionOff : dict.body.studio.eventCaptionOn)} />{dict.body.studio.eventCaption}
          {c?.label ? <span className="text-muted">· “{c.label}”</span> : null}
        </label>
        <p className={note}>{dict.body.studio.strapNote}</p>
      </Section>

      <Section id="spot" title={dict.body.studio.spotlightLabel} open={open.has("spot")} toggle={toggle}>
        <Slider label={dict.body.studio.darkenRest} value={s.dim} min={0} max={0.9} step={0.05} can={can} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => set({ dim: v }, dict.body.studio.darkeningSaved)} />
        <Slider label={dict.body.studio.beamSize} value={s.size} min={0.8} max={3} step={0.1} can={can} fmt={(v) => `${v.toFixed(1)}x`} save={(v) => set({ size: v }, dict.body.studio.beamSizeSaved)} />
        <Slider label={dict.body.studio.softness} value={s.feather} min={0.05} max={1.5} step={0.05} can={can} fmt={(v) => v.toFixed(2)} save={(v) => set({ feather: v }, dict.body.studio.softnessSaved)} />
        <Slider label={dict.body.studio.targetLock} value={s.lock} min={0} max={1} step={0.05} can={can} fmt={(v) => (v < 0.34 ? dict.body.studio.lockStrict : v > 0.66 ? dict.body.studio.lockTolerant : dict.body.studio.lockNormal)} save={(v) => set({ lock: v }, dict.body.studio.targetLockSaved)} />
        <label className="t-body flex items-center gap-2">
          <input type="checkbox" checked={s.auto_track} disabled={!can} onChange={() => set({ auto_track: !s.auto_track }, s.auto_track ? dict.body.studio.autoTrackOff : dict.body.studio.autoTrackOn)} />{dict.body.studio.autoTrack}
        </label>
        <label className="t-body flex items-center gap-2">
          <input type="checkbox" checked={s.name_caption} disabled={!can} onChange={() => set({ name_caption: !s.name_caption }, s.name_caption ? dict.body.studio.nameAboveOff : dict.body.studio.nameAboveOn)} />{dict.body.studio.nameAboveHead}
        </label>
      </Section>

      <Section pro id="reframe" title={dict.body.studio.reframeAspect.replace("{a}", reel.aspect)} open={open.has("reframe")} toggle={toggle}>
        <span className="flex flex-wrap gap-1.5">
          {(["16:9", "9:16", "1:1", "4:5"] as const).map((a) => (
            <button key={a} type="button" data-aspect={a} aria-pressed={reel.aspect === a} className={chip(reel.aspect === a, can)}
              onClick={() => (can ? st.setAspect(a) : why())}>{a} {a === "16:9" ? dict.body.studio.aspectWide : a === "9:16" ? dict.body.studio.aspectTall : a === "4:5" ? dict.body.studio.aspectFeed : dict.body.studio.aspectSquare}</button>
          ))}
        </span>
        <Slider label={dict.body.studio.followSpeed} value={s.reframe_speed ?? 0.5} min={0} max={1} step={0.05} can={can && reel.aspect !== "16:9"}
          fmt={(v) => (v < 0.34 ? dict.body.studio.followCalm : v > 0.66 ? dict.body.studio.followQuick : dict.body.studio.lockNormal)} save={(v) => set({ reframe_speed: v }, dict.body.studio.followSpeedSaved)} />
        <p className={note} data-reframe-note>{reel.aspect === "16:9"
          ? dict.body.studio.reframeWhole
          : dict.body.studio.reframeFollows}</p>
        <p className={note}>{dict.body.studio.zoomBelowHint}</p>
      </Section>

      <Section id="sound" title={dict.body.studio.soundSection} open={open.has("sound")} toggle={toggle}>
        {/* B.20 (ADR-095): the mixer: this clip's own level, then the reel's music and match sound, then the loudness of every file */}
        {c ? (
          <span data-clip-gain-row="" className="t-body flex flex-wrap items-center gap-1.5"
            title={dict.body.studio.clipSoundHint}>{dict.body.studio.clipSound.replace("{a}", String(placed!.index + 1))}
            {[MUTE_DB, -12, -6, 0, 3, 6].map((db) => {
              const on = (c.fx.gain_db ?? 0) === db || (db === MUTE_DB && (c.fx.gain_db ?? 0) <= MUTE_DB);
              return (
                <button key={db} type="button" data-clip-gain={db} aria-pressed={on} className={chip(on, can)}
                  onClick={() => { if (!can) return why(); if (!on) st.setFx(c, { ...c.fx, gain_db: db }, db === MUTE_DB ? dict.body.studio.clipSoundMuted : dict.body.studio.clipSoundDb.replace("{a}", `${db > 0 ? "+" : ""}${db}`)); }}>
                  {db === MUTE_DB ? dict.body.studio.muteLabel : db === 0 ? dict.body.studio.asRecorded : `${db > 0 ? "+" : ""}${db} dB`}</button>
              );
            })}
          </span>
        ) : <p className={note}>{dict.body.studio.selectClipSound}</p>}
        {s.music_id ? (
          <>
            <Slider label={dict.body.reels.music} value={s.music_volume} min={0} max={1} step={0.05} can={can} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => set({ music_volume: v }, dict.body.studio.musicLevelSaved)} />
            <Slider label={dict.body.studio.matchSoundLabel} value={s.match_volume} min={0} max={1} step={0.05} can={can} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => set({ match_volume: v }, dict.body.studio.matchSoundLevelSaved)} />
            <label className="t-body flex items-center gap-2">
              <input type="checkbox" data-duck checked={s.duck_music ?? true} disabled={!can} onChange={() => set({ duck_music: !(s.duck_music ?? true) }, (s.duck_music ?? true) ? dict.body.studio.musicNoDips : dict.body.studio.musicDips)} />
              {dict.body.studio.musicDipsHint}
            </label>
          </>
        ) : <p className={note}>{dict.body.studio.noMusicChosen}</p>}
        <span data-loudness-row="" className="t-body flex flex-wrap items-center gap-1.5">{dict.body.studio.loudnessLabel}
          {LOUDNESS_TARGETS.map((t) => {
            const on = (s.loudness_lufs ?? null) === t.lufs;
            return <button key={String(t.lufs)} type="button" data-loudness={t.lufs ?? "auto"} aria-pressed={on} title={loudnessNoteOf(t.lufs, dict)} className={chip(on, can)}
              onClick={() => { if (!on) set({ loudness_lufs: t.lufs }, dict.body.studio.loudnessValue.replace("{a}", loudnessLabelOf(t.lufs, dict))); }}>{loudnessLabelOf(t.lufs, dict)}</button>;
          })}
        </span>
        <p className={note}>{loudnessNoteOf((LOUDNESS_TARGETS.find((t) => t.lufs === (s.loudness_lufs ?? null)) ?? LOUDNESS_TARGETS[0]!).lufs, dict)}.{dict.body.studio.loudnessNoteSuffix}</p>
        {(() => {
          const res = reel.last_good_render?.result as { loudness_lufs?: number | null } | null | undefined, cfg = reel.last_good_render?.config as { audio?: { lufs?: number } } | undefined;
          return res?.loudness_lufs != null ? <p data-measured-lufs={res.loudness_lufs} className={note}>{dict.body.studio.lastMeasuredLufs.replace("{a}", res.loudness_lufs.toFixed(1)).replace("{b}", cfg?.audio?.lufs != null ? dict.body.studio.lufsTarget.replace("{a}", String(cfg.audio.lufs)) : "")}</p> : null;
        })()}
      </Section>
      {(() => {
        // ---------------------------------------------------------------- look (the reel)
        const lk: Look = s.look ?? NEUTRAL_LOOK;
        const setLook = (patch: Partial<Look>, label: string) => set({ look: { ...lk, ...patch } }, label);
        const takeRef = () => {
          const f = st.grab.current?.();
          if (!f) return ui.say(dict.body.studio.noFrameYet);
          const r2 = { label: `${reel.name} at ${tc(f.at_us)}`, stats: frameStats(f.rgba) };
          try { sessionStorage.setItem(REF_KEY, JSON.stringify(r2)); } catch { /* kept for this page only */ }
          setRef(r2);
          ui.say(dict.body.studio.referenceSavedSay.replace("{a}", r2.label));
        };
        const match = () => {
          if (!ref) return ui.say(dict.body.studio.chooseRefFirst);
          const f = st.grab.current?.();
          if (!f) return ui.say(dict.body.studio.noFrameYet);
          setLook({ match: matchFrom(frameStats(f.rgba), ref.stats, ref.label) }, dict.body.studio.matchedToRef.replace("{a}", ref.label));
        };
        return (
          <Section pro id="look" title={`${dict.body.studio.lookSection}${isNeutral(lk) ? "" : ` · ${lk.preset !== "NONE" ? lookLabelOf(lk.preset, dict) : dict.body.studio.lookCustom}${lk.match ? dict.body.studio.lookMatchSuffix : ""}`}`} open={open.has("look")} toggle={toggle}>
            <span className="flex flex-wrap gap-1.5">
              {(Object.keys(LOOK_PRESETS) as LookPreset[]).map((k) => (
                <button key={k} type="button" data-look-preset={k} aria-pressed={lk.preset === k} className={chip(lk.preset === k, can)}
                  onClick={() => setLook({ preset: k }, dict.body.studio.lookSet.replace("{a}", lookLabelOf(k, dict)))}>{lookLabelOf(k, dict)}</button>
              ))}
            </span>
            <Slider label={dict.body.studio.lookStrength} value={lk.strength} min={0} max={1} step={0.05} can={can && lk.preset !== "NONE"} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => setLook({ strength: v }, dict.body.studio.lookStrengthSaved)} />
            <Slider label={dict.body.studio.exposure} value={lk.exposure} min={-1} max={1} step={0.05} can={can} fmt={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`} save={(v) => setLook({ exposure: v }, dict.body.studio.exposureSaved)} />
            <Slider label={dict.body.studio.contrast} value={lk.contrast} min={0.5} max={1.5} step={0.05} can={can} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => setLook({ contrast: v }, dict.body.studio.contrastSaved)} />
            <Slider label={dict.body.studio.saturation} value={lk.saturation} min={0} max={2} step={0.05} can={can} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => setLook({ saturation: v }, dict.body.studio.saturationSaved)} />
            <Slider label={dict.body.studio.warmth} value={lk.temperature} min={-1} max={1} step={0.05} can={can} fmt={(v) => (Math.abs(v) < 0.025 ? dict.body.studio.neutralValue : v > 0 ? dict.body.studio.warmValue.replace("{a}", v.toFixed(2)) : dict.body.studio.coolValue.replace("{a}", (-v).toFixed(2)))} save={(v) => setLook({ temperature: v }, dict.body.studio.warmthSaved)} />
            <span className="flex flex-wrap gap-1.5">
              <button type="button" data-look-ref className={chip(false, true)} onClick={takeRef}>{dict.body.studio.useFrameRef}</button>
              <button type="button" data-look-match className={chip(!!lk.match, can && !!ref)} onClick={() => (can ? match() : why())}>{dict.body.studio.matchToRef}</button>
              {lk.match && <button type="button" data-look-unmatch className={chip(false, can)} onClick={() => (can ? setLook({ match: null }, dict.body.studio.matchRemoved) : why())}>{dict.body.studio.removeMatch}</button>}
              {!isNeutral(lk) && <button type="button" data-look-reset className={chip(false, can)} onClick={() => (can ? set({ look: NEUTRAL_LOOK }, dict.body.studio.lookReset) : why())}>{dict.body.studio.resetLabel}</button>}
            </span>
            <p className={note} data-look-note>
              {lk.match ? dict.body.studio.matchedToRefSentence.replace("{a}", lk.match.label) + " " : ref ? dict.body.studio.referenceSentence.replace("{a}", ref.label) + " " : ""}{dict.body.studio.lookNote}
            </p>
          </Section>
        );
      })()}

      {(() => {
        // ---------------------------------------------------------------- zoom (the clip)
        const ms = c ? clipMs(st.items, st.playhead, c.id) : null;
        const keys = c?.fx.zoom ?? [];
        const lenMs = c ? Math.floor(clipOutputUs(c) / 1000) : 0;
        const put = (zoom: typeof keys, label: string) => { if (!c) return ui.say(dict.body.studio.selectClipFirst); if (!can) return why(); st.setFx(c, { ...c.fx, zoom }, label); };
        const addKey = (z: number) => {
          if (ms === null || ms > lenMs) return ui.say(dict.body.studio.movePlayheadInsideClip);
          put([...keys.filter((k) => Math.abs(k.at_ms - ms) > 40), { at_ms: ms, zoom: z, ease }].sort((a, b) => a.at_ms - b.at_ms), dict.body.studio.zoomAtLabel.replace("{a}", String(z)).replace("{b}", msTc(ms)));
        };
        return (
          <Section pro id="zoom" title={`${dict.body.studio.zoomSection}${keys.length ? keys.length === 1 ? dict.body.studio.zoomKeysOne.replace("{a}", String(keys.length)) : dict.body.studio.zoomKeysMany.replace("{a}", String(keys.length)) : ""}`} open={open.has("zoom")} toggle={toggle}>
            {!c ? <p className={note}>{dict.body.studio.selectClipZoom}</p> : (
              <>
                <span className="t-body flex flex-wrap items-center gap-1.5">{dict.body.studio.addAtPlayhead}
                  {[1, 1.25, 1.5, 2, 2.5].map((z) => (
                    <button key={z} type="button" data-zoom-add={z} className={chip(false, can && ms !== null)} onClick={() => addKey(z)}>{z}x</button>
                  ))}
                </span>
                <span className="t-body flex flex-wrap items-center gap-1.5">{dict.body.studio.thenLabel}
                  {([["EASE", dict.body.studio.easeLabel], ["LINEAR", dict.body.studio.linearLabel], ["HOLD", dict.body.studio.holdLabel]] as const).map(([k, l]) => (
                    <button key={k} type="button" data-zoom-ease={k} aria-pressed={ease === k} className={chip(ease === k, true)} onClick={() => setEase(k)}>{l}</button>
                  ))}
                </span>
                {keys.map((k, i) => (
                  <span key={i} data-zoom-key={k.at_ms} className="t-body flex items-center gap-2">
                    <button type="button" className={chip(ms !== null && Math.abs(ms - k.at_ms) <= 40, true)} style={{ minWidth: 150 }}
                      onClick={() => { const p = st.items.find((x) => x.clip.id === c.id); if (p) st.setPlayhead(p.start + k.at_ms * 1000); }}>{msTc(k.at_ms)} · {k.zoom}x</button>
                    <span className="text-muted">{i < keys.length - 1 ? (k.ease === "EASE" ? dict.body.studio.easesNext : k.ease === "HOLD" ? dict.body.studio.holdsJumps : dict.body.studio.movesEvenly) : dict.body.studio.staysLabel}</span>
                    <button type="button" aria-label={dict.body.studio.deleteZoomKeyAt.replace("{a}", msTc(k.at_ms))} className={chip(false, can)}
                      onClick={() => put(keys.filter((_, j) => j !== i), dict.body.studio.zoomKeyDeleted.replace("{a}", msTc(k.at_ms)))}>×</button>
                  </span>
                ))}
                <p className={note} data-zoom-note>{keys.length
                  ? dict.body.studio.zoomNowAt.replace("{a}", ms !== null ? dict.body.studio.zoomNowValue.replace("{a}", zoomAt(keys, ms).toFixed(2)) : "—")
                  : dict.body.studio.zoomTwoKeys}</p>
              </>
            )}
          </Section>
        );
      })()}

      {(() => {
        // ---------------------------------------------------------------- telestration (the clip)
        const ds = c?.fx.drawings ?? [];
        const del = (i: number) => { if (!c) return; if (!can) return why(); st.setFx(c, { ...c.fx, drawings: ds.filter((_, j) => j !== i) }, dict.body.studio.drawingDeleted); };
        return (
          <Section pro id="draw" title={`${dict.body.studio.drawSection}${ds.length ? dict.body.studio.drawCount.replace("{a}", String(ds.length)) : ""}`} open={open.has("draw")} toggle={toggle}>
            <span style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {KINDS.map(([k, l]) => (
                <button key={k} type="button" data-draw-tool={k} aria-pressed={st.drawTool === k} className={chip(st.drawTool === k, can)}
                  onClick={() => { if (!can) return why(); st.setDrawTool(st.drawTool === k ? null : k); }}>{l}</button>
              ))}
              {(Object.keys(DRAW_RGB) as DrawColor[]).map((k) => (
                <button key={k} type="button" data-draw-color={k} aria-label={`Colour ${COLOR_NAME[k]}`} aria-pressed={st.drawColor === k} onClick={() => st.setDrawColor(k)}
                  style={{ width: 28, height: 28, borderRadius: "50%", background: DRAW_RGB[k], cursor: "pointer", border: `3px solid ${st.drawColor === k ? "#fff" : "#0a2447"}` }} />
              ))}
            </span>
            {ds.map((d, i) => (
              <span key={i} data-drawing={i} className="t-body flex items-center gap-2">
                <i aria-hidden style={{ width: 12, height: 12, borderRadius: "50%", background: DRAW_RGB[d.color] }} />
                <button type="button" className={chip(false, true)} style={{ minWidth: 150 }}
                  onClick={() => { const p = c && st.items.find((x) => x.clip.id === c.id); if (p) st.setPlayhead(p.start + d.at_ms * 1000); }}>
                  {dict.body.studio.drawingKindAt.replace("{a}", KINDS.find(([k]) => k === d.kind)![1]).replace("{b}", msTc(d.at_ms))}</button>
                <span className="text-muted">{dict.body.studio.onScreenDuration.replace("{a}", msTc(d.draw_ms + d.hold_ms))}</span>
                <button type="button" aria-label={dict.body.studio.deleteDrawingN.replace("{a}", String(i + 1))} className={chip(false, can)} onClick={() => del(i)}>×</button>
              </span>
            ))}
            <p className={note} data-draw-note>{!c ? dict.body.studio.drawSelectClip
              : st.drawTool ? dict.body.studio.drawDrag
              : dict.body.studio.drawChooseTool}</p>
          </Section>
        );
      })()}

      {(() => {
        // ---------------------------------------------------------------- reviewers' comments (the reel)
        const rv = st.reviews;
        return (
          <Section pro id="review" title={`${dict.body.studio.layoutReview}${rv.length ? ` · ${rv.length}` : ""}`} open={open.has("review")} toggle={toggle}>
            {rv.length === 0 && <p className={note}>{dict.body.studio.noReviewerComments}</p>}
            {rv.map((x) => {
              const t = reviewTime(x, reel, st.total, dict);
              return (
                <div key={x.id} data-review={x.id} data-placed={t.at_us !== null ? "yes" : "no"} className="flex flex-col gap-1 border-t border-[#12335f] py-1.5">
                  <span className="t-body flex items-center gap-2">
                    <b style={{ color: "#ff9bdc" }}>{x.name}</b>
                    {t.at_us !== null ? <button type="button" className={chip(false, true)} onClick={() => st.setPlayhead(t.at_us!)}>{tc(t.at_us)}</button>
                      : <span className="text-muted">{x.at_s !== null ? dict.body.studio.secondsInFile.replace("{a}", x.at_s.toFixed(1)) : dict.body.studio.noTime}</span>}
                  </span>
                  <span className="t-body whitespace-pre-wrap">{x.body}</span>
                  {t.why && <span className={note}>{t.why}</span>}
                </div>
              );
            })}
            <span><button type="button" data-review-refresh className={chip(false, true)} onClick={() => void st.loadReviews().then(() => ui.say(dict.body.studio.reviewRefreshed))}>{dict.body.studio.refreshLabel}</button></span>
          </Section>
        );
      })()}
    </div>
  );
}
