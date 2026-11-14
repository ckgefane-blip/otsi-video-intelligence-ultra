'use strict';
// Loopback URLs (backend.js): the API proxy target must be the literal
// 127.0.0.1, and the window URL must stay localhost. Run: npm test (node --test).
//
// Why: the API binds 127.0.0.1 only (apps/api/src/main.ts), and the web
// reaches it through API_URL as the proxy target (OTSI_VIE_API_INTERNAL_URL).
// Under Electron 43's newer Node, `localhost` can resolve to IPv6 ::1 first,
// and nothing listens there — the web logged "Failed to proxy
// http://localhost:4521 ... ECONNREFUSED" and the app closed itself. A literal
// address is never resolved, so it cannot fail this way.
//
// WEB_URL stays `localhost` on purpose: the window loads this origin, and the
// passkey (WebAuthn) relying-party ID and expected origin are `localhost`.
// Chromium rejects 127.0.0.1 as a WebAuthn RP ID, so loading the window at
// 127.0.0.1 would break fingerprint sign-in in the app window.
const test = require('node:test');
const assert = require('node:assert/strict');

const backend = require('../backend');

test('the API URL is the literal 127.0.0.1, never localhost', () => {
  assert.equal(backend.API_PORT, 4521);
  assert.equal(backend.API_URL, 'http://127.0.0.1:4521');
  assert.doesNotMatch(backend.API_URL, /localhost/);
});

test('the window URL stays localhost (WebAuthn needs it)', () => {
  assert.equal(backend.WEB_PORT, 4311);
  assert.equal(backend.WEB_URL, 'http://localhost:4311');
});

test('the API and web URLs use their own ports', () => {
  assert.ok(backend.API_URL.endsWith(`:${backend.API_PORT}`));
  assert.ok(backend.WEB_URL.endsWith(`:${backend.WEB_PORT}`));
  assert.notEqual(backend.API_PORT, backend.WEB_PORT);
});
