/**
 * v3 Phase A.9 (S14, ADR-071): the keyboard map, one table for the whole app. The "?" map (components/shell/KeyboardMap.tsx) lists it,
 * the current page first, and the tests check it; each key is handled where its tool lives:
 *   Everywhere   Ctrl/Cmd + K (CommandPalette), Ctrl/Cmd + J (Jobs Center), ? (KeyboardMap)
 *   Clip Studio  Preview: playback, J K L, marks, draw; Timeline: editing; StudioHeader: undo / redo; DualTimeline: snapshot / apply Cut B
 *   Analysis     CentreVideo: playback, J K L, frames; WhoIsThis: N, the next possible moment of the reel's player
 *   Reel Builder ReelStage: undo / redo
 *   Player Reports ReportStage: [ / ] move between report sections
 *   Library LibraryMain: [ / ] move between asset tabs
 *   Export ExportStage: [ / ] switch between the Reel and Scouting Pack export types
 */
export type KeyScope = "everywhere" | "studio" | "analysis" | "reels" | "reports" | "library" | "exports";
export interface Shortcut { keys: string; does: string; group: "Play" | "Edit" | "Mark" | "Draw" | "Name" | "App" | "Compare" }
export interface KeyRow extends Shortcut { scope: KeyScope }

export const SCOPE_LABEL: Record<KeyScope, string> = { everywhere: "Everywhere", studio: "Clip Studio", analysis: "Analysis", reels: "Reel Builder", reports: "Player Reports", library: "Library", exports: "Export" };

const JKL: Shortcut[] = [
  { keys: "J", does: "Pause and go back one second (press again to go further)", group: "Play" },
  { keys: "K", does: "Pause (and back to normal speed)", group: "Play" },
  { keys: "L", does: "Play; press again for 1.5× and 2×", group: "Play" },
];

export const EVERYWHERE_KEYS: Shortcut[] = [
  { keys: "Ctrl + K", does: "Search matches, players, reels and projects, or run a command", group: "App" },
  { keys: "Ctrl + J", does: "Open the Jobs Center", group: "App" },
  { keys: "?", does: "Show the keyboard map", group: "App" },
  { keys: "Escape", does: "Close a dialog or menu", group: "App" },
];

export const STUDIO_KEYS: Shortcut[] = [
  { keys: "Space", does: "Play or pause", group: "Play" },
  ...JKL,
  { keys: "← / →", does: "One frame back / forward", group: "Play" },
  { keys: "Shift + ← / →", does: "One second back / forward", group: "Play" },
  { keys: "Home / End", does: "Start / end of the reel", group: "Play" },
  { keys: "S", does: "Split the clip at the playhead", group: "Edit" },
  { keys: "C", does: "End the clip at the playhead", group: "Edit" },
  { keys: "Delete", does: "Remove the selected clip and close the gap", group: "Edit" },
  { keys: "Alt + [ / Alt + ]", does: "Trim the clip's start / end to the playhead", group: "Edit" },
  { keys: "Ctrl + Z", does: "Undo", group: "Edit" },
  { keys: "Ctrl + Shift + Z or Ctrl + Y", does: "Redo", group: "Edit" },
  { keys: "M", does: "Add a marker at the playhead", group: "Mark" },
  { keys: "B", does: "Snapshot the active cut as Cut B (dual timeline)", group: "Compare" },
  { keys: "Shift + B", does: "Apply Cut B to the active reel (dual timeline)", group: "Compare" },
  { keys: "I / O", does: "Mark the in / out of a previewed Media Bin moment", group: "Mark" },
  { keys: "Alt + X", does: "Clear the in / out marks", group: "Mark" },
  { keys: "A / D / R", does: "Draw an arrow / line / circle on the preview", group: "Draw" },
  { keys: "Escape", does: "Stop drawing (or cancel a trim drag)", group: "Draw" },
];

export const ANALYSIS_KEYS: Shortcut[] = [
  { keys: "Space", does: "Play or pause the match video", group: "Play" },
  ...JKL,
  { keys: "← / →", does: "One analysed frame back / forward", group: "Play" },
  { keys: "Shift + ← / →", does: "One second back / forward", group: "Play" },
  { keys: "N", does: "\"Is this him?\": the next possible moment of the reel's player (same as Can't tell)", group: "Name" },
];

/** Reel Builder: the same undo / redo keys as Clip Studio, for the reel's own History (the Undo / Redo buttons in Suggested Key Moments) */
export const REELS_KEYS: Shortcut[] = [
  { keys: "Ctrl + Z", does: "Undo the last change to this reel", group: "Edit" },
  { keys: "Ctrl + Shift + Z or Ctrl + Y", does: "Redo the last undone change", group: "Edit" },
];

/** Player Reports: move between the rail's sections (the same sections the rail buttons scroll to) */
export const REPORTS_KEYS: Shortcut[] = [
  { keys: "[ / ]", does: "Previous / next report section", group: "App" },
];

/** Library: move between the asset tabs (the same tabs the tab buttons open) */
export const LIBRARY_KEYS: Shortcut[] = [
  { keys: "[ / ]", does: "Previous / next asset tab", group: "App" },
];

/** Export: [ / ] switch between the Reel and Scouting Pack export types (the SOT page's seg; the old page's tabs are gone) */
export const EXPORTS_KEYS: Shortcut[] = [
  { keys: "[ / ]", does: "Previous / next export type", group: "App" },
];

export const KEYMAP: KeyRow[] = [
  ...EVERYWHERE_KEYS.map((k) => ({ ...k, scope: "everywhere" as const })),
  ...STUDIO_KEYS.map((k) => ({ ...k, scope: "studio" as const })),
  ...ANALYSIS_KEYS.map((k) => ({ ...k, scope: "analysis" as const })),
  ...REELS_KEYS.map((k) => ({ ...k, scope: "reels" as const })),
  ...REPORTS_KEYS.map((k) => ({ ...k, scope: "reports" as const })),
  ...LIBRARY_KEYS.map((k) => ({ ...k, scope: "library" as const })),
  ...EXPORTS_KEYS.map((k) => ({ ...k, scope: "exports" as const })),
];

/** the page's own keys, if it has any */
export function scopeOf(pathname: string): KeyScope | null {
  if (pathname.startsWith("/studio")) return "studio";
  if (pathname.startsWith("/analysis")) return "analysis";
  if (pathname.startsWith("/reels")) return "reels";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/library")) return "library";
  if (pathname.startsWith("/exports")) return "exports";
  return null;
}

/** the map in the order shown: this page's keys, then everywhere, then the other pages'; filtered by a key or by words */
export function keymapFor(pathname: string, q = ""): { scope: KeyScope; here: boolean; rows: KeyRow[] }[] {
  const here = scopeOf(pathname), n = q.trim().toLowerCase();
  const order: KeyScope[] = [...(here ? [here] : []), "everywhere", ...(["studio", "analysis", "reels", "reports", "library", "exports"] as const).filter((s) => s !== here)];
  const hit = (r: KeyRow) => {
    if (!n) return true;
    if (n.length === 1) return r.keys.toLowerCase().split(/[^a-z0-9?[\]←→]+/).includes(n) || r.keys === q.trim();   // one letter: that key
    return `${r.keys} ${r.does} ${r.group}`.toLowerCase().includes(n);
  };
  return order.map((scope) => ({ scope, here: scope === here, rows: KEYMAP.filter((r) => r.scope === scope && hit(r)) })).filter((g) => g.rows.length > 0);
}

/** J K L: what the key does from the current state. Browsers cannot play video backwards smoothly, so J steps back a second. */
export const RATES = [1, 1.5, 2] as const;
export function jkl(key: "j" | "k" | "l", s: { playing: boolean; rate: number }): { play: boolean; rate: number; backUs: number } {
  if (key === "k") return { play: false, rate: 1, backUs: 0 };
  if (key === "j") return { play: false, rate: 1, backUs: 1_000_000 };
  if (!s.playing) return { play: true, rate: 1, backUs: 0 };
  return { play: true, rate: RATES.find((r) => r > s.rate + 1e-6) ?? RATES[RATES.length - 1]!, backUs: 0 };
}

/** true when a key press belongs to a field, a slider or a dialog, not to the page */
export const typing = (e: KeyboardEvent) =>
  !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable], [role=slider], [role=dialog]");

/** open the "?" map from a button */
export const KEYMAP_EVENT = "otsi:keyboard-map";
export const openKeymap = () => window.dispatchEvent(new Event(KEYMAP_EVENT));
