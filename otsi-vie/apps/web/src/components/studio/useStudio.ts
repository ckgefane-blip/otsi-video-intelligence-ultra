"use client";
/**
 * Page 07 Clip Studio: editing a real reel on the timeline. Data comes from the Reel Builder hook (useReel, ADR-035); every edit is a
 * real API call that the server saves at once (add, trim, split, remove, reorder clips; rename; render). Undo and Redo replay the
 * opposite API call, so the saved reel always matches what the timeline shows. The playhead is in reel time (clips back to back).
 */
import { TRANSITION_DEFAULT_MS, clipOutputUs, gapUs, srcAt, type BrandAsset, type ClipFx, type DrawColor, type DrawKind, type ReviewComment, type SetClipEffectRequest, type Reel, type ReelClip, type ReelMoment, type ReelNote, type ReelTemplate, type SpotlightSettings, type TransitionKind, type OrgTemplate, type OrgTemplateKind } from "@otsi-vie/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { api } from "@/lib/api";
import { renderedState } from "./spotlight";
import { getDictionary, useLocale, type Dictionary } from "@/lib/i18n";

/** start = where the clip itself starts; gap = the spacer before it (B.19, ADR-094), from start - gap */
export interface Placed { clip: ReelClip; start: number; dur: number; index: number; gap: number }

/** E1 (ADR-064): the shortest and longest clip an edge trim may leave (the API refuses clips over 60 s) */
export const MIN_CLIP_US = 500_000, MAX_CLIP_US = 60_000_000;
/** the in and out point after dragging one edge of a clip by d (source microseconds), kept inside 0 .. and MIN..MAX long */
export function trimEdge(c: { in_pts_us: number; out_pts_us: number }, edge: "in" | "out", d: number): { in_pts_us: number; out_pts_us: number } {
  if (edge === "in") {
    const lo = Math.max(0, c.out_pts_us - MAX_CLIP_US), hi = c.out_pts_us - MIN_CLIP_US;
    return { in_pts_us: Math.round(Math.min(hi, Math.max(lo, c.in_pts_us + d))), out_pts_us: c.out_pts_us };
  }
  return { in_pts_us: c.in_pts_us, out_pts_us: Math.round(Math.min(c.in_pts_us + MAX_CLIP_US, Math.max(c.in_pts_us + MIN_CLIP_US, c.out_pts_us + d))) };
}
/** I / P marks on a previewed Media Bin moment: the part to add (null when not marked or shorter than MIN_CLIP_US) */
export function markedRange(m: { in_pts_us: number; out_pts_us: number }, marks: { in?: number; out?: number }): { in_pts_us: number; out_pts_us: number } | null {
  if (marks.in === undefined && marks.out === undefined) return null;
  const a = Math.max(m.in_pts_us, marks.in ?? m.in_pts_us), b = Math.min(m.out_pts_us, marks.out ?? m.out_pts_us);
  return b - a >= MIN_CLIP_US ? { in_pts_us: Math.round(a), out_pts_us: Math.round(b) } : null;
}

/** clips back to back in reel time */
export function place(reel: Reel | null): { items: Placed[]; total: number } {
  const clips = [...(reel?.clips ?? [])].sort((a, b) => a.sequence_index - b.sequence_index);
  let t = 0;
  // E2 (ADR-065): a clip's length in the reel counts its speed effect (slow motion, freeze, ramp)
  const items = clips.map((clip, index) => { const gap = gapUs(clip), dur = clipOutputUs(clip); const p = { clip, start: t + gap, dur, index, gap }; t += gap + dur; return p; });
  return { items, total: t };
}

/** reel time -> the clip under it and the source timestamp; gap = the playhead is in the spacer before that clip (black) */
export function locate(items: Placed[], t: number): { p: Placed; src: number; gap?: boolean } | null {
  for (const p of items) {
    if (p.gap > 0 && t >= p.start - p.gap && t < p.start) return { p, src: p.clip.in_pts_us, gap: true };
    if (t >= p.start && t < p.start + p.dur) return { p, src: srcAt(p.clip, t - p.start).src };
  }
  const last = items[items.length - 1];
  return last && t >= last.start + last.dur ? { p: last, src: last.clip.out_pts_us } : null;
}

/** E5 (ADR-068): task layouts. Each sets the inspector tab, the Adjustments sections open and the Media Bin tab; kept per browser */
export type Layout = "EDIT" | "COLOUR" | "REVIEW";
export const LAYOUTS: Record<Layout, { label: string; insp: number; bin: number; open: string[]; hint: string }> = {
  EDIT: { label: "Edit", insp: 0, bin: 0, open: ["speed"], hint: "Edit: moments, clips and their timing" },
  COLOUR: { label: "Colour", insp: 2, bin: 0, open: ["look"], hint: "Colour: the reel's look, match to a reference frame" },
  REVIEW: { label: "Review", insp: 2, bin: 0, open: ["review", "draw"], hint: "Review: reviewers' comments on the timeline, drawings" },
};
const LAYOUT_KEY = "otsi-studio-layout";
/** E5: where a reviewer's comment falls on this timeline. Only when it was left on the reel's last good render and the edit still matches
 *  that file (else the times no longer line up): reel time = time in the file minus the intro and match card before the first clip. */
export function reviewTime(x: ReviewComment, reel: Pick<Reel, "last_good_render"> & Parameters<typeof renderedState>[0], total: number, d?: Dictionary): { at_us: number | null; why: string | null } {
  const dict = d ?? getDictionary("en");
  if (x.at_s === null) return { at_us: null, why: null };
  if (x.lead_s === null) return { at_us: null, why: dict.body.studio.reviewBeforeTimes };
  if (reel.last_good_render?.id !== x.render_id) return { at_us: null, why: dict.body.studio.reviewOlderRender };
  if (renderedState(reel, dict).reel.state !== "RENDERED") return { at_us: null, why: dict.body.studio.reviewReelChanged };
  const t = Math.round((x.at_s - x.lead_s) * 1e6);
  return t < 0 || t > total ? { at_us: null, why: dict.body.studio.reviewDuringIntro } : { at_us: t, why: null };
}
/** reel milliseconds into a clip: where the playhead is inside it (null when it is not on that clip) */
export function clipMs(items: Placed[], playhead: number, clipId: string): number | null {
  const p = items.find((x) => x.clip.id === clipId);
  return p && playhead >= p.start && playhead <= p.start + p.dur ? Math.round((playhead - p.start) / 1000) : null;
}

/** transition-kind code -> translated label (used in history labels; the code itself is never shown) */
export const transitionKindName = (k: TransitionKind, d: Dictionary) => k === "FADE" ? d.body.studio.fadeLabel : k === "DISSOLVE" ? d.body.studio.dissolveLabel : k === "ZOOM" ? d.body.studio.zoomLabel2 : d.body.studio.spinLabel;

export function useStudio(r: ReelState | null) {
  const { t: dict } = useLocale();
  const reel = r?.reel ?? null;
  const { items, total } = useMemo(() => place(reel), [reel]);
  const [playhead, setPlayhead] = useState(0);
  const [preview, setPreview] = useState<ReelMoment | null>(null);       // a Media Bin moment shown in the preview
  /** E1: I / P marks (source time) on the previewed moment; they go with the moment and are cleared when another one is shown */
  const [marks, setMarks] = useState<{ in?: number; out?: number }>({});
  useEffect(() => { setMarks({}); }, [preview?.in_pts_us, preview?.out_pts_us]);
  const base = reel ? `/v1/reels/${reel.id}` : "";
  const latest = useRef(reel);
  latest.current = reel;
  const [inspTab, setInspTab] = useState(0);                            // inspector tab: 0 clip, 1 events, 2 adjustments (E2)
  const [binTab, setBinTab] = useState(0);                              // Media Bin tab: 0 media, 1 graphics, 2 audio, 3 templates
  /** E5: the Adjustments sections that are open (lifted here so the ribbon and the layouts can open one) */
  const [adjOpen, setAdjOpen] = useState<Set<string>>(new Set(["speed"]));
  const openAdjust = (id: string) => { setInspTab(2); setAdjOpen((s) => new Set([...s, id])); };
  const [layout, setLayoutState] = useState<Layout>("EDIT");
  const setLayout = (l: Layout) => {
    const x = LAYOUTS[l];
    setLayoutState(l); setInspTab(x.insp); setBinTab(x.bin); setAdjOpen(new Set(x.open));
    try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* storage blocked: the layout just is not remembered */ }
  };
  useEffect(() => {
    let l: string | null = null;
    try { l = localStorage.getItem(LAYOUT_KEY); } catch { /* none */ }
    if (l && l in LAYOUTS && l !== "EDIT") setLayout(l as Layout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** E5: the telestration tool (drag on the preview to draw) and its colour */
  const [drawTool, setDrawTool] = useState<DrawKind | null>(null);
  const [drawColor, setDrawColor] = useState<DrawColor>("YELLOW");
  /** E5: the preview hands a small copy of the frame on screen (for match to reference) */
  const grab = useRef<(() => { rgba: Uint8ClampedArray; at_us: number } | null) | null>(null);

  /** E5: what reviewers wrote through share links of this reel's renders (GET /v1/reels/:id/review-comments) */
  const [reviews, setReviews] = useState<ReviewComment[]>([]);
  const loadReviews = useCallback(() => (reel ? api<ReviewComment[]>(`/v1/reels/${reel.id}/review-comments`).then(setReviews, () => setReviews([])) : Promise.resolve()), [reel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setReviews([]); void loadReviews(); }, [loadReviews]);

  /** the reel's notes; a marker is a note pinned at a source time (GET/POST /v1/reels/:id/notes, table comments.at_pts_us) */
  const [notes, setNotes] = useState<ReelNote[]>([]);
  const loadNotes = useCallback(() => (reel ? api<ReelNote[]>(`/v1/reels/${reel.id}/notes`).then(setNotes, () => setNotes([])) : Promise.resolve()), [reel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setNotes([]); void loadNotes(); }, [loadNotes]);
  const addNote = async (body: string, at_pts_us: number) => { await api(`${base}/notes`, { method: "POST", json: { body, at_pts_us } }); await loadNotes(); };

  /** the organization's logos, music and intro / outro videos, each with the state of its rights grant (GET /v1/brand-assets) */
  const [brand, setBrand] = useState<BrandAsset[] | null>(null);
  useEffect(() => { void api<BrandAsset[]>("/v1/brand-assets").then(setBrand, () => setBrand([])); }, []);

  /** change part of the reel's look (what the renderer draws); saved at once, undoable */
  const patchSettings = (patch: Partial<SpotlightSettings>) =>
    api<Reel>(`/v1/reels/${latest.current!.id}`, { method: "PATCH", json: { version: latest.current!.version, settings: patch } });

  /** one saved edit. B.1 (ADR-081): the server records it in the reel's history, where Undo / Redo take it back or put it back (the inverse
   *  each edit used to return for a list kept in the page is no longer needed; it is ignored) */
  const exec = useCallback((_label: string, doIt: () => Promise<unknown>, ok?: string) => {
    if (!r) return;
    r.run(async () => { await doIt(); }, ok);
  }, [r]);

  const add = (m0: { in_pts_us: number; out_pts_us: number; label: string | null }, origin0: "SUGGESTED" | "MANUAL" = "SUGGESTED") => {
    // the previewed moment with I / P marks: add the marked part; a person chose that range, so it is MANUAL
    const marked = preview && preview.in_pts_us === m0.in_pts_us && preview.out_pts_us === m0.out_pts_us ? markedRange(m0, marks) : null;
    const m = marked ? { ...m0, ...marked } : m0, origin = marked ? "MANUAL" as const : origin0;
    return exec(dict.body.studio.addClip, async () => {
      let added = await api<Reel>(`${base}/clips`, { method: "POST", json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, origin, label: m.label } });
      const id = () => newest(added, m.in_pts_us)?.id;
      return {
        undo: async () => { const c = id(); if (c) await api(`${base}/clips/${c}`, { method: "DELETE" }); },
        redo: async () => { added = await api<Reel>(`${base}/clips`, { method: "POST", json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, origin, label: m.label } }); },
      };
    }, dict.body.studio.clipAdded);
  };

  const remove = (c: ReelClip) => {
    const before = items.map((p) => p.clip.id);
    let cur = c.id;                                                     // undo re-creates the clip under a new id
    exec(dict.body.studio.deleteClip, async () => {
      await api(`${base}/clips/${cur}`, { method: "DELETE" });
      return {
        undo: async () => {
          const back = await api<Reel>(`${base}/clips`, { method: "POST", json: { in_pts_us: c.in_pts_us, out_pts_us: c.out_pts_us, origin: c.origin, label: c.label } });
          const old = cur;
          cur = newest(back, c.in_pts_us)?.id ?? cur;
          const present = new Set(back.clips.map((x) => x.id));
          const order = before.map((x) => (x === old ? cur : x)).filter((x) => present.has(x));
          for (const x of back.clips) if (!order.includes(x.id)) order.push(x.id);
          await api(`${base}/clips/order`, { method: "POST", json: { clip_ids: order } });       // back in its place
        },
        redo: () => api(`${base}/clips/${cur}`, { method: "DELETE" }),
      };
    }, dict.body.studio.clipRemoved);
  };

  const trim = (c: ReelClip, in_pts_us: number, out_pts_us: number) => exec(dict.body.studio.trimClipLabel, async () => {
    await api(`${base}/clips/${c.id}`, { method: "PATCH", json: { in_pts_us, out_pts_us } });
    return { undo: () => api(`${base}/clips/${c.id}`, { method: "PATCH", json: { in_pts_us: c.in_pts_us, out_pts_us: c.out_pts_us } }) };
  }, dict.body.studio.clipTrimmed);

  /** split the clip under the playhead into two clips at the playhead */
  const split = () => {
    const at = locate(items, playhead);
    if (!at || at.src <= at.p.clip.in_pts_us + 100_000 || at.src >= at.p.clip.out_pts_us - 100_000) return false;
    const c = at.p.clip, cutAt = Math.round(at.src);
    exec(dict.body.studio.splitClip, async () => {
      await api(`${base}/clips/${c.id}`, { method: "PATCH", json: { in_pts_us: c.in_pts_us, out_pts_us: cutAt } });
      const after = await api<Reel>(`${base}/clips`, { method: "POST", json: { in_pts_us: cutAt, out_pts_us: c.out_pts_us, origin: c.origin, label: c.label } });
      const tail = newest(after, cutAt);
      const order = place(after).items.map((p) => p.clip.id).filter((x) => x !== tail?.id);
      if (tail) order.splice(order.indexOf(c.id) + 1, 0, tail.id);
      await api(`${base}/clips/order`, { method: "POST", json: { clip_ids: order } });
      return {
        undo: async () => {
          if (tail) await api(`${base}/clips/${tail.id}`, { method: "DELETE" });
          await api(`${base}/clips/${c.id}`, { method: "PATCH", json: { in_pts_us: c.in_pts_us, out_pts_us: c.out_pts_us } });
        },
      };
    }, dict.body.studio.clipSplit);
    return true;
  };

  const reorder = (ids: string[]) => {
    const before = items.map((p) => p.clip.id);
    exec(dict.body.studio.reorderLabel, async () => {
      await api(`${base}/clips/order`, { method: "POST", json: { clip_ids: ids } });
      return { undo: () => api(`${base}/clips/order`, { method: "POST", json: { clip_ids: before } }) };
    }, dict.body.studio.orderSaved);
  };

  /** ADR-055: set or remove the transition into a clip (PATCH /v1/reels/:id/transitions); saved at once, undoable */
  const setTransition = (clipId: string, kind: TransitionKind | null, durationMs: number = TRANSITION_DEFAULT_MS) => {
    if (!reel) return;
    const was = reel.transitions.find((t) => t.clip_id === clipId) ?? null;
    const put = (k: TransitionKind | null, ms: number) => api<Reel>(`${base}/transitions`, { method: "PATCH", json: { clip_id: clipId, kind: k, duration_ms: ms } });
    const label = kind ? dict.body.studio.transitionKindLabel.replace("{a}", transitionKindName(kind, dict)).replace("{b}", (durationMs / 1000).toFixed(1)) : dict.body.studio.transitionRemoved;
    exec(label, async () => {
      latest.current = await put(kind, durationMs);
      return { undo: () => put(was?.kind ?? null, was?.duration_ms ?? TRANSITION_DEFAULT_MS), redo: () => put(kind, durationMs) };
    }, label);
  };

  /** ADR-055: the organization's saved reel looks (GET /v1/reel-templates) */
  const [templates, setTemplates] = useState<ReelTemplate[] | null>(null);
  const loadTemplates = useCallback(() => api<ReelTemplate[]>("/v1/reel-templates").then(setTemplates, () => setTemplates([])), []);
  useEffect(() => { void loadTemplates(); }, [loadTemplates]);
  /** E4 (ADR-067): withStructure also keeps the reel's clips as slots (kind of moment, length, speed effect) */
  const saveTemplate = (name: string, into?: ReelTemplate, withStructure = false) => {
    if (!reel || !r) return;
    r.run(async () => {
      if (into) await api(`/v1/reel-templates/${into.id}`, { method: "PUT", json: { reel_id: reel.id } });
      else await api("/v1/reel-templates", { method: "POST", json: { name, reel_id: reel.id, with_structure: withStructure } });
      await loadTemplates();
    }, into ? dict.body.studio.reelLookSavedInto.replace("{a}", into.structure ? dict.body.studio.lookClipSlots : dict.body.studio.lookWord).replace("{b}", into.name) : dict.body.studio.templateSaved.replace("{a}", name).replace("{b}", withStructure ? dict.body.studio.templateSavedWithSlots.replace("{a}", String(reel.clips.length)) : ""));
  };
  /** E4: the template's look and its slots filled with this reel's player's moments; the clips are replaced (asked first on the page),
   *  B.1 (ADR-081): the look and the filled clips are two entries of the reel's history, so Undo takes them back */
  const fillTemplate = (t: ReelTemplate, say: (m: string) => void) => {
    if (!reel || !r) return;
    r.run(async () => {
      const res = await api<{ reel: Reel; left_out: string[] }>(`${base}/apply-template`, { method: "POST", json: { template_id: t.id, version: latest.current!.version, clips: "FILL" } });
      latest.current = res.reel;
      if (res.left_out.length) say(dict.body.studio.templateFilled.replace("{a}", t.name).replace("{b}", res.left_out.join("; ")));
    }, dict.body.studio.templateFilledMoments.replace("{a}", t.name).replace("{b}", String(t.structure?.slots.length ?? 0)));
  };
  const deleteTemplate = (t: ReelTemplate) => {
    if (!r) return;
    r.run(async () => { await api(`/v1/reel-templates/${t.id}`, { method: "DELETE" }); await loadTemplates(); }, dict.body.studio.templateDeleted.replace("{a}", t.name));
  };
  const applyTemplate = (t: ReelTemplate, say: (m: string) => void) => {
    if (!reel) return;
    const before = { aspect: reel.aspect, settings: reel.settings };
    exec(dict.body.studio.templateLabel.replace("{a}", t.name), async () => {
      const res = await api<{ reel: Reel; left_out: string[] }>(`${base}/apply-template`, { method: "POST", json: { template_id: t.id, version: latest.current!.version } });
      latest.current = res.reel;
      if (res.left_out.length) say(dict.body.studio.templateApplied.replace("{a}", t.name).replace("{b}", res.left_out.join(", ")));
      return {
        undo: () => api<Reel>(`${base}`, { method: "PATCH", json: { version: latest.current!.version, aspect: before.aspect, settings: before.settings } }),
        redo: () => api(`${base}/apply-template`, { method: "POST", json: { template_id: t.id, version: latest.current!.version } }),
      };
    }, dict.body.studio.templateAppliedToReel.replace("{a}", t.name));
  };

  /** ADR-109 (v3 Phase C.10): organization templates for Spotlight, Style, and Branding */
  const [orgTemplates, setOrgTemplates] = useState<OrgTemplate[] | null>(null);
  const loadOrgTemplates = useCallback((kind?: OrgTemplateKind) => {
    const url = kind ? `/v1/templates?kind=${kind}` : "/v1/templates";
    return api<OrgTemplate[]>(url).then(setOrgTemplates, () => setOrgTemplates([]));
  }, []);
  useEffect(() => { void loadOrgTemplates(); }, [loadOrgTemplates]);

  const saveOrgTemplate = (name: string, kind: OrgTemplateKind, description = "") => {
    if (!reel || !r) return;
    return r.run(async () => {
      await api("/v1/templates", {
        method: "POST",
        json: { name, kind, description, reel_id: reel.id },
      });
      await loadOrgTemplates();
    }, dict.body.studio.templateSavedKind.replace("{a}", name).replace("{b}", kind));
  };

  const applyOrgTemplate = (t: OrgTemplate, applyKinds?: OrgTemplateKind[], say?: (m: string) => void) => {
    if (!reel) return;
    const before = { settings: reel.settings };
    return exec(dict.body.studio.templateLabel.replace("{a}", t.name), async () => {
      const res = await api<{ reel: Reel; applied_kinds: OrgTemplateKind[] }>(`${base}/apply-org-template`, {
        method: "POST",
        json: { template_id: t.id, version: latest.current!.version, apply_kinds: applyKinds },
      });
      latest.current = res.reel;
      say?.(dict.body.studio.templateAppliedKinds.replace("{a}", t.name).replace("{b}", res.applied_kinds.join(", ")));
      return {
        undo: () => api<Reel>(`${base}`, { method: "PATCH", json: { version: latest.current!.version, settings: before.settings } }),
        redo: () => api(`${base}/apply-org-template`, { method: "POST", json: { template_id: t.id, version: latest.current!.version, apply_kinds: applyKinds } }),
      };
    }, dict.body.studio.templateAppliedToReel.replace("{a}", t.name));
  };

  const deleteOrgTemplate = (t: OrgTemplate, say?: (m: string) => void) => {
    if (!r) return;
    return r.run(async () => {
      await api(`/v1/templates/${t.id}`, { method: "DELETE" });
      await loadOrgTemplates();
      say?.(dict.body.studio.templateDeleted.replace("{a}", t.name));
    }, dict.body.studio.templateDeleted.replace("{a}", t.name));
  };

  /** B.21 (ADR-096): one transition on every cut (none after a gap; a short clip what it can take), one change; Undo reverts it */
  const setAllTransitions = (kind: TransitionKind | null, ms: number = TRANSITION_DEFAULT_MS) =>
    exec(dict.body.studio.allTransitions, async () => { latest.current = await api<Reel>(`${base}/transitions/all`, { method: "POST", json: { kind, duration_ms: ms } }); },
      kind ? dict.body.studio.transitionOnEveryCut.replace("{a}", transitionKindName(kind, dict)) : dict.body.studio.everyTransitionRemoved);
  /** B.21: copies of a saved block's clips before position `at` (null = at the end), one change */
  const insertBlock = (blockId: string, at: number | null, name: string) =>
    exec(dict.body.studio.putInBlock, async () => { latest.current = await api<Reel>(`${base}/blocks/${blockId}/insert`, { method: "POST", json: { at } }); }, dict.body.studio.blockPutIn.replace("{a}", name));
  /** B.21: delete a marker / note (its author, or an owner / admin: the API decides) */
  const removeNote = async (id: string) => { await api(`${base}/notes/${id}`, { method: "DELETE" }); await loadNotes(); };

  /** E2 (ADR-065): a clip's speed effect; saved at once, undoable */
  const setEffect = (c: ReelClip, e: SetClipEffectRequest, label: string) => {
    if (!reel) return;
    const was = c.effect;
    const put = (x: SetClipEffectRequest) => api<Reel>(`${base}/clips/${c.id}/effect`, { method: "PATCH", json: x });
    exec(label, async () => {
      latest.current = await put(e);
      return { undo: () => put(was), redo: () => put(e) };
    }, label);
  };

  /** E5 (ADR-068): a clip's keyframed zoom and drawings; saved at once, undoable */
  const setFx = (c: ReelClip, fx: ClipFx, label: string) => {
    if (!reel) return;
    const was = c.fx;
    const put = (x: ClipFx) => api<Reel>(`${base}/clips/${c.id}/fx`, { method: "PATCH", json: x });
    exec(label, async () => {
      latest.current = await put(fx);
      return { undo: () => put(was), redo: () => put(fx) };
    }, label);
  };

  /** E3 (ADR-066): the reel's frame (16:9 / 9:16 / 1:1); saved at once, undoable */
  const setAspect = (a: Reel["aspect"]) => {
    if (!reel || reel.aspect === a) return;
    const was = reel.aspect;
    const put = (x: Reel["aspect"]) => api<Reel>(`${base}`, { method: "PATCH", json: { version: latest.current!.version, aspect: x } });
    exec(dict.body.studio.frameLabel.replace("{a}", a), async () => {
      latest.current = await put(a);
      return { undo: () => put(was), redo: () => put(a) };
    }, dict.body.studio.frameLabel.replace("{a}", a));
  };

  const setSettings = (patch: Partial<SpotlightSettings>, label: string) => {
    if (!reel) return;
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, reel.settings[k as keyof SpotlightSettings]])) as Partial<SpotlightSettings>;
    exec(label, async () => {
      latest.current = await patchSettings(patch);
      return { undo: () => patchSettings(before), redo: () => patchSettings(patch) };
    }, label);
  };

  /** B.1 (ADR-081): Undo / Redo are the reel's server history, the same as in Reel Builder (they survive a reload and other pages) */
  const undo = () => r?.undo();
  const redo = () => r?.redo();

  return {
    reel, items, total, playhead, setPlayhead, preview, setPreview, marks, setMarks, add, remove, trim, split, reorder, undo, redo, setSettings, setAspect, fillTemplate, setTransition, setEffect,
    setFx, adjOpen, setAdjOpen, openAdjust, layout, setLayout, drawTool, setDrawTool, drawColor, setDrawColor, grab, reviews, loadReviews,
    templates, saveTemplate, deleteTemplate, applyTemplate,
    orgTemplates, loadOrgTemplates, saveOrgTemplate, applyOrgTemplate, deleteOrgTemplate,
    notes, addNote, removeNote, setAllTransitions, insertBlock, brand, binTab, setBinTab, inspTab, setInspTab,
    canUndo: !!r?.history?.can_undo, canRedo: !!r?.history?.can_redo,
  };
}
export type Studio = ReturnType<typeof useStudio>;

/** the clip just added: the one starting at `inUs` with the highest sequence */
function newest(r: Reel, inUs: number): ReelClip | undefined {
  return [...r.clips].filter((c) => c.in_pts_us === inUs).sort((a, b) => b.sequence_index - a.sequence_index)[0];
}
