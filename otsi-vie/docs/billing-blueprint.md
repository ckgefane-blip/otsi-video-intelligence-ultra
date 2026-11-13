# OTSI Video Intelligence Engine — Billing & Pricing Blueprint

**Date:** 13 November 2026 (updated after the push of the order-list fix, branch tip remote `609ecc5`).
**Status:** Approved numbers are APPROVED and may be built. Anything marked PROPOSAL or OPEN is not approved and must not be built until the owner says yes.
**Built on:** ADR-140 (Token Wallet), ADR-144 §1.7 (bank-transfer billing for plans), the payment circle (branch `muse/payment-circle`, tip remote `609ecc5`, pushed 2026-11-13), adopted base `claude/best-of-both` at `6c7110f`.
**Market:** Nigeria first (Naira), USD for foreign payers. Company: Osio & Tee Solutions International Ltd (Nigeria, private company limited by shares).
**Commit names:** all commit names in this document are the REMOTE names as GitHub shows them. Local SHAs from Muse's machine do not exist on GitHub and must never be used in this document. Map (local → remote): payment circle c110f74 → `c3c12646`; free-grant revert 66db384 → `6238383f`; live token display 64dd088 → `4028dbfc`; ActivityLine global 1e6c83b → `0eaf0b36`; bank-account lock 31dfc73 → `556d160a`; four admin locks 2c2e6d9 → `6f2a6406`; refund-on-failure ee66527 → `c801c8d8`; Export batch cost preview eeb7a60 → `85974604`; order-list fix + test fixes 5cf67cc → `609ecc5` (branch tip).

---

## 0. How to read this document (the unambiguity rule)

This document is a specification. Any developer — human or AI — who implements it must arrive at the same output. That is the test: if two developers read this and build different things, the document has failed, and the document must be fixed, not the developers.

- **MUST** means the rule is mandatory. An implementation that breaks it is wrong.
- **APPROVED** means the owner has agreed it. It may be built.
- **PROPOSAL** means someone proposed it and the owner has NOT agreed it. It must NOT be built until the owner says yes.
- **OPEN** means no decision has been made. The decision, and who makes it, is stated.
- Every number in this document is exact, and its source in code is named. Where a number is a rounded display of an exact value, the exact value is given first.
- Money is stated in major units (₦, $) for reading and in minor units (kobo, cents) where the code stores it. 1 Naira = 100 kobo. 1 USD = 100 cents.

---

## 1. Normative invariants (MUST hold in any implementation)

1. **Tokens are the only currency.** Every engine action that costs compute is priced in tokens. There is no other way to pay for engine work.
2. **The balance is derived from the ledger.** The balance is the sum of every row in the token ledger. No row is ever trusted on its own. The balance is never a typed-in number.
3. **The ledger is immutable.** A ledger row is never edited or deleted. Corrections are new rows.
4. **No negative balances.** An action MUST NOT start unless the wallet holds enough tokens for its full cost. The wallet can never go below zero.
5. **Charged at enqueue.** When a job starts, its full token cost is taken from the wallet immediately. The user sees the balance drop at the moment they start the job.
6. **Auto-refund on failure.** If a job fails after being charged, the tokens are refunded automatically, and the refund is shown to the user. (Built: `c801c8d8`. Before that commit the server only refunded a job cancelled before it started.)
7. **No silent spending.** The user MUST see the cost before they start, see the tokens move while the engine works, and see a receipt after. Nothing is charged without the user knowing. (The Export batch path now shows the cost preview too: `85974604`.)
8. **A video with no measured duration cannot be priced.** The cost function returns null for it, and the caller MUST refuse it rather than charge a guessed number.

---

## 2. The token — exact definition

**1 token = 1 started minute of footage analysed.** That is the unit. Everything else is priced from it.

### 2.1 Exact constants (source: `otsi-vie/packages/contracts/src/wallet.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `TOKEN_COSTS.analysisPerMinute` | 1 | Tokens per started minute of footage analysed. |
| `TOKEN_COSTS.reelRender` | 10 | Tokens per reel render. |
| `TOKEN_COSTS.playerReport` | 10 | Tokens per player report. |
| `TOKEN_COSTS.exportPack` | 10 | Tokens per export pack (Scouting Pack). |
| `TOKEN_COSTS.aiAnalysis` | 10 | Tokens per AI Analyst assessment. |
| `LOW_BALANCE_THRESHOLD` | 90 | Below this balance, the wallet warns the user. |
| `FREE_GRANT_TOKENS` | **100** | Tokens in the one-time free grant. Owner decision 2026-11-14 ~02:33 (back to 100; the 25 set earlier the same day cannot show a full match + reel). **Built** on `claude/billing-merge` (2026-11-13) as 100, changed to 25 on 2026-11-14, back to 100 on 2026-11-14 ~02:33: contracts `FREE_GRANT_TOKENS = 100`. Migration 0076 sets the column default to 100, but the API always writes the value explicitly, so the default is not used. |
| `FREE_GRANT_EXPIRY_DAYS` | 30 | Days after signup before the free grant expires. |
| `PACK_EXPIRY_MONTHS` | 12 | Months after purchase before paid tokens expire. |

### 2.2 The analysis cost formula (source: `analysisCostTokens` in `packages/contracts/src/wallet.ts`)

```
analysisCostTokens(durationUs) = ceil(durationUs / 60,000,000) × 1
```

- `durationUs` is the measured duration of the footage in microseconds.
- The result is rounded UP to the next whole minute (a 90-minute-and-1-second match costs 91, not 90).
- If `durationUs` is null, undefined, not a finite number, or ≤ 0, the function returns `null`. The caller MUST refuse the action, not charge a guessed number. (Invariant 8.)

### 2.3 How tokens are obtained

| Source | Tokens | Rule |
|---|---|---|
| Free grant | **100, once** | **NOT granted automatically at signup.** The customer claims it by pressing a "Claim Free grant" button in the Wallet. One click gives 100 tokens straight away, no approval, once per organisation, expiring 30 days after signup. Enforced by the `wallet_free_grants` table (one row per organisation). A second claim is rejected with HTTP 409 `FREE_GRANT_ALREADY_CLAIMED`. |
| Player pack (one-off) | 100 | One-off purchase, bank transfer. Expires 12 months after purchase. |
| Plans (subscription) | 300 / 1,000 / 3,000 / 6,000 per month | Monthly or 12-month subscription, bank transfer. See §5.2. |
| Top-up (blocks) | 100 per block (Naira) | A top-up costs the same per token as the customer's own plan (see §5.4). Sold in blocks of 100 tokens (one match + its reel). |
| Admin top-up | Any amount | The owner adds tokens manually against an invoice, with a reason. Endpoint: `POST /v1/wallet/:organizationId/topup`. OTSI-only (see §6.4). |
| Refund / adjustment | Clawed back or added | A refund claws the granted tokens back from the wallet. See §6.4. |

**PROPOSAL (not approved):** also show the "Claim Free grant" button next to the token count at the top of the app while it is unclaimed, so a new user cannot miss it. The button already exists in the Wallet; only the extra placement is proposed.

### 2.4 Expiry

- Free grant: 30 days after signup. Unspent free tokens expire. There is no refund on expiry.
- Paid tokens (packs and plans): 12 months after purchase. Unspent paid tokens expire. There is no refund on expiry.
- A subscription that expires drops to the Free tier after a 14-day grace period. See §6.5.

---

## 3. What everything costs — in tokens

### 3.1 The price list (exact)

| Engine work | Tokens | Rule |
|---|---|---|
| Analyse footage | 1 per started minute | `analysisCostTokens(durationUs)`. See §2.2. |
| Render a reel | 10 per reel | Flat, whatever the reel length (up to the 5:00 cap). |
| Player report | 10 per report | Flat. |
| Export pack (Scouting Pack) | 10 per pack | Flat. |
| AI Analyst assessment | 10 per assessment | Flat. |
| Browsing, searching, watching, tactical board, Clip Studio editing | 0 | Free. No tokens. You pay for compute, not for looking. |

### 3.2 How many tokens for what quantity of video (exact)

| What the user does | Tokens | Arithmetic |
|---|---|---|
| Analyse 1 minute of footage | 1 | 1 × 1 |
| Analyse a 5-minute clip | 5 | 5 × 1 |
| Analyse a 30-minute clip | 30 | 30 × 1 |
| Analyse a 45-minute half | 45 | 45 × 1 |
| Analyse a 90-minute match | 90 | 90 × 1 |
| Analyse a 2-hour match (120 min) | 120 | 120 × 1 |
| One full match + its reel | 100 | 90 + 10 |
| One full match + reel + player report | 110 | 90 + 10 + 10 |
| One full match + reel + report + export pack | 120 | 90 + 10 + 10 + 10 |
| One full match + reel + report + export + AI Analyst | 130 | 90 + 10 + 10 + 10 + 10 |
| One 2-hour match + its reel | 130 | 120 + 10 |
| 5 full matches, each with a reel | 500 | 5 × 100 |
| 12 full matches, each with a reel | 1,200 | 12 × 100 |
| 30 full matches, each with a reel | 3,000 | 30 × 100 |

This is why the packs are sized the way they are: **100 tokens is one full match plus its reel.**

### 3.3 The low-balance line (exact)

**Below 90 tokens the wallet warns the user.** 90 is `LOW_BALANCE_THRESHOLD`, the cost of analysing one full match. The warning must state that a full 90-minute match plus its reel needs 100 tokens, and must offer the path to buy a pack.

---

## 4. The live token display — billing scope ONLY

### 4.1 Scope boundary (read this first)

This section specifies ONLY the billing-facing live token display. It does NOT specify the full ActivityLine narration.

- **In scope for this blueprint (MUST be built):** the six items in §4.2. They are the live display of token usage. They are part of billing.
- **Out of scope for this blueprint (MUST NOT be built as part of billing):** the full ActivityLine narration — the engine's presence across the whole app, narrating every engine action step by step in words. That is a separate feature, owned separately, and it is NOT specified here. (Built: `0eaf0b36` — live narration with real-time timing across all 11 worker job kinds, uploads with real %, failures narrated 15 minutes with "refunded" only when a REFUND row exists.)
- The only overlap is item §4.2(3), the live job readout. This blueprint requires that the readout exist and show the tokens committed and the job's progress. It does NOT require, and does NOT specify, the full ActivityLine. A developer implementing this blueprint MUST implement §4.2(1)–(6) and MUST NOT treat the full ActivityLine as part of this blueprint.

### 4.2 What the user MUST see (six items)

**(1) The token meter (top bar, always visible).**
The live balance, always on screen. When a job starts, the balance drops by the job's full cost at that moment (charged at enqueue), so the user sees the spend the instant it happens. It MUST NOT change silently in the background.

**(2) The cost preview (before anything is charged).**
Before any charged action starts, the user MUST see the exact cost and confirm it. Format: `Analyse <match name> (<minutes> min) — <cost> tokens. Balance <before>. After: <after>.` with [Cancel] and [Continue]. If the balance is too low, the action MUST NOT start. The button MUST state how many more tokens are needed and offer to buy a pack. The Export batch ("Render only") shows the total (renders × 10 tokens) before starting.

**(3) The live job readout (while a job runs).**
For the job running right now, the user MUST see:
- What the engine is doing, step by step, in words — not a ticking dot. Example words: "Analysing minute 34 of 90…", "Tracking players…", "Rendering reel…".
- How many tokens this job has committed.
- How many minutes of footage it has covered so far, against the total (minute X of 90).
- If the job fails, the refund: "Render failed. 10 tokens refunded."

**(4) The receipt (after every charge).**
After each action, the user MUST see what was spent: "Analysis used 90 tokens. Balance: 30." Every charge is a ledger row the user can open, with the date, the action, and the invoice reference where it came from a purchase.

**(5) The usage history.**
A view of where the tokens went: per day, per week, per month, broken down by action (analysis, reel render, report, export, AI Analyst). The ledger holds the data; the view must present it. Known limitation: "This week" / "This month" mean the last 7 / 30 days, not calendar periods, and only the latest 200 ledger rows are counted.

**(6) The low-balance warning.**
Below 90 tokens the wallet MUST warn (see §3.3), and the path to buy a pack MUST be one click away (File → Buy tokens, or the wallet).

### 4.3 How this works with charge-at-enqueue (exact)

Because the full cost is known the moment a job starts (the footage length is known), the charge happens at enqueue and the live display shows the committed tokens plus the job's progress. The balance does NOT tick down minute by minute. It drops once, by the full job cost, when the job starts, and the progress display shows the work advancing. If the job fails, the refund is shown immediately. The user is never charged for work that did not happen, and never surprised by a charge after the fact.

### 4.4 Build state (exact)

| Item | State |
|---|---|
| (1) Token meter in the top bar (balance) | Built. Shows the live balance. |
| (2) Cost preview before a charged action | **Built** (`4028dbfc`), including the Export batch preview (`85974604`). |
| (3) Live job readout with tokens committed | **Built** (`4028dbfc` + ActivityLine global `0eaf0b36`). |
| (4) Receipt after every charge | Built in the ledger; the receipt view is in the payment circle. |
| (5) Usage history (per day/week/month, by action) | **Built** (`4028dbfc` — Today / This week / This month tabs, per-action rows). See the §4.2(5) limitation. |
| (6) Low-balance warning (below 90) | Built (wallet + live billing page note). |

---

## 5. The pricing — the numbers (APPROVED grassroots price list, 2026-11-13)

**Exchange rate (APPROVED 2026-11-13): ₦1,500 = $1.** Naira is the base; dollar prices are derived from this one rate. Exact dollar values are given below. **PROPOSAL (not approved):** round dollar prices to whole dollars — $2 / $5 / $13 / $30 / $50 / from $167. Until the owner approves rounding, the exact values are the prices.

### 5.1 Free tier (APPROVED)

| Field | Value |
|---|---|
| Tokens | **100, once per organisation** (claim button — see §2.3; NOT automatic at signup) |
| Expiry | 30 days after signup |
| What it buys | One full match + its reel (90 + 10 = 100) |
| Price | Free |

### 5.2 Plans and packs (APPROVED)

Source: `PLAN_CATALOGUE` in `otsi-vie/packages/contracts/src/bank-transfer.ts` (built 2026-11-13) — each plan carries its monthly price, tokens, upload limit per video and top-up block price; the Wallet's top-up offer (`tokenPackCatalogue` in `src/wallet.ts`) reads the same rows, so there is one price list. Prices are stored in minor units (kobo / cents) and shown here in major units. Dollar prices are naira ÷ 1,500, rounded to the cent (rounding still OPEN).

| Plan | Tokens | Naira | USD (exact at ₦1,500=$1) | USD (rounded — PROPOSAL) | Per token (NGN) | What it covers |
|---|---|---|---|---|---|---|
| Free | 25, once | Free | Free | Free | — | A first try — a short analysis and a reel |
| Player pack (one-off) | 100 | ₦3,000 | $2.00 | $2 | ₦30 | 1 match + reel |
| Starter (per month) | 300 | ₦7,500 | $5.00 | $5 | ₦25 | ~3 matches + reels a month |
| Club (per month) | 1,000 | ₦20,000 | $13.33 | $13 | ₦20 | ~10 matches + reels |
| Academy (per month) | 3,000 | ₦45,000 | $30.00 | $30 | ₦15 | ~30 matches + reels |
| Season (per month) | 6,000 | ₦75,000 | $50.00 | $50 | ₦12.50 | ~60 matches + reels |
| Enterprise (per month) | Agreed | From ₦250,000 | From $166.67 | From $167 | Agreed | Unlimited upload, "Contact us", agreed support |

- Per-token price falls as the plan grows (₦30 → ₦12.50): a volume discount. Academy costs more than Club in total because it includes 3× the tokens (3,000 vs 1,000/month) for an academy running several age-group teams — not because its per-token price is higher.
- **12 months costs 10 monthly payments (2 months free).** 12-month totals: Starter ₦75,000 ($50.00), Club ₦200,000 ($133.33), Academy ₦450,000 ($300.00), Season ₦750,000 ($500.00), Enterprise as agreed.
- **Tokens credited on confirm:** `planTokens` = `tokens_per_month × periodMonths`, credited in ONE PURCHASE row when the order is confirmed. A 12-month Starter order credits 300 × 12 = 3,600 tokens at once; Club 12,000; Academy 36,000; Season 72,000. The tokens are a lump grant at confirmation, not a monthly drip.
- **Periods:** an order can buy 1 month or 12 months only (`PlanPeriodMonths` = `1 | 12`). No other period exists.
- **Free is the drop-to tier.** After a subscription expires plus the 14-day grace period, the organisation drops to Free. Free is never something an order can buy.
- **Enterprise is sold as "Contact us"** with a custom price agreed with the customer (from ₦250,000 / from $166.67 a month), then a bank-transfer invoice raised from Admin › Billing. No fixed token count; agreed per customer.

### 5.3 Plans by features, not GB (PROPOSAL — final table awaiting the owner's yes)

Plans are separated by what the customer can do, not by upload size. Tokens stay as the payment for work done; each plan unlocks features; the GB limit stays as a minor extra, not the main selling point. Every plan keeps: upload, analysis, confirming players, Clip Studio editing, Library, search and the cost preview. Tokens still pay for the work. Each plan includes everything in the plans above it.

| Plan | Unlocks | Staff accounts | Upload (per video) |
|---|---|---|---|
| Free / Player pack | Highlights reel and Social 9:16 cut, standard quality (H.264, up to 8 Mbps), view-only share link, small "Made with OTSI" mark on reels (**to build** — no watermark exists today) | 1 | 2 GB |
| Starter | No OTSI mark, player report, player profile intro at the start of the reel, all export shapes (Scout cut, Archive master), top quality (AV1/VP9, up to 20 Mbps), own music and intro video | 2 | 8 GB |
| Club | Tactics board, Scouting Pack, deliver to clients, Download all / export bundles, saved export settings, club and competition logo on reels | 5 | 24 GB |
| Academy | AI Analyst | 15 | 48 GB |
| Season | Archive bundles | 30 | 64 GB |
| Enterprise | Everything, agreed support | Unlimited | No plan limit |

- **Upload limits (APPROVED):** Free 2 GB, Starter 8 GB, Club 24 GB, Academy 48 GB, Season 64 GB, Enterprise no plan limit. In the desktop app the videos sit on the customer's own laptop, so the practical limit for Enterprise is the customer's own disk space, enforced through the signed licence — not the server's disk.
- **What exists in the app:** player report, profile intro, the four export shapes, the three codecs, music, intro video and logo uploads, tactics, Scouting Pack, delivery, export bundles, saved export settings, AI Analyst, archive bundles, sharing, team invitations. **What needs building:** the "Made with OTSI" mark; staff-account limits per plan (invitations exist, nothing caps the count); the feature checks themselves (the licence carries a feature list but today only holds the plan name and nothing checks individual features — each locked action needs a server check and a "needs the Club plan" message in the app). Approving this table approves the features only, NOT the build order.
- **Why features, not GB:** the app runs on the customer's own laptop, so a GB limit is only a per-video file-size cap, not a storage quota. What the customer pays for is what the machine can do and how much of it.

### 5.4 Top-ups (APPROVED)

- **A top-up costs the same per token as the customer's own plan.** Free users pay the Player pack rate (₦30 per token).
- **Sold in blocks of 100 tokens** (one match + its reel). Price per block: Free / Player pack ₦3,000; Starter ₦2,500; Club ₦2,000; Academy ₦1,500; Season ₦1,250; Enterprise as agreed.
- **PROPOSAL (not approved):** for DOLLAR customers, sell top-ups in bundles of **1,000 tokens** instead of 100-token blocks. At ₦1,500 = $1 a 100-token block costs $0.83–$2.00, while an international bank transfer costs the payer about $15–$40 in fees — more than the top-up itself. A 1,000-token bundle costs $8.33–$20.00 by plan (Season $8.33, Academy $10.00, Club $13.33, Starter $16.67, Player $20.00). Naira customers keep the 100-token blocks. Dollar plans (monthly/yearly) are unaffected.

### 5.5 How the owner is paid

- **Bank transfer is the main (and only) payment method today.** The flow is in §6. Every step is an audit row.
- **Online payment is "Coming soon", disabled.** Candidates: Paystack and Paddle. Stripe does not onboard Nigerian businesses. No payment-gateway code exists in the build today.

### 5.6 A cost warning the owner must also decide (OPEN)

These prices are the approved grassroots recommendations. They have **not** been validated against the actual unit cost of running the engine (GPU compute, storage, the central server). The contract itself says the owner must validate them against the unit-cost worksheet and the paid pilots before any real sale. If the compute cost of analysing a match is higher than the price of the tokens it consumes, the business loses money on every match. **Do not sell at scale until that worksheet is done.** Note: for the desktop app the compute runs on the customer's laptop, so the cost to OTSI is low; for the reel service on the owner's PC (see §9.7) the cost is the owner's electricity and time.

---

## 6. The payment flow — exact state machine

### 6.1 The order (user side)

Endpoints (source: `otsi-vie/apps/api/src/modules/billing/billing.ts`, header comment):

| Step | Endpoint | Rule |
|---|---|---|
| Create an order | `POST /v1/billing/orders` | Plan + period (1 or 12 months) + currency (NGN or USD). Returns the order and its pro-forma invoice. |
| List my orders | `GET /v1/billing/orders` | The caller's orders, newest first. |
| One order | `GET /v1/billing/orders/:id` | One order, with its pro-forma invoice. |
| Plans | `GET /v1/billing/plans` | The plan catalogue (prices, periods, "Pay online — Coming soon"). |
| My subscription | `GET /v1/billing/subscription` | The caller's live subscription, if any (ACTIVE / PAST_DUE). |

### 6.2 The invoice (exact format)

- **Reference format:** `OTSI-INV-<year>-<zero-padded 6-digit per-year sequence>`, never reused. Regex: `/^OTSI-INV-\d{4}-\d{6}$/` (`BANK_TRANSFER_REFERENCE` in `packages/contracts/src/bank-transfer.ts`). Example: `OTSI-INV-2026-000001`.
- **Expiry:** an order is payable for **14 days** after it is created (`ORDER_EXPIRY_DAYS` = 14). After that the invoice has expired.
- **Bank details:** the invoice shows the owner's bank account for the order's currency. The owner enters one bank account per currency. If the owner has not set up a bank account for a currency, no invoice can be raised in that currency — the API refuses with an error telling the user to try the other currency or ask the owner to add the bank details.
- **The pro-forma invoice is printable.** A downloadable PDF invoice does NOT exist (print view only, no PDF library).

### 6.3 Proof of payment (user side)

- Endpoint: `POST /v1/billing/orders/:id/proof`.
- The user uploads a bank receipt (PDF or image, **maximum 10 MB** — larger is rejected with HTTP 413 `FILE_TOO_LARGE`), OR marks "I have paid" with no file.
- The receipt is stored at `org/<organisation id>/billing/<order id>/receipt-<uuid>.<ext>`. The storage key is server-generated; the user never chooses the filename.

### 6.4 Admin confirm, reject, part-payment, refund (OTSI only)

**OTSI is the one company organisation (APPROVED standing rule).** Only OTSI's owner/admin can do the actions in this section. Every other organisation can only order, upload proof and see its own orders. The OTSI organisation is named by a server setting holding its organisation id — **`OTSI_VIE_COMPANY_ORG_ID`** — never hard-coded. If the setting is missing, NOBODY can do these actions (fail closed — never fall back to letting every admin do them). The setting value on the live server is set by the owner during the merge. The desktop database on the owner's PC has only one organisation ("Gefane United FC"), so the setting stays unset there until the merge — and until it is set, nobody can do the company billing actions (that is the fail-closed rule working as intended). Guard: `requireCompanyOrg` in `core/auth.ts`. The Admin › Billing screens are hidden from customer admins (no API call is made for them); each membership carries an `is_company_org` flag (the company org id itself is never exposed).

Endpoints (OTSI owner / admin only):

| Action | Endpoint | Rule |
|---|---|---|
| Confirm | `POST /v1/admin/billing/orders/:id/confirm` | The owner confirms the money arrived. This activates the plan AND credits the wallet in one step: a PURCHASE ledger row with idempotency key `purchase:<orderId>` and invoice reference = the order reference. Tokens credited = `tokens_per_month × periodMonths` (see §5.2). |
| Reject | `POST /v1/admin/billing/orders/:id/reject` | Reject with a reason. The order never activates. |
| Record part-payment | `POST /v1/admin/billing/orders/:id/record-partial` | Record a part-payment. A part-payment NEVER activates a plan on its own. |
| Refund | `POST /v1/admin/billing/orders/:id/refund` | Money refund: claws the granted tokens back from the wallet. If the tokens were already spent, the refund is refused and the owner adjusts it manually. |
| Bank accounts | `GET /v1/admin/billing/bank-accounts`, `POST /v1/admin/billing/bank-accounts` | Create / update a bank account by currency (one per currency). The GET stays readable so customers can see where to pay; only the change is locked. Changing a bank account is OTSI-only — before the lock (`556d160a`) any customer's owner/admin could change it and put their own account number on everyone else's invoices. |
| Wallet refund / adjust | `POST /v1/wallet/:organizationId/adminRefund`, `POST /v1/wallet/:organizationId/adminAdjust` | OTSI-only (locked in `6f2a6406`). A customer admin who could refund or adjust their own wallet could give themselves free tokens. |
| Expire credits | `POST /v1/wallet/:organizationId/expireCredits` (or equivalent) | OTSI-only (locked in `6f2a6406`). Expiring credits is a company job. |
| Run renewals | `POST /v1/admin/billing/renewals/run` | OTSI-only (locked in `6f2a6406`). |
| Revenue summary | `GET /v1/admin/billing/revenue-summary` | Confirmed / outstanding / refunded / part-payment totals. **OPEN merge item:** there are now two revenue summaries — Muse's at `/v1/admin/billing/revenue-summary` and Claude's at `/v1/admin/billing/revenue`. The merge must keep ONE and remove the other; Claude will compare them and tell the owner which is better. |
| Orders (admin) | `GET /v1/admin/billing/orders`, `GET /v1/admin/billing/orders/:id`, `GET /v1/admin/billing/orders/:id/proof` | Pending first. The proof endpoint downloads the receipt the payer uploaded. |

**The same company rule applies to READS (APPROVED, built in `609ecc5`).** Before that commit the company org could ACT on any customer's order but could not SEE it: the admin read endpoints scoped to the caller's own organisation, so a club's payment would never appear in Admin › Billing and could never be confirmed in practice. Now:

- When the caller is the company org, these read endpoints return **ALL organisations'** rows, with the customer's `organization_name` on each row: `GET /v1/admin/billing/orders` (admin order list), `GET /v1/admin/billing/orders/:id` (open any customer's order), `GET /v1/admin/billing/orders/:id/proof` (download a customer's receipt), `GET /v1/admin/wallet/pack-requests` (token-pack request list), `GET /v1/admin/wallet` (wallet list), `GET /v1/admin/wallet/:organizationId/ledger` (any customer's ledger), and `GET /v1/admin/billing/revenue-summary` (revenue counted across every customer's money). Helper: `isCompanyOrg` in `core/auth.ts` (false when the setting is missing, so a read never silently widens).
- When the caller is a customer org, they see **only their own** rows — unchanged behaviour. A customer asking for another org's order or receipt is refused (403 `BILLING_ADMIN_OTHER_ORG` / `WALLET_ADMIN_OTHER_ORG`); a customer asking for another org's pack payment details gets 404 (the read looks the request up by id + organisation, so nothing is revealed).
- The Admin › Billing console shows the customer's name on each order row, each pack-request row and in the selected order detail, and has a wallet selector so the manual top-up / refund / adjust / write-off actions and the ledger act on a picked customer's wallet instead of whichever loaded first.

### 6.5 Renewals (exact)

- **Renewal window:** a renewal order is created **7 days** before a subscription expires (`RENEWAL_WINDOW_DAYS` = 7).
- **Grace:** after expiry, the subscription stays past-due for **14 days** (`RENEWAL_GRACE_DAYS` = 14), then drops to Free.
- **Renewal invoice currency:** the currency the subscription was last paid in, else the organisation's currency.
- **Daily job:** `BillingService.startRenewalScheduler` — one chained timer, first run at start-up (catch-up), then every **24 hours** (`RENEWAL_JOB_INTERVAL_MS` = 24 × 60 × 60 × 1000), in central mode. Manual trigger: `POST /v1/admin/billing/renewals/run` (OTSI-only, see §6.4).
- **Verification note:** the scheduler exists in code. Whether it actually runs in the deployed central server has NOT been verified here. That must be checked before relying on renewals.

### 6.6 The pack flow (user side)

The token-pack purchase flow (ADR-140) and the plan-order flow (§6.1–§6.5) are two flows for the same money. The pack flow's gap — the user who requests a pack never sees where to pay — is FIXED in the payment circle: the user now sees the bank details and the invoice reference. Endpoints:

| Step | Endpoint |
|---|---|
| Pack catalogue | `GET /v1/wallet/packs` |
| Wallet balance | `GET /v1/wallet` |
| Ledger | `GET /v1/wallet/ledger` |
| Claim free grant | `POST /v1/wallet/free-grant` |
| Request a pack | `POST /v1/wallet/packs/request` |
| My pack requests | `GET /v1/wallet/packs/requests`, `GET /v1/wallet/packs/requests/:id`, `POST /v1/wallet/packs/requests/:id/cancel` |
| Admin: pack requests | `GET /v1/wallet/pack-requests`, `POST /v1/wallet/pack-requests/:id/invoice`, `POST /v1/wallet/pack-requests/:id/confirm-receipt`, `POST /v1/wallet/:organizationId/topup`, `GET /v1/wallet/:organizationId/ledger` |

---

## 7. Notifications (exact)

The notifications bell (`GET /v1/notifications`, 14-day window, max 30) covers these BILLING events. Each event is one bell item. Source: `otsi-vie/apps/api/src/modules/overview/notifications.ts`.

| Event | When it appears |
|---|---|
| Order created | A plan order is placed. |
| Proof uploaded | A receipt is uploaded. |
| Marked paid | The user marks "I have paid". |
| Order confirmed | The owner confirms the money arrived. |
| Order rejected | The owner rejects the order. |
| Order refunded | A refund is recorded. |
| Renewal order created | A renewal order is created (7 days before expiry). |
| Order expiring | 3 days before an order's 14-day invoice expiry. |
| Subscription expiring | Before a subscription expires. |
| Customer paid (OTSI only) | A customer uploaded a receipt or marked an order paid and it awaits confirmation; or asked for a token pack that awaits its invoice. Only the company organisation (OTSI) sees it; it links to Admin › Billing and leaves the list once OTSI confirms, rejects or invoices. Added at the merge, 2026-11-13. |

Known limitations: every member of an organisation sees "receipt uploaded" / "marked paid" alerts; an old order changing recently can bring back an old "Order placed" alert. **Email notifications: NOT BUILT.** The same events by email need an email provider and the owner's email setup. There is no email sender anywhere in the app. Nothing is built until the owner chooses a provider. (OPEN decision, §9.)

---

## 8. What is built and what is not (exact)

### 8.1 Built — payment circle (branch `muse/payment-circle`, pushed; tip remote `609ecc5`)

| Piece | Evidence |
|---|---|
| User order flow (plan + 1/12-month period) | New Settings billing pages: `apps/web/src/app/(app)/settings/billing/page.tsx`, `settings/billing/orders/[id]/page.tsx`; components `PlanOrdersView.tsx`, `OrderDetailView.tsx`, `BillingShared.tsx`. |
| Order detail with printable pro-forma invoice (bank details included) | `OrderDetailView.tsx`, `BillingShared.tsx`. |
| Proof upload / "I have paid" | `POST /v1/billing/orders/:id/proof` + UI. |
| Admin order management (confirm / reject / part-payment / refund) | `AdminBillingView.tsx`; `POST /v1/admin/billing/orders/:id/confirm`, `/reject`, `/record-partial`, `/refund`. |
| Admin bank-details screen | `GET/POST /v1/admin/billing/bank-accounts` + UI. |
| Renewals wiring + manual trigger | `POST /v1/admin/billing/renewals/run` + UI; scheduler in code (see §6.5 verification note). |
| Pack-flow bank-details gap fixed | User who requests a pack now sees the bank details and the invoice reference. |
| Printable invoice view + final receipt view | Print view only. No PDF library. |
| BILLING kind in the bell | `apps/api/src/modules/overview/notifications.ts` + `packages/contracts/src/notifications.ts`. |
| Admin revenue summary | `GET /v1/admin/billing/revenue-summary` + UI. (See the two-summaries merge item in §6.4.) |
| Free grant claim button | "Claim Free grant" button in Token Wallet and on the Free plan card, once per organisation, 30-day expiry, **100 tokens** (built 2026-11-13 as 100, changed to 25 by owner decision 2026-11-14, back to 100 by owner decision 2026-11-14 ~02:33). |
| Live token display | Cost preview before every charged action, live job readout as ActivityLine narration, usage history. Commit `4028dbfc`. |
| ActivityLine, global | Live narration + real-time timing across every engine action. Commit `0eaf0b36`. |
| Bank-account + order-action lock (OTSI only) | `OTSI_VIE_COMPANY_ORG_ID` setting, fail closed. Commit `556d160a`. |
| Four remaining admin locks (OTSI only) | Wallet refund/adjust, expire credits, renewals run. Commit `6f2a6406`. |
| Refund-on-failure | Charged jobs that fail while running are refunded automatically. Commit `c801c8d8`. |
| Export batch cost preview | "Render only" batch shows the total cost before starting. Commit `85974604`. |
| Company-org reads (OTSI sees every customer's orders) | Admin order list / order / receipt download, pack-request list, wallet list / ledger, revenue summary all return every customer's rows for the company org, with the customer's name on each row; a customer sees only its own. Commit `609ecc5`. API tests prove both sides; the web test proves the admin list and detail show the name. |

**Verification (Muse, firsthand, 2026-11-13):** web vitest **544/544 pass** (102 files) at tip `609ecc5`; the company-org guard unit test 5/5 pass (SQLite mode); typechecks only the pre-existing errors; contracts build clean. **Honest limit — the billing logic is NOT proven yet.** No billing bug has been found, but none has been proven absent either: the tests that would catch a billing bug (the company lock, the refund, the wallet) either did not load or broke before checking anything, so they must actually pass on the host before the billing work counts as proven on the server side. **Still unverified here:** the API endpoint tests needing host MySQL (they must run on the owner's machine — the company-org read tests, the jobs refund test with its error code, the bell test confirming as OTSI, the wallet tests with the corrected 25-token numbers and the AI Analyst catalogue cost); the live job readout against a real running job; the bank-account lock against a live server; the renewal daily job in practice. Claude will run the full backend suite on the host against `609ecc5` before the merge.

### 8.1a Built — grassroots price list (branch `claude/billing-merge`, 2026-11-13)

| Item | What exists |
|---|---|
| Plan cards | Settings › Plans & billing shows Free (claim 100 free tokens), Starter ₦7,500 / 300, Club ₦20,000 / 1,000, Academy ₦45,000 / 3,000, Season ₦75,000 / 6,000 tokens a month, and Enterprise "Contact us" from ₦250,000. Each card shows its upload limit per video and its top-up rate. 12 months = 10 payments. |
| Top-ups | Blocks of 100 tokens at the customer's own plan rate (Free / Player ₦3,000, Starter ₦2,500, Club ₦2,000, Academy ₦1,500, Season ₦1,250). The caller sends only the number of blocks; the server prices them. Enterprise top-ups are refused with 409 `TOPUP_AGREED_WITH_OTSI`. `wallet_pack_requests.pack_code` records the plan whose rate applied (migration 0076 adds `FREE`). |
| Upload limit per video | Free 2, Starter 8, Club 24, Academy 48, Season 64 GB; Enterprise no plan limit. Enforced by the server at upload start (413 `PLAN_UPLOAD_LIMIT`), reported by `GET /v1/upload-limits` (plan, plan limit, server limit), shown on the Media page and status bar. |
| Not yet | Enterprise has no self-serve subscription: OTSI sets it up (licensing build). "Contact us" shows a note only — OTSI's contact email / phone is not in the app yet (owner to supply). Plans by features (§5.3) stay a proposal. Dollar rounding and dollar top-ups stay OPEN. |

### 8.2 Built — pre-existing (adopted base `claude/best-of-both` at `6c7110f`)

Token wallet (ledger, packs, free-grant API), bank-transfer plan API, token meter in the top bar, low-balance warning. Claude's additions on top of the base (to be merged): a "Plans and pricing" page and a revenue panel, plus Home fixes (commit `099d23a`).

### 8.3 NOT built

| Piece | Status |
|---|---|
| ~~Grassroots price list + free grant 100 in the code~~ | **Built 2026-11-13** on `claude/billing-merge` — see §8.1a. |
| Pricing page | Being built (Claude). Not yet landed/pushed. When it lands: pull, verify, and wire it in as the payment circle's entry point. Do NOT build a competing pricing page. |
| Email notifications | Not built. Needs an email provider (owner decision). |
| Tax / VAT | Not built. Needs the owner's accountant. |
| Online payment | Not built. "Coming soon", disabled. Paystack / Paddle to confirm. |
| Downloadable PDF invoice | Not built. Print view only. |
| "Made with OTSI" mark on Free reels | Not built. Small render addition; every shared free reel advertises OTSI. |
| Staff-account limits per plan | Not built. Invitations exist, nothing caps the count. |
| Feature checks (licence feature list enforced) | Not built. The licence carries a feature list but today only holds the plan name; nothing checks individual features. |
| **Desktop licence enforcement (CRITICAL)** | **Not built. On the desktop app, if there is no licence from the central server, the engine runs paid work without any licence check. The token balance also sits in the laptop's own database, so a technical user could edit it and give themselves tokens or features. For plans and tokens to protect income, the desktop app must get its tokens and features from the central server via the signed licence, and the laptop must refuse paid work without it. This is the biggest remaining billing work and MUST be fixed before any real sale. The approved approach is §8.4.** |

### 8.4 Licensing architecture — the approved approach (server as the bank)

The desktop licence hole (§8.3) is fixed by making the central server the bank. APPROVED approach, to be built after the merge (Claude builds it on a local test copy of MariaDB 11.4 first, shows the owner exactly what changes on the live server, and deploys only with the owner's yes).

- **Sign-in once; the server issues a signed licence** carrying the plan + the feature list, valid **30 days**. No sign-in, no licence → only the free tier works (this closes the copy-and-share leak: a licence file copied to another laptop does not work without the sign-in behind it).
- **A signed ticket per paid job.** When the customer starts a paid job, the app sends a tiny request to the server ("this job costs 90 tokens"); the server takes the tokens from the customer's balance and sends back a signed ticket for that one job. The analysis then runs fully on the customer's laptop, offline if wanted.
- **The balance lives only on the server.** The laptop spends tokens offline only against the ticket it was given; the laptop's own database never holds the balance, so restoring an old copy of the files (or reinstalling) cannot bring tokens back. If the job fails, the server refunds the ticket automatically.
- **Bad internet:** the ticket request is a few hundred bytes and works on a weak mobile connection. For customers often offline, the licence can carry a small offline allowance of **~200 tokens** (two matches), settled with the server next time the customer is online.
- **Licensing server address (APPROVED): `accounts.otsi.cc`.** A separate subdomain just for sign-in, licences, wallet and billing. `vie.otsi.cc` stays on the owner's PC untouched. Setup needs a DNS record, the address added to the hosting, and a security certificate.
- **Central server scope:** the live server holds NONE of the engine's data (matches, players, tracks, reels stay on the customer's laptop, and for `vie.otsi.cc` in the database on the owner's PC). It holds only the trusted/shared part, roughly 15–20 tables: accounts (organisations, users, staff), plans and features, wallet ledger and balance, orders / invoices / bank accounts / subscriptions / renewals, signed licences, per-job tickets and refunds, audit log. Database: `sfbhenfezi_vie`. The old 5 tables / 17 rows in that database are KEPT, not dropped (backed up first; the new tables use different names so nothing clashes).
- **What already exists:** the server can sign licences, the desktop stores the licence, the engine checks the signature. **Missing:** sign-in from the desktop, job tickets, moving the balance to the server, feature checks, refusing paid work without a licence.
- **Timing:** start straight after the merge (it touches the same wallet files). Pilots can start as soon as the sign-in check (licence gate) is in place.

---

## 9. Open decisions for the owner (numbered)

1. **Features-based plans table (§5.3): approve?** Claude checked every feature against the real app and produced the final table. Muse recommends yes. Approving it approves the features only, not the build order. Decider: the owner.
2. **Dollar rounding: yes or no?** Exact dollars at ₦1,500 = $1 are $2.00 / $5.00 / $13.33 / $30.00 / $50.00 / from $166.67. Proposal: round to whole dollars ($2 / $5 / $13 / $30 / $50 / from $167). Decider: the owner.
3. **1,000-token dollar top-up bundles: yes or no?** Naira keeps 100-token blocks; dollar customers would buy 1,000-token bundles ($8.33–$20.00 by plan) because a 100-token block ($0.83–$2.00) is less than a $15–$40 international transfer fee. Decider: the owner.
4. **Claim-grant button at the top: yes or no?** Show it next to the token count while unclaimed (see §2.3). Decider: the owner.
5. **Email provider?** Billing notifications by email need a provider and the owner's email setup. Nothing is built until that is chosen. Decider: the owner.
6. **Tax / VAT?** Nothing is implemented. Needs the accountant's call before real sales. Decider: the owner + accountant.
7. **Prices vs costs?** The grassroots prices are unvalidated recommendations. The unit-cost worksheet and the paid pilots must confirm them before selling at scale. Decider: the owner, on the worksheet.
8. **Desktop licence enforcement — build order?** The critical hole in §8.3, with the approved approach in §8.4. Claude will propose the build order once the push is merged. Decider: the owner, on Claude's proposal.
9. **Two revenue summaries — which one survives the merge?** Muse's `/v1/admin/billing/revenue-summary` vs Claude's `/v1/admin/billing/revenue`. Claude will compare them. Decider: the owner, on Claude's comparison.
10. **The merge.** Muse's branch (`muse/payment-circle`, tip `609ecc5`) is the base; Claude's pricing page, revenue panel and Home fixes go on top. Claude must first pull and check the pushed commits line by line. During the merge the owner sets `OTSI_VIE_COMPANY_ORG_ID` to the real OTSI organisation id on the live server.

### 9.7 Direction (agreed): clubs first, owner's PC as a reel service

Grassroots players often have only phones or weak laptops, and analysing a match needs a reasonably strong computer — so the price does not matter if the analysis cannot run. Agreed direction: **sell to clubs and academies first** (a club usually has at least one decent laptop; one analysis serves the whole squad — 22 reels from one match), and **offer a "we make your reel" service for individual players run on the owner's own PC** (vie.otsi.cc is live on his machine with its Arc graphics card; one PC handles one match at a time, so this is for early customers while volumes are small). The web and mobile versions for grassroots players come later.

**Reel service — price and process (defined 2026-11-14, owner decision): ₦5,000 per match, one match → one reel.** It is a done-for-you service, so it costs more than the ₦3,000 self-service Player pack (100 tokens): the extra ₦2,000 is the service fee for the owner's time and PC. Process: (1) the player messages OTSI on WhatsApp with name, position, shirt number, club; (2) they send the full match video as a Google Drive link on WhatsApp (or direct on WhatsApp if under 2 GB); (3) they pay ₦5,000 by bank transfer and send a screenshot as proof; (4) the owner confirms payment, downloads the video, analyses it on his PC, builds the reel with the Best Moment Rule (up to 5 minutes) plus the Player Profile Intro; (5) the reel is sent back on WhatsApp (or a download link if too large). Turnaround: within 48 hours per reel; if there is a queue the player is told where they are in it. The owner tracks orders in a simple log (name, date, video link, payment status, reel status). The service is manual for now (the player is on a phone; there is no web version yet) — it becomes an in-app "Request a reel" flow when the web version exists.

---

## 10. The numbers at a glance (exact)

- **1 token = 1 started minute analysed.**
- **A full match + its reel = 100 tokens.**
- **Free: 100 tokens, once, 30 days, claim button (NOT automatic). (APPROVED 2026-11-13 as 100; changed to 25 by owner decision 2026-11-14; back to 100 by owner decision 2026-11-14 ~02:33.)**
- **Player pack 100 · ₦3,000 / $2.00 — Starter 300/mo · ₦7,500 / $5.00 — Club 1,000/mo · ₦20,000 / $13.33 — Academy 3,000/mo · ₦45,000 / $30.00 — Season 6,000/mo · ₦75,000 / $50.00 — Enterprise from ₦250,000 / from $166.67, "Contact us".**
- **Exchange rate: ₦1,500 = $1. (APPROVED.) Dollar rounding to whole dollars: PROPOSAL, pending.**
- **Top-ups: same per-token price as the customer's plan; 100-token blocks (Naira): ₦3,000 / ₦2,500 / ₦2,000 / ₦1,500 / ₦1,250. Dollar 1,000-token bundles: PROPOSAL, pending.**
- **Upload limits (APPROVED): Free 2 GB, Starter 8 GB, Club 24 GB, Academy 48 GB, Season 64 GB, Enterprise no plan limit (customer's own disk).**
- **Plans: the same tokens per month. 12 months = 10 payments (2 months free). Tokens credited in one lump sum on confirm: tokens_per_month × periodMonths.**
- **Costs: analysis 1/min, reel render 10, player report 10, export pack 10, AI Analyst 10. Everything else free.**
- **Low-balance warning below 90 tokens.**
- **Paid tokens expire after 12 months. Free tokens after 30 days.**
- **Invoice: `OTSI-INV-YYYY-NNNNNN`, payable for 14 days. Renewal order 7 days before expiry. Grace 14 days, then drop to Free.**
- **Payment: bank transfer only. Online payment coming soon.**
- **Company billing actions (bank accounts, order confirm/part-pay/reject/refund, pack invoice/confirm, wallet top-up/refund/adjust, expire credits, renewals run) are OTSI-only via the `OTSI_VIE_COMPANY_ORG_ID` setting, fail closed. The company org also SEES every customer's orders, pack requests, wallets and revenue (with the customer's name on each row); a customer sees only its own.**
- **Licensing (APPROVED approach): the server is the bank — signed licence (plan + features, 30 days), a signed ticket per paid job, balance only on the server, ~200-token offline allowance; licensing server at `accounts.otsi.cc`.**
- **Features-based plans (§5.3): PROPOSAL — final table awaiting the owner's yes.**
