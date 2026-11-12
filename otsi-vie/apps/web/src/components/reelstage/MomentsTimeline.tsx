"use client";
/**
 * Page 06 Sections 06-07 — Suggested Key Moments and the four-layer reel timeline (centre).
 *
 * Moments are the engine's events the reel's confirmed player took part in (shots, key passes, balls won, pressures, passes; ADR-043),
 * ranked best first, then stretches where he is visible on confirmed tracks and no event was detected.
 * Choosing a moment adds it as a clip; one already in the reel selects its clip. A moment can also be dragged into the timeline at any
 * point, and clips are dragged to reorder (the reference's "Drag to reorder"); a white line shows where it will land. The timeline shows the
 * reel's real clips in order and in proportion; a selected clip can be trimmed, moved or removed. "Add all" adds every moment not yet in the
 * reel (match order, up to 10 minutes); "Remove all clips" empties the reel (click twice to confirm). The spotlight and the name caption apply to every clip, so their lanes
 * span the clips; the reel keeps each clip's match audio (no music is connected). Empty lanes keep the reference's wording.
 * E4 (ADR-067): "Build a draft" opens DraftDialog: a length, a theme and a frame give up to three draft reels; one is used, then Edit in Clip Studio.
 * Best Moment Rule v2.1 (ADR-131): the timeline opens with Segment 0 — the Player Profile Intro, which plays first, before the first
 * football clip — and the budget bar shows the clips' total against the chosen length (90 s / 3 min / 5 min, never over 5:00).
 */
import { PROFILE_INTRO_S, slotUs, momentBadge, ZOOM_STEPS, zoomOffset, type CrossMatchCandidate, type MomentEvent, type Reel, type ReelClip, type ReelMoment } from "@otsi-vie/contracts";
import Link from "next/link";
import { type DragEvent, memo, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { DraftDialog } from "./DraftDialog";
import { WhoQueue } from "./WhoQueue";
import { HistoryDialog } from "@/components/reels/HistoryDialog";
import { useMusic } from "./MusicPicker";
import { mmss, secs, useStage } from "./shared";

const X0 = 690, W = 1340;
/** minutes without a leading zero, for the budget bar ("0:00 of 5:00") */
const mss = (us: number) => `${Math.floor(us / 6e7)}:${String(Math.floor(us / 1e6) % 60).padStart(2, "0")}`;
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
  const mini = (label: string, glyph: string, act: (() => void) | null, why: string, data: string, w = 40) => (
    <button key={data} type="button" aria-label={label} title={act ? label : why} data-moment-act={data} disabled={!act} onClick={act ?? undefined}
      className="t-button flex h-[30px] items-center justify-center rounded-md border border-[#33a8ff] bg-black/85 px-1 text-white disabled:opacity-40"
      style={{ minWidth: w }}>{glyph}</button>
  );
  const [draft, setDraft] = useState(false);
  const [hist, setHist] = useState(false);                             // B.1 (ADR-081): Undo, Redo and the reel's History
  const h = r?.history ?? null, canHist = !!r?.canEdit && !r?.busy;
  const count = isCross ? crossItems.length : moments.length;
  return (
    <section id="p06-moments" aria-label={isCross ? d.crossAria : d.momentsAria} data-section="p06-s06" data-moments={String(isCross ? crossTotal : moments.length)}
      className={`vie-panel p-3 ${focus === "p06-moments" ? "border-primary" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="t-section"><span aria-hidden className="text-primary">★ </span>{loading ? (isCross ? d.crossHeadingLoading : d.momentsHeadingLoading) : isCross ? d.crossHeading.replace("{a}", String(crossTotal)) : d.momentsHeading.replace("{a}", String(moments.length))}</h2>
        {reel?.player && !isCross && (
          // ADR-046: moments count only events on his named tracks; "Is this him?" on the unnamed players of the events brings more
          <button type="button" onClick={() => setWho(true)} data-who-link title={d.whoLinkTitle} className="text-xs ml-auto text-primary hover:underline">{d.whoLink}</button>
        )}
        <button type="button" data-add-all disabled={!canAdd || left === 0} title={left ? (isCross ? d.addAllTitleCross : d.addAllTitleSingle) : d.addAllTitleNone}
          onClick={() => reel && r?.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/add-moments`, { method: "POST" }), d.momentsAdded)}
          className="vie-btn vie-btn-sm disabled:opacity-45">{d.addAll.replace("{a}", String(left))}</button>
        {!isCross && <button type="button" data-build-draft disabled={!reel} onClick={() => setDraft(true)} title={d.buildDraftTitle}
          className="vie-btn vie-btn-sm disabled:opacity-45">{d.buildDraft}</button>}
        {([["↶", "Undo", !!h?.can_undo, h?.undo_label ? dict.body.reels.historyUndoBtn.replace("{a}", h.undo_label) : dict.body.reels.historyNothingUndo, () => r?.undo()],
           ["↷", "Redo", !!h?.can_redo, h?.redo_label ? dict.body.reels.historyRedoBtn.replace("{a}", h.redo_label) : dict.body.reels.historyNothingRedo, () => r?.redo()]] as const).map(([g, l, on, tip, go]) => (
          <button key={l} type="button" aria-label={tip} data-reel-undo={l} disabled={!canHist || !on} onClick={go} title={l === "Undo" ? d.undoTitle.replace("{a}", tip) : d.redoTitle.replace("{a}", tip)}
            className="vie-btn vie-btn-sm disabled:opacity-45">{g}</button>
        ))}
        <button type="button" data-history-open disabled={!reel} onClick={() => setHist(true)} title={d.historyTitleBtn}
          className="vie-btn vie-btn-sm disabled:opacity-45">{dict.body.reels.history}</button>
        <button type="button" disabled={count <= 5} title={count > 5 ? d.viewAll : count ? d.viewAllReasonShown : d.viewAllReasonNone}
          onClick={() => { const el = scroller.current; if (el) el.scrollTo({ left: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 ? 0 : el.scrollLeft + el.clientWidth, behavior: "smooth" }); }}
          className="vie-btn vie-btn-sm disabled:opacity-45">{d.viewAllText} ›</button>
      </div>
      {reel && r && <WhoQueue r={r} reel={reel} open={who} onOpenChange={setWho} />}
      <DraftDialog r={r} open={draft} onOpenChange={setDraft} />
      <HistoryDialog r={r} open={hist} onOpenChange={setHist} />
      <div ref={scroller} role="list" aria-label={isCross ? d.crossAria : d.momentsAria} className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {isCross ? crossItems.map((it, i) => { const m = it.m;
          const c = clipOfCross(m), inR = it.inReel || c !== null, tagCol = it.tier ? ({ S: "#a066ff", A: "#19d3ff", B: "#19e6c0", C: "#ffb21a" } as Record<string, string>)[it.tier] ?? "#cfe0f5" : "#8b95a5";
          return (
            <div key={it.key} role="listitem" data-moment={m.in_pts_us} data-cross-tier={it.tier ?? ""} data-not-selected={it.notSelected ?? undefined}
              className="relative w-[298px] shrink-0 overflow-hidden rounded-lg border bg-[#06182f]" style={{ borderColor: inR ? "#1e90ff" : "#12335f", opacity: it.notSelected ? 0.75 : 1 }}>
              <div className="relative h-[116px] bg-[#0b2a52]">
                <span className="t-panel absolute left-2 top-2 flex h-8 w-9 items-center justify-center rounded-md bg-primary text-white">{i + 1}</span>
                <span className="absolute left-12 top-2 rounded-md border px-2 py-1 t-button" data-cross-tier-label={it.tier ?? "left-out"}
                  style={{ borderColor: tagCol, color: tagCol, background: "rgba(0,10,25,.8)" }}>{it.tier ? dict.body.reels.crossTier.replace("{a}", it.tier) : d.tierLeftOut}</span>
                {inR && <span aria-hidden className="absolute right-2 top-2 t-panel text-ok">✓</span>}
              </div>
              <div className="space-y-1 p-2">
                <div className="flex items-center gap-2">
                  <span className="t-small min-w-0 flex-1 truncate rounded-md bg-black/80 px-2 py-1" data-cross-reason={it.notSelected ?? it.reason}
                    aria-label={it.notSelected ? dict.body.reels.crossLeftOut.replace("{a}", it.notSelected) : it.reason}>{it.notSelected ?? it.reason}</span>
                  <span className="t-tc shrink-0 rounded-md bg-black/80 px-2 py-1">{d.durS.replace("{a}", String(Math.round((m.out_pts_us - m.in_pts_us) / 1e6)))}</span>
                </div>
                <p className="t-panel truncate">{m.label}</p>
                <p className="t-small truncate">{`${crossMatchOf(m)}${m.competition ? ` · ${m.competition}` : ""} · ${crossWhenOf(m)}`}</p>
              </div>
              <button type="button" aria-label={inR ? d.momentSelectClip.replace("{a}", String(i + 1)) : d.momentAdd.replace("{a}", String(i + 1))} aria-pressed={inR}
                disabled={!inR && !canAdd} title={!inR && !canAdd ? d.cannotEdit : d.momentClickAdd} onClick={() => { const cc = clipOfCross(m); if (cc) r?.setSelectedClip(cc.id); else crossAdd(m); }}
                className="absolute inset-0 cursor-pointer disabled:cursor-default" />
              {canAdd && (
                <div className="relative z-10 flex justify-end gap-1 px-2 pb-2">
                  {it.notSelected === "rejected for this reel" ? mini(d.miniRestore, d.miniRestoreGlyph, () => crossRestore(m), "", "restore", 90)
                    : inR ? (() => { const cc = clipOfCross(m), at = cc && reel ? reel.clips.indexOf(cc) : -1, n = reel?.clips.length ?? 0;
                      return [mini(d.miniEarlier, "◀", at > 0 ? () => crossMove(m, -1) : null, d.miniAlreadyFirst, "earlier"),
                        mini(d.miniLater, "▶", at >= 0 && at < n - 1 ? () => crossMove(m, 1) : null, d.miniAlreadyLast, "later")]; })()
                    : [mini(d.miniReject, "✕", () => crossReject(m), "", "reject"),
                      mini(sel ? d.miniSwap.replace("{a}", String(selIndex + 1)) : d.miniSwapSelect, "⇄", sel ? () => crossSwap(m) : null, d.miniSwapReason, "swap")]}
                </div>
              )}
            </div>
          ); }) : Array.from({ length: slots }, (_, i) => {
          const m = moments[i];
          const first = i === 0 && moments.length === 0;
          return (
            <div key={i} role="listitem" data-moment={m?.in_pts_us ?? ""} data-rejected={m?.rejected ? "1" : undefined}
              className="relative w-[298px] shrink-0 overflow-hidden rounded-lg border bg-[#06182f]" style={{ borderColor: m?.in_reel ? "#1e90ff" : "#12335f", opacity: m?.rejected ? 0.45 : 1 }}>
              <div className="relative h-[116px] bg-[#0b2a52]">
                <span className="t-panel absolute left-2 top-2 flex h-8 w-9 items-center justify-center rounded-md bg-primary text-white">{i + 1}</span>
                {m?.in_reel && <span aria-hidden className="absolute right-2 top-2 t-panel text-ok">✓</span>}
                {m && (() => {
                  const [word, c] = m.kind === "EVENT" && m.events[0] ? tags[m.events[0]] : [d.tagVisible, "#8ea3bf"];
                  return <span className="absolute left-12 top-2 rounded-md border px-2 py-1 t-button" data-moment-kind={m.kind}
                    style={{ borderColor: c, color: c, background: "rgba(0,10,25,.8)" }}>{word}</span>;
                })()}
              </div>
              <div className="space-y-1 p-2">
                {m ? (() => {
                  const b = momentBadge(m), cov = m.coverage === null ? null : Math.round(m.coverage * 100);
                  const badge = b.word === "On camera" ? { word: d.badgeOnCamera, title: d.badgeOnCameraTitle } : b.word === "Possible" ? { word: d.badgePossible, title: d.badgePossibleTitle } : { word: d.badgeDetected, title: d.badgeDetectedTitle };
                  return (
                    <div className="flex items-center gap-2">
                      <span className="t-small min-w-0 flex-1 truncate rounded-md bg-black/80 px-2 py-1" data-moment-badge={b.word} data-moment-coverage={cov ?? ""}
                        aria-label={`${badge.title}. ${cov === null ? d.badgeCoverageNotMeasured : d.badgeCoverage.replace("{a}", String(cov))}`}>
                        <b style={{ color: b.word === "Possible" ? "#f5b82e" : "#3ee6a8" }}>{badge.word}</b>{" "}
                        <span className="text-[#cfe0f5]">{cov === null ? d.badgeNotMeasured : d.badgeSeen.replace("{a}", String(cov))}</span>
                      </span>
                      <span className="t-tc shrink-0 rounded-md bg-black/80 px-2 py-1">{d.durS.replace("{a}", String(Math.round((m.out_pts_us - m.in_pts_us) / 1e6)))}</span>
                    </div>
                  );
                })() : (
                  <div className="flex items-center gap-2">
                    <span className="t-small min-w-0 flex-1 truncate rounded-md bg-black/80 px-2 py-1">—</span>
                    <span className="t-tc shrink-0 rounded-md bg-black/80 px-2 py-1">—</span>
                  </div>
                )}
                <p className="t-panel truncate">{m ? m.label : first ? (loading ? dict.body.reels.momentsLoading : d.firstNoSuggestions) : "—"}</p>
                <p className="t-small truncate">{m ? detail(m, d) : first ? (loading ? d.momentsLoadingSub : d.firstRunAi) : "—"}</p>
              </div>
              {m && (
                <button type="button" aria-label={m.in_reel ? d.momentSelectClip.replace("{a}", String(i + 1)) : d.momentAdd.replace("{a}", String(i + 1))} aria-pressed={m.in_reel}
                  disabled={!m.in_reel && !canAdd} title={!m.in_reel && !canAdd ? d.cannotEdit : d.momentClickAddDrag} onClick={() => add(i)}
                  draggable={canAdd} onDragStart={(e) => startDrag(e, { moment: m }, `${m.label} · ${d.durS.replace("{a}", String(Math.round((m.out_pts_us - m.in_pts_us) / 1e6)))}`)} onDragEnd={() => { dragged = null; }}
                  className="absolute inset-0 cursor-pointer disabled:cursor-default" />
              )}
              {m && canAdd && (
                <div className="relative z-10 flex justify-end gap-1 px-2 pb-2">
                  {m.rejected ? mini(d.miniRestore, d.miniRestoreGlyph, () => restore(m), "", "restore", 90)
                    : m.in_reel ? (() => {
                      const c = clipOf(m), at = c && reel ? reel.clips.indexOf(c) : -1, n = reel?.clips.length ?? 0;
                      return [mini(d.miniEarlier, "◀", at > 0 ? () => move(m, -1) : null, d.miniAlreadyFirst, "earlier"),
                        mini(d.miniLater, "▶", at >= 0 && at < n - 1 ? () => move(m, 1) : null, d.miniAlreadyLast, "later")];
                    })()
                    : [mini(d.miniReject, "✕", () => reject(m), "", "reject"),
                      mini(sel ? d.miniSwap.replace("{a}", String(selIndex + 1)) : d.miniSwapSelect, "⇄", sel ? () => swap(m) : null, d.miniSwapReason, "swap")]}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {reel && loading && <p className="t-small mt-2 text-center">{isCross ? dict.body.reels.crossLoading : dict.body.reels.momentsLoading}</p>}
      {reel && !loading && !isCross && moments.length === 0 && <p className="t-small mt-2 text-center">{d.noVisibleCenter}</p>}
      {reel && !loading && isCross && crossItems.length === 0 && <p className="t-small mt-2 text-center">{d.noBestCenter}</p>}
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
    <div aria-label={d.clipEditorAria} className="flex flex-wrap items-center gap-2 rounded-ctl border border-primary bg-raised px-2.5 py-1.5 t-body">
      <span className="t-panel">{d.clipEditorTitle.replace("{a}", String(idx + 1))}</span>
      <label className="flex items-center gap-1">{dict.body.reels.clipInLabel} <input value={edit.a} disabled={!canEdit} aria-label={dict.body.reels.clipInAria.replace("{a}", String(idx + 1))} onChange={(e) => setEdit({ ...edit, a: e.target.value })} className="w-16 rounded border border-line2 bg-canvas px-1 py-0.5 t-tc" /></label>
      <label className="flex items-center gap-1">{dict.body.reels.clipOutLabel} <input value={edit.b} disabled={!canEdit} aria-label={dict.body.reels.clipOutAria.replace("{a}", String(idx + 1))} onChange={(e) => setEdit({ ...edit, b: e.target.value })} className="w-16 rounded border border-line2 bg-canvas px-1 py-0.5 t-tc" /></label>
      <button type="button" disabled={!canEdit} onClick={() => reel && r?.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${sel.id}`, { method: "PATCH", json: { in_pts_us: Math.round(Number(edit.a) * 1e6), out_pts_us: Math.round(Number(edit.b) * 1e6) } }), dict.body.reels.clipTrimmed)}
        className="text-primary disabled:opacity-50">{dict.body.reels.clipTrim}</button>
      <button type="button" aria-label={d.moveEarlier} disabled={!canEdit || idx === 0} onClick={() => move(-1)} className="disabled:opacity-50">◀</button>
      <button type="button" aria-label={d.moveLater} disabled={!canEdit || idx === total - 1} onClick={() => move(1)} className="disabled:opacity-50">▶</button>
      <button type="button" aria-label={dict.body.reels.removeClip} disabled={!canEdit} onClick={() => reel && r?.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${sel.id}`, { method: "DELETE" }), d.clipRemoved)} className="text-danger disabled:opacity-50">Remove</button>
      <button type="button" aria-label={d.clipEditorClose} onClick={() => r?.setSelectedClip(null)} className="ml-auto">✕</button>
    </div>
  );
});

/** Best Moment Rule v2.1 budget bar: the clips' total against the chosen length — never over 5:00 */
function BudgetBar({ totalUs, capS, fixed }: { totalUs: number; capS: number; fixed: boolean }) {
  const { t: dict } = useLocale();
  const d = dict.body.reelstage;
  const capUs = capS * 1e6;
  const over = totalUs > capUs;
  const pct = Math.min(100, (totalUs / Math.max(1, capUs)) * 100);
  return (
    <div data-budget-bar="" data-over={over ? "1" : "0"} className="flex items-center gap-3">
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-raised" role="meter" aria-valuemin={0} aria-valuemax={capS} aria-valuenow={Math.round(totalUs / 1e6)}
        aria-label={d.budgetOf.replace("{a}", mss(totalUs)).replace("{b}", mss(capUs))}>
        <div className={`h-full ${over ? "bg-danger" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`t-tc shrink-0 ${over ? "text-danger" : ""}`}>{d.budgetOf.replace("{a}", mss(totalUs)).replace("{b}", mss(capUs))}</span>
      {over && <span className="text-xs text-danger">{d.budgetOver.replace("{a}", mss(capUs))}</span>}
      {fixed && <span className="t-small">{d.budgetCrossFixed.replace("{a}", mss(capUs))}</span>}
    </div>
  );
}

export function Timeline() {
  const { t: dict } = useLocale();
  const { r, lengthS, lengthFixed } = useStage();
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
  const linePct = ((lineX - X0) / W) * 100;
  const showIntro = !!reel?.player && reel.settings.profile_intro !== false;
  return (
    <section ref={section} aria-label={dict.body.reelstage.timelineAria} data-section="p06-s07" data-clips={String(clips.length)} data-drop-at={dropAt ?? ""}
      onDragEnter={onDragOver} onDragOver={onDragOver} onDrop={onDrop}
      onDragLeave={(e) => { const to = e.relatedTarget as Node | null; if (to && !section.current?.contains(to)) setDropAt(null); }}
      className="vie-panel space-y-2 p-3">
      {/* Segment 0 — the Player Profile Intro plays first, before the first football clip (ADR-130) */}
      {showIntro && reel?.player && (
        <div data-segment-0="" className="flex flex-wrap items-center gap-2 rounded-ctl border border-line/70 bg-raised/40 px-2.5 py-1.5">
          <span className="t-panel">{dict.body.reelstage.segment0Label}</span>
          <span className="t-small">{dict.body.reelstage.segment0Note} · {dict.body.reelstage.durationSec.replace("{a}", String(PROFILE_INTRO_S))}</span>
          <Link href={`/players?player=${reel.player.player_id}`} className="text-xs ml-auto text-primary hover:underline">{dict.body.reelstage.openPlayerProfile}</Link>
        </div>
      )}
      <BudgetBar totalUs={total} capS={lengthS} fixed={lengthFixed} />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="t-section">{dict.body.reelstage.timelineAria}</h2>
        {clips.length > 0 && (
          <button type="button" data-remove-all disabled={!canEdit} onClick={clearAll} title={dict.body.reelstage.removeAllTitle}
            className={`vie-btn vie-btn-sm ml-auto ${clearAsk ? "border-danger text-danger" : "text-danger"}`}>
            {clearAsk ? dict.body.reelstage.removeAllConfirm : dict.body.reelstage.removeAll.replace("{a}", String(clips.length))}</button>
        )}
        <div role="group" aria-label={dict.body.reelstage.timelineViewAria} className="flex items-center gap-1">
          {([["−", dict.body.reelstage.zoomOut, () => zoomTo(ZOOM_STEPS[Math.max(0, ZOOM_STEPS.indexOf(zoom as (typeof ZOOM_STEPS)[number]) - 1)]!), zoom > 1 && !asList, "zoom-out"],
             ["+", dict.body.reelstage.zoomIn, () => zoomTo(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, ZOOM_STEPS.indexOf(zoom as (typeof ZOOM_STEPS)[number]) + 1)]!), zoom < 16 && !asList && clips.length > 0, "zoom-in"],
             [asList ? "▭" : "☰", asList ? dict.body.reelstage.lanesShow : dict.body.reelstage.listShow, () => setAsList(!asList), clips.length > 0, "list"]] as const).map(([g, l, go, on, k]) => (
            <button key={k} type="button" aria-label={l} title={l} data-timeline-view={k} aria-pressed={k === "list" ? asList : undefined} disabled={!on} onClick={go}
              className="vie-btn vie-btn-sm disabled:opacity-40">{g}</button>
          ))}
          {zoom > 1 && !asList && <span data-zoom={zoom} className="t-small">{`${zoom}×`}</span>}
        </div>
      </div>

      {sel && <ClipEditor sel={sel} idx={idx} total={clips.length} edit={edit} setEdit={setEdit} canEdit={canEdit} reel={reel} r={r} move={move} />}

      {asList ? (
        <div role="list" aria-label={dict.body.reelstage.clipsListAria} data-clip-list="" className="max-h-[203px] overflow-y-auto rounded-ctl border border-line bg-[#07162c] t-body">
          {segs.map(({ c, i, d }) => {
            const on = c.id === r?.selectedClip;
            return (
              <button key={c.id} type="button" role="listitem" data-list-clip={i} aria-pressed={on} onClick={() => r?.setSelectedClip(on ? null : c.id)}
                className={`grid w-full grid-cols-[3rem_1fr_11rem_5rem_8rem] gap-2 px-2.5 py-1.5 text-left ${on ? "bg-[#0d3a78]" : i % 2 ? "bg-[#081d38]" : ""}`}>
                <span className="font-normal">{i + 1}</span><span className="truncate">{c.label ?? dict.body.reelstage.clipListFallback}</span>
                <span className="text-muted">{`${mmss(c.in_pts_us)} – ${mmss(c.out_pts_us)}`}</span><span>{secs(d, dict.body.reelstage.durationSec)}</span>
                <span className="text-muted">{c.effect.kind === "NONE" ? "" : c.effect.kind === "SLOW" ? dict.body.reelstage.effectSlow : c.effect.kind === "FREEZE" ? dict.body.reelstage.effectFreeze : dict.body.reelstage.effectHero}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-32 shrink-0" />
            <div className="relative h-5 min-w-0 flex-1">
              <div className="flex justify-between t-tc">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i}>{i === 0 && o === 0 ? "00:00" : total ? mmss((total * (o + (i / 5) * W)) / ZW) : "—"}</span>
                ))}
              </div>
              {zoom > 1 && <div data-zoom-window="" className="absolute bottom-0 h-1 rounded bg-primary" style={{ left: `${(o / ZW) * 100}%`, width: `${Math.max(1, (W / ZW) * 100)}%` }} />}
            </div>
          </div>
          <div className="flex items-stretch gap-2">
            <span className="flex w-32 shrink-0 items-center t-small">🎬 {dict.body.reels.videoClips}</span>
            <div data-lane="clips" className={`relative h-14 min-w-0 flex-1 overflow-hidden rounded-ctl border ${dropAt === null ? "border-line bg-[#07162c]" : "border-primary bg-[#07162c]"}`}>
              {clips.length === 0 ? (
                <p className="t-small grid h-full place-items-center">{dict.body.reels.addMoments}</p>
              ) : segs.filter((s) => s.wv > 0).map(({ c, i, d, xv: x, wv: w }) => {
                const on = c.id === r?.selectedClip;
                const leftPct = ((x - X0) / W) * 100, widthPct = (w / W) * 100;
                return (
                  <div key={c.id} data-clip={i} className="absolute inset-y-0" style={{ left: `${leftPct}%`, width: `${widthPct}%` }}>
                    <div className={`flex h-full items-center overflow-hidden rounded px-2 t-small ${i % 2 ? "bg-[#0d4a8a]" : "bg-[#0b5cb0]"} ${on ? "ring-2 ring-white" : "ring-1 ring-[#1e90ff]"}`}>
                      <span className="truncate text-white">{`${i + 1} · ${dict.body.reelstage.durS.replace("{a}", (d / 1e6).toFixed(0))}`}</span>
                    </div>
                    <button type="button" aria-label={dict.body.reelstage.clipAria.replace("{a}", String(i + 1)).replace("{b}", secs(d, dict.body.reelstage.durationSec))} aria-pressed={on} title={dict.body.reelstage.momentClickEditDrag} onClick={() => r?.setSelectedClip(on ? null : c.id)}
                      draggable={canEdit} onDragStart={(e) => startDrag(e, { clip: c.id }, `${dict.body.reelstage.clipListFallback} ${i + 1} · ${dict.body.reelstage.durS.replace("{a}", (d / 1e6).toFixed(0))}`)} onDragEnd={() => { dragged = null; }}
                      className="absolute inset-0 cursor-pointer" />
                  </div>
                );
              })}
              {dropAt !== null && <div data-drop-line="" className="pointer-events-none absolute inset-y-0 z-10 w-1 rounded bg-white shadow-[0_0_8px_#33a8ff]" style={{ left: `${linePct}%` }} />}
            </div>
          </div>
          <div className="flex items-stretch gap-2">
            <span className="flex w-32 shrink-0 items-center t-small">☀ {dict.body.reelstage.laneSpotlight}</span>
            <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-ctl bg-[#0a2a52]">
              {clips.length === 0 ? <p className="t-small grid h-full place-items-center">{dict.body.reelstage.laneNoSpotlight}</p>
                : segs.filter((s) => s.wv > 0).map(({ c, i, xv: x, wv: w }) => (
                  <div key={c.id} className="absolute inset-y-0.5 rounded bg-primary/55" style={{ left: `${((x - X0) / W) * 100}%`, width: `${(w / W) * 100}%` }}>
                    {w / W > 0.05 && <span className="text-xs px-1 text-white">{dict.body.reelstage.laneSpotlightShort}</span>}
                  </div>
                ))}
            </div>
          </div>
          <div className="flex items-stretch gap-2">
            <span className="flex w-32 shrink-0 items-center t-small">T {dict.body.reelstage.laneText}</span>
            <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-ctl bg-[#05503a]/60">
              {clips.length === 0 || !reel?.settings.name_caption ? (
                <p className="t-small grid h-full place-items-center">{dict.body.reelstage.laneNoText}</p>
              ) : segs.filter((s) => s.wv > 0).map(({ c, xv: x, wv: w }) => (
                <div key={c.id} className="absolute inset-y-0.5 rounded bg-[#7b3fe4]/75" style={{ left: `${((x - X0) / W) * 100}%`, width: `${(w / W) * 100}%` }}>
                  {w / W > 0.07 && <span className="text-xs px-1 text-white">{dict.body.reelstage.laneNameCaption}</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-stretch gap-2">
            <span className="flex w-32 shrink-0 items-center t-small">♪ {dict.body.reelstage.laneAudio}</span>
            <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-ctl bg-raised/40">
              {clips.length === 0 ? <p className="t-small grid h-full place-items-center">{dict.body.reelstage.laneNoAudio}</p>
                : <p className="t-small grid h-full place-items-center px-2">♪ {tune ? dict.body.reelstage.audioMusic.replace("{a}", tune).replace("{b}", String(Math.round((reel?.settings.music_volume ?? 0) * 100))).replace("{c}", String(Math.round((reel?.settings.match_volume ?? 0) * 100))) : dict.body.reelstage.audioMatchOnly}</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
