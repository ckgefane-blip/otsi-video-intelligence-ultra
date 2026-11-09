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
import { u } from "@/components/stage/DesignStage";
import { tc, type Ui } from "./kit";
import { clipMs, locate, reviewTime, type Placed, type Studio } from "./useStudio";
import { BlocksPanel, CutsPanel, MarkersPanel, TransitionsPanel } from "./EditPanels";

const REF_KEY = "otsi-look-reference";
const readRef = (): { label: string; stats: FrameStats } | null => { try { const x = sessionStorage.getItem(REF_KEY); return x ? JSON.parse(x) : null; } catch { return null; } };
const KINDS: [DrawKind, string][] = [["ARROW", "Arrow"], ["LINE", "Line"], ["CIRCLE", "Circle"]];
const COLOR_NAME: Record<DrawColor, string> = { YELLOW: "yellow", WHITE: "white", CYAN: "cyan", RED: "red" };
const msTc = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const chip = (on: boolean, can: boolean) => ({ padding: `${u(5)} ${u(11)}`, borderRadius: u(6), border: `${u(1.5)} solid ${on ? "#33a8ff" : "#1d4f8a"}`,
  background: on ? "#0f4f9a" : "#0a2447", color: "#fff", fontSize: u(16), cursor: can ? "pointer" : "not-allowed", fontFamily: "inherit", opacity: can ? 1 : 0.55 });
const note = { margin: 0, fontSize: u(15), color: "#8ea3bf", lineHeight: 1.3 };

export const effectName = (e: ClipEffect) =>
  e.kind === "SLOW" ? `Slow ${e.speed}x` : e.kind === "FREEZE" ? `Freeze ${(e.hold_ms / 1000).toFixed(1)} s` : e.kind === "RAMP" ? `Hero ramp ${e.speed}x` : "Normal speed";

function Section({ id, title, open, toggle, children, pro }: { id: string; title: string; open: boolean; toggle: (id: string) => void; children: ReactNode; pro?: boolean }) {
  return (
    <div data-adjust={id} data-pro={pro ? "" : undefined} style={{ borderBottom: `${u(1)} solid #12335f` }}>
      <button type="button" aria-expanded={open} onClick={() => toggle(id)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", padding: `${u(10)} ${u(8)}`, background: "transparent", border: 0, color: "#e3eefb",
          fontSize: u(19), fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}>
        <span>{title}</span><span aria-hidden style={{ color: "#8ea3bf" }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div style={{ display: "flex", flexDirection: "column", gap: u(9), padding: `0 ${u(8)} ${u(12)}` }}>{children}</div>}
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
    <label style={{ display: "grid", gridTemplateColumns: `${u(150)} 1fr ${u(60)}`, alignItems: "center", gap: u(8), fontSize: u(16), color: "#cfe0f5" }}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} disabled={!can} aria-label={label} onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <span style={{ textAlign: "right" }}>{fmt(v)}</span>
    </label>
  );
}

export function Adjustments({ r, st, ui, placed, suggestAt }: { r: ReelState | null; st: Studio; ui: Ui; placed: Placed | null; suggestAt: number | null }) {
  const reel = st.reel;
  const open = st.adjOpen, setOpen = st.setAdjOpen;
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [ease, setEase] = useState<ZoomEase>("EASE");
  const [ref, setRef] = useState(readRef);
  if (!reel) return <p style={{ ...note, margin: u(20) }}>Choose a reel to adjust it.</p>;
  const can = !!r?.canEdit && !r.busy;
  const why = () => ui.say(!r?.canEdit ? "Your role can view this reel but not edit it" : "Saving the previous change…");
  const s = reel.settings;
  const set = (patch: Partial<SpotlightSettings>, label: string) => (can ? st.setSettings(patch, label) : why());

  // ------------------------------------------------------------------ speed (the clip)
  const c = placed?.clip ?? null;
  const e = c?.effect ?? null;
  const head = locate(st.items, st.playhead);
  const headIn = c && head && head.p.clip.id === c.id && head.src > c.in_pts_us + 100_000 && head.src < c.out_pts_us - 100_000 ? Math.round(head.src) : null;
  const keyAt = headIn ?? (c && suggestAt !== null && suggestAt > c.in_pts_us && suggestAt < c.out_pts_us ? suggestAt : null);
  const apply = (x: SetClipEffectRequest, label: string) => {
    if (!c) return ui.say("Select a clip on the timeline first");
    if (!can) return why();
    if ((x.kind === "FREEZE" || x.kind === "RAMP") && x.at_us === null) return ui.say("Move the playhead onto the moment inside the clip first");
    st.setEffect(c, x, label);
  };
  const extra = c ? clipOutputUs(c) - (c.out_pts_us - c.in_pts_us) : 0;
  const strap = [reel.player?.display_name, reel.player_roster?.jersey_number != null ? `#${reel.player_roster.jersey_number}` : null, reel.player_roster?.position,
    reel.player?.canonical_otsi_id, reel.player_club].filter(Boolean).join("  ·  ");

  return (
    <div data-adjustments={c?.id ?? "reel"} style={{ display: "flex", flexDirection: "column" }}>
      <p style={{ ...note, padding: `${u(4)} ${u(8)} ${u(6)}` }}>
        {c ? `Clip ${placed!.index + 1}${c.label ? ` · ${c.label}` : ""}${r?.selectedClip === c.id ? "" : " · at the playhead"}` : "No clip under the playhead: the reel's settings"}
      </p>

      <Section id="speed" title={`Speed${e && e.kind !== "NONE" ? ` · ${effectName(e)}` : ""}`} open={open.has("speed")} toggle={toggle}>
        {!c ? <p style={note}>Select a clip on the timeline to slow it down, freeze it or ramp it.</p> : (
          <>
            <span style={{ display: "flex", flexWrap: "wrap", gap: u(6) }}>
              <button type="button" data-effect="NONE" aria-pressed={e?.kind === "NONE"} style={chip(e?.kind === "NONE", can)} onClick={() => apply({ kind: "NONE", at_us: null, speed: 1, hold_ms: 0 }, "Normal speed")}>Normal</button>
              {[0.5, 0.25].map((v) => (
                <button key={v} type="button" data-effect={`SLOW-${v}`} aria-pressed={e?.kind === "SLOW" && e.speed === v} style={chip(e?.kind === "SLOW" && e.speed === v, can)}
                  onClick={() => apply({ kind: "SLOW", at_us: null, speed: v, hold_ms: 0 }, `Slow motion ${v}x`)}>Slow {v}x</button>
              ))}
              <button type="button" data-effect="FREEZE" aria-pressed={e?.kind === "FREEZE"} style={chip(e?.kind === "FREEZE", can)}
                onClick={() => apply({ kind: "FREEZE", at_us: keyAt, speed: 1, hold_ms: e?.kind === "FREEZE" ? e.hold_ms : FREEZE_MS_DEFAULT }, "Freeze frame")}>Freeze</button>
              <button type="button" data-effect="RAMP" aria-pressed={e?.kind === "RAMP"} style={chip(e?.kind === "RAMP", can)}
                onClick={() => apply({ kind: "RAMP", at_us: keyAt, speed: e?.kind === "RAMP" ? e.speed : RAMP_SPEED_DEFAULT, hold_ms: 0 }, "Hero ramp")}>Hero ramp</button>
            </span>
            {/* B.19 (ADR-094): a spacer before the clip: that much black and silence in the reel */}
            <span data-gap-row="" style={{ display: "flex", flexWrap: "wrap", gap: u(6), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}
              title="Black and silence before this clip, e.g. to let a moment breathe or before a new chapter">Gap before
              {[0, 500, 1000, 2000, 3000].map((ms) => (
                <button key={ms} type="button" data-gap={ms} aria-pressed={(c.fx.gap_ms ?? 0) === ms} style={chip((c.fx.gap_ms ?? 0) === ms, can)}
                  onClick={() => { if (!can) return why(); if ((c.fx.gap_ms ?? 0) !== ms) st.setFx(c, { ...c.fx, gap_ms: ms }, ms ? `Gap of ${ms / 1000} s before the clip` : "Gap removed"); }}>
                  {ms ? `${(ms / 1000).toFixed(1)} s` : "None"}</button>
              ))}
            </span>
            {e?.kind === "FREEZE" && (
              <span style={{ display: "flex", flexWrap: "wrap", gap: u(6), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}>Hold
                {[500, 1000, 1500, 2000, 3000].map((ms) => (
                  <button key={ms} type="button" data-hold={ms} aria-pressed={e.hold_ms === ms} style={chip(e.hold_ms === ms, can)}
                    onClick={() => apply({ kind: "FREEZE", at_us: e.at_us, speed: 1, hold_ms: ms }, `Freeze ${(ms / 1000).toFixed(1)} s`)}>{(ms / 1000).toFixed(1)} s</button>
                ))}
              </span>
            )}
            {e?.kind === "RAMP" && (
              <span style={{ display: "flex", flexWrap: "wrap", gap: u(6), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}>Slowest
                {[0.5, 0.35, 0.25].map((v) => (
                  <button key={v} type="button" data-ramp={v} aria-pressed={e.speed === v} style={chip(e.speed === v, can)}
                    onClick={() => apply({ kind: "RAMP", at_us: e.at_us, speed: v, hold_ms: 0 }, `Hero ramp ${v}x`)}>{v}x</button>
                ))}
              </span>
            )}
            {e && (e.kind === "FREEZE" || e.kind === "RAMP") && (
              <span style={{ display: "flex", alignItems: "center", gap: u(8), fontSize: u(16), color: "#cfe0f5" }}>
                Key moment {e.at_us !== null ? tc(e.at_us) : "—"}
                {keyAt !== null && keyAt !== e.at_us && (
                  <button type="button" data-set-moment style={chip(false, can)} onClick={() => apply({ ...e, at_us: keyAt }, "Key moment moved")}>
                    {headIn !== null ? "Move to the playhead" : "Move to his event"}</button>
                )}
              </span>
            )}
            <p style={note} data-effect-state={c && e && e.kind !== "NONE" && !effectActive(c) ? "inactive" : "ok"}>
              {e && e.kind !== "NONE" && !effectActive(c)
                ? "Its key moment is outside the clip now (after a trim): it does nothing until you set it again."
                : e?.kind === "FREEZE" ? "The picture stops at the key moment, the spotlight held on him, then plays on. The match sound pauses."
                : e?.kind === "RAMP" ? "Eases down to the slowest speed at the key moment and back up, one second either side."
                : e?.kind === "SLOW" ? "The whole clip plays slower; its sound is slowed with the pitch kept."
                : keyAt === null ? "Freeze and Hero ramp use the playhead: move it onto the moment inside this clip." : `Freeze and Hero ramp will use ${tc(keyAt)}.`}
              {extra > 0 ? ` The clip is ${(extra / 1e6).toFixed(1)} s longer in the reel.` : ""}
            </p>
          </>
        )}
      </Section>

      {/* B.21 (ADR-096): transitions on this cut or every cut, the reel's markers, saved blocks of clips */}
      <Section id="trans" title={`Transitions · ${reel.transitions.length}`} open={open.has("trans")} toggle={toggle}>
        <TransitionsPanel st={st} placed={placed} can={can} why={why} />
      </Section>
      <Section id="markers" title={`Markers · ${st.notes.filter((n) => n.at_pts_us !== null).length}`} open={open.has("markers")} toggle={toggle}>
        <MarkersPanel st={st} ui={ui} />
      </Section>
      {/* B.25 (ADR-100): suggested clip ends around his events, Inferred */}
      <Section id="cuts" title="Suggested cuts" open={open.has("cuts")} toggle={toggle}>
        {open.has("cuts") && <CutsPanel st={st} can={can} why={why} />}
      </Section>
      <Section id="blocks" title="Blocks" open={open.has("blocks")} toggle={toggle}>
        <BlocksPanel st={st} ui={ui} placed={placed} can={can} why={why} />
      </Section>
      <Section id="strap" title="Strap & caption" open={open.has("strap")} toggle={toggle}>
        <label style={{ display: "flex", gap: u(8), fontSize: u(16), color: "#cfe0f5", alignItems: "center" }}>
          <input type="checkbox" checked={s.lower_third} disabled={!can} onChange={() => set({ lower_third: !s.lower_third }, s.lower_third ? "Strap off" : "Strap on")} /> Name strap (lower third)
        </label>
        <p style={note} data-strap>{reel.player ? strap : "No confirmed player: no name is shown"}</p>
        <label style={{ display: "flex", gap: u(8), fontSize: u(16), color: "#cfe0f5", alignItems: "center" }}>
          <input type="checkbox" checked={s.event_tags} disabled={!can} onChange={() => set({ event_tags: !s.event_tags }, s.event_tags ? "Event caption off" : "Event caption on")} /> Event caption
          {c?.label ? <span style={{ color: "#8ea3bf" }}>· “{c.label}”</span> : null}
        </label>
        <p style={note}>Only recorded data: the confirmed player, the team sheet and the clip's moment. With a freeze or ramp they appear one second before its key moment, else at the clip's start.</p>
      </Section>

      <Section id="spot" title="Spotlight" open={open.has("spot")} toggle={toggle}>
        <Slider label="Darken the rest" value={s.dim} min={0} max={0.9} step={0.05} can={can} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => set({ dim: v }, "Darkening saved")} />
        <Slider label="Beam size" value={s.size} min={0.8} max={3} step={0.1} can={can} fmt={(v) => `${v.toFixed(1)}x`} save={(v) => set({ size: v }, "Beam size saved")} />
        <Slider label="Softness" value={s.feather} min={0.05} max={1.5} step={0.05} can={can} fmt={(v) => v.toFixed(2)} save={(v) => set({ feather: v }, "Softness saved")} />
        <Slider label="Target lock" value={s.lock} min={0} max={1} step={0.05} can={can} fmt={(v) => (v < 0.34 ? "strict" : v > 0.66 ? "tolerant" : "normal")} save={(v) => set({ lock: v }, "Target lock saved")} />
        <label style={{ display: "flex", gap: u(8), fontSize: u(16), color: "#cfe0f5", alignItems: "center" }}>
          <input type="checkbox" checked={s.auto_track} disabled={!can} onChange={() => set({ auto_track: !s.auto_track }, s.auto_track ? "Auto Track off" : "Auto Track on")} /> Auto Track (smoother, slower render)
        </label>
        <label style={{ display: "flex", gap: u(8), fontSize: u(16), color: "#cfe0f5", alignItems: "center" }}>
          <input type="checkbox" checked={s.name_caption} disabled={!can} onChange={() => set({ name_caption: !s.name_caption }, s.name_caption ? "Name above the head off" : "Name above the head on")} /> Name above his head
        </label>
      </Section>

      <Section pro id="reframe" title={`Reframe · ${reel.aspect}`} open={open.has("reframe")} toggle={toggle}>
        <span style={{ display: "flex", flexWrap: "wrap", gap: u(6) }}>
          {(["16:9", "9:16", "1:1", "4:5"] as const).map((a) => (
            <button key={a} type="button" data-aspect={a} aria-pressed={reel.aspect === a} style={chip(reel.aspect === a, can)}
              onClick={() => (can ? st.setAspect(a) : why())}>{a} {a === "16:9" ? "wide" : a === "9:16" ? "tall" : a === "4:5" ? "feed" : "square"}</button>
          ))}
        </span>
        <Slider label="Follow speed" value={s.reframe_speed ?? 0.5} min={0} max={1} step={0.05} can={can && reel.aspect !== "16:9"}
          fmt={(v) => (v < 0.34 ? "calm" : v > 0.66 ? "quick" : "normal")} save={(v) => set({ reframe_speed: v }, "Follow speed saved")} />
        <p style={note} data-reframe-note>{reel.aspect === "16:9"
          ? "The whole picture is kept. Choose tall or square to keep only the part around him; the frame then follows him."
          : "The frame follows the confirmed player, looking a little ahead of him and holding still while he stays near its centre. Where he was not seen it holds where it was. The preview shades what the file leaves out."}</p>
        <p style={note}>To move in on him inside a clip, use Zoom below.</p>
      </Section>

      <Section id="sound" title="Sound" open={open.has("sound")} toggle={toggle}>
        {/* B.20 (ADR-095): the mixer: this clip's own level, then the reel's music and match sound, then the loudness of every file */}
        {c ? (
          <span data-clip-gain-row="" style={{ display: "flex", flexWrap: "wrap", gap: u(6), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}
            title="This clip's match sound against how it was recorded">{`Clip ${placed!.index + 1} sound`}
            {[MUTE_DB, -12, -6, 0, 3, 6].map((db) => {
              const on = (c.fx.gain_db ?? 0) === db || (db === MUTE_DB && (c.fx.gain_db ?? 0) <= MUTE_DB);
              return (
                <button key={db} type="button" data-clip-gain={db} aria-pressed={on} style={chip(on, can)}
                  onClick={() => { if (!can) return why(); if (!on) st.setFx(c, { ...c.fx, gain_db: db }, db === MUTE_DB ? "Clip sound muted" : `Clip sound ${db > 0 ? "+" : ""}${db} dB`); }}>
                  {db === MUTE_DB ? "Mute" : db === 0 ? "As recorded" : `${db > 0 ? "+" : ""}${db} dB`}</button>
              );
            })}
          </span>
        ) : <p style={note}>Select a clip to set its own sound level or mute it.</p>}
        {s.music_id ? (
          <>
            <Slider label="Music" value={s.music_volume} min={0} max={1} step={0.05} can={can} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => set({ music_volume: v }, "Music level saved")} />
            <Slider label="Match sound" value={s.match_volume} min={0} max={1} step={0.05} can={can} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => set({ match_volume: v }, "Match sound level saved")} />
            <label style={{ display: "flex", gap: u(8), fontSize: u(16), color: "#cfe0f5", alignItems: "center" }}>
              <input type="checkbox" data-duck checked={s.duck_music ?? true} disabled={!can} onChange={() => set({ duck_music: !(s.duck_music ?? true) }, (s.duck_music ?? true) ? "Music no longer dips" : "Music dips under the match sound")} />
              Music dips when the match is loud (crowd, whistle)
            </label>
          </>
        ) : <p style={note}>No music chosen: the reel has the clips' match sound as recorded. Choose music in the Media Bin.</p>}
        <span data-loudness-row="" style={{ display: "flex", flexWrap: "wrap", gap: u(6), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}>Loudness
          {LOUDNESS_TARGETS.map((t) => {
            const on = (s.loudness_lufs ?? null) === t.lufs;
            return <button key={String(t.lufs)} type="button" data-loudness={t.lufs ?? "auto"} aria-pressed={on} title={t.note} style={chip(on, can)}
              onClick={() => { if (!on) set({ loudness_lufs: t.lufs }, `Loudness: ${t.label}`); }}>{t.label}</button>;
          })}
        </span>
        <p style={note}>{(LOUDNESS_TARGETS.find((t) => t.lufs === (s.loudness_lufs ?? null)) ?? LOUDNESS_TARGETS[0]!).note}. A clip's boost is heard in the file; the preview can only play it as recorded or quieter.</p>
        {(() => {
          const res = reel.last_good_render?.result as { loudness_lufs?: number | null } | null | undefined, cfg = reel.last_good_render?.config as { audio?: { lufs?: number } } | undefined;
          return res?.loudness_lufs != null ? <p data-measured-lufs={res.loudness_lufs} style={note}>{`Last file measured ${res.loudness_lufs.toFixed(1)} LUFS${cfg?.audio?.lufs != null ? ` (target ${cfg.audio.lufs})` : ""}.`}</p> : null;
        })()}
      </Section>
      {(() => {
        // ---------------------------------------------------------------- look (the reel)
        const lk: Look = s.look ?? NEUTRAL_LOOK;
        const setLook = (patch: Partial<Look>, label: string) => set({ look: { ...lk, ...patch } }, label);
        const takeRef = () => {
          const f = st.grab.current?.();
          if (!f) return ui.say("No frame on screen yet: play or seek the preview first");
          const r2 = { label: `${reel.name} at ${tc(f.at_us)}`, stats: frameStats(f.rgba) };
          try { sessionStorage.setItem(REF_KEY, JSON.stringify(r2)); } catch { /* kept for this page only */ }
          setRef(r2);
          ui.say(`Reference: ${r2.label}. Open any clip or reel, then Match to reference`);
        };
        const match = () => {
          if (!ref) return ui.say("Choose a reference frame first: Use this frame as the reference");
          const f = st.grab.current?.();
          if (!f) return ui.say("No frame on screen yet: play or seek the preview first");
          setLook({ match: matchFrom(frameStats(f.rgba), ref.stats, ref.label) }, `Matched to ${ref.label}`);
        };
        return (
          <Section pro id="look" title={`Look${isNeutral(lk) ? "" : ` · ${lk.preset !== "NONE" ? LOOK_PRESETS[lk.preset].label : "custom"}${lk.match ? " + match" : ""}`}`} open={open.has("look")} toggle={toggle}>
            <span style={{ display: "flex", flexWrap: "wrap", gap: u(6) }}>
              {(Object.keys(LOOK_PRESETS) as LookPreset[]).map((k) => (
                <button key={k} type="button" data-look-preset={k} aria-pressed={lk.preset === k} style={chip(lk.preset === k, can)}
                  onClick={() => setLook({ preset: k }, `Look: ${LOOK_PRESETS[k].label}`)}>{LOOK_PRESETS[k].label}</button>
              ))}
            </span>
            <Slider label="Look strength" value={lk.strength} min={0} max={1} step={0.05} can={can && lk.preset !== "NONE"} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => setLook({ strength: v }, "Look strength saved")} />
            <Slider label="Exposure" value={lk.exposure} min={-1} max={1} step={0.05} can={can} fmt={(v) => `${v > 0 ? "+" : ""}${v.toFixed(2)}`} save={(v) => setLook({ exposure: v }, "Exposure saved")} />
            <Slider label="Contrast" value={lk.contrast} min={0.5} max={1.5} step={0.05} can={can} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => setLook({ contrast: v }, "Contrast saved")} />
            <Slider label="Saturation" value={lk.saturation} min={0} max={2} step={0.05} can={can} fmt={(v) => `${Math.round(v * 100)} %`} save={(v) => setLook({ saturation: v }, "Saturation saved")} />
            <Slider label="Warmth" value={lk.temperature} min={-1} max={1} step={0.05} can={can} fmt={(v) => (Math.abs(v) < 0.025 ? "neutral" : v > 0 ? `warm ${v.toFixed(2)}` : `cool ${(-v).toFixed(2)}`)} save={(v) => setLook({ temperature: v }, "Warmth saved")} />
            <span style={{ display: "flex", flexWrap: "wrap", gap: u(6) }}>
              <button type="button" data-look-ref style={chip(false, true)} onClick={takeRef}>Use this frame as the reference</button>
              <button type="button" data-look-match style={chip(!!lk.match, can && !!ref)} onClick={() => (can ? match() : why())}>Match to reference</button>
              {lk.match && <button type="button" data-look-unmatch style={chip(false, can)} onClick={() => (can ? setLook({ match: null }, "Match removed") : why())}>Remove the match</button>}
              {!isNeutral(lk) && <button type="button" data-look-reset style={chip(false, can)} onClick={() => (can ? set({ look: NEUTRAL_LOOK }, "Look reset") : why())}>Reset</button>}
            </span>
            <p style={note} data-look-note>
              {lk.match ? `Matched to ${lk.match.label}. ` : ref ? `Reference: ${ref.label}. ` : ""}
              The whole reel's match picture, before the spotlight. The preview shows it live; Export bakes the same colours into the file.
            </p>
          </Section>
        );
      })()}

      {(() => {
        // ---------------------------------------------------------------- zoom (the clip)
        const ms = c ? clipMs(st.items, st.playhead, c.id) : null;
        const keys = c?.fx.zoom ?? [];
        const lenMs = c ? Math.floor(clipOutputUs(c) / 1000) : 0;
        const put = (zoom: typeof keys, label: string) => { if (!c) return ui.say("Select a clip on the timeline first"); if (!can) return why(); st.setFx(c, { ...c.fx, zoom }, label); };
        const addKey = (z: number) => {
          if (ms === null || ms > lenMs) return ui.say("Move the playhead inside this clip first");
          put([...keys.filter((k) => Math.abs(k.at_ms - ms) > 40), { at_ms: ms, zoom: z, ease }].sort((a, b) => a.at_ms - b.at_ms), `Zoom ${z}x at ${msTc(ms)}`);
        };
        return (
          <Section pro id="zoom" title={`Zoom${keys.length ? ` · ${keys.length} key${keys.length > 1 ? "s" : ""}` : ""}`} open={open.has("zoom")} toggle={toggle}>
            {!c ? <p style={note}>Select a clip on the timeline to zoom in on him.</p> : (
              <>
                <span style={{ display: "flex", flexWrap: "wrap", gap: u(6), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}>Add at the playhead
                  {[1, 1.25, 1.5, 2, 2.5].map((z) => (
                    <button key={z} type="button" data-zoom-add={z} style={chip(false, can && ms !== null)} onClick={() => addKey(z)}>{z}x</button>
                  ))}
                </span>
                <span style={{ display: "flex", flexWrap: "wrap", gap: u(6), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}>Then
                  {([["EASE", "Ease"], ["LINEAR", "Linear"], ["HOLD", "Hold"]] as const).map(([k, l]) => (
                    <button key={k} type="button" data-zoom-ease={k} aria-pressed={ease === k} style={chip(ease === k, true)} onClick={() => setEase(k)}>{l}</button>
                  ))}
                </span>
                {keys.map((k, i) => (
                  <span key={i} data-zoom-key={k.at_ms} style={{ display: "flex", gap: u(8), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}>
                    <button type="button" style={{ ...chip(ms !== null && Math.abs(ms - k.at_ms) <= 40, true), minWidth: u(150) }}
                      onClick={() => { const p = st.items.find((x) => x.clip.id === c.id); if (p) st.setPlayhead(p.start + k.at_ms * 1000); }}>{msTc(k.at_ms)} · {k.zoom}x</button>
                    <span style={{ color: "#8ea3bf" }}>{i < keys.length - 1 ? (k.ease === "EASE" ? "eases to the next" : k.ease === "HOLD" ? "holds, then jumps" : "moves evenly") : "stays"}</span>
                    <button type="button" aria-label={`Delete the zoom key at ${msTc(k.at_ms)}`} style={chip(false, can)}
                      onClick={() => put(keys.filter((_, j) => j !== i), `Zoom key at ${msTc(k.at_ms)} deleted`)}>×</button>
                  </span>
                ))}
                <p style={note} data-zoom-note>{keys.length
                  ? `Now ${ms !== null ? `${zoomAt(keys, ms).toFixed(2)}x at the playhead` : "—"}. The picture is moved in around him (where he was not seen it stays where it was), before the strap and graphics.`
                  : "Two keys make a move: e.g. 1x at the start, 2x at his touch. One key holds that zoom for the whole clip."}</p>
              </>
            )}
          </Section>
        );
      })()}

      {(() => {
        // ---------------------------------------------------------------- telestration (the clip)
        const ds = c?.fx.drawings ?? [];
        const del = (i: number) => { if (!c) return; if (!can) return why(); st.setFx(c, { ...c.fx, drawings: ds.filter((_, j) => j !== i) }, "Drawing deleted"); };
        return (
          <Section pro id="draw" title={`Draw${ds.length ? ` · ${ds.length}` : ""}`} open={open.has("draw")} toggle={toggle}>
            <span style={{ display: "flex", flexWrap: "wrap", gap: u(6), alignItems: "center" }}>
              {KINDS.map(([k, l]) => (
                <button key={k} type="button" data-draw-tool={k} aria-pressed={st.drawTool === k} style={chip(st.drawTool === k, can)}
                  onClick={() => { if (!can) return why(); st.setDrawTool(st.drawTool === k ? null : k); }}>{l}</button>
              ))}
              {(Object.keys(DRAW_RGB) as DrawColor[]).map((k) => (
                <button key={k} type="button" data-draw-color={k} aria-label={`Colour ${COLOR_NAME[k]}`} aria-pressed={st.drawColor === k} onClick={() => st.setDrawColor(k)}
                  style={{ width: u(28), height: u(28), borderRadius: "50%", background: DRAW_RGB[k], cursor: "pointer", border: `${u(3)} solid ${st.drawColor === k ? "#fff" : "#0a2447"}` }} />
              ))}
            </span>
            {ds.map((d, i) => (
              <span key={i} data-drawing={i} style={{ display: "flex", gap: u(8), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}>
                <i aria-hidden style={{ width: u(12), height: u(12), borderRadius: "50%", background: DRAW_RGB[d.color] }} />
                <button type="button" style={{ ...chip(false, true), minWidth: u(150) }}
                  onClick={() => { const p = c && st.items.find((x) => x.clip.id === c.id); if (p) st.setPlayhead(p.start + d.at_ms * 1000); }}>
                  {KINDS.find(([k]) => k === d.kind)![1]} at {msTc(d.at_ms)}</button>
                <span style={{ color: "#8ea3bf" }}>{msTc(d.draw_ms + d.hold_ms)} on screen</span>
                <button type="button" aria-label={`Delete drawing ${i + 1}`} style={chip(false, can)} onClick={() => del(i)}>×</button>
              </span>
            ))}
            <p style={note} data-draw-note>{!c ? "Select a clip, put the playhead on the moment, choose a tool and drag on the picture."
              : st.drawTool ? "Drag on the picture: it draws on from the playhead in 0.6 s, stays 2 s and fades. Escape stops drawing."
              : "Choose Arrow, Line or Circle (A / L / R), then drag on the picture. Drawings stay on the pitch spot you drew, not on a player."}</p>
          </Section>
        );
      })()}

      {(() => {
        // ---------------------------------------------------------------- reviewers' comments (the reel)
        const rv = st.reviews;
        return (
          <Section pro id="review" title={`Review${rv.length ? ` · ${rv.length}` : ""}`} open={open.has("review")} toggle={toggle}>
            {rv.length === 0 && <p style={note}>No reviewer comments yet. Share a rendered file from Export: what reviewers write there comes here, at its time.</p>}
            {rv.map((x) => {
              const t = reviewTime(x, reel, st.total);
              return (
                <div key={x.id} data-review={x.id} data-placed={t.at_us !== null ? "yes" : "no"} style={{ display: "flex", flexDirection: "column", gap: u(3), padding: `${u(6)} 0`, borderTop: `${u(1)} solid #12335f` }}>
                  <span style={{ display: "flex", gap: u(8), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}>
                    <b style={{ color: "#ff9bdc" }}>{x.name}</b>
                    {t.at_us !== null ? <button type="button" style={chip(false, true)} onClick={() => st.setPlayhead(t.at_us!)}>{tc(t.at_us)}</button>
                      : <span style={{ color: "#8ea3bf" }}>{x.at_s !== null ? `${x.at_s.toFixed(1)} s in the file` : "no time"}</span>}
                  </span>
                  <span style={{ fontSize: u(16), color: "#e3eefb", whiteSpace: "pre-wrap" }}>{x.body}</span>
                  {t.why && <span style={{ ...note, fontSize: u(14) }}>{t.why}</span>}
                </div>
              );
            })}
            <span><button type="button" data-review-refresh style={chip(false, true)} onClick={() => void st.loadReviews().then(() => ui.say("Review comments refreshed"))}>Refresh</button></span>
          </Section>
        );
      })()}
    </div>
  );
}
