'use strict';
/**
 * Compile the desktop shell's main-process code to V8 bytecode (bytenode,
 * ADR-144 §1.8) for the packaged app: no readable source ships.
 *
 *   node scripts/compile-bytecode.js
 *
 * Input: main.js, backend.js, licence.js, hardware.js, components.js, windowmenu.js, appmenus.js.
 * Output (.local/bytecode/, staging only — never committed):
 *   main.js        a two-line loader: require('bytenode') + require('./main.jsc')
 *   main.jsc, backend.jsc, licence.jsc, hardware.jsc, components.jsc
 *
 * The bytecode is V8-version specific and cannot be cross-compiled: it
 * MUST be produced by the Electron build for the target platform, on that
 * platform's runner (bytenode docs). This script uses the Electron binary
 * from the devDependencies (`electron: true`).
 *
 * Electron 35 here is V8 ≤ 14.6, where `electron: true` (run-as-node)
 * compilation loads in the main process. If Electron is ever upgraded
 * past 42 (V8 ≥ 14.8), `electron: true` bytecode hard-crashes the main
 * process at load (SIGTRAP) and this script must switch to
 * `electronMain: true` (bytenode 2.x supports it) — see the bytenode
 * README "Known Issues". The preload is NOT compiled: it is the tiny
 * loading-window bridge and carries no logic worth hiding.
 */

const fs = require('node:fs');
const path = require('node:path');
const bytenode = require('bytenode');

const DESKTOP = path.resolve(__dirname, '..');
const OUT = path.join(DESKTOP, '.local', 'bytecode');
const FILES = ['main.js', 'backend.js', 'licence.js', 'hardware.js', 'components.js', 'windowmenu.js', 'appmenus.js'];

async function main() {
  const electronPath = require('electron'); // the Electron binary path
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const file of FILES) {
    const input = path.join(DESKTOP, file);
    const output = path.join(OUT, file.replace(/\.js$/, '.jsc'));
    // eslint-disable-next-line no-await-in-loop
    await bytenode.compileFile({
      filename: input,
      output,
      electron: true,
      electronPath,
      compileAsModule: true,
    });
    console.log(`compiled ${file} -> ${path.relative(DESKTOP, output)}`);
  }
  // The packaged entry point: package.json "main" is main.js, and the
  // packaged main.js is this loader (the readable main.js is not shipped).
  fs.writeFileSync(
    path.join(OUT, 'main.js'),
    "require('bytenode');\nmodule.exports = require('./main.jsc');\n",
    'utf8',
  );
  console.log(`wrote ${path.relative(DESKTOP, path.join(OUT, 'main.js'))} (loader)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
