'use strict';
/**
 * Desktop side of the licence (ADR-144 §1.5, plan v3 §1c).
 *
 * The central server issues a server-signed licence token (Ed25519):
 *   { organization_id, plan, features, tokens, expires_at }
 * The shell stores that token locally (in the app's userData, never in the
 * log) and passes it to the compiled native engine, which verifies it with
 * the central server's Ed25519 public key (OTSI_VIE_LICENCE_PUBLIC_KEY_PEM
 * or OTSI_VIE_CENTRAL_JWKS_URL) and enforces it, plus tamper detection.
 * The shell NEVER treats a plain flag as proof: licenceStatus() below is
 * display only (what the loading window shows); enforcement lives in the
 * native code. If the native engine refuses a job, that refusal is the
 * enforcement — the shell does not second-guess it.
 *
 * API surface (the contract the shell and the server build to):
 *   GET  /v1/licence         (AuthGuard) — snapshot: organisation, plan,
 *     features, token balance, valid_until, grace_until.
 *   POST /v1/licence/refresh (AuthGuard, refresh cookie) — a fresh signed
 *     licence token and its expiry: { licence_token, expires_at }.
 * The refresh needs a live session: a Bearer access token AND the refresh
 * cookie (otsi_vie_refresh, or __Host-otsi_vie_refresh when cookies are
 * Secure), plus the CSRF header `x-otsi-csrf: 1`. The shell holds those
 * only after the central sign-in flow hands them over (see storeLicence);
 * until then it reports "no session" and carries on local-only. The
 * sign-in handoff itself is the central-server build's part — this module
 * is ready to consume the session once it exists.
 *
 * Offline grace: 14 days (OTSI_VIE_LICENCE_GRACE_DAYS, default 14). The
 * grace is a property of the licence, not of the network — a user who
 * never goes online gets 14 days, not forever.
 *
 * NOTE (2026-11-11): the licence module in the tree
 * (apps/api/src/modules/licence/licence.ts) currently signs RS256; ADR-144
 * v3 §1.5 says Ed25519. The shell treats the token as an opaque string, so
 * it works with either — but the API side must be aligned to Ed25519
 * before the first signed release. The public-key passthrough below
 * forwards whichever key the central server publishes.
 *
 * No Electron dependency, so it can be checked and exercised with plain
 * Node. Nothing here ever logs a token.
 */

const fs = require('node:fs');
const path = require('node:path');

const CSRF_HEADER = 'x-otsi-csrf';
const REFRESH_COOKIE = 'otsi_vie_refresh';
const SECURE_REFRESH_COOKIE = '__Host-otsi_vie_refresh';
const DEFAULT_GRACE_DAYS = 14;

/** The central server URL, or null for local-only (as today). */
function centralServerUrl() {
  const raw = (process.env.OTSI_VIE_CENTRAL_SERVER_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return null;
  if (/^https:\/\//.test(raw)) return raw;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(raw)) return raw; // dev only
  return null; // a central server is a real domain over HTTPS; anything else is ignored, not guessed
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
 * native engine — this only decides what the loading window says.
 * States: 'local-only' (no central server configured), 'none' (no token
 * stored yet), 'valid', 'in-grace' (expired, within the grace window),
 * 'expired' (past grace), 'invalid' (the server rejected the session).
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

/** What the native worker gets: the token, and the central public key when configured. */
function licenceEnvForWorker(userDataDir) {
  const env = {};
  const stored = readStoredLicence(userDataDir);
  if (stored) env.OTSI_VIE_LICENCE_TOKEN = stored.licence_token;
  if (process.env.OTSI_VIE_LICENCE_PUBLIC_KEY_PEM) {
    env.OTSI_VIE_LICENCE_PUBLIC_KEY_PEM = process.env.OTSI_VIE_LICENCE_PUBLIC_KEY_PEM;
  }
  if (process.env.OTSI_VIE_CENTRAL_JWKS_URL) {
    env.OTSI_VIE_CENTRAL_JWKS_URL = process.env.OTSI_VIE_CENTRAL_JWKS_URL;
  }
  return env;
}

async function fetchJson(url, options, timeoutMs = 15000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { status: res.status, body };
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
 * POST /v1/licence/refresh — a fresh signed licence token. Needs the live
 * session: Bearer access token + refresh cookie + CSRF header. No Origin
 * header is sent: the server rejects a present-but-not-allowed Origin, and
 * the shell is not a browser origin.
 */
async function refreshLicenceToken(centralUrl, { accessToken, refreshToken }) {
  if (!accessToken || !refreshToken) throw new Error('no session');
  const secure = centralUrl.startsWith('https://');
  const cookieName = secure ? SECURE_REFRESH_COOKIE : REFRESH_COOKIE;
  const { status, body } = await fetchJson(`${centralUrl}/v1/licence/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      [CSRF_HEADER]: '1',
      Cookie: `${cookieName}=${encodeURIComponent(refreshToken)}`,
      Accept: 'application/json',
    },
  });
  if (status === 401) throw new Error('LICENCE_UNAUTHENTICATED');
  if (status < 200 || status >= 300) throw new Error(`licence refresh failed (HTTP ${status})`);
  if (!body || typeof body.licence_token !== 'string' || !body.licence_token) {
    throw new Error('licence refresh was not in the expected shape');
  }
  return body; // { licence_token, expires_at }
}

/**
 * Refresh the stored licence when a central server is configured and a
 * session is stored. Never throws and never blocks startup: offline means
 * "use the stored token and its grace", and a missing session means
 * "local-only until the user signs in on the central server". Returns the
 * display status plus a plain-word note for the log.
 */
async function refreshLicence(userDataDir, log) {
  const centralUrl = centralServerUrl();
  if (!centralUrl) return { ...licenceStatus(userDataDir), note: 'Local-only: no central server is configured.' };
  const stored = readStoredLicence(userDataDir);
  if (!stored || !stored.access_token || !stored.refresh_token) {
    return {
      ...licenceStatus(userDataDir),
      note: 'No central sign-in yet in this app — the licence will be fetched when you sign in.',
    };
  }
  try {
    const fresh = await refreshLicenceToken(centralUrl, {
      accessToken: stored.access_token,
      refreshToken: stored.refresh_token,
    });
    storeLicence(userDataDir, { ...stored, licence_token: fresh.licence_token, expires_at: fresh.expires_at });
    const status = licenceStatus(userDataDir);
    return { ...status, note: `Licence refreshed (plan ${status.plan || 'unknown'}, valid until ${status.expiresAt || 'no expiry'}).` };
  } catch (err) {
    const message = String((err && err.message) || err);
    if (message === 'LICENCE_UNAUTHENTICATED') {
      if (log) log('The central server did not accept the saved sign-in; sign in again to refresh the licence.\n');
      return { ...licenceStatus(userDataDir), state: 'invalid', note: 'The saved sign-in was rejected; sign in again.' };
    }
    // Offline (or the server did not answer): the stored token and its
    // grace decide what the loading window says; the native engine enforces.
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
  storeLicence,
  licenceStatus,
  licenceEnvForWorker,
  fetchLicenceSnapshot,
  refreshLicenceToken,
  refreshLicence,
};
