"""BEAT_GRID (v3 C.5, ADR-105): the beat grid of a music brand asset, found on this computer.

The music is decoded by the LGPL FFmpeg build to mono 22 050 Hz samples and analysed with NumPy and SciPy (both BSD-3-Clause); nothing
leaves the computer, no model and no new dependency is used:
- onset envelope: the spectral flux of a log-compressed magnitude spectrogram (2048-sample Hann window, 512-sample hop), local mean
  removed, half-wave rectified;
- tempo: the autocorrelation lag of the envelope with the strongest periodicity between 60 and 200 BPM, weighted by a broad log-normal
  prior around 120 BPM (one octave), refined to a fraction of a frame;
- beats: dynamic programming (D. P. W. Ellis, "Beat Tracking by Dynamic Programming", J. New Music Research 36(1), 2007): each beat
  maximises the onset strength plus a penalty for spacing away from the tempo; weak beats at the very start and end are dropped.

`periodicity` is the normalised autocorrelation peak at that tempo (how steady the music is), not an accuracy: the beats are Detected and
their accuracy is not measured (no labelled music test set). Below 0.1, or with fewer than four beats, the grid records "no steady beat"
(tempo null, no beats) instead of guessing.
"""
from __future__ import annotations

import json
import os

import numpy as np

from . import ff
from .db import audit, tx
from .jobs import Job, JobError, JobRunner
from .storage import LocalStore

SERVICE = "beat-worker"
METHOD = "otsi-beat-v1"
SR, NFFT, HOP = 22_050, 2048, 512
FPS = SR / HOP                                                         # envelope frames per second (~43.07)
BPM_MIN, BPM_MAX, BPM_PRIOR, PRIOR_OCTAVES = 60.0, 200.0, 120.0, 1.0
TIGHTNESS = 100.0
MIN_PERIODICITY, MIN_BEATS = 0.1, 4
MAX_SECONDS = 20 * 60                                                  # a 25 MB file is far shorter; a guard, not a limit people meet


def decode(path: str) -> np.ndarray:
    """the music as mono float32 samples at SR (FFmpeg resamples and mixes down); FFmpegError when it cannot be read"""
    r = ff.run(["-v", "error", "-nostdin", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-t", str(MAX_SECONDS), "-f", "f32le", "pipe:1"], timeout=600)
    if r.returncode != 0:
        raise ff.FFmpegError(r.stderr.decode("utf-8", "replace").strip()[-300:] or f"ffmpeg exited {r.returncode}")
    return np.frombuffer(r.stdout, dtype="<f4").astype(np.float32)


def onset_envelope(y: np.ndarray) -> np.ndarray:
    """spectral flux per hop (frame t is centred on sample t * HOP)"""
    if y.size < NFFT:
        return np.zeros(0, np.float32)
    pad = np.pad(y, (NFFT // 2, NFFT // 2))
    n = 1 + (pad.size - NFFT) // HOP
    frames = np.lib.stride_tricks.as_strided(pad, shape=(n, NFFT), strides=(pad.strides[0] * HOP, pad.strides[0]))
    mag = np.abs(np.fft.rfft(frames * np.hanning(NFFT).astype(np.float32), axis=1))
    s = np.log1p(100.0 * mag)
    flux = np.maximum(0.0, np.diff(s, axis=0)).mean(axis=1)
    env = np.concatenate([[0.0], flux])
    from scipy.ndimage import uniform_filter1d
    env = np.maximum(0.0, env - uniform_filter1d(env, size=int(FPS)))        # local mean (1 s) removed
    sd = env.std()
    return (env / sd).astype(np.float64) if sd > 0 else np.zeros_like(env, dtype=np.float64)


def estimate_tempo(env: np.ndarray) -> tuple[float | None, float]:
    """(BPM, periodicity 0..1); (None, 0) when the envelope is empty or flat"""
    if env.size < int(FPS * 4) or not env.any():
        return None, 0.0
    x = env - env.mean()
    nfft = 1 << int(np.ceil(np.log2(2 * x.size)))
    ac = np.fft.irfft(np.abs(np.fft.rfft(x, nfft)) ** 2)[: x.size]
    if ac[0] <= 0:
        return None, 0.0
    ac = ac / ac[0]
    lo, hi = int(np.floor(60 * FPS / BPM_MAX)), int(np.ceil(60 * FPS / BPM_MIN))
    hi = min(hi, ac.size - 2)
    if hi <= lo:
        return None, 0.0
    lags = np.arange(lo, hi + 1)
    bpm = 60 * FPS / lags
    prior = np.exp(-0.5 * (np.log2(bpm / BPM_PRIOR) / PRIOR_OCTAVES) ** 2)
    k = int(lags[np.argmax(np.maximum(ac[lags], 0) * prior)])
    a, b, c = ac[k - 1], ac[k], ac[k + 1]                                     # parabolic refinement of the peak
    den = a - 2 * b + c
    off = 0.5 * (a - c) / den if den < 0 else 0.0
    lag = k + float(np.clip(off, -0.5, 0.5))
    return 60 * FPS / lag, float(max(0.0, min(1.0, b)))


def track_beats(env: np.ndarray, bpm: float) -> np.ndarray:
    """beat frames by dynamic programming (Ellis 2007)"""
    period = 60 * FPS / bpm
    w = np.arange(-int(period), int(period) + 1)
    local = np.convolve(env, np.exp(-0.5 * (w * 32.0 / period) ** 2), "same")
    n = local.size
    cum, back = np.zeros(n), -np.ones(n, dtype=int)
    win = np.arange(-int(round(2 * period)), -int(round(period / 2)) + 1)
    cost = -TIGHTNESS * np.log(-win / period) ** 2
    for i in range(n):
        z = i + win
        ok = z >= 0
        if not ok.any():
            cum[i] = local[i]
            continue
        cand = cum[z[ok]] + cost[ok]
        j = int(np.argmax(cand))
        if cand[j] > 0:
            cum[i], back[i] = local[i] + cand[j], int(z[ok][j])
        else:
            cum[i] = local[i]
    # the last beat: the latest local maximum of the cumulative score above half the median of the maxima
    peaks = np.flatnonzero((cum[1:-1] >= cum[:-2]) & (cum[1:-1] > cum[2:])) + 1
    if not peaks.size:
        return np.zeros(0, dtype=int)
    good = peaks[cum[peaks] >= 0.5 * np.median(cum[peaks])]
    i, beats = int(good[-1]), []
    while i >= 0:
        beats.append(i)
        i = int(back[i])
    beats = np.array(beats[::-1], dtype=int)
    # weak beats at the very start and end (silence, a fade) are dropped
    if beats.size:
        sm = np.convolve(local[beats], np.hanning(5), "same")
        thr = 0.5 * np.sqrt(np.mean(sm ** 2))
        keep = np.flatnonzero(sm > thr)
        beats = beats[keep[0]: keep[-1] + 1] if keep.size else beats[:0]
    return beats


def analyse(y: np.ndarray) -> dict:
    """the grid of mono samples at SR: {tempo_bpm, beats_us, periodicity, duration_us}; tempo None and no beats when no steady beat"""
    dur = int(round(y.size / SR * 1e6))
    env = onset_envelope(y)
    bpm, per = estimate_tempo(env)
    beats: list[int] = []
    if bpm is not None and per >= MIN_PERIODICITY:
        frames = track_beats(env, bpm)
        beats = [int(round(f * HOP / SR * 1e6)) for f in frames if f * HOP / SR * 1e6 <= dur]
    if len(beats) < MIN_BEATS or bpm is None or per < MIN_PERIODICITY:
        return {"tempo_bpm": None, "beats_us": [], "periodicity": round(per, 4), "duration_us": dur}
    return {"tempo_bpm": round(bpm, 2), "beats_us": beats, "periodicity": round(per, 4), "duration_us": dur}


def _fail(runner: JobRunner, gid: str, code: str, detail: str) -> dict:
    with tx(runner.conn) as cur:
        cur.execute("UPDATE music_beat_grids SET status = 'FAILED', failure_code = %s, failure_detail = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s",
                    (code, detail[:2000], gid))
    return {"beat_grid_id": gid, "status": "FAILED", "failure_code": code}


def handle_beat_grid(runner: JobRunner, job: Job) -> dict:
    store = LocalStore(os.environ["OTSI_VIE_STORAGE_DIR"])
    org, gid = job.organization_id, job.payload["beat_grid_id"]
    with runner.conn.cursor() as cur:
        cur.execute("""SELECT g.id, g.status, g.brand_asset_id, b.kind, b.retired_at, a.object_key
                         FROM music_beat_grids g JOIN brand_assets b ON b.id = g.brand_asset_id AND b.organization_id = g.organization_id
                         JOIN assets a ON a.id = b.asset_id AND a.organization_id = b.organization_id
                        WHERE g.id = %s AND g.organization_id = %s""", (gid, org))
        row = cur.fetchone()
    if not row:
        raise JobError("NOT_FOUND", "The beat grid no longer exists.")
    if row["status"] in ("SUCCEEDED", "FAILED"):
        return {"beat_grid_id": gid, "status": row["status"], "note": "already settled"}
    if row["kind"] != "MUSIC" or row["retired_at"] is not None:
        return _fail(runner, gid, "MUSIC_NOT_AVAILABLE", "This music was removed, so its beat was not found.")
    with tx(runner.conn) as cur:
        cur.execute("UPDATE music_beat_grids SET status = 'RUNNING' WHERE id = %s", (gid,))
    runner.progress(job, 10, "Reading the music")
    try:
        y = decode(str(store.path(row["object_key"])))
    except (ff.FFmpegError, OSError) as e:
        return _fail(runner, gid, "MUSIC_UNREADABLE", f"The music file could not be read: {str(e)[:200]}")
    if y.size < SR:
        return _fail(runner, gid, "MUSIC_TOO_SHORT", "The music is shorter than one second.")
    runner.progress(job, 40, "Finding the beat")
    g = analyse(y)
    with tx(runner.conn) as cur:
        cur.execute("SELECT claim_token FROM worker_jobs WHERE id = %s FOR UPDATE", (job.id,))
        if cur.fetchone()["claim_token"] != job.token:
            raise JobError("LEASE_LOST", "Another worker took over this beat grid.")
        cur.execute("""UPDATE music_beat_grids SET status = 'SUCCEEDED', method = %s, tempo_bpm = %s, beats = %s, beat_count = %s, duration_us = %s,
                       periodicity = %s, finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s""",
                    (METHOD, g["tempo_bpm"], json.dumps(g["beats_us"]), len(g["beats_us"]), g["duration_us"], g["periodicity"], gid))
        audit(cur, org, SERVICE, "brand_asset.beat_grid_made", "brand_asset", str(row["brand_asset_id"]),
              {"beat_grid_id": gid, "method": METHOD, "tempo_bpm": g["tempo_bpm"], "beats": len(g["beats_us"]), "periodicity": g["periodicity"]}, f"job:{job.id}")
    return {"beat_grid_id": gid, "status": "SUCCEEDED", "tempo_bpm": g["tempo_bpm"], "beats": len(g["beats_us"]), "periodicity": g["periodicity"]}
