'use strict';
// Build-time central config (central-config.js) and the data-folder / app-identity overrides
// (backend.js dataDir / applyBuildIdentity). Run: npm test (node --test).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const centralConfig = require('../central-config');
const backend = require('../backend');
const licence = require('../licence');

const ENV_KEYS = [
  'OTSI_VIE_CENTRAL_SERVER_URL',
  'OTSI_VIE_LICENCE_PUBLIC_KEY_PEM',
  'OTSI_VIE_DATA_DIR',
  'OTSI_VIE_APP_NAME',
  'OTSI_VIE_APP_ID',
];

const STAGING = {
  central_server_url: 'https://accounts.otsi.cc',
  licence_public_key_pem: '-----BEGIN PUBLIC KEY-----\nTESTKEY\n-----END PUBLIC KEY-----\n',
  data_dir: 'D:\\OTSI-VIE-staging',
  app_name: 'OTSI VIE Staging',
  app_id: 'cc.otsi.vie.staging',
};

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function withTempConfig(obj, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otsi-central-'));
  const file = path.join(dir, 'central.json');
  fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
  try {
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A copy of central-config.js + licence.js in a temp folder, for the "no real file" assertions. The temp
 *  licence.js requires the temp central-config.js (./central-config), whose __dirname is the temp folder,
 *  so its defaultConfigPath points at <temp>/resources/central.json, which never exists. This makes the
 *  "local-only" assertions independent of whether the repo's real resources/central.json exists — on a
 *  staging machine that file holds the live staging config, and three tests used to fail there because
 *  they read the real file. Everything is deleted afterwards. */
function withTempModules(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otsi-central-nofile-'));
  try {
    fs.copyFileSync(path.join(__dirname, '..', 'central-config.js'), path.join(dir, 'central-config.js'));
    fs.copyFileSync(path.join(__dirname, '..', 'licence.js'), path.join(dir, 'licence.js'));
    return fn({ central: require(path.join(dir, 'central-config.js')), licence: require(path.join(dir, 'licence.js')) });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('config file read: a central.json with a URL and key is honoured', () => {
  clearEnv();
  withTempConfig(STAGING, (file) => {
    const cfg = centralConfig.readConfigFile(file);
    assert.equal(cfg.central_server_url, 'https://accounts.otsi.cc');
    assert.equal(centralConfig.centralServerUrl(cfg), 'https://accounts.otsi.cc');
    // the resolver trims the value (a trailing newline in a PEM key is harmless)
    assert.equal(centralConfig.licencePublicKeyPem(cfg), '-----BEGIN PUBLIC KEY-----\nTESTKEY\n-----END PUBLIC KEY-----');
    assert.equal(centralConfig.dataDirOverride(cfg), 'D:\\OTSI-VIE-staging');
    assert.equal(centralConfig.appName(cfg), 'OTSI VIE Staging');
    assert.equal(centralConfig.appId(cfg), 'cc.otsi.vie.staging');
    // licence.js reads through the same resolver: the staging URL is live, not local-only.
    // (Checked on a temp copy with no config file, so this does not depend on the real
    // resources/central.json being absent: with a real staging file present the real licence
    // module would rightly return that file's URL here.)
    withTempModules(({ licence: tempLicence }) => {
      assert.equal(tempLicence.centralServerUrl(), null);
    });
  });
});

test('env wins: an environment variable overrides the file for every field', () => {
  clearEnv();
  process.env.OTSI_VIE_CENTRAL_SERVER_URL = 'https://env.example.test';
  process.env.OTSI_VIE_LICENCE_PUBLIC_KEY_PEM = 'ENV-KEY';
  process.env.OTSI_VIE_DATA_DIR = 'E:\\OTSI-VIE-env';
  process.env.OTSI_VIE_APP_NAME = 'OTSI VIE Env';
  process.env.OTSI_VIE_APP_ID = 'cc.otsi.vie.env';
  try {
    assert.equal(centralConfig.centralServerUrl(STAGING), 'https://env.example.test');
    assert.equal(centralConfig.licencePublicKeyPem(STAGING), 'ENV-KEY');
    assert.equal(centralConfig.dataDirOverride(STAGING), 'E:\\OTSI-VIE-env');
    assert.equal(centralConfig.appName(STAGING), 'OTSI VIE Env');
    assert.equal(centralConfig.appId(STAGING), 'cc.otsi.vie.env');
    assert.equal(backend.dataDir('/tmp/userdata', STAGING), 'E:\\OTSI-VIE-env');
  } finally {
    clearEnv();
  }
});

test('data folder override: the staging folder is used, never the production one', () => {
  clearEnv();
  // From the file.
  assert.equal(backend.dataDir('/tmp/userdata', STAGING), 'D:\\OTSI-VIE-staging');
  assert.notEqual(backend.dataDir('/tmp/userdata', STAGING), 'D:\\OTSI-VIE');
  // From the environment.
  process.env.OTSI_VIE_DATA_DIR = 'D:\\OTSI-VIE-staging';
  try {
    assert.equal(backend.dataDir('/tmp/userdata', {}), 'D:\\OTSI-VIE-staging');
  } finally {
    clearEnv();
  }
  // No override: the default (D:\OTSI-VIE on Windows with a D: drive, else under userData).
  const def = backend.dataDir('/tmp/userdata', {});
  if (process.platform === 'win32') {
    assert.ok(def === 'D:\\OTSI-VIE' || def === path.join('/tmp/userdata', 'OTSI-VIE'));
  } else {
    assert.equal(def, path.join('/tmp/userdata', 'OTSI-VIE'));
  }
});

test('no file = local mode: with no central.json and no env, the desktop is local-only', () => {
  clearEnv();
  // Checked on a temp copy of the modules (no resources/central.json in the temp folder), so this
  // does not depend on the repo's real resources/central.json being absent — on a staging machine
  // that file holds the live staging config, and the real modules would rightly read it.
  withTempModules(({ central, licence: tempLicence }) => {
    central.resetConfigCache();
    assert.equal(fs.existsSync(central.defaultConfigPath()), false);
    assert.deepEqual(central.loadConfig(), {});
    assert.equal(central.centralServerUrl({}), null);
    assert.equal(central.licencePublicKeyPem({}), null);
    assert.equal(central.dataDirOverride({}), null);
    assert.equal(central.appName({}), null);
    assert.equal(central.appId({}), null);
    assert.equal(tempLicence.centralServerUrl(), null);
    assert.equal(tempLicence.licenceStatus('/tmp/userdata-nonexistent').state, 'local-only');
  });
});

test('running from code: the repo central.json wins even when process.resourcesPath is set', () => {
  clearEnv();
  // process.resourcesPath is set even when the app runs from code (not packaged), so a staging run
  // from code used to read the packaged path (no file there) and start in local mode. The repo file
  // must win when it exists.
  // The test must NEVER touch the real repo resources/central.json: on a staging machine that file
  // holds the live staging config, and an earlier version of this test overwrote then deleted it.
  // So the test runs a COPY of central-config.js from a temp folder (its __dirname is the temp
  // folder), with a temp repo central.json and a temp packaged folder. Everything lives in temp
  // folders and is deleted afterwards; the real repo file is never written or removed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otsi-central-repo-'));
  const fakePackaged = fs.mkdtempSync(path.join(os.tmpdir(), 'otsi-packaged-resources-'));
  const savedResourcesPath = process.resourcesPath;
  try {
    fs.copyFileSync(path.join(__dirname, '..', 'central-config.js'), path.join(dir, 'central-config.js'));
    fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'resources', 'central.json'), JSON.stringify(STAGING), 'utf8');
    process.resourcesPath = fakePackaged;
    const copy = require(path.join(dir, 'central-config.js'));
    const repoFile = path.join(dir, 'resources', 'central.json');
    assert.equal(copy.defaultConfigPath(), repoFile);
    assert.equal(copy.loadConfig().central_server_url, 'https://accounts.otsi.cc');
  } finally {
    if (savedResourcesPath === undefined) delete process.resourcesPath;
    else process.resourcesPath = savedResourcesPath;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fakePackaged, { recursive: true, force: true });
  }
});

test('a broken config file is local mode, never an error', () => {
  clearEnv();
  withTempConfig('{not json', (file) => {
    assert.deepEqual(centralConfig.readConfigFile(file), {});
  });
  withTempConfig('[1, 2]', (file) => {
    assert.deepEqual(centralConfig.readConfigFile(file), {});
  });
  assert.deepEqual(centralConfig.readConfigFile('/nonexistent/central.json'), {});
  assert.equal(centralConfig.centralServerUrl({}), null);
});

test('the central URL is only honoured over HTTPS (or http on localhost for dev)', () => {
  clearEnv();
  assert.equal(centralConfig.centralServerUrl({ central_server_url: 'https://accounts.otsi.cc/' }), 'https://accounts.otsi.cc');
  assert.equal(centralConfig.centralServerUrl({ central_server_url: 'http://localhost:4521' }), 'http://localhost:4521');
  assert.equal(centralConfig.centralServerUrl({ central_server_url: 'http://accounts.otsi.cc' }), null);
  assert.equal(centralConfig.centralServerUrl({ central_server_url: 'accounts.otsi.cc' }), null);
  assert.equal(centralConfig.centralServerUrl({ central_server_url: '' }), null);
});

test('app identity override: a staging build gets its own name and id, a normal build is unchanged', () => {
  clearEnv();
  const calls = { name: null, id: null };
  const fakeApp = {
    setName(n) { calls.name = n; },
    setAppUserModelId(i) { calls.id = i; },
  };
  backend.applyBuildIdentity(fakeApp, STAGING);
  assert.equal(calls.name, 'OTSI VIE Staging');
  if (process.platform === 'win32') assert.equal(calls.id, 'cc.otsi.vie.staging');
  else assert.equal(calls.id, null); // AppUserModelId is Windows-only

  // No override: nothing is set on the app.
  const calls2 = { name: null, id: null };
  const fakeApp2 = {
    setName(n) { calls2.name = n; },
    setAppUserModelId(i) { calls2.id = i; },
  };
  backend.applyBuildIdentity(fakeApp2, {});
  assert.equal(calls2.name, null);
  assert.equal(calls2.id, null);

  // Env wins over the file for the identity too.
  process.env.OTSI_VIE_APP_NAME = 'OTSI VIE Env';
  process.env.OTSI_VIE_APP_ID = 'cc.otsi.vie.env';
  try {
    const calls3 = { name: null, id: null };
    const fakeApp3 = {
      setName(n) { calls3.name = n; },
      setAppUserModelId(i) { calls3.id = i; },
    };
    backend.applyBuildIdentity(fakeApp3, STAGING);
    assert.equal(calls3.name, 'OTSI VIE Env');
    if (process.platform === 'win32') assert.equal(calls3.id, 'cc.otsi.vie.env');
  } finally {
    clearEnv();
  }
});

test('the worker gets the licence public key from the file when the env is absent', () => {
  clearEnv();
  // Checked on a temp copy of the modules (no resources/central.json in the temp folder), so this
  // does not depend on the repo's real resources/central.json being absent.
  withTempModules(({ licence: tempLicence }) => {
    // licenceEnvForWorker reads the key through central-config; with no env and no file it is absent.
    const env = tempLicence.licenceEnvForWorker('/tmp/userdata-nonexistent');
    assert.equal(env.OTSI_VIE_LICENCE_PUBLIC_KEY_PEM, undefined);
    // With the env set, the key is forwarded.
    process.env.OTSI_VIE_LICENCE_PUBLIC_KEY_PEM = 'ENV-KEY';
    try {
      const env2 = tempLicence.licenceEnvForWorker('/tmp/userdata-nonexistent');
      assert.equal(env2.OTSI_VIE_LICENCE_PUBLIC_KEY_PEM, 'ENV-KEY');
    } finally {
      clearEnv();
    }
  });
});
