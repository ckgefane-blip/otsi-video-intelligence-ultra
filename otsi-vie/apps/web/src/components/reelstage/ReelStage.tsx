"use client";
/**
 * Page 06 Reel Builder / Spotlight Composer. With a reel id it works on
 * that reel through the Reel Builder context (clips, moments, spotlight look, render); without one it shows the reference's empty state
 * and the organization's reels to open. The page keeps a draft of the name and spotlight look that Save Project / Generate Reel send.
 */
import type { Reel, SpotlightSettings } from "@otsi-vie/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReelBuilder, useReel, type ReelState } from "@/components/reels/ReelBuilder";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { typing } from "@/lib/keymap";
import { Inspector } from "./Inspector";
import { ProfileIntroDialog } from "@/components/reels/PlayerProfileIntro";
import { LeftColumn } from "./LeftColumn";
import { Moments, Timeline } from "./MomentsTimeline";
import { PreviewPanel } from "./PreviewPanel";
import { StageProvider, useDirty, type ReelLengthS, type Stage } from "./shared";

const TAB_OF: Record<string, number> = { "p06-spotlight": 0, "p06-overlays": 1, "p06-branding": 2 };
/** Best Moment Rule v2.1: a single-match reel's target length is remembered per reel in this browser (like the worked step) */
const LENGTH_KEY = (id: string) => `otsi.reel-length.${id}`;

function Sections({ r }: { r: ReelState | null }) {
  const { t: dict } = useLocale();
  const reel = r?.reel ?? null;
  const [draft, setDraft] = useState<SpotlightSettings | null>(null);
  const [name, setName] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [mode, setMode] = useState<"clip" | "render">("clip");
  /** ADR-130: the Player Profile Intro is the first step of the flow — it opens on its own the first time a reel is opened
   *  (once per browser session per reel), and "Continue to Reel" advances past it to the reel steps */
  const [introOpen, setIntroOpen] = useState(false);
  const introSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!reel?.player || reel.settings.profile_intro === false) return;
    if (introSeen.current === reel.id) return;
    introSeen.current = reel.id;
    let seen = false;
    try { seen = sessionStorage.getItem(`otsi.profile-intro.seen.${reel.id}`) === "1"; } catch { /* not remembered */ }
    if (!seen) setIntroOpen(true);
  }, [reel?.id, reel?.player?.player_id, reel?.settings.profile_intro]);  // eslint-disable-line react-hooks/exhaustive-deps
  const closeIntro = useCallback(() => {
    setIntroOpen(false);
    try { if (reel) sessionStorage.setItem(`otsi.profile-intro.seen.${reel.id}`, "1"); } catch { /* not remembered */ }
  }, [reel]);
  const openProfileIntro = useCallback(() => setIntroOpen(true), []);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = reel?.version, reelId = reel?.id;
  useEffect(() => { if (reel) { setDraft(reel.settings); setName(reel.name); } else { setDraft(null); setName(""); } }, [reelId, version]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMode("clip"); }, [reelId]);
  const dirty = useDirty(reel, draft, name);
  // Best Moment Rule v2.1 target length: a cross-match reel's was fixed when it was made; a single-match reel's is chosen here
  const lengthFixed = reel?.source === "ALL_MATCHES" && !!reel.cross_match_length_s;
  const [lengthSState, setLengthSState] = useState<ReelLengthS>(180);
  useEffect(() => {
    if (!reel || lengthFixed) return;
    let n: ReelLengthS = 180;
    try { const v = Number(localStorage.getItem(LENGTH_KEY(reel.id))); if (v === 90 || v === 180 || v === 300) n = v; } catch { /* default */ }
    setLengthSState(n);
  }, [reel?.id, lengthFixed]);  // eslint-disable-line react-hooks/exhaustive-deps
  const lengthS: ReelLengthS = lengthFixed ? (reel!.cross_match_length_s as ReelLengthS) : lengthSState;
  const setLengthS = useCallback((n: ReelLengthS) => {
    setLengthSState(n);
    if (reel) { try { localStorage.setItem(LENGTH_KEY(reel.id), String(n)); } catch { /* not remembered */ } }
  }, [reel]);
  const jump = useCallback((id: string) => {
    if (id in TAB_OF) setTab(TAB_OF[id]!);
    setFocus(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocus((f) => (f === id ? null : f)), 1600);
  }, []);
  const save = useCallback(async (): Promise<Reel | null> => {
    if (!reel || !draft) return null;
    setNote(null);
    try {
      const body: Record<string, unknown> = { version: reel.version, settings: draft };
      if (name.trim() && name.trim() !== reel.name) body.name = name.trim();
      const saved = await api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: body });
      await r?.reload();
      setNote({ ok: true, text: dict.body.reels.projectSaved });
      return saved;
    } catch (x) {
      setNote({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.reels.notSaved });
      return null;
    }
  }, [reel, draft, name, r]);
  const value: Stage = useMemo(() => ({ r, draft, setDraft, name, setName, dirty, save, focus, jump, tab, mode, setMode, openProfileIntro, lengthS, setLengthS, lengthFixed }),
    [r, draft, name, dirty, save, focus, jump, tab, mode, openProfileIntro, lengthS, setLengthS, lengthFixed]);   // setDraft / setName / setMode are the stable setters
  useEffect(() => { if (r?.msg) setNote(null); }, [r?.msg]);   // a newer message replaces "Project saved."
  // the same undo / redo keys as Clip Studio (lib/keymap.ts, Reels scope): they only live on this page, never while typing,
  // and only when there is something to undo or redo, so no request is made for a no-op
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === "z" || k === "y")) {
        e.preventDefault();
        if (k === "y" || e.shiftKey) { if (r?.history?.can_redo) r.redo(); } else if (r?.history?.can_undo) r.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [r]);
  const msg = note ?? r?.msg ?? (r?.error ? { ok: false, text: r.error } : null);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <StageProvider value={value}>
        {/* owner 2026-11-02: messages sit in the strip above the preview, never on the picture */}
        {(msg || (reel && dirty)) && (
          <div className="flex flex-wrap items-center gap-3" role="status">
            {msg && <p className={`t-body ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
            {reel && dirty && <p className="text-xs ml-auto text-amber-400">{dict.body.reels.unsavedChanges}</p>}
          </div>
        )}
        <div className="grid flex-1 grid-cols-1 gap-3 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
          <LeftColumn />
          <div className="flex min-w-0 flex-col gap-3">
            <PreviewPanel />
            <Moments />
            <Timeline />
          </div>
          <Inspector />
        </div>
        {reel?.player && <ProfileIntroDialog playerId={reel.player.player_id} reelId={reel.id} open={introOpen} onContinue={closeIntro} onClose={closeIntro} />}
      </StageProvider>
    </div>
  );
}

function WithReel() {
  return <Sections r={useReel()} />;
}

export function ReelStage({ reelId }: { reelId?: string }) {
  if (!reelId) return <Sections r={null} />;
  return <ReelBuilder key={reelId} reelId={reelId}><WithReel /></ReelBuilder>;
}
