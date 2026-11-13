# Staging plan: the OTSI account server (accounts.otsi.cc)

**Status:** plan only, waiting for the owner's yes. Nothing on the server, in the DNS or in any database has been changed.
**Governs:** ADR-146 step 6. Builds on `docs/central-server-deploy.md` (the general checklist) and replaces its MySQL
assumptions with the real host: Spaceship shared hosting, MariaDB 11.4.13, Node apps run by cPanel.
**Cost:** zero. Existing hosting, free Cloudflare DNS, free AutoSSL certificate.

## What it is

The account server is the bank for every club: accounts, Create account, plans, the token wallet, orders and bank
details, licences and job tickets. It never sees video. The desktop app signs in to it.

## Facts checked on the host (read-only, 2026-11-13)

| Fact | Value | What it means |
| --- | --- | --- |
| Node versions | 22 available (cPanel "Setup Node.js App") | The API needs Node 22.11–22.x: fits. |
| Database | MariaDB 11.4.13, names start `sfbhenfezi_` | Tested here on a local MariaDB 11.4: passes. |
| Existing Node apps | app.otsi.cc, jason-service, otsi-vpn, otsi.cc, vie-control-plane | Never touched. |
| `sfbhenfezi_vie` | Old engine's 5 tables, 17 rows | Backed up first; old tables stay in place. |
| accounts.otsi.cc | Does not exist yet | Has to be created (DNS + cPanel). |
| Disk / memory | Plenty | No limit for this. |

## Two stages

1. **Staging** at `staging-accounts.otsi.cc`, with its own new database `sfbhenfezi_vie_staging` and its own keys.
   Only test accounts. The owner tries it with a test build of the desktop app.
2. **Production** at `accounts.otsi.cc` on `sfbhenfezi_vie`, with new keys. Only after staging passes and a second yes.

Your current desktop install stays as it is (local mode) until you choose to link it.

## Work I do first, on this PC (no server change)

| # | What | Why |
| --- | --- | --- |
| A | Forward the company billing pages (`/v1/admin/billing/...`) from a linked desktop to the account server. | Today a linked desktop forwards only the club's own wallet and billing. Without this, OTSI (you) cannot enter bank details or confirm payments. |
| B | A deploy package script: the built API + contracts + a `package.json` with exact versions, installed on the host with `npm ci --omit=dev`. | The repo is a pnpm workspace; the host needs a plain Node app folder. |
| C | A database-accounts step for shared hosting: a migrator user (all privileges) and a runtime user (select, insert, update, delete, execute), both made in cPanel. | cPanel users cannot create roles, so `tools/db/roles.py` cannot run there. The append-only rules (ledger, audit) are also enforced by triggers, so they still hold. Recorded as an ADR. |
| D | A desktop test build that points at the staging address and carries the staging public key. | For your walkthrough. |
| E | Tests for A–C, run on the local MariaDB 11.4. | Proof before any server step. |

## Server steps (each needs your yes before it runs)

| # | Step | Changes | Undo |
| --- | --- | --- | --- |
| 1 | Back up `sfbhenfezi_vie` to `~/backups` on the host and a copy to D:. | Adds 2 files. | Delete the files. |
| 2 | Create database `sfbhenfezi_vie_staging` and its 2 users in cPanel. | New database and users only. | Delete them. |
| 3 | Run the migrations from this PC through an SSH tunnel, with the migrator user. First check: the host accepts the triggers and stored routines (binary-log setting). | Tables in the staging database only. | Drop the staging database. |
| 4 | Make the keys **on the host**, in a private folder outside the website (`~/private/otsi-accounts-staging`, readable only by the account): access-token key (RS256) and licence key (Ed25519). Only the public licence key leaves the host. | 2 key files. | Delete the folder. |
| 5 | Add `staging-accounts.otsi.cc` in cPanel, plus a Node 22 app from the deploy package with the settings from `central-server-deploy.md` step 4 (central mode, HTTPS issuer, keys, database, storage folder for receipts). | New subdomain and app only. | Remove the app and subdomain. |
| 6 | Cloudflare: one DNS-only A record `staging-accounts` → 66.29.148.78. AutoSSL issues the certificate. | One DNS record. No other record touched. | Delete the record. |
| 7 | Smoke test: HTTPS works, `/v1/auth/mode` says central, the log shows central mode, sign-up is rate-limited, cookies are Secure. | Nothing. | — |

## Your walkthrough (you click, I guide)

With the test desktop build: Create account → claim the free grant → sign out and in → wallet shows the server's
balance → a short analysis charges tokens → turn the internet off: the app still signs in and work runs inside the
200-token allowance → back online: it settles. Then, as OTSI: enter test bank details and confirm a test top-up.

## Production (a second yes, after staging passes)

Same steps 1–7 on `accounts.otsi.cc` and `sfbhenfezi_vie`, with new keys. Then: delete staging test data, set
`OTSI_VIE_COMPANY_ORG_ID` to your organisation, you enter OTSI's real bank details, and the desktop installer is built
with `https://accounts.otsi.cc` and the production public key.

## Risks and how they are handled

| Risk | Handling |
| --- | --- |
| The host refuses stored functions when binary logging is on. | Checked first in step 3, on staging. If refused, the function is rewritten as a procedure (tested locally first). |
| cPanel may run more than one copy of the app; the sign-up limit is counted per copy. | The limit still holds per copy (looser, not open). A shared limit in the database is a later improvement. |
| The host sleeps idle Node apps. | The first request after a pause is slower. Renewals catch up on start. Laptops retry; offline allowance covers gaps. |
| Database-wide privileges for the runtime user (instead of per-table). | Triggers keep the ledger and audit append-only; noted in the ADR. |
| Password-reset email | Not part of this step. Noted as open. |

## Never touched

vie.otsi.cc and its tunnel, app.otsi.cc, jason, api.otsi.cc (VPN), the website, and every other database
(`sfbhenfezi_otsi`, `sfbhenfezi_otsiapp`, `sfbhenfezi_jason`, `sfbhenfezi_vpn`, `sfbhenfezi_iptv`). No private key in
the repo or chat. Nothing is pushed.

## What I need from you

1. Yes to the work A–E on this PC.
2. Then, when that is tested, yes to server steps 1–7 for staging.
3. Then your walkthrough, and a separate yes for production.
