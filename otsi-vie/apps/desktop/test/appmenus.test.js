'use strict';
// The title-bar menus (appmenus.js): every item does a real thing, labels in sentence case, routes exist in the web app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MENU_NAMES, menuTemplate, shortcutFor } = require('../appmenus');

function fakeCtx(over = {}) {
  const calls = [];
  const rec = (name) => (...args) => calls.push([name, ...args]);
  const ctx = {
    send: rec('send'), press: rec('press'), reload: rec('reload'), zoom: rec('zoom'), toggleFullScreen: rec('toggleFullScreen'),
    toggleOnTop: rec('toggleOnTop'), toggleDevTools: rec('toggleDevTools'), back: rec('back'), forward: rec('forward'),
    checkForUpdates: rec('checkForUpdates'), about: rec('about'), quit: rec('quit'),
    canGoBack: true, canGoForward: false, isFullScreen: false, isOnTop: true, updatesAvailable: false, ...over,
  };
  return { ctx, calls };
}
const items = (name, ctx) => menuTemplate(name, ctx).filter((i) => i.type !== 'separator');
const APP = path.join(__dirname, '..', '..', 'web', 'src', 'app');

test('the five menus, in the order of the title bar', () => {
  assert.deepEqual(MENU_NAMES, ['file', 'edit', 'view', 'go', 'help']);
  assert.equal(menuTemplate('nope', fakeCtx().ctx), null);
});

test('every item does something: a click or one of Chromium\'s editing commands', () => {
  const { ctx } = fakeCtx();
  for (const name of MENU_NAMES) {
    for (const item of items(name, ctx)) assert.ok(typeof item.click === 'function' || item.role, `${name}: ${item.label}`);
  }
});

test('clicking each item runs its action', () => {
  const { ctx, calls } = fakeCtx();
  for (const name of MENU_NAMES) for (const item of items(name, ctx)) if (item.click) item.click();
  const ran = new Set(calls.map((c) => c[0]));
  for (const a of ['send', 'press', 'reload', 'zoom', 'toggleFullScreen', 'toggleOnTop', 'toggleDevTools', 'back', 'forward',
    'checkForUpdates', 'about', 'quit']) assert.ok(ran.has(a), a);
  const sent = calls.filter((c) => c[0] === 'send').map((c) => c[1]);
  assert.ok(sent.some((c) => c.type === 'shortcut' && c.key === 'k'));
  assert.ok(sent.some((c) => c.type === 'keymap'));
  assert.deepEqual(calls.filter((c) => c[0] === 'press').map((c) => c[1]), ['z', 'y']);
});

test('File offers buying tokens: the buy-a-pack section of the Token Wallet', () => {
  const { ctx, calls } = fakeCtx();
  const buy = items('file', ctx).find((i) => i.label === 'Buy tokens…');
  assert.ok(buy);
  buy.click();
  assert.deepEqual(calls.at(-1), ['send', { type: 'navigate', route: '/settings/wallet#tp' }]);
});

test('every page the menus open exists in the web app', () => {
  const { ctx, calls } = fakeCtx();
  for (const name of MENU_NAMES) for (const item of items(name, ctx)) if (item.click) item.click();
  const routes = calls.filter((c) => c[0] === 'send' && c[1].type === 'navigate').map((c) => c[1].route.split(/[?#]/)[0]);
  assert.ok(routes.length >= 15);
  for (const r of new Set(routes)) {
    const dir = path.join(APP, '(app)', ...r.split('/').filter(Boolean));
    assert.ok(fs.existsSync(path.join(dir, 'page.tsx')), `no page for ${r}`);
  }
});

test('ticks and greyed items follow the window state', () => {
  const { ctx } = fakeCtx({ isFullScreen: true, isOnTop: false, canGoBack: false, canGoForward: true, updatesAvailable: true });
  const view = items('view', ctx);
  assert.equal(view.find((i) => i.label === 'Full screen').checked, true);
  assert.equal(view.find((i) => i.label === 'Always on top').checked, false);
  const go = items('go', ctx);
  assert.equal(go.find((i) => i.label === 'Back').enabled, false);
  assert.equal(go.find((i) => i.label === 'Forward').enabled, true);
  assert.equal(items('help', ctx).find((i) => i.label.startsWith('Check for updates')).enabled, true);
});

test('labels are sentence case (real names kept)', () => {
  const NAMES = new Set(['OTSI', 'VIE', 'Studio', 'Center', 'Wallet']);
  const { ctx } = fakeCtx();
  for (const name of MENU_NAMES) {
    for (const item of items(name, ctx)) {
      for (const w of item.label.split(' ').slice(1)) assert.ok(!/^[A-Z]/.test(w) || NAMES.has(w), `${item.label}: ${w}`);
    }
  }
});

test('window shortcuts: reload, zoom, full screen, back / forward, developer tools; page keys pass through', () => {
  const k = (key, mods = {}) => shortcutFor({ type: 'keyDown', key, ...mods });
  assert.equal(k('r', { control: true }), 'reload');
  assert.equal(k('=', { control: true }), 'zoomIn');
  assert.equal(k('-', { control: true }), 'zoomOut');
  assert.equal(k('0', { control: true }), 'zoomReset');
  assert.equal(k('F11'), 'fullScreen');
  assert.equal(k('F12'), 'devTools');
  assert.equal(k('I', { control: true, shift: true }), 'devTools');
  assert.equal(k('ArrowLeft', { alt: true }), 'back');
  assert.equal(k('ArrowRight', { alt: true }), 'forward');
  for (const key of ['k', 'j', 'b', 'z', 'y', ',']) assert.equal(k(key, { control: true }), null, key);
  assert.equal(k('ArrowLeft'), null);
  assert.equal(shortcutFor({ type: 'keyUp', key: 'r', control: true }), null);
});
