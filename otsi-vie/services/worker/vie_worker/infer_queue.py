"""Asynchronous model inference across the tracking path (U.8, see W4).

Until now the only OpenVINO ``AsyncInferQueue`` in the worker was the ball
model (``ball_net.py:79``): person detection (``detect/ov_rtdetr.py``),
appearance embeddings (``embed.py``) and OCR (``ocr.py``) all called their
compiled model synchronously, one batch at a time, so the frame waited on
each inference in turn. ``InferQueue`` generalises the ball-net pattern to
any compiled model:

- ``InferQueue.from_compiled(compiled, num_requests=..., collect=...)``
  runs requests through ``ov.AsyncInferQueue`` when OpenVINO is available
  and the model accepts it; otherwise it falls back to the same call made
  synchronously, with the same interface and the same results.
- ``run_batch(inputs)`` submits every input, waits, and returns the
  results **in submission order** — a detector's crops must come back
  matched to the windows they came from, whatever order the device
  finished them in. A result is never dropped, reordered or silently
  replaced: a collection failure raises from ``run_batch``.
- ``collect`` turns one request's raw result into the value the caller
  wants. It receives an OpenVINO request on the async path and the
  compiled model's return value on the sync path, so it should handle
  both shapes (see ``_collect_first`` / the detector's collector):
  ``req.get_output_tensor(i).data`` on a request, ``result[i]`` on a
  compiled call. The default collects the first output.
- ``stats`` reports ``{"async": bool, "submitted": n, "completed": n,
  "num_requests": k}``; ``num_requests=0`` means the OpenVINO default
  (the device picks how many requests to keep in flight).

The queue is off unless a caller asks for it: ``OvRtDetr`` and
``Embedder`` only build one when ``async_requests`` is given, and the
synchronous path is byte-for-byte the previous behaviour. No model, no
weights and no result changes — only how inference is scheduled.
"""
from __future__ import annotations

import logging
import threading
from typing import Callable

log = logging.getLogger("vie_worker.infer_queue")


def _collect_first(result):
    """The first output of one request: an OpenVINO request's tensor 0, or a compiled call's output 0."""
    if hasattr(result, "get_output_tensor"):
        return result.get_output_tensor(0).data
    return result[0]


class InferQueue:
    """Several model requests in flight at once, results in submission order.

    ``run_fn`` is the synchronous call (usually the compiled model itself).
    ``async_queue`` is an ``ov.AsyncInferQueue`` (or a compatible object
    with ``set_callback`` / ``start_async`` / ``wait_all``); ``None``
    means every request runs synchronously through ``run_fn``.
    """

    def __init__(self, run_fn: Callable, *, async_queue=None, num_requests: int = 0, collect: Callable | None = None):
        self._run_fn = run_fn
        self._queue = async_queue
        self._collect = collect or _collect_first
        self._num_requests = int(num_requests) if async_queue is not None else 0
        self._submitted = 0
        self._completed = 0
        self._lock = threading.Lock()

    @property
    def is_async(self) -> bool:
        return self._queue is not None

    @property
    def num_requests(self) -> int:
        return self._num_requests

    @property
    def stats(self) -> dict:
        with self._lock:
            return {"async": self.is_async, "submitted": self._submitted,
                    "completed": self._completed, "num_requests": self._num_requests}

    @classmethod
    def from_compiled(cls, compiled, *, num_requests: int = 0, collect: Callable | None = None) -> "InferQueue":
        """A queue for a compiled OpenVINO model, async when possible.

        Any failure to build the OpenVINO queue (no OpenVINO, no usable
        device, a model the queue rejects) falls back to synchronous
        calls on the same model — the caller keeps working, slower, and
        ``is_async`` says so. Nothing is raised for the fallback itself.
        """
        try:
            import openvino as ov
            queue = ov.AsyncInferQueue(compiled, int(num_requests))
        except Exception as e:  # noqa: BLE001 - any OpenVINO/device failure: stay synchronous and say so
            log.info("AsyncInferQueue unavailable (%s); inference stays synchronous", e)
            return cls(compiled, async_queue=None, num_requests=0, collect=collect)
        return cls(compiled, async_queue=queue, num_requests=int(num_requests), collect=collect)

    @classmethod
    def from_callable(cls, fn: Callable) -> "InferQueue":
        """A synchronous queue around any callable (torch path, tests): same interface, no concurrency."""
        return cls(fn, async_queue=None, num_requests=0)

    def run_batch(self, inputs) -> list:
        """Run every input and return the results in submission order."""
        inputs = list(inputs)
        if not inputs:
            return []
        if self._queue is None:
            out = [self._collect(self._run_fn(inp)) for inp in inputs]
            with self._lock:
                self._submitted += len(inputs)
                self._completed += len(inputs)
            return out
        results: dict[int, object] = {}
        errors: dict[int, BaseException] = {}

        def _done(req, userdata: int) -> None:
            try:
                value = self._collect(req)
            except Exception as e:  # noqa: BLE001 - a failed request must surface from run_batch, not vanish in a callback
                with self._lock:
                    errors[userdata] = e
            else:
                with self._lock:
                    results[userdata] = value
                    self._completed += 1

        self._queue.set_callback(_done)
        with self._lock:
            self._submitted += len(inputs)
        for i, inp in enumerate(inputs):
            self._queue.start_async(inp, i)
        self._queue.wait_all()
        if errors:
            raise errors[min(errors)]
        return [results[i] for i in range(len(inputs))]

    def wait_all(self) -> None:
        if self._queue is not None:
            self._queue.wait_all()

    def __enter__(self) -> "InferQueue":
        return self

    def __exit__(self, *exc) -> None:
        self.wait_all()
