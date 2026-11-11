"""Direct runner: the DB-backed worker tests against SQLite, without pytest and without
tests/conftest.py (which needs .local/mysql-lint.env + MySQL 3507 on the owner's host — never
fabricated here).

Usage: python3 run_sqlite_tests.py [module ...]
Default modules: test_sqlite_db test_job_lease test_profile_intro test_cross_match_render

How it works: a minimal ``pytest`` stub (``fixture`` is a no-op decorator, ``raises`` a context
manager) is installed in sys.modules before the test modules import; a fresh SQLite stack
(tests/sqlite_support.make_stack) stands in for the ``stack`` fixture and a db.py connection for
the ``root`` fixture; fixture functions are called with those values by parameter name. The test
files themselves are NOT modified, and their MySQL path (pytest + conftest on the host) is untouched.

test_profile_intro / test_cross_match_render take no fixtures (pure render planning); they run
here unchanged. test_job_lease is the DB test: claim / progress / takeover / priority+cap, all
through the real JobRunner on SQLite.
"""
from __future__ import annotations

import importlib
import inspect
import os
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "tests"))

import sqlite_support  # noqa: E402
from vie_worker.db import connect  # noqa: E402


class _Raises:
    def __init__(self, exc):
        self.exc = exc

    def __enter__(self):
        return None

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            raise AssertionError(f"expected {self.exc.__name__} to be raised")
        return issubclass(exc_type, self.exc)


class _PytestStub:
    def raises(self, exc):
        return _Raises(exc)

    def fixture(self, *args, **kwargs):
        if args and callable(args[0]):
            return args[0]

        def deco(fn):
            return fn

        return deco


sys.modules.setdefault("pytest", _PytestStub())

MODULES = sys.argv[1:] or ["test_sqlite_db", "test_job_lease", "test_profile_intro", "test_cross_match_render", "test_licence"]

# fixture functions defined in a test module, by name (called with stack/root by parameter name)
FIXTURES: dict[str, dict] = {}


def build_fixture(fn, stack, root):
    kwargs = {}
    for name in inspect.signature(fn).parameters:
        if name == "stack":
            kwargs[name] = stack
        elif name == "root":
            kwargs[name] = root
        else:
            raise RuntimeError(f"runner cannot build fixture parameter {name!r} for {fn.__name__}")
    return fn(**kwargs)


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="vie-sqlite-runner-")
    stack = sqlite_support.make_stack(tmpdir)
    root = connect(stack["dsn"])
    passed, failed, skipped = 0, 0, []
    try:
        for name in MODULES:
            # the db.py path guard reads OTSI_VIE_DATA_DIR at connect time; a module whose tests
            # build their own stacks (test_sqlite_db) moves it, so point it back at this shared stack
            os.environ["OTSI_VIE_DATA_DIR"] = tmpdir
            try:
                mod = importlib.import_module(name)
            except Exception:
                failed += 1
                print(f"IMPORT-FAIL {name}")
                traceback.print_exc()
                continue
            fixtures = {n: getattr(mod, n) for n in dir(mod)
                        if n in ("job",) and callable(getattr(mod, n)) and not n.startswith("test_")}
            for attr in sorted(dir(mod)):
                if not attr.startswith("test_"):
                    continue
                fn = getattr(mod, attr)
                if not callable(fn):
                    continue
                kwargs: dict = {}
                try:
                    for pname in inspect.signature(fn).parameters:
                        if pname == "stack":
                            kwargs[pname] = stack
                        elif pname == "root":
                            kwargs[pname] = root
                        elif pname in fixtures:
                            kwargs[pname] = build_fixture(fixtures[pname], stack, root)
                        else:
                            raise RuntimeError(f"runner cannot supply parameter {pname!r}")
                    fn(**kwargs)
                except Exception:
                    failed += 1
                    print(f"FAIL {name}::{attr}")
                    traceback.print_exc(limit=5)
                else:
                    passed += 1
                    print(f"PASS {name}::{attr}")
    finally:
        root.close()
        shutil.rmtree(tmpdir, ignore_errors=True)
    print(f"TOTAL {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
