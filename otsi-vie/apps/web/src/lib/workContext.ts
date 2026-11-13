/**
 * v3 Phase A.1 (S01, ADR-069): what the page in the address is about, the context kept for this browser, and where each navigation
 * destination opens with it. Pure functions (tested); the bar (components/shell/ContextBar.tsx) and the header use them.
 */
export interface Ctx { video: string | null; player: string | null; reel: string | null; reelVideo: string | null }
export const EMPTY_CTX: Ctx = { video: null, player: null, reel: null, reelVideo: null };
export type PageKind = "video" | "reel" | "player" | null;
export interface Subject { kind: PageKind; video?: string | undefined; reel?: string | undefined; player?: string | undefined }

const KEY = "otsi-vie.work-context";
const EVENT = "otsi-vie:work-context";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: string | null | undefined) => (v && UUID.test(v) ? v.toLowerCase() : undefined);

/** the pages that show the bar: every shelled page (SOT rebuild 2026-11-13) — the Project / Match / Player selectors sit in the top bar
 *  on Home, Media, Players, Library and Settings just as on the work pages. The bar only renders inside the (app) shell, so every
 *  path that reaches it is a shelled page. */
export const showsBar = (_path: string) => true;

/** what the page is about, from its address alone */
export function subjectOf(path: string, q: URLSearchParams): Subject {
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/videos\/([^/]+)/))) return { kind: "video", video: id(m[1]) };
  if (/^\/(analysis|tactics|processing)(\/|$)/.test(path)) return { kind: "video", video: id(q.get("video")) };
  if ((m = path.match(/^\/reels\/([^/]+)/))) return { kind: "reel", reel: id(m[1]) };
  if (/^\/reels\/?$/.test(path)) return { kind: "reel" };
  if (/^\/(studio|exports)(\/|$)/.test(path)) return { kind: "reel", reel: id(q.get("reel")) };
  if ((m = path.match(/^\/reports\/players\/([^/]+)/))) return { kind: "player", player: decodeURIComponent(m[1]!) };
  if (/^\/reports\/?$/.test(path)) return { kind: "player" };
  return { kind: null };
}

/** the context after opening a page about `s`: a new video drops a reel of another video; a reel or player replaces its own */
export function merge(c: Ctx, s: Subject): Ctx {
  const n = { ...c };
  if (s.video && s.video !== c.video) { n.video = s.video; if (c.reelVideo !== s.video) { n.reel = null; n.reelVideo = null; } }
  if (s.reel) n.reel = s.reel;
  if (s.player) n.player = s.player;
  return n;
}

/** where a navigation destination opens with the context (unchanged when the context has nothing for it) */
export function navHref(label: string, base: string, c: Ctx, playerRef: string | null = c.player): string {
  const v = c.video ? `?video=${c.video}` : "";
  switch (label) {
    case "Processing": return `/processing${v}`;
    case "Analysis": return `/analysis${v}`;
    case "Tactical": return `/tactics${v}`;
    case "Reels": return c.reel ? `/reels/${c.reel}` : base;
    case "Clip Studio": return c.reel ? `/studio?reel=${c.reel}` : base;
    case "Export": return c.reel ? `/exports?reel=${c.reel}` : base;
    case "Reports": return playerRef ? `/reports/players/${encodeURIComponent(playerRef)}` : base;
    default: return base;
  }
}

/** the same page about another video (video pages) or reel (reel pages) */
export function samePageFor(path: string, s: { video?: string | undefined; reel?: string | undefined }): string | null {
  const m = path.match(/^\/videos\/[^/]+(\/.*)?$/);
  if (s.video && m) return `/videos/${s.video}${m[1] ?? ""}`;
  if (s.video && /^\/(analysis|tactics|processing)/.test(path)) return `${path.split("/").slice(0, 2).join("/")}?video=${s.video}`;
  if (s.reel && /^\/reels/.test(path)) return `/reels/${s.reel}`;
  if (s.reel && /^\/(studio|exports)/.test(path)) return `${path.split("/").slice(0, 2).join("/")}?reel=${s.reel}`;
  return null;
}

export function readCtx(): Ctx {
  try { const x = JSON.parse(localStorage.getItem(KEY) ?? "null"); return x && typeof x === "object" ? { ...EMPTY_CTX, ...x } : EMPTY_CTX; } catch { return EMPTY_CTX; }
}
export function writeCtx(c: Ctx) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage blocked: the context lasts for this page only */ }
  window.dispatchEvent(new Event(EVENT));
}
export function onCtx(f: () => void): () => void {
  window.addEventListener(EVENT, f); window.addEventListener("storage", f);
  return () => { window.removeEventListener(EVENT, f); window.removeEventListener("storage", f); };
}
