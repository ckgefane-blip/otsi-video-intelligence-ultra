/**
 * v3 Phase A.7 (S05, ADR-072): Guided / Pro, per person and per page. Guided shows the page's main actions and fewer controls; Pro shows
 * every control (the approved design). Same page, same data: Guided only hides controls, never data or results.
 */
import { z } from "zod";

export const UiMode = z.enum(["GUIDED", "PRO"]);
export type UiMode = z.infer<typeof UiMode>;
export const UiPage = z.enum(["home", "upload", "processing", "analysis", "tactical", "reels", "studio", "reports", "library", "export"]);
export type UiPage = z.infer<typeof UiPage>;
/** a page without a row is Pro */
export const DEFAULT_UI_MODE: UiMode = "PRO";
export const PageModes = z.object({ modes: z.record(UiPage, UiMode) });
export type PageModes = z.infer<typeof PageModes>;
export const SetPageMode = z.object({ mode: UiMode });

/** the page a path belongs to (the ten pages' own routes) */
export function uiPageOf(pathname: string): UiPage | null {
  const p = pathname.split("?")[0]!;
  const by: [string, UiPage][] = [["/dashboard", "home"], ["/upload", "upload"], ["/processing", "processing"], ["/analysis", "analysis"], ["/tactics", "tactical"],
    ["/reels", "reels"], ["/studio", "studio"], ["/reports", "reports"], ["/library", "library"], ["/exports", "export"]];
  return by.find(([pre]) => p === pre || p.startsWith(`${pre}/`))?.[1] ?? null;
}
