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

### 1b. Packaging — the professional way (owner direction 2026-11-11)
- **Ship one AI runtime.** PyTorch and PaddlePaddle are training frameworks; don't ship them to users.
  - Export every model once, at build time, to ONNX (and OpenVINO IR).
  - Run inference on the user's PC with **ONNX Runtime + DirectML**. That's free (MIT) and uses any Windows GPU: NVIDIA, AMD or Intel. Add the **OpenVINO** runtime for Intel CPUs and GPUs.
  - CPU stays as the fallback.
  - This cuts the ~450 MB Python bundle to roughly 100–150 MB and makes analysis faster on more PCs.
  - Gate: the exported models must match the originals' accuracy on the evaluation set before switching (record the numbers).
- **Local database: SQLite** for each user's on-PC project data; that's the standard for desktop creative apps. **MySQL** stays on the central server (accounts, licences, billing, audit).
  - **Needs the owner's written approval**, because the project rule says MySQL.
  - Until approved, keep portable MySQL bundled.
- **Small installer + component manager.** The installer has the app, the runtimes and the core model pack. Heavier model packs and future language packs install from inside the app: chosen by the user, resumable, SHA-256 checked, signed manifest.
- **Small updates.** electron-updater differential (blockmap) updates, so a code update is megabytes, not the whole installer.
- **Signed releases.** An unsigned app triggers SmartScreen and looks amateur.
  - Evaluate Microsoft Store (MSIX) distribution, where Microsoft signs the package; check the current developer-account fee.
  - Record any cost for owner approval (zero-cost rule).
- **Hardware check at first run.** Detect the GPU, RAM and disk, pick the fastest runtime automatically, and show the user the expected speed. Don't fail silently on weak PCs.
- **Later, macOS.** ONNX Runtime with CoreML runs the same models on Mac. Design paths, codecs and the runtime choice so a Mac build is possible.

### 1c. Native and protected (owner direction 2026-11-11)

**URGENT — source code is public.** `ckgefane-blip/otsi-video-intelligence-ultra` is a PUBLIC GitHub repo (checked 2026-11-11 via the GitHub API: `"visibility": "public"`). Anyone can copy the whole engine.
- The owner makes it private (GitHub → Settings → Danger zone → Change visibility).
- The current test app clones it without signing in, so it will stop updating until the new installer (no git on user PCs) replaces it. That's acceptable.

**Native code, no readable source on user PCs:**
- **Engine (Python):** compile it to native machine code with **Nuitka** (free, Apache-2.0) before packaging, so no `.py` files ship. Move speed-critical parts (tracking, spotlight compositing) to C++ or Rust over time.
- **AI inference:** ONNX Runtime and OpenVINO are native C++ already.
- **API and UI (JavaScript):**
  - Bundle and minify them, and compile the main-process code to V8 bytecode (bytenode, free).
  - Enable Electron fuses: disable `RunAsNode` and the Node inspector, and turn on ASAR integrity.
  - Pack everything in an integrity-checked ASAR.
- **Shell:** Electron for now (fastest path). Record an ADR on a later move to a native shell (Qt/C++, as DaVinci uses, or Tauri/Rust with WebView2), with a cost and effort estimate. Don't switch without owner approval.
- **AI model files:** encrypt them at rest. The app decrypts them in memory only with a valid licence. Each model has a checksum.
- **Licence enforcement:** a server-signed licence token (Ed25519) checked inside the compiled native code, plus tamper detection. Never trust a plain flag.
- **Code-signed** installer and binaries (see 1b).

**Clean ownership (so it can be protected):**
- Keep `docs/legal/LICENSE_REGISTER.md` current. Ship **nothing AGPL or GPL**.
- **Prefer SQLite (public domain) over bundling MySQL.** The register itself says embedding/distributing MySQL needs Oracle commercial terms; this is another reason for the SQLite decision.
- Ship third-party notices (MIT/Apache attributions) in the app's About → Licences.
- Add a proprietary EULA in the installer, plus a copyright notice ("© Osio & Tee Solutions International Ltd") in the app, the files and the exports.
- Make sure every contributor (people and AI-assisted work) assigns rights to the company in writing.

**Legal protection (owner + counsel; may cost fees, so owner decides):**
- **Copyright:** automatic. Keep dated records (git history, release archives). Optional: voluntary notification with the Nigerian Copyright Commission.
- **Trademark:** register "OTSI VIE" and the logo, first in Nigeria, then via WIPO Madrid for key markets.
- **Patent:** software patents are hard to get and costly. Have counsel assess whether any novel method (e.g. identity-confirmed spotlight tracking) qualifies before any public disclosure. Until then, keep those methods as trade secrets: compiled, private repo, NDAs.

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

**Owner decision (2026-11-11): bank transfer is the main payment method. Online card payment shows "Coming soon" for now: visible, disabled, never charging.**

#### 5a. Bank transfer (build now)
1. **Order.** The user picks a plan and period in the app or on the web account page. The central server creates an order with a unique payment reference (e.g. `OTSI-INV-2026-000123`) and a price.
2. **Invoice.** The user sees a pro-forma invoice (on screen and as a PDF) with:
   - the owner's bank details (account name, bank, account number, SWIFT/IBAN for foreign payers, currency);
   - the amount and currency;
   - the reference, with "put this reference in your transfer description";
   - the order's expiry date.
   Bank details are entered by the owner in the admin console and are never hard-coded.
3. **Proof (optional).** The user can upload a transfer receipt (PDF or image) and mark "I have paid". The order shows "Awaiting confirmation".
4. **Confirmation.** The owner, or an admin with the billing role, sees pending orders in the admin console. They confirm after checking the bank statement: amount received, date, bank reference. Partial payment, reject with a reason, and refund are also recorded.
5. **Activation.** Only that confirmation activates the plan: entitlements, seats and token wallet. The user gets a final invoice/receipt and an email/in-app notice. The desktop app picks the change up on its next licence refresh.
6. **Renewals.** Before expiry the user gets a renewal invoice with a new reference (e.g. 7 days before). After expiry, a grace period, then the plan drops to the free tier. Projects are kept and never deleted.
7. **Audit.** Every order and status change is in the audit log: created, proof uploaded, confirmed by whom, amount, rejected, refunded. Nothing activates without a human confirmation.
- Currencies: NGN for local payers and USD for foreign payers. The owner sets which bank account applies to each currency.
- Zero cost: no provider and no fees beyond the owner's own bank charges.

#### 5b. Online payment — "Coming soon" (design only, build later)
- The plan page shows "Pay online — Coming soon": disabled, with no checkout code active. It must never charge or collect card data.
- Later: use a provider with no monthly fee (per-sale fee only) with no monthly fee (per-sale fee only), so it fits the zero-cost rule.
- Prefer a "merchant of record" (e.g. Paddle or Lemon Squeezy). It handles worldwide tax/VAT and invoices.
- The owner's company is registered in **Nigeria** (private company limited by shares). The plan names two candidate providers, and the owner picks:
  - **Paystack:** international Visa/Mastercard; USD payouts need a Zenith Bank USD domiciliary account. Confirm that USD recurring billing works.
  - **Paddle:** merchant of record that handles global VAT. Confirm with Paddle that Nigeria is accepted for sales and payouts.
- Keep the provider behind one billing adapter, so it can be swapped or a second one added.
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
7. Bank-transfer billing: orders, invoices with reference, proof upload, admin confirmation, activation, renewals.
8. "Coming soon" online-payment button (disabled). The provider integration comes later, in test mode first, with owner approval before live.

## Acceptance
- A fresh Windows PC with none of git, Node, pnpm or Python installs the app and finishes first run with no developer tools.
- The same account signs in on two different PCs.
- A passkey made on one PC signs in with that PC's Windows Hello; the RP ID is the product domain.
- A bank-transfer order shows the owner's bank details and a unique reference. The plan stays inactive until an admin confirms the payment, then activates, and the app sees it within one refresh.
- "Pay online" shows "Coming soon" and cannot be clicked through to any payment.
- An update installs from version N to N+1 without losing local projects.

## Constraints that still hold
- Zero cost (CLAUDE.md §9). Never push or deploy publicly without the owner's yes. Never touch the original engine, vie.otsi.cc, or the Docker MySQL containers on this PC.
