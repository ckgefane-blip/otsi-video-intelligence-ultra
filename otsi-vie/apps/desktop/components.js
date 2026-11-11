'use strict';
/**
 * Component manager (plan v3 §1b, ADR-144 §1.1/§1.3): heavier model packs
 * and future language packs install from inside the app — chosen by the
 * user, resumable, SHA-256 checked, signed manifest.
 *
 * Manifest format (defined here; the server side of the feed is a
 * follow-up — the central server is another agent's part):
 *   {
 *     "manifest_version": 1,
 *     "issued_at": "2026-11-11T00:00:00.000Z",
 *     "packs": [
 *       { "id": "models-rtdetr-r50", "kind": "model",
 *         "name": "Detector RT-DETRv2 R50 (larger, more accurate)",
 *         "version": "1", "size_bytes": 123456789,
 *         "sha256": "<hex of the file>",
 *         "url": "https://<host>/packs/models-rtdetr-r50.onnx",
 *         "min_app_version": "0.1.0",
 *         "files": ["rtdetr_v2_r50vd/model.onnx"] }
 *     ],
 *     "signature": "<base64 Ed25519 signature>"
 *   }
 * The signature covers the canonical JSON (keys sorted, recursively) of
 * { manifest_version, issued_at, packs } — the signature field itself is
 * not signed. Verification uses the central server's Ed25519 public key
 * (OTSI_VIE_COMPONENTS_PUBLIC_KEY_PEM, or a PEM file at
 * OTSI_VIE_COMPONENTS_PUBLIC_KEY_FILE). A manifest with no signature, or
 * one that does not verify, is refused — fail closed. With no public key
 * configured at all, nothing installs: the feed is not live yet.
 *
 * A pack is one file (v1): it installs to the relative path in files[0]
 * under the pack's destination — the models directory for kind "model",
 * the components directory for kind "language". Multi-file packs are
 * recorded in the manifest but refused by this version, plainly.
 * Downloads are resumable: a .part file keeps what arrived, and the next
 * run continues with an HTTP Range request. The SHA-256 is checked after
 * the download; a mismatch deletes the file and fails.
 *
 * No Electron dependency, so it can be checked and exercised with plain
 * Node. The manifest URL is config, not code: OTSI_VIE_COMPONENTS_MANIFEST_URL.
 * Unset means no feed — listAvailablePacks returns an empty list and says so.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_VERSION = 1;

/** JSON with keys sorted recursively — the signed form of a manifest. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (d) => h.update(d));
    stream.on('error', reject);
    stream.on('end', () => resolve(h.digest('hex')));
  });
}

function componentsPublicKey() {
  const pem = (process.env.OTSI_VIE_COMPONENTS_PUBLIC_KEY_PEM || '').trim();
  if (pem) return pem;
  const file = (process.env.OTSI_VIE_COMPONENTS_PUBLIC_KEY_FILE || '').trim();
  if (file) {
    try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
  }
  return null;
}

function manifestUrl() {
  return (process.env.OTSI_VIE_COMPONENTS_MANIFEST_URL || '').trim() || null;
}

/** Verify a manifest's Ed25519 signature. Throws a plain-worded Error. */
function verifyManifest(manifest) {
  if (!manifest || manifest.manifest_version !== MANIFEST_VERSION) {
    throw new Error('The component list is not a version-1 manifest.');
  }
  if (!Array.isArray(manifest.packs)) throw new Error('The component list has no packs.');
  if (typeof manifest.signature !== 'string' || !manifest.signature) {
    throw new Error('The component list is not signed — refusing it.');
  }
  const keyPem = componentsPublicKey();
  if (!keyPem) {
    throw new Error('No component public key is configured, so the signed component list cannot be checked — nothing installs.');
  }
  const { signature, ...unsigned } = manifest;
  const ok = crypto.verify(
    null,
    Buffer.from(canonicalJson(unsigned), 'utf8'),
    crypto.createPublicKey(keyPem),
    Buffer.from(signature, 'base64'),
  );
  if (!ok) throw new Error('The component list signature does not match — refusing it.');
  return manifest;
}

async function fetchManifest(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`The component list could not be fetched (HTTP ${res.status}).`);
  const manifest = await res.json();
  return verifyManifest(manifest);
}

/** The available packs, or [] when no feed is configured. Never throws. */
async function listAvailablePacks() {
  const url = manifestUrl();
  if (!url) return { packs: [], note: 'No component feed is configured yet — extra packs are not available.' };
  try {
    const manifest = await fetchManifest(url);
    return { packs: manifest.packs, note: '' };
  } catch (err) {
    return { packs: [], note: String((err && err.message) || err) };
  }
}

function installedFile(dataDir) {
  return path.join(dataDir, '.local', 'components', 'installed.json');
}

function installedPacks(dataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(installedFile(dataDir), 'utf8'));
    return Array.isArray(data.packs) ? data.packs : [];
  } catch {
    return [];
  }
}

function recordInstalled(dataDir, pack) {
  const file = installedFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const packs = installedPacks(dataDir).filter((p) => p.id !== pack.id);
  packs.push({ id: pack.id, kind: pack.kind, version: pack.version, installed_at: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify({ packs }, null, 2) + '\n', 'utf8');
}

/** The install path for a pack's single file. Refuses paths that escape the destination. */
function packDestination(pack, destDir) {
  if (!Array.isArray(pack.files) || pack.files.length !== 1) {
    throw new Error(`Pack ${pack.id} has ${Array.isArray(pack.files) ? pack.files.length : 0} files — this version installs single-file packs only.`);
  }
  const rel = String(pack.files[0]);
  const dest = path.resolve(destDir, rel);
  if (dest !== path.resolve(destDir) && !dest.startsWith(path.resolve(destDir) + path.sep)) {
    throw new Error(`Pack ${pack.id} tries to install outside its folder — refusing it.`);
  }
  return dest;
}

/**
 * Download one pack, resumable. `destDir` is the models directory for a
 * model pack, the components directory for a language pack. Calls
 * onProgress({ received, total }) as bytes arrive. Returns the installed
 * file path. Throws a plain-worded Error on a hash mismatch or a failed
 * download; a .part file is kept so the next run resumes.
 */
async function downloadPack(pack, destDir, { log, onProgress } = {}) {
  const dest = packDestination(pack, destDir);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let received = 0;
  try { received = fs.statSync(part).size; } catch { received = 0; }
  const total = Number(pack.size_bytes) || null;
  if (received > 0 && total != null && received >= total) received = 0; // stale part: start over
  const headers = {};
  if (received > 0) headers.Range = `bytes=${received}-`;
  if (log) log(`Downloading ${pack.name} (${received > 0 ? `resuming at ${received} bytes` : 'from the start'})...\n`);
  const res = await fetch(pack.url, { headers, signal: AbortSignal.timeout(600000) });
  if (res.status === 416) {
    // The server says the range is unsatisfiable (the part is stale):
    // delete it and start over once.
    try { fs.unlinkSync(part); } catch { /* already gone */ }
    return downloadPack({ ...pack }, destDir, { log, onProgress });
  }
  if (received > 0 && res.status !== 206) {
    // The server ignored the range: restart from the beginning.
    received = 0;
    try { fs.unlinkSync(part); } catch { /* already gone */ }
  }
  if (!res.ok && res.status !== 206) throw new Error(`Downloading ${pack.name} failed (HTTP ${res.status}).`);
  const stream = fs.createWriteStream(part, { flags: received > 0 ? 'a' : 'w' });
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (onProgress) onProgress({ received, total });
      await new Promise((resolve, reject) => stream.write(value, (err) => (err ? reject(err) : resolve())));
    }
  } finally {
    await new Promise((resolve) => stream.end(resolve));
  }
  if (total != null && received !== total) {
    throw new Error(`Downloading ${pack.name} stopped early (${received} of ${total} bytes) — run it again to resume.`);
  }
  const actual = await sha256File(part);
  if (pack.sha256 && actual !== pack.sha256.toLowerCase()) {
    try { fs.unlinkSync(part); } catch { /* already gone */ }
    throw new Error(`${pack.name}: SHA-256 ${actual} does not match the signed manifest (${pack.sha256}); the file was deleted.`);
  }
  fs.renameSync(part, dest);
  return dest;
}

module.exports = {
  MANIFEST_VERSION,
  canonicalJson,
  sha256File,
  manifestUrl,
  verifyManifest,
  fetchManifest,
  listAvailablePacks,
  installedPacks,
  recordInstalled,
  packDestination,
  downloadPack,
};
