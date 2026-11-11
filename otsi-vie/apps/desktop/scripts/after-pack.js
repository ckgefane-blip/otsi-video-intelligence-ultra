'use strict';
/**
 * electron-builder afterPack hook: Electron fuses (ADR-144 §1.8).
 *
 *   RunAsNode OFF — the packaged Electron binary cannot be used as a
 *     Node runtime to run arbitrary code.
 *   Node inspector (CLI inspect arguments) OFF.
 *   Embedded ASAR integrity validation ON — the app refuses to run from a
 *     tampered ASAR.
 *
 * Only the three fuses the plan names are flipped. The hook runs after
 * pack, so it flips the fuses on the packaged Electron binary in
 * appOutDir. It runs on the build machine (Windows); the first packaged
 * build must be launched once to prove the app still starts with the
 * integrity fuse on — a bad integrity hash breaks launch, and the
 * clean-Windows test is what catches it.
 */

const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return; // Windows installer only for now
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const { existsSync } = require('node:fs');
  const target = existsSync(exePath)
    ? exePath
    : (() => {
      const { readdirSync } = require('node:fs');
      const found = readdirSync(context.appOutDir).find((f) => f.endsWith('.exe'));
      if (!found) throw new Error(`after-pack: no .exe found in ${context.appOutDir} to flip fuses on`);
      return path.join(context.appOutDir, found);
    })();
  await flipFuses(target, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  });
  console.log(`after-pack: fuses flipped on ${path.basename(target)}`);
};
