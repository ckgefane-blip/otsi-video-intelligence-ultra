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
