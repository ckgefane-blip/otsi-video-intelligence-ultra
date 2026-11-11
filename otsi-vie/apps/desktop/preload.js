'use strict';
/**
 * Preload script for the loading window only.
 * Exposes a small, safe API to the loading page: status/log updates and the
 * owner-account form. The main window (the engine itself) has no preload
 * and no Node access.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('otsi', {
  onStatus: (fn) => ipcRenderer.on('status', (_event, text) => fn(text)),
  onLog: (fn) => ipcRenderer.on('log', (_event, line) => fn(line)),
  onUpdateStatus: (fn) => ipcRenderer.on('update-status', (_event, text) => fn(text)),
  onHardware: (fn) => ipcRenderer.on('hardware', (_event, data) => fn(data)),
  onShowOwner: (fn) => ipcRenderer.on('show-owner', () => fn()),
  onShowError: (fn) => ipcRenderer.on('show-error', (_event, data) => fn(data)),
  submitOwner: (details) => ipcRenderer.send('owner-submit', details),
  ownerHaveAccount: () => ipcRenderer.send('owner-have-account'),
  retry: () => ipcRenderer.send('retry'),
  closeApp: () => ipcRenderer.send('close-app'),
});
