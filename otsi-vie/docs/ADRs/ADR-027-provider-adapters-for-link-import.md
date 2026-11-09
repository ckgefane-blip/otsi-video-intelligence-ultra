# ADR-027: Provider adapters for link import; user-supplied authorization; malware scanning

Status: accepted (2026-10-27; owner directive: expand link import through permitted provider methods, never around DRM, access controls,
provider restrictions or copyright; document exactly what works)

## Decision
- One policy file, `packages/contracts/src/providers.json`, is read by the API (up-front refusal with reason), the worker (authority:
  resolution and download) and the web form (shows the provider, its status, the reason and the alternative before submitting). Every
  provider has a status: `supported`, `needs_authorization` (the user supplies their own token for that service's official API), or
  `unsupported` (refused with the reason and a lawful alternative). Unknown hosts are treated as a direct file link (`.m3u8` paths as HLS).
- Adapters (`services/worker/vie_worker/providers.py`) only use documented, permitted download routes: Wikimedia Commons API (original
  file URL + licence/author), Internet Archive metadata API (original video file of the item), Dropbox shared links with `dl=1`, Vimeo API
  `download` links (only offered by Vimeo to the video owner / when downloads are enabled), Google Drive API `alt=media` with the user's
  OAuth token, and HLS VOD playlists without encryption.
- Refused by design: encrypted HLS (`EXT-X-KEY` other than `NONE` → `ENCRYPTED_STREAM`), live streams (no `EXT-X-ENDLIST`), and
  platforms whose terms or APIs do not allow downloading (YouTube, Facebook/Instagram, TikTok, X, Twitch, Dailymotion, Hudl/Wyscout/Veo,
  OneDrive share pages, Streamable). We do not scrape pages, do not run `yt-dlp`-style extractors, and do not use cookies or a browser
  session to obtain a file.
- Tokens: the API seals the user's token with AES-256-GCM (key `OTSI_VIE_CREDENTIAL_KEY`, associated data = the video id) into the
  outbox event; the subscriber copies it to the worker job and removes it from the event in the same transaction; the worker opens it,
  sends it only to the provider's API hosts (never after a redirect elsewhere), and deletes it from the job payload when the job ends
  (success or failure). The audit records `user_authorization: true`, never the token. Without a configured key the API answers 503
  `CREDENTIALS_NOT_CONFIGURED` instead of accepting tokens it cannot protect.
- All existing guards still apply to every request an adapter makes (ADR-023): public addresses only, pinned IP, manual re-checked
  redirects, no https→http, media-type allow-lists, size cap, time-outs, then the same sniff/probe/decode verification as an upload.
- New: every ingested file (upload or link) is scanned for malware before it is accepted (`scanner.py`: Microsoft Defender
  `MpCmdRun -Scan -ScanType 3 -DisableRemediation`, or `clamscan`; `OTSI_VIE_AV_SCANNER`). A detection quarantines the video
  (`MALWARE_DETECTED`); a scanner failure is retried, never treated as clean. When no scanner exists the asset records `not_scanned`.
- Provenance (provider, source page, declared licence, author, title) is stored on the asset. It is what the provider DECLARES; it is
  not a verified rights clearance — the user still confirms they have the rights (the form says so).
- Requests identify the importer (`OTSI-VIE-Ingest/1 …`, Wikimedia User-Agent policy); the operator's contact is optional
  (`OTSI_VIE_HTTP_CONTACT`); no personal data is sent by default.

## Link support (what has been verified, and how)
| Link | Status | Verified |
|---|---|---|
| Direct `https://…/file.mp4/.mov/.mkv/.webm/.ogv` on a public host | works | live (Wikimedia upload host) + offline stand-in tests |
| `commons.wikimedia.org/wiki/File:…` | works | **live**: real match file downloaded, scanned, probed (`tests/test_providers_live.py`) |
| `archive.org/details/<item>` | works (original video file) | **live**: real item downloaded and probed |
| Dropbox shared link `dropbox.com/s…` | works (`dl=1`) | offline stand-in only — no live Dropbox link tested |
| HLS VOD `….m3u8` (unencrypted) | works (highest variant, segments through the guard) | offline stand-in with genuine MPEG-TS segments; not yet against a live CDN |
| HLS encrypted / live | refused | offline tests |
| Vimeo `vimeo.com/<id>` | needs the user's Vimeo personal access token; only if Vimeo offers a download to that user | offline stand-in only — needs a real token to verify |
| Google Drive `drive.google.com/file/d/<id>` | needs the user's OAuth access token (Drive API) | offline stand-in only — needs a real token to verify |
| YouTube | refused: terms and API do not permit downloading. Alternative: the channel owner downloads it in YouTube Studio and uploads it | **live**: refused before any request |
| Facebook/Instagram, TikTok, X, Twitch, Dailymotion, Hudl/Wyscout/Veo, OneDrive, Streamable | refused with reason + alternative (export/download from the service, then upload) | offline tests |

"offline stand-in" = a local test server that answers exactly as the provider's documented API does; it proves our handling, not the
provider's current behaviour. Support for those rows is claimed only after a live check with real credentials.

## Consequences
- Adding a provider is one policy entry plus one adapter function and its tests; the UI and API pick it up from the shared file.
- OAuth sign-in flows (instead of pasted tokens) need registered apps with Vimeo/Google — an owner decision (accounts, terms); not done.
