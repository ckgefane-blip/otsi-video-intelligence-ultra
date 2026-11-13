# ADR-146: The licensing circle — the central server is the bank

- **Status:** Accepted approach (owner, billing-blueprint §8.4, approved 2026-11-13); build started 2026-11-13 on the owner's
  "Yes, start it". Live deploy to `accounts.otsi.cc` needs the owner's separate yes (§6).
- **Date:** 2026-11-13 (Claude, `claude/billing-merge`).
- **Builds on:** ADR-144 (distribution: same API in central mode, Ed25519 licence), ADR-140 (wallet), the bank-transfer billing.
- **Closes:** billing-blueprint §8.3 "Desktop licence enforcement (CRITICAL)": today a desktop keeps its token balance in its own
  database and runs paid work with no licence when no central server is configured.

## 1. Three modes, one codebase

| Mode | Set by | Who | Money and accounts |
| --- | --- | --- | --- |
| **Central** | `OTSI_VIE_CENTRAL_MODE=yes` | `accounts.otsi.cc` (Spaceship host, MariaDB 11.4) | The bank: accounts, sign-up, plans, wallet ledger, orders, bank details, licences, job tickets, audit. Never video. |
| **Linked desktop** | `OTSI_VIE_CENTRAL_SERVER_URL=https://accounts.otsi.cc` | A club's laptop | Signs in to central; holds NO balance. Matches, players, tracks and reels stay here. |
| **Local only** | neither | Development, tests, `vie.otsi.cc` on the owner's PC | Today's behaviour, unchanged. |

## 2. Accounts and sign-up

- The central server is the one identity. A linked desktop shows **Sign in with your OTSI account** and **Create account**.
- **Public sign-up** (central only, `POST /v1/auth/sign-up`): email, password, name, organisation name → a new organisation
  with the person as OWNER, no invitation. Rate-limited per address and per IP; the same password rules as today. The free
  grant stays a claim button. Email verification waits for an email provider (open decision 5) — recorded, not faked.
- The desktop's local API signs in to central on the person's behalf (`/v1/central/*`), stores the central session sealed
  on this PC, and mirrors the central user and organisation into the local database **with the same ids**, so local data
  (matches, players, reels) belongs to the same organisation the licence names.

## 3. Money: the balance lives only on the server

- In linked mode the wallet, billing, plan and licence endpoints are answered by the central server: the local API forwards
  them with the central session. The local ledger is not used, so restoring old files or reinstalling cannot bring tokens back.
- **A signed ticket per paid job.** Where the local API charges today (`WalletService.charge`: analysis, reel render, player
  report, export pack, AI Analyst), linked mode asks central `POST /v1/tickets {job_type, job_id, amount}`. Central charges
  its ledger (same idempotency key `spend:<type>:<id>`) and returns an Ed25519 ticket (audience `otsi-vie-ticket`, claims:
  organisation, job type, job id, amount, issued, expiry 7 days). The job then runs on the laptop, offline if wanted.
- **Refunds:** where the API refunds today (`refundForJob`: cancelled before start, failed), linked mode calls central
  `POST /v1/tickets/refund`; central refunds once (idempotent `refund:<type>:<id>`).
- **The worker checks the ticket** for paid job kinds, as it checks the licence today: signature, organisation, job id.

## 4. Offline allowance (~200 tokens)

- The licence carries `offline_allowance: 200`. When central cannot be reached at job start and the licence is valid (or in
  its 14-day grace), the local API records an **offline spend** (job, amount, time) and lets the job run, as long as the
  unsettled offline spends stay within the allowance. Beyond it: "Connect to the internet to start more paid work."
- Next time central is reachable, the local API settles them (`POST /v1/tickets/settle`): central charges each one once,
  oldest first. If the balance is short, the spend is recorded as an **OWED ticket** (not a negative balance: the ledger
  keeps `balance_after >= 0`, migration 0071). While anything is owed, central collects it first on every ticket request and
  refuses a new ticket it cannot cover after that (`402 TOKENS_OWED`); an owed job that failed is cleared by a refund.
  Built 2026-11-13: migration 0077 (`job_tickets`, `offline_spends`, `central_links`), `modules/tickets/tickets.ts`.
- The worst a tampered laptop can take is the allowance once per licence period — the accepted trade-off for weak internet.

## 5. The licence gate

- Linked mode with no valid licence (never signed in, or expired past the grace): paid work is refused before any charge
  (`402 LICENCE_REQUIRED`, "Sign in to your OTSI account to run paid work"), and the worker refuses too. Free work (upload,
  ingest, browsing, editing) keeps working.

## 6. Database and deploy

- Central runs on the Spaceship host's **MariaDB 11.4.13**, not MySQL 8.4. Every migration is first run on a disposable
  local MariaDB 11.4 (`otsi-vie-central-mariadb`, 127.0.0.1:3511) and the central test suite runs against it.
- Live (owner's yes first, with exactly what changes shown): back up `sfbhenfezi_vie`; keep the old `otsi_vi_*` tables in
  place (new tables use other names); add `accounts.otsi.cc` (Cloudflare DNS-only record to the host, cPanel subdomain,
  AutoSSL); a Node app for the API in central mode; keys generated on the host, never in the repo or chat.
- `vie.otsi.cc`, app/jason/api (VPN) and other databases are never touched.

## 7. Build order

1. MariaDB 11.4 compatibility of all migrations (local, disposable).
2. Central: sign-up, job tickets (issue / refund / settle), licence `offline_allowance`.
3. Linked desktop: central session + sign-in / create-account screens, forwarding of wallet / billing / licence, ticket
   charging and refunds, the licence gate, offline spends and settlement.
4. Worker: ticket check for paid kinds.
5. Tests on MySQL, SQLite and MariaDB; the full flow end to end against a local central server.
6. Staging plan for `accounts.otsi.cc` → the owner's yes → deploy → smoke test.

## 8. Alternatives considered

- **Keep the balance on the laptop and sync it** — rejected: restoring an old copy or editing the file brings tokens back.
- **Run every job through the server** — rejected: no GPU on the host and footage must stay on the laptop.
- **No offline allowance** — rejected for grassroots clubs on weak internet; the allowance is small and settled later.
