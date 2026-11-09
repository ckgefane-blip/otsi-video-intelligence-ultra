/**
 * The video (and so its match) the user is working on, carried across pages (v3 Phase 0, P9: Tactical and Library said "No match selected"
 * although Analysis had one open). Every page that opens a video remembers it; a page opened without one starts on it while it still
 * exists. Kept in this browser only, per organization; it is a convenience, never a source of truth (the address always wins).
 */
const KEY = (org: string) => `otsi-vie.current-video.${org}`;

export function rememberVideo(org: string | null | undefined, videoId: string): void {
  if (!org) return;
  try { localStorage.setItem(KEY(org), videoId); } catch { /* storage blocked: nothing carried */ }
}

export function recallVideo(org: string | null | undefined): string | null {
  if (!org) return null;
  try { return localStorage.getItem(KEY(org)); } catch { return null; }
}

/** the remembered video when it is still in the list, else the fallback */
export function pickVideo<T extends { id: string }>(org: string | null | undefined, list: T[], fallback: T | undefined): T | undefined {
  const id = recallVideo(org);
  return (id ? list.find((v) => v.id === id) : undefined) ?? fallback;
}
