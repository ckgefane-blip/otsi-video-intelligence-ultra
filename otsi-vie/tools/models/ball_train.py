"""Train the ball model (ADR-038): three consecutive frames in, a heat map of the ball's centre out. Our own small network (no third-party
weights or code); trained on crops from the owner's own footage (tools/models/ball_dataset.py) on the Intel Arc GPU (PyTorch XPU, BSD).

  .venv-train/Scripts/python.exe otsi-vie/tools/models/ball_train.py --data .local/ball-train/<video> [--epochs 20]

Writes .local/models/ball_net/<sha16>/ (weights.pt, model.onnx for OpenVINO, report.json with the validation numbers on the held-out last part
of the match). The network is fully convolutional: trained on 128 px crops, it runs on whole frames.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parents[3]
SIGMA = 2.0          # px: the target spot
THRESHOLD = 0.5      # a peak at least this strong is "the ball is here"
HIT_PX = 4.0         # a found peak this close to the true centre is right


def block(i: int, o: int) -> nn.Sequential:
    return nn.Sequential(nn.Conv2d(i, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True),
                         nn.Conv2d(o, o, 3, padding=1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class BallNet(nn.Module):
    """A small U-Net over 3 stacked RGB frames (9 channels). Output: one logit per pixel, at full input resolution."""

    def __init__(self, w: int = 24):
        super().__init__()
        self.e1, self.e2, self.e3, self.e4 = block(9, w), block(w, 2 * w), block(2 * w, 4 * w), block(4 * w, 8 * w)
        self.d3, self.d2, self.d1 = block(12 * w, 4 * w), block(6 * w, 2 * w), block(3 * w, w)
        self.head = nn.Conv2d(w, 1, 1)
        nn.init.constant_(self.head.bias, -4.0)                     # start "no ball anywhere"

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x1 = self.e1(x)
        x2 = self.e2(F.max_pool2d(x1, 2))
        x3 = self.e3(F.max_pool2d(x2, 2))
        x4 = self.e4(F.max_pool2d(x3, 2))
        up = lambda t, ref: F.interpolate(t, size=ref.shape[-2:], mode="bilinear", align_corners=False)
        y = self.d3(torch.cat([up(x4, x3), x3], 1))
        y = self.d2(torch.cat([up(y, x2), x2], 1))
        y = self.d1(torch.cat([up(y, x1), x1], 1))
        return self.head(y)[:, 0]


def targets(y: torch.Tensor, size: int) -> torch.Tensor:
    g = torch.arange(size, device=y.device, dtype=torch.float32)
    gx, gy = g.view(1, 1, -1), g.view(1, -1, 1)
    d2 = (gx - y[:, 1].view(-1, 1, 1)) ** 2 + (gy - y[:, 2].view(-1, 1, 1)) ** 2
    return torch.exp(-d2 / (2 * SIGMA ** 2)) * y[:, 0].view(-1, 1, 1)


def focal(logits: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
    """CenterNet's penalty-reduced focal loss: the exact centre is the positive, its neighbourhood is penalised less."""
    p = torch.sigmoid(logits).clamp(1e-4, 1 - 1e-4)
    pos = (t > 0.99).float()                                            # masks as weights: XPU asserts on boolean-mask indexing
    pos_l = -((1 - p) ** 2 * torch.log(p) * pos).sum()
    neg_l = -((1 - t) ** 4 * p ** 2 * torch.log(1 - p) * (1 - pos)).sum()
    return (pos_l + neg_l) / pos.sum().clamp(min=1)


def augment(x: torch.Tensor, y: torch.Tensor, size: int) -> tuple[torch.Tensor, torch.Tensor]:
    # whole-tensor selects (torch.where), not masked assignment: the XPU backend asserts on boolean-mask writes
    n = x.shape[0]
    flip = torch.rand(n, device=x.device) < 0.5
    x = torch.where(flip.view(-1, 1, 1, 1), x.flip(-1), x)
    y = torch.stack([y[:, 0], torch.where(flip & (y[:, 0] > 0), size - 1 - y[:, 1], y[:, 1]), y[:, 2]], 1)
    rev = torch.rand(n, device=x.device) < 0.3                           # the ball moves the other way
    x = torch.where(rev.view(-1, 1, 1, 1), torch.cat([x[:, 6:9], x[:, 3:6], x[:, 0:3]], 1), x)
    x = x * (0.75 + 0.5 * torch.rand(x.shape[0], 1, 1, 1, device=x.device)) + 0.1 * (torch.rand(x.shape[0], 1, 1, 1, device=x.device) - 0.5)
    return x.clamp(0, 1), y


def evaluate(net: nn.Module, X: np.ndarray, Y: np.ndarray, idx: np.ndarray, dev: str, bs: int = 128) -> dict:
    net.eval()
    tp = fp = fn = tn = 0
    with torch.no_grad():
        for k in range(0, len(idx), bs):
            b = idx[k:k + bs]
            x = torch.from_numpy(X[b]).to(dev).permute(0, 3, 1, 2).contiguous().float() / 255
            p = torch.sigmoid(net(x)).flatten(1)
            peak, where = p.max(1)
            size = x.shape[-1]
            for i, j in enumerate(b):
                found = float(peak[i]) >= THRESHOLD
                if Y[j, 0] > 0:
                    py, px = divmod(int(where[i]), size)
                    right = found and math.hypot(px - Y[j, 1], py - Y[j, 2]) <= HIT_PX
                    tp += right; fn += not found; fp += found and not right
                else:
                    fp += found; tn += not found
    net.train()
    return {"ball_found_right": tp, "ball_missed": fn, "wrong_place_or_invented": fp, "empty_right": tn,
            "precision": round(tp / max(1, tp + fp), 4), "recall": round(tp / max(1, tp + fn), 4)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--width", type=int, default=24)
    ap.add_argument("--device", default="xpu")
    a = ap.parse_args()
    dev = "xpu" if torch.xpu.is_available() and a.device != "cpu" else "cpu"
    d = Path(a.data)
    meta = json.loads((d / "meta.json").read_text())
    Y = np.load(d / "y.npy")
    X = np.load(d / "x.npy", mmap_mode="r")[: len(Y)]
    split = np.array([r[1] for r in meta["rows"]])
    tr, va = np.flatnonzero(split == "train"), np.flatnonzero(split == "val")
    print(f"{dev}: {len(tr)} train crops ({int(Y[tr, 0].sum())} with the ball), {len(va)} validation ({int(Y[va, 0].sum())} with the ball)", flush=True)
    torch.manual_seed(0)
    net = BallNet(a.width).to(dev)
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
    steps = a.epochs * math.ceil(len(tr) / a.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=steps)
    size, t0, best, best_state = X.shape[1], time.time(), -1.0, None
    for ep in range(a.epochs):
        perm = np.random.default_rng(ep).permutation(tr)
        total = 0.0
        for k in range(0, len(perm), a.batch):
            b = np.sort(perm[k:k + a.batch])
            x = torch.from_numpy(X[b]).to(dev).permute(0, 3, 1, 2).contiguous().float() / 255
            y = torch.from_numpy(Y[b]).to(dev)
            x, y = augment(x, y, size)
            loss = focal(net(x), targets(y, size))
            opt.zero_grad(); loss.backward(); opt.step(); sched.step()
            total += float(loss) * len(b)
        r = evaluate(net, X, Y, va, dev)
        f1 = 2 * r["precision"] * r["recall"] / max(1e-9, r["precision"] + r["recall"])
        print(f"epoch {ep + 1}/{a.epochs} loss {total / len(tr):.4f} val {r} ({time.time() - t0:.0f} s)", flush=True)
        if f1 > best:
            best, best_state, best_r = f1, {k: v.detach().cpu().clone() for k, v in net.state_dict().items()}, r
    net.load_state_dict(best_state)
    net = net.cpu().eval()
    buf = Path(d / "weights.tmp.pt")
    torch.save(best_state, buf)
    sha = hashlib.sha256(buf.read_bytes()).hexdigest()
    out = ROOT / ".local" / "models" / "ball_net" / sha[:16]
    out.mkdir(parents=True, exist_ok=True)
    buf.replace(out / "weights.pt")
    torch.onnx.export(net, torch.zeros(1, 9, 720, 1280), out / "model.onnx", input_names=["frames"], output_names=["logits"],
                      dynamic_axes={"frames": {2: "h", 3: "w"}, "logits": {1: "h", 2: "w"}}, opset_version=17, dynamo=False)
    report = {"sha256": sha, "width": a.width, "epochs": a.epochs, "train_crops": int(len(tr)), "val_crops": int(len(va)), "validation": best_r,
              "threshold": THRESHOLD, "hit_px": HIT_PX, "data": meta["video"], "seconds": round(time.time() - t0)}
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print("saved", out, report, flush=True)


if __name__ == "__main__":
    main()
