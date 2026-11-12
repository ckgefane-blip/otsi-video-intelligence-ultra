"use client";
/**
 * v3 Phase B.21 (ADR-096): three Adjustments panels of Clip Studio.
 *   Transitions  a picker with a moving sample of each kind: put it on the selected clip's cut, or on every cut as one change (Undo
 *                reverts it); a clip after a gap gets none, a short clip the longest it can take (the API decides, contracts reel-blocks.ts)
 *   Markers      every note pinned at a time (M on the timeline, or Clip Inspector notes), at its place in the reel: click to go there,
 *                delete your own; a marker outside every clip is listed as "not in the reel"
 *   Blocks       compound clips: save a run of consecutive clips under a name; put a saved block in before the clip at the playhead (or at
 *                the end) in any reel of the same video; the copies do not follow later changes to the block or its first reel
 */
import { ReelBlock, TRANSITION_DEFAULT_MS, transitionsForAll, type BoundarySuggestion, type TransitionKind } from "@otsi-vie/contracts";
import { Evidence } from "@/components/evidence/Evidence";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { reelTimeOf } from "./editing";
import { tc, type Ui } from "./kit";
import { locate, type Placed, type Studio } from "./useStudio";
import { useLocale } from "@/lib/i18n";

const chip = (on: boolean, can: boolean) => `t-button rounded-md border px-2.5 py-1.5 ${on ? "border-primary bg-[#0d3a78] text-white" : "border-line2 bg-[#0a2447] text-white"} ${can ? "cursor-pointer" : "opacity-50"}`;
const note = "t-small leading-snug";
const row = "t-body flex flex-wrap items-center gap-1.5 text-[#cfe0f5]";
const MS = [400, 600, 1000];

/** a two-colour sample of the kind, moving in a loop (CSS only: what the renderer draws, not the footage) */
function Sample({ kind }: { kind: TransitionKind }) {
  const anim: Record<TransitionKind, string> = { FADE: "otsiTrFade", DISSOLVE: "otsiTrDiss", ZOOM: "otsiTrZoom", SPIN: "otsiTrSpin" };
  return (
    <span aria-hidden data-tr-sample={kind} style={{ position: "relative", display: "inline-block", width: 54, height: 30, borderRadius: 4, overflow: "hidden", background: "#2a6fb8" }}>
      <span style={{ position: "absolute", inset: 0, background: "#2d7a3a", animation: `${anim[kind]} 2s ease-in-out infinite` }} />
    </span>
  );
}
const KEYFRAMES = `@keyframes otsiTrFade{0%,30%{opacity:0;filter:brightness(1)}50%{opacity:0;filter:brightness(0)}70%,100%{opacity:1}}
@keyframes otsiTrDiss{0%,25%{opacity:0}75%,100%{opacity:1}}
@keyframes otsiTrZoom{0%,25%{opacity:0;transform:scale(1.6)}75%,100%{opacity:1;transform:scale(1)}}
@keyframes otsiTrSpin{0%,25%{opacity:0;transform:rotate(-90deg) scale(.4)}75%,100%{opacity:1;transform:none}}`;

export function TransitionsPanel({ st, placed, can, why }: { st: Studio; placed: Placed | null; can: boolean; why: () => void }) {
  const { t: dict } = useLocale();
  const [kind, setKind] = useState<TransitionKind>("DISSOLVE");
  const KINDS: [TransitionKind, string][] = [["FADE", dict.body.studio.fadeLabel], ["DISSOLVE", dict.body.studio.dissolveLabel], ["ZOOM", dict.body.studio.zoomLabel2], ["SPIN", dict.body.studio.spinLabel]];
  const [ms, setMs] = useState(TRANSITION_DEFAULT_MS);
  const reel = st.reel!;
  const cut = placed && placed.index > 0 ? placed : null;
  const t = cut ? reel.transitions.find((x) => x.clip_id === cut.clip.id) : null;
  const plan = transitionsForAll(st.items.map((p) => ({ id: p.clip.id, in_pts_us: p.clip.in_pts_us, out_pts_us: p.clip.out_pts_us, gap_ms: p.clip.fx.gap_ms })), ms);
  const cuts = plan.filter((x) => x.ms !== null).length, skipped = Math.max(0, st.items.length - 1) - cuts;
  return (
    <div data-transitions-panel="" className="flex flex-col gap-2 pb-2.5">
      <style>{KEYFRAMES}</style>
      <span className={row}>
        {KINDS.map(([k, l]) => (
          <button key={k} type="button" data-tr-kind={k} aria-pressed={kind === k} onClick={() => setKind(k)} className={chip(kind === k, true) + " flex items-center gap-1.5"}>
            <Sample kind={k} />{l}
          </button>
        ))}
      </span>
      <span className={row}>{dict.body.studio.lengthLabel}
        {MS.map((v) => <button key={v} type="button" data-tr-ms={v} aria-pressed={ms === v} onClick={() => setMs(v)} className={chip(ms === v, true)}>{`${(v / 1000).toFixed(1)} s`}</button>)}
      </span>
      <span className={row}>
        <button type="button" data-tr-apply="cut" disabled={!cut} className={chip(false, can && !!cut)}
          onClick={() => { if (!can) return why(); if (cut) st.setTransition(cut.clip.id, kind, Math.min(ms, Math.floor((cut.clip.out_pts_us - cut.clip.in_pts_us) / 2000))); }}>
          {cut ? dict.body.studio.intoClipN.replace("{a}", String(cut.index + 1)) : dict.body.studio.selectClip2Later}</button>
        {t && <button type="button" data-tr-apply="cut-none" className={chip(false, can)} onClick={() => (can ? st.setTransition(t.clip_id, null) : why())}>{dict.body.studio.removeFromCut}</button>}
        <button type="button" data-tr-apply="all" disabled={st.items.length < 2} className={chip(false, can && st.items.length > 1)}
          onClick={() => (can ? st.setAllTransitions(kind, ms) : why())}>{dict.body.studio.onEveryCutN.replace("{a}", String(cuts))}</button>
        {reel.transitions.length > 0 && <button type="button" data-tr-apply="none" className={chip(false, can)} onClick={() => (can ? st.setAllTransitions(null) : why())}>{dict.body.studio.removeAll}</button>}
      </span>
      <p className={note}>{skipped > 0 ? (skipped === 1 ? dict.body.studio.skippedCutsOne : dict.body.studio.skippedCutsMany).replace("{a}", String(skipped)) : ""}{dict.body.studio.everyCutReplaces}</p>
    </div>
  );
}

export function MarkersPanel({ st, ui }: { st: Studio; ui: Ui }) {
  const { t: dict } = useLocale();
  const marks = st.notes.filter((n) => n.at_pts_us !== null).map((n) => ({ n, at: reelTimeOf(st.items, n.at_pts_us!) }))
    .sort((x, y) => (x.at ?? Infinity) - (y.at ?? Infinity) || x.n.at_pts_us! - y.n.at_pts_us!);
  if (!marks.length) return <p className={note} style={{ paddingBottom: 10 }}>{dict.body.studio.noMarkersHint}</p>;
  return (
    <ul data-marker-list="" className="m-0 flex max-h-[260px] flex-col gap-1 overflow-y-auto pb-2.5" style={{ listStyle: "none" }}>
      {marks.map(({ n, at }) => (
        <li key={n.id} data-marker={n.id} className="t-body flex items-center gap-2">
          <button type="button" data-marker-go={n.id} disabled={at === null} onClick={() => at !== null && st.setPlayhead(at)}
            title={at === null ? dict.body.studio.markerNoClip : dict.body.studio.goToMarker}
            className={chip(false, at !== null)} style={{ minWidth: 92 }}>{at === null ? dict.body.studio.markerNotInReel : tc(at)}</button>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${n.body} · ${n.author.display_name}`}>{n.body}</span>
          <button type="button" data-marker-delete={n.id} aria-label={dict.body.studio.deleteMarker.replace("{a}", n.body)} title={dict.body.studio.deleteMarkerHint}
            onClick={() => void st.removeNote(n.id).then(() => ui.say(dict.body.studio.markerDeleted), () => ui.say(dict.body.studio.markerDeleteDenied))}
            className={chip(false, true)}>×</button>
        </li>
      ))}
    </ul>
  );
}

export function BlocksPanel({ st, ui, placed, can, why }: { st: Studio; ui: Ui; placed: Placed | null; can: boolean; why: () => void }) {
  const { t: dict } = useLocale();
  const reel = st.reel!;
  const [blocks, setBlocks] = useState<ReelBlock[] | null>(null);
  const [from, setFrom] = useState(1), [to, setTo] = useState(1), [name, setName] = useState("");
  const load = () => api<ReelBlock[]>(`/v1/reels/${reel.id}/blocks`).then((x) => setBlocks(x.map((b) => ReelBlock.parse(b))), () => setBlocks([]));
  useEffect(() => { void load(); }, [reel.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (placed) { setFrom(placed.index + 1); setTo(placed.index + 1); } }, [placed?.clip.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  const n = st.items.length;
  const save = () => {
    if (!can) return why();
    const a = Math.min(from, to), b = Math.max(from, to);
    if (!name.trim()) return ui.say(dict.body.studio.giveBlockName);
    const ids = st.items.slice(a - 1, b).map((p) => p.clip.id);
    void api<ReelBlock>(`/v1/reels/${reel.id}/blocks`, { method: "POST", json: { name: name.trim(), clip_ids: ids } })
      .then(() => { setName(""); ui.say(dict.body.studio.blockSaved.replace("{a}", String(a)).replace("{b}", String(b))); return load(); }, () => ui.say(dict.body.studio.blockNotSaved));
  };
  const at = (() => { const h = locate(st.items, st.playhead); return h && st.playhead < st.total ? h.p.index : null; })();
  const sel = { height: 32, fontSize: 13, color: "#fff", background: "#041022", border: "1.5px solid #17406f", borderRadius: 6 };
  return (
    <div data-blocks-panel="" className="flex flex-col gap-2 pb-2.5">
      {n > 0 ? (
        <span className={row}>{dict.body.studio.saveClips}
          <select aria-label={dict.body.studio.firstClipBlock} value={from} onChange={(e) => setFrom(Number(e.target.value))} style={sel}>{st.items.map((p) => <option key={p.clip.id} value={p.index + 1}>{p.index + 1}</option>)}</select>{dict.body.studio.blockTo}
          <select aria-label={dict.body.studio.lastClipBlock} value={to} onChange={(e) => setTo(Number(e.target.value))} style={sel}>{st.items.map((p) => <option key={p.clip.id} value={p.index + 1}>{p.index + 1}</option>)}</select>
          <input aria-label={dict.body.studio.blockName} placeholder={dict.body.studio.blockNamePlaceholder} value={name} maxLength={120} onChange={(e) => setName(e.target.value)}
            style={{ ...sel, width: 150, padding: "0 6px", fontFamily: "inherit" }} />
          <button type="button" data-block-save="" className={chip(false, can)} onClick={save}>{dict.body.studio.saveBlock}</button>
        </span>
      ) : <p className={note}>{dict.body.studio.addClipsBlockHint}</p>}
      {blocks === null ? <p className={note}>{dict.body.studio.loadingBlocks}</p> : !blocks.length ? <p className={note}>{dict.body.studio.noBlocksYet}</p> : (
        <ul data-block-list="" className="m-0 flex flex-col gap-1 p-0" style={{ listStyle: "none" }}>
          {blocks.map((b) => (
            <li key={b.id} data-block={b.id} className="t-body flex items-center gap-2">
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={b.clips.map((c) => `${tc(c.in_pts_us)}–${tc(c.out_pts_us)}${c.label ? ` ${c.label}` : ""}`).join("\n")}>
                {b.clips.length === 1 ? dict.body.studio.blockClipsOne.replace("{a}", b.name).replace("{b}", (b.length_us / 1e6).toFixed(1)) : dict.body.studio.blockClipsMany.replace("{a}", b.name).replace("{b}", String(b.clips.length)).replace("{c}", (b.length_us / 1e6).toFixed(1))}</span>
              <button type="button" data-block-insert={b.id} className={chip(false, can)} onClick={() => (can ? st.insertBlock(b.id, at, b.name) : why())}
                title={at === null ? dict.body.studio.putClipsEndHint : dict.body.studio.putClipsBeforeHint.replace("{a}", String(at + 1))}>{at === null ? dict.body.studio.putInAtEnd : dict.body.studio.putInBefore.replace("{a}", String(at + 1))}</button>
              <button type="button" data-block-delete={b.id} aria-label={dict.body.studio.deleteBlock.replace("{a}", b.name)} className={chip(false, can)}
                onClick={() => { if (!can) return why(); void api(`/v1/reels/${reel.id}/blocks/${b.id}`, { method: "DELETE" }).then(() => { ui.say(dict.body.studio.blockDeleted); return load(); }, () => ui.say(dict.body.studio.blockNotDeleted)); }}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * B.25 (ADR-100): suggested clip ends around his events (GET /v1/reels/:id/boundary-suggestions), labelled Inferred. Nothing moves by
 * itself: Apply trims that clip (one change in the history; Undo restores it).
 */
export function CutsPanel({ st, can, why }: { st: Studio; can: boolean; why: () => void }) {
  const { t: dict } = useLocale();
  const reel = st.reel!;
  const [list, setList] = useState<BoundarySuggestion[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setList(undefined);
    api<BoundarySuggestion[]>(`/v1/reels/${reel.id}/boundary-suggestions`).then((x) => live && setList(x), () => live && setList(null));
    return () => { live = false; };
  }, [reel.id, reel.version]);
  const index = new Map(st.items.map((p, i) => [p.clip.id, i]));
  return (
    <div data-cuts-panel="" className="flex flex-col gap-2 pb-2.5">
      <p className={note}>{dict.body.studio.cutsIntro}</p>
      {list === undefined ? <p className={note}>{dict.body.studio.readingEvents}</p> : list === null ? <p className={note}>{dict.body.studio.suggestionsNotRead}</p>
        : list.length === 0 ? <p className={note} data-cuts-none>{dict.body.studio.noCutSuggestion}</p> : list.map((s) => {
          const i = index.get(s.clip_id), clip = st.items[i ?? -1]?.clip;
          if (i === undefined || !clip) return null;
          return (
            <div key={s.clip_id} data-cut-suggestion={s.clip_id} className="t-small flex items-center gap-2">
              <Evidence level="INFERRED" compact size={11} />
              <span style={{ flex: 1, minWidth: 0 }}>{dict.body.studio.clipSuggestion.replace("{a}", String(i + 1)).replace("{b}", s.why)}<span className="block text-muted">{`${tc(s.from_in_us)}–${tc(s.from_out_us)} → ${tc(s.in_pts_us)}–${tc(s.out_pts_us)}`}</span></span>
              <button type="button" data-cut-apply={s.clip_id} className={chip(false, can)} onClick={() => (can ? st.trim(clip, s.in_pts_us, s.out_pts_us) : why())}>{dict.body.studio.applyLabel}</button>
            </div>
          );
        })}
    </div>
  );
}
