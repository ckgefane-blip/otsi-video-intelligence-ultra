"use client";
/**
 * Page 07 Sections 05–11 — editing tools ribbon, timeline ruler and playhead, and the eight lanes (approved reference 07_CLIP_STUDIO).
 *
 * The Video Clips lane is the reel's saved clips back to back: click selects, drag reorders (saved at once), dropping a Media Bin moment
 * adds it. The ribbon edits the saved reel: Split (S) cuts the clip under the playhead in two, Cut (C) ends that clip at the playhead,
 * Ripple Delete (Delete) removes the selected clip and closes the gap, AI Highlights adds the engine's suggested moments. Zoom and Fit
 * to Screen change the view only. Add Marker (M) saves a note at the source time under the playhead (a reel note, shown as a yellow
 * line on the overview strip and the clips lane; write on it in the Clip Inspector). Add Graphic and Audio open the Media Bin's Graphics
 * and Audio tabs. The lanes below the clips show what the renderer will draw, from the reel's saved look: spotlight and logos, the
 * lower third (0.3 s after each clip starts, 3.5 s), the name caption, event tags and the score bug, the music and the match sound;
 * their eye switches that overlay on or off in the render (saved at once). The Transitions lane has a button on every cut between two
 * clips: Fade, Dissolve, Zoom or Spin and its length (PATCH /v1/reels/:id/transitions, ADR-055), drawn by the renderer over the start
 * of the clip after the cut, so the reel's length and sound stay the same. Voiceover, captions from speech, colour and transform
 * are not rendered yet: disabled with their reason. Speed opens the inspector's Adjustments (E2, ADR-065). The lock stops edits to the Video Clips lane.
 * E1 (ADR-064): drag a clip's left or right edge to trim it (one saved, undoable trim on release, Escape cancels; 0.5 to 60 s); Alt+[ / Alt+] trim the
 * start / end of the clip under the playhead to the playhead. Each clip's top line is green when the last rendered file has it as it is.
 */
import { TRANSITION_DEFAULT_MS, beatSnapTargets, beatsUsable, clipOutputUs, effectActive, reelBeats, strapStartUs, type BeatGrid, type BeatGridView, type TransitionKind } from "@otsi-vie/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { Btn, IN, NOT_BUILT, tc, type Ui } from "./kit";
import { MOMENT_MIME } from "./MediaBin";
import { locate, reviewTime, trimEdge, type Placed, type Studio } from "./useStudio";
import { renderedState } from "./spotlight";
import { effectName } from "./Adjustments";
import { laneGeometry, slipWindow, snapTo, type LaneMode } from "./editing";
import { DualTimeline } from "./DualTimeline";

/** something the renderer draws over part of the reel; `row` 0 / 1 = top / bottom half of the lane */
interface Item { key: string; from: number; to: number; text: string; color: string; row?: 0 | 1 }
const LOWER_IN = 300_000, LOWER_HOLD = 3_500_000, TAG = 2_500_000;
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** what each lane holds, from the reel's saved look (the same settings the renderer reads) */
function laneItems(st: Studio): Item[][] {
  const { t: dict } = useLocale();
  const s = st.reel?.settings, it = st.items, total = st.total;
  if (!s || !it.length) return [[], [], [], [], [], [], [], []];
  const nameOf = (id: string | null) => (id ? (st.brand?.find((a) => a.id === id)?.name ?? dict.body.studio.chosenWord) : null);
  const per = (f: (p: Placed) => Item | null) => it.map(f).filter((x): x is Item => !!x);
  const logos = [nameOf(s.competition_logo_id), nameOf(s.custom_logo_id)].filter(Boolean).map((n) => dict.body.studio.logoName.replace("{a}", String(n)));
  const extra = [...logos, ...(s.watermark ? [dict.body.studio.otsiMark] : [])];
  const player = st.reel?.player?.display_name ?? dict.body.studio.playerWord;
  const music = nameOf(s.music_id);
  // E2 (ADR-065): with a freeze or ramp, the strap and the event caption start one second before its key moment
  const tags: Item[] = s.event_tags ? per((p) => { const o = strapStartUs(p.clip); return p.clip.label && p.dur > o
    ? { key: p.clip.id, from: p.start + o, to: p.start + Math.min(p.dur, o + TAG), color: "#7a5a1a", text: p.clip.label, ...(s.score_bug ? { row: 0 as const } : {}) } : null; }) : [];
  const score: Item[] = s.score_bug ? [{ key: "score", from: 0, to: total, color: "#244a6a", text: dict.body.studio.teamsClock, ...(s.event_tags ? { row: 1 as const } : {}) }] : [];
  return [
    [],
    [],
    per((p) => ({ key: p.clip.id, from: p.start, to: p.start + p.dur, color: "#1a5a8a", text: [dict.body.studio.spotlightLabel, ...extra].join(" + ") })),
    s.lower_third ? per((p) => { const o = strapStartUs(p.clip); return p.dur > o + LOWER_IN
      ? { key: p.clip.id, from: p.start + o + LOWER_IN, to: p.start + Math.min(p.dur, o + LOWER_IN + LOWER_HOLD), color: "#5a3a8a", text: dict.body.studio.lowerThirdPlayer.replace("{a}", player) } : null; }) : [],
    s.name_caption ? per((p) => ({ key: p.clip.id, from: p.start, to: p.start + p.dur, color: "#3a5a2a", text: dict.body.studio.nameCaptionPlayer.replace("{a}", player) })) : [],
    [...tags, ...score],
    music ? [{ key: "music", from: 0, to: total, color: "#6a2a5a", text: dict.body.studio.musicLane.replace("{a}", music).replace("{b}", pct(s.music_volume)) }] : [],
    [{ key: "match", from: 0, to: total, color: "#2a4a4a", text: music ? dict.body.studio.matchSoundUnderMusic.replace("{a}", pct(s.match_volume)) : dict.body.studio.matchSoundRecorded }],
  ];
}

const O = 343, W = 2128;
const RULER = [357, 568, 809, 1055, 1296, 1533, 1780, 2022, 2265];
const LENGTHS = [400, 600, 1000];
const mmss = (t: number) => { const s = Math.round(t / 1e6); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

export function Timeline({ r, st, ui }: { r: ReelState | null; st: Studio; ui: Ui }) {
  const { t: dict } = useLocale();
  const [zoom, setZoom] = useState(1);
  const LANES: [string, number, string][] = [[dict.body.studio.videoClipsLabel, 1027, "p07-s07"], [dict.body.studio.transitionsSection, 1074, "p07-s08"], [dict.body.studio.graphicsOverlays, 1121, "p07-s09"],
    [dict.body.studio.lowerThirds, 1168, "p07-s10"], [dict.body.studio.captionsLabel, 1215, "p07-s10"], [dict.body.studio.statisticsLabel, 1266, "p07-s10"], [dict.body.studio.soundtrackLabel, 1320, "p07-s11"], [dict.body.studio.audioFxLabel, 1372, "p07-s11"]];
  const SECTIONS: [string, string][] = [["p07-s07", dict.body.studio.videoClipsLane], ["p07-s08", dict.body.studio.transitionsLane], ["p07-s09", dict.body.studio.graphicsSpotlightHint],
    ["p07-s10", dict.body.studio.lowerLanesHint], ["p07-s11", dict.body.studio.soundtrackHint]];
  const KINDS: [TransitionKind, string][] = [["FADE", dict.body.studio.fadeLabel], ["DISSOLVE", dict.body.studio.dissolveLabel], ["ZOOM", dict.body.studio.zoomLabel2], ["SPIN", dict.body.studio.spinLabel]];
  const kindName = (k: TransitionKind) => KINDS.find(([x]) => x === k)![1];
  const [hidden, setHidden] = useState(false);
  const [locked, setLocked] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [menuCut, setMenuCut] = useState<string | null>(null);                   // the cut whose transition menu is open: the clip after it
  /** E1: an edge being dragged (source microseconds moved); saved as one trim when the button is released */
  const [trimDrag, setTrimDrag] = useState<{ id: string; edge: "in" | "out"; d: number } | null>(null);
  const trimming = useRef(false);
  // B.19 (ADR-093): snapping edges, slipping a clip (Alt+drag, "," and "."), solo one lane, a tall Video Clips lane
  const [snap, setSnap] = useState(true);
  const [beatGrid, setBeatGrid] = useState<BeatGrid | null>(null);
  const musicId = st.reel?.settings.music_id;
  useEffect(() => {
    if (!musicId) { setBeatGrid(null); return; }
    let dead = false;
    void api<BeatGridView>(`/v1/brand-assets/${musicId}/beat-grid`).then(
      (v) => { if (!dead) setBeatGrid(v.grid); },
      () => { if (!dead) setBeatGrid(null); },
    );
    return () => { dead = true; };
  }, [musicId]);
  const [laneMode, setLaneMode] = useState<LaneMode>("normal");
  const [dual, setDual] = useState(false);
  const [solo, setSolo] = useState<number | null>(null);
  const [slipDrag, setSlipDrag] = useState<{ id: string; d: number } | null>(null);
  const geo = laneGeometry(laneMode);
  const lane = useRef<HTMLDivElement | null>(null);
  const edit = !!st.reel && !!r?.canEdit && !r.busy && !locked;
  const span = st.total / zoom;                                          // visible reel time
  const start = Math.max(0, Math.min(st.total - span, st.playhead - span / 2));
  const scale = st.total ? W / span : 0;
  const X = (t: number) => O + (t - start) * scale;
  const head = st.total ? X(st.playhead) : 336;
  const selected = st.items.find((p) => p.clip.id === r?.selectedClip) ?? null;
  // the playhead moves every frame while playing, so these derivations are memoised on what they actually read:
  // st.items is memoised on the reel in useStudio, so they hold still while only the playhead moves
  const rendered = useMemo(() => (st.reel ? renderedState(st.reel, dict) : null), [st.reel]);   // E1: is each clip in the last rendered file as it is now?
  const under = locate(st.items, st.playhead);
  const missing = useMemo(() => (r?.moments ?? []).filter((m) => !m.in_reel && !m.rejected), [r?.moments]);   // B.15: never one a person rejected
  const lanes = useMemo(() => laneItems(st), [st.reel, st.items, st.total, st.brand]);
  const set = st.reel?.settings;
  /** markers and notes in reel time (a note inside a clip's source in/out, wherever that clip sits in the reel) */
  const marks = useMemo(() => st.notes.flatMap((n) => {
    const at = n.at_pts_us;
    if (at === null) return [];
    return st.items.filter((p) => at >= p.clip.in_pts_us && at <= p.clip.out_pts_us)
      .map((p) => ({ key: `${n.id}-${p.clip.id}`, t: p.start + at - p.clip.in_pts_us, body: n.body }));
  }), [st.notes, st.items]);
  const addMarker = () => {
    if (!under || !st.reel) return;
    void st.addNote(dict.body.studio.markerLabel, Math.round(under.src))
      .then(() => ui.say(dict.body.studio.markerAddedAt.replace("{a}", tc(st.playhead))), () => ui.say(dict.body.studio.markerNotSaved));
  };
  const canSet = !!st.reel && !!r?.canEdit && !r.busy;
  /** the eye of a lane below the clips: switch its overlay in the render */
  const laneEye = (i: number): [boolean, string, () => void] | null => {
    if (!set) return null;
    const flip = (k: "lower_third" | "name_caption" | "event_tags", on: string, off: string) => (): void => {
      if (!canSet) return ui.say(r?.canEdit ? dict.body.studio.savingPrevChange : dict.body.studio.roleViewReel);
      st.setSettings({ [k]: !set[k] }, set[k] ? off : on);
    };
    if (i === 2) return [true, dict.body.studio.chooseLogosBin, () => { st.setBinTab(1); ui.say(dict.body.studio.spotlightAlwaysDrawn); }];
    if (i === 3) return [set.lower_third, set.lower_third ? dict.body.studio.leaveLowerThird : dict.body.studio.addLowerThird, flip("lower_third", dict.body.studio.lowerThirdOn, dict.body.studio.lowerThirdOff)];
    if (i === 4) return [set.name_caption, set.name_caption ? dict.body.studio.leaveNameCaption : dict.body.studio.addNameCaption, flip("name_caption", dict.body.studio.nameCaptionOn, dict.body.studio.nameCaptionOff)];
    if (i === 5) return [set.event_tags, set.event_tags ? dict.body.studio.leaveEventTags : dict.body.studio.addEventTags, flip("event_tags", dict.body.studio.eventTagsOn, dict.body.studio.eventTagsOff)];
    if (i === 6) {
      return [!!set.music_id, set.music_id ? dict.body.studio.takeMusicOut : dict.body.studio.chooseMusicBinAudio, () => {
        if (!set.music_id) { st.setBinTab(2); return ui.say(dict.body.studio.chooseMusicAudio); }
        if (!canSet) return ui.say(dict.body.studio.roleViewReel);
        st.setSettings({ music_id: null }, dict.body.studio.musicRemoved);
      }];
    }
    if (i === 7) {
      const on = set.match_volume > 0 || !set.music_id;
      return [on, !set.music_id ? dict.body.studio.matchSoundRecordedNoMusic : on ? dict.body.studio.muteMatchUnderMusic : dict.body.studio.bringMatchBack, () => {
        if (!set.music_id) return ui.say(dict.body.studio.noMusicKeepMatch);
        if (!canSet) return ui.say(dict.body.studio.roleViewReel);
        st.setSettings({ match_volume: on ? 0 : 0.3 }, on ? dict.body.studio.matchSoundMuted : dict.body.studio.matchSound30);
      }];
    }
    return null;
  };

  const cut = () => {
    if (!under || !edit) return;
    const end = Math.round(under.src);
    if (end > under.p.clip.in_pts_us + 100_000) st.trim(under.p.clip, under.p.clip.in_pts_us, end);
  };
  /** E1: Alt+[ trims the start of the clip under the playhead to the playhead, Alt+] its end */
  const trimToHead = (edge: "in" | "out") => {
    if (!under || !edit) return explain(edge === "in" ? "trim-in" : "cut", "");
    const t = Math.round(under.src), c = under.p.clip;
    if (edge === "in" ? t < c.in_pts_us + 100_000 || t > c.out_pts_us - 100_000 : t > c.out_pts_us - 100_000 || t < c.in_pts_us + 100_000)
      return ui.say(dict.body.studio.movePlayheadInside);
    if (edge === "in") { st.trim(c, t, c.out_pts_us); st.setPlayhead(under.p.start); } else st.trim(c, c.in_pts_us, t);
  };
  /** E1: drag a clip's left or right edge to trim it (the clips after it close up, as Ripple Delete does) */
  const edgeDown = (p: Placed, edge: "in" | "out") => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!edit) return explain("trim", "");
    const el = lane.current;
    if (!el || !st.total) return;
    const w = el.getBoundingClientRect().width, x0 = e.clientX;
    trimming.current = true;
    let d = 0, cancelled = false;
    setTrimDrag({ id: p.clip.id, edge, d });
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { cancelled = true; ev.preventDefault(); up(); ui.say(dict.body.studio.trimCancelled); } };
    // E2: a slowed clip's edge moves through source time at its speed
    const k = p.clip.effect.kind === "SLOW" && effectActive(p.clip) ? p.clip.effect.speed : 1;
    // B.19: where the edge may snap, in source time: markers inside the clip, the playhead (on this clip, or after it for the end)
    // C.5 (ADR-105): and the music's detected beat times
    const edgeAt = edge === "in" ? p.clip.in_pts_us : p.clip.out_pts_us;
    const beats = beatsUsable(beatGrid) ? reelBeats(beatGrid, st.total) : [];
    const bTargets = snap && beats.length ? beatSnapTargets(p, edge, beats) : [];
    const targets = !snap ? [] : [
      ...st.notes.flatMap((n) => (n.at_pts_us === null ? [] : [n.at_pts_us])),
      ...(under?.p.clip.id === p.clip.id ? [under.src] : []),
      ...(edge === "out" && p.clip.effect.kind === "NONE" && st.playhead > p.start ? [p.clip.in_pts_us + (st.playhead - p.start)] : []),
      ...bTargets,
    ];
    const move = (ev: PointerEvent) => {
      let want = ((ev.clientX - x0) / w) * span * k;
      if (targets.length) want = snapTo(edgeAt + want, targets, (8 / w) * span * k).v - edgeAt;
      const r2 = trimEdge(p.clip, edge, want);
      d = edge === "in" ? r2.in_pts_us - p.clip.in_pts_us : r2.out_pts_us - p.clip.out_pts_us;
      setTrimDrag({ id: p.clip.id, edge, d });
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("keydown", esc, true);
      setTrimDrag(null);
      setTimeout(() => { trimming.current = false; }, 0);
      if (cancelled || Math.abs(d) < 20_000) return;
      const r2 = trimEdge(p.clip, edge, d);
      st.trim(p.clip, r2.in_pts_us, r2.out_pts_us);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("keydown", esc, true);
  };
  /** B.19: Alt+drag a clip's body slips it: the same length, another part of the source (saved as one trim on release; Escape cancels) */
  const slipDown = (p: Placed) => (e: React.PointerEvent) => {
    if (!e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    if (!edit) return explain("trim", "");
    const el = lane.current;
    if (!el || !st.total) return;
    const w = el.getBoundingClientRect().width, x0 = e.clientX;
    trimming.current = true;
    let d = 0, cancelled = false;
    setSlipDrag({ id: p.clip.id, d });
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { cancelled = true; ev.preventDefault(); up(); ui.say(dict.body.studio.slipCancelled); } };
    const move = (ev: PointerEvent) => { d = slipWindow(p.clip, -((ev.clientX - x0) / w) * span).in_pts_us - p.clip.in_pts_us; setSlipDrag({ id: p.clip.id, d }); };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("keydown", esc, true);
      setSlipDrag(null);
      setTimeout(() => { trimming.current = false; }, 0);
      if (cancelled || Math.abs(d) < 20_000) return;
      const r2 = slipWindow(p.clip, d);
      st.trim(p.clip, r2.in_pts_us, r2.out_pts_us);
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("keydown", esc, true);
  };
  /** B.19: "," and "." slip the selected clip (else the one under the playhead) by one frame; with Shift by one second */
  const slipKey = (dir: -1 | 1, big: boolean) => {
    const c = (selected ?? under?.p)?.clip;
    if (!c || !edit) return explain("trim", "");
    const r2 = slipWindow(c, dir * (big ? 1_000_000 : 40_000));
    if (r2.in_pts_us !== c.in_pts_us) st.trim(c, r2.in_pts_us, r2.out_pts_us);
  };
  const ripple = () => { const c = selected ?? under?.p; if (c && edit) { st.remove(c.clip); r?.setSelectedClip(null); } };
  const highlights = () => r?.run(async () => {
    for (const m of missing) await api(`/v1/reels/${st.reel!.id}/clips`, { method: "POST", json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, origin: "SUGGESTED", label: m.label } });
  }, dict.body.studio.suggestedMomentsAdded.replace("{a}", String(missing.length)));

  useEffect(() => {                                                      // the reference's shortcuts: S, C, Delete
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey) return;
      if (e.altKey) {
        if (e.code === "BracketLeft") trimToHead("in"); else if (e.code === "BracketRight") trimToHead("out"); else return;
        e.preventDefault();
        return;
      }
      if (e.key === "s" || e.key === "S") { if (edit) st.split(); }
      else if (e.key === "c" || e.key === "C") cut();
      else if (e.key === "Delete") ripple();
      else if (e.key === "m" || e.key === "M") { if (edit && under) addMarker(); }
      else if (e.key === "," || e.key === "<") slipKey(-1, e.shiftKey);
      else if (e.key === "." || e.key === ">") slipKey(1, e.shiftKey);
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const toTime = (clientX: number) => {
    const el = lane.current;
    if (!el || !st.total) return 0;
    const rc = el.getBoundingClientRect();
    return Math.max(0, Math.min(st.total, start + ((clientX - rc.left) / rc.width) * span));
  };
  const dragHead = (e: React.PointerEvent) => {
    if (!st.total) return;
    st.setPlayhead(toTime(e.clientX));
    const move = (ev: PointerEvent) => st.setPlayhead(toTime(ev.clientX));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!edit) return;
    const m = e.dataTransfer.getData(MOMENT_MIME);
    if (m) { st.add(JSON.parse(m)); return; }
    const id = e.dataTransfer.getData("text/x-otsi-clip");
    if (!id) return;
    const t = toTime(e.clientX);
    const ids = st.items.map((p) => p.clip.id).filter((x) => x !== id);
    const at = st.items.filter((p) => p.clip.id !== id && p.start + p.dur / 2 < t).length;
    ids.splice(at, 0, id);
    if (ids.join() !== st.items.map((p) => p.clip.id).join()) st.reorder(ids);
  };

  const TOOLS: [string, string, number, number, (() => void) | null, string][] = [
    ["split", dict.body.studio.splitTool, 74, 101, edit && under ? () => { if (!st.split()) explain("split", ""); } : null, dict.body.studio.splitClipHint],
    ["cut", dict.body.studio.cutTool, 218, 245, edit && under ? cut : null, dict.body.studio.endClipHint],
    ["trash", dict.body.studio.rippleDelete, 355, 382, edit && (selected || under) ? ripple : null, dict.body.studio.rippleDeleteHint],
    ["marker", dict.body.studio.addMarkerTool, 535, 562, edit && under ? addMarker : null, dict.body.studio.addMarkerHint],
    ["gfx", dict.body.studio.addGraphic, 1083, 1112, st.reel ? () => { st.setBinTab(1); ui.say(dict.body.studio.graphicsHint); } : null, dict.body.studio.openGraphicsHint],
    // owner 2026-11-06 ("Why is the AI feature not working?"): the button says its state; dimmed alone looked broken
    ["ai", missing.length ? dict.body.studio.suggestionsCount.replace("{a}", String(missing.length)) : r?.moments?.length ? dict.body.studio.suggestionsCheck : dict.body.studio.suggestionsLabel, 1265, 1291, edit && missing.length ? highlights : null,
      missing.length ? dict.body.studio.addMomentsSuggested.replace("{a}", String(missing.length)) : r?.moments?.length ? dict.body.studio.allMomentsInReelCount.replace("{a}", String(r.moments.length)) : dict.body.studio.noMomentsSuggested],
    ["speed", dict.body.studio.speedSection, 1474, 1502, st.reel ? () => { st.setInspTab(2); ui.say(under || selected ? dict.body.studio.speedHint : dict.body.studio.selectClipSpeed); } : null,
      dict.body.studio.speedToolHint],
    ["col", dict.body.studio.colorLabel, 1617, 1645, st.reel ? () => { st.openAdjust("look"); ui.say(dict.body.studio.lookHint); } : null,
      dict.body.studio.colourToolHint],
    ["mus", dict.body.studio.audioLabel, 1754, 1781, st.reel ? () => { st.setBinTab(2); ui.say(dict.body.studio.audioChooseMusic); } : null, dict.body.studio.chooseMusicMediaBin],
    ["trf", dict.body.studio.transformLabel, 1892, 1919, st.reel ? () => { st.openAdjust("zoom"); st.openAdjust("draw"); ui.say(under || selected ? dict.body.studio.zoomDrawHint : dict.body.studio.selectClipZoomDraw); } : null,
      dict.body.studio.transformToolHint],
    ["fit", dict.body.studio.fitToScreen, 2133, 2160, () => setZoom(1), dict.body.studio.showWholeReel],
  ];
  const zf = (zoom - 1) / 7;                                             // zoom 1..8 on the slider
  /** why a tool cannot act right now (or open the reel chooser): no dead buttons */
  const explain = (k: string, why: string) => {
    if (why.startsWith(NOT_BUILT)) return ui.say(why);
    if (!st.reel) return ui.pick();
    if (!r?.canEdit) return ui.say(dict.body.studio.roleViewReel);
    if (locked) return ui.say(dict.body.studio.laneLocked);
    if (r.busy) return ui.say(dict.body.studio.savingPrevChange);
    if (k === "ai") return ui.say(r.moments?.length ? dict.body.studio.allMomentsInReel : dict.body.studio.noMomentsSuggested);
    if (k === "split" && under) return ui.say(dict.body.studio.movePlayheadInside);
    if (k === "trim") return ui.say(dict.body.studio.dragClipEdge);
    return ui.say(st.items.length ? dict.body.studio.movePlayheadOntoClip : dict.body.studio.reelNoClips);
  };

  return (
    <>
      <section aria-label={dict.body.studio.editingRibbon} data-section="p07-s05">
        <P x={28} y={843} w={2506} h={62} />
        {TOOLS.map(([k, l, ix, tx, fn, why]) => (
          <button key={l} type="button" aria-label={l} title={why} aria-disabled={!fn || undefined} data-tool={k} data-pro={k === "col" || k === "trf" ? "" : undefined} onClick={fn ?? (() => explain(k, why))} className="absolute"
            style={{ left: u(ix - 20), top: u(851 - 101), width: u(tx - ix + 20 + l.length * 10 + 10), height: u(48), padding: 0, border: 0, background: "transparent",
              cursor: "pointer", opacity: fn || l.endsWith("✓") ? 1 : 0.55, color: "inherit", font: "inherit" }}>
            <Ic o={[ix - 20, 851]} x={ix} y={875} k={k} size={28} color={k === "ai" ? "#33a8ff" : "#cfe0f5"} />
            <T o={[ix - 20, 851]} x={tx} y={875} size={19} color="#e3eefb" as="span">{l}</T>
          </button>
        ))}
        <B x={1421} y={860} w={1} h={32} style={{ background: "#12335f" }} />
        <B x={2078} y={860} w={1} h={32} style={{ background: "#12335f" }} />
        <Btn x={2270} y={862} w={26} h={26} label={dict.body.studio.zoomOut} onClick={zoom > 1 ? () => setZoom((z) => Math.max(1, z / 1.5)) : () => ui.say(dict.body.studio.alreadyWholeReel)}>
          <Ic o={[2270, 862]} x={2283} y={875} k="zo" size={26} color="#cfe0f5" />
        </Btn>
        <div className="absolute" style={{ left: u(2300), top: u(862 - 101), width: u(178), height: u(26) }}>
          <B o={[2300, 862]} x={2310} y={873} w={158} h={5} style={{ background: "#0b2a4d", borderRadius: u(3) }} />
          <B o={[2300, 862]} x={2310} y={873} w={10 + zf * 148} h={5} style={{ background: "#1e90ff", borderRadius: u(3) }} />
          <B o={[2300, 862]} x={2310 + zf * 136} y={865} w={22} h={22} style={{ background: "#cfe8ff", border: `${u(3)} solid #33a8ff`, borderRadius: "50%" }} />
          <input type="range" min={1} max={8} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label={dict.body.studio.timelineZoom}
            style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", cursor: "pointer" }} />
        </div>
        <Btn x={2485} y={862} w={26} h={26} label={dict.body.studio.zoomIn} onClick={zoom < 8 ? () => setZoom((z) => Math.min(8, z * 1.5)) : () => ui.say(dict.body.studio.maxZoom)}>
          <Ic o={[2485, 862]} x={2498} y={875} k="zi" size={26} color="#cfe0f5" />
        </Btn>
      </section>

      <section aria-label={dict.body.studio.timelineRuler} data-section="p07-s06">
        <T x={42} y={937} size={32} weight={700} color="#33a8ff">{tc(st.playhead)}</T>
        <T x={42} y={972} size={20} color="#8ea3bf">{tc(st.total)}</T>
        {([["snap", snap ? dict.body.studio.snapOn : dict.body.studio.snapOff, snap ? (beatsUsable(beatGrid) ? dict.body.studio.snapTitleOnBeats : dict.body.studio.snapTitleOnPlain) : dict.body.studio.snapTitleOff, () => setSnap(!snap), snap, 152, 56],
           ["tall", laneMode === "tall" ? dict.body.studio.tallOn : dict.body.studio.tallOff, laneMode === "tall" ? dict.body.studio.backToNormalLanes : dict.body.studio.tallLaneHint, () => setLaneMode(laneMode === "tall" ? "normal" : "tall"), laneMode === "tall", 212, 56],
           ["dual", dual ? dict.body.studio.dualOn : dict.body.studio.dualOff, dual ? dict.body.studio.exitDual : dict.body.studio.compareTwoCuts, () => setDual(!dual), dual, 272, 58]] as const).map(([k, l, t, go, on, x, bw]) => (
          <button key={k} type="button" data-timeline-toggle={k} aria-pressed={on} title={t} aria-label={t} onClick={go} className="absolute"
            style={{ left: u(x), top: u(957 - 101), width: u(bw), height: u(28), fontSize: u(14), fontWeight: 600, color: on ? "#fff" : "#cfe0f5", background: on ? "#0d3a78" : "#0a2447",
              border: `${u(1.5)} solid ${on ? "#33a8ff" : "#1d4f8a"}`, borderRadius: u(6), cursor: "pointer", padding: 0, fontFamily: "inherit", zIndex: 5 }}>{l}</button>
        ))}
        {RULER.map((x, i) => <T key={x} x={x} y={937} size={20} color="#cfe0f5">{i === 0 ? mmss(start) : st.total ? mmss(start + ((x - 357) / (2265 - 357)) * span * (8 / 8)) : "—"}</T>)}
        {/* overview strip: the whole reel, click to move the playhead */}
        <div role="slider" aria-label={dict.body.studio.reelOverview} aria-valuemin={0} aria-valuemax={Math.round(st.total / 1e6)} aria-valuenow={Math.round(st.playhead / 1e6)} tabIndex={0}
          onClick={(e) => { if (!st.total) { if (!st.reel) ui.pick(); else ui.say(dict.body.studio.reelNoClipsShort); return; } const rc = e.currentTarget.getBoundingClientRect(); st.setPlayhead(((e.clientX - rc.left) / rc.width) * st.total); }}
          className="absolute" style={{ left: u(335), top: u(958 - 101), width: u(2199), height: u(42), background: "#0a1d38", opacity: 0.75, cursor: "pointer" }}>
          {st.items.map((p) => (
            <span key={p.clip.id} style={{ position: "absolute", left: `${(p.start / st.total) * 100}%`, width: `${(p.dur / st.total) * 100}%`, top: u(8), bottom: u(8),
              background: p.clip.id === r?.selectedClip ? "#33a8ff" : "#1e5aa0", borderRight: `${u(1)} solid #0a1d38` }} />
          ))}
          {st.total > 0 && marks.map((m) => <span key={m.key} title={`${tc(m.t)} ${m.body}`} data-marker={m.t}
            style={{ position: "absolute", left: `${(m.t / st.total) * 100}%`, width: u(3), top: 0, bottom: 0, background: "#f5d02e" }} />)}
          {st.total > 0 && st.reel && st.reviews.map((x) => {                // E5: reviewers' comments, where they fall in this edit
            const t = reviewTime(x, st.reel!, st.total, dict).at_us;
            return t === null ? null : <span key={x.id} title={`${tc(t)} ${x.name}: ${x.body}`} data-review-marker={t}
              style={{ position: "absolute", left: `${(t / st.total) * 100}%`, width: u(4), top: 0, bottom: 0, background: "#ff6bd5" }} />;
          })}
          {st.total > 0 && <span style={{ position: "absolute", left: `${(start / st.total) * 100}%`, width: `${100 / zoom}%`, top: 0, bottom: 0, border: `${u(1.5)} solid #33a8ff` }} />}
        </div>
        <B x={28} y={1003} w={304} h={412} style={{ background: "#06122a", border: `${u(1.5)} solid #12335f`, borderRadius: u(10) }} />
        <div ref={lane} aria-hidden className="absolute" style={{ left: u(O), top: u(1003 - 101), width: u(W), height: u(4) }} />
        <div role="slider" aria-label={dict.body.studio.playheadLabel} aria-valuemin={0} aria-valuemax={Math.round(st.total / 1e6)} aria-valuenow={Math.round(st.playhead / 1e6)} tabIndex={0}
          onPointerDown={dragHead} onKeyDown={(e) => { if (e.key === "ArrowRight") st.setPlayhead(Math.min(st.total, st.playhead + 1e6)); if (e.key === "ArrowLeft") st.setPlayhead(Math.max(0, st.playhead - 1e6)); }}
          className="absolute" style={{ left: u(head - 15), top: u(922 - 101), width: u(30), height: u(28), background: "#1e90ff", borderRadius: u(6), zIndex: 3, cursor: st.total ? "ew-resize" : "default", touchAction: "none" }}>
          <Ic o={[head - 15, 922]} x={head} y={936} k="chev" size={16} />
        </div>
        <B x={head - 1} y={935} w={2} h={480} style={{ background: "#33a8ff", boxShadow: `0 0 ${u(8)} #33a8ff`, zIndex: 3, pointerEvents: "none" }} />
      </section>

      {SECTIONS.map(([id, label]) => (
        <section key={id} aria-label={label} data-section={id}>
          {LANES.map(([name, , sec], i) => { const { y, h } = geo[i]!; return sec !== id ? null : (
            <div key={name} role="group" aria-label={dict.body.studio.laneAria.replace("{a}", name)}>
              {i === 0 ? (
                <>
                  <Btn x={36} y={y - 16} w={32} h={32} label={hidden ? dict.body.studio.showLane : dict.body.studio.dimLane} pressed={hidden} onClick={() => setHidden((h) => !h)}>
                    <Ic o={[36, y - 16]} x={52} y={y} k="eye" size={26} color={hidden ? "#6a7f9c" : "#cfe0f5"} />
                  </Btn>
                  <Btn x={74} y={y - 16} w={30} h={32} label={locked ? dict.body.studio.unlockLane : dict.body.studio.lockLane} pressed={locked} onClick={() => setLocked((l) => !l)}>
                    <Ic o={[74, y - 16]} x={89} y={y} k="lock" size={24} color={locked ? "#f5b82e" : "#cfe0f5"} />
                  </Btn>
                </>
              ) : (() => {
                const eye = laneEye(i);
                return eye ? (
                  <Btn x={36} y={y - 16} w={32} h={32} label={eye[1]} pressed={eye[0]} onClick={eye[2]}>
                    <Ic o={[36, y - 16]} x={52} y={y} k={i === 7 ? "mute" : "eye"} size={i === 7 ? 24 : 26} color={eye[0] ? "#cfe0f5" : "#6a7f9c"} />
                  </Btn>
                ) : <span title={i === 1 ? `${name}: click + on a cut to add a transition; the render draws it` : name}><Ic x={52} y={y} k="eye" size={26} color={i === 1 ? "#cfe0f5" : "#6a7f9c"} /></span>;
              })()}
              <button type="button" data-lane-solo={i} aria-pressed={solo === i} onClick={() => setSolo(solo === i ? null : i)}
                title={solo === i ? dict.body.studio.showEveryLane : `Solo: show the ${name} lane alone (the others dimmed)`} className="absolute"
                style={{ left: u(124), top: u(y - 14 - 101), height: u(28), maxWidth: u(162), padding: `0 ${u(4)}`, border: 0, borderRadius: u(4), cursor: "pointer", fontFamily: "inherit",
                  fontSize: u(18), color: solo === i ? "#06122a" : "#e3eefb", background: solo === i ? "#f5d02e" : "transparent", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</button>
              <B x={289} y={y - 16} w={32} h={32} style={{ background: "#0a2447", borderRadius: u(6) }} />
              <T x={305} y={y} size={19} align="center">{i === 0 ? st.items.length : i === 1 ? (st.reel?.transitions.length ?? 0) : lanes[i]!.length}</T>
              <div className="absolute" onClick={(e) => { if (st.total && !(e.target as HTMLElement).closest("[data-clip]")) st.setPlayhead(toTime(e.clientX)); }}
                onDragOver={i === 0 ? (e) => { if (edit) e.preventDefault(); } : undefined} onDrop={i === 0 ? drop : undefined}
                data-lane-height={h} style={{ left: u(O), top: u(y - h / 2 - 101), width: u(W), height: u(h), boxSizing: "border-box", background: "#07162c", border: `${u(1.5)} solid #12335f`,
                  borderRadius: u(6), overflow: "hidden", opacity: (i === 0 && hidden) || (solo !== null && solo !== i) ? 0.3 : 1 }}>
                {i > 0 && lanes[i]!.map((m) => {
                  const left = (m.from - start) * scale, w = Math.max(2, (m.to - m.from) * scale);
                  if (left + w < 0 || left > W) return null;
                  return (
                    <span key={m.key} data-lane-item={m.key} title={`${m.text} · ${tc(m.from)} – ${tc(m.to)}`}
                      style={{ position: "absolute", left: u(left), width: u(w), top: m.row === 1 ? "50%" : u(3), bottom: m.row === 0 ? "50%" : u(3), padding: `0 ${u(6)}`,
                        borderRadius: u(4), background: m.color, border: `${u(1)} solid rgba(255,255,255,.25)`, color: "#fff", fontSize: u(m.row === undefined ? 15 : 12),
                        lineHeight: m.row === undefined ? u(h - 8) : u((h - 8) / 2), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxSizing: "border-box" }}>{m.text}</span>
                  );
                })}
                {i === 6 && beatsUsable(beatGrid) && reelBeats(beatGrid, st.total).map((bt, bi) => {
                  const left = (bt - start) * scale;
                  if (left < 0 || left > W) return null;
                  return <span key={bi} data-beat-tick={bt} aria-hidden style={{ position: "absolute", left: u(left), width: u(2), top: 0, bottom: 0, background: "rgba(255,255,255,0.35)", pointerEvents: "none", zIndex: 1 }} />;
                })}
                {i === 1 && st.items.slice(1).map((p) => {
                  const left = (p.start - start) * scale;
                  if (left < -40 || left > W + 40) return null;
                  const t = st.reel?.transitions.find((x) => x.clip_id === p.clip.id);
                  const w = t ? Math.max(70, (t.duration_ms * 1000) * scale) : 34;
                  return (
                    <button key={p.clip.id} type="button" data-transition={p.clip.id} data-kind={t?.kind ?? "NONE"} aria-pressed={menuCut === p.clip.id}
                      aria-label={t ? dict.body.studio.transitionChangeAria.replace("{a}", kindName(t.kind)).replace("{b}", String(p.index + 1)).replace("{c}", (t.duration_ms / 1000).toFixed(1)) : dict.body.studio.addTransitionIntoClip.replace("{a}", String(p.index + 1))}
                      title={t ? dict.body.studio.transitionDrawnOver.replace("{a}", kindName(t.kind)).replace("{b}", (t.duration_ms / 1000).toFixed(1)).replace("{c}", String(p.index + 1)) : dict.body.studio.cutIntoClip.replace("{a}", String(p.index + 1))}
                      onClick={(e) => { e.stopPropagation(); setMenuCut((c) => (c === p.clip.id ? null : p.clip.id)); }}
                      style={{ position: "absolute", left: u(t ? left : left - w / 2), width: u(w), top: u(4), bottom: u(4), padding: `0 ${u(6)}`, borderRadius: u(5), cursor: "pointer",
                        background: t ? "#7a3a9a" : "#0d2a50", border: `${u(1.5)} solid ${t ? "#d9a6ff" : "#2d6cc0"}`, color: "#fff", fontSize: u(14), lineHeight: 1,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "inherit" }}>
                      {t ? `${kindName(t.kind)} ${(t.duration_ms / 1000).toFixed(1)}s` : "+"}
                    </button>
                  );
                })}
                {i === 0 && st.total > 0 && marks.map((m) => {
                  const left = (m.t - start) * scale;
                  return left < 0 || left > W ? null : <span key={m.key} aria-hidden style={{ position: "absolute", left: u(left), width: u(3), top: 0, bottom: 0, background: "#f5d02e", zIndex: 2, pointerEvents: "none" }} />;
                })}
                {i === 0 && st.items.map((p) => {
                  const td = trimDrag?.id === p.clip.id ? trimDrag : null, sd = slipDrag?.id === p.clip.id ? slipDrag : null;
                  const left = (p.start - start) * scale, sel = p.clip.id === r?.selectedClip;
                  const ghost = td ? clipOutputUs({ ...p.clip, ...(td.edge === "in" ? { in_pts_us: p.clip.in_pts_us + td.d } : { out_pts_us: p.clip.out_pts_us + td.d }) }) : p.dur;
                  const w = Math.max(2, ghost * scale);
                  if (left + w < 0 || left > W) return null;
                  return (
                    <button key={p.clip.id} type="button" data-clip={p.clip.id} draggable={edit && !trimDrag} aria-pressed={sel}
                      data-rendered={rendered?.clip(p.clip.id) ?? "CHANGED"}
                      title={rendered?.clip(p.clip.id) === "RENDERED" ? dict.body.studio.lastRenderedUnchanged : dict.body.studio.notYetRenderedApprox}
                      aria-label={`${dict.body.studio.clipIndex.replace("{a}", String(p.index + 1))}: ${p.clip.label ?? dict.body.studio.clipWord}, ${(p.dur / 1e6).toFixed(1)} s, ${rendered?.clip(p.clip.id) === "RENDERED" ? dict.body.studio.renderedWord : dict.body.studio.notRenderedAsIs}`}
                      onPointerDown={slipDown(p)}
                      onDragStart={(e) => { if (trimming.current || e.altKey) { e.preventDefault(); return; } e.dataTransfer.setData("text/x-otsi-clip", p.clip.id); setDragging(p.clip.id); }} onDragEnd={() => setDragging(null)}
                      onClick={() => { if (trimming.current) return; r?.setSelectedClip(p.clip.id); st.setPreview(null); st.setPlayhead(p.start); }}
                      style={{ position: "absolute", left: u(left), width: u(w), top: u(3), bottom: u(3), padding: `0 ${u(8)}`, borderRadius: u(4), cursor: edit ? "grab" : "pointer",
                        background: sel ? "#1e90ff" : p.clip.origin === "SUGGESTED" ? "#1a4a8a" : "#245a3a", border: `${u(1.5)} solid ${sel ? "#cfe8ff" : "#2d6cc0"}`,
                        color: "#fff", fontSize: u(15), textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: dragging === p.clip.id ? 0.5 : 1 }}>
                      <i aria-hidden style={{ position: "absolute", left: 0, right: 0, top: 0, height: u(3),
                        background: rendered?.clip(p.clip.id) === "RENDERED" ? "#3ecf7a" : "#ffb86b" }} />
                      {sd ? `${dict.body.studio.slipLabel} ${sd.d >= 0 ? "+" : "−"}${(Math.abs(sd.d) / 1e6).toFixed(2)} s · ${tc(p.clip.in_pts_us + sd.d)} – ${tc(p.clip.out_pts_us + sd.d)}`
                        : td ? `${td.edge === "in" ? dict.body.studio.trimEdgeIn : dict.body.studio.trimEdgeOut} ${td.d >= 0 ? "+" : "−"}${(Math.abs(td.d) / 1e6).toFixed(1)} s · ${(ghost / 1e6).toFixed(1)}s`
                        : <>{p.clip.effect.kind !== "NONE" && <b data-clip-effect={p.clip.effect.kind} title={effectActive(p.clip) ? effectName(p.clip.effect, dict) : dict.body.studio.effectMomentOutside.replace("{a}", effectName(p.clip.effect, dict))}
                            style={{ marginRight: u(6), padding: `0 ${u(4)}`, borderRadius: u(3), background: effectActive(p.clip) ? "#f5b82e" : "#556", color: "#06122a", fontSize: u(12) }}>
                            {p.clip.effect.kind === "SLOW" ? `${p.clip.effect.speed}x` : p.clip.effect.kind === "FREEZE" ? "FRZ" : "RAMP"}</b>}
                          {p.clip.label ?? dict.body.studio.clipIndex.replace("{a}", String(p.index + 1))} · {(p.dur / 1e6).toFixed(1)}s
                          {h > 60 && <span data-clip-source="" style={{ display: "block", fontSize: u(13), color: "#cfe0f5", marginTop: u(4) }}>{`${tc(p.clip.in_pts_us)} – ${tc(p.clip.out_pts_us)} · ${dict.body.studio.altDragToSlip}`}</span>}</>}
                      {(["in", "out"] as const).map((edge) => (
                        <span key={edge} data-trim-edge={edge} aria-hidden onPointerDown={edgeDown(p, edge)}
                          title={edge === "in" ? dict.body.studio.dragTrimStart : dict.body.studio.dragTrimEnd}
                          style={{ position: "absolute", top: 0, bottom: 0, [edge === "in" ? "left" : "right"]: 0, width: u(10), cursor: edit ? "ew-resize" : "not-allowed",
                            background: td?.edge === edge ? "rgba(245,184,46,.9)" : "rgba(255,255,255,.18)", zIndex: 1 }} />
                      ))}
                    </button>
                  );
                })}
              </div>
              {i === 1 && menuCut && (() => {
                const p = st.items.find((x) => x.clip.id === menuCut);
                if (!p || p.index === 0) return null;
                const t = st.reel?.transitions.find((x) => x.clip_id === menuCut);
                const x = Math.min(Math.max(O, O + (p.start - start) * scale - 60), O + W - 520);
                const max = Math.min(...[1000], Math.floor(p.dur / 2000));
                const pick = (k: TransitionKind | null, ms: number) => {
                  if (!canSet) return ui.say(r?.canEdit ? dict.body.studio.savingPrevChange : dict.body.studio.roleViewReel);
                  st.setTransition(menuCut, k, ms); setMenuCut(null);
                };
                const chip = (on: boolean) => ({ padding: `${u(5)} ${u(12)}`, borderRadius: u(6), border: `${u(1.5)} solid ${on ? "#d9a6ff" : "#1d4f8a"}`,
                  background: on ? "#5a2a7a" : "#0a2447", color: "#fff", fontSize: u(16), cursor: canSet ? "pointer" : "not-allowed", fontFamily: "inherit", opacity: canSet ? 1 : 0.5 });
                const len = t?.duration_ms ?? TRANSITION_DEFAULT_MS;
                return (
                  <div role="dialog" aria-label={dict.body.studio.transitionIntoClip.replace("{a}", String(p.index + 1))} data-transition-menu={menuCut} className="absolute"
                    style={{ left: u(x), top: u(geo[1]!.y + geo[1]!.h / 2 + 4 - 101), width: u(520), zIndex: 6, padding: u(12), boxSizing: "border-box", borderRadius: u(10),
                      background: "#06122a", border: `${u(1.5)} solid #2d6cc0`, boxShadow: "0 8px 24px rgba(0,0,0,.5)", display: "flex", flexDirection: "column", gap: u(10) }}>
                    <span style={{ fontSize: u(16), color: "#cfe0f5" }}>{dict.body.studio.intoClipDrawn.replace("{a}", String(p.index + 1))}</span>
                    <span style={{ display: "flex", gap: u(8), flexWrap: "wrap" }}>
                      <button type="button" data-pick="NONE" aria-pressed={!t} onClick={() => pick(null, len)} style={chip(!t)}>{dict.body.studio.noneCut}</button>
                      {KINDS.map(([k, name]) => (
                        <button key={k} type="button" data-pick={k} aria-pressed={t?.kind === k} disabled={max < 200} onClick={() => pick(k, Math.min(len, max))} style={chip(t?.kind === k)}>{name}</button>
                      ))}
                    </span>
                    {t && (
                      <span style={{ display: "flex", gap: u(8), alignItems: "center", fontSize: u(16), color: "#cfe0f5" }}>{dict.body.studio.lengthLabel}
                        {LENGTHS.filter((ms) => ms <= max).map((ms) => (
                          <button key={ms} type="button" data-length={ms} aria-pressed={t.duration_ms === ms} onClick={() => pick(t.kind, ms)} style={chip(t.duration_ms === ms)}>{(ms / 1000).toFixed(1)} s</button>
                        ))}
                      </span>
                    )}
                    {max < 200 && <span style={{ fontSize: u(15), color: "#ffb86b" }}>{dict.body.studio.clipTooShortTransition}</span>}
                    <button type="button" onClick={() => setMenuCut(null)} style={{ ...chip(false), alignSelf: "flex-end" }}>{dict.common.close}</button>
                  </div>
                );
              })()}
              {i === 0 && st.items.length === 0 && <T x={1407} y={y} size={19} color="#8ea3bf" align="center">{st.reel ? dict.body.studio.dragClipsStart : dict.body.studio.chooseReelStart}</T>}
              {i === 0 && (
                <Btn x={2477} y={1005} w={49} h={44} label={dict.body.studio.fitReelTimeline} style={IN} onClick={() => setZoom(1)}>
                  <Ic o={[2477, 1005]} x={2501} y={1027} k="fit" size={24} color="#cfe0f5" />
                </Btn>
              )}
            </div>
          ); })}
        </section>
      ))}
      {dual && <DualTimeline st={st} ui={ui} onClose={() => setDual(false)} />}
    </>
  );
}
