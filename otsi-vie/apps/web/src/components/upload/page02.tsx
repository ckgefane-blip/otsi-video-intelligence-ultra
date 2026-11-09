"use client";
/**
 * Page 02 Upload & Ingest: the page controller and the reference's own drawing pieces (02_UPLOAD_INGEST: SEL, TG, CREST, TH).
 *
 * On top of the Upload data layer (useUpload: projects, resumable uploads, link import, videos with measured facts) this adds what the
 * approved composition needs, all real:
 *   - the viewer's defaults for the next upload (kept in this browser): Stabilize Video (= the High accuracy analysis profile, which
 *     stabilises) and Send to Analysis. Each upload or link import SENDS them; the server saves them with the video and starts the analysis
 *     itself once the video is verified (jobs.auto_analysis), so nothing here needs the page to stay open
 *   - the match chosen in Match Context: linked to the selected video at once, or to the next upload as soon as it is created
 *   - the selected video's analysis runs (GET /v1/videos/:id/analysis-runs), followed while one is running
 *   - the server's real upload limit (GET /v1/upload-limits)
 *   - one status line: every control either acts or says why it cannot
 */
import type { AnalysisRun, Match, UploadLimits } from "@otsi-vie/contracts";
import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { B, Ic, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { api, ApiProblem } from "@/lib/api";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type UploadPrefs } from "@/lib/uploadPrefs";
import { useUpload } from "./UploadWorkspace";

/* ------------------------------------------------------------------ preferences */
export type { UploadPrefs };

interface Page02 {
  prefs: UploadPrefs; setPrefs(p: UploadPrefs): void;
  note: { text: string; bad: boolean } | null; say(text: string, bad?: boolean): void;
  /** the last removed verified video, for a few seconds: "Undo" restores it */
  undo: { id: string; title: string } | null; offerUndo(v: { id: string; title: string } | null): void;
  matches: Match[] | null; reloadMatches(): Promise<void>;
  /** the match chosen in Match Context, applied to the selected video or the next upload */
  matchId: string | null; chooseMatch(id: string | null): void;
  runs: AnalysisRun[] | null; reloadRuns(): Promise<void>;
  limits: UploadLimits | null;
  projectDialog: boolean; setProjectDialog(o: boolean): void;
  /** the left panel's tab (Filters, Overlays, AI Tools); A.10: the drop zone's "Analysis profile · Change" opens AI Tools */
  optionsTab: number; setOptionsTab(i: number): void;
}
const Ctx = createContext<Page02 | null>(null);
export function usePage02(): Page02 {
  const c = useContext(Ctx);
  if (!c) throw new Error("outside Page02");
  return c;
}

export function Page02Controller({ children }: { children: ReactNode }) {
  const up = useUpload();
  const [prefs, setPrefsState] = useState<UploadPrefs>(DEFAULT_PREFS);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [runs, setRuns] = useState<AnalysisRun[] | null>(null);
  const [limits, setLimits] = useState<UploadLimits | null>(null);
  const [projectDialog, setProjectDialog] = useState(false);
  const [optionsTab, setOptionsTab] = useState(0);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerUndo = useCallback((v: { id: string; title: string } | null) => {
    setUndo(v);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (v) undoTimer.current = setTimeout(() => setUndo(null), 15000);
  }, []);
  const say = useCallback((text: string, bad = false) => {
    setNote({ text, bad });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), bad ? 12000 : 5000);          // a refusal stays long enough to be read
  }, []);

  useEffect(() => {
    setPrefsState(loadPrefs());
    void api<UploadLimits>("/v1/upload-limits").then(setLimits, () => setLimits(null));
  }, []);
  const setPrefs = (p: UploadPrefs) => { setPrefsState(p); savePrefs(p); };

  const reloadMatches = useCallback(async () => { try { setMatches(await api<Match[]>("/v1/matches")); } catch { setMatches([]); } }, []);
  useEffect(() => { void reloadMatches(); }, [reloadMatches]);

  const link = useCallback(async (videoId: string, mId: string) => {
    try {
      await api(`/v1/videos/${videoId}/match`, { method: "POST", json: { match_id: mId } });
      await up.reloadVideos();
      say("Linked to the match");
    } catch (x) { say(x instanceof ApiProblem ? x.message : "The video could not be linked to the match", true); }
  }, [up, say]);

  const chooseMatch = (id: string | null) => {
    setMatchId(id);
    if (!id) return;
    if (up.selected) void link(up.selected.id, id);
    else say("This match will be linked to your next upload");
  };

  // the selected video's analysis runs, followed every 2 s while one is queued or running
  const sel = up.selected?.id ?? null;
  const loadRuns = useCallback(async () => {
    if (!sel) { setRuns(null); return; }
    try { setRuns(await api<AnalysisRun[]>(`/v1/videos/${sel}/analysis-runs`)); } catch { setRuns([]); }
  }, [sel]);
  useEffect(() => { setRuns(null); void loadRuns(); }, [loadRuns]);
  const opt = up.selected?.ingest_options;
  // the server starts the automatic analysis when the video is verified: keep looking until it has decided
  const awaitingAuto = !!up.selected && !!opt?.send_to_analysis && !opt.analysis && up.selected.state !== "FAILED" && up.selected.state !== "QUARANTINED";
  const active = !!runs?.some((r) => r.status === "QUEUED" || r.status === "RUNNING") || awaitingAuto;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void loadRuns(), 2000);
    return () => clearInterval(t);
  }, [active, loadRuns]);

  // uploads started on this page: link the chosen match as soon as the video exists (the analysis is started by the server)
  const linked = useRef(new Set<string>());
  useEffect(() => {
    for (const t of up.transfers) {
      if (!t.videoId || !matchId || linked.current.has(t.videoId)) continue;
      linked.current.add(t.videoId);
      void link(t.videoId, matchId);
    }
  }, [up.transfers, matchId, link]);
  // tell the person once, when the server has decided about the automatic analysis of the selected video
  const told = useRef(new Set<string>());
  useEffect(() => {
    const v = up.selected, a = v?.ingest_options?.analysis;
    if (!v || !a || told.current.has(v.id)) return;
    told.current.add(v.id);
    if (a.outcome === "STARTED") { say(`Analysis started by the server for ${v.title ?? v.original_filename ?? "this video"}`); void loadRuns(); }
    else say(a.detail ?? "The automatic analysis was not started");
  }, [up.selected, say, loadRuns]);

  // ?video= (a three-dots menu's "Set score and match details") chooses that video once; otherwise the pipeline and the controls
  // follow the video that is busy: with nothing chosen, choose the one that is moving (else the newest)
  const wanted = useSearchParams().get("video");
  const took = useRef(false);
  useEffect(() => {
    if (!up.videos?.length) return;
    if (wanted && !took.current && up.videos.some((v) => v.id === wanted)) { took.current = true; if (up.selected?.id !== wanted) up.select(wanted); return; }
    if (up.selected) return;
    const moving = up.videos.find((v) => v.state === "PENDING" || v.state === "VALIDATING" || v.job?.state === "RUNNING" || v.job?.state === "QUEUED"
      || v.analysis?.status === "RUNNING" || v.analysis?.status === "QUEUED");
    up.select((moving ?? up.videos[0]!).id);
  }, [up.videos, up.selected, up, wanted]);

  // the data layer's own errors (no project chosen, upload refused) reach the same status line
  useEffect(() => { if (up.error) say(up.error, true); }, [up.error, say]);

  return (
    <Ctx.Provider value={{ prefs, setPrefs, note, say, undo, offerUndo, matches, reloadMatches, matchId, chooseMatch, runs, reloadRuns: loadRuns, limits, projectDialog, setProjectDialog, optionsTab, setOptionsTab }}>
      {children}
    </Ctx.Provider>
  );
}

/* ------------------------------------------------------------------ the reference's drawing pieces */
export const IN: CSSProperties = { background: "#041022", borderRadius: u(8), ["--bc" as string]: "#17406f" };

/** the reference's select (SEL): a .in box with the value, a chevron and a real native select (options with a reason are greyed) */
export function Sel({ x, y, w, h, label, value, placeholder, options, onChange }: {
  x: number; y: number; w: number; h: number; label: string; value: string; placeholder: string;
  options: ([string, string] | [string, string, string])[]; onChange: (v: string) => void;
}) {
  const shown = options.find((o) => o[0] === value)?.[1];
  return (
    <div className={`${s.a} ${s.framed}`} style={{ left: u(x), top: u(y - 101), width: u(w), height: u(h), ...IN }}>
      <T o={[x, y]} x={x + 16} y={y + h / 2} size={20} color={shown ? "#e3eefb" : "#8ea3bf"} as="span"
        style={{ maxWidth: u(w - 56), overflow: "hidden", textOverflow: "ellipsis" }}>{shown ?? placeholder}</T>
      <Ic o={[x, y]} x={x + w - 22} y={y + h / 2} k="chev" size={18} />
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
        style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}>
        <option value="">{placeholder}</option>
        {options.map(([v, l, why]) => <option key={v} value={v} disabled={!!why}>{why ? `${l} — ${why}` : l}</option>)}
      </select>
    </div>
  );
}

/**
 * the reference's toggle row (icon, label, TG switch). `kind`: live (the engine carries it out), always (every analysis does it: locked on,
 * a click says so), or not-built (a REQUEST the engine cannot perform yet: it switches freely, is saved with the upload, and shows
 * "saved · not performed yet" while on, so it never claims a step that did not happen)
 */
export function ToggleRow({ x = 22, y, icon, label, on, kind, why, onToggle, say }: {
  x?: number; y: number; icon: string; label: string; on: boolean; kind: "live" | "always" | "not-built"; why: string;
  onToggle?: () => void; say: (t: string) => void;
}) {
  const shownOn = kind === "always" ? true : on;
  const click = () => {
    if (kind === "always" || !onToggle) return say(`${label}: ${why}`);
    onToggle();
    say(`${label} ${on ? "off" : "on"}: ${why}`);
  };
  return (
    <button type="button" role="switch" aria-checked={shownOn} aria-disabled={kind === "always" || undefined} title={why} aria-label={`${label}: ${why}`}
      onClick={click} className="absolute"
      style={{ left: u(x), top: u(y - 20 - 101), width: u(383), height: u(40), padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" }}>
      <Ic o={[x, y - 20]} x={61} y={y} k={icon} size={28} color="#cfe0f5" />
      <T o={[x, y - 20]} x={97} y={kind === "not-built" && on ? y - 5 : y} size={20} color="#d6e4f7" as="span">{label}</T>
      {kind === "not-built" && on && <T o={[x, y - 20]} x={97} y={y + 14} size={13} color="#ffc66d" as="span">saved · not performed yet</T>}
      <B o={[x, y - 20]} x={337} y={y - 14} w={48} h={28} style={{ background: shownOn ? "#0481f9" : "#26364d", borderRadius: u(14), opacity: kind === "always" ? 0.7 : 1 }} />
      <B o={[x, y - 20]} x={337 + (shownOn ? 23 : 3)} y={y - 11} w={22} h={22} style={{ background: "#fff", borderRadius: "50%" }} />
      {kind === "always" && <Ic o={[x, y - 20]} x={326} y={y} k="chk" size={14} color="#3ee6a8" />}
    </button>
  );
}

export const crest = { background: "radial-gradient(circle,#f2c56b 0,#6cc4ff 50%,#fff 56%)", borderRadius: "50%" };
/** the reference's drawn thumbnail (TH), used when a video has no thumbnail yet */
export const pitchThumb = (a: number) => `radial-gradient(ellipse at 40% 70%,#6fb8ee 0,#2a6fb8 12%,transparent 13%),linear-gradient(180deg,#27487a,#2d7a3a ${a}%,#1d5a28)`;
export function mmss(us: number | null | undefined): string {
  if (!us) return "—";
  const t = Math.round(us / 1e6);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** the page's one status line (under the title): what just happened, or why a control could not act */
export function StatusLine() {
  const { note, undo, offerUndo, say } = usePage02();
  const up = useUpload();
  const restore = () => {
    if (!undo) return;
    const v = undo; offerUndo(null);
    void api(`/v1/library/video/${v.id}/restore`, { method: "POST" }).then(
      async () => { await up.reloadVideos(); up.select(v.id); say(`Restored ${v.title}`); },
      (x) => say(x instanceof ApiProblem ? x.message : "It could not be restored", true));
  };
  return (
    <>
      {note ? (
        <T x={513} y={224} size={16} color={note.bad ? "#ff9aa8" : "#ffc66d"} style={{ maxWidth: u(1000), overflow: "hidden", textOverflow: "ellipsis" }}>
          <span role="status">{note.text}</span>
        </T>
      ) : null}
      {undo ? (
        <button type="button" onClick={restore} aria-label={`Undo: restore ${undo.title}`} className="absolute"
          style={{ left: u(1530), top: u(224 - 101 - 14), height: u(28), padding: `0 ${u(14)}`, borderRadius: u(14), border: `${u(1.5)} solid #1e90ff`, background: "#04264a", color: "#cfe8ff",
            fontSize: u(16), fontFamily: "inherit", cursor: "pointer", zIndex: 6 }}>Undo remove</button>
      ) : null}
    </>
  );
}
