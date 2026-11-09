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
import { u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { reelTimeOf } from "./editing";
import { tc, type Ui } from "./kit";
import { locate, type Placed, type Studio } from "./useStudio";

const chip = (on: boolean, can: boolean) => ({ padding: `${u(5)} ${u(11)}`, borderRadius: u(6), border: `${u(1.5)} solid ${on ? "#33a8ff" : "#1d4f8a"}`,
  background: on ? "#0d3a78" : "#0a2447", color: "#fff", fontSize: u(16), fontFamily: "inherit", cursor: can ? "pointer" : "default", opacity: can ? 1 : 0.5 });
const note = { margin: 0, fontSize: u(15), color: "#8ea3bf", lineHeight: 1.3 };
const row = { display: "flex", flexWrap: "wrap" as const, gap: u(6), alignItems: "center", fontSize: u(16), color: "#cfe0f5" };
const KINDS: [TransitionKind, string][] = [["FADE", "Fade"], ["DISSOLVE", "Dissolve"], ["ZOOM", "Zoom"], ["SPIN", "Spin"]];
const MS = [400, 600, 1000];

/** a two-colour sample of the kind, moving in a loop (CSS only: what the renderer draws, not the footage) */
function Sample({ kind }: { kind: TransitionKind }) {
  const anim: Record<TransitionKind, string> = { FADE: "otsiTrFade", DISSOLVE: "otsiTrDiss", ZOOM: "otsiTrZoom", SPIN: "otsiTrSpin" };
  return (
    <span aria-hidden data-tr-sample={kind} style={{ position: "relative", display: "inline-block", width: u(54), height: u(30), borderRadius: u(4), overflow: "hidden", background: "#2a6fb8" }}>
      <span style={{ position: "absolute", inset: 0, background: "#2d7a3a", animation: `${anim[kind]} 2s ease-in-out infinite` }} />
    </span>
  );
}
const KEYFRAMES = `@keyframes otsiTrFade{0%,30%{opacity:0;filter:brightness(1)}50%{opacity:0;filter:brightness(0)}70%,100%{opacity:1}}
@keyframes otsiTrDiss{0%,25%{opacity:0}75%,100%{opacity:1}}
@keyframes otsiTrZoom{0%,25%{opacity:0;transform:scale(1.6)}75%,100%{opacity:1;transform:scale(1)}}
@keyframes otsiTrSpin{0%,25%{opacity:0;transform:rotate(-90deg) scale(.4)}75%,100%{opacity:1;transform:none}}`;

export function TransitionsPanel({ st, placed, can, why }: { st: Studio; placed: Placed | null; can: boolean; why: () => void }) {
  const [kind, setKind] = useState<TransitionKind>("DISSOLVE");
  const [ms, setMs] = useState(TRANSITION_DEFAULT_MS);
  const reel = st.reel!;
  const cut = placed && placed.index > 0 ? placed : null;
  const t = cut ? reel.transitions.find((x) => x.clip_id === cut.clip.id) : null;
  const plan = transitionsForAll(st.items.map((p) => ({ id: p.clip.id, in_pts_us: p.clip.in_pts_us, out_pts_us: p.clip.out_pts_us, gap_ms: p.clip.fx.gap_ms })), ms);
  const cuts = plan.filter((x) => x.ms !== null).length, skipped = Math.max(0, st.items.length - 1) - cuts;
  return (
    <div data-transitions-panel="" style={{ display: "flex", flexDirection: "column", gap: u(8), paddingBottom: u(10) }}>
      <style>{KEYFRAMES}</style>
      <span style={row}>
        {KINDS.map(([k, l]) => (
          <button key={k} type="button" data-tr-kind={k} aria-pressed={kind === k} onClick={() => setKind(k)} style={{ ...chip(kind === k, true), display: "flex", alignItems: "center", gap: u(6) }}>
            <Sample kind={k} />{l}
          </button>
        ))}
      </span>
      <span style={row}>Length
        {MS.map((v) => <button key={v} type="button" data-tr-ms={v} aria-pressed={ms === v} onClick={() => setMs(v)} style={chip(ms === v, true)}>{`${(v / 1000).toFixed(1)} s`}</button>)}
      </span>
      <span style={row}>
        <button type="button" data-tr-apply="cut" disabled={!cut} style={chip(false, can && !!cut)}
          onClick={() => { if (!can) return why(); if (cut) st.setTransition(cut.clip.id, kind, Math.min(ms, Math.floor((cut.clip.out_pts_us - cut.clip.in_pts_us) / 2000))); }}>
          {cut ? `Into clip ${cut.index + 1}` : "Select clip 2 or later"}</button>
        {t && <button type="button" data-tr-apply="cut-none" style={chip(false, can)} onClick={() => (can ? st.setTransition(t.clip_id, null) : why())}>Remove from this cut</button>}
        <button type="button" data-tr-apply="all" disabled={st.items.length < 2} style={chip(false, can && st.items.length > 1)}
          onClick={() => (can ? st.setAllTransitions(kind, ms) : why())}>{`On every cut (${cuts})`}</button>
        {reel.transitions.length > 0 && <button type="button" data-tr-apply="none" style={chip(false, can)} onClick={() => (can ? st.setAllTransitions(null) : why())}>Remove all</button>}
      </span>
      <p style={note}>{skipped > 0 ? `${skipped} cut${skipped === 1 ? "" : "s"} will have none: the clip after it starts from a gap or is too short. ` : ""}Every cut replaces the transitions already there; Undo brings them back.</p>
    </div>
  );
}

export function MarkersPanel({ st, ui }: { st: Studio; ui: Ui }) {
  const marks = st.notes.filter((n) => n.at_pts_us !== null).map((n) => ({ n, at: reelTimeOf(st.items, n.at_pts_us!) }))
    .sort((x, y) => (x.at ?? Infinity) - (y.at ?? Infinity) || x.n.at_pts_us! - y.n.at_pts_us!);
  if (!marks.length) return <p style={{ ...note, paddingBottom: u(10) }}>No markers yet. Press M on the timeline, or write a note in the Clip Inspector, to pin one at the playhead.</p>;
  return (
    <ul data-marker-list="" style={{ listStyle: "none", margin: 0, padding: `0 0 ${u(10)}`, display: "flex", flexDirection: "column", gap: u(4), maxHeight: u(260), overflowY: "auto" }}>
      {marks.map(({ n, at }) => (
        <li key={n.id} data-marker={n.id} style={{ display: "flex", alignItems: "center", gap: u(8), fontSize: u(16), color: "#e3eefb" }}>
          <button type="button" data-marker-go={n.id} disabled={at === null} onClick={() => at !== null && st.setPlayhead(at)}
            title={at === null ? "This marker's time is in no clip of the reel" : "Go to the marker"}
            style={{ ...chip(false, at !== null), minWidth: u(92), padding: `${u(3)} ${u(8)}` }}>{at === null ? "not in reel" : tc(at)}</button>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${n.body} · ${n.author.display_name}`}>{n.body}</span>
          <button type="button" data-marker-delete={n.id} aria-label={`Delete the marker "${n.body}"`} title="Delete (your own, or as an owner / admin)"
            onClick={() => void st.removeNote(n.id).then(() => ui.say("Marker deleted"), () => ui.say("Only its author or an owner / admin can delete this marker"))}
            style={{ ...chip(false, true), padding: `${u(3)} ${u(8)}` }}>×</button>
        </li>
      ))}
    </ul>
  );
}

export function BlocksPanel({ st, ui, placed, can, why }: { st: Studio; ui: Ui; placed: Placed | null; can: boolean; why: () => void }) {
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
    if (!name.trim()) return ui.say("Give the block a name first");
    const ids = st.items.slice(a - 1, b).map((p) => p.clip.id);
    void api<ReelBlock>(`/v1/reels/${reel.id}/blocks`, { method: "POST", json: { name: name.trim(), clip_ids: ids } })
      .then(() => { setName(""); ui.say(`Block saved: clips ${a}–${b}`); return load(); }, () => ui.say("The block could not be saved"));
  };
  const at = (() => { const h = locate(st.items, st.playhead); return h && st.playhead < st.total ? h.p.index : null; })();
  const sel = { height: u(32), fontSize: u(16), color: "#fff", background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(6) };
  return (
    <div data-blocks-panel="" style={{ display: "flex", flexDirection: "column", gap: u(8), paddingBottom: u(10) }}>
      {n > 0 ? (
        <span style={row}>Save clips
          <select aria-label="First clip of the block" value={from} onChange={(e) => setFrom(Number(e.target.value))} style={sel}>{st.items.map((p) => <option key={p.clip.id} value={p.index + 1}>{p.index + 1}</option>)}</select>
          to
          <select aria-label="Last clip of the block" value={to} onChange={(e) => setTo(Number(e.target.value))} style={sel}>{st.items.map((p) => <option key={p.clip.id} value={p.index + 1}>{p.index + 1}</option>)}</select>
          <input aria-label="Block name" placeholder="Name, e.g. Intro" value={name} maxLength={120} onChange={(e) => setName(e.target.value)}
            style={{ ...sel, width: u(150), padding: `0 ${u(6)}`, fontFamily: "inherit" }} />
          <button type="button" data-block-save="" style={chip(false, can)} onClick={save}>Save block</button>
        </span>
      ) : <p style={note}>Add clips to the reel to save a run of them as a block.</p>}
      {blocks === null ? <p style={note}>Loading the blocks…</p> : !blocks.length ? <p style={note}>No saved blocks for this video yet.</p> : (
        <ul data-block-list="" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: u(4) }}>
          {blocks.map((b) => (
            <li key={b.id} data-block={b.id} style={{ display: "flex", alignItems: "center", gap: u(8), fontSize: u(16), color: "#e3eefb" }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={b.clips.map((c) => `${tc(c.in_pts_us)}–${tc(c.out_pts_us)}${c.label ? ` ${c.label}` : ""}`).join("\n")}>
                {`${b.name} · ${b.clips.length} clip${b.clips.length === 1 ? "" : "s"} · ${(b.length_us / 1e6).toFixed(1)} s`}</span>
              <button type="button" data-block-insert={b.id} style={chip(false, can)} onClick={() => (can ? st.insertBlock(b.id, at, b.name) : why())}
                title={at === null ? "Put its clips at the end of the reel" : `Put its clips before clip ${at + 1} (at the playhead)`}>{at === null ? "Put in at end" : `Put in before ${at + 1}`}</button>
              <button type="button" data-block-delete={b.id} aria-label={`Delete the block ${b.name}`} style={{ ...chip(false, can), padding: `${u(3)} ${u(8)}` }}
                onClick={() => { if (!can) return why(); void api(`/v1/reels/${reel.id}/blocks/${b.id}`, { method: "DELETE" }).then(() => { ui.say("Block deleted; reels keep their clips"); return load(); }, () => ui.say("The block could not be deleted")); }}>×</button>
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
    <div data-cuts-panel="" style={{ display: "flex", flexDirection: "column", gap: u(8), paddingBottom: u(10) }}>
      <p style={note}>Where each clip could start and end to hold the engine&apos;s events of his around it. Built by a rule from detected events: check before applying.</p>
      {list === undefined ? <p style={note}>Reading the events…</p> : list === null ? <p style={note}>The suggestions could not be read.</p>
        : list.length === 0 ? <p style={note} data-cuts-none>No suggestion: every clip already holds his events, or the engine found none around them.</p> : list.map((s) => {
          const i = index.get(s.clip_id), clip = st.items[i ?? -1]?.clip;
          if (i === undefined || !clip) return null;
          return (
            <div key={s.clip_id} data-cut-suggestion={s.clip_id} style={{ display: "flex", alignItems: "center", gap: u(8), fontSize: u(15), color: "#cfe0f5" }}>
              <Evidence level="INFERRED" compact size={11} />
              <span style={{ flex: 1, minWidth: 0 }}>{`Clip ${i + 1}: ${s.why}`}<span style={{ display: "block", color: "#8ea3bf" }}>{`${tc(s.from_in_us)}–${tc(s.from_out_us)} → ${tc(s.in_pts_us)}–${tc(s.out_pts_us)}`}</span></span>
              <button type="button" data-cut-apply={s.clip_id} style={chip(false, can)} onClick={() => (can ? st.trim(clip, s.in_pts_us, s.out_pts_us) : why())}>Apply</button>
            </div>
          );
        })}
    </div>
  );
}
