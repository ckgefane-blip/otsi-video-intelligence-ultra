"""Track U.8: InferQueue — async OpenVINO inference with order-preserving results and a synchronous fallback.

No OpenVINO, torch or model lives in this workspace, so the OpenVINO side is exercised through a fake
``openvino`` module (a thread-per-request AsyncInferQueue) installed in ``sys.modules``; the sync side
runs against the same fake compiled model. What the fakes prove: ordering, identical outputs sync vs
async, overlap on slow calls, fallback when OpenVINO is absent, and a failed request surfacing instead
of vanishing. What they do not prove (honest limit): real device throughput — that needs the owner's
host with OpenVINO and the real models.
"""
import sys
import threading
import time
import types
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vie_worker.infer_queue import InferQueue  # noqa: E402


# ------------------------------------------------------------------ fakes
class FakeResult:
    """A compiled call's return value: indexable outputs, like an OpenVINO result."""

    def __init__(self, outputs):
        self._outputs = list(outputs)

    def __getitem__(self, i):
        return self._outputs[i]


class FakeRequest:
    """An OpenVINO infer request: outputs behind get_output_tensor(i).data."""

    def __init__(self, result):
        self._result = result

    def get_output_tensor(self, i):
        return SimpleNamespace(data=self._result[i])


class FakeCompiled:
    """A compiled model: deterministic outputs derived from the input, optionally slow."""

    def __init__(self, delay: float = 0.0):
        self.delay = delay
        self.calls = 0

    def __call__(self, inp):
        arr = inp[0] if isinstance(inp, dict) else inp
        if self.delay:
            time.sleep(self.delay)
        self.calls += 1
        # per-image outputs, like a real model: a row depends only on its own image, never on the batch around it
        flat = arr.reshape(arr.shape[0], -1)
        sums = flat.sum(axis=1, keepdims=True).astype(np.float32)
        means = flat.mean(axis=1, keepdims=True).astype(np.float32)
        return FakeResult([np.repeat(sums, 2, axis=1), np.repeat(means, 4, axis=1)])


class FakeAsyncInferQueue:
    """An ov.AsyncInferQueue stand-in: one thread per request, callback on completion."""

    def __init__(self, compiled, num_requests: int = 0, delay=None):
        self._compiled = compiled
        self._sem = threading.Semaphore(int(num_requests) if num_requests and num_requests > 0 else 8)
        self._delay = delay or (lambda userdata, inp: 0.01)
        self._threads: list[threading.Thread] = []
        self._callback = None

    def set_callback(self, cb):
        self._callback = cb

    def start_async(self, inputs, userdata):
        def _run():
            with self._sem:
                time.sleep(self._delay(userdata, inputs))
                req = FakeRequest(self._compiled(inputs))
                self._callback(req, userdata)

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        self._threads.append(t)

    def wait_all(self):
        for t in self._threads:
            t.join()
        self._threads = []


def _fake_openvino(delay=None):
    mod = types.ModuleType("openvino")
    mod.AsyncInferQueue = lambda compiled, num_requests=0: FakeAsyncInferQueue(compiled, num_requests, delay)
    return mod


@contextmanager
def fake_openvino(delay=None):
    old = sys.modules.get("openvino")
    sys.modules["openvino"] = _fake_openvino(delay)
    try:
        yield
    finally:
        if old is None:
            sys.modules.pop("openvino", None)
        else:
            sys.modules["openvino"] = old


def _det_collect(result):
    if hasattr(result, "get_output_tensor"):
        return result.get_output_tensor(0).data, result.get_output_tensor(1).data
    return result[0], result[1]


def _inputs(n):
    rng = np.random.default_rng(7)
    return [rng.random((1, 3, 4, 4), dtype=np.float32) * (i + 1) for i in range(n)]


def raises(fn):
    try:
        fn()
    except Exception:
        return True
    return False


# ------------------------------------------------------------------ the queue itself
def test_sync_queue_preserves_order_and_matches_direct_call():
    model = FakeCompiled()
    q = InferQueue(model, collect=_det_collect)
    assert q.is_async is False
    ins = _inputs(5)
    got = q.run_batch(ins)
    assert len(got) == 5
    for inp, out in zip(ins, got):
        assert out[0][0, 0] == inp.sum() and out[1][0, 0] == inp.mean()
    assert q.stats == {"async": False, "submitted": 5, "completed": 5, "num_requests": 0}


def test_empty_batch_returns_empty_and_counts_nothing():
    q = InferQueue.from_callable(FakeCompiled())
    assert q.run_batch([]) == []
    assert q.stats["submitted"] == 0


def test_async_queue_returns_results_in_submission_order():
    # later submissions finish first (delay shrinks with the index); results must still come back in order
    with fake_openvino(delay=lambda u, inp: 0.06 - 0.01 * u):
        model = FakeCompiled()
        q = InferQueue.from_compiled(model, num_requests=0, collect=_det_collect)
        assert q.is_async is True
        ins = _inputs(6)
        got = q.run_batch([{0: a} for a in ins])
        assert [g[0][0, 0] for g in got] == [a.sum() for a in ins]
        assert q.stats["submitted"] == 6 and q.stats["completed"] == 6


def test_async_and_sync_results_are_identical():
    ins = _inputs(4)
    sync = InferQueue(FakeCompiled(), collect=_det_collect).run_batch(ins)
    with fake_openvino():
        async_out = InferQueue.from_compiled(FakeCompiled(), num_requests=4, collect=_det_collect).run_batch([{0: a} for a in ins])
    for s, a in zip(sync, async_out):
        np.testing.assert_array_equal(s[0], a[0])
        np.testing.assert_array_equal(s[1], a[1])


def test_async_overlaps_slow_calls():
    ins = _inputs(6)
    model = FakeCompiled(delay=0.05)
    t0 = time.monotonic()
    InferQueue.from_callable(model).run_batch(ins)
    sync_s = time.monotonic() - t0
    with fake_openvino():
        q = InferQueue.from_compiled(FakeCompiled(delay=0.05), num_requests=6, collect=_det_collect)
        t0 = time.monotonic()
        q.run_batch([{0: a} for a in ins])
        async_s = time.monotonic() - t0
    assert async_s < 0.6 * sync_s, f"async {async_s:.3f}s did not overlap sync {sync_s:.3f}s"


def test_fallback_when_openvino_is_absent():
    assert "openvino" not in sys.modules
    q = InferQueue.from_compiled(FakeCompiled(), num_requests=4, collect=_det_collect)
    assert q.is_async is False
    ins = _inputs(3)
    got = q.run_batch([{0: a} for a in ins])
    assert [g[0][0, 0] for g in got] == [a.sum() for a in ins]


def test_a_failed_request_raises_instead_of_vanishing():
    def collect(result):
        v = result.get_output_tensor(0).data
        if v[0, 0] == 999.0:
            raise ValueError("boom")
        return v

    ins = _inputs(3)
    ins[1] = np.full((1, 3, 4, 4), 999.0 / 48.0, np.float32)  # sum == 999.0
    with fake_openvino():
        q = InferQueue.from_compiled(FakeCompiled(), num_requests=3, collect=collect)
        assert raises(lambda: q.run_batch([{0: a} for a in ins]))


def test_queue_is_a_context_manager():
    with InferQueue.from_callable(FakeCompiled()) as q:
        assert q.run_batch([np.zeros((1, 3, 2, 2), np.float32)]) != []


# ------------------------------------------------------------------ the detector's _infer branch (the shipped code, run directly)
def _load_detector_infer():
    import ast
    src = (Path(__file__).resolve().parents[1] / "vie_worker" / "detect" / "ov_rtdetr.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "_infer":
            ns = {"np": np}
            exec(compile(ast.Module(body=[node], type_ignores=[]), "ov_rtdetr._infer", "exec"), ns)
            return ns["_infer"]
    raise AssertionError("_infer not found in ov_rtdetr.py")


def test_detector_infer_queue_branch_matches_sync():
    infer = _load_detector_infer()
    x = np.random.default_rng(3).random((3, 3, 640, 640), dtype=np.float32)
    sync_self = SimpleNamespace(_infer_queue=None, compiled=FakeCompiled(), static_batch=False)
    logits_s, boxes_s = infer(sync_self, x)
    with fake_openvino():
        queue = InferQueue.from_compiled(FakeCompiled(), num_requests=3, collect=_det_collect)
        async_self = SimpleNamespace(_infer_queue=queue, compiled=FakeCompiled(), static_batch=False,
                                     infer_stats={"async": False, "submitted": 0, "completed": 0, "num_requests": 0})
        logits_a, boxes_a = infer(async_self, x)
    np.testing.assert_array_equal(logits_s, logits_a)
    np.testing.assert_array_equal(boxes_s, boxes_a)
    assert async_self.infer_stats == {"async": True, "submitted": 3, "completed": 3, "num_requests": 3}


# ------------------------------------------------------------------ the embedder's batch split
def test_embedder_call_splits_batches_through_the_queue():
    from vie_worker.embed import Embedder
    emb = object.__new__(Embedder)
    emb.mean = np.zeros((1, 3, 1, 1), np.float32)
    emb.std = np.ones((1, 3, 1, 1), np.float32)
    with fake_openvino():
        emb._infer_queue = InferQueue.from_compiled(FakeCompiled(), num_requests=4)
        emb.infer_stats = dict(emb._infer_queue.stats)
        emb.compiled = None
        rng = np.random.default_rng(11)
        crops = [rng.integers(0, 255, (64, 64, 3), dtype=np.uint8) for _ in range(5)]
        out = emb(crops)
    assert out.shape == (5, 2)
    np.testing.assert_allclose(np.linalg.norm(out, axis=1), 1.0, atol=1e-5)
    assert emb.infer_stats["async"] is True and emb.infer_stats["completed"] == 5
