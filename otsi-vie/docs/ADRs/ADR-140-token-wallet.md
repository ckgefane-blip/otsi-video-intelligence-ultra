# ADR-140: Token Wallet & Credit System (DRAFT, owner approval pending, ultra-only)

- **Status:** Draft. This ADR records the Token Wallet build on `muse/ultra-main`; it needs owner approval before it is
  presented as accepted. It changes no accepted ADR. **Ultra-only:** the number 140 is the next free number in ultra
  (ultra is at ADR-139 after the i18n work). Antigravity built their own token wallet in their repo (their ADR-134);
  this build is written from the scope document alone — no Antigravity code was read or copied — and the two must
  never be merged (see the migration collision note in §1).
- **Date:** 2026-11-11 (Muse, `muse/ultra-main`)
- **Scope:** `workspace/goals/otsi-video-intelligence-engine/files/token-wallet-scope/token-wallet-scope.md`
  (scoped 2026-11-10, packs and free tier approved by Awore 2026-11-10). Roadmap Phase 4 — Sell it, after the 3–5
  paid pilots. This build puts the mechanism in place; it does not change anything in Phases 1–3, and the managed
  service (bank-transfer invoice) stays the way paying clients are served until Phase 4.

## 1. Numbering: migration 0071

Ultra is at migration 0069. Antigravity used 0067, 0068, 0069 **and 0070** in their own repo for different things
(their 0067 is billing, ultra's 0067 is Player Profile Intro; their 0070 is also a wallet). This build uses **0071**
because it is the next number free in both series as far as ultra can see. The migration file records this, and the
warning stands: a future collision is still possible if their series reaches 0071 for something else. If that ever
happens, the merge is the problem, not this number — never renumber a migration that has run anywhere.

## 2. Decisions

### What a token is, and what it buys

- 1 token = 1 minute of match footage analysed. Analysis costs 1 token per **started** minute
  (`analysisCostTokens`: `ceil(duration_us / 60s)`); a video with no measured duration cannot be priced, so its
  analysis is refused (409 `VIDEO_DURATION_UNKNOWN`) rather than charged a guessed number.
- Reel render, player report and export pack cost 10 tokens each.
- **Charged at enqueue, in the same database transaction as the job's own insert** — a job that fails to enqueue
  charges nothing, because the ledger row rolls back with it. Insufficient balance refuses the job with
  402 `INSUFFICIENT_TOKENS` and a plain message; nothing starts half-paid; balances never go negative.
- **A job that is already running always completes** (scope §2): charging happens once, at enqueue, never again.
- **Auto-refund on failure before producing output** (scope §2): a `REFUND` row returns the `SPEND`'s tokens.
  Wired where the API itself knows the job failed: player report generation (synchronous, in `makeReport`), and
  cancellation of a run/render that never started (`QUEUED`). A run/render already `RUNNING` has done work: its
  tokens stay spent. See §7 for what is **not** wired.
- **Low-balance warning below 90 tokens** (scope §7: the cost of one full match), shown on the Wallet page.

### The ledger is the wallet

- `wallet_ledger` is the only record of tokens. **There is no balance column anywhere.** The balance is the sum of
  the ledger rows; the spendable balance is computed from the same rows by FIFO on expiry (debits are spent from
  the credit that expires soonest first). The pure math lives in `packages/contracts/src/wallet.ts` so the API and
  the unit tests use the same functions.
- The ledger is **immutable**: `BEFORE UPDATE` and `BEFORE DELETE` triggers refuse both, for anyone including the
  retention role. A wrong row is corrected by a new `ADJUSTMENT` or `REFUND` row that says so in its reason —
  never by rewriting history. `tools/db/roles.py` lists `wallet_ledger` as append-only (SELECT + INSERT for the
  runtime account).
- Every `SPEND` references its job (`job_type` + `job_id`, enforced by CHECK); every `PURCHASE` references its
  invoice (`invoice_ref`, enforced by CHECK). Charges and refunds are idempotent per job
  (`spend:<type>:<id>`, `refund:<type>:<id>`): charging or refunding the same job twice returns the first row.
- Mutations for one organization are serialized by locking the organization's own row (`SELECT ... FOR UPDATE`
  on `organizations`) before the ledger is read, so two concurrent charges cannot both pass on the same balance.
  The lock is transactional — held until the transaction commits or rolls back — which is why a named `GET_LOCK`
  was not used: it is held by the session, not the transaction, and would leak across pooled connections.
- **Expiry:** a credit row carries `expires_at` — 12 months after a purchase, 30 days after the free grant.
  Expired tokens are **not** silently dropped from the balance: an `EXPIRY` row is written for them (Admin "Write
  off expired tokens"), so the ledger always explains the balance. No refund on expiry (scope §3).

### Packs, prices, free tier

- The four packs exactly as approved 2026-11-10 (scope §3): Starter 100 tokens ₦15,000, Club 500 ₦60,000,
  Academy 1,200 ₦120,000, Season 3,000 ₦250,000; international tier $49 / $199 / $399 / $899. Naira prices are
  the real prices (main market Nigeria); the dollar equivalents use ≈ ₦1,350/$1 from the scope.
- **These prices are recommendations, not measured costs.** They must be validated against the unit-cost worksheet
  once the owner fills in host/analyst rates and margin, and confirmed by the paid pilots (scope §3). The catalogue
  is data in `TOKEN_PACKS`, not scattered literals, so a validated price change is one edit.
- **Free tier:** 25 tokens, once per organization, expiring 30 days after signup (scope §4). One grant per
  organization is enforced by `wallet_free_grants` (one row per organization, primary key). The scope says "one
  grant per organisation (verified email)": **there is no `email_verified` column on `users`** — email verification
  lives with the identity provider, not in this database — so the grant records the requesting member's email as
  the email of record, and the one-grant rule is enforced by the table, not by a verification flag this database
  does not have. If email verification ever needs enforcing in-app, that column (and the IdP claim to fill it) is
  a separate change.

### Paying by bank transfer (now)

- Request a pack in-app → the owner issues an invoice (invoice reference) → the organization pays by bank transfer
  → the owner confirms receipt in Admin → the wallet is topped up and the ledger records a `PURCHASE` with the
  invoice reference. The organization sees the new balance and the ledger row; that row is its receipt.
- **No online payment, no Stripe, no payment gateway code anywhere in this build** (scope §5). The existing
  billing schema (`billing_customers`, `subscriptions`, `invoices`, `billing_webhook_inbox`, `plan_versions`,
  `entitlement_grants`, migration 0001) is untouched; the wallet/ledger is additive. Online payment (Paystack or
  Flutterwave for Nigeria, scope §6) is a future update that only changes how a `PURCHASE` row gets written.
- Refunds are manual and owner-approved. A refund **to** the wallet is a `REFUND` row. A money refund that claws
  tokens back is a **negative `ADJUSTMENT`** with the refund stated in its reason — the `REFUND` kind is reserved
  for tokens returning to a wallet, so the two directions are never confused.

### Admin

- Admin sees the organization's wallet and full ledger, tops up (a `PURCHASE` with an invoice reference), refunds,
  and adjusts — every one with a reason recorded in the ledger (scope §8). The expiry sweep writes `EXPIRY` rows.
- **Scoping, and the known limit:** this codebase has no platform-wide owner role — Admin is the organization's
  own `OWNER` / `ADMIN`, the same scoping as the Admin console. Wallet Admin therefore acts only on the caller's
  own organization and the API refuses any other organization with 403 `WALLET_ADMIN_OTHER_ORG`. In the current
  single-tenant deployment the organization's `OWNER` is the engine owner, so the pack confirm flow is performed
  by them. Before Phase 4 production use with customer organizations, a platform-owner role (or owner membership
  in each customer organization) must be decided — until then these endpoints must only be exposed where org
  `OWNER`s are trusted staff, because the separation between "the organization" and "the owner who confirms its
  payment" is not yet enforced by a role.

## 3. What was built

- **Migration 0071** (`otsi-vie/database/migrations/0071_token_wallet.sql`): `wallet_ledger`, `wallet_pack_requests`,
  `wallet_free_grants`, immutability triggers.
- **Contracts** (`packages/contracts/src/wallet.ts`): zod schemas for ledger entries, balances, packs, pack
  requests and admin actions; the pack catalogue; and the pure ledger math (`analysisCostTokens`, `balanceOf`,
  `spendableBalance` FIFO on expiry, `deriveWalletBalance`, `chargeRefusal`, `expiredCreditTokens`).
- **API** (`apps/api/src/modules/wallet/wallet.ts`): `WalletService` (`charge`, `refundForJob`, `credit`,
  `grantFreeTier`, `expireCredits`, pack request / invoice / confirm / cancel, Admin list / top-up / refund /
  adjust) with `WalletController` (`/v1/wallet…`) and `AdminWalletController` (`/v1/admin/wallet…`, `OWNER`/`ADMIN`).
- **Charging wired at enqueue:** analysis (`insertRun`, via `AnalysisService.start` and the library removal re-run),
  reel render (`ReelsService.startRender`, each file of a batch render charges 10), player report
  (`PlayerReportService.makeReport`), export pack (`ExportsService.createBundle`). An export pack that embeds a
  fresh player report charges the pack's 10 tokens once, not the report's 10 as well. (If the wallet cannot cover
  the re-run after a removal restore, the restore still succeeds and the re-run is skipped, like the rights case —
  the analysis can be started manually once funded.)
- **Web:** Wallet page (`/settings/wallet`: balance, low-balance warning, free-grant claim, pack catalogue in NGN/USD,
  pack requests, ledger) and Billing page (`/settings/admin/billing`: wallet, pack requests with issue-invoice /
  confirm-receipt, top-up / refund / adjust with reasons, expiry sweep, ledger), linked from the account menu and
  the command palette.
- **Tests:** pure ledger/balance/charge/refund unit tests in the web suite (run without MySQL);
  `apps/api/test/wallet.api.test.ts` (needs MySQL 8.4 on 127.0.0.1:3507, via the host runbook). Test organizations
  are funded by `seedWallet` in `apps/api/test/helpers.ts` so pre-existing flows that enqueue keep working.

## 4. Verification (this build)

- Contracts build: `tsc` clean (dist rebuilt so the web suite imports the new code).
- API typecheck: clean apart from the known pre-existing errors (`pressing.ts` sliceFor, `exports.ts:211`,
  `test/events.api.test.ts`, `test/load.api.test.ts`).
- Web typecheck: clean apart from the 1 known pre-existing error (`test/formationsPanel.test.tsx` `assigned_by`).
- Web suite: all tests pass, including the new `test/wallet.test.ts` (pure ledger math).
- Web production build: 25/25 pages.
- **Not run here:** the API DB tests (`wallet.api.test.ts` included) — they need MySQL 8.4 on 127.0.0.1:3507 on
  the owner's host. No click-through and no live verification are claimed.

## 5. Honest gaps and simplifications

1. **Auto-analysis is not charged.** The outbox `jobs.auto_analysis` subscriber (video ingested → "Send to
   Analysis") is a plain function with no services to inject, so `insertRun` receives no wallet there. Analyses
   started from an upload therefore enqueue without a charge in this build. Wiring it needs the dispatcher to
   provide services to subscribers — a real refactor, recorded here rather than faked.
2. **Worker-side failures are not auto-refunded yet.** A pipeline run or render that fails is marked `FAILED` by
   the Python worker (`services/worker`), not by this API, and the worker does not call `refundForJob` yet. The
   refund function exists and is idempotent per job; the worker change is the follow-up. What **is** wired: the
   player report (synchronous, fails in the API) and cancellation of a queued run/render.
3. **Refunded tokens carry no expiry.** The expiry of the credit a refunded token came from is not tracked per
   token, so a `REFUND` row has no `expires_at`. A spend-and-refund loop could in principle extend an expiry; the
   amounts are small and every refund is an owner-visible ledger row, but per-token expiry tracking is the proper fix.
4. **An export pack whose items all fail is not refunded.** The pack's 10 tokens pay for the pack being made; a
   single item failing does not refund it (the other items were produced). If no item at all can be made, the pack
   still stands charged — the owner can refund it manually with a reason.
5. **Admin is own-organization only** (§2, Admin) — cross-organization billing admin needs a platform-owner role.
6. **The free grant's "verified email" is not enforced in-app** (§2) — no `email_verified` column exists.
7. **Wallet pages are English-only for now.** The i18n system (ADR-139) covers nav/common/titles; the wallet
   strings were not translated into RU/ES/DE/FR in this build — an i18n follow-up.
8. **Pack prices are unvalidated recommendations** (§2) — the unit-cost worksheet and the paid pilots still have to
   confirm them before they are presented as final.

## 6. Alternatives considered

- **Storing a balance column on the organization** — rejected: a stored balance can drift from the ledger, and the
  scope requires the balance to be derived. Every read sums the ledger; every write records `balance_after`.
- **Charging in `insertRun` unconditionally** — rejected for the auto-analysis path (§5.1): the subscriber has no
  wallet to pass. The charge is an optional parameter there, so the choke point is one function and the unwired
  caller is visible at its call site.
- **Letting an organization confirm its own pack payment without an invoice** — rejected: `confirmReceipt`
  requires the `INVOICED` state, so the invoice step cannot be skipped.
