"use client";
/**
 * SOT rebuild page 14 (alphabetical), Library: the left panel — the
 * selected match, the eight visual overlays, the team filter and the
 * time range. The SOT shows these four sections flat (no tabs, no
 * Browse switcher); the old LeftPanel's Events and AI Tools tabs are
 * not in the SOT and are not here (the Analysis workspace and the
 * Processing page hold them).
 *
 * The match button shows the selected match (GET /v1/matches,
 * via useLibrary) and opens the match menu to switch it. The link row says whether the selected video is
 * linked to a match record: a video with no match shows "Not linked
 * to a match" and a Link video button (to the upload page, which links
 * it); a match — or a linked video — shows its match. Tracking is the
 * confirmed-player count and the event count of the selected video
 * (GET /v1/videos/:id/events); "Match time: confirmed" shows when the
 * video's halves are confirmed (GET /v1/videos/:id/match-periods).
 */
import { SidePanel } from "@/components/shell/SidePanel";
import type { Match, MatchEvents, MatchPeriods } from "@otsi-vie/contracts";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useOverlayPrefs, type OverlayPrefs } from "@/lib/overlayPrefs";
import type { TeamSide } from "./LeftPanel";
import type { TimeRange } from "./LeftPanel";

const OVERLAY_ROWS: { key: keyof OverlayPrefs; label: "ovBoxes" | "ovIds" | "ovTracks" | "ovShapes" | "ovBall" | "ovPasses" | "ovHeat" | "ovOffside" }[] = [
  { key: "boxes", label: "ovBoxes" }, { key: "ids", label: "ovIds" }, { key: "trails", label: "ovTracks" }, { key: "shapes", label: "ovShapes" },
  { key: "ball", label: "ovBall" }, { key: "passes", label: "ovPasses" }, { key: "heat", label: "ovHeat" }, { key: "offside", label: "ovOffside" },
];

const club = (m: Match, side: "home" | "away") => m[side]?.short_name ?? m[side]?.name ?? null;
const matchTitle = (m: Match) => `${club(m, "home") ?? "—"} vs ${club(m, "away") ?? "—"}`;

export function LibraryLeft({ match, matches, videoId, onMatch, team, setTeam, range, setRange, say }: {
  match: Match | null; matches: Match[]; videoId: string | null; onMatch: (m: Match | null) => void;
  team: TeamSide; setTeam: (t: TeamSide) => void;
  range: TimeRange; setRange: (r: TimeRange) => void;
  say: (t: string) => void;
}) {
  const { t: dict } = useLocale();
  const d = dict.body.library;
  const [prefs, savePrefs] = useOverlayPrefs();
  const [periods, setPeriods] = useState<MatchPeriods | null>(null);
  useEffect(() => { setPeriods(null); if (videoId) void api<MatchPeriods>(`/v1/videos/${videoId}/match-periods`).then(setPeriods, () => setPeriods(null)); }, [videoId]);
  const [ev, setEv] = useState<MatchEvents | null | undefined>(undefined);
  useEffect(() => { setEv(undefined); if (videoId) void api<MatchEvents>(`/v1/videos/${videoId}/events`).then(setEv, () => setEv(null)); }, [videoId]);
  const total = ev && ev.state === "READY" ? (ev.passes?.length ?? 0) + (ev.changes?.length ?? 0) + (ev.shots?.length ?? 0) + (ev.pressures?.length ?? 0) + (ev.set_pieces?.length ?? 0) + (ev.goals?.length ?? 0) : null;
  // confirmed players in this video: distinct non-null player ids across the events (a null id is an unconfirmed track)
  const confirmedCount = ev && ev.state === "READY" ? new Set([
    ...(ev.passes ?? []).flatMap((p) => [p.from_player_id, p.to_player_id]),
    ...(ev.changes ?? []).map((c) => c.won_player_id),
    ...(ev.shots ?? []).map((s) => s.player_id),
    ...(ev.pressures ?? []).map((p) => p.presser_player_id),
    ...(ev.set_pieces ?? []).map((s) => s.player_id),
    ...(ev.goals ?? []).map((g) => g.player_id),
  ].filter((id): id is string => !!id)).size : null;
  const confirmed = periods?.state === "CONFIRMED";
  const teamRows: [TeamSide, string][] = [["all", d.teamAllPlayers], ["home", d.homeTeam], ["away", d.awayTeam]];
  const rangeRows: [TimeRange, string][] = [["full", d.rangeFull], ["h1", d.rangeH1], ["h2", d.rangeH2], ["custom", d.rangeCustom]];
  const pickRange = (r: TimeRange) => {
    if (r !== "full" && !videoId) return say(d.saySelectAssetFirst);
    if ((r === "h1" || r === "h2") && !(r === "h1" ? periods?.first : periods?.second)) return say(d.sayHalvesUnknown.replace("{a}", r === "h1" ? d.rangeH1 : d.rangeH2));
    setRange(r);
  };
  const pickTeam = (t: TeamSide) => {
    if (t !== "all" && !match) return say(d.saySelectLinkedFirst);
    setTeam(t);
  };
  // the match menu (the SOT's title button with a chevron, not a select): switching keeps the centre table in step
  const [menuOpen, setMenuOpen] = useState(false);
  // the custom range's start and end (mm:ss); the range itself is not consumed downstream yet, like the halves
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const pickMatch = (m: Match | null) => { setTeam("all"); onMatch(m); setMenuOpen(false); };

  return (
    <SidePanel panel="library-left" def={272} edge="right" aria-label={d.matchPanelAria} className="flex min-w-0 flex-col overflow-auto">
      <div className="vie-sect" style={{ gap: 6, padding: "10px 14px" }}>
        <span className="eb">{dict.body.analysis.match}</span>
        <div className="relative">
          <button type="button" aria-label={dict.body.analysis.match} aria-expanded={menuOpen} aria-haspopup="menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="in flex h-10 w-full items-center justify-between gap-2" style={{ fontWeight: 400, textAlign: "left", cursor: "pointer" }}>
            <span className="min-w-0 truncate">{match ? matchTitle(match) : d.noMatchSelected}</span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-ctl border border-line2 bg-canvas shadow-lg">
              {matches.map((m) => (
                <button key={m.id} type="button" role="menuitem" onClick={() => pickMatch(m)}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-panel" style={{ fontWeight: m.id === match?.id ? 600 : 400 }}>
                  {matchTitle(m)}
                </button>
              ))}
              {matches.length === 0 && <p className="px-3 py-2 text-sm text-muted">{d.noMatchSelected}</p>}
            </div>
          )}
        </div>
        {!match && (
          <div className="flex items-center gap-2">
            {/* "Not linked" is plain text with a dot (SOT §B); "Link video" stays a button */}
            <span className="t-small text-muted">• {d.videoNotLinked}</span>
            <Link href="/upload" className="btn sm gh">{d.lbLinkVideo}</Link>
          </div>
        )}
        {/* SOT: the match facts are always there, with "—" until a match is chosen (owner 2026-11-13) */}
        <dl className="kv" style={{ gap: "2px 12px", gridTemplateColumns: "auto minmax(0, 1fr)" }}>
          <dt>{d.homeTeam}</dt><dd>{match?.home?.name ?? "—"}</dd>
          <dt>{d.awayTeam}</dt><dd>{match?.away?.name ?? "—"}</dd>
          <dt>{d.lbTracking}</dt><dd>{!match || total === null || confirmedCount === null ? "—" : `${confirmedCount === 1 ? d.lbConfirmedPlayerOne : d.lbConfirmedPlayerMany.replace("{a}", String(confirmedCount))} · ${d.lbEventsMany.replace("{a}", String(total))}`}</dd>
        </dl>
        {/* "Match time: confirmed" is plain text with a dot (SOT §B), keeping the teal colour */}
        {confirmed && <span className="t-small" style={{ alignSelf: "flex-start", marginTop: 2, color: "rgb(var(--primary))" }}>• {d.lbMatchTimeConfirmed}</span>}
      </div>

      <div className="vie-sect" style={{ gap: 2, padding: "10px 14px" }}>
        <span className="eb">{dict.desktop.overlaysTitle}</span>
        {OVERLAY_ROWS.map((r) => (
          <div key={r.key} className="lr" style={{ padding: 0, border: 0, minHeight: 29 }}>
            <span style={{ flex: 1 }}>{dict.desktop[r.label]}</span>
            <button type="button" role="switch" aria-checked={prefs[r.key]} aria-label={dict.desktop[r.label]} className="vie-sw" data-overlay={r.key}
              onClick={() => savePrefs({ ...prefs, [r.key]: !prefs[r.key] })} />
          </div>
        ))}
      </div>

      <div className="vie-sect" style={{ gap: 4, padding: "10px 14px" }}>
        <span className="eb">{dict.body.analysis.teamFilter}</span>
        <div role="radiogroup" aria-label={d.teamFilterAria} className="flex flex-col gap-[3px]">
          {teamRows.map(([t, l]) => {
            const on = team === t;
            return (
              <button key={t} type="button" role="radio" aria-checked={on} onClick={() => pickTeam(t)}
                className={`radio ${on ? "on" : ""}`} style={{ padding: "4px 8px", gap: 8, alignItems: "center" }}>
                <span className="o" style={{ margin: 0 }} />
                <span style={{ fontWeight: 400 }}>{l}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="vie-sect" style={{ gap: 4, padding: "10px 14px", borderBottom: 0 }}>
        <span className="eb">{dict.body.analysis.timeRange}</span>
        <div role="radiogroup" aria-label={d.timeRangeAria} className="grid grid-cols-2 gap-1">
          {rangeRows.map(([k, l]) => {
            const on = k === range, off = k === "custom" ? !videoId : k !== "full" && !(k === "h1" ? periods?.first : periods?.second);
            return (
              <button key={k} type="button" role="radio" aria-checked={on} aria-disabled={off || undefined} title={off ? (k === "custom" ? d.saySelectAssetFirst : d.halvesUnknown) : undefined}
                onClick={() => pickRange(k)}
                className={`radio ${on ? "on" : ""} ${off ? "opacity-60" : ""}`} style={{ padding: "4px 8px", gap: 8, alignItems: "center" }}>
                <span className="o" style={{ margin: 0 }} />
                <span style={{ fontWeight: 400, whiteSpace: "nowrap" }}>{l}</span>
              </button>
            );
          })}
        </div>
        {range === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="t-label text-muted">{d.rangeCustomStart}</span>
              <input value={customStart} onChange={(e) => setCustomStart(e.target.value)} placeholder="00:00" inputMode="numeric" className="in h-9 w-full text-xs" />
            </label>
            <label className="grid gap-1">
              <span className="t-label text-muted">{d.rangeCustomEnd}</span>
              <input value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} placeholder="00:00" inputMode="numeric" className="in h-9 w-full text-xs" />
            </label>
          </div>
        )}
      </div>
    </SidePanel>
  );
}
