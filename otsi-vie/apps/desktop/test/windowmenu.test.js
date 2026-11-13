'use strict';
// The items added to the Windows menu under the app icon (windowmenu.js). Run: npm test (node --test).
const test = require('node:test');
const assert = require('node:assert/strict');
const { menuModel, assignIds, PAGES, FIRST_ID, installWindowMenu } = require('../windowmenu');

const clickable = (model) => model.flatMap((i) => (i.submenu ? i.submenu : i.type === 'separator' ? [] : [i]));

test('every command id is a multiple of 16 below the Windows range, and unique', () => {
  const model = menuModel();
  const byId = assignIds(model);
  const items = clickable(model);
  assert.equal(byId.size, items.length);
  for (const item of items) {
    assert.equal(item.id % 16, 0, item.label);
    assert.ok(item.id >= FIRST_ID && item.id < 0xF000, item.label);
  }
});

test('Go to lists the rail pages in the rail order, with their routes', () => {
  const go = menuModel().find((i) => i.label === 'Go to');
  assert.deepEqual(go.submenu.map((i) => i.label), ['Home', 'Media', 'Processing', 'Analysis', 'Tactical', 'Players', 'Reports',
    'Reels', 'Clip Studio', 'Library', 'Export', 'Settings']);
  assert.deepEqual(go.submenu.map((i) => i.route), PAGES.map(([, r]) => r));
  assert.ok(go.submenu.every((i) => i.run === 'go' && i.route.startsWith('/')));
});

test('labels are sentence case: only the first word capitalised, real names kept', () => {
  const NAMES = new Set(['OTSI', 'VIE', 'Studio', 'Ctrl+R', 'Ctrl+Plus', 'Ctrl+Minus', 'Ctrl+0', 'F11']);
  for (const item of [...menuModel().filter((i) => i.label), ...clickable(menuModel())]) {
    const words = item.label.replace('\t', ' ').split(' ').slice(1);
    for (const w of words) assert.ok(!/^[A-Z]/.test(w) || NAMES.has(w), `${item.label}: ${w}`);
  }
});

test('every item runs a known action', () => {
  const known = new Set(['go', 'reload', 'zoomIn', 'zoomOut', 'zoomReset', 'fullScreen', 'onTop', 'updates', 'about']);
  for (const item of clickable(menuModel())) assert.ok(known.has(item.run), item.label);
});

test('a window without a native handle leaves the Windows menu alone and never throws', () => {
  const logs = [];
  const refresh = installWindowMenu({ getNativeWindowHandle: () => { throw new Error('no handle'); } }, {}, {}, (l) => logs.push(l));
  assert.equal(typeof refresh, 'function');
  refresh();
  if (process.platform === 'win32') assert.match(logs.join(''), /items not added|did not load/);
});

test('koffi binds the user32 menu functions on Windows', { skip: process.platform !== 'win32' }, () => {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const CreatePopupMenu = user32.func('uintptr_t __stdcall CreatePopupMenu()');
  const AppendMenuW = user32.func('int __stdcall AppendMenuW(uintptr_t hMenu, uint32_t uFlags, uintptr_t uIDNewItem, const char16_t *lpNewItem)');
  const GetMenuItemCount = user32.func('int __stdcall GetMenuItemCount(uintptr_t hMenu)');
  const DestroyMenu = user32.func('int __stdcall DestroyMenu(uintptr_t hMenu)');
  const menu = CreatePopupMenu();
  assert.ok(menu);
  assert.ok(AppendMenuW(menu, 0, FIRST_ID, 'Reload\tCtrl+R'));
  assert.equal(GetMenuItemCount(menu), 1);
  assert.ok(DestroyMenu(menu));
});
