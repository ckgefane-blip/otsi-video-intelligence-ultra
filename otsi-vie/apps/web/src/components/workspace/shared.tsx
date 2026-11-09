"use client";
/**
 * Page 04 Analysis Workspace: what the sections share (approved reference 04_ANALYSIS_WORKSPACE, 2560 x 1440 composition).
 *
 * The video, run, tracks, playhead and selection come from the Analysis workspace hook (ADR-035); the linked match from GET /v1/matches/:id;
 * the team of a track from the run's kit colour groups a PERSON assigned (colour alone proves nothing, ADR-031). Nothing is invented:
 * what the engine has not measured shows "—".
 */
import type { Match, RunTeams, TrackSummary } from "@otsi-vie/contracts";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { u } from "@/components/stage/DesignStage";
import type { TeamCount } from "@/components/tactics/TacticsHeader";
import { apiBlob } from "@/lib/api";

export interface Shared {
  ws: AnalysisWorkspaceState | null;
  match: Match | null;
  /** after a person changed the match (its final score) */
  setMatch(m: Match): void;
  kits: RunTeams | null;
  /** "all" or a club id of the linked match */
  team: string;
  setTeam(t: string): void;
  teams: [TeamCount | null, TeamCount | null];
  /** kit groups of the chosen team (null = everyone) */
  teamGroups: Set<number> | null;
  onPick(): void;
}

export const PEOPLE = new Set(["PERSON", "PLAYER", "GOALKEEPER", "REFEREE"]);
export const isPerson = (t: TrackSummary) => t.class_name !== "BALL" && t.class_name !== "OTHER";

/** the club a person assigned to the track's kit colour group, if any */
export function assignmentOf(kits: RunTeams | null, t: TrackSummary) {
  if (t.kit_group === null || t.kit_group === undefined) return null;
  return kits?.groups.find((g) => g.kit_group === t.kit_group)?.assignment ?? null;
}

export const clock = (us: number | null | undefined) => {
  if (us === null || us === undefined) return "—";
  const s = Math.floor(us / 1e6);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export const plain: CSSProperties = { position: "absolute", padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" };

/** a click area in design coordinates; `reason` when it cannot be used (shown as its tooltip) */
export function Hit({ x, y, w, h, label, onClick, reason, pressed, children, style }: {
  x: number; y: number; w: number; h: number; label: string; onClick?: () => void; reason?: string | undefined; pressed?: boolean;
  children?: ReactNode; style?: CSSProperties;
}) {
  const off = !onClick;
  return (
    <button type="button" aria-label={label} aria-pressed={pressed} aria-disabled={off} title={off ? reason : undefined}
      onClick={onClick} style={{ ...plain, left: u(x), top: u(y - 101), width: u(w), height: u(h), cursor: off ? "not-allowed" : "pointer", ...style }}>
      {children}
    </button>
  );
}

export function Thumb({ track, w, h, style }: { track: TrackSummary; w: number; h: number; style?: CSSProperties }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!track.has_thumbnail) return;
    let live = true, url: string | null = null;
    void apiBlob(`/v1/tracks/${track.track_id}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [track.track_id, track.has_thumbnail]);
  return <div aria-hidden style={{ width: u(w), height: u(h), background: src ? `center / cover no-repeat url(${src}), #2a4a78` : "linear-gradient(135deg,#5a6f8c,#2a4a78)", ...style }} />;
}
