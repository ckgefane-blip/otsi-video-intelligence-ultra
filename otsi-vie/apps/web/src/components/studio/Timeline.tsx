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
import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { NOT_BUILT, tc, type Ui } from "./kit";
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

const RULER = [357, 568, 809, 1055, 1296, 1533, 1780, 2022, 2265];
const LENGTHS = [400, 600, 1000];
const mmss = (t: number) => { const s = Math.round(t / 1e6); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
/** the lane label column width (176px) plus the 8px gap to the lanes */
const LABEL_OFF = 184;

export function Timeline({ r, st, ui }: { r: ReelState | null; st: Studio; ui: Ui }) {
  const { t: dict } = useLocale();
  const [zoom, setZoom] = useState(1);
  const LANES: [string, string][] = [[dict.body.studio.videoClipsLabel, "p07-s07"], [dict.body.studio.transitionsSection, "p07-s08"], [dict.body.studio.graphicsOverlays, "p07-s09"],
    [dict.body.studio.lowerThirds, "p07-s10"], [dict.body.studio.captionsLabel, "p07-s10"], [dict.body.studio.statisticsLabel, "p07-s10"], [dict.body.studio.soundtrackLabel, "p07-s11"], [dict.body.studio.audioFxLabel, "p07-s11"]];
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
  const headPct = span > 0 ? Math.max(0, Math.min(1, (st.playhead - start) / span)) : 0;
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

  const TOOLS: [string, string, (() => void) | null, string][] = [
    ["split", dict.body.studio.splitTool, edit && under ? () => { if (!st.split()) explain("split", ""); } : null, dict.body.studio.splitClipHint],
    ["cut", dict.body.studio.cutTool, edit && under ? cut : null, dict.body.studio.endClipHint],
    ["trash", dict.body.studio.rippleDelete, edit && (selected || under) ? ripple : null, dict.body.studio.rippleDeleteHint],
    ["marker", dict.body.studio.addMarkerTool, edit && under ? addMarker : null, dict.body.studio.addMarkerHint],
    ["gfx", dict.body.studio.addGraphic, st.reel ? () => { st.setBinTab(1); ui.say(dict.body.studio.graphicsHint); } : null, dict.body.studio.openGraphicsHint],
    // owner 2026-11-06 ("Why is the AI feature not working?"): the button says its state; dimmed alone looked broken
    ["ai", missing.length ? dict.body.studio.suggestionsCount.replace("{a}", String(missing.length)) : r?.moments?.length ? dict.body.studio.suggestionsCheck : dict.body.studio.suggestionsLabel, edit && missing.length ? highlights : null,
      missing.length ? dict.body.studio.addMomentsSuggested.replace("{a}", String(missing.length)) : r?.moments?.length ? dict.body.studio.allMomentsInReelCount.replace("{a}", String(r.moments.length)) : dict.body.studio.noMomentsSuggested],
    ["speed", dict.body.studio.speedSection, st.reel ? () => { st.setInspTab(2); ui.say(under || selected ? dict.body.studio.speedHint : dict.body.studio.selectClipSpeed); } : null,
      dict.body.studio.speedToolHint],
    ["col", dict.body.studio.colorLabel, st.reel ? () => { st.openAdjust("look"); ui.say(dict.body.studio.lookHint); } : null,
      dict.body.studio.colourToolHint],
    ["mus", dict.body.studio.audioLabel, st.reel ? () => { st.setBinTab(2); ui.say(dict.body.studio.audioChooseMusic); } : null, dict.body.studio.chooseMusicMediaBin],
    ["trf", dict.body.studio.transformLabel, st.reel ? () => { st.openAdjust("zoom"); st.openAdjust("draw"); ui.say(under || selected ? dict.body.studio.zoomDrawHint : dict.body.studio.selectClipZoomDraw); } : null,
      dict.body.studio.transformToolHint],
    ["fit", dict.body.studio.fitToScreen, () => setZoom(1), dict.body.studio.showWholeReel],
  ];
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
  const headLeft = `calc(${LABEL_OFF}px + (100% - ${LABEL_OFF}px) * ${headPct})`;

  return (
    <section aria-label={dict.body.studio.editingRibbon} data-section="p07-s05" className="vie-panel shrink-0 space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOLS.map(([k, l, fn, why]) => (
          <button key={l} type="button" aria-label={l} title={why} aria-disabled={!fn || undefined} data-tool={k} data-pro={k === "col" || k === "trf" ? "" : undefined} onClick={fn ?? (() => explain(k, why))}
            className={`vie-btn vie-btn-sm ${fn ? "" : "opacity-55"} ${k === "ai" ? "border-primary text-primary" : ""}`}>{l}</button>
        ))}
        <span aria-hidden className="mx-1 h-8 w-px bg-line" />
        <button type="button" aria-label={dict.body.studio.zoomOut} onClick={zoom > 1 ? () => setZoom((z) => Math.max(1, z / 1.5)) : () => ui.say(dict.body.studio.alreadyWholeReel)}
          className="vie-btn vie-btn-sm px-2">−</button>
        <input type="range" min={1} max={8} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label={dict.body.studio.timelineZoom}
          className="vie-range w-44" />
        <button type="button" aria-label={dict.body.studio.zoomIn} onClick={zoom < 8 ? () => setZoom((z) => Math.min(8, z * 1.5)) : () => ui.say(dict.body.studio.maxZoom)}
          className="vie-btn vie-btn-sm px-2">+</button>
      </div>

      <div className="flex items-start gap-2">
        <div className="w-44 shrink-0">
          <p className="t-metric">{tc(st.playhead)}</p>
          <p className="t-small">{tc(st.total)}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {([["snap", snap ? dict.body.studio.snapOn : dict.body.studio.snapOff, snap ? (beatsUsable(beatGrid) ? dict.body.studio.snapTitleOnBeats : dict.body.studio.snapTitleOnPlain) : dict.body.studio.snapTitleOff, () => setSnap(!snap), snap],
               ["tall", laneMode === "tall" ? dict.body.studio.tallOn : dict.body.studio.tallOff, laneMode === "tall" ? dict.body.studio.backToNormalLanes : dict.body.studio.tallLaneHint, () => setLaneMode(laneMode === "tall" ? "normal" : "tall"), laneMode === "tall"],
               ["dual", dual ? dict.body.studio.dualOn : dict.body.studio.dualOff, dual ? dict.body.studio.exitDual : dict.body.studio.compareTwoCuts, () => setDual(!dual), dual]] as const).map(([k, l, t, go, on]) => (
              <button key={k} type="button" data-timeline-toggle={k} aria-pressed={on} title={t} aria-label={t} onClick={go}
                className={`vie-btn vie-btn-sm ${on ? "border-primary bg-[#0d3a78] text-white" : ""}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="relative h-5">
            {RULER.map((x, i) => (
              <span key={x} className="t-tc absolute -translate-x-1/2" style={{ left: `${((x - 357) / (2265 - 357)) * 100}%` }}>
                {i === 0 ? mmss(start) : st.total ? mmss(start + ((x - 357) / (2265 - 357)) * span) : "—"}
              </span>
            ))}
          </div>
          {/* overview strip: the whole reel, click to move the playhead */}
          <div role="slider" aria-label={dict.body.studio.reelOverview} aria-valuemin={0} aria-valuemax={Math.round(st.total / 1e6)} aria-valuenow={Math.round(st.playhead / 1e6)} tabIndex={0}
            onClick={(e) => { if (!st.total) { if (!st.reel) ui.pick(); else ui.say(dict.body.studio.reelNoClipsShort); return; } const rc = e.currentTarget.getBoundingClientRect(); st.setPlayhead(((e.clientX - rc.left) / rc.width) * st.total); }}
            className="relative h-10 cursor-pointer rounded bg-[#0a1d38] opacity-75">
            {st.items.map((p) => (
              <span key={p.clip.id} className="absolute bottom-2 top-2 border-r border-[#0a1d38]"
                style={{ left: `${(p.start / st.total) * 100}%`, width: `${(p.dur / st.total) * 100}%`, background: p.clip.id === r?.selectedClip ? "#33a8ff" : "#1e5aa0" }} />
            ))}
            {st.total > 0 && marks.map((m) => <span key={m.key} title={`${tc(m.t)} ${m.body}`} data-marker={m.t}
              className="absolute bottom-0 top-0 w-[3px] bg-[#f5d02e]" style={{ left: `${(m.t / st.total) * 100}%` }} />)}
            {st.total > 0 && st.reel && st.reviews.map((x) => {                // E5: reviewers' comments, where they fall in this edit
              const t = reviewTime(x, st.reel!, st.total, dict).at_us;
              return t === null ? null : <span key={x.id} title={`${tc(t)} ${x.name}: ${x.body}`} data-review-marker={t}
                className="absolute bottom-0 top-0 w-1 bg-[#ff6bd5]" style={{ left: `${(t / st.total) * 100}%` }} />;
            })}
            {st.total > 0 && <span className="absolute bottom-0 top-0 border-[1.5px] border-[#33a8ff]" style={{ left: `${(start / st.total) * 100}%`, width: `${100 / zoom}%` }} />}
          </div>
        </div>
      </div>

      <div className="relative space-y-1">
        {SECTIONS.map(([id, label]) => (
          <section key={id} aria-label={label} data-section={id} className="space-y-1">
            {LANES.map(([name, sec], i) => { const { h } = geo[i]!; return sec !== id ? null : (
              <div key={name} role="group" aria-label={dict.body.studio.laneAria.replace("{a}", name)} className="relative flex items-stretch gap-2">
                <div className="flex w-44 shrink-0 items-center gap-1">
                  {i === 0 ? (
                    <>
                      <button type="button" aria-label={hidden ? dict.body.studio.showLane : dict.body.studio.dimLane} aria-pressed={hidden} onClick={() => setHidden((x) => !x)}
                        className="vie-btn vie-btn-sm shrink-0 px-2">{hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                      <button type="button" aria-label={locked ? dict.body.studio.unlockLane : dict.body.studio.lockLane} aria-pressed={locked} onClick={() => setLocked((x) => !x)}
                        className="vie-btn vie-btn-sm shrink-0 px-2">{locked ? <Lock className="h-4 w-4 text-[#f5b82e]" /> : <Unlock className="h-4 w-4" />}</button>
                    </>
                  ) : (() => {
                    const eye = laneEye(i);
                    return eye ? (
                      <button type="button" aria-label={eye[1]} aria-pressed={eye[0]} onClick={eye[2]}
                        className="vie-btn vie-btn-sm shrink-0 px-2">{eye[0] ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted" />}</button>
                    ) : <span title={i === 1 ? `${name}: click + on a cut to add a transition; the render draws it` : name} className="shrink-0 px-1"><Eye className="h-4 w-4 text-muted" /></span>;
                  })()}
                  <button type="button" data-lane-solo={i} aria-pressed={solo === i} onClick={() => setSolo(solo === i ? null : i)}
                    title={solo === i ? dict.body.studio.showEveryLane : `Solo: show the ${name} lane alone (the others dimmed)`}
                    className={`t-body min-w-0 flex-1 truncate rounded px-1 py-1 text-left ${solo === i ? "bg-[#f5d02e] font-semibold text-[#06122a]" : ""}`}>{name}</button>
                  <span className="t-small flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-raised">{i === 0 ? st.items.length : i === 1 ? (st.reel?.transitions.length ?? 0) : lanes[i]!.length}</span>
                </div>
                <div ref={i === 0 ? lane : undefined}
                  className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-line bg-[#07162c]"
                  style={{ height: h, opacity: (i === 0 && hidden) || (solo !== null && solo !== i) ? 0.3 : 1 }}
                  onClick={(e) => { if (st.total && !(e.target as HTMLElement).closest("[data-clip]")) st.setPlayhead(toTime(e.clientX)); }}
                  onDragOver={i === 0 ? (e) => { if (edit) e.preventDefault(); } : undefined} onDrop={i === 0 ? drop : undefined}
                  data-lane-height={h}>
                  {i > 0 && lanes[i]!.map((m) => {
                    const leftPct = ((m.from - start) / span) * 100, wPct = ((m.to - m.from) / span) * 100;
                    if (leftPct + wPct < 0 || leftPct > 100) return null;
                    return (
                      <span key={m.key} data-lane-item={m.key} title={`${m.text} · ${tc(m.from)} – ${tc(m.to)}`}
                        className="absolute truncate rounded border border-white/25 px-1.5 text-white"
                        style={{ left: `${leftPct}%`, width: `${Math.max(0.5, wPct)}%`, top: m.row === 1 ? "50%" : 3, bottom: m.row === 0 ? "50%" : 3,
                          background: m.color, fontSize: m.row === undefined ? 13 : 12, lineHeight: m.row === undefined ? `${h - 8}px` : `${(h - 8) / 2}px` }}>{m.text}</span>
                    );
                  })}
                  {i === 6 && beatsUsable(beatGrid) && reelBeats(beatGrid, st.total).map((bt, bi) => {
                    const leftPct = ((bt - start) / span) * 100;
                    if (leftPct < 0 || leftPct > 100) return null;
                    return <span key={bi} data-beat-tick={bt} aria-hidden className="pointer-events-none absolute bottom-0 top-0 z-[1] w-0.5 bg-white/35" style={{ left: `${leftPct}%` }} />;
                  })}
                  {i === 1 && st.items.slice(1).map((p) => {
                    const leftPct = ((p.start - start) / span) * 100;
                    if (leftPct < -2 || leftPct > 102) return null;
                    const t = st.reel?.transitions.find((x) => x.clip_id === p.clip.id);
                    const wPct = t ? ((t.duration_ms * 1000) / span) * 100 : 0;
                    return (
                      <button key={p.clip.id} type="button" data-transition={p.clip.id} data-kind={t?.kind ?? "NONE"} aria-pressed={menuCut === p.clip.id}
                        aria-label={t ? dict.body.studio.transitionChangeAria.replace("{a}", kindName(t.kind)).replace("{b}", String(p.index + 1)).replace("{c}", (t.duration_ms / 1000).toFixed(1)) : dict.body.studio.addTransitionIntoClip.replace("{a}", String(p.index + 1))}
                        title={t ? dict.body.studio.transitionDrawnOver.replace("{a}", kindName(t.kind)).replace("{b}", (t.duration_ms / 1000).toFixed(1)).replace("{c}", String(p.index + 1)) : dict.body.studio.cutIntoClip.replace("{a}", String(p.index + 1))}
                        onClick={(e) => { e.stopPropagation(); setMenuCut((c) => (c === p.clip.id ? null : p.clip.id)); }}
                        className="absolute bottom-1 top-1 truncate rounded px-1.5 text-white"
                        style={t
                          ? { left: `${leftPct}%`, width: `${wPct}%`, minWidth: 70, background: "#7a3a9a", border: "1.5px solid #d9a6ff", fontSize: 13, lineHeight: 1 }
                          : { left: `calc(${leftPct}% - 17px)`, width: 34, background: "#0d2a50", border: "1.5px solid #2d6cc0", fontSize: 13, lineHeight: 1 }}>
                        {t ? `${kindName(t.kind)} ${(t.duration_ms / 1000).toFixed(1)}s` : "+"}
                      </button>
                    );
                  })}
                  {i === 0 && st.total > 0 && marks.map((m) => {
                    const leftPct = ((m.t - start) / span) * 100;
                    return leftPct < 0 || leftPct > 100 ? null : <span key={m.key} aria-hidden className="pointer-events-none absolute bottom-0 top-0 z-[2] w-[3px] bg-[#f5d02e]" style={{ left: `${leftPct}%` }} />;
                  })}
                  {i === 0 && st.items.map((p) => {
                    const td = trimDrag?.id === p.clip.id ? trimDrag : null, sd = slipDrag?.id === p.clip.id ? slipDrag : null;
                    const leftPct = ((p.start - start) / span) * 100, sel = p.clip.id === r?.selectedClip;
                    const ghost = td ? clipOutputUs({ ...p.clip, ...(td.edge === "in" ? { in_pts_us: p.clip.in_pts_us + td.d } : { out_pts_us: p.clip.out_pts_us + td.d }) }) : p.dur;
                    const wPct = (ghost / span) * 100;
                    if (leftPct + wPct < 0 || leftPct > 100) return null;
                    return (
                      <button key={p.clip.id} type="button" data-clip={p.clip.id} draggable={edit && !trimDrag} aria-pressed={sel}
                        data-rendered={rendered?.clip(p.clip.id) ?? "CHANGED"}
                        title={rendered?.clip(p.clip.id) === "RENDERED" ? dict.body.studio.lastRenderedUnchanged : dict.body.studio.notYetRenderedApprox}
                        aria-label={`${dict.body.studio.clipIndex.replace("{a}", String(p.index + 1))}: ${p.clip.label ?? dict.body.studio.clipWord}, ${(p.dur / 1e6).toFixed(1)} s, ${rendered?.clip(p.clip.id) === "RENDERED" ? dict.body.studio.renderedWord : dict.body.studio.notRenderedAsIs}`}
                        onPointerDown={slipDown(p)}
                        onDragStart={(e) => { if (trimming.current || e.altKey) { e.preventDefault(); return; } e.dataTransfer.setData("text/x-otsi-clip", p.clip.id); setDragging(p.clip.id); }} onDragEnd={() => setDragging(null)}
                        onClick={() => { if (trimming.current) return; r?.setSelectedClip(p.clip.id); st.setPreview(null); st.setPlayhead(p.start); }}
                        className="absolute bottom-[3px] top-[3px] truncate rounded px-2 text-left text-white"
                        style={{ left: `${leftPct}%`, width: `${Math.max(0.5, wPct)}%`, minWidth: 2, cursor: edit ? "grab" : "pointer", fontSize: 13,
                          background: sel ? "#1e90ff" : p.clip.origin === "SUGGESTED" ? "#1a4a8a" : "#245a3a", border: `1.5px solid ${sel ? "#cfe8ff" : "#2d6cc0"}`,
                          opacity: dragging === p.clip.id ? 0.5 : 1 }}>
                        <i aria-hidden className="absolute left-0 right-0 top-0 h-[3px]" style={{ background: rendered?.clip(p.clip.id) === "RENDERED" ? "#3ecf7a" : "#ffb86b" }} />
                        {sd ? `${dict.body.studio.slipLabel} ${sd.d >= 0 ? "+" : "−"}${(Math.abs(sd.d) / 1e6).toFixed(2)} s · ${tc(p.clip.in_pts_us + sd.d)} – ${tc(p.clip.out_pts_us + sd.d)}`
                          : td ? `${td.edge === "in" ? dict.body.studio.trimEdgeIn : dict.body.studio.trimEdgeOut} ${td.d >= 0 ? "+" : "−"}${(Math.abs(td.d) / 1e6).toFixed(1)} s · ${(ghost / 1e6).toFixed(1)}s`
                          : <>{p.clip.effect.kind !== "NONE" && <b data-clip-effect={p.clip.effect.kind} title={effectActive(p.clip) ? effectName(p.clip.effect, dict) : dict.body.studio.effectMomentOutside.replace("{a}", effectName(p.clip.effect, dict))}
                              className="mr-1.5 rounded px-1 text-xs text-[#06122a]"
                              style={{ background: effectActive(p.clip) ? "#f5b82e" : "#556" }}>
                              {p.clip.effect.kind === "SLOW" ? `${p.clip.effect.speed}x` : p.clip.effect.kind === "FREEZE" ? "FRZ" : "RAMP"}</b>}
                            {p.clip.label ?? dict.body.studio.clipIndex.replace("{a}", String(p.index + 1))} · {(p.dur / 1e6).toFixed(1)}s
                            {h > 60 && <span data-clip-source="" className="mt-1 block text-xs text-[#cfe0f5]">{`${tc(p.clip.in_pts_us)} – ${tc(p.clip.out_pts_us)} · ${dict.body.studio.altDragToSlip}`}</span>}</>}
                        {(["in", "out"] as const).map((edge) => (
                          <span key={edge} data-trim-edge={edge} aria-hidden onPointerDown={edgeDown(p, edge)}
                            title={edge === "in" ? dict.body.studio.dragTrimStart : dict.body.studio.dragTrimEnd}
                            className="absolute bottom-0 top-0 z-[1] w-2.5"
                            style={{ [edge === "in" ? "left" : "right"]: 0, cursor: edit ? "ew-resize" : "not-allowed",
                              background: td?.edge === edge ? "rgba(245,184,46,.9)" : "rgba(255,255,255,.18)" }} />
                        ))}
                      </button>
                    );
                  })}
                  {i === 0 && st.items.length === 0 && (
                    <span className="t-body absolute inset-0 grid place-items-center text-center text-muted">{st.reel ? dict.body.studio.dragClipsStart : dict.body.studio.chooseReelStart}</span>
                  )}
                </div>
                {i === 1 && menuCut && (() => {
                  const p = st.items.find((x) => x.clip.id === menuCut);
                  if (!p || p.index === 0) return null;
                  const t = st.reel?.transitions.find((x) => x.clip_id === menuCut);
                  const menuPct = Math.min(0.6, Math.max(0, ((p.start - start) / span) - 0.03));
                  const max = Math.min(...[1000], Math.floor(p.dur / 2000));
                  const pick = (k: TransitionKind | null, ms: number) => {
                    if (!canSet) return ui.say(r?.canEdit ? dict.body.studio.savingPrevChange : dict.body.studio.roleViewReel);
                    st.setTransition(menuCut, k, ms); setMenuCut(null);
                  };
                  const chipCls = (on: boolean) => `t-button rounded-md border px-3 py-1.5 ${on ? "border-[#d9a6ff] bg-[#5a2a7a] text-white" : "border-line2 bg-raised"} ${canSet ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`;
                  const len = t?.duration_ms ?? TRANSITION_DEFAULT_MS;
                  return (
                    <div role="dialog" aria-label={dict.body.studio.transitionIntoClip.replace("{a}", String(p.index + 1))} data-transition-menu={menuCut}
                      className="absolute left-0 top-full z-10 mt-1 flex w-[520px] max-w-full flex-col gap-2.5 rounded-lg border border-[#2d6cc0] bg-[#06122a] p-3 shadow-2xl"
                      style={{ left: `calc(${LABEL_OFF}px + (100% - ${LABEL_OFF}px) * ${menuPct})` }}>
                      <span className="t-body">{dict.body.studio.intoClipDrawn.replace("{a}", String(p.index + 1))}</span>
                      <span className="flex flex-wrap gap-2">
                        <button type="button" data-pick="NONE" aria-pressed={!t} onClick={() => pick(null, len)} className={chipCls(!t)}>{dict.body.studio.noneCut}</button>
                        {KINDS.map(([k, name]) => (
                          <button key={k} type="button" data-pick={k} aria-pressed={t?.kind === k} disabled={max < 200} onClick={() => pick(k, Math.min(len, max))} className={chipCls(t?.kind === k)}>{name}</button>
                        ))}
                      </span>
                      {t && (
                        <span className="t-body flex flex-wrap items-center gap-2">{dict.body.studio.lengthLabel}
                          {LENGTHS.filter((ms) => ms <= max).map((ms) => (
                            <button key={ms} type="button" data-length={ms} aria-pressed={t.duration_ms === ms} onClick={() => pick(t.kind, ms)} className={chipCls(t.duration_ms === ms)}>{(ms / 1000).toFixed(1)} s</button>
                          ))}
                        </span>
                      )}
                      {max < 200 && <span className="t-body" style={{ color: "#ffb86b" }}>{dict.body.studio.clipTooShortTransition}</span>}
                      <button type="button" onClick={() => setMenuCut(null)} className={`${chipCls(false)} self-end`}>{dict.common.close}</button>
                    </div>
                  );
                })()}
              </div>
            ); })}
          </section>
        ))}
        {/* playhead: the line over the lanes, the handle above them to drag it */}
        <div aria-hidden className="pointer-events-none absolute bottom-0 top-0 z-[3] w-0.5 bg-[#33a8ff] shadow-[0_0_8px_#33a8ff]" style={{ left: headLeft }} />
        <div role="slider" aria-label={dict.body.studio.playheadLabel} aria-valuemin={0} aria-valuemax={Math.round(st.total / 1e6)} aria-valuenow={Math.round(st.playhead / 1e6)} tabIndex={0}
          onPointerDown={dragHead} onKeyDown={(e) => { if (e.key === "ArrowRight") st.setPlayhead(Math.min(st.total, st.playhead + 1e6)); if (e.key === "ArrowLeft") st.setPlayhead(Math.max(0, st.playhead - 1e6)); }}
          className="absolute z-[4] flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-md bg-primary text-xs text-white"
          style={{ left: headLeft, top: 0 }}>▾</div>
      </div>
      {dual && <DualTimeline st={st} ui={ui} onClose={() => setDual(false)} />}
    </section>
  );
}
