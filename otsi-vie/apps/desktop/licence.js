'use strict';
/**
 * Desktop side of the licence (ADR-144 §1.5, plan v3 §1c).
 *
 * The central server issues a server-signed licence token (Ed25519):
 *   { organization_id, plan, features, tokens, expires_at }
 * The shell stores that token locally (in the app's userData, never in the
 * log) and passes it to the worker, which verifies it with the central
 * server's Ed25519 public key (OTSI_VIE_LICENCE_PUBLIC_KEY_PEM or
 * OTSI_VIE_CENTRAL_JWKS_URL) and enforces it at job start
 * (services/worker/vie_worker/licence.py), plus tamper detection. The
 * shell NEVER treats a plain flag as proof: licenceStatus() below is
 * display only (what the loading window shows); enforcement lives in the
 * worker. If the worker refuses a job, that refusal is the enforcement —
 * the shell does not second-guess it.
 *
 * API surface (the contract the shell and the server build to):
 *   GET  /v1/licence         (AuthGuard) — snapshot: organisation, plan,
 *     features, token balance, valid_until, grace_until.
 *   POST /v1/licence/refresh (refresh cookie, no Bearer) — a fresh signed
 *     licence token and its expiry: { licence_token, expires_at }.
 * The refresh needs a live session, not a live access token: the refresh
 * cookie (otsi_vie_refresh, or __Host-otsi_vie_refresh when cookies are
 * Secure), the CSRF header `x-otsi-csrf: 1`, and the organization
 * (X-Organization-Id, stored from sign-in). No Origin header is sent:
 * the server rejects a present-but-not-allowed Origin, and the shell is
 * not a browser origin.
 *
 * The snapshot DOES need a valid access token (it is behind AuthGuard),
 * and access tokens expire 10 minutes after sign-in. refreshAccessToken()
 * below renews one from the stored refresh cookie (POST /v1/auth/refresh,
 * which also rotates the refresh cookie — the new one is stored), and
 * fetchLicenceSnapshotWithSession() calls it before the snapshot fetch
 * when the stored access token is expired, or on a 401, retrying once.
 *
 * Central sign-in (the handoff): the central server is the API only —
 * it has no sign-in page (central-server-deploy.md step 3: "the desktop
 * app signs in to the server API"), and there is no otsi_vie_access
 * cookie anywhere: the access token travels only in the login response
 * body, the refresh token only in the HttpOnly set-cookie header. So the
 * shell signs in to the API directly: signInToCentral() POSTs the
 * email/password to /v1/auth/login and storeCentralSession() stores the
 * session (access token, refresh token, and the organization when the
 * sign-in names exactly one). The main process exposes this as the
 * 'licence-sign-in' IPC handler (main.js); the renderer form that calls
 * it is the remaining piece. The live flow cannot be tested here — no
 * central server is deployed yet — the first live test is on the owner's
 * host.
 *
 * Offline grace: 14 days (OTSI_VIE_LICENCE_GRACE_DAYS, default 14). The
 * grace is a property of the licence, not of the network — a user who
 * never goes online gets 14 days, not forever. Note the worker enforces
 * expiry strictly and does NOT apply the grace (see
 * services/worker/vie_worker/licence.py): whether it should is an owner
 * decision, so until then a refreshed token is what unblocks work.
 *
 * No Electron dependency, so it can be checked and exercised with plain
 * Node. Nothing here ever logs a token.
 */

const fs = require('node:fs');
const path = require('node:path');

const centralConfig = require('./central-config');

const CSRF_HEADER = 'x-otsi-csrf';
const REFRESH_COOKIE = 'otsi_vie_refresh';
const SECURE_REFRESH_COOKIE = '__Host-otsi_vie_refresh';
const DEFAULT_GRACE_DAYS = 14;

/** The central server URL, or null for local-only (as today). Env wins over the build-time file
 *  (resources/central.json) — see central-config.js. */
function centralServerUrl() {
  return centralConfig.centralServerUrl();
}

function licenceGraceDays() {
  const n = Number(process.env.OTSI_VIE_LICENCE_GRACE_DAYS ?? DEFAULT_GRACE_DAYS);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_GRACE_DAYS;
}

function licenceFilePath(userDataDir) {
  return path.join(userDataDir, 'licence.json');
}

/** The stored licence, or null. Never logged. */
function readStoredLicence(userDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(licenceFilePath(userDataDir), 'utf8'));
    if (!data || typeof data.licence_token !== 'string' || !data.licence_token) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * The stored central session (access + refresh tokens), or null. Unlike readStoredLicence this does NOT
 * require a licence token: a fresh sign-in holds a session but no licence yet, and refreshLicence must
 * still see it — otherwise the first licence fetch after sign-in could never happen.
 */
function readStoredSession(userDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(licenceFilePath(userDataDir), 'utf8'));
    if (!data || typeof data.refresh_token !== 'string' || !data.refresh_token) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Store a licence (and, when the sign-in flow supplies them, the central
 * session tokens the next refresh needs). Only the named fields are kept;
 * the file is written with owner-only permissions where the platform
 * allows. The token is never written to the log.
 */
function storeLicence(userDataDir, data) {
  const keep = {};
  for (const k of ['licence_token', 'expires_at', 'organization_id', 'plan', 'features',
    'tokens', 'valid_until', 'grace_until', 'access_token', 'refresh_token']) {
    if (data[k] !== undefined) keep[k] = data[k];
  }
  keep.updated_at = new Date().toISOString();
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = licenceFilePath(userDataDir);
  fs.writeFileSync(file, JSON.stringify(keep, null, 2) + '\n', 'utf8');
  try { fs.chmodSync(file, 0o600); } catch { /* Windows: best effort */ }
  return keep;
}

/**
 * Display-only licence state, from the stored token. Enforcement is in the
 * worker — this only decides what the loading window says.
 * States: 'local-only' (no central server configured), 'none' (no token
 * stored yet), 'valid', 'in-grace' (expired, within the grace window),
 * 'expired' (past grace), 'invalid' (the server rejected the session),
 * 'error' (the refresh was refused for a reason other than a dead session,
 * e.g. the organization is unknown — see refreshLicence).
 */
function licenceStatus(userDataDir, nowMs = Date.now()) {
  if (!centralServerUrl()) return { state: 'local-only' };
  const stored = readStoredLicence(userDataDir);
  if (!stored) return { state: 'none' };
  const expiresAt = stored.expires_at || stored.valid_until || null;
  const graceDays = licenceGraceDays();
  // Prefer the server-computed grace_until when the snapshot supplied one.
  const graceUntil = stored.grace_until || (expiresAt
    ? new Date(Date.parse(expiresAt) + graceDays * 86_400_000).toISOString()
    : null);
  const out = {
    state: 'valid',
    plan: stored.plan || null,
    expiresAt,
    graceUntil,
  };
  if (!expiresAt) return out; // free tier: no expiry, no grace window
  if (nowMs < Date.parse(expiresAt)) return out;
  if (graceUntil && nowMs < Date.parse(graceUntil)) return { ...out, state: 'in-grace' };
  return { ...out, state: 'expired' };
}

/** What the worker gets: the token, the central public key when configured, and the issuer when known.
 *  The key comes from the environment or the build-time file (central-config.js), so a staging build
 *  verifies licence tokens against the staging server's key. */
function licenceEnvForWorker(userDataDir) {
  const env = {};
  const stored = readStoredLicence(userDataDir);
  if (stored) env.OTSI_VIE_LICENCE_TOKEN = stored.licence_token;
  const publicKey = centralConfig.licencePublicKeyPem();
  if (publicKey) {
    env.OTSI_VIE_LICENCE_PUBLIC_KEY_PEM = publicKey;
  }
  if (process.env.OTSI_VIE_CENTRAL_JWKS_URL) {
    env.OTSI_VIE_CENTRAL_JWKS_URL = process.env.OTSI_VIE_CENTRAL_JWKS_URL;
  }
  if (process.env.OTSI_VIE_JWT_ISSUER) {
    env.OTSI_VIE_JWT_ISSUER = process.env.OTSI_VIE_JWT_ISSUER;
  }
  return env;
}

/** An Error that also carries the server's stable code (NO_SESSION, NOT_A_MEMBER, ...), when it sent one. */
function errorWithCode(message, code) {
  const err = new Error(message);
  if (code) err.code = code;
  return err;
}

async function fetchJson(url, options, timeoutMs = 15000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: res.status, body, headers: res.headers };
}

/** The refresh-token value out of set-cookie header(s) (string or array). Null when none was set. */
function refreshTokenFromSetCookie(setCookie) {
  const all = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  for (const c of all) {
    const m = /(?:__Host-)?otsi_vie_refresh=([^;]+)/.exec(String(c));
    if (m) {
      try { return decodeURIComponent(m[1]); } catch { return m[1]; }
    }
  }
  return null;
}

/** True when the access token is expired (or unreadable — then a refresh is attempted rather than trusting it). Reading the exp claim needs no verification. */
function accessTokenExpired(accessToken, nowMs = Date.now()) {
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken).split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp !== 'number' || nowMs >= payload.exp * 1000;
  } catch {
    return true;
  }
}

/**
 * POST /v1/auth/refresh — a fresh access token from the stored refresh cookie. The server rotates the
 * refresh cookie, so the returned refresh_token is the NEW one when the server set it (the old one is
 * kept only when it did not). Throws AUTH_UNAUTHENTICATED when the session is dead — sign in again.
 */
async function refreshAccessToken(centralUrl, refreshToken) {
  if (!refreshToken) throw new Error('no session');
  const secure = centralUrl.startsWith('https://');
  const cookieName = secure ? SECURE_REFRESH_COOKIE : REFRESH_COOKIE;
  const { status, body, headers } = await fetchJson(`${centralUrl}/v1/auth/refresh`, {
    method: 'POST',
    headers: {
      [CSRF_HEADER]: '1',
      Cookie: `${cookieName}=${encodeURIComponent(refreshToken)}`,
      Accept: 'application/json',
    },
  });
  if (status === 401) throw errorWithCode('AUTH_UNAUTHENTICATED', body && body.code);
  if (status < 200 || status >= 300) throw errorWithCode(`auth refresh failed (HTTP ${status})`, body && body.code);
  if (!body || typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('auth refresh was not in the expected shape');
  }
  const setCookie = headers && typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : headers && headers.get('set-cookie');
  const rotated = refreshTokenFromSetCookie(setCookie);
  return { access_token: body.access_token, refresh_token: rotated || refreshToken };
}

/** GET /v1/licence — the current snapshot. Needs a Bearer access token. */
async function fetchLicenceSnapshot(centralUrl, accessToken) {
  if (!accessToken) throw new Error('no access token');
  const { status, body } = await fetchJson(`${centralUrl}/v1/licence`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (status === 401) throw new Error('LICENCE_UNAUTHENTICATED');
  if (status < 200 || status >= 300) throw new Error(`licence snapshot failed (HTTP ${status})`);
  if (!body || typeof body.organization_id !== 'string') throw new Error('licence snapshot was not in the expected shape');
  return body;
}

/**
 * The snapshot fetch with its access token kept alive: the stored access token is renewed first when it
 * is expired, and a 401 renews it and retries once (the token may have expired mid-flight). Returns the
 * snapshot plus the (possibly renewed) tokens, so the caller can store them. Throws 'no session' when
 * there is no refresh cookie to renew from, and AUTH_UNAUTHENTICATED when the session itself is dead.
 */
async function fetchLicenceSnapshotWithSession(centralUrl, stored) {
  if (!stored || !stored.refresh_token) throw new Error('no session');
  let accessToken = stored.access_token || null;
  let refreshToken = stored.refresh_token;
  if (!accessToken || accessTokenExpired(accessToken)) {
    const fresh = await refreshAccessToken(centralUrl, refreshToken);
    accessToken = fresh.access_token;
    refreshToken = fresh.refresh_token;
  }
  try {
    const snapshot = await fetchLicenceSnapshot(centralUrl, accessToken);
    return { snapshot, access_token: accessToken, refresh_token: refreshToken };
  } catch (err) {
    if (String((err && err.message) || err) !== 'LICENCE_UNAUTHENTICATED') throw err;
    const fresh = await refreshAccessToken(centralUrl, refreshToken);
    const snapshot = await fetchLicenceSnapshot(centralUrl, fresh.access_token);
    return { snapshot, access_token: fresh.access_token, refresh_token: fresh.refresh_token };
  }
}

/**
 * The session out of a sign-in response (login or two-step): the access token from the body, the refresh
 * token from the set-cookie header(s). A two-step challenge is not a session — it comes back as
 * { mfa_required: true, mfa_token, expires_in } for completeCentralTwoStep(). Pure: no fetch, no
 * Electron, so it is unit-testable with plain Node.
 */
function sessionFromAuthResponse(body, setCookie) {
  if (body && body.mfa_required === true) {
    if (typeof body.mfa_token !== 'string' || !body.mfa_token) {
      throw new Error('two-step sign-in was not in the expected shape');
    }
    return { mfa_required: true, mfa_token: body.mfa_token, expires_in: body.expires_in || null };
  }
  if (!body || typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('central sign-in was not in the expected shape');
  }
  const refreshToken = refreshTokenFromSetCookie(setCookie);
  if (!refreshToken) throw new Error('central sign-in did not set a refresh cookie');
  return { access_token: body.access_token, refresh_token: refreshToken, me: body.me || null };
}

/**
 * The organization a sign-in names, when it names exactly one (Me.memberships). Several memberships
 * means the app cannot tell which licence to refresh — the caller must choose, and the app has no
 * organization picker yet, so this returns null and refreshLicence reports 'error' instead of guessing.
 */
function organizationIdFromMe(me) {
  if (!me || !Array.isArray(me.memberships) || me.memberships.length !== 1) return null;
  const id = me.memberships[0] && me.memberships[0].organization_id;
  return typeof id === 'string' && id ? id : null;
}

/** Store a central session from sign-in: the tokens, and the organization when the sign-in named one. */
function storeCentralSession(userDataDir, session) {
  const data = { access_token: session.access_token, refresh_token: session.refresh_token };
  const organizationId = organizationIdFromMe(session.me);
  if (organizationId) data.organization_id = organizationId;
  return storeLicence(userDataDir, data);
}

/**
 * POST /v1/auth/login — central sign-in. The central server is the API only, so the shell signs in to
 * the API directly with the email/password (CSRF header, no Origin). Returns the session (see
 * sessionFromAuthResponse) or a two-step challenge. A wrong password is the server's own message.
 */
async function signInToCentral(centralUrl, { email, password }) {
  if (!email || !password) throw new Error('email and password are required');
  const { status, body, headers } = await fetchJson(`${centralUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { [CSRF_HEADER]: '1', 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (status < 200 || status >= 300) {
    throw errorWithCode((body && body.message) || `central sign-in failed (HTTP ${status})`, body && body.code);
  }
  const setCookie = headers && typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : headers && headers.get('set-cookie');
  return sessionFromAuthResponse(body, setCookie);
}

/** POST /v1/auth/login/two-step — step 2 of central sign-in (the challenge token plus an authenticator code). */
async function completeCentralTwoStep(centralUrl, { mfa_token, code }) {
  if (!mfa_token || !code) throw new Error('a two-step challenge token and code are required');
  const { status, body, headers } = await fetchJson(`${centralUrl}/v1/auth/login/two-step`, {
    method: 'POST',
    headers: { [CSRF_HEADER]: '1', 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ mfa_token, code }),
  });
  if (status < 200 || status >= 300) {
    throw errorWithCode((body && body.message) || `two-step sign-in failed (HTTP ${status})`, body && body.code);
  }
  const setCookie = headers && typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : headers && headers.get('set-cookie');
  return sessionFromAuthResponse(body, setCookie);
}

/**
 * POST /v1/licence/refresh — a fresh signed licence token. Needs the live session: the refresh cookie
 * plus the CSRF header and the organization (X-Organization-Id). No live access token is needed (the
 * server authenticates on the cookie alone) — one is sent when the shell happens to hold it, for an
 * older server that still requires it, but its absence never blocks the refresh. No Origin header is
 * sent: the server rejects a present-but-not-allowed Origin, and the shell is not a browser origin.
 */
async function refreshLicenceToken(centralUrl, { accessToken, refreshToken, organizationId }) {
  if (!refreshToken) throw new Error('no session');
  const secure = centralUrl.startsWith('https://');
  const cookieName = secure ? SECURE_REFRESH_COOKIE : REFRESH_COOKIE;
  const headers = {
    [CSRF_HEADER]: '1',
    Cookie: `${cookieName}=${encodeURIComponent(refreshToken)}`,
    Accept: 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (organizationId) headers['X-Organization-Id'] = organizationId;
  const { status, body } = await fetchJson(`${centralUrl}/v1/licence/refresh`, {
    method: 'POST',
    headers,
  });
  if (status === 401) throw errorWithCode('LICENCE_UNAUTHENTICATED', body && body.code);
  if (status < 200 || status >= 300) throw errorWithCode(`licence refresh failed (HTTP ${status})`, body && body.code);
  if (!body || typeof body.licence_token !== 'string' || !body.licence_token) {
    throw new Error('licence refresh was not in the expected shape');
  }
  return body; // { licence_token, expires_at }
}

/**
 * Refresh the stored licence when a central server is configured and a session is stored. Never throws
 * and never blocks startup: offline means "use the stored token and its grace", and a missing session
 * means "local-only until the user signs in on the central server". Returns the display status plus a
 * plain-word note for the log. A dead session (NO_SESSION) is 'invalid' — sign in again. A refresh
 * refused for another reason (the organization is unknown, or the user is not a member of it) is
 * 'error' with the reason — the session may be live, so it must not be reported as "sign in again".
 */
async function refreshLicence(userDataDir, log) {
  const centralUrl = centralServerUrl();
  if (!centralUrl) return { ...licenceStatus(userDataDir), note: 'Local-only: no central server is configured.' };
  const stored = readStoredSession(userDataDir);
  if (!stored) {
    return {
      ...licenceStatus(userDataDir),
      note: 'No central sign-in yet in this app — the licence will be fetched when you sign in.',
    };
  }
  if (!stored.organization_id) {
    return {
      ...licenceStatus(userDataDir),
      state: 'error',
      note: 'Signed in, but the app does not know which organization the licence belongs to — the sign-in covered more than one.',
    };
  }
  try {
    const fresh = await refreshLicenceToken(centralUrl, {
      accessToken: stored.access_token,
      refreshToken: stored.refresh_token,
      organizationId: stored.organization_id,
    });
    storeLicence(userDataDir, { ...stored, licence_token: fresh.licence_token, expires_at: fresh.expires_at });
    const status = licenceStatus(userDataDir);
    return { ...status, note: `Licence refreshed (plan ${status.plan || 'unknown'}, valid until ${status.expiresAt || 'no expiry'}).` };
  } catch (err) {
    const message = String((err && err.message) || err);
    const code = (err && err.code) || null;
    if (message === 'LICENCE_UNAUTHENTICATED') {
      if (!code || code === 'NO_SESSION') {
        if (log) log('The central server did not accept the saved sign-in; sign in again to refresh the licence.\n');
        return { ...licenceStatus(userDataDir), state: 'invalid', note: 'The saved sign-in was rejected; sign in again.' };
      }
      if (log) log(`The central server refused the licence refresh (${code}); the saved sign-in may still be live.\n`);
      return { ...licenceStatus(userDataDir), state: 'error', note: `The central server refused the licence refresh (${code}).` };
    }
    if (code === 'ORGANIZATION_REQUIRED' || code === 'NOT_A_MEMBER') {
      if (log) log(`The central server refused the licence refresh (${code}); the saved sign-in may still be live.\n`);
      return { ...licenceStatus(userDataDir), state: 'error', note: `The central server refused the licence refresh (${code}).` };
    }
    // Offline (or the server did not answer): the stored token and its
    // grace decide what the loading window says; the worker enforces.
    const status = licenceStatus(userDataDir);
    const note = status.state === 'in-grace'
      ? `Offline — the licence expired, but the ${licenceGraceDays()}-day grace still covers it (until ${status.graceUntil}).`
      : status.state === 'expired'
        ? 'Offline and the licence grace has run out — analysis stays paused until the app can reach the server again.'
        : 'Offline — using the stored licence; it will refresh when the connection is back.';
    if (log) log(`Licence refresh did not reach the server (${message}); ${note}\n`);
    return { ...status, note };
  }
}

module.exports = {
  CSRF_HEADER,
  REFRESH_COOKIE,
  SECURE_REFRESH_COOKIE,
  DEFAULT_GRACE_DAYS,
  centralServerUrl,
  licenceGraceDays,
  licenceFilePath,
  readStoredLicence,
  readStoredSession,
  storeLicence,
  licenceStatus,
  licenceEnvForWorker,
  fetchLicenceSnapshot,
  fetchLicenceSnapshotWithSession,
  refreshAccessToken,
  accessTokenExpired,
  refreshTokenFromSetCookie,
  sessionFromAuthResponse,
  organizationIdFromMe,
  storeCentralSession,
  signInToCentral,
  completeCentralTwoStep,
  refreshLicenceToken,
  refreshLicence,
};
