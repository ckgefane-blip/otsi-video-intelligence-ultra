# ADR-145: Accept all video links, YouTube and VK included (widens ADR-027)

- **Status:** Accepted on the owner's written instruction, 2026-11-13: "The app should be able to accept all links especially YouTube
  and VK. Fix it" (on the Media page, where YouTube, Facebook, TikTok, X, Twitch, Hudl and Wyscout were struck through as Refused).
- **Date:** 2026-11-13 (Claude, `claude/best-of-both`).
- **Replaces:** the part of ADR-027 that refused platforms whose terms or APIs do not offer downloads, and its rule "we do not run
  `yt-dlp`-style extractors". Every other ADR-027 rule stays: the shared policy file, the token handling for Vimeo / Google Drive, the
  address guard, the size cap, the malware scan and the sniff / probe / decode checks.

## Decision
- `packages/contracts/src/providers.json`: YouTube, VK (vk.com, vk.ru, vkvideo.ru), Rutube, OK.ru, Facebook / Instagram, TikTok, X,
  Twitch, Dailymotion, Hudl / Wyscout / Veo, OneDrive and Streamable are `supported` with `"via": "extractor"`. Nothing is
  `unsupported` at present; the status stays in the contract for the future.
- Worker, `services/worker/vie_worker/extractor.py`: those links are fetched with **yt-dlp** (Unlicense / public domain, free:
  ADR-030 zero-cost rule met; `requirements.txt` pins `yt-dlp==2026.10.21`). A link to any other site that turns out to be a web
  page, not a file, gets a second try through the extractor ("accept all links"); if no video is found the original answer
  ("not a video file") stands.
- Limits kept on purpose:
  - **No sign-in, no cookies, no browser session.** Private, members-only and sign-in-only videos fail with the service's reason.
  - **No DRM circumvention.** Protected streams fail as `ENCRYPTED_STREAM`.
  - **No live streams.** These fail as `LIVE_STREAM`.
  - **One video per link,** never a playlist or channel.
  - The host passes the same public-address guard first (`check_url`), the size cap is passed to yt-dlp, and the job's folder is
    the only place it writes (`cachedir` off).
- FFmpeg: the worker's LGPL build (ADR-029) joins separate picture and sound streams. Without FFmpeg the best single file is taken,
  else the picture alone. Analysis needs only the picture; YouTube now serves picture and sound only as separate streams.
- Provenance on the asset: provider, page, title, uploader (as `author`), licence when the site states one. The user still records the
  footage rights on the Media page (rights holder, basis) before analysis; nothing here is a rights clearance.

## Risk recorded for counsel (not a legal opinion)
YouTube's and several other platforms' terms forbid downloading other than through their own features. Running an extractor
breaches those terms even where the footage is the user's own or licensed. It does not circumvent DRM; DRM content fails, by design.
This is the owner's product decision. Commercial release should keep the rights declaration mandatory, and counsel should review the
terms exposure (docs/legal). Sites change often, and yt-dlp needs regular updates to keep working. Shipping an updatable yt-dlp
inside the installer is a packaging task: the compiled worker build must include the `yt_dlp` package.

## Verification (2026-11-13)
- Offline:
  - `tests/test_extractor.py`: 16 tests (options: no cookies, no playlist, size cap; error → code mapping; network → retry;
    live / too-large refused; yt-dlp missing).
  - `test_providers.py` / `test_url_import.py` resolver tests: 44 pass.
- Live on the owner's PC with the new code:
  - A public YouTube video was downloaded (picture-only fallback, no FFmpeg in this checkout) and sniffed as MP4.
  - A public VK video was downloaded (7.3 MB) and sniffed as MP4.
- Not run in this checkout: the MySQL-backed whole-job tests (`test_providers.py` job tests, `media.api.test.ts`), because there is no
  test-database configuration (`.local/mysql-lint.env`). The installed app's compiled worker does not include yt-dlp until it is rebuilt.
