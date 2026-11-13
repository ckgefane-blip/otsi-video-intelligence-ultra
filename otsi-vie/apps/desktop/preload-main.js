'use strict';
/**
 * Preload script for the main window: the bridge for the title bar the page draws (apps/web DesktopTitleBar; owner 2026-11-13).
 * Exposes three things to the page, nothing else and no Node access:
 *   openMenu(name, x, y)        open the native menu File / Edit / View / Go to / Help under the name (main.js, appmenus.js)
 *   setTitleBarColors(bg, fg)   the theme's colours for the window buttons Windows draws on the right
 *   onCommand(callback)         commands from the menus for the page (go to a page, a shortcut, menu closed); returns "stop"
 * Its presence (window.otsiDesktop) is how the page knows it runs in the desktop app and shows its title bar.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('otsiDesktop', {
  openMenu: (name, x, y) => ipcRenderer.send('titlebar-menu', { name: String(name), x: Number(x), y: Number(y) }),
  setTitleBarColors: (bg, fg) => ipcRenderer.send('titlebar-colors', { bg: String(bg), fg: String(fg) }),
  onCommand: (callback) => {
    const handler = (_event, cmd) => callback(cmd);
    ipcRenderer.on('desktop-command', handler);
    return () => ipcRenderer.removeListener('desktop-command', handler);
  },
});
