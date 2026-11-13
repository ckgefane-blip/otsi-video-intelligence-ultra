'use strict';
/**
 * The title-bar menus of the desktop app: File · Edit · View · Go to · Help (owner 2026-11-13: "inside the title bar … like
 * VS Code or Filmora … not just for decoration but for actual navigation and useful purposes").
 *
 * The page draws the menu names in its title bar (apps/web DesktopTitleBar). A click asks this process to open the native
 * menu under the name, built here fresh each time so the ticks are current. Every item does a real thing. Some act on the
 * window (reload, zoom, full screen, always on top, back / forward, updates, quit). The rest are sent back to the page as
 * commands: go to a page, or the app's own shortcuts (Ctrl+K search, Ctrl+J Jobs Center, Ctrl+B left menu, the
 * keyboard-shortcuts map). Edit uses Chromium's own editing commands, so Undo, Copy, Paste and the rest work in any text field.
 *
 * Plain data and functions, no Electron import: tested with node --test (test/appmenus.test.js).
 */

const { PAGES } = require('./windowmenu');

const MENU_NAMES = ['file', 'edit', 'view', 'go', 'help'];

/**
 * `ctx` supplies the actions and the current state:
 *   send(cmd)            a command for the page: {type:'navigate', route} | {type:'shortcut', key} | {type:'keymap'}
 *   press(key)           a real Ctrl+<key> press in the page (undo / redo)
 *   reload(), zoom(step) (step +1 / -1 / 0 = actual size), toggleFullScreen(), toggleOnTop(), toggleDevTools()
 *   back(), forward(), canGoBack, canGoForward, isFullScreen, isOnTop
 *   checkForUpdates(), updatesAvailable, about(), quit()
 */
function menuTemplate(name, ctx) {
  const go = (label, route, accelerator) => ({ label, accelerator, registerAccelerator: false, click: () => ctx.send({ type: 'navigate', route }) });
  const key = (label, k, accelerator) => ({ label, accelerator, registerAccelerator: false, click: () => ctx.send({ type: 'shortcut', key: k }) });
  const sep = { type: 'separator' };
  switch (name) {
    case 'file':
      return [
        go('Upload video…', '/upload'),
        go('Import from a link…', '/upload?mode=url'),
        sep,
        go('Open library', '/library'),
        go('Export and delivery', '/exports'),
        sep,
        // the Token Wallet's "Buy a token pack" steps (WalletView, section #tp): nothing is bought until the user goes through them
        go('Plans and pricing', '/settings/billing'),
        go('Buy tokens…', '/settings/wallet#tp'),
        go('Token Wallet', '/settings/wallet'),
        sep,
        go('Settings', '/settings/preferences', 'Ctrl+,'),
        sep,
        { label: 'Exit', accelerator: 'Alt+F4', registerAccelerator: false, click: () => ctx.quit() },
      ];
    case 'edit':
      return [
        // a real Ctrl+Z / Ctrl+Y: a text field undoes typing, and Clip Studio undoes the last change to the reel
        { label: 'Undo', accelerator: 'Ctrl+Z', registerAccelerator: false, click: () => ctx.press('z') },
        { label: 'Redo', accelerator: 'Ctrl+Y', registerAccelerator: false, click: () => ctx.press('y') },
        sep,
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'delete', label: 'Delete' },
        sep,
        { role: 'selectAll', label: 'Select all' },
        sep,
        key('Search players, matches and actions…', 'k', 'Ctrl+K'),
      ];
    case 'view':
      return [
        key('Collapse or expand the left menu', 'b', 'Ctrl+B'),
        key('Jobs Center', 'j', 'Ctrl+J'),
        sep,
        { label: 'Reload', accelerator: 'Ctrl+R', registerAccelerator: false, click: () => ctx.reload() },
        sep,
        { label: 'Zoom in', accelerator: 'Ctrl+=', registerAccelerator: false, click: () => ctx.zoom(1) },
        { label: 'Zoom out', accelerator: 'Ctrl+-', registerAccelerator: false, click: () => ctx.zoom(-1) },
        { label: 'Actual size', accelerator: 'Ctrl+0', registerAccelerator: false, click: () => ctx.zoom(0) },
        sep,
        { label: 'Full screen', type: 'checkbox', checked: !!ctx.isFullScreen, accelerator: 'F11', registerAccelerator: false, click: () => ctx.toggleFullScreen() },
        { label: 'Always on top', type: 'checkbox', checked: !!ctx.isOnTop, click: () => ctx.toggleOnTop() },
        sep,
        { label: 'Developer tools', accelerator: 'Ctrl+Shift+I', registerAccelerator: false, click: () => ctx.toggleDevTools() },
      ];
    case 'go':
      return [
        { label: 'Back', accelerator: 'Alt+Left', registerAccelerator: false, enabled: !!ctx.canGoBack, click: () => ctx.back() },
        { label: 'Forward', accelerator: 'Alt+Right', registerAccelerator: false, enabled: !!ctx.canGoForward, click: () => ctx.forward() },
        sep,
        ...PAGES.map(([label, route]) => go(label, route)),
      ];
    case 'help':
      return [
        { label: 'Keyboard shortcuts', click: () => ctx.send({ type: 'keymap' }) },
        go('All shortcuts page', '/shortcuts'),
        sep,
        { label: 'Check for updates…', enabled: !!ctx.updatesAvailable, click: () => ctx.checkForUpdates() },
        sep,
        { label: 'About OTSI VIE', click: () => ctx.about() },
      ];
    default:
      return null;
  }
}

/**
 * The window's keyboard shortcuts for the menu items that act on the window (the page's own Ctrl+K / J / B already work in the
 * page). Returns the action name for a key press, or null. `input` is Electron's before-input-event input.
 */
function shortcutFor(input) {
  if (input.type !== 'keyDown') return null;
  const k = String(input.key || '');
  const ctrl = !!(input.control || input.meta);
  if (k === 'F11' && !ctrl && !input.alt) return 'fullScreen';
  if (k === 'F12' || (ctrl && input.shift && k.toLowerCase() === 'i')) return 'devTools';
  if (input.alt && !ctrl && k === 'ArrowLeft') return 'back';
  if (input.alt && !ctrl && k === 'ArrowRight') return 'forward';
  if (!ctrl || input.alt) return null;
  if (k.toLowerCase() === 'r' && !input.shift) return 'reload';
  if (k === '=' || k === '+') return 'zoomIn';
  if (k === '-' || k === '_') return 'zoomOut';
  if (k === '0') return 'zoomReset';
  return null;
}

module.exports = { MENU_NAMES, menuTemplate, shortcutFor };
