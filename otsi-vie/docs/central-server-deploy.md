# Central server deploy checklist (ADR-144, owner-only)

**Status:** checklist, not a deploy. Nothing in this document has been done from the repo side: no
subdomain exists, no database exists, no code has been deployed anywhere, and no key has been generated.
Every step below is done by the owner (or on his explicit instruction), in order, with the approval named
before it. The central server is the **same API codebase** deployed on the owner's existing hosting — not a
second codebase, and not a change to the live engine at vie.otsi.cc (which is a different deployment and is
never touched by this work).

## What the central server is

- One small deployment of the API in `otsi-vie/apps/api` on the owner's existing hosting: a subdomain plus
  MySQL. It holds accounts, sign-in, passkeys, organisations and teams, licences and entitlements, the token
  wallet and seats, billing, and the audit log.
- It never processes video. Footage stays on the user's PC unless they choose to share an export.
- The desktop app's local engine runs in **local mode** (today's behaviour) and verifies licence tokens issued
  by this server against the server's public key. The server runs in **central mode**.

## Decisions the owner makes first (before any step)

| Decision | Default suggestion | Owner's call |
| --- | --- | --- |
| The subdomain | `accounts.otsi.cc` | The name is the owner's choice. The JWT issuer, the WebAuthn origins and the desktop shell's server URL all follow from it, so it must be fixed before step 3. |
| The product domain for passkeys (WebAuthn RP ID) | `otsi.cc` | Must be the product domain the users sign in on — never `localhost`, never `127.0.0.1` (Chromium rejects `127.0.0.1` as a WebAuthn RP ID). |
| The hosting MySQL database + accounts | A new database, e.g. `otsi_vie_central`, with its own least-privilege runtime account | The owner's hosting; the database must be empty before migrations run. |

## Step 0 — Approve the hosting use

- **Approval needed:** the owner approves using his existing hosting for this server (subdomain + MySQL) and
  confirms the subdomain name from the table above.
- **Not done here:** no DNS record is created, no hosting setting is changed, nothing is deployed.

## Step 1 — Staging first: create the staging subdomain + database

- Create a **staging** subdomain first (e.g. `staging-accounts.otsi.cc` — the owner's choice, following the
  same pattern as the production name) and point it at the hosting.
- Create an empty MySQL database for staging (e.g. `otsi_vie_central_staging`) and two accounts: a migrator
  (creates tables) and a least-privilege runtime account (the API's account — it must never be the migrator).
  The repo's `tools/db/roles.py` prints/grants the runtime account's statements (`--dsn` takes the admin DSN,
  `OTSI_VIE_ADMIN_DSN`).
- **Approval needed before step 2:** the owner confirms the staging database exists and is empty, and that the
  runtime account's password is recorded somewhere safe (never in the repo, never in chat).

## Step 2 — Generate the key pairs (once, staging and production each get their own)

- There are **two** key pairs, and they must not be confused:
  1. **Access tokens (RS256, as today):** the private key the API signs its access tokens with
     (`OTSI_VIE_LOCAL_SIGNING_KEY_FILE`). Generate it as the local stack does today.
  2. **Licence tokens (Ed25519, ADR-144 v3 §1.5):** the server-signed licence key. On a machine the owner
     controls (not in the repo, not on this VM):
     `openssl genpkey -algorithm ED25519 -out licence-signing-key.pem`
     and the public half: `openssl pkey -in licence-signing-key.pem -pubout -out licence-signing-key.pub.pem`.
- The **private** keys go to the server only, as files the API reads. They are never committed, never pasted
  into chat, never emailed, and the licence private key is **never in the installer**. The **public** keys are
  what is distributed: the licence public key goes into `OTSI_VIE_LICENCE_PUBLIC_KEY_PEM` on the server itself
  and into the desktop builds so local engines can verify licence tokens.
- **Approval needed before step 3:** the owner confirms both key pairs exist and the private keys are on the
  server only.

## Step 3 — Deploy the API to staging

- Deploy the same API codebase (the `muse/ultra-main` branch, once the owner has approved it) behind HTTPS
  on the staging subdomain, with the environment below. Nothing else is deployed: no web app is required on
  the central server for sign-in to work (the desktop app signs in to the server API), and no worker is
  deployed (the central server never processes video).
- **Approval needed before step 4:** the owner approves the staging deploy and the environment values.

## Step 4 — Environment (staging, then production with its own values)

Set these on the server. Values shown are for the suggested subdomain; replace `accounts.otsi.cc` with the
owner's chosen name everywhere it appears.

| Variable | Staging / production value | Notes |
| --- | --- | --- |
| `OTSI_VIE_CENTRAL_MODE` | `yes` | This deployment IS the central server. Without it the API runs in local mode. |
| `OTSI_VIE_JWT_ISSUER` | `https://accounts.otsi.cc/` | A real domain as the JWT issuer. Trailing slash, exactly as the local stack uses `http://127.0.0.1:<port>/`. |
| `OTSI_VIE_JWT_AUDIENCE` | `otsi-vie-api` | Unchanged from the local deployment. |
| `OTSI_VIE_DB_DSN` | `mysql://otsi_app:<password>@<hosting-mysql-host>:3306/otsi_vie_central` | The hosting MySQL, runtime account, staging database name for staging. |
| `OTSI_VIE_ALLOW_PORT_3306` | `yes` | Hosting MySQL listens on 3306, and the API refuses port 3306 without this flag (a guard against touching the owner's existing database on his own machine). Set it only on the server, never locally. |
| `OTSI_VIE_LOCAL_SIGNING_KEY_FILE` | e.g. `/etc/otsi-vie/signing-key.pem` | The RS256 private key from step 2 (access tokens). The API derives its public key from it automatically, so `OTSI_VIE_JWT_PUBLIC_KEY_PEM` does not need to be set. |
| `OTSI_VIE_LICENCE_SIGNING_KEY` | The Ed25519 private key from step 2, as PEM text | **Central server only, never in the installer, never logged.** This is the key licence tokens are signed with. The API fails to start in central mode without it. |
| `OTSI_VIE_LICENCE_PUBLIC_KEY_PEM` | The Ed25519 public half from step 2 (PEM text) | Lets this server verify the licence tokens it issues; the same value goes into desktop builds for local engines. |
| `OTSI_VIE_CENTRAL_SERVER_URL` | `https://accounts.otsi.cc` | The server's base URL, advertised to the desktop shell. No trailing slash. |
| `OTSI_VIE_WEBAUTHN_RP_ID` | `otsi.cc` | The product domain — never `localhost`, never `127.0.0.1`. |
| `OTSI_VIE_WEBAUTHN_RP_NAME` | `OTSI VIE` | As today. |
| `OTSI_VIE_WEB_ORIGINS` | `https://accounts.otsi.cc` | The sign-in page origin. WebAuthn accepts exactly this origin for passkey ceremonies; the API's cookie endpoints accept it too. Add further origins comma-separated only if another page signs in. |
| `OTSI_VIE_LICENCE_GRACE_DAYS` | `14` | The offline grace (ADR-144 §1.5). 14 is the default — the variable may be omitted entirely. |
| `OTSI_VIE_API_PORT` | The hosting's port for the API | As the hosting requires. |
| `OTSI_VIE_STORAGE_DIR` | The hosting's storage path | Only if the central server stores uploads (receipts for bank-transfer proof, §7 of the plan). |
| `OTSI_VIE_MEDIA_SIGNING_KEY` | A long random string, server-only | Only if the central server serves signed media URLs. |
| `OTSI_VIE_CREDENTIAL_KEY` | A base64 AES-256 key, server-only | Only if the central server seals provider tokens. |

Do **NOT** set `OTSI_VIE_INSECURE_COOKIES=yes` on the server: secure cookies are on by default in central
mode, and the refresh cookie must be `Secure` + `__Host-` prefixed over HTTPS. Do **NOT** set
`OTSI_VIE_JWT_ISSUER` to `http://127.0.0.1:...` or to `localhost` on the server — that is the local-mode
value, and tokens issued under it would not be the central server's tokens.

## Step 5 — Run the migrations on staging

- With the migrator account (never the runtime account):
  `python3 tools/db/migrate.py up --dsn mysql://<migrator>:<password>@<host>:3306/otsi_vie_central_staging`
  (the same runner the local stack uses; `status` lists what is applied). Migrations are forward-only; the
  licence module needs **no new tables** — the snapshot is derived from `subscriptions`, `plan_versions`,
  `plans`, `entitlement_grants` and the wallet ledger, all of which already exist.
- **Approval needed before step 6:** the owner confirms `migrate.py status` shows every migration applied
  and the API starts without a configuration error.

## Step 6 — Smoke-check staging (before any production step)

1. The API answers on `https://<staging-subdomain>/` and its log shows central mode on.
2. Create the owner account on staging (the bootstrap-owner flow) and sign in with email + password.
3. `GET /v1/licence` returns the free-tier snapshot (`plan "FREE"`, `valid_until` null, `grace_until` null,
   `tokens` the wallet balance).
4. `POST /v1/licence/refresh` (with the session cookie) returns a licence token; verifying it against the
   Ed25519 public key from step 2 returns the same claims. The token header must read `EdDSA` — an RS256
   token is not a licence token and must not verify.
5. Register a passkey on the staging domain and sign in with it (Windows Hello) — this is the real-domain
   passkey test, and it must pass on staging before production exists.
6. Confirm the refresh cookie is `Secure` and `__Host-` prefixed in the browser.

## Step 7 — Production: repeat steps 1–6 with production values

- Production subdomain + database + its **own** key pairs (never reuse staging's private keys).
- Production environment from the table in step 4, with the production subdomain and database.
- Run the migrations, then repeat the step 6 smoke checks against production.
- **Approval needed before step 7:** the owner approves the production subdomain, database and key pair, and
  confirms staging passed step 6.

## Step 8 — Hand the public key to the desktop builds

- The production **Ed25519 public** key (`OTSI_VIE_LICENCE_PUBLIC_KEY_PEM` value) is what desktop builds ship
  so a local engine can verify licence tokens offline — the check runs inside the compiled native code
  (ADR-144 v3 §1.5/§1.8), never on a plain flag. The private key never leaves the server.
- The desktop shell reads the server URL from `OTSI_VIE_CENTRAL_SERVER_URL` — that wiring is the desktop
  shell's step (plan step 5, another agent's part), not this checklist's.

## What is NOT done from here (and not by this checklist's author)

- No DNS record, no hosting change, no deploy, no database creation, no key generation — all owner-only.
- No live sign-in against the real domain has been tested (there is no real domain yet); the passkey and
  licence-refresh checks above are staging/production steps for the owner.
- No bank-transfer billing is deployed by this checklist (that is plan step 7, another build); the licence
  module reads the subscription and grants that billing creates, but creates none of them.
- The local engine's offline behaviour (grace applied by the desktop shell) is the shell's step, not the
  server's: the server issues a strict token, and the shell applies the 14-day grace.
