/** The actions behind every three-dots menu (ActionsMenu): what an item does, and the two shared actions. */
export interface MoreItem {
  label: string;
  /** a page to open */
  href?: string;
  /** an action; a returned string is shown briefly (e.g. "Link copied") */
  run?: () => void | string | Promise<void | string>;
  /** why it cannot run now (dimmed) */
  why?: string;
}

/** copy an in-app address as a full link */
export const copyLink = async (path: string) => {
  try { await navigator.clipboard.writeText(`${location.origin}${path}`); return "Link copied"; } catch { return "Copy failed: your browser blocked the clipboard"; }
};

/** Download a render's MP4 (the signed address the API gives), or say why not */
export async function downloadRender(get: () => Promise<{ download_url: string }>) {
  try { location.href = (await get()).download_url; return "Download started"; } catch { return "Download unavailable: the file could not be fetched"; }
}
