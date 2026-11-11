"use client";
/**
 * Page 06 Reel Builder / Spotlight Composer on the approved composition (corrected reference 06_REEL_BUILDER). With a reel id it works on
 * that reel through the Reel Builder context (clips, moments, spotlight look, render); without one it shows the reference's empty state
 * and the organization's reels to open. The page keeps a draft of the name and spotlight look that Save Project / Generate Reel send.
 */
import type { Reel, SpotlightSettings } from "@otsi-vie/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReelBuilder, useReel, type ReelState } from "@/components/reels/ReelBuilder";
import { DesignStage } from "@/components/stage/DesignStage";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { typing } from "@/lib/keymap";
import { Inspector } from "./Inspector";
import { ProfileIntroDialog } from "@/components/reels/PlayerProfileIntro";
import { LeftColumn } from "./LeftColumn";
import { Moments, Timeline } from "./MomentsTimeline";
import { PreviewPanel } from "./PreviewPanel";
import { StageProvider, useDirty, type Stage } from "./shared";
import { T, u } from "@/components/stage/DesignStage";

const TAB_OF: Record<string, number> = { "p06-spotlight": 0, "p06-overlays": 1, "p06-branding": 2 };

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
  const value: Stage = useMemo(() => ({ r, draft, setDraft, name, setName, dirty, save, focus, jump, tab, mode, setMode, openProfileIntro }),
    [r, draft, name, dirty, save, focus, jump, tab, mode, openProfileIntro]);   // setDraft / setName / setMode are the stable setters
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
    <DesignStage page="reels" background="#000913">
      <StageProvider value={value}>
        <LeftColumn />
        <PreviewPanel />
        <Moments />
        <Timeline />
        <Inspector />
        {reel?.player && <ProfileIntroDialog playerId={reel.player.player_id} reelId={reel.id} open={introOpen} onContinue={closeIntro} onClose={closeIntro} />}
        {/* owner 2026-11-02: messages sit in the strip above the preview, never on the picture */}
        {msg && <T x={470} y={113} size={17} color={msg.ok ? "#3ee6a8" : "#ff8a8a"} style={{ maxWidth: u(1500) }} as="p">{msg.text}</T>}
        {reel && dirty && <T x={2030} y={113} size={16} color="#f5b82e" align="right">{dict.body.reels.unsavedChanges}</T>}
      </StageProvider>
    </DesignStage>
  );
}

function WithReel() {
  return <Sections r={useReel()} />;
}

export function ReelStage({ reelId }: { reelId?: string }) {
  if (!reelId) return <Sections r={null} />;
  return <ReelBuilder key={reelId} reelId={reelId}><WithReel /></ReelBuilder>;
}
