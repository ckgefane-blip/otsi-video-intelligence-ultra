# Bank-transfer billing — web UI changes (for the web/i18n pass)

**Status:** API only. No web file was touched in the API build (the i18n agent owns the web tree
right now). This document is the exact spec for the web changes that follow. All strings below are in
EN only — translation into RU/ES/DE/FR follows the i18n pass (ADR-139), like the wallet pages.

**API base:** all endpoints are under the API the web app already calls. The user endpoints need any
ACTIVE member; the admin endpoints need OWNER / ADMIN of the caller's own organization (ADR-140 §8:
Admin acts only on the caller's own organization — there is no platform-wide owner role yet).

**Money:** amounts are in minor units everywhere (kobo for NGN, cents for USD). Format with the
currency: ₦15,000 is `amount_minor: 1_500_000, currency: "NGN"`; $49 is `4_900, "USD"`. Never divide
by 100 on the client and re-send — send the minor-unit integers the API returns.

**Plans (GET /v1/billing/plans):** the catalogue is the source of truth — do not hard-code prices in
the web app. Billable plans: STARTER / CLUB / ACADEMY / SEASON; FREE appears in the catalogue only as
the drop-to tier and is never orderable. Periods: 1 or 12 months (12 months costs 10 monthly payments
— "2 months free"). Currencies: NGN, USD.

---

## 1. User: plan / order page (new page, e.g. `/settings/billing` — next to Wallet)

**Purpose:** pick a plan + period, pay by bank transfer, watch the order.

**Endpoints**
- `GET /v1/billing/plans` — catalogue (plans, periods, `order_expiry_days: 14`,
  `renewal_window_days: 7`, `renewal_grace_days: 14`, `online_payment: "coming_soon"`).
- `POST /v1/billing/orders` — body `{ plan_code, period_months, currency }` → `201 { order, invoice }`.
- `GET /v1/billing/orders` — the user's orders, newest first (no bank details on the list).
- `GET /v1/billing/orders/:id` — one order with its pro-forma invoice.
- `POST /v1/billing/orders/:id/proof` — see §2.

**Fields to show**
- Plan cards: label, `covers` line, tokens per month, monthly price in the chosen currency, and the
  12-month price ("2 months free"). Currency switch NGN / USD. Period switch 1 month / 12 months.
- After creating an order, show the pro-forma invoice (from the `invoice` object in the create
  response — do not re-derive it):
  - Reference (large, copyable): e.g. `OTSI-INV-2026-000123`.
  - "Put this reference in your transfer description, so the payment can be matched to your order."
    (the API returns this as `invoice.pay_reference_note` — show that string).
  - Bank details: account name, bank name, account number, SWIFT/IBAN when present, currency.
  - Amount + currency, plan + period, order expiry date (`invoice.expires_at`, 14 days after creation).
- Order list: reference, plan, amount, currency, status, created date. Statuses, with plain wording:
  - `ORDERED` — "Order placed — pay by bank transfer"
  - `AWAITING_CONFIRMATION` — "Awaiting confirmation"
  - `PARTIAL` — "Part paid — {amount_received} of {amount} received"
  - `CONFIRMED` — "Confirmed — plan active"
  - `REJECTED` — "Rejected — {reject_reason}"
  - `REFUNDED` — "Refunded"
- **"Pay online — Coming soon" button:** visible on the plan page next to the bank-transfer option,
  **disabled**, with the note "Online card payment is coming soon. Bank transfer is available now."
  It must never open a checkout, never collect card data, never charge (plan §5b). No checkout code.

**Strings to add (EN)**
- "Pay by bank transfer", "Choose a plan", "Monthly", "12 months (2 months free)",
  "Your invoice", "Bank details", "Account name", "Bank", "Account number", "SWIFT / IBAN",
  "Amount to pay", "Order expires", "Copy reference", "Reference copied",
  "I have paid", "Upload transfer receipt (optional)", "Your orders",
  "No bank account has been set up for {currency} yet. Try the other currency, or ask the owner."
  (shown when creating an order answers 409 `BANK_ACCOUNT_NOT_CONFIGURED`).

---

## 2. User: proof of payment (on the order / invoice view)

**Endpoint:** `POST /v1/billing/orders/:id/proof` — two shapes, one endpoint:
- **No file ("I have paid"):** `Content-Type: application/json`, body `{}` or `{ "note": "..." }`.
  Show a button "I have paid" and an optional note field ("Anything the owner should know, e.g. the
  name the transfer was sent from"). Always available, even without storage.
- **With a receipt file:** `Content-Type: application/octet-stream`, the file bytes as the body, with
  headers `x-content-type` (the real file type: `application/pdf`, `image/jpeg`, `image/png`,
  `image/webp`) and `x-file-name` (the original file name). Max 10 MB. Accepted: PDF or image only.
  Show a file picker labelled "Upload transfer receipt (PDF or image, up to 10 MB, optional)".

**Behaviour:** either shape moves the order to `AWAITING_CONFIRMATION`. A receipt can be re-uploaded
while the order is open (ORDERED / PARTIAL / AWAITING_CONFIRMATION). A closed order (CONFIRMED /
REJECTED / REFUNDED) refuses proof with 409 `ORDER_NOT_OPEN` — show "This order is closed."

**Strings to add (EN)**
- "I have paid", "Mark paid without a receipt", "Upload receipt", "Receipt uploaded",
  "A transfer receipt must be a PDF or an image (JPEG, PNG, WebP).",
  "A transfer receipt may be up to 10 MB.",
  "Receipt storage is not configured on this server. Mark paid without a file instead, and send the
  receipt to the owner another way." (409/503 `STORAGE_NOT_CONFIGURED`).

---

## 3. Admin: billing console (extend `/settings/admin/billing` — next to the wallet pack requests)

**Endpoints**
- `GET /v1/admin/billing/orders` — pending first (AWAITING_CONFIRMATION, then PARTIAL, then ORDERED,
  then the rest), newest first. Optional `?status=` filter (one of the six statuses).
- `GET /v1/admin/billing/orders/:id` — one order.
- `POST /v1/admin/billing/orders/:id/confirm` — body `{ amount_received_minor, bank_reference,
  confirmed_at? }`. `confirmed_at` is optional ISO date (the date the money arrived, as read off the
  bank statement; defaults to now).
- `POST /v1/admin/billing/orders/:id/reject` — body `{ reason }` (required).
- `POST /v1/admin/billing/orders/:id/record-partial` — body `{ amount_received_minor,
  bank_reference? }`.
- `POST /v1/admin/billing/orders/:id/refund` — body `{ reason, amount_refunded_minor? }`.
- `GET /v1/admin/billing/bank-accounts` and `POST /v1/admin/billing/bank-accounts` — see §4.
- `POST /v1/admin/billing/renewals/run` — see §5.

**Fields to show (per order)**
- Reference, plan, period, amount + currency, amount received so far, status, order date, expiry date.
- Proof: file name + size + uploaded date when a receipt was uploaded (there is no download endpoint
  yet — see "Open items" below; show the file name and sha256 so the admin can match it), or the
  "I have paid" note when there is no file.
- Confirm form (only when status is AWAITING_CONFIRMATION or PARTIAL): amount received (prefilled
  with the remaining amount), bank reference (required), confirmed date (optional, defaults to today).
  On success the order becomes CONFIRMED and the plan activates — show "Plan active until
  {period_end}" (read the subscription from the order's `subscription_id` via the existing
  subscription read, or re-fetch the order: the wallet balance and plan state update on next load).
- Reject form (only when ORDERED / AWAITING_CONFIRMATION / PARTIAL): reason (required).
- Record-partial form (only when AWAITING_CONFIRMATION or PARTIAL): amount received in this
  part-payment, bank reference (optional). The order stays PARTIAL and inactive. Note: a payment that
  would complete the order is refused here (409) — the admin must use Confirm for the final amount.
- Refund form (only when CONFIRMED): reason (required), money refunded (optional, defaults to the
  order amount). On success the order becomes REFUNDED, the granted tokens are clawed back, and the
  subscription is cancelled. If the wallet no longer holds the tokens (they were spent), the refund is
  refused with 409 `WALLET_WOULD_GO_NEGATIVE` — show "The wallet no longer holds those tokens. Adjust
  it manually." and do not retry.

**Rules the UI must not work around**
- Nothing activates before Confirm. Reject and partial payments never activate.
- Confirm needs the received amounts to add up to exactly the order amount — a short payment must go
  through Record-partial first; the API refuses a wrong total with 409 `ORDER_AMOUNT_MISMATCH`.
- Confirming an already-confirmed order is refused (409) — disable the Confirm button once confirmed.

**Strings to add (EN)**
- "Billing orders", "Pending orders", "Awaiting confirmation", "Part paid",
  "Amount received", "Remaining", "Bank reference", "Date money arrived",
  "Confirm payment", "Reject order", "Rejection reason", "Record part-payment",
  "Refund", "Refund reason", "Money refunded", "Plan active", "No pending orders",
  "This order is {status}, so it cannot be confirmed.",
  "The received amounts must add up to exactly the order amount."

---

## 4. Admin: bank accounts (in the billing console)

**Endpoints**
- `GET /v1/admin/billing/bank-accounts` — list (NGN, USD), full details — admin only.
- `POST /v1/admin/billing/bank-accounts` — body `{ currency, account_name, bank_name,
  account_number, swift_iban?, is_active? }`. Creates or updates the account for that currency
  (one row per currency). `swift_iban` is nullable (needed for USD / foreign payers).

**Fields to show**
- One card per currency (NGN, USD): account name, bank name, account number, SWIFT/IBAN, active
  toggle. An edit form per currency. A clear note: "These are the bank details shown on every
  invoice. They are stored on the server only — never in the code."

**Strings to add (EN)**
- "Bank accounts", "Account name", "Bank", "Account number", "SWIFT / IBAN", "Active",
  "Save bank details", "Bank details saved",
  "These are the bank details shown on every invoice. They are stored on the server only — never in
  the code."

---

## 5. Admin: renewals (in the billing console)

**Endpoint:** `POST /v1/admin/billing/renewals/run` → `{ renewals_created, renewal_order_ids,
past_due, downgraded_to_free }`.

**Behaviour:** a button "Run renewals now". The central server also runs this daily on its own — the
button is for on-demand runs. Each run: creates a renewal order (new reference) for every ACTIVE
subscription expiring within 7 days that has no renewal order yet; moves subscriptions past expiry
into PAST_DUE for the 14-day grace period, then drops them to the free tier (projects are kept).
Show the result counts after a run ("1 renewal order created, 0 dropped to free").

**Strings to add (EN)**
- "Renewals", "Run renewals now", "Renewal orders are created 7 days before a subscription expires.",
  "After expiry there is a 14-day grace period, then the plan drops to the free tier. Projects are
  kept.", "{n} renewal order(s) created", "{n} subscription(s) dropped to free".

---

## 6. What the UI must NOT do

- Never show bank details to a non-admin caller except as the pay-to details on that caller's own
  order invoice (`GET /v1/billing/orders/:id` returns them inside `invoice.bank_account`; the order
  list does not carry them).
- Never invent a plan price, a token amount, or an invoice reference on the client — all three come
  from the API.
- Never add a checkout, a card field, or any online-payment code. "Pay online — Coming soon" is a
  disabled button only.
- Never offer to cancel an order: there is no cancel endpoint (the status enum has no CANCELLED —
  an unwanted order is rejected by the admin with a reason).

## Open items (not in the API build — for the parent to decide)

1. **Receipt download:** there is no `GET .../proof` endpoint — the admin sees the file name, size
   and sha256 on the order, but cannot download the receipt from the app yet. The file is stored at
   `org/<org id>/billing/<order id>/receipt-<uuid>.<ext>` under the configured storage dir. A download
   endpoint (admin-only, signed URL like media playback) is a small follow-up.
2. **Final invoice / receipt:** after confirmation the user sees the order as CONFIRMED and the wallet
   PURCHASE ledger row is their receipt (invoice reference = the order reference). A printable final
   invoice / PDF is not built — the pro-forma invoice is the on-screen invoice, and a PDF export is a
   follow-up if the owner wants one.
3. **Email / in-app notice on confirm:** the plan says the user gets a final invoice/receipt and an
   email/in-app notice. The API writes the audit rows (`billing.order_confirmed`,
   `billing.plan_activated`); no notification is sent yet — wire it to the existing notifications
   module when the owner wants it.
4. **Plan prices are the approved pack prices** (see the catalogue note in
   `packages/contracts/src/bank-transfer.ts`): the owner must validate them against the unit-cost
   worksheet and the paid pilots before any real sale.
