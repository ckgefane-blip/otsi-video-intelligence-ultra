"use client";
/**
 * SOT rebuild page 14 (alphabetical), Library: the left panel — the
 * selected match, the eight visual overlays, the team filter and the
 * time range. The SOT shows these four sections flat (no tabs, no
 * Browse switcher); the old LeftPanel's Events and AI Tools tabs are
 * not in the SOT and are not here (the Analysis workspace and the
 * Processing page hold them).
 *
 * The match select lists the organization's matches (GET /v1/matches,
 * via useLibrary). The link row says whether the selected video is
 * linked to a match record: a video with no match shows "Not linked
 * to a match" and a Link video button (to the upload page, which links
 * it); a match — or a linked video — shows its match. Tracking is the
 * confirmed-player count and the event count of the selected video
 * (GET /v1/videos/:id/events); "Match time: confirmed" shows when the
 * video's halves are confirmed (GET /v1/videos/:id/match-periods).
 */
import type { Match, MatchEvents, MatchPeriods } from "@otsi-vie/contracts";
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
  const confirmed = periods?.state === "CONFIRMED";
  const teamRows: [TeamSide, string][] = [["all", d.teamAllPlayers], ["home", match?.home?.name ?? d.homeTeam], ["away", match?.away?.name ?? d.awayTeam]];
  const rangeRows: [TimeRange | "custom", string][] = [["full", d.rangeFull], ["h1", d.rangeH1], ["h2", d.rangeH2], ["custom", d.rangeCustom]];
  const pickRange = (r: TimeRange | "custom") => {
    if (r === "custom") return say(d.customRangeNotYet.replace("{a}", "—"));
    if (r !== "full" && !videoId) return say(d.saySelectAssetFirst);
    if (r !== "full" && !(r === "h1" ? periods?.first : periods?.second)) return say(d.sayHalvesUnknown.replace("{a}", r === "h1" ? d.rangeH1 : d.rangeH2));
    setRange(r);
  };
  const pickTeam = (t: TeamSide) => {
    if (t !== "all" && !match) return say(d.saySelectLinkedFirst);
    setTeam(t);
  };

  return (
    <aside aria-label={d.matchPanelAria} className="flex min-w-0 flex-col overflow-auto" style={{ flex: "0 0 272px", maxWidth: 272 }}>
      <div className="vie-sect" style={{ gap: 6, padding: "10px 14px" }}>
        <span className="eb">{dict.body.analysis.match}</span>
        <select aria-label={dict.body.analysis.match} value={match?.id ?? ""}
          onChange={(e) => { const m = matches.find((x) => x.id === e.target.value) ?? null; setTeam("all"); onMatch(m); }}
          className="in h-10 w-full" style={{ fontWeight: 600 }}>
          {matches.map((m) => <option key={m.id} value={m.id}>{matchTitle(m)}</option>)}
        </select>
        {match ? (
          <div className="flex items-center gap-2">
            <span className="chip ev ev-c">{d.lbMatchLinked}</span>
            <Link href={match.video_ids[0] ? `/videos/${match.video_ids[0]}/analyze` : "/analysis"} className="btn sm gh">{d.openInAnalysis}</Link>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="chip ev ev-n">{d.videoNotLinked}</span>
            <Link href="/upload" className="btn sm gh">{d.lbLinkVideo}</Link>
          </div>
        )}
        {match && (
          <dl className="kv" style={{ gap: "2px 12px", gridTemplateColumns: "auto minmax(0, 1fr)" }}>
            <dt>{d.homeTeam}</dt><dd>{match.home?.name ?? "—"}</dd>
            <dt>{d.awayTeam}</dt><dd>{match.away?.name ?? "—"}</dd>
            <dt>{d.lbTracking}</dt><dd>{total === null ? "—" : `${total} events`}</dd>
          </dl>
        )}
        {confirmed && <span className="chip ev ev-c" style={{ alignSelf: "flex-start", marginTop: 2 }}>{d.lbMatchTimeConfirmed}</span>}
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
                <span style={{ fontWeight: 500 }}>{l}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="vie-sect" style={{ gap: 4, padding: "10px 14px", borderBottom: 0 }}>
        <span className="eb">{dict.body.analysis.timeRange}</span>
        <div role="radiogroup" aria-label={d.timeRangeAria} className="grid grid-cols-2 gap-1">
          {rangeRows.map(([k, l]) => {
            const on = k === range, off = k === "custom" || (k !== "full" && !(k === "h1" ? periods?.first : periods?.second));
            return (
              <button key={k} type="button" role="radio" aria-checked={on} aria-disabled={off || undefined} title={off ? (k === "custom" ? d.customRangeNotYet.replace("{a}", "—") : d.halvesUnknown) : undefined}
                onClick={() => pickRange(k)}
                className={`radio ${on ? "on" : ""} ${off ? "opacity-60" : ""}`} style={{ padding: "4px 8px", gap: 8, alignItems: "center" }}>
                <span className="o" style={{ margin: 0 }} />
                <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{l}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
