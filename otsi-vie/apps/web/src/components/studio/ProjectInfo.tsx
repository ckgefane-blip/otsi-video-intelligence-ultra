"use client";
/**
 * v3 Phase B.19 (ADR-093): the Clip Inspector with nothing chosen shows the reel itself, like an editor's project panel: its name, the
 * player (named only because a person confirmed him) with his OTSI ID, the match, clips and length, frame, spotlight look, music and
 * whether the latest file still matches the edit. A button chooses the clip under the playhead (the Events and Adjustments tabs keep
 * following the playhead on their own).
 */
import type { Match, Reel } from "@otsi-vie/contracts";
import { presetOf, SPOTLIGHT_PRESETS } from "@otsi-vie/contracts";
import { u } from "@/components/stage/DesignStage";
import { tc } from "./kit";
import { renderedState } from "./spotlight";

const FRAME: Record<string, string> = { "16:9": "Landscape 16:9", "9:16": "Vertical 9:16", "1:1": "Square 1:1", "4:5": "Portrait 4:5" };

/** the rows of the project panel, as recorded (pure, for tests) */
export function projectRows(reel: Reel, match: Match | null, total: number): [string, string][] {
  const p = presetOf(reel.settings);
  const look = p ? (SPOTLIGHT_PRESETS.find((x) => x.key === p)?.name ?? p) : "Custom";
  const r = renderedState(reel).reel;
  const m = match ? `${match.home?.name ?? "—"} vs ${match.away?.name ?? "—"}` : reel.match?.home || reel.match?.away ? `${reel.match.home ?? "—"} vs ${reel.match.away ?? "—"}` : "Video not linked to a match";
  return [
    ["Player", reel.player ? `${reel.player.display_name}${reel.player.canonical_otsi_id ? ` · ${reel.player.canonical_otsi_id}` : ""}` : "No confirmed player"],
    ["Match", m],
    ["Clips", `${reel.clips.length} · ${tc(total)}`],
    ["Frame", FRAME[reel.aspect] ?? reel.aspect],
    ["Spotlight", look],
    ["Music", reel.settings.music_id ? `Music added · ${Math.round(reel.settings.music_volume * 100)}%` : "Match sound only"],
    ["File", r.state === "RENDERED" ? "Up to date with the edit" : r.state === "NEVER" ? "Not rendered yet" : "Changed since the last file"],
  ];
}

export function ProjectInfo({ reel, match, total, canPick, onPick }: { reel: Reel; match: Match | null; total: number; canPick: boolean; onPick: () => void }) {
  const rows = projectRows(reel, match, total);
  return (
    <div data-project-info="" className="absolute" style={{ left: u(1990), top: u(280 - 101), width: u(526), height: u(530), fontSize: u(19), color: "#cfe0f5", display: "flex", flexDirection: "column", gap: u(8) }}>
      <h2 style={{ margin: 0, fontSize: u(24), fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reel.name}</h2>
      <p style={{ margin: 0, fontSize: u(15), color: "#8ea3bf" }}>The reel. Choose a clip on the timeline to see its details.</p>
      <dl style={{ margin: `${u(6)} 0 0`, display: "grid", gridTemplateColumns: `${u(120)} 1fr`, rowGap: u(10), columnGap: u(12) }}>
        {rows.map(([k, v]) => (
          <div key={k} data-project-row={k} style={{ display: "contents" }}>
            <dt style={{ color: "#8ea3bf" }}>{k}</dt>
            <dd style={{ margin: 0, color: "#e3eefb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</dd>
          </div>
        ))}
      </dl>
      <button type="button" data-pick-playhead="" disabled={!canPick} onClick={onPick}
        style={{ marginTop: u(14), alignSelf: "flex-start", height: u(40), padding: `0 ${u(16)}`, fontSize: u(18), fontWeight: 600, color: "#fff", background: "#0a2447",
          border: `${u(1.5)} solid #33a8ff`, borderRadius: u(6), cursor: canPick ? "pointer" : "default", opacity: canPick ? 1 : 0.4, fontFamily: "inherit" }}>
        Select the clip at the playhead
      </button>
    </div>
  );
}
