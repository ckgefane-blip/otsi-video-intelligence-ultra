/**
 * The ten approved pages: route, navigation, layout composition and section wiring.
 *
 * Section titles, summaries and API contracts come from `page-specs.generated.json`, generated from the approved page specifications
 * (tools/web/extract_page_specs.py), so no section can be dropped or renamed here. This file adds what the specs leave to the app:
 * where each section sits in the page's grid (composed after the approved image), and which construction block connects it to real
 * data (BUILD_SEQUENCE.md). Until a section is connected it says so; it never shows invented data.
 */
import specs from "./page-specs.generated.json";

export type PageId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/** How a section is wired today. */
export type SectionState =
  | { kind: "planned"; block: number }            // not connected yet: the named block builds its backend + UI
  | { kind: "static" }                            // product copy / navigation with no data behind it: complete as rendered
  | { kind: "owner"; need: string }               // needs an owner-supplied, licensed asset or decision
  | { kind: "shell" }                             // rendered by the global app shell (header)
  | { kind: "live" };                             // connected: shows the organization's real data and performs real operations

export interface SpecSection { n: number; title: string; summary: string; contract: string | null }
export interface PageSpec { page: number; file: string; title: string; sections: SpecSection[] }

export interface PageDef {
  id: PageId;
  /** route of the page's own entry (pages that need a video or player have a parameterised route too) */
  href: string;
  /** short label used in navigation and the command palette */
  label: string;
  subtitle: string;
  /** CSS grid: column template and named areas, one row per string ("rail" = shared match rail chrome, not a page section) */
  columns: string;
  areas: string[];
  /** block that connects each section (default), with per-section overrides */
  block: number;
  states?: Partial<Record<number, SectionState>>;
  /** the page's <h1> is visible in the layout (false: the approved image shows no page title, so it is screen-reader only) */
  visibleHeading: boolean;
  /** sections the approved image shows without a title bar (the title stays available to screen readers) */
  untitled?: number[];
}

export const PAGE_SPECS = (specs as { pages: PageSpec[] }).pages;

export const PAGES: Record<PageId, PageDef> = {
  1: {
    id: 1, href: "/dashboard", label: "Home", subtitle: "Turn football video into insights",
    columns: "minmax(0,1.3fr) minmax(0,1.3fr) minmax(0,1fr)",
    areas: ["s2 s2 s3", "s4 s4 s5", "s6 s7 s8", "s9 s9 s9"],
    block: 14, visibleHeading: false, untitled: [2],
    states: {
      1: { kind: "shell" }, 2: { kind: "static" }, 3: { kind: "planned", block: 10 }, 4: { kind: "planned", block: 9 },
      5: { kind: "owner", need: "Licensed partner marks or an approved trust statement (league / association logos need contractual permission)" },
      6: { kind: "planned", block: 3 }, 7: { kind: "planned", block: 10 }, 8: { kind: "static" }, 9: { kind: "static" },
    },
  },
  2: {
    id: 2, href: "/upload", label: "Media", subtitle: "Bring your football footage into OTSI VIE. Ingest, probe and prepare it for analysis.",
    columns: "minmax(220px,260px) minmax(0,1fr) minmax(280px,400px)",
    areas: ["s2 s1 s8", "s3 s5 s8", "s3 s6 s9", "s4 s7 s9", "s4 s10 s9"],
    block: 3, visibleHeading: true,
    states: { 3: { kind: "planned", block: 4 }, 7: { kind: "static" }, 10: { kind: "planned", block: 5 } },
  },
  3: {
    id: 3, href: "/processing", label: "AI Processing", subtitle: "From raw video to actionable insights: detection, tracking, identity, events and indexing.",
    columns: "minmax(0,1.6fr) minmax(0,0.75fr) minmax(0,0.75fr) minmax(260px,1fr)",
    areas: ["s1 s1 s1 s1", "s2 s2 s2 s8", "s3 s4 s5 s8", "s3 s6 s7 s9", "s10 s10 s11 s11"],
    block: 5, visibleHeading: true,
    states: { 6: { kind: "planned", block: 7 }, 7: { kind: "planned", block: 8 }, 9: { kind: "planned", block: 15 } },
  },
  4: {
    id: 4, href: "/analysis", label: "Analysis", subtitle: "Video analysis workspace",
    columns: "minmax(220px,250px) minmax(0,1fr) minmax(280px,340px)",
    areas: ["s1 s2 s6", "s5 s3 s6", "s5 s4 s7", "s5 s8 s7", "s5 s9 s7", "s11 s10 s7"],
    block: 4, visibleHeading: false,
    states: {
      2: { kind: "planned", block: 14 }, 4: { kind: "planned", block: 6 }, 5: { kind: "planned", block: 6 }, 6: { kind: "planned", block: 7 },
      7: { kind: "planned", block: 8 }, 9: { kind: "planned", block: 8 }, 10: { kind: "planned", block: 8 }, 11: { kind: "planned", block: 10 },
    },
  },
  5: {
    id: 5, href: "/tactics", label: "Tactical Intelligence", subtitle: "Go beyond the video: tactical patterns, team behaviour and player insights.",
    columns: "minmax(220px,250px) minmax(0,1.15fr) minmax(0,0.85fr) minmax(0,1fr)",
    areas: ["rail s1 s1 s1", "rail s2 s3 s4", "rail s5 s6 s7", "rail s8 s9 s9"],
    block: 9, visibleHeading: true,
    states: { 4: { kind: "planned", block: 4 } },
  },
  6: {
    id: 6, href: "/reels", label: "Reels", subtitle: "Spotlight Composer: cinematic, evidence-backed player reels.",
    columns: "minmax(240px,280px) minmax(0,1fr) minmax(280px,340px)",
    areas: ["s1 s4 s6", "s2 s4 s5", "s3 s8 s7", "s3 s9 s10"],
    block: 10, visibleHeading: true,
    states: { 4: { kind: "planned", block: 11 }, 5: { kind: "planned", block: 11 }, 6: { kind: "planned", block: 11 }, 7: { kind: "planned", block: 11 }, 10: { kind: "planned", block: 11 } },
  },
  7: {
    id: 7, href: "/studio", label: "Clip Studio", subtitle: "Create, edit and assemble reels on a frame-accurate timeline.",
    columns: "minmax(0,1fr) minmax(0,2fr) minmax(260px,1.1fr)",
    areas: ["s1 s1 s1", "s2 s3 s4", "s5 s5 s5", "s6 s6 s6", "s7 s7 s7", "s8 s8 s8", "s9 s9 s9", "s10 s10 s10", "s11 s11 s11"],
    block: 10, visibleHeading: true,
    states: { 3: { kind: "planned", block: 11 } },
  },
  8: {
    id: 8, href: "/reports", label: "Reports", subtitle: "Evidence-backed player report",
    columns: "minmax(200px,230px) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",
    areas: ["s1 s5 s5 s5", "s1 s2 s3 s4", "s1 s6 s6 s6", "s1 s7 s8 s9", "s10 s10 s11 s12"],
    block: 9, visibleHeading: true,
    states: { 2: { kind: "planned", block: 2 }, 3: { kind: "planned", block: 7 }, 5: { kind: "planned", block: 12 } },
  },
  9: {
    id: 9, href: "/library", label: "Library", subtitle: "Manage reels, reports, matches, exports and folders; search and collaborate.",
    columns: "minmax(220px,250px) minmax(0,1fr) minmax(280px,340px)",
    areas: ["rail s1 s7", "rail s2 s7", "rail s3 s8", "rail s4 s8", "rail s5 s9", "rail s6 s10"],
    block: 14, visibleHeading: true,
    states: { 9: { kind: "planned", block: 12 }, 10: { kind: "planned", block: 12 } },
  },
  10: {
    id: 10, href: "/exports", label: "Export", subtitle: "Render, brand and deliver video insights to your team and clients.",
    columns: "minmax(240px,270px) minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)",
    areas: ["s1 s2 s2 s3 s3", "s1 s2 s2 s4 s4", "s1 s5 s6 s7 s8", "s9 s9 s9 s9 s9"],
    block: 11, visibleHeading: true,
    states: { 6: { kind: "planned", block: 12 }, 7: { kind: "planned", block: 12 }, 8: { kind: "planned", block: 12 } },
  },
};

export function pageSpec(id: PageId): PageSpec {
  const s = PAGE_SPECS.find((p) => p.page === id);
  if (!s) throw new Error(`no spec for page ${id}`);
  return s;
}

export function sectionState(id: PageId, n: number): SectionState {
  return PAGES[id].states?.[n] ?? { kind: "planned", block: PAGES[id].block };
}

/**
 * Navigation as in the SOT rail (owner directive 2026-10-28, corrected Page 01 reference; SOT rebuild 2026-11-13): eleven fixed
 * destinations in this order, all shown always — the SOT has no Guided-mode gating (Tactical, Clip Studio and Admin are shown in
 * every mode; whether Guided mode itself stays is an open owner decision).
 * `match` decides which one is current; nested pages belong to their area (a video's processing / analysis / tactics, a player's report,
 * the Matches tab of the Library).
 */
export const NAV: { label: string; href: string; match: RegExp }[] = [
  { label: "Home", href: "/dashboard", match: /^\/dashboard/ },
  { label: "Media", href: "/upload", match: /^\/upload/ },
  { label: "Processing", href: "/processing", match: /^\/(processing|videos\/[^/]+\/processing)/ },
  { label: "Analysis", href: "/analysis", match: /^\/(analysis|videos\/[^/]+\/analyze)/ },
  { label: "Tactical", href: "/tactics", match: /^\/(tactics|videos\/[^/]+\/tactics)/ },
  { label: "Players", href: "/players", match: /^\/players/ },
  { label: "Reports", href: "/reports", match: /^\/reports/ },
  { label: "Reels", href: "/reels", match: /^\/reels/ },
  { label: "Clip Studio", href: "/studio", match: /^\/studio/ },
  { label: "Library", href: "/library", match: /^\/(library|matches)/ },
  { label: "Export", href: "/exports", match: /^\/exports/ },
];

export interface NavItem { label: string; href: string; active: boolean }

export function navItems(pathname: string): NavItem[] {
  return NAV.map((n) => ({ label: n.label, href: n.href, active: n.match.test(pathname) }));
}
