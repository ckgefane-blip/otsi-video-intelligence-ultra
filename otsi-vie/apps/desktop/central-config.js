'use strict';
/**
 * Build-time central config (ADR-146 step 6, staging step D).
 *
 * A test/staging desktop build ships a file inside the build,
 * resources/central.json, with the central server address and the
 * licence public key (and, for a test build, the data folder and the
 * app name/id). The production build ships no such file and stays
 * local-only, exactly as today.
 *
 *   {
 *     "central_server_url": "https://accounts.otsi.cc",
 *     "licence_public_key_pem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
 *     "data_dir": "D:\\OTSI-VIE-staging",
 *     "app_name": "OTSI VIE Staging",
 *     "app_id": "cc.otsi.vie.staging"
 *   }
 *
 * Precedence: an environment variable always wins over the file
 * (OTSI_VIE_CENTRAL_SERVER_URL, OTSI_VIE_LICENCE_PUBLIC_KEY_PEM,
 * OTSI_VIE_DATA_DIR, OTSI_VIE_APP_NAME, OTSI_VIE_APP_ID). A missing
 * or unreadable file, or a file with no usable values, is local mode
 * — never an error, never a guess. The file is read once and cached
 * (it is a build-time file; it does not change while the app runs).
 *
 * No Electron dependency, so it can be checked and exercised with
 * plain Node. Nothing here logs the key. No URL or key is ever
 * hard-coded here — the build machine supplies the file.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Where the file lives: the packaged app's resources folder, else the repo checkout (dev). */
function defaultConfigPath() {
  if (process.resourcesPath) return path.join(process.resourcesPath, 'central.json');
  return path.join(__dirname, 'resources', 'central.json');
}

/** The parsed file, or {} when it is missing, unreadable, or not an object. Never throws. */
function readConfigFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath || defaultConfigPath(), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return data;
  } catch {
    return {};
  }
}

let cached = null;
/** The file's contents, read once. Tests pass an explicit config object to the resolvers instead. */
function loadConfig() {
  if (!cached) cached = readConfigFile();
  return cached;
}
/** Drop the cached file (tests only). */
function resetConfigCache() {
  cached = null;
}

function stringField(config, key) {
  const v = config && config[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The central server URL, or null for local-only. Env wins over the file. */
function centralServerUrl(config) {
  const cfg = config || loadConfig();
  const raw = (process.env.OTSI_VIE_CENTRAL_SERVER_URL || '').trim()
    || stringField(cfg, 'central_server_url') || '';
  const url = raw.replace(/\/+$/, '');
  if (!url) return null;
  if (/^https:\/\//.test(url)) return url;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) return url; // dev only
  return null; // a central server is a real domain over HTTPS; anything else is ignored, not guessed
}

/** The central server's Ed25519 licence public key (PEM), or null. Env wins over the file. */
function licencePublicKeyPem(config) {
  const cfg = config || loadConfig();
  return (process.env.OTSI_VIE_LICENCE_PUBLIC_KEY_PEM || '').trim()
    || stringField(cfg, 'licence_public_key_pem') || null;
}

/** The data-folder override for a test build (e.g. D:\OTSI-VIE-staging), or null. Env wins over the file. */
function dataDirOverride(config) {
  const cfg = config || loadConfig();
  return (process.env.OTSI_VIE_DATA_DIR || '').trim()
    || stringField(cfg, 'data_dir') || null;
}

/** The app name override for a test build (e.g. "OTSI VIE Staging"), or null. Env wins over the file. */
function appName(config) {
  const cfg = config || loadConfig();
  return (process.env.OTSI_VIE_APP_NAME || '').trim()
    || stringField(cfg, 'app_name') || null;
}

/** The app id override for a test build (e.g. "cc.otsi.vie.staging"), or null. Env wins over the file. */
function appId(config) {
  const cfg = config || loadConfig();
  return (process.env.OTSI_VIE_APP_ID || '').trim()
    || stringField(cfg, 'app_id') || null;
}

module.exports = {
  defaultConfigPath,
  readConfigFile,
  loadConfig,
  resetConfigCache,
  centralServerUrl,
  licencePublicKeyPem,
  dataDirOverride,
  appName,
  appId,
};
