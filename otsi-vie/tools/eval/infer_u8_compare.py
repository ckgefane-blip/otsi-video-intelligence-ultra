"""U.8: synchronous vs AsyncInferQueue inference on a stub model (no OpenVINO, no torch, no model here).

A fake compiled model sleeps ``--latency`` per call (standing in for device time) and returns
deterministic per-image outputs; a fake ``openvino`` module runs its queue on threads. The script
times a batch of ``--n`` single-image requests run synchronously against the same batch through
``InferQueue`` with ``--requests`` in flight, and checks the two paths return identical results.

What this measures: that the queue overlaps slow calls and preserves order and results — the
scheduling U.8 adds. What it does NOT measure: real device throughput. No OpenVINO, no GPU and no
real model exist in this workspace, so no speedup number from here may be quoted as a device
result; a real throughput number needs the owner's host with OpenVINO and the RT-DETR weights.
"""
from __future__ import annotations

import argparse
import sys
import threading
import time
import types
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "worker"))
from vie_worker.infer_queue import InferQueue  # noqa: E402


class FakeResult:
    def __init__(self, outputs):
        self._outputs = list(outputs)

    def __getitem__(self, i):
        return self._outputs[i]


class FakeRequest:
    def __init__(self, result):
        self._result = result

    def get_output_tensor(self, i):
        return SimpleNamespace(data=self._result[i])


class FakeCompiled:
    def __init__(self, latency: float):
        self.latency = latency

    def __call__(self, inp):
        arr = inp[0] if isinstance(inp, dict) else inp
        time.sleep(self.latency)
        flat = arr.reshape(arr.shape[0], -1)
        sums = flat.sum(axis=1, keepdims=True).astype(np.float32)
        return FakeResult([np.repeat(sums, 2, axis=1), np.repeat(flat.mean(axis=1, keepdims=True), 4, axis=1)])


class FakeAsyncInferQueue:
    def __init__(self, compiled, num_requests: int = 0):
        self._compiled = compiled
        self._sem = threading.Semaphore(int(num_requests) if num_requests and num_requests > 0 else 8)
        self._threads: list[threading.Thread] = []
        self._callback = None

    def set_callback(self, cb):
        self._callback = cb

    def start_async(self, inputs, userdata):
        def _run():
            with self._sem:
                self._callback(FakeRequest(self._compiled(inputs)), userdata)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        self._threads.append(t)

    def wait_all(self):
        for t in self._threads:
            t.join()
        self._threads = []


def _collect(result):
    if hasattr(result, "get_output_tensor"):
        return result.get_output_tensor(0).data, result.get_output_tensor(1).data
    return result[0], result[1]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--n", type=int, default=8, help="requests in the batch")
    p.add_argument("--requests", type=int, default=4, help="in-flight requests for the async path")
    p.add_argument("--latency", type=float, default=0.05, help="seconds of fake device time per call")
    args = p.parse_args()
    rng = np.random.default_rng(20261110)
    ins = [rng.random((1, 3, 64, 64), dtype=np.float32) for _ in range(args.n)]

    t0 = time.monotonic()
    sync = InferQueue(FakeCompiled(args.latency), collect=_collect).run_batch(ins)
    sync_s = time.monotonic() - t0

    mod = types.ModuleType("openvino")
    mod.AsyncInferQueue = lambda compiled, num_requests=0: FakeAsyncInferQueue(compiled, num_requests)
    sys.modules["openvino"] = mod
    queue = InferQueue.from_compiled(FakeCompiled(args.latency), num_requests=args.requests, collect=_collect)
    t0 = time.monotonic()
    async_out = queue.run_batch([{0: a} for a in ins])
    async_s = time.monotonic() - t0

    diff = max(float(np.abs(s[0] - a[0]).max()) for s, a in zip(sync, async_out))
    print(f"n={args.n} requests={args.requests} latency={args.latency}s")
    print(f"sync:  {sync_s:.3f}s  async: {async_s:.3f}s  speedup: {sync_s / async_s:.2f}x")
    print(f"max abs diff sync vs async: {diff}  (must be 0)")
    print(f"queue stats: {queue.stats}")
    print("NOTE: stub-model scheduling only — not a device throughput number (see module docstring).")
    return 0 if diff == 0.0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
