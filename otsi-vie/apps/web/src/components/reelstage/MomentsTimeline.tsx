"use client";
/**
 * Page 06 Sections 06-07 — Suggested Key Moments and the four-layer reel timeline (approved reference 06_REEL_BUILDER, centre).
 *
 * Moments are the engine's events the reel's confirmed player took part in (shots, key passes, balls won, pressures, passes; ADR-043),
 * ranked best first, then stretches where he is visible on confirmed tracks and no event was detected.
 * Choosing a moment adds it as a clip; one already in the reel selects its clip. A moment can also be dragged into the timeline at any
 * point, and clips are dragged to reorder (the reference's "Drag to reorder"); a white line shows where it will land. The timeline shows the
 * reel's real clips in order and in proportion; a selected clip can be trimmed, moved or removed. "Add all" adds every moment not yet in the
 * reel (match order, up to 10 minutes); "Remove all clips" empties the reel (click twice to confirm). The spotlight and the name caption apply to every clip, so their lanes
 * span the clips; the reel keeps each clip's match audio (no music is connected). Empty lanes keep the reference's wording.
 * E4 (ADR-067): "Build a draft" opens DraftDialog: a length, a theme and a frame give up to three draft reels; one is used, then Edit in Clip Studio.
 */
import { slotUs, momentBadge, ZOOM_STEPS, zoomOffset, type CrossMatchCandidate, type MomentEvent, type Reel, type ReelClip, type ReelMoment } from "@otsi-vie/contracts";
import Link from "next/link";
import { type DragEvent, memo, useCallback, useEffect, useRef, useState } from "react";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { Hit } from "@/components/workspace/shared";
import { DraftDialog } from "./DraftDialog";
import { WhoQueue } from "./WhoQueue";
import { HistoryDialog } from "@/components/reels/HistoryDialog";
import { useMusic } from "./MusicPicker";
import { mmss, secs, useStage } from "./shared";

const X0 = 690, W = 1340;
const RULER = [715, 900, 1083, 1280, 1478, 1677, 1878];
/** the tag on a moment's picture: its best event, in the Analysis timeline's colours (translated at the render site) */
const detail = (m: ReelMoment, d: Dictionary["body"]["reelstage"]) => m.kind === "EVENT"
  ? d.detailEvents.replace("{a}", mmss(m.in_pts_us)).replace("{b}", m.track_numbers.join(", "))
  : d.detailVisible.replace("{a}", mmss(m.in_pts_us)).replace("{b}", secs(m.visible_us, d.durationSec)).replace("{c}", m.track_numbers.join(", "));

/** what is being dragged: a moment card (by its in point) or a clip already in the reel */
type Drag = { moment: ReelMoment } | { clip: string };
let dragged: Drag | null = null;
/** Starts a drag. The drag handles are transparent buttons over the drawn cards, so the browser's own drag picture would be empty: a small
 * card with what is being dragged follows the pointer instead, and the source fades while it moves (owner 2026-11-02: "Drag & Drop not
 * working"). */
const startDrag = (e: DragEvent, d: Drag, label: string) => {
  dragged = d;
  e.dataTransfer.effectAllowed = "copyMove";
  e.dataTransfer.setData("text/plain", "otsi-reel");
  const ghost = document.createElement("div");
  ghost.textContent = label;
  Object.assign(ghost.style, { position: "fixed", top: "-1000px", left: "-1000px", padding: "8px 12px", maxWidth: "260px", whiteSpace: "nowrap", overflow: "hidden",
    textOverflow: "ellipsis", background: "#0b5cb0", border: "2px solid #fff", borderRadius: "8px", color: "#fff", font: "600 13px Inter, system-ui, sans-serif",
    boxShadow: "0 6px 18px rgba(0,0,0,.5)" });
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 16, 16);
  setTimeout(() => ghost.remove(), 0);
  const src = e.currentTarget as HTMLElement;
  src.style.background = "rgba(4,16,34,.55)";
  src.addEventListener("dragend", () => { src.style.background = "transparent"; }, { once: true });
};

export function Moments() {
  const { t: dict } = useLocale();
  const d = dict.body.reelstage;
  const tags: Record<MomentEvent, [string, string]> = {
    GOAL: [d.tagGoal, "#a066ff"], FREE_KICK_GOAL: [d.tagFreeKickGoal, "#a066ff"], PENALTY_GOAL: [d.tagPenaltyGoal, "#a066ff"],
    SHOT: [d.tagShot, "#19d3ff"], KEY_PASS: [d.tagKeyPass, "#19e6c0"], TACKLE: [d.tagTackle, "#ff4a4a"], INTERCEPTION: [d.tagInterception, "#ff4a4a"], PENALTY: [d.tagPenalty, "#e0e0ff"],
    FREE_KICK: [d.tagFreeKick, "#e0e0ff"], CORNER: [d.tagCorner, "#e0e0ff"], THROW_IN: [d.tagThrowIn, "#e0e0ff"], GOAL_KICK: [d.tagGoalKick, "#e0e0ff"], KICK_OFF: [d.tagKickOff, "#e0e0ff"],
    SET_PIECE: [d.tagSetPiece, "#e0e0ff"], BALL_WON: [d.tagBallWon, "#ff4a4a"], PRESSURE_REGAIN: [d.tagPressure, "#ffb21a"],
    PRESSURE: [d.tagPressure, "#ffb21a"], PASS: [d.tagPass, "#7ae85a"], PASS_RECEIVED: [d.tagPass, "#7ae85a"],
  };
  const { r, focus } = useStage();
  const reel = r?.reel ?? null;
  // ADR-131: a cross-match reel's moments are the best-moments selection (selected + left out with reasons), not the ranked
  // single-match suggestions — the selection comes from the provider's crossMatch, and `moments` stays empty for it
  const isCross = reel?.source === "ALL_MATCHES";
  const cross = r?.crossMatch ?? null;
  const moments = isCross ? [] : (r?.moments ?? []);
  const loading = isCross ? cross === null : r?.moments === null;   // still reading: "no suggestions yet" would be a lie about an empty result
  const crossItems = isCross && cross ? [
    ...cross.selected.map((m) => ({ key: `${m.video_id}:${m.in_pts_us}`, m, tier: m.tier as string, reason: m.reason, notSelected: null as string | null, inReel: m.in_reel })),
    ...cross.not_selected.map(({ candidate: m, reason }) => ({ key: `${m.video_id}:${m.in_pts_us}:out`, m, tier: null as string | null, reason: m.sequence_label ?? m.label, notSelected: reason, inReel: false })),
  ] : [];
  const crossTotal = (cross?.selected.length ?? 0) + (cross?.not_selected.length ?? 0);
  const scroller = useRef<HTMLDivElement | null>(null);
  const canAdd = !!r?.canEdit && !r.busy && !!reel;
  const slots = Math.max(5, isCross ? crossItems.length : moments.length);
  const stride = 319.5;
  const add = (i: number) => {
    const m = moments[i];
    if (!m || !reel || !r) return;
    if (m.in_reel) { const c = reel.clips.find((x) => x.in_pts_us === m.in_pts_us); if (c) r.setSelectedClip(c.id); return; }
    r.run(() => api<Reel>(`/v1/reels/${reel.id}/clips`, { method: "POST", json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, origin: "SUGGESTED", label: m.label } }), dict.body.reels.clipAdded);
  };
  const left = isCross ? (cross?.selected.filter((m) => !m.in_reel).length ?? 0) : moments.filter((m) => !m.in_reel && !m.rejected).length;
  // B.15 (ADR-091): reject / restore a suggestion, swap the selected clip for it, move its clip earlier or later, "Is this him?" here
  const [who, setWho] = useState(false);
  const sel = reel?.clips.find((c) => c.id === r?.selectedClip) ?? null;
  const selIndex = sel && reel ? reel.clips.indexOf(sel) : -1;
  const clipOf = (m: ReelMoment) => reel?.clips.find((c) => c.in_pts_us < m.out_pts_us && c.out_pts_us > m.in_pts_us) ?? null;
  const win = (m: ReelMoment) => ({ in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us });
  const reject = (m: ReelMoment) => reel && r?.run(async () => { await api(`/v1/reels/${reel.id}/moments/reject`, { method: "POST", json: win(m) }); }, d.leftOutMsg);
  const restore = (m: ReelMoment) => reel && r?.run(async () => { await api(`/v1/reels/${reel.id}/moments/restore`, { method: "POST", json: win(m) }); }, d.suggestionRestored);
  const swap = (m: ReelMoment) => reel && sel && r?.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${sel.id}/swap`, { method: "POST", json: { ...win(m), label: m.label } }), d.clipSwapped.replace("{a}", String(selIndex + 1)));
  const move = (m: ReelMoment, dir: -1 | 1) => {
    const c = clipOf(m);
    if (!reel || !c || !r) return;
    const ids = reel.clips.map((x) => x.id), i = ids.indexOf(c.id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    r.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/order`, { method: "POST", json: { clip_ids: ids } }), d.movedTo.replace("{a}", String(j + 1)));
  };
  // ADR-131: the cross-match actions — pin = addClip (the API guards eligibility and the per-match cap, Tier S immune),
  // remove = clip delete, reject / restore per video (a rejection in one match never rejects the same window in another)
  const clipOfCross = (m: CrossMatchCandidate) => reel?.clips.find((c) => c.source_video_id === m.video_id && c.in_pts_us < m.out_pts_us && c.out_pts_us > m.in_pts_us) ?? null;
  const crossWin = (m: CrossMatchCandidate) => ({ in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us });
  const crossMatchOf = (m: CrossMatchCandidate) => [m.home, m.away].filter(Boolean).join(" vs ") || m.video_title;
  const crossWhenOf = (m: CrossMatchCandidate) => (m.match_minute !== null ? `${m.match_minute}'` : mmss(m.key_at_us));
  const crossAdd = (m: CrossMatchCandidate) => reel && r?.run(() => api<Reel>(`/v1/reels/${reel.id}/clips`, { method: "POST",
    json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, origin: "SUGGESTED", label: m.label, source_video_id: m.video_id } }), dict.body.reels.clipAdded);
  const crossReject = (m: CrossMatchCandidate) => reel && r?.run(async () => { await api(`/v1/reels/${reel.id}/moments/reject`, { method: "POST",
    json: { ...crossWin(m), video_id: m.video_id } }); }, d.leftOutMsg);
  const crossRestore = (m: CrossMatchCandidate) => reel && r?.run(async () => { await api(`/v1/reels/${reel.id}/moments/restore`, { method: "POST",
    json: { ...crossWin(m), video_id: m.video_id } }); }, d.suggestionRestored);
  const crossSwap = (m: CrossMatchCandidate) => { const c = sel; if (!reel || !c || !r) return;
    r.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${c.id}/swap`, { method: "POST", json: { ...crossWin(m), label: m.label } }), d.clipSwappedSimple); };
  const crossMove = (m: CrossMatchCandidate, dir: -1 | 1) => { const c = clipOfCross(m); if (!reel || !c || !r) return;
    const ids = reel.clips.map((x) => x.id), i = ids.indexOf(c.id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    r.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/order`, { method: "POST", json: { clip_ids: ids } }), d.movedTo.replace("{a}", String(j + 1))); };
  const mini = (x: number, label: string, glyph: string, act: (() => void) | null, why: string, data: string, w = 40) => (
    <button key={data} type="button" aria-label={label} title={act ? label : why} data-moment-act={data} disabled={!act} onClick={act ?? undefined}
      className="absolute" style={{ left: u(x), top: u(990 - 939), width: u(w), height: u(30), fontSize: u(17), fontWeight: 700, color: "#fff", background: "rgba(0,10,25,.85)",
        border: `${u(1.5)} solid #33a8ff`, borderRadius: u(6), cursor: act ? "pointer" : "default", opacity: act ? 1 : 0.4, padding: 0 }}>{glyph}</button>
  );
  const [draft, setDraft] = useState(false);
  const [hist, setHist] = useState(false);                             // B.1 (ADR-081): Undo, Redo and the reel's History
  const h = r?.history ?? null, canHist = !!r?.canEdit && !r?.busy;
  return (
    <section id="p06-moments" aria-label={isCross ? d.crossAria : d.momentsAria} data-section="p06-s06" data-moments={String(isCross ? crossTotal : moments.length)} >
      <P x={445} y={872} w={1593} h={258} style={focus === "p06-moments" ? { borderColor: "#33a8ff" } : undefined} />
      <Ic x={477} y={905} k="star" size={30} color="#33a8ff" />
      <T x={505} y={905} size={25} weight={600} as="h2">{loading ? (isCross ? d.crossHeadingLoading : d.momentsHeadingLoading) : isCross ? d.crossHeading.replace("{a}", String(crossTotal)) : d.momentsHeading.replace("{a}", String(moments.length))}</T>
      {reel?.player && !isCross && (
        // ADR-046: moments count only events on his named tracks; "Is this him?" on the unnamed players of the events brings more
        <button type="button" onClick={() => setWho(true)} className="absolute" data-who-link title={d.whoLinkTitle}
          style={{ left: u(1450), width: u(350), textAlign: "right", top: u(892 - 101), fontSize: u(19), color: "#33a8ff", background: "transparent", border: 0, cursor: "pointer", padding: 0 }}>{d.whoLink}</button>
      )}
      {reel && r && <WhoQueue r={r} reel={reel} open={who} onOpenChange={setWho} />}
      <button type="button" data-add-all disabled={!canAdd || left === 0} title={left ? (isCross ? d.addAllTitleCross : d.addAllTitleSingle) : d.addAllTitleNone}
        onClick={() => reel && r?.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/add-moments`, { method: "POST" }), d.momentsAdded)}
        className="absolute" style={{ left: u(900), top: u(887 - 101), height: u(36), padding: `0 ${u(14)}`, fontSize: u(18), fontWeight: 600, color: "#fff",
          background: "#0b5cb0", border: `${u(1.5)} solid #33a8ff`, borderRadius: u(6), cursor: canAdd && left ? "pointer" : "default", opacity: canAdd && left ? 1 : 0.45 }}>{d.addAll.replace("{a}", String(left))}</button>
      {!isCross && <button type="button" data-build-draft disabled={!reel} onClick={() => setDraft(true)} title={d.buildDraftTitle}
        className="absolute" style={{ left: u(1075), top: u(887 - 101), height: u(36), padding: `0 ${u(14)}`, fontSize: u(18), fontWeight: 600, color: "#fff",
          background: "#0a2447", border: `${u(1.5)} solid #33a8ff`, borderRadius: u(6), cursor: reel ? "pointer" : "default", opacity: reel ? 1 : 0.45 }}>{d.buildDraft}</button>}
      <DraftDialog r={r} open={draft} onOpenChange={setDraft} />
      {([["↶", "Undo", 1250, 40, !!h?.can_undo, h?.undo_label ? dict.body.reels.historyUndoBtn.replace("{a}", h.undo_label) : dict.body.reels.historyNothingUndo, () => r?.undo()],
         ["↷", "Redo", 1296, 40, !!h?.can_redo, h?.redo_label ? dict.body.reels.historyRedoBtn.replace("{a}", h.redo_label) : dict.body.reels.historyNothingRedo, () => r?.redo()]] as const).map(([g, l, x, w, on, tip, go]) => (
        <button key={l} type="button" aria-label={tip} data-reel-undo={l} disabled={!canHist || !on} onClick={go} title={l === "Undo" ? d.undoTitle.replace("{a}", tip) : d.redoTitle.replace("{a}", tip)}
          className="absolute" style={{ left: u(x), top: u(887 - 101), width: u(w), height: u(36), fontSize: u(22), fontWeight: 700, color: "#fff", background: "#0a2447",
            border: `${u(1.5)} solid #33a8ff`, borderRadius: u(6), cursor: canHist && on ? "pointer" : "default", opacity: canHist && on ? 1 : 0.45 }}>{g}</button>
      ))}
      <button type="button" data-history-open disabled={!reel} onClick={() => setHist(true)} title={d.historyTitleBtn}
        className="absolute" style={{ left: u(1342), top: u(887 - 101), height: u(36), padding: `0 ${u(12)}`, fontSize: u(18), fontWeight: 600, color: "#fff",
          background: "#0a2447", border: `${u(1.5)} solid #33a8ff`, borderRadius: u(6), cursor: reel ? "pointer" : "default", opacity: reel ? 1 : 0.45 }}>{dict.body.reels.history}</button>
      <HistoryDialog r={r} open={hist} onOpenChange={setHist} />
      <Hit x={1830} y={890} w={210} h={40} label={d.viewAll} {...((isCross ? crossItems.length : moments.length) > 5 ? { onClick: () => { const el = scroller.current; if (el) el.scrollTo({ left: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 ? 0 : el.scrollLeft + 5 * stride * (el.clientWidth / (5 * stride)), behavior: "smooth" }); } } : { reason: (isCross ? crossItems.length : moments.length) ? d.viewAllReasonShown : d.viewAllReasonNone })} />
      <T x={1846} y={910} size={19} color="#33a8ff">{d.viewAllText}</T>
      <Ic x={2012} y={910} k="fwd" size={18} color="#33a8ff" />
      <div ref={scroller} role="list" aria-label={isCross ? d.crossAria : d.momentsAria} className="absolute" style={{ left: u(455), top: u(939 - 101), width: u(1575), height: u(190), overflowX: (isCross ? crossItems.length : moments.length) > 5 ? "auto" : "hidden", overflowY: "hidden" }}>
        <div style={{ position: "relative", width: u(slots * stride), height: u(185) }}>
          {isCross ? crossItems.map((it, i) => { const m = it.m, x = i * stride;
            const c = clipOfCross(m), inR = it.inReel || c !== null, tagCol = it.tier ? ({ S: "#a066ff", A: "#19d3ff", B: "#19e6c0", C: "#ffb21a" } as Record<string, string>)[it.tier] ?? "#cfe0f5" : "#8b95a5";
            return (
              <div key={it.key} role="listitem" data-moment={m.in_pts_us} data-cross-tier={it.tier ?? ""} data-not-selected={it.notSelected ?? undefined} style={it.notSelected ? { opacity: 0.75 } : undefined}>
                <B o={[0, 939]} x={x} y={939} w={298} h={185} style={{ background: "#06182f", border: `${u(1.5)} solid ${inR ? "#1e90ff" : "#12335f"}`, borderRadius: u(10), boxSizing: "border-box" }} />
                <B o={[0, 939]} x={x + 4} y={941} w={290} h={116} style={{ borderRadius: u(8), background: "radial-gradient(ellipse at 50% 30%,#2a6fb8,#0b2a52 70%)" }} />
                <B o={[0, 939]} x={x + 14} y={950} w={36} h={34} style={{ background: "#1e90ff", borderRadius: u(6), fontSize: u(20), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</B>
                {inR && <Ic o={[0, 939]} x={x + 270} y={967} k="chk" size={26} color="#3ee6a8" />}
                <B o={[0, 939]} x={x + 58} y={950} w={130} h={30} data-cross-tier-label={it.tier ?? "left-out"}
                  style={{ background: "rgba(0,10,25,.8)", border: `${u(1.5)} solid ${tagCol}`, color: tagCol, borderRadius: u(6), fontSize: u(17), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{it.tier ? dict.body.reels.crossTier.replace("{a}", it.tier) : d.tierLeftOut}</B>
                <B o={[0, 939]} x={x + 14} y={1027} w={200} h={26} data-cross-reason={it.notSelected ?? it.reason} aria-label={it.notSelected ? dict.body.reels.crossLeftOut.replace("{a}", it.notSelected) : it.reason}
                  style={{ background: "rgba(0,10,25,.8)", borderRadius: u(6), fontSize: u(16), display: "flex", alignItems: "center", gap: u(6), padding: `0 ${u(8)}`, whiteSpace: "nowrap", overflow: "hidden" }}>
                  <span style={{ color: "#cfe0f5", overflow: "hidden", textOverflow: "ellipsis" }}>{it.notSelected ?? it.reason}</span></B>
                <B o={[0, 939]} x={x + 222} y={1027} w={62} h={26} style={{ background: "rgba(0,10,25,.8)", borderRadius: u(6), fontSize: u(18), display: "flex", alignItems: "center", justifyContent: "center" }}>{d.durS.replace("{a}", String(Math.round((m.out_pts_us - m.in_pts_us) / 1e6)))}</B>
                <T o={[0, 939]} x={x + 15} y={1078} size={20} weight={600} style={{ maxWidth: u(270), overflow: "hidden", textOverflow: "ellipsis" }}>{m.label}</T>
                <T o={[0, 939]} x={x + 15} y={1105} size={19} color="#b9cbe2" style={{ maxWidth: u(270), overflow: "hidden", textOverflow: "ellipsis" }}>
                  {`${crossMatchOf(m)}${m.competition ? ` · ${m.competition}` : ""} · ${crossWhenOf(m)}`}</T>
                <button type="button" aria-label={inR ? d.momentSelectClip.replace("{a}", String(i + 1)) : d.momentAdd.replace("{a}", String(i + 1))} aria-pressed={inR}
                  disabled={!inR && !canAdd} title={!inR && !canAdd ? d.cannotEdit : d.momentClickAdd} onClick={() => { const cc = clipOfCross(m); if (cc) r?.setSelectedClip(cc.id); else crossAdd(m); }}
                  className="absolute" style={{ left: u(x), top: 0, width: u(298), height: u(185), padding: 0, border: 0, background: "transparent", cursor: canAdd ? "pointer" : "default" }} />
                {canAdd && (it.notSelected === "rejected for this reel" ? mini(x + 200, d.miniRestore, d.miniRestoreGlyph, () => crossRestore(m), "", "restore", 90)
                  : inR ? (() => { const cc = clipOfCross(m), at = cc && reel ? reel.clips.indexOf(cc) : -1, n = reel?.clips.length ?? 0;
                    return [mini(x + 200, d.miniEarlier, "◀", at > 0 ? () => crossMove(m, -1) : null, d.miniAlreadyFirst, "earlier"),
                      mini(x + 244, d.miniLater, "▶", at >= 0 && at < n - 1 ? () => crossMove(m, 1) : null, d.miniAlreadyLast, "later")]; })()
                  : [mini(x + 200, d.miniReject, "✕", () => crossReject(m), "", "reject"),
                    mini(x + 244, sel ? d.miniSwap.replace("{a}", String(selIndex + 1)) : d.miniSwapSelect, "⇄", sel ? () => crossSwap(m) : null, d.miniSwapReason, "swap")])}
              </div>
            ); }) : Array.from({ length: slots }, (_, i) => {
            const m = moments[i], x = i * stride;
            const first = i === 0 && moments.length === 0;
            return (
              <div key={i} role="listitem" data-moment={m?.in_pts_us ?? ""} data-rejected={m?.rejected ? "1" : undefined} style={m?.rejected ? { opacity: 0.45 } : undefined}>
                <B o={[0, 939]} x={x} y={939} w={298} h={185} style={{ background: "#06182f", border: `${u(1.5)} solid ${m?.in_reel ? "#1e90ff" : "#12335f"}`, borderRadius: u(10), boxSizing: "border-box", opacity: m ? 1 : 0.85 }} />
                <B o={[0, 939]} x={x + 4} y={941} w={290} h={116} style={{ borderRadius: u(8), background: m ? "radial-gradient(ellipse at 50% 30%,#2a6fb8,#0b2a52 70%)" : "radial-gradient(ellipse at 50% 30%,#1d4a80,#0b2142 70%)" }} />
                <B o={[0, 939]} x={x + 14} y={950} w={36} h={34} style={{ background: "#1e90ff", borderRadius: u(6), fontSize: u(20), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</B>
                {m?.in_reel && <Ic o={[0, 939]} x={x + 270} y={967} k="chk" size={26} color="#3ee6a8" />}
                {m && (() => {
                  const [word, c] = m.kind === "EVENT" && m.events[0] ? tags[m.events[0]] : [d.tagVisible, "#8ea3bf"];
                  return <B o={[0, 939]} x={x + 58} y={950} w={130} h={30} data-moment-kind={m.kind}
                    style={{ background: "rgba(0,10,25,.8)", border: `${u(1.5)} solid ${c}`, color: c, borderRadius: u(6), fontSize: u(17), fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{word}</B>;
                })()}
                {m && (() => {
                  const b = momentBadge(m), cov = m.coverage === null ? null : Math.round(m.coverage * 100);
                  const badge = b.word === "On camera" ? { word: d.badgeOnCamera, title: d.badgeOnCameraTitle } : b.word === "Possible" ? { word: d.badgePossible, title: d.badgePossibleTitle } : { word: d.badgeDetected, title: d.badgeDetectedTitle };
                  return <B o={[0, 939]} x={x + 14} y={1027} w={200} h={26} data-moment-badge={b.word} data-moment-coverage={cov ?? ""} aria-label={`${badge.title}. ${cov === null ? d.badgeCoverageNotMeasured : d.badgeCoverage.replace("{a}", String(cov))}`}
                    style={{ background: "rgba(0,10,25,.8)", borderRadius: u(6), fontSize: u(16), display: "flex", alignItems: "center", gap: u(6), padding: `0 ${u(8)}`, whiteSpace: "nowrap" }}>
                    <b style={{ color: b.word === "Possible" ? "#f5b82e" : "#3ee6a8" }}>{badge.word}</b><span style={{ color: "#cfe0f5" }}>{cov === null ? d.badgeNotMeasured : d.badgeSeen.replace("{a}", String(cov))}</span></B>;
                })()}
                <B o={[0, 939]} x={x + 222} y={1027} w={62} h={26} style={{ background: "rgba(0,10,25,.8)", borderRadius: u(6), fontSize: u(18), display: "flex", alignItems: "center", justifyContent: "center" }}>{m ? d.durS.replace("{a}", String(Math.round((m.out_pts_us - m.in_pts_us) / 1e6))) : "—"}</B>
                <T o={[0, 939]} x={x + 15} y={1078} size={20} weight={600} style={{ maxWidth: u(270), overflow: "hidden", textOverflow: "ellipsis" }}>{m ? m.label : first ? (loading ? dict.body.reels.momentsLoading : d.firstNoSuggestions) : "—"}</T>
                <T o={[0, 939]} x={x + 15} y={1105} size={19} color="#b9cbe2" style={{ maxWidth: u(270), overflow: "hidden", textOverflow: "ellipsis" }}>
                  {m ? detail(m, d) : first ? (loading ? d.momentsLoadingSub : d.firstRunAi) : "—"}</T>
                {m && (
                  <button type="button" aria-label={m.in_reel ? d.momentSelectClip.replace("{a}", String(i + 1)) : d.momentAdd.replace("{a}", String(i + 1))} aria-pressed={m.in_reel}
                    disabled={!m.in_reel && !canAdd} title={!m.in_reel && !canAdd ? d.cannotEdit : d.momentClickAddDrag} onClick={() => add(i)}
                    draggable={canAdd} onDragStart={(e) => startDrag(e, { moment: m }, `${m.label} · ${d.durS.replace("{a}", String(Math.round((m.out_pts_us - m.in_pts_us) / 1e6)))}`)} onDragEnd={() => { dragged = null; }}
                    className="absolute" style={{ left: u(x), top: 0, width: u(298), height: u(185), padding: 0, border: 0, background: "transparent", cursor: canAdd ? "grab" : "pointer" }} />
                )}
                {m && canAdd && (m.rejected ? mini(x + 200, d.miniRestore, d.miniRestoreGlyph, () => restore(m), "", "restore", 90)
                  : m.in_reel ? (() => {
                    const c = clipOf(m), at = c && reel ? reel.clips.indexOf(c) : -1, n = reel?.clips.length ?? 0;
                    return [mini(x + 200, d.miniEarlier, "◀", at > 0 ? () => move(m, -1) : null, d.miniAlreadyFirst, "earlier"),
                      mini(x + 244, d.miniLater, "▶", at >= 0 && at < n - 1 ? () => move(m, 1) : null, d.miniAlreadyLast, "later")];
                  })()
                  : [mini(x + 200, d.miniReject, "✕", () => reject(m), "", "reject"),
                    mini(x + 244, sel ? d.miniSwap.replace("{a}", String(selIndex + 1)) : d.miniSwapSelect, "⇄", sel ? () => swap(m) : null, d.miniSwapReason, "swap")])}
              </div>
            );
          })}
        </div>
      </div>
      {reel && loading && <T x={1246} y={1030} size={19} color="#8ea3bf" align="center">{isCross ? dict.body.reels.crossLoading : dict.body.reels.momentsLoading}</T>}
      {reel && !loading && !isCross && moments.length === 0 && <T x={1246} y={1030} size={19} color="#8ea3bf" align="center">{d.noVisibleCenter}</T>}
      {reel && !loading && isCross && crossItems.length === 0 && <T x={1246} y={1030} size={19} color="#8ea3bf" align="center">{d.noBestCenter}</T>}
    </section>
  );
}

/** the selected clip's trim bar (memoised: typing in its in/out fields re-renders only this bar, not the whole timeline) */
const ClipEditor = memo(function ClipEditor({ sel, idx, total, edit, setEdit, canEdit, reel, r, move }: {
  sel: ReelClip; idx: number; total: number; edit: { a: string; b: string }; setEdit: (e: { a: string; b: string }) => void;
  canEdit: boolean; reel: Reel | null; r: ReelState | null; move: (d: number) => void;
}) {
  const { t: dict } = useLocale();
  const d = dict.body.reelstage;
  return (
    <div aria-label={d.clipEditorAria} className="absolute" style={{ left: u(1290), top: u(1154 - 101), width: u(560), height: u(42), display: "flex", alignItems: "center", gap: u(8),
      padding: `0 ${u(10)}`, boxSizing: "border-box", background: "#071a33", border: `${u(1.5)} solid #1e90ff`, borderRadius: u(6), fontSize: u(17), zIndex: 3 }}>
      <span style={{ fontWeight: 700 }}>{d.clipEditorTitle.replace("{a}", String(idx + 1))}</span>
      <label>{dict.body.reels.clipInLabel} <input value={edit.a} disabled={!canEdit} aria-label={dict.body.reels.clipInAria.replace("{a}", String(idx + 1))} onChange={(e) => setEdit({ ...edit, a: e.target.value })} style={{ width: u(64), background: "#041022", border: `${u(1)} solid #17406f`, borderRadius: u(4), color: "#fff", fontSize: u(17), padding: `0 ${u(4)}` }} /></label>
      <label>{dict.body.reels.clipOutLabel} <input value={edit.b} disabled={!canEdit} aria-label={dict.body.reels.clipOutAria.replace("{a}", String(idx + 1))} onChange={(e) => setEdit({ ...edit, b: e.target.value })} style={{ width: u(64), background: "#041022", border: `${u(1)} solid #17406f`, borderRadius: u(4), color: "#fff", fontSize: u(17), padding: `0 ${u(4)}` }} /></label>
      <button type="button" disabled={!canEdit} onClick={() => reel && r?.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${sel.id}`, { method: "PATCH", json: { in_pts_us: Math.round(Number(edit.a) * 1e6), out_pts_us: Math.round(Number(edit.b) * 1e6) } }), dict.body.reels.clipTrimmed)}
        style={{ color: "#33a8ff", cursor: "pointer" }}>{dict.body.reels.clipTrim}</button>
      <button type="button" aria-label={d.moveEarlier} disabled={!canEdit || idx === 0} onClick={() => move(-1)} style={{ cursor: "pointer" }}>◀</button>
      <button type="button" aria-label={d.moveLater} disabled={!canEdit || idx === total - 1} onClick={() => move(1)} style={{ cursor: "pointer" }}>▶</button>
      <button type="button" aria-label={dict.body.reels.removeClip} disabled={!canEdit} onClick={() => reel && r?.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${sel.id}`, { method: "DELETE" }), d.clipRemoved)} style={{ color: "#ff8a8a", cursor: "pointer" }}>Remove</button>
      <button type="button" aria-label={d.clipEditorClose} onClick={() => r?.setSelectedClip(null)} style={{ marginLeft: "auto", cursor: "pointer" }}>✕</button>
    </div>
  );
});

export function Timeline() {
  const { t: dict } = useLocale();
  const { r } = useStage();
  const reel = r?.reel ?? null;
  const clips = reel?.clips ?? [];
  const total = reel?.duration_us ?? 0;
  const [music] = useMusic();
  const tune = reel?.settings.music_id ? (music?.find((m) => m.id === reel.settings.music_id)?.name ?? dict.body.reelstage.chosenFallback) : null;
  const [edit, setEdit] = useState<{ a: string; b: string }>({ a: "", b: "" });
  const sel = clips.find((c) => c.id === r?.selectedClip) ?? null;
  useEffect(() => { if (sel) setEdit({ a: (sel.in_pts_us / 1e6).toFixed(1), b: (sel.out_pts_us / 1e6).toFixed(1) }); }, [sel?.id, sel?.in_pts_us, sel?.out_pts_us]);   // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = !!r?.canEdit && !r.busy && !!reel;
  const [clearAsk, setClearAsk] = useState(false);
  // B.16 (ADR-092): zoom (the lanes show a window of the reel; the wheel pans it; a selected clip is kept in view) and a list view
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState(0);
  const [asList, setAsList] = useState(false);
  const ZW = W * zoom, maxOff = Math.max(0, ZW - W), o = Math.min(off, maxOff);
  useEffect(() => { if (!clearAsk) return; const t = setTimeout(() => setClearAsk(false), 4000); return () => clearTimeout(t); }, [clearAsk]);
  const clearAll = () => {
    if (!reel || !r) return;
    if (!clearAsk) { setClearAsk(true); return; }
    setClearAsk(false); r.setSelectedClip(null);
    r.run(() => api<Reel>(`/v1/reels/${reel.id}/clips`, { method: "DELETE" }), dict.body.reelstage.allClipsRemoved);
  };
  let acc = 0;
  const segs = clips.map((c, i) => { const d = slotUs(c), at = acc, x = X0 + (acc / Math.max(1, total)) * ZW - o, w = Math.max(6, (d / Math.max(1, total)) * ZW - 3); acc += d;
    // the part inside the visible window (zoomed in, a clip can be partly or wholly outside it)
    const xv = Math.max(x, X0), wv = Math.min(x + w, X0 + W) - xv;
    return { c, i, x, w, d, xv, wv, mid: (at + d / 2) / Math.max(1, total) }; });
  const idx = sel ? clips.findIndex((c) => c.id === sel.id) : -1;
  const zoomTo = (z: number) => {
    const centre = idx >= 0 ? segs[idx]!.mid : (o + W / 2) / ZW;
    setZoom(z); setOff(zoomOffset(W, z, centre));
  };
  useEffect(() => {                                                   // keep the selected clip in view when zoomed in
    if (zoom === 1 || idx < 0) return;
    const s = segs[idx]!;
    if (s.x < X0 || s.x + s.w > X0 + W) setOff(zoomOffset(W, zoom, s.mid));
  }, [idx, zoom]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                                   // the wheel pans a zoomed timeline
    const el = section.current;
    if (!el || zoom === 1) return;
    const onWheel = (e: WheelEvent) => {
      const lanes = el.querySelector("[data-lane='clips']")?.getBoundingClientRect();
      if (!lanes || e.clientX < lanes.left) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY, k = W / Math.max(1, lanes.width);
      setOff((v) => Math.min(Math.max(0, Math.min(v, maxOff) + d * k), maxOff));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, maxOff]);
  const move = useCallback((d: number) => {
    if (!reel || !r || idx < 0) return;
    const ids = clips.map((c) => c.id);
    [ids[idx], ids[idx + d]] = [ids[idx + d]!, ids[idx]!];
    r.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/order`, { method: "POST", json: { clip_ids: ids } }));
  }, [reel, r, idx, clips]);

  // drag and drop: where it lands is the gap nearest the pointer (before the first clip whose middle is to its right)
  const section = useRef<HTMLElement | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  useEffect(() => { const off = () => setDropAt(null); window.addEventListener("dragend", off); return () => window.removeEventListener("dragend", off); }, []);
  const gapAt = (clientX: number) => {
    const lane = section.current?.querySelector("[data-lane='clips']")?.getBoundingClientRect();
    if (!lane || lane.width === 0) return clips.length;
    const sx = X0 + ((clientX - lane.left) / lane.width) * W;
    const k = segs.findIndex((s) => s.x + s.w / 2 > sx);
    return k < 0 ? clips.length : k;
  };
  // both dragenter and dragover must accept the drag, or the browser never fires drop (it then targets <body> instead; 2026-11-02);
  // the line stays until the pointer leaves for something outside the timeline or the drag ends
  const onDragOver = (e: DragEvent) => {
    if (!dragged || !canEdit) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "clip" in dragged ? "move" : "copy";
    const k = gapAt(e.clientX);
    if (k !== dropAt) setDropAt(k);
  };
  const onDrop = (e: DragEvent) => {
    const d = dragged, k = dropAt ?? gapAt(e.clientX);
    dragged = null; setDropAt(null);
    if (!d || !canEdit || !reel || !r) return;
    e.preventDefault();
    const order = (ids: string[], id: string) => { const rest = ids.filter((x) => x !== id), from = ids.indexOf(id); const at = from >= 0 && from < k ? k - 1 : k; rest.splice(at, 0, id); return rest; };
    const ids = clips.map((c) => c.id);
    const existing = "clip" in d ? d.clip : clips.find((c) => c.in_pts_us === d.moment.in_pts_us)?.id;
    if (existing) {
      const next = order(ids, existing);
      if (next.join() !== ids.join()) r.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/order`, { method: "POST", json: { clip_ids: next } }), dict.body.reelstage.clipMoved);
      return;
    }
    if ("clip" in d) return;
    const m = d.moment;
    r.run(async () => {
      const after = await api<Reel>(`/v1/reels/${reel.id}/clips`, { method: "POST", json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, origin: "SUGGESTED", label: m.label } });
      const added = after.clips.find((c) => !ids.includes(c.id));
      if (!added || k >= ids.length) return after;
      return api<Reel>(`/v1/reels/${reel.id}/clips/order`, { method: "POST", json: { clip_ids: order([...ids, added.id], added.id) } });
    }, dict.body.reels.clipAdded);
  };
  const lineX = dropAt === null ? 0 : Math.min(X0 + W, Math.max(X0 - 2, dropAt === 0 ? (segs[0]?.x ?? X0) - 2 : segs[dropAt - 1]!.x + segs[dropAt - 1]!.w));
  const lane = (y: number, h: number, bg: string, border?: string) => ({ background: bg, border: border ? `${u(1.5)} solid ${border}` : undefined, borderRadius: u(6), boxSizing: "border-box" as const, y, h });
  void lane;
  return (
    <section ref={section} aria-label={dict.body.reelstage.timelineAria} data-section="p06-s07" data-clips={String(clips.length)} data-drop-at={dropAt ?? ""}
      onDragEnter={onDragOver} onDragOver={onDragOver} onDrop={onDrop}
      onDragLeave={(e) => { const to = e.relatedTarget as Node | null; if (to && !section.current?.contains(to)) setDropAt(null); }}>
      <P x={445} y={1150} w={1593} h={265} />
      <B x={675} y={1152} w={1} h={261} style={{ background: "#12335f" }} />
      <Ic x={475} y={1225} k="film" size={26} color="#d6e4f7" /><T x={508} y={1225} size={20} color="#d6e4f7">{dict.body.reels.videoClips}</T>
      <Ic x={475} y={1272} k="sun" size={26} color="#d6e4f7" /><T x={508} y={1272} size={20} color="#d6e4f7">{dict.body.reelstage.laneSpotlight}</T>
      <T x={467} y={1319} size={30} color="#d6e4f7" style={{ fontFamily: "Georgia,serif" }}>T</T><T x={508} y={1319} size={20} color="#d6e4f7">{dict.body.reelstage.laneText}</T>
      <Ic x={475} y={1370} k="note" size={26} color="#d6e4f7" /><T x={508} y={1370} size={20} color="#d6e4f7">{dict.body.reelstage.laneAudio}</T>
      {RULER.slice(0, -1).map((x, i) => <T key={x} x={x} y={1176} size={20} color="#cfe0f5" align="center">{i === 0 && o === 0 ? "00:00" : total ? mmss((total * (o + x - X0)) / ZW) : "—"}</T>)}
      {zoom > 1 && <B x={X0 + (o / ZW) * W} y={1193} w={Math.max(8, (W * W) / ZW)} h={4} data-zoom-window="" style={{ background: "#33a8ff", borderRadius: u(2), pointerEvents: "none" }} />}
      <div role="group" aria-label={dict.body.reelstage.timelineViewAria} className="absolute" style={{ left: u(1858), top: u(1157 - 101), display: "flex", gap: u(4) }}>
        {([["−", dict.body.reelstage.zoomOut, () => zoomTo(ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(zoom as (typeof ZOOM_STEPS)[number]) - 1)]!), zoom > 1 && !asList, "zoom-out"],
           ["+", dict.body.reelstage.zoomIn, () => zoomTo(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(zoom as (typeof ZOOM_STEPS)[number]) + 1)]!), zoom < 16 && !asList && clips.length > 0, "zoom-in"],
           [asList ? "▭" : "☰", asList ? dict.body.reelstage.lanesShow : dict.body.reelstage.listShow, () => setAsList(!asList), clips.length > 0, "list"]] as const).map(([g, l, go, on, k]) => (
          <button key={k} type="button" aria-label={l} title={l} data-timeline-view={k} aria-pressed={k === "list" ? asList : undefined} disabled={!on} onClick={go}
            style={{ width: u(40), height: u(34), fontSize: u(20), fontWeight: 700, color: "#fff", background: "#0a2447", border: `${u(1.5)} solid #33a8ff`, borderRadius: u(6),
              cursor: on ? "pointer" : "default", opacity: on ? 1 : 0.4, padding: 0 }}>{g}</button>
        ))}
        {zoom > 1 && !asList && <span data-zoom={zoom} style={{ alignSelf: "center", fontSize: u(15), color: "#9fb3cc" }}>{`${zoom}×`}</span>}
      </div>

      <B x={X0} y={1203} w={W} h={52} data-lane="clips" style={{ background: "#07162c", border: `${u(1.5)} solid ${dropAt === null ? "#12335f" : "#33a8ff"}`, borderRadius: u(6), boxSizing: "border-box" }} />
      <B x={X0} y={1262} w={W} h={28} style={{ background: "#0a2a52", borderRadius: u(6) }} />
      <B x={X0} y={1350} w={W} h={56} style={{ background: "#05503a", border: `${u(1.5)} solid #12805a`, borderRadius: u(6), boxSizing: "border-box" }} />

      {clips.length === 0 ? (
        <>
          <T x={1360} y={1229} size={19} color="#8ea3bf" align="center">{dict.body.reels.addMoments}</T>
          <T x={1360} y={1276} size={17} color="#8ea3bf" align="center">{dict.body.reelstage.laneNoSpotlight}</T>
          <T x={1360} y={1319} size={19} color="#8ea3bf" align="center">{dict.body.reelstage.laneNoText}</T>
          <Ic x={720} y={1378} k="note" size={28} color="#cfe0f5" /><T x={748} y={1378} size={20} color="#cfe0f5">{dict.body.reelstage.laneNoAudio}</T>
        </>
      ) : (
        <>
          {!asList && segs.filter((s) => s.wv > 0).map(({ c, i, d, xv: x, wv: w }) => {
            const on = c.id === r?.selectedClip;
            return (
              <div key={c.id} data-clip={i}>
                <B x={x} y={1205} w={w} h={48} style={{ background: i % 2 ? "#0d4a8a" : "#0b5cb0", borderRadius: u(5), border: on ? `${u(2.5)} solid #fff` : `${u(1)} solid #1e90ff`, boxSizing: "border-box" }} />
                <T x={x + 8} y={1229} size={17} style={{ maxWidth: u(Math.max(0, w - 12)), overflow: "hidden" }}>{`${i + 1} · ${dict.body.reelstage.durS.replace("{a}", (d / 1e6).toFixed(0))}`}</T>
                <button type="button" aria-label={dict.body.reelstage.clipAria.replace("{a}", String(i + 1)).replace("{b}", secs(d, dict.body.reelstage.durationSec))} aria-pressed={on} title={dict.body.reelstage.momentClickEditDrag} onClick={() => r?.setSelectedClip(on ? null : c.id)}
                  draggable={canEdit} onDragStart={(e) => startDrag(e, { clip: c.id }, `${dict.body.reelstage.clipListFallback} ${i + 1} · ${dict.body.reelstage.durS.replace("{a}", (d / 1e6).toFixed(0))}`)} onDragEnd={() => { dragged = null; }}
                  className="absolute" style={{ left: u(x), top: u(1205 - 101), width: u(w), height: u(48), padding: 0, border: 0, background: "transparent", cursor: canEdit ? "grab" : "pointer" }} />
                <B x={x} y={1264} w={w} h={24} style={{ background: "#1e90ff", opacity: 0.55, borderRadius: u(5) }} />
                {w > 70 && <T x={x + 8} y={1276} size={15} color="#fff">{dict.body.reelstage.laneSpotlightShort}</T>}
                {reel?.settings.name_caption && <B x={x} y={1310} w={w} h={20} style={{ background: "#7b3fe4", opacity: 0.75, borderRadius: u(4) }} />}
                {reel?.settings.name_caption && w > 90 && <T x={x + 8} y={1320} size={14} color="#fff">{dict.body.reelstage.laneNameCaption}</T>}
              </div>
            );
          })}
          {asList && (
            <div role="list" aria-label={dict.body.reelstage.clipsListAria} data-clip-list="" className="absolute" style={{ left: u(X0), top: u(1203 - 101), width: u(W), height: u(203), overflowY: "auto",
              background: "#07162c", border: `${u(1.5)} solid #12335f`, borderRadius: u(6), boxSizing: "border-box", zIndex: 2, fontSize: u(17) }}>
              {segs.map(({ c, i, d }) => {
                const on = c.id === r?.selectedClip;
                return (
                  <button key={c.id} type="button" role="listitem" data-list-clip={i} aria-pressed={on} onClick={() => r?.setSelectedClip(on ? null : c.id)}
                    style={{ display: "grid", gridTemplateColumns: `${u(50)} 1fr ${u(170)} ${u(80)} ${u(130)}`, gap: u(10), width: "100%", textAlign: "left", padding: `${u(5)} ${u(10)}`,
                      background: on ? "#0d3a78" : i % 2 ? "#081d38" : "transparent", border: 0, color: "#e3eefb", cursor: "pointer" }}>
                    <b>{i + 1}</b><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label ?? dict.body.reelstage.clipListFallback}</span>
                    <span style={{ color: "#9fb3cc" }}>{`${mmss(c.in_pts_us)} – ${mmss(c.out_pts_us)}`}</span><span>{secs(d, dict.body.reelstage.durationSec)}</span>
                    <span style={{ color: "#9fb3cc" }}>{c.effect.kind === "NONE" ? "" : c.effect.kind === "SLOW" ? dict.body.reelstage.effectSlow : c.effect.kind === "FREEZE" ? dict.body.reelstage.effectFreeze : dict.body.reelstage.effectHero}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!reel?.settings.name_caption && <T x={1360} y={1319} size={19} color="#8ea3bf" align="center">{dict.body.reelstage.laneNoText}</T>}
          <Ic x={720} y={1378} k="note" size={28} color="#cfe0f5" /><T x={748} y={1378} size={20} color="#cfe0f5">{tune ? dict.body.reelstage.audioMusic.replace("{a}", tune).replace("{b}", String(Math.round((reel?.settings.music_volume ?? 0) * 100))).replace("{c}", String(Math.round((reel?.settings.match_volume ?? 0) * 100))) : dict.body.reelstage.audioMatchOnly}</T>
        </>
      )}

      {clips.length > 0 && (
        <button type="button" data-remove-all disabled={!canEdit} onClick={clearAll} title={dict.body.reelstage.removeAllTitle}
          className="absolute" style={{ left: u(458), top: u(1160 - 101), width: u(205), height: u(34), fontSize: u(16), fontWeight: 600, borderRadius: u(6),
            color: clearAsk ? "#fff" : "#ff8a8a", background: clearAsk ? "#b3261e" : "transparent", border: `${u(1.5)} solid ${clearAsk ? "#ff8a8a" : "#7a2a2a"}`, cursor: canEdit ? "pointer" : "default" }}>
          {clearAsk ? dict.body.reelstage.removeAllConfirm : dict.body.reelstage.removeAll.replace("{a}", String(clips.length))}</button>
      )}

      {dropAt !== null && <B x={lineX} y={1197} w={4} h={64} data-drop-line="" style={{ background: "#fff", borderRadius: u(2), boxShadow: "0 0 8px #33a8ff", zIndex: 2, pointerEvents: "none" }} />}

      {sel && <ClipEditor sel={sel} idx={idx} total={clips.length} edit={edit} setEdit={setEdit} canEdit={canEdit} reel={reel} r={r} move={move} />}
    </section>
  );
}
