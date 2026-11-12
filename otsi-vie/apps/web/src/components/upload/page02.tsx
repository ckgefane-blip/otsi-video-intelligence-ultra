"use client";
/**
 * Page 02 Upload & Ingest: the page controller, on the Desktop UI flow layout.
 *
 * On top of the Upload data layer (useUpload: projects, resumable uploads, link import, videos with measured facts) this adds what the
 * page needs, all real:
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
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Locale } from "@/lib/i18n";
import { DEFAULT_PREFS, loadPrefs, savePrefs, type UploadPrefs } from "@/lib/uploadPrefs";
import { useUpload } from "./UploadWorkspace";

/** BCP 47 tag for a locale, for the dates and numbers shown beside translated words. */
export const DATE_TAG: Record<Locale, string> = { en: "en-GB", ru: "ru-RU", es: "es-ES", de: "de-DE", fr: "fr-FR", pt: "pt-BR" };

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
  /** the left panel's tab (Filters, Overlays, AI Tools); the drop zone's "Analysis profile · Change" opens AI Tools */
  optionsTab: number; setOptionsTab(i: number): void;
}
const Ctx = createContext<Page02 | null>(null);
export function usePage02(): Page02 {
  const c = useContext(Ctx);
  if (!c) throw new Error("outside Page02");
  return c;
}

export function Page02Controller({ children }: { children: ReactNode }) {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
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
      say(d.linkedToMatch);
    } catch (x) { say(x instanceof ApiProblem ? x.message : d.couldNotLinkMatch, true); }
  }, [up, say, d]);

  const chooseMatch = (id: string | null) => {
    setMatchId(id);
    if (!id) return;
    if (up.selected) void link(up.selected.id, id);
    else say(d.matchLinkedNextUpload);
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
    if (a.outcome === "STARTED") { say(d.analysisStartedServer.replace("{name}", v.title ?? v.original_filename ?? d.thisVideo)); void loadRuns(); }
    else say(a.detail ?? d.autoAnalysisNotStarted);
  }, [up.selected, say, loadRuns, d]);

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

export function mmss(us: number | null | undefined): string {
  if (!us) return "—";
  const t = Math.round(us / 1e6);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** the page's one status line (under the title): what just happened, or why a control could not act */
export function StatusLine() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { note, undo, offerUndo, say } = usePage02();
  const up = useUpload();
  const restore = () => {
    if (!undo) return;
    const v = undo; offerUndo(null);
    void api(`/v1/library/video/${v.id}/restore`, { method: "POST" }).then(
      async () => { await up.reloadVideos(); up.select(v.id); say(d.restored.replace("{title}", v.title)); },
      (x) => say(x instanceof ApiProblem ? x.message : d.couldNotRestore, true));
  };
  if (!note && !undo) return null;
  return (
    <div className="flex flex-wrap items-center gap-3" role="status">
      {note && <p className={`text-sm ${note.bad ? "text-danger" : "text-amber"}`}>{note.text}</p>}
      {undo && (
        <button type="button" onClick={restore} aria-label={d.undoRestoreAria.replace("{title}", undo.title)} className="vie-btn vie-btn-sm">
          {d.undoRemove}
        </button>
      )}
    </div>
  );
}
