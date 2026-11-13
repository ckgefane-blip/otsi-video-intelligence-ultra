'use strict';
/**
 * The window's own Windows menu (owner 2026-11-13: "Add more items to that menu").
 *
 * This is the menu under the app icon in the title bar. It also opens with Alt+Space or a right-click on the
 * title bar. Windows gives it only Restore / Move / Size / Minimize / Maximize / Close. The items below are
 * added to that same native menu, so the Windows items keep working exactly as before (keyboard move and size
 * included). The added items go between Maximize and Close:
 *
 *   Go to ▸ (the rail's pages) · Reload · Zoom in / Zoom out / Actual size · Full screen ✓ · Always on top ✓ ·
 *   Keyboard shortcuts · Check for updates… · About OTSI VIE
 *
 * How: koffi (MIT, free, prebuilt; ADR-030) calls user32 to insert the items. A click arrives as WM_SYSCOMMAND
 * with our command id, read with BrowserWindow.hookWindowMessage. Ids are multiples of 16 below 0xF000,
 * because Windows keeps the low four bits of a system command for itself and uses 0xF000 and above for its own.
 * On other systems, or if koffi cannot load, nothing is added and the app runs as before. A broken menu
 * must never stop the engine.
 */

const WM_SYSCOMMAND = 0x0112;
const MF_STRING = 0x0000;
const MF_GRAYED = 0x0001;
const MF_CHECKED = 0x0008;
const MF_POPUP = 0x0010;
const MF_SEPARATOR = 0x0800;
const MF_BYPOSITION = 0x0400;
const MF_BYCOMMAND = 0x0000;
const FIRST_ID = 0x1000;

/** The rail's pages, in the rail's order and with its names (sentence case, real names kept). */
const PAGES = [
  ['Home', '/dashboard'], ['Media', '/upload'], ['Processing', '/processing'], ['Analysis', '/analysis'],
  ['Tactical', '/tactics'], ['Players', '/players'], ['Reports', '/reports'], ['Reels', '/reels'],
  ['Clip Studio', '/studio'], ['Library', '/library'], ['Export', '/exports'], ['Settings', '/settings/preferences'],
];

/**
 * The added items, as plain data (tested without Windows). `run` names an action of `actions()` below. Text
 * after a tab is the shortcut, shown right-aligned the way Windows shows Alt+F4 next to Close.
 */
function menuModel() {
  return [
    { type: 'separator' },
    { label: 'Go to', submenu: PAGES.map(([label, route]) => ({ label, run: 'go', route })) },
    { type: 'separator' },
    { label: 'Reload\tCtrl+R', run: 'reload' },
    { label: 'Zoom in\tCtrl+Plus', run: 'zoomIn' },
    { label: 'Zoom out\tCtrl+Minus', run: 'zoomOut' },
    { label: 'Actual size\tCtrl+0', run: 'zoomReset' },
    { label: 'Full screen\tF11', run: 'fullScreen', check: 'fullScreen' },
    { label: 'Always on top', run: 'onTop', check: 'onTop' },
    { type: 'separator' },
    { label: 'Keyboard shortcuts', run: 'go', route: '/shortcuts' },
    { label: 'Check for updates…', run: 'updates', enable: 'updates' },
    { label: 'About OTSI VIE', run: 'about' },
  ];
}

/** Gives every clickable item its command id: FIRST_ID, FIRST_ID + 16, … in reading order (submenus included). */
function assignIds(model) {
  let next = FIRST_ID;
  const byId = new Map();
  const walk = (items) => {
    for (const item of items) {
      if (item.submenu) walk(item.submenu);
      else if (item.type !== 'separator') {
        item.id = next;
        byId.set(next, item);
        next += 0x10;
      }
    }
  };
  walk(model);
  return byId;
}

function loadUser32() {
  if (process.platform !== 'win32') return null;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  return {
    GetSystemMenu: user32.func('uintptr_t __stdcall GetSystemMenu(uintptr_t hWnd, int bRevert)'),
    GetMenuItemCount: user32.func('int __stdcall GetMenuItemCount(uintptr_t hMenu)'),
    InsertMenuW: user32.func('int __stdcall InsertMenuW(uintptr_t hMenu, uint32_t uPosition, uint32_t uFlags, uintptr_t uIDNewItem, const char16_t *lpNewItem)'),
    CreatePopupMenu: user32.func('uintptr_t __stdcall CreatePopupMenu()'),
    AppendMenuW: user32.func('int __stdcall AppendMenuW(uintptr_t hMenu, uint32_t uFlags, uintptr_t uIDNewItem, const char16_t *lpNewItem)'),
    CheckMenuItem: user32.func('uint32_t __stdcall CheckMenuItem(uintptr_t hMenu, uint32_t uIDCheckItem, uint32_t uCheck)'),
  };
}

/**
 * Adds the items to `win`'s Windows menu. `actions` maps each `run` name to a function (see main.js), and
 * `state` gives the current check marks and enabled flags. Returns `refresh()`, which redraws the check marks,
 * or a no-op when nothing could be added. Errors are passed to `log`, never thrown.
 */
function installWindowMenu(win, actions, state, log = () => {}) {
  const noop = () => {};
  let api;
  try {
    api = loadUser32();
  } catch (err) {
    log(`Window menu: koffi did not load (${String((err && err.message) || err)}); the Windows menu stays as it is.\n`);
    return noop;
  }
  if (!api) return noop;
  try {
    const handle = win.getNativeWindowHandle();
    const hwnd = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
    const menu = api.GetSystemMenu(hwnd, 0);
    if (!menu) throw new Error('no system menu');
    const model = menuModel();
    const byId = assignIds(model);
    // Windows' own layout ends with "separator, Close": insert just above that separator
    let pos = Math.max(0, api.GetMenuItemCount(menu) - 2);
    for (const item of model) {
      if (item.type === 'separator') {
        api.InsertMenuW(menu, pos++, MF_BYPOSITION | MF_SEPARATOR, 0, null);
      } else if (item.submenu) {
        const sub = api.CreatePopupMenu();
        for (const s of item.submenu) api.AppendMenuW(sub, MF_STRING, s.id, s.label);
        api.InsertMenuW(menu, pos++, MF_BYPOSITION | MF_POPUP | MF_STRING, sub, item.label);
      } else {
        const flags = MF_BYPOSITION | MF_STRING | (item.enable && !state.enabled(item.enable) ? MF_GRAYED : 0);
        api.InsertMenuW(menu, pos++, flags, item.id, item.label);
      }
    }
    const refresh = () => {
      for (const item of byId.values()) {
        if (item.check) api.CheckMenuItem(menu, item.id, MF_BYCOMMAND | (state.checked(item.check) ? MF_CHECKED : 0));
      }
    };
    refresh();
    win.hookWindowMessage(WM_SYSCOMMAND, (wParam) => {
      const id = Number(wParam.length >= 8 ? wParam.readBigUInt64LE(0) : BigInt(wParam.readUInt32LE(0))) & 0xFFF0;
      const item = byId.get(id);
      if (!item) return; // Windows' own command (Move, Size, Close, …): Windows handles it
      const run = actions[item.run];
      // run now, inside the window's message: a queued task can wait in Node's loop until the next Windows message
      if (!run) return;
      try {
        run(item);
      } catch (err) {
        log(`Window menu: "${item.label}" failed (${String((err && err.message) || err)}).
`);
      }
      refresh();
    });
    return refresh;
  } catch (err) {
    log(`Window menu: items not added (${String((err && err.message) || err)}).\n`);
    return noop;
  }
}

module.exports = { installWindowMenu, menuModel, assignIds, PAGES, FIRST_ID };
