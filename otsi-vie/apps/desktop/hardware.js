'use strict';
/**
 * Hardware check at first run (plan v3 §1b, ADR-144 §1.2).
 *
 * Detects the GPU, RAM and free disk, picks the fastest AI runtime
 * automatically (DirectML GPU -> OpenVINO -> CPU), and describes the result
 * in plain words for the loading window. It never throws: a detection that
 * cannot run (a missing tool, a timeout) reports "unknown" and the pick
 * falls back to CPU. It never fails silently on a weak PC: weakPcWarnings()
 * lists what will be slow, and the loading window shows it.
 *
 * No Electron dependency, so it can be checked and exercised with plain
 * Node. The runtime pick is a pure function (pickRuntime) so it can be
 * unit-tested without hardware.
 *
 * Mac later (plan v3 §1b): ONNX Runtime with CoreML runs the same models on
 * Mac. The pick has no darwin branch yet — that is a follow-up, not a
 * silent fallback: on darwin the GPU is reported unknown and the pick is
 * CPU, with a note in the description.
 */

// Weak-PC thresholds, shown plainly rather than blocking the app.
const MIN_RAM_GB = 8;      // below this, analysis is slow
const MIN_DISK_GB = 20;    // below this, free space before analysing
const LOW_DISK_GB = 10;    // below this, the app says so strongly

const { execFile } = require('node:child_process');
const os = require('node:os');

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10000, windowsHide: true, ...options }, (err, stdout) => {
      if (err) resolve('');
      else resolve(String(stdout || ''));
    });
  });
}

function gb(bytes) {
  return bytes == null || Number.isNaN(bytes) ? null : Math.round(bytes / 1073741824);
}

async function windowsGpu() {
  // Win32_VideoController lists every display adapter, including the basic
  // Microsoft one. Prefer a real vendor; fall back to the first name.
  const out = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
  ]);
  const names = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!names.length) return null;
  const real = names.find((n) => /nvidia|amd|radeon|intel|arc|geforce|rtx|gtx/i.test(n));
  return { name: real || names[0] };
}

async function windowsDiskFreeGB(driveLetter) {
  const out = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `(Get-PSDrive ${driveLetter}).Free`,
  ]);
  const n = parseInt(out.trim(), 10);
  return Number.isNaN(n) ? null : gb(n);
}

async function posixDiskFreeGB(dir) {
  const out = await execFileAsync('df', ['-k', dir]);
  const line = out.split(/\n/).map((s) => s.trim()).filter(Boolean)[1] || '';
  const parts = line.split(/\s+/);
  const n = parseInt(parts[3], 10);
  return Number.isNaN(n) ? null : Math.round(n / 1048576);
}

function cpuVendor(model) {
  if (/intel/i.test(model)) return 'intel';
  if (/amd/i.test(model)) return 'amd';
  return 'other';
}

function gpuVendor(name) {
  if (!name) return null;
  if (/nvidia|geforce|rtx|gtx|quadro|tesla/i.test(name)) return 'nvidia';
  if (/amd|radeon/i.test(name)) return 'amd';
  if (/intel/i.test(name)) return 'intel';
  return 'other';
}

/**
 * The runtime pick. `detection` is { gpu: {name} | null, cpuVendor }.
 * DirectML uses any Windows GPU (NVIDIA, AMD, Intel Arc); OpenVINO is for
 * Intel CPUs and GPUs; CPU is the fallback. Returns 'directml' |
 * 'openvino' | 'cpu'. Pure: no I/O, safe to test.
 */
function pickRuntime(detection) {
  const gpuName = detection && detection.gpu ? detection.gpu.name : '';
  const vendor = gpuVendor(gpuName);
  const isDiscreteGpu = vendor === 'nvidia' || vendor === 'amd'
    || /arc/i.test(gpuName || '') || /radeon\s+(rx|pro|vega)/i.test(gpuName || '');
  if (isDiscreteGpu) return 'directml';
  if (vendor === 'intel') return 'openvino'; // Intel GPU (incl. Arc, iGPU)
  if (detection && detection.cpuVendor === 'intel') return 'openvino';
  return 'cpu';
}

/**
 * The inference-device value the worker already reads
 * (OTSI_VIE_INFERENCE_DEVICE, services/worker/vie_worker/detect/base.py):
 * the current worker understands "GPU" / "CPU". The v3 ONNX worker reads
 * OTSI_VIE_AI_RUNTIME (directml | openvino | cpu) instead; both are set so
 * the pick works on either worker build.
 */
function inferenceDevice(runtime, detection) {
  if (runtime === 'directml') return 'GPU';
  if (runtime === 'openvino') {
    return detection && detection.gpu && gpuVendor(detection.gpu.name) === 'intel' ? 'GPU' : 'CPU';
  }
  return 'CPU';
}

/** Plain-word warnings for a weak PC. Empty when the machine is fine. */
function weakPcWarnings(detection) {
  const warnings = [];
  if (detection.ramGB != null && detection.ramGB < MIN_RAM_GB) {
    warnings.push(`This PC has only ${detection.ramGB} GB of memory — video analysis will be slow.`);
  }
  if (detection.diskFreeGB != null && detection.diskFreeGB < MIN_DISK_GB) {
    const strong = detection.diskFreeGB < LOW_DISK_GB ? 'Free space' : 'Free some space';
    warnings.push(`${strong}: only ${detection.diskFreeGB} GB free on the data drive.`);
  }
  if (!detection.gpu) {
    warnings.push('No graphics card was found — analysis runs on the CPU and is slower.');
  }
  return warnings;
}

/** One plain line for the loading window: what was found, what was picked. */
function describe(detection, runtime) {
  const gpu = detection.gpu ? detection.gpu.name : 'no graphics card found';
  const ram = detection.ramGB != null ? `${detection.ramGB} GB memory` : 'memory unknown';
  const disk = detection.diskFreeGB != null ? `${detection.diskFreeGB} GB free on the data drive` : 'free space unknown';
  const speed = runtime === 'directml'
    ? 'DirectML on the graphics card — the fastest analysis on this PC'
    : runtime === 'openvino'
      ? 'OpenVINO on Intel hardware — hardware-accelerated analysis'
      : 'CPU analysis — slower; a long match takes a while';
  const mac = process.platform === 'darwin'
    ? ' (Mac support is planned — ONNX Runtime with CoreML — and is not built yet, so the CPU is used.)'
    : '';
  return `${gpu} · ${ram} · ${disk} — ${speed}.${mac}`;
}

async function detect(dataDir) {
  const cpus = os.cpus() || [];
  const model = cpus.length ? cpus[0].model : '';
  const detection = {
    platform: process.platform,
    cpuModel: model,
    cpuVendor: cpuVendor(model),
    gpu: null,
    ramGB: gb(os.totalmem()),
    diskFreeGB: null,
  };
  try {
    if (process.platform === 'win32') {
      detection.gpu = await windowsGpu();
      const letter = String(dataDir || 'C:\\').slice(0, 1).toUpperCase();
      detection.diskFreeGB = await windowsDiskFreeGB(letter);
    } else {
      detection.diskFreeGB = await posixDiskFreeGB(dataDir || process.cwd());
    }
  } catch {
    // Detection never throws: unknown fields stay null and the pick falls
    // back to CPU.
  }
  detection.runtime = pickRuntime(detection);
  detection.inferenceDevice = inferenceDevice(detection.runtime, detection);
  detection.warnings = weakPcWarnings(detection);
  detection.summary = describe(detection, detection.runtime);
  return detection;
}

module.exports = {
  MIN_RAM_GB,
  MIN_DISK_GB,
  LOW_DISK_GB,
  pickRuntime,
  inferenceDevice,
  weakPcWarnings,
  describe,
  detect,
};
