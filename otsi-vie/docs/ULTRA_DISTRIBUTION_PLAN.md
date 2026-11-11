# OTSI VIE ULTRA — Distribution plan (for the repo side)

**From:** the owner, via the Windows build/test session
**Date:** 2026-11-11
**Repo:** ckgefane-blip/otsi-video-intelligence-ultra, branch `muse/ultra-main`

## Why

OTSI VIE is a product for users worldwide. The current desktop app is a developer setup inside a window. It cannot ship to customers:

- On first start it clones the repo with git and runs `pnpm install` and a full build on the user's PC. That needs git, Node 22, pnpm and Python already installed.
- Accounts, users and billing live only in a local MySQL on one PC. A paying user cannot sign in from another machine, and the owner cannot see or bill them.
- The passkey RP ID is `localhost`, so passkeys belong to one PC and not to the product.
- The AI models are copied from the owner's workspace (`.local/models`), so other PCs don't have them.
- Updates arrive as `git pull` plus a rebuild on the user's PC: slow, fragile, and the source code ships to every customer.

## Target model ("DaVinci Resolve" model)

Heavy work runs on the user's own PC. Accounts, licences and money live on one small central server. This is zero cost: no rented GPU or cloud, and the server is the owner's existing hosting.

### 1. Desktop app — one self-contained installer
- Ship pre-built code, never source. Bundle the built API and web (Next.js standalone output), a Node runtime (Electron's own Node, or a bundled `node.exe`) and the workers.
- Bundle Python as an embedded or frozen runtime (python-embed or PyInstaller) with the CPU/OpenVINO wheels. No user-installed Python, no venv build at first run.
- AI models: download on first run from a free host (GitHub Releases or the owner's hosting), checked by SHA-256, saved to a user-chosen data folder. They are never copied from the developer workspace.
- Local data (videos, tracks, renders, project metadata) sits in an embedded database on the user's PC. Keep portable MySQL bundled if the MySQL-only rule must hold (bundle it, don't download it at runtime). Otherwise, propose SQLite in an ADR for owner approval.
- The data folder is user-chosen and defaults to a non-system drive when one exists. No caches go on C: unless it is the only drive.
- No git, pnpm, Node or Python is required on the user's machine.

### 2. Central server — the owner's existing hosting (subdomain + MySQL)
- Accounts, sign-in, passkeys, organisations and teams.
- Licences and entitlements: which plan, which features, the token wallet and seats.
- Billing webhooks from the payment provider, and the audit log.
- The update feed (latest version and download URL).
- It never processes video. Footage stays on the user's PC unless they choose to share an export.
- Owner-only steps: approve the hosting use, the DB creation and any public deploy (CLAUDE.md §5).

### 3. Sign-in and passkeys
- The desktop app signs in against the central server (browser-style OAuth/PKCE flow, or in-app sign-in to the server API).
- WebAuthn RP ID is the product domain (e.g. `otsi.cc` / `vie.otsi.cc`), not `localhost`. Desktop passkeys work through the system browser or by loading the sign-in page from the real domain.
- The app keeps a signed licence token with an offline grace period (e.g. 7–14 days), so analysis works without internet. It re-checks online periodically.

### 4. Updates
- Versioned, signed releases (electron-builder + electron-updater, publishing to GitHub Releases or the owner's hosting).
- Code signing: an unsigned app triggers SmartScreen. Record the free options and their limits in an ADR, and flag the cost for owner approval if paid signing is ever needed.
- Database migrations for the local database run inside the app on update. They are forward-only and tested.

### 5. Payments (subscriptions)
- Use a payment provider with no monthly fee (per-sale fee only), so it fits the zero-cost rule.
- Prefer a "merchant of record" (e.g. Paddle or Lemon Squeezy). It handles worldwide tax/VAT and invoices.
- Final provider choice depends on the country where the owner's business is registered. That is an owner decision; list the options for the owner's region.
- The flow:
  1. Checkout opens in the browser.
  2. The provider's webhook goes to the central server.
  3. The server updates the entitlements.
  4. The desktop app refreshes its licence.
- No card data ever touches the app or the server.
- Real billing activation needs the owner's explicit approval.

## Build order
1. ADR: this architecture (desktop engine + central account server), with alternatives and what changes.
2. Self-contained installer: bundled runtimes, pre-built code, no git or build on the user PC. Test it on a clean Windows VM or user account with no dev tools.
3. Model download plus checksum on first run.
4. Central server: accounts, sign-in, licences on the owner's hosting (staging subdomain first).
5. Desktop sign-in against the server, passkeys on the real domain, offline licence grace.
6. Auto-update feed.
7. Payment provider integration in test mode (owner approval before live).

## Acceptance
- A fresh Windows PC with none of git, Node, pnpm or Python installs the app and finishes first run with no developer tools.
- The same account signs in on two different PCs.
- A passkey made on one PC signs in with that PC's Windows Hello; the RP ID is the product domain.
- A test-mode subscription flips the entitlement and the app sees it within one refresh.
- An update installs from version N to N+1 without losing local projects.

## Constraints that still hold
- Zero cost (CLAUDE.md §9). Never push or deploy publicly without the owner's yes. Never touch the original engine, vie.otsi.cc, or the Docker MySQL containers on this PC.
