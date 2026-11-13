/**
 * Settings > Preferences (SOT, Preferences.dc.html): the folders on this computer. The library folder is the media
 * storage root the API was started with (OTSI_VIE_STORAGE_DIR); the cache folder is OTSI_VIE_CACHE_DIR when the
 * launcher sets one. Either is null when the server does not have it configured — the page says so rather than showing
 * a path that is not real. Read-only: changing a folder is a launcher/desktop concern, not an API write.
 *
 *   GET /v1/settings/storage   the library and cache folder paths
 */
import { Controller, Get, Inject, Injectable, UseGuards } from "@nestjs/common";
import { StorageFolders } from "@otsi-vie/contracts";
import { AuthGuard } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";

@Injectable()
export class SettingsService {
  constructor(@Inject(CONFIG) private readonly cfg: Config) {}

  storage(): StorageFolders {
    return StorageFolders.parse({ library_folder: this.cfg.storage?.dir ?? null, cache_folder: this.cfg.cacheDir ?? null });
  }
}

@Controller("v1/settings")
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("storage")
  storage() {
    return this.settings.storage();
  }
}
