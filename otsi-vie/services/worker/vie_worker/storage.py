"""Local object store for workers — the same key layout and the same escape checks as apps/api/src/core/storage.ts."""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

KEY = re.compile(r"^[A-Za-z0-9_./-]+$")


class LocalStore:
    def __init__(self, root: str):
        self.root = Path(root).resolve()

    def path(self, key: str) -> str:
        if not KEY.match(key) or any(p in ("", "..", ".") for p in key.split("/")):
            raise ValueError(f"invalid storage key {key}")
        full = self.root.joinpath(*key.split("/")).resolve()
        if self.root not in full.parents:
            raise ValueError("storage key escapes the store")
        return str(full)

    def ensure_dir(self, key: str) -> str:
        p = self.path(key)
        os.makedirs(p, exist_ok=True)
        return p

    def remove(self, key: str) -> None:
        shutil.rmtree(self.path(key), ignore_errors=True)
