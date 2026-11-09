# ADR-085: Analysis centre tabs link to Tactical with the same context (v3 Phase B.8)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
- The Analysis centre tabs (Tactical View, Heatmap, Pass Network, Player Comparison) showed tactical views, but there was no way to
  carry on in the Tactical page with what was in front of you: Tactical opened on its first tab, at the start, with nothing selected.
- Player Comparison was drawn in full on both pages, the same component twice.

## Decision
- **One link helper** (`apps/web/src/lib/tacticsLink.ts`): `tacticsHref` writes `/tactics?video=…&tab=…&t=…&track=…`;
  `readTacticsContext` reads it back and ignores anything malformed (unknown beats wrong). Tab keys: team-overview, pass-network,
  heat-zones, pressing-defense, off-ball-runs, player-comparison.
- **Analysis:** every centre tab other than the video shows "Open in Tactical →" in its top-right corner. Tactical View opens Team
  Overview, Heatmap opens Heat Zones, Pass Network opens Pass Network, Player Comparison opens Player Comparison, each with this video,
  the playhead (seconds, one decimal) and the selected track.
- **Duplicate removed:** the Analysis Player Comparison tab no longer draws the comparison; it says the comparison is on the Tactical page
  and links there with the selected player. Tactical View (everyone at the playhead), Heatmap (the selected player) and the Pass Network
  note stay: they follow the Analysis playhead and selection, which Tactical's panels do not.
- **Tactical:** opens on the asked tab (the same scroll and highlight as clicking it), the workspace opens the video at `?t=` (existing
  behaviour), and the asked track is selected once the run's tracks are loaded, only if it belongs to that run.
- The tabs themselves, their labels and positions are unchanged (approved design).

## Tests
- `apps/web/test/tacticsLink.test.ts`: the link carries video, tab, moment and track; every Analysis tab maps to a Tactical tab;
  malformed values are ignored.
- Web suite 159 passed; type check clean. Browser check on the live stack: the link opens Tactical on the matching tab at the same moment.
