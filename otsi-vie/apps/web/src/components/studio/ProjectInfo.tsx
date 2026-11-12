"use client";
/**
 * v3 Phase B.19 (ADR-093): the Clip Inspector with nothing chosen shows the reel itself, like an editor's project panel: its name, the
 * player (named only because a person confirmed him) with his OTSI ID, the match, clips and length, frame, spotlight look, music and
 * whether the latest file still matches the edit. A button chooses the clip under the playhead (the Events and Adjustments tabs keep
 * following the playhead on their own).
 */
import type { Match, Reel } from "@otsi-vie/contracts";
import { presetOf, SPOTLIGHT_PRESETS } from "@otsi-vie/contracts";
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
    <div data-project-info="" className="flex flex-col gap-2">
      <h2 className="t-section truncate text-white">{reel.name}</h2>
      <p className="t-small m-0">{dict.body.studio.reelChooseClip}</p>
      <dl className="mt-1.5 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} data-project-row={k} className="contents">
            <dt className="t-label">{k}</dt>
            <dd className="t-body m-0 truncate text-[#e3eefb]">{v}</dd>
          </div>
        ))}
      </dl>
      <button type="button" data-pick-playhead="" disabled={!canPick} onClick={onPick}
        className="t-button mt-3 inline-flex items-center justify-center gap-2 self-start h-9 rounded-ctl border border-primary bg-[#0a2447] px-3.5 text-white disabled:opacity-40">{dict.body.studio.selectClipPlayhead}
      </button>
    </div>
  );
}
