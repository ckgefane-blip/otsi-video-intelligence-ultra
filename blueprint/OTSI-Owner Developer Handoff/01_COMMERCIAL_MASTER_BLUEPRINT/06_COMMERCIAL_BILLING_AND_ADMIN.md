# 06 — Commercial account, subscription, enforcement and administration

## Pricing plans are configurable, not hardcoded
Plan registry includes `FREE_TRIAL`, `STARTER`, `PRO`, `CLUB`, `ENTERPRISE`; **prices, countries, currencies and restrictions require owner approval**. Catalog contains immutable provider price IDs per currency/period, tax treatment, trial days, seats, upload size, monthly video minutes, processing priority, storage, render minutes, 4K permission, custom branding, team access, retention and API requests. No invented prices appear in production.

## Signup -> purchase -> access flow
Register via OIDC/passkey where supported; verify email; create organization. Trial grants explicit entitlements with expiry. Checkout initiated by backend for an authenticated tenant; redirect to hosted checkout using provider customer ID, never browser-supplied price. Webhook signature, event ID deduplication, authorized mapping and provider state verification before plan activation. Include `PENDING`, `ACTIVE`, `PAST_DUE`, `CANCELLED`, `EXPIRED` and grace policy. Backend `reserve_quota(tenant,feature,quantity,idempotency_key)` in DB transaction prevents race between simultaneous uploads or renders. Usage ledger becomes immutable when workflow stage accepted/finished; failed work releases/resolves holds per plan policy. Refund/dispute/cancellation triggers entitlements changes; queued and downloaded exports re-check rights separate from billing.

## Administrative console required (not one of 10 customer UI images)
Routes `/admin/*` with authorized operator roles, never visible to standard tenants. Admin features: plan catalogue + revisions, tenant list, memberships and suspension, quota adjustment, billing event trace, processing queue operations, GPU node health, model catalogue/evaluation, flagged identity errors, retention/legal holds, storage accounting, security events, audit search. Every write requires reason + audit event; high impact actions require dual control where appropriate. Admin does not bypass source rights by default.

## Privacy/security
Only minimal personal data; don't retain unnecessary face crops or appearance embeddings beyond policy. DPIA/legal review for biometric-related processing and minors; regional residency controls; deletion workflows across MySQL/S3/caches [MySQL correction C-DOC-03]/observability with legal-hold checks. Publish acceptable use, privacy policy, terms, content rights declaration and subscription cancellation pathway before commercial release.

## Provider adapters
`BillingProvider` methods: `createCustomer`, `createCheckoutSession`, `createPortalSession`, `verifyWebhook`, `getSubscription`, `refund`, `listPrices`. Provider return values parsed server-side. Abstract email notification and object storage similarly. Never log raw secret values or full payment payload.
