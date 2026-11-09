"use client";
/**
 * Page 05 Section 01 — tactical header and filter context (approved reference 05_TACTICAL_INTELLIGENCE: sidebar, title, selectors, tabs).
 *
 * The match card shows the chosen video's linked match as recorded (clubs, competition, kick-off, score only when recorded) and what
 * analysis exists. The overlay switches that the engine supports (player boxes, IDs, ball) drive the synced video preview; the others
 * (tracks, team shapes, heatmaps, pass arrows) are off and disabled with their reason. The team filter (and the Team selector above)
 * offers the linked match's teams with the run's tracks a person assigned to each (kit colour groups); choosing one filters the synced
 * video's boxes. Match halves are not recorded, so those time ranges are disabled. The tabs highlight the matching panel.
 */
import type { Match, TrackSummary, Video } from "@otsi-vie/contracts";
import Link from "next/link";
import { B, T, u } from "@/components/stage/DesignStage";
import { Box, OverlayIcon, Sel, Toggle, type Opt } from "./kit";
import { NOT_YET, notBuilt } from "@/lib/devMode";

/** phases of play: listed so the choice is visible; the engine does not detect phases yet */
export const PHASES: Opt<string>[] = [["all", "All Phases"], ["in", "In possession", "not detected yet"], ["out", "Out of possession", "not detected yet"],
  ["tr", "Transitions"], ["sp", "Set pieces", "not detected yet"]];

export interface Layers { boxes: boolean; ids: boolean; ball: boolean }
export const TABS = [["Team Overview", 527, "p05-s02"], ["Pass Network", 791, "p05-s05"], ["Heat Zones", 1026, "p05-s06"],
  ["Pressing & Defense", 1238, "p05-s07"], ["Off-Ball Runs", 1522, "p05-s08"], ["Transitions", 1757, "p05-s10"], ["Player Comparison", 1990, "p05-s09"]] as const;

const NOT_BUILT = notBuilt("needs calibrated pitch positions and event detection");
const plain = { position: "absolute" as const, padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" };

function MatchCard({ video, match, tracks, finished, onPick }: { video: Video | null; match: Match | null; tracks: TrackSummary[] | null; finished: boolean; onPick: () => void }) {
  const title = match ? `${match.home?.name ?? "—"} vs ${match.away?.name ?? "—"}` : video ? (video.title ?? video.original_filename ?? "Untitled video") : "No match selected";
  const sub = match ? [match.competition, match.kickoff_at ? new Date(match.kickoff_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null].filter(Boolean).join(" · ") || "—"
    : video ? "Not linked to a match" : "—";
  const score = (s: number | null | undefined) => (s === null || s === undefined ? "—" : String(s));
  const people = (tracks ?? []).filter((t) => t.class_name !== "BALL").length, balls = (tracks ?? []).filter((t) => t.class_name === "BALL").length;
  return (
    <>
      <Box x={22} y={115} w={382} h={420} />
      <T x={40} y={151} size={26} weight={700} as="h2">Match</T>
      <button type="button" onClick={onPick} aria-label="Choose the match video" style={{ ...plain, left: u(320), top: u(136 - 101), width: u(70), height: u(34) }}>
        <T o={[320, 136]} x={332} y={153} size={20} color="#8ea3bf" as="span">··</T>
        <T o={[320, 136]} x={362} y={153} size={22} as="span">⌄</T>
      </button>
      <T x={40} y={195} size={22} weight={700} style={{ maxWidth: u(340), overflow: "hidden", textOverflow: "ellipsis" }}>{title}</T>
      <T x={40} y={230} size={20} color="#cfdcf0">{sub}</T>
      <B x={44} y={268} w={50} h={50} style={{ borderRadius: "50%", background: "#7ab6ff" }} />
      <T x={110} y={294} size={24} style={{ fontWeight: 500, maxWidth: u(230), overflow: "hidden", textOverflow: "ellipsis" }}>{match?.home?.name ?? "Home team"}</T>
      <T x={357} y={292} size={32} weight={700}>{score(match?.home_score)}</T>
      <B x={44} y={334} w={50} h={58} style={{ borderRadius: "50%", background: "#e8d9a0" }} />
      <T x={110} y={364} size={24} style={{ fontWeight: 500, maxWidth: u(230), overflow: "hidden", textOverflow: "ellipsis" }}>{match?.away?.name ?? "Away team"}</T>
      <T x={357} y={362} size={32} weight={700}>{score(match?.away_score)}</T>
      <B x={34} y={418} w={356} h={103} style={{ border: `${u(1.5)} solid #1f8a5a`, borderRadius: u(8), background: "#0a2a2a" }} />
      <B x={52} y={436} w={36} h={40} style={{ background: "#2a4a78", borderRadius: u(8) }} />
      <T x={108} y={445} size={21} weight={700} color="#cfe0f5">{finished ? "Tracking available" : "No analysis available"}</T>
      <T x={108} y={473} size={17} color="#8ea3bf">{finished ? `${people} people tracks, ${balls} ball tracks` : "Tracking data, events and models"}</T>
      <T x={108} y={496} size={17} color="#8ea3bf">{finished ? `Tactical models are ${NOT_YET}.` : "appear after processing completes."}</T>
    </>
  );
}

function Radio({ y, label, selected, count, reason, x = 44, onSelect }: { y: number; label: string; selected: boolean; count?: string; reason?: string; x?: number; onSelect?: () => void }) {
  const off = !selected && !onSelect;
  return (
    <div role="radio" aria-checked={selected} aria-disabled={off} title={off ? reason : undefined} aria-label={`${label}${count !== undefined ? `, ${count}` : ""}`}
      tabIndex={onSelect && !selected ? 0 : -1} onClick={onSelect && !selected ? onSelect : undefined}
      onKeyDown={(e) => { if (onSelect && !selected && (e.key === " " || e.key === "Enter")) { e.preventDefault(); onSelect(); } }}
      className="absolute" style={{ left: u(34), top: u(y - 23 - 101), width: u(356), height: u(46), cursor: onSelect && !selected ? "pointer" : off ? "not-allowed" : "default" }}>
      {!selected && <B o={[34, y - 23]} x={x} y={y - 11} w={22} h={22} style={{ border: `${u(2)} solid #7fa4d4`, borderRadius: "50%", opacity: off ? 0.6 : 1 }} />}
      <T o={[34, y - 23]} x={88} y={y} size={21} color={off ? "#8ea3bf" : undefined} style={{ maxWidth: u(240), overflow: "hidden", textOverflow: "ellipsis" }}>{label}</T>
      {count !== undefined && (
        <B o={[34, y - 23]} x={339} y={y - 15} w={44} h={30} style={{ border: `${u(1.5)} solid #4a6a96`, borderRadius: u(5), fontSize: u(18), display: "flex", alignItems: "center", justifyContent: "center" }}>{count}</B>
      )}
    </div>
  );
}

/** a team of the linked match with how many of the run's tracks a person assigned to it (via kit colour groups) */
export interface TeamCount { club_id: string; name: string; tracks: number }

export function TacticsHeader({ video, match, tracks, finished, layers, setLayers, tab, setTab, side, setSide, onPick, teams, team, setTeam }: {
  video: Video | null; match: Match | null; tracks: TrackSummary[] | null; finished: boolean; layers: Layers; setLayers: (l: Layers) => void;
  tab: number; setTab: (i: number) => void; side: number; setSide: (i: number) => void; onPick: () => void;
  /** [home, away] when the video is linked to a match; tracks = 0 until a person assigned that team on the Analysis page */
  teams: [TeamCount | null, TeamCount | null]; team: string; setTeam: (t: string) => void;
}) {
  const rows: [number, string, TeamCount | null, string][] = [[1100, "Home team", teams[0], "home"], [1148, "Away team", teams[1], "away"]];
  const selY = team === "all" ? 1050 : rows.find((r) => r[2]?.club_id === team)?.[0] ?? 1050;
  const teamReason = !match ? "Link this video to a match first (Upload or Analysis page)" : "Assign this team to a kit colour on the Analysis page first";
  const people = finished ? String((tracks ?? []).filter((t) => t.class_name !== "BALL").length) : "—";
  const overlays: [string, number, keyof Layers | null, string][] = [["Player Boxes", 681, "boxes", "box"], ["Player IDs", 723, "ids", "ids"], ["Player Tracks", 765, null, "trk"],
    ["Team Shapes", 807, null, "shp"], ["Heatmaps", 851, null, "layers"], ["Ball Tracking", 895, "ball", "ball"], ["Pass Arrows", 938, null, "pass"]];
  const SIDE: [string, number, number][] = [["View", 35, 66], ["Filters", 110, 78], ["Events", 199, 80], ["All Tools", 292, 100]];

  return (
    <section aria-label="Tactical header and filter context" data-section="p05-s01">
      <MatchCard video={video} match={match} tracks={tracks} finished={finished} onPick={onPick} />

      <Box x={22} y={541} w={382} h={880} noTop />
      <B x={22} y={545} w={382} h={55} style={{ borderBottom: `1px solid #17355f` }} />
      <div role="tablist" aria-label="Sidebar">
        {SIDE.map(([l, x, w], i) => (
          <button key={l} type="button" role="tab" aria-selected={side === i} onClick={() => setSide(i)}
            style={{ ...plain, left: u(x - 13), top: u(545 - 101), width: u(w), height: u(52) }}>
            <T o={[x - 13, 545]} x={x} y={568} size={i === 0 ? 21 : 20} weight={side === i ? 700 : 400} color={side === i ? "#33a8ff" : undefined} as="span">{l}</T>
          </button>
        ))}
      </div>
      <B x={SIDE[side]![1] - 13} y={596} w={SIDE[side]![2]} h={3} style={{ background: "#1e90ff" }} />

      {side === 0 && (
        <>
          <T x={39} y={639} size={22} weight={700} as="h3">Visual Overlays</T>
          {overlays.map(([n, y, key, icon]) => (
            <div key={n}>
              <OverlayIcon x={41} y={y - 12} k={icon} on={!!key && layers[key]} />
              <T x={88} y={y} size={21} color={key ? "#cfdcf0" : "#8ea3bf"}>{n}</T>
              {/* the engine's overlays are a display choice: switchable any time, applied to the video as soon as one is loaded */}
              <Toggle x={340} y={y - 13} label={n} on={key ? layers[key] : false} reason={NOT_BUILT}
                {...(key ? { onChange: (on: boolean) => setLayers({ ...layers, [key]: on }) } : {})} />
            </div>
          ))}
        </>
      )}
      {(side === 0 || side === 1) && (
        <div style={side === 1 ? { transform: `translateY(${u(-361)})` } : undefined}>
          <T x={39} y={1000} size={21} color="#cfdcf0" as="h3">Team Filter</T>
          <B x={34} y={selY - 24} w={356} h={46} style={{ border: `${u(1.5)} solid #1e90ff`, borderRadius: u(6), background: "#0d3a78" }} />
          <B x={44} y={selY - 11} w={24} h={24} style={{ borderRadius: "50%", background: "#1e90ff" }} />
          <div role="radiogroup" aria-label="Team filter">
            <Radio y={1050} label="All Players" selected={team === "all"} count={people} onSelect={() => setTeam("all")} />
            {rows.map(([y, fallback, t]) => (
              <Radio key={y} y={y} label={t?.name ?? fallback} selected={!!t && team === t.club_id} count={t && finished ? String(t.tracks) : "—"} reason={teamReason}
                {...(t && t.tracks > 0 ? { onSelect: () => setTeam(t.club_id) } : {})} />
            ))}
          </div>
          <T x={39} y={1207} size={21} color="#cfdcf0" as="h3">Time Range</T>
          <B x={34} y={1233} w={356} h={46} style={{ border: `${u(1.5)} solid #1e90ff`, borderRadius: u(6), background: "#0d3a78" }} />
          <B x={46} y={1245} w={24} h={24} style={{ borderRadius: "50%", background: "#1e90ff" }} />
          <div role="radiogroup" aria-label="Time range">
            <Radio y={1257} label="Full Match" selected />
            {([["1st Half", 1303], ["2nd Half", 1344], ["Custom Range", 1388]] as const).map(([l, y]) => (
              <Radio key={l} x={47} y={y} label={l} selected={false} reason="Match periods are not recorded yet" />
            ))}
          </div>
        </div>
      )}
      {side === 2 && <T x={39} y={639} size={20} color="#8ea3bf">Events are filtered on the Analysis page.</T>}
      {side === 3 && (
        <nav aria-label="Tools for this video" className="absolute" style={{ left: u(39), top: u(625 - 101), display: "flex", flexDirection: "column", gap: u(14), fontSize: u(20) }}>
          {video ? (
            <>
              <Link href={`/videos/${video.id}/analyze`} style={{ color: "#33a8ff" }}>Analysis workspace →</Link>
              <Link href={`/processing?video=${video.id}`} style={{ color: "#33a8ff" }}>Processing →</Link>
              <Link href="/reels" style={{ color: "#33a8ff" }}>Reel Builder →</Link>
            </>
          ) : <span style={{ color: "#8ea3bf" }}>Choose a match video first.</span>}
        </nav>
      )}

      {/* title, selectors, tabs */}
      <B x={440} y={128} w={76} h={48} style={{ border: `${u(3)} solid #19a0ff`, borderRadius: u(6) }} />
      <T x={543} y={145} size={40} weight={700} as="h1">Tactical Intelligence</T>
      <T x={543} y={187} size={22} color="#c9d6ea">Go beyond the video. Uncover tactical patterns, team behaviours and player insights with AI-powered analysis.</T>
      <Sel x={1656} y={138} w={364} h={59} label="View mode" value="live"
        options={[["live", "     Live Match View"], ["review", "Post-match review", NOT_YET]]} />
      <T x={2053} y={134} size={18} color="#b3c4dc">Team</T>
      <Sel x={2051} y={145} w={236} h={53} label="Team" value={team === "all" ? "none" : team} reason={teamReason}
        options={[["none", "    Select team"], ...(match ? teams.filter((t): t is TeamCount => !!t).map((t): Opt<string> => t.tracks > 0
          ? [t.club_id, `    ${t.name}`] : [t.club_id, t.name, "assign this team to a kit colour on the Analysis page"])
          : [["link", "Home / away team", "link this video to a match first"] as Opt<string>])]}
        onChange={(v) => setTeam(v === "none" ? "all" : v)}
        style={{ borderColor: "#1e90ff", background: "#0d3a78" }} />
      <T x={2317} y={134} size={18} color="#b3c4dc">Phase</T>
      <Sel x={2316} y={145} w={211} h={53} label="Phase" value="all" options={PHASES} />

      <B x={TABS[tab]![1] - 89} y={222} w={266} h={62} style={{ background: "linear-gradient(180deg,#0d2d57,#0a2347)", borderRadius: `${u(8)} ${u(8)} 0 0` }} />
      <B x={TABS[tab]![1] - 89} y={281} w={266} h={4} style={{ background: "#1e90ff" }} />
      <div role="tablist" aria-label="Tactical views">
        {TABS.map(([n, x, target], i) => (
          <button key={n} type="button" role="tab" aria-selected={tab === i} aria-controls={target} onClick={() => setTab(i)}
            style={{ ...plain, left: u(x - 52), top: u(226 - 101), width: u(x === 1757 ? 260 : 220), height: u(54) }}>
            <span className="absolute" style={{ left: u(7), top: u(242 - 226), width: u(32), height: u(28), boxSizing: "border-box",
              border: `${u(2)} solid ${tab === i ? "#33a8ff" : "#7fa4d4"}`, borderRadius: u(6) }} />
            <T o={[x - 52, 226]} x={x} y={253} size={22} weight={tab === i ? 700 : 400} color={tab === i ? "#33a8ff" : undefined} as="span">{n}</T>
          </button>
        ))}
      </div>
    </section>
  );
}
