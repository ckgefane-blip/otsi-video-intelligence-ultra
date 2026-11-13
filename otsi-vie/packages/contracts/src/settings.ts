/**
 * Settings > Preferences (SOT, Preferences.dc.html): the folders on this computer. The library folder is the media storage
 * root the API was started with (OTSI_VIE_STORAGE_DIR); the cache folder is OTSI_VIE_CACHE_DIR when the launcher sets one.
 * Null = not configured on this server — the page says so rather than showing a path that is not real.
 */
import { z } from "zod";

export const StorageFolders = z.object({
  library_folder: z.string().nullable(),
  cache_folder: z.string().nullable(),
});
export type StorageFolders = z.infer<typeof StorageFolders>;
