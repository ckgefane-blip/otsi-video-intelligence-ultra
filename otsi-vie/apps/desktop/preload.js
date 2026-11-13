'use strict';
/**
 * Preload script for the loading window only.
 * Exposes a small, safe API to the loading page: status/step updates and the
 * app version. The main window (the engine itself) has no preload
 * and no Node access.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('otsi', {
  onStatus: (fn) => ipcRenderer.on('status', (_event, text) => fn(text)),
  /** one start-up step at a time ({ id, label, state: 'active' | 'done' | 'warn' }): the splash renders
   *  the SOT's three steps from these events (the main process maps its real stages onto them), so the
   *  list shows Local workspace opened / Loading analysis models / Checking licence, in that order */
  onStep: (fn) => ipcRenderer.on('step', (_event, step) => fn(step)),
  /** the app version for the splash screen (the SOT's v[—] slot, filled with the real version) */
  version: () => ipcRenderer.invoke('app-version'),
});
