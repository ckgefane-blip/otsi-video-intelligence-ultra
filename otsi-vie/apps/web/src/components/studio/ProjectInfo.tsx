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
import { getDictionary, useLocale, type Dictionary } from "@/lib/i18n";


/** the rows of the project panel, as recorded (pure, for tests) */
export function projectRows(reel: Reel, match: Match | null, total: number, d?: Dictionary): [string, string][] {
  const dict = d ?? getDictionary("en");
  const FRAME: Record<string, string> = { "16:9": dict.body.studio.aspectLandscape, "9:16": dict.body.studio.aspectVertical916, "1:1": dict.body.studio.aspectSquare11, "4:5": dict.body.studio.aspectPortrait45 };
  const p = presetOf(reel.settings);
  const look = p ? (SPOTLIGHT_PRESETS.find((x) => x.key === p)?.name ?? p) : dict.body.studio.aspectCustom;
  const r = renderedState(reel, dict).reel;
  const m = match ? dict.body.workspace.matchTitleVs.replace("{a}", match.home?.name ?? "—").replace("{b}", match.away?.name ?? "—") : reel.match?.home || reel.match?.away ? dict.body.workspace.matchTitleVs.replace("{a}", reel.match.home ?? "—").replace("{b}", reel.match.away ?? "—") : dict.body.studio.videoNotLinked;
  return [
    [dict.body.studio.playerRow, reel.player ? `${reel.player.display_name}${reel.player.canonical_otsi_id ? ` · ${reel.player.canonical_otsi_id}` : ""}` : dict.body.studio.noConfirmedPlayer],
    [dict.body.studio.matchRow, m],
    [dict.body.workspace.metricClips, `${reel.clips.length} · ${tc(total)}`],
    [dict.body.studio.frameRow, FRAME[reel.aspect] ?? reel.aspect],
    [dict.body.studio.spotlightLabel, look],
    [dict.body.reels.music, reel.settings.music_id ? dict.body.studio.musicAddedPct.replace("{a}", String(Math.round(reel.settings.music_volume * 100))) : dict.body.studio.matchSoundOnly],
    [dict.body.studio.fileRow, r.state === "RENDERED" ? dict.body.studio.fileUpToDate : r.state === "NEVER" ? dict.body.studio.notRenderedYet : dict.body.studio.fileChanged],
  ];
}

export function ProjectInfo({ reel, match, total, canPick, onPick }: { reel: Reel; match: Match | null; total: number; canPick: boolean; onPick: () => void }) {
  const { t: dict } = useLocale();
  const rows = projectRows(reel, match, total, dict);
  return (
    <div data-project-info="" className="absolute" style={{ left: u(1990), top: u(280 - 101), width: u(526), height: u(530), fontSize: u(19), color: "#cfe0f5", display: "flex", flexDirection: "column", gap: u(8) }}>
      <h2 style={{ margin: 0, fontSize: u(24), fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reel.name}</h2>
      <p style={{ margin: 0, fontSize: u(15), color: "#8ea3bf" }}>{dict.body.studio.reelChooseClip}</p>
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
          border: `${u(1.5)} solid #33a8ff`, borderRadius: u(6), cursor: canPick ? "pointer" : "default", opacity: canPick ? 1 : 0.4, fontFamily: "inherit" }}>{dict.body.studio.selectClipPlayhead}
      </button>
    </div>
  );
}
