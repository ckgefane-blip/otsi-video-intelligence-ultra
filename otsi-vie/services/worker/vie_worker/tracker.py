"""Multi-object tracking within one camera shot (Block 06, ADR-025): a ByteTrack-style tracker written for OTSI VIE (no third-party code).

  * constant-velocity Kalman filter per track on (centre x, centre y, aspect, height), time-step = the real time between samples
  * two-stage association (Hungarian, SciPy): high-score detections first, then low-score ones only to keep existing tracks alive
    through partial occlusion; cost = 1 - IoU with the predicted box, gated by IoU and by centre distance relative to box height
  * lifecycle: tentative -> confirmed after `min_hits` matches (one-frame false positives never become tracks); lost after a miss;
    ended after `max_lost_s` without a match — a player who leaves the picture gets a NEW track when he returns (no invented re-entry)
  * persons and the ball are tracked separately; the ball keeps at most one track at a time (the most confident candidate)
  * a camera cut ends every track (`end_all`): nothing is bridged across shots
  * optional kit-colour gate (ADR-034, `kit_gate`): when two players cross, a track may not take over a box whose shirt colour clearly
    differs from its own (Hellinger hue/saturation histogram of the torso); the gate only forbids, it never creates an association
  * U.2 Deep-EIoU + on-demand DINOv2 gate: the association score uses the IoU of boxes expanded by `eiou_expand` (a player who moved
    more than his own width between samples still scores), and a match the motion evidence cannot settle — a rival
    candidate nearly as good, or two tracks whose predictions mutually overlap (a crossing) — is arbitrated by a DINOv2 appearance
    provider, but only for that pair: the provider is called lazily, never on an unambiguous match, and the gate only forbids
    (cosine below `dino_gate`); it never creates an association. `dino_gate=None` (the default) disables it entirely: no model
    call, no behaviour change. No live provider is wired in analyze.py yet — embeddings are computed post-hoc there (appearance.py)
    — so the gate is off in production until a caller supplies one to `update(appearance_fn=...)`.
  * U.4 pitch-plane Kalman + biomechanical velocity gate: when the caller supplies a pitch homography
    (`pitch_homography`, pitch metres -> normalised picture, as in `geometry.py`), each PERSON track also
    carries a constant-velocity Kalman filter in pitch metres (feet position, bottom centre of the box) and
    a match is forbidden when the player would have had to run from where he last was to the new box faster
    than `max_speed_mps` (12 m/s by default: the fastest recorded football sprint is ~10.6 m/s, so 12 leaves
    room for calibration and box noise). The gate only forbids, it never creates an association, and it never
    fires for the ball (a shot is far faster than any player) or when a position cannot be placed (no
    calibration, feet off the pitch, dt = 0). `pitch_homography=None` (the default) disables it entirely:
    no behaviour change. No live calibration is wired in analyze.py yet — calibrations live per shot in
    pitch_job — so the gate is off in production until a caller supplies H (replace it per shot: a camera
    cut ends the calibration as surely as it ends the tracks).

A track is an anonymous, temporary reference ("track 7") inside one processing run. It is never a player identity (ADR-016).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.optimize import linear_sum_assignment

from .detect.base import Detection
from .geometry import feet_pitch_position


@dataclass
class Observation:
    frame_index: int
    pts_us: int
    x: float
    y: float
    w: float
    h: float
    score: float
    association: float              # how well this detection matched the track's prediction (1.0 for the first one)
    team: int | None = None         # the team called for this detection from its own shirt (0 / 1 team, 2 officials), None when not sure


@dataclass
class Track:
    number: int
    label: str
    shot_number: int
    observations: list[Observation] = field(default_factory=list)
    hits: int = 0
    misses: int = 0
    last_pts_us: int = 0
    confirmed: bool = False
    votes: list = field(default_factory=lambda: [0, 0, 0])      # per-frame team calls so far: team 0, team 1, officials
    feat: np.ndarray | None = None  # running torso-colour descriptor (kit gate)
    state: np.ndarray = field(default_factory=lambda: np.zeros(8))
    cov: np.ndarray = field(default_factory=lambda: np.eye(8))
    pitch_state: np.ndarray | None = None  # U.4: [x, y, vx, vy] in pitch metres (feet); None until calibrated
    pitch_cov: np.ndarray | None = None
    pitch_pos: tuple[float, float] | None = None  # U.4: last measured pitch position (metres), for the velocity gate


# U.2 thresholds (Deep-EIoU + on-demand DINOv2 gate).
EIOU_EXPAND = 0.2        # each side of a box grows by this share of its own width/height before the association IoU is taken
AMBIGUITY_MARGIN = 0.15  # two candidate costs within this are too close to call on motion alone: consult appearance
DINO_REJECT_COS = 0.35   # a DINOv2 cosine below this is a different person: forbid the match. Calibration (appearance.py):
                         # same-person track halves score >= 0.70 at the 5th percentile with 3 crops each; a single crop is
                         # noisier, so only a clearly-low cosine forbids — the gate never creates a match.
TRACK_OVERLAP_IOU = 0.15 # two tracks whose predicted boxes overlap at this IoU are crossing (mirrors follow.OVERLAP_IOU, U.1):
                         # their matches are ambiguous however confident motion looks
MAX_SPEED_MPS = 12.0     # U.4: no player runs faster than this (fastest recorded football sprint ~10.6 m/s); the gate
                         # forbids a match that would need more, with room for calibration and box noise
PITCH_MEAS_STD_M = 0.7   # U.4: how far a feet position in metres is trusted (calibration + box noise)
PITCH_ACCEL_STD = 2.5    # U.4: m/s^2 the pitch Kalman allows between samples (a player can accelerate hard)


def _expand_box(b: tuple[float, float, float, float], frac: float) -> tuple[float, float, float, float]:
    """The box grown by `frac` of its own width/height on every side, same centre (Deep-EIoU expansion)."""
    x, y, w, h = b
    return x - w * frac / 2, y - h * frac / 2, w * (1 + frac), h * (1 + frac)


def _eiou(a: tuple[float, float, float, float], b: tuple[float, float, float, float], expand: float) -> float:
    """IoU of the expanded boxes (Deep-EIoU); plain IoU when `expand` is 0."""
    return _iou(a, b) if expand <= 0 else _iou(_expand_box(a, expand), _expand_box(b, expand))


def _xywh_to_z(d: Detection | Observation) -> np.ndarray:
    return np.array([d.x + d.w / 2, d.y + d.h / 2, d.w / max(d.h, 1e-6), d.h])


def _z_to_xywh(z: np.ndarray) -> tuple[float, float, float, float]:
    cx, cy, a, h = z[:4]
    w = a * h
    return cx - w / 2, cy - h / 2, w, h


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ix = max(0.0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


class Tracker:
    def __init__(self, *, high: float = 0.5, low: float = 0.15, min_iou: float = 0.1, max_center_jump: float = 1.5,
                 min_hits: int = 2, max_lost_s: float = 1.0, ball_min_score: float = 0.3, ball_speed: float = 0.8,
                 distance_weight: float = 0.0, kit_gate: float | None = None, team_gate: bool = False,
                 eiou_expand: float = EIOU_EXPAND, dino_gate: float | None = None, ambiguity_margin: float = AMBIGUITY_MARGIN,
                 pitch_homography=None, max_speed_mps: float = MAX_SPEED_MPS):
        self.high, self.low, self.min_iou, self.max_jump = high, low, min_iou, max_center_jump
        self.team_gate = team_gate                   # True: a track that is clearly one team (or the officials) never takes a detection that is clearly another
        self.kit_gate = kit_gate                     # None: no colour check; else minimum torso-colour similarity for an association
        self.distance_weight = distance_weight       # 0: IoU only; > 0: IoU blended with centre distance (sparse sampling, small players)
        self.ball_speed = ball_speed                 # frame widths per second the ball may travel between samples (a hard shot ~0.6)
        self.eiou_expand = eiou_expand        # 0: plain IoU, as before U.2; > 0: Deep-EIoU association score
        self.dino_gate = dino_gate              # None: no appearance gate (zero cost); else the cosine below which a match is forbidden
        self.ambiguity_margin = ambiguity_margin
        self.dino_stats = {"calls": 0, "forbids": 0, "ambiguous": 0}   # U.2: how often the gate was consulted / forbade (0 calls = it never ran)
        self.pitch_homography = pitch_homography  # U.4: 3x3 pitch metres -> normalised picture, or None (gate off)
        self.max_speed_mps = max_speed_mps
        self.pitch_stats = {"gated": 0, "checked": 0}  # U.4: pitch-plane pair-checks run / matches forbidden (0 = it never ran)
        self.min_hits, self.max_lost_us, self.ball_min = min_hits, int(max_lost_s * 1_000_000), ball_min_score
        self.active: list[Track] = []
        self.finished: list[Track] = []
        self.next_number = 1
        self.shot_number = 0
        self.last_pts: int | None = None

    # ------------------------------------------------------------------ Kalman (constant velocity, dt = seconds between samples)
    def _init(self, t: Track, d: Detection) -> None:
        t.state = np.concatenate([_xywh_to_z(d), np.zeros(4)])
        s = max(d.h, 1e-3)
        t.cov = np.diag([(0.1 * s) ** 2, (0.1 * s) ** 2, 0.01, (0.1 * s) ** 2, (1.0 * s) ** 2, (1.0 * s) ** 2, 0.001, (0.5 * s) ** 2])

    @staticmethod
    def _F(dt: float) -> np.ndarray:
        f = np.eye(8)
        f[:4, 4:] = np.eye(4) * dt
        return f

    def _predict(self, t: Track, dt: float) -> tuple[float, float, float, float]:
        f = self._F(dt)
        h = max(t.state[3], 1e-3)
        q = np.diag([(0.05 * h) ** 2, (0.05 * h) ** 2, 1e-4, (0.05 * h) ** 2, (0.5 * h) ** 2, (0.5 * h) ** 2, 1e-5, (0.1 * h) ** 2]) * max(dt, 1e-3)
        t.state = f @ t.state
        t.cov = f @ t.cov @ f.T + q
        t.state[3] = max(t.state[3], 1e-3)
        t.state[2] = max(t.state[2], 0.05)
        return _z_to_xywh(t.state)

    @staticmethod
    def _update(t: Track, d: Detection) -> None:
        hmat = np.zeros((4, 8))
        hmat[:4, :4] = np.eye(4)
        h = max(d.h, 1e-3)
        r = np.diag([(0.05 * h) ** 2, (0.05 * h) ** 2, 0.01, (0.05 * h) ** 2])
        y = _xywh_to_z(d) - hmat @ t.state
        s = hmat @ t.cov @ hmat.T + r
        k = t.cov @ hmat.T @ np.linalg.inv(s)
        t.state = t.state + k @ y
        t.cov = (np.eye(8) - k @ hmat) @ t.cov

    # ------------------------------------------------------------------ pitch-plane Kalman (U.4, metres)
    @staticmethod
    def _pitch_init(t: Track, pos: tuple[float, float]) -> None:
        """Start the pitch filter at a measured feet position, velocity unknown (wide prior: a player may already be running)."""
        t.pitch_state = np.array([pos[0], pos[1], 0.0, 0.0])
        t.pitch_cov = np.diag([PITCH_MEAS_STD_M ** 2, PITCH_MEAS_STD_M ** 2, 3.0 ** 2, 3.0 ** 2])
        t.pitch_pos = pos

    @staticmethod
    def _pitch_predict(t: Track, dt: float) -> None:
        """Constant-velocity prediction in pitch metres (nothing to predict without a state, or with no time passed)."""
        if t.pitch_state is None or dt <= 0:
            return
        f = np.eye(4)
        f[0, 2] = f[1, 3] = dt
        a = PITCH_ACCEL_STD
        q = a * a * np.array([[dt ** 4 / 4, 0, dt ** 3 / 2, 0], [0, dt ** 4 / 4, 0, dt ** 3 / 2],
                              [dt ** 3 / 2, 0, dt ** 2, 0], [0, dt ** 3 / 2, 0, dt ** 2]])
        t.pitch_state = f @ t.pitch_state
        t.pitch_cov = f @ t.pitch_cov @ f.T + q

    @staticmethod
    def _pitch_update(t: Track, pos: tuple[float, float] | None) -> None:
        """Correct the pitch filter with a measured feet position; None (no calibration, feet off the pitch) leaves it alone."""
        if pos is None:
            return
        if t.pitch_state is None:
            Tracker._pitch_init(t, pos)
            return
        hmat = np.zeros((2, 4))
        hmat[0, 0] = hmat[1, 1] = 1.0
        r = np.diag([PITCH_MEAS_STD_M ** 2, PITCH_MEAS_STD_M ** 2])
        y = np.array(pos) - hmat @ t.pitch_state
        s = hmat @ t.pitch_cov @ hmat.T + r
        k = t.pitch_cov @ hmat.T @ np.linalg.inv(s)
        t.pitch_state = t.pitch_state + k @ y
        t.pitch_cov = (np.eye(4) - k @ hmat) @ t.pitch_cov
        t.pitch_pos = pos

    @staticmethod
    def track_pitch_speed(t: Track) -> float | None:
        """The track's smoothed pitch-plane speed (m/s) from its Kalman velocity, or None before it is calibrated."""
        return None if t.pitch_state is None else float(np.hypot(t.pitch_state[2], t.pitch_state[3]))

    def _pitch_pos(self, d: Detection) -> tuple[float, float] | None:
        """The feet position (metres) of a detection under this tracker's homography, or None (gate off / unplaceable)."""
        return None if self.pitch_homography is None else feet_pitch_position(self.pitch_homography, (d.x, d.y, d.w, d.h))

    # ------------------------------------------------------------------ association
    def _associate(self, tracks: list[Track], preds: list[tuple], dets: list[Detection], label: str = "PERSON",
                   dt: float = 0.0, feats: list | None = None, teams: list | None = None,
                   app_fn=None) -> tuple[list[tuple[int, int, float]], set[int], set[int]]:
        if not tracks or not dets:
            return [], set(range(len(tracks))), set(range(len(dets)))
        cost = np.ones((len(tracks), len(dets)))
        iou_mat = np.zeros((len(tracks), len(dets)))     # plain IoU, for the U.2 ambiguity check (the cost uses the expanded IoU)
        for i, p in enumerate(preds):
            pc = (p[0] + p[2] / 2, p[1] + p[3] / 2)
            for j, d in enumerate(dets):
                dist = np.hypot(pc[0] - (d.x + d.w / 2), pc[1] - (d.y + d.h / 2))
                if label == "BALL":
                    # the ball is a few pixels wide and moves many of its own sizes between samples: boxes rarely overlap, so it is
                    # associated by distance within how far a ball can travel in the time between the two samples
                    gate = self.ball_speed * dt + 3 * max(p[3], d.h, 0.005)
                    if dist <= gate:
                        cost[i, j] = min(0.999, dist / gate)
                    continue
                jump = dist / max(p[3], d.h, 1e-3)
                ov = _iou(p, (d.x, d.y, d.w, d.h))
                iou_mat[i, j] = ov
                sim = _eiou(p, (d.x, d.y, d.w, d.h), self.eiou_expand)     # Deep-EIoU (U.2): expanded boxes still score
                if self.distance_weight > 0:
                    # a small player who moved more than his own width between samples has IoU 0 with the prediction although
                    # he is obviously the same box: the centre distance (in body heights) keeps him associated
                    size = min(p[3], d.h) / max(p[3], d.h, 1e-6)
                    if jump <= self.max_jump and size >= 0.5:
                        score = (1 - self.distance_weight) * sim + self.distance_weight * (1 - jump / self.max_jump)
                        if score > 0.05:
                            cost[i, j] = 1 - score
                elif sim >= self.min_iou and jump <= self.max_jump:
                    cost[i, j] = 1 - sim
        if self.kit_gate is not None and feats is not None and label == "PERSON":
            for i, t in enumerate(tracks):
                if t.feat is None:
                    continue
                for j, f in enumerate(feats):
                    if f is not None and cost[i, j] < 1 and float(np.dot(t.feat, f)) < self.kit_gate:
                        cost[i, j] = 1.0                           # a different shirt: not this track
        if self.team_gate and teams is not None and label == "PERSON":
            for i, t in enumerate(tracks):
                c = self.track_team(t)
                if c is None:
                    continue
                for j, d in enumerate(teams):
                    if d is not None and d != c:
                        cost[i, j] = 1.0                           # another team (or the referee): never this track
        if label == "PERSON" and self.pitch_homography is not None and dt > 0:
            # U.4: the biomechanical gate. It asks, from where the track last was on the pitch (not from the
            # image-plane prediction, so a wrong prediction can neither waive it nor trigger it), could a player
            # have run to this box in dt? Faster than max_speed_mps is not a player — it is another player,
            # or a detector jump — so the match is forbidden. It only forbids; it never creates an association.
            # A detection whose feet cannot be placed (off the pitch) is never gated: unmeasured beats wrong.
            for i, t in enumerate(tracks):
                if t.pitch_pos is None:
                    continue
                for j, d in enumerate(dets):
                    if cost[i, j] >= 1:
                        continue
                    pp = self._pitch_pos(d)
                    if pp is None:
                        continue
                    self.pitch_stats["checked"] += 1
                    if float(np.hypot(pp[0] - t.pitch_pos[0], pp[1] - t.pitch_pos[1])) / dt > self.max_speed_mps:
                        cost[i, j] = 1.0
                        self.pitch_stats["gated"] += 1
        rows, cols = linear_sum_assignment(cost)
        matches = [(int(r), int(c), 1 - float(cost[r, c])) for r, c in zip(rows, cols) if cost[r, c] < 1]
        if label == "PERSON" and app_fn is not None and self.dino_gate is not None:
            matches = self._dino_arbitrate(tracks, preds, dets, cost, iou_mat, matches, app_fn)
        return matches, set(range(len(tracks))) - {m[0] for m in matches}, set(range(len(dets))) - {m[1] for m in matches}

    def _ambiguous(self, cost: np.ndarray, iou_mat: np.ndarray, preds: list[tuple], i: int, j: int) -> bool:
        """Is match (i, j) too close to call on motion alone (U.2)? A rival candidate nearly as good (an eligible cost
        within the margin — an ineligible rival is no alternative), or this track's prediction mutually overlapping
        another track's prediction (a crossing: the predictions themselves may have swapped, however confident each
        single match looks). A low IoU alone is NOT ambiguous: a fast small player normally scores low, and with no
        rival there is nothing for the gate to choose between — forbidding his only match would only fragment the track."""
        c = float(cost[i, j])
        alts = [float(v) for k, v in enumerate(cost[i]) if k != j and v < 1.0] + \
               [float(v) for k, v in enumerate(cost[:, j]) if k != i and v < 1.0]
        if alts and min(alts) - c <= self.ambiguity_margin:
            return True
        for k, p in enumerate(preds):
            if k != i and _iou(preds[i], p) >= TRACK_OVERLAP_IOU:
                return True
        return False

    def _dino_arbitrate(self, tracks: list[Track], preds: list[tuple], dets: list[Detection], cost: np.ndarray,
                        iou_mat: np.ndarray, matches: list[tuple[int, int, float]], app_fn) -> list[tuple[int, int, float]]:
        """One arbitration round (U.2): for each ambiguous match, ask the appearance provider for the cosine between that
        track and that detection. Below `dino_gate` the pair is forbidden and the Hungarian is re-run; anything else
        (a high cosine, or None = unknown) leaves the match alone — the gate only forbids, it never creates an association.
        A provider that raises is treated as unknown: appearance is evidence, and a failing model must not kill tracking."""
        forbid = []
        for i, j, _a in matches:
            if not self._ambiguous(cost, iou_mat, preds, i, j):
                continue
            self.dino_stats["ambiguous"] += 1
            self.dino_stats["calls"] += 1
            try:
                cos = app_fn(tracks[i], dets[j])
            except Exception:                    # noqa: BLE001 - see docstring above
                cos = None
            if cos is None:
                continue
            if cos < self.dino_gate:
                forbid.append((i, j))
                self.dino_stats["forbids"] += 1
        if not forbid:
            return matches
        for i, j in forbid:
            cost[i, j] = 1.0
        rows, cols = linear_sum_assignment(cost)
        return [(int(r), int(c), 1 - float(cost[r, c])) for r, c in zip(rows, cols) if cost[r, c] < 1]

    @staticmethod
    def track_team(t: Track, min_votes: int = 3, min_share: float = 0.7) -> int | None:
        """What the track clearly is so far (0 / 1 team, 2 officials), from its own per-frame calls; None until it has enough and they agree."""
        total = sum(t.votes)
        if total < min_votes:
            return None
        k = max(range(3), key=lambda i: t.votes[i])
        return k if t.votes[k] / total >= min_share else None

    def _record(self, t: Track, d: Detection, frame_index: int, pts_us: int, association: float, team: int | None = None) -> None:
        t.observations.append(Observation(frame_index, pts_us, d.x, d.y, d.w, d.h, d.score, round(association, 4), team))
        if team is not None:
            t.votes[team] += 1
        t.hits += 1
        t.misses = 0
        t.last_pts_us = pts_us
        if t.hits >= self.min_hits:
            t.confirmed = True

    @staticmethod
    def _feat(t: Track, f) -> None:
        if f is None:
            return
        t.feat = f if t.feat is None else _unit(0.8 * t.feat + 0.2 * f)

    def end_all(self) -> None:
        """A camera cut (or the end of the video): every open track ends here."""
        for t in self.active:
            if t.confirmed:
                self.finished.append(t)
        self.active = []
        self.shot_number += 1
        self.last_pts = None

    def update(self, frame_index: int, pts_us: int, detections: list[Detection], camera_shift: tuple[float, float] | None = None,
               features: list | None = None, teams: dict | None = None, follow: dict | None = None,
               appearance_fn=None) -> None:
        """`camera_shift`: the picture's global translation since the previous sample (normalised dx, dy; from frames.camera_shift),
        added to every prediction so a camera pan is not mistaken for every player running the same way.
        `follow`: {id(track): (cx, cy)} where that track's picture was followed to through the frames since the previous sample
        (vie_worker.follow); it replaces the constant-velocity guess of the centre (camera movement included), so crossing players
        keep their own tracks.
        `appearance_fn`: optional (track, detection) -> cosine | None (U.2): the on-demand DINOv2 appearance provider, called
        only for ambiguous PERSON matches; None disables the gate (the default: no model call, no behaviour change)."""
        dt = 0.0 if self.last_pts is None else (pts_us - self.last_pts) / 1_000_000
        self.last_pts = pts_us
        for label in ("PERSON", "BALL"):
            tracks = [t for t in self.active if t.label == label]
            fmap = {id(d): f for d, f in zip(detections, features)} if features is not None else {}
            dets = [d for d in detections if d.label == label]
            if label == "BALL":
                dets = sorted((d for d in dets if d.score >= self.ball_min), key=lambda d: d.score, reverse=True)[:1]
            preds = []
            for t in tracks:
                self._predict(t, dt)
                if label == "PERSON":
                    self._pitch_predict(t, dt)
                seen = follow.get(id(t)) if follow else None
                if seen is not None:
                    t.state[0], t.state[1] = seen
                elif camera_shift:
                    t.state[0] += camera_shift[0]
                    t.state[1] += camera_shift[1]
                preds.append(_z_to_xywh(t.state))
            high_thr = self.ball_min if label == "BALL" else self.high          # the ball is rarely detected with a high score
            high = [d for d in dets if d.score >= high_thr]
            low = [d for d in dets if self.low <= d.score < high_thr]
            fh, fl = [fmap.get(id(d)) for d in high], [fmap.get(id(d)) for d in low]
            th, tl = ([teams.get(id(d)) for d in high], [teams.get(id(d)) for d in low]) if teams is not None else (None, None)
            m1, free_t, free_d = self._associate(tracks, preds, high, label, dt, fh if fmap else None, th, app_fn=appearance_fn)
            for i, j, a in m1:
                self._update(tracks[i], high[j]); self._record(tracks[i], high[j], frame_index, pts_us, a, th[j] if th else None); self._feat(tracks[i], fh[j] if fmap else None)
                if label == "PERSON":
                    self._pitch_update(tracks[i], self._pitch_pos(high[j]))
            rest = sorted(free_t)
            m2, free_t2, _ = self._associate([tracks[i] for i in rest], [preds[i] for i in rest], low, label, dt, fl if fmap else None, tl,
                                             app_fn=appearance_fn)
            for i, j, a in m2:
                t = tracks[rest[i]]
                self._update(t, low[j]); self._record(t, low[j], frame_index, pts_us, a, tl[j] if tl else None); self._feat(t, fl[j] if fmap else None)
                if label == "PERSON":
                    self._pitch_update(t, self._pitch_pos(low[j]))
            for i in (rest[k] for k in free_t2):
                tracks[i].misses += 1
            for j in sorted(free_d):                               # new tentative tracks from unmatched confident detections
                d = high[j]
                t = Track(self.next_number, label, self.shot_number)
                self.next_number += 1
                self._init(t, d)
                self._record(t, d, frame_index, pts_us, 1.0, th[j] if th else None)
                self._feat(t, fh[j] if fmap else None)
                if label == "PERSON":
                    pos = self._pitch_pos(d)
                    if pos is not None:
                        self._pitch_init(t, pos)
                self.active.append(t)
        keep = []
        for t in self.active:
            gone = pts_us - t.last_pts_us > self.max_lost_us
            if gone or (not t.confirmed and t.misses > 0):
                if t.confirmed:
                    self.finished.append(t)
            else:
                keep.append(t)
        self.active = keep

    def results(self) -> list[Track]:
        """Confirmed tracks, renumbered 1..n in order of first appearance (numbers are stable within the run)."""
        self.end_all()
        tracks = sorted(self.finished, key=lambda t: (t.observations[0].pts_us, t.number))
        for i, t in enumerate(tracks, 1):
            t.number = i
        return tracks


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def torso_colour(rgb: np.ndarray, d: Detection) -> np.ndarray | None:
    """Hellinger-normalised 8 hue x 3 saturation histogram of the torso (20-55 % of the box height, middle 60 % of its width);
    grass-coloured pixels are left out. None when the torso is too small to say anything (< 40 pixels)."""
    H, W = rgb.shape[:2]
    x0, x1 = int((d.x + d.w * 0.2) * W), int((d.x + d.w * 0.8) * W) + 1
    y0, y1 = int((d.y + d.h * 0.2) * H), int((d.y + d.h * 0.55) * H) + 1
    patch = rgb[max(0, y0):min(H, y1), max(0, x0):min(W, x1)].reshape(-1, 3).astype(np.float32) / 255
    if len(patch) < 40:
        return None
    r, g, b = patch[:, 0], patch[:, 1], patch[:, 2]
    mx, mn = patch.max(axis=1), patch.min(axis=1)
    dlt = mx - mn + 1e-6
    hue = np.where(mx == r, ((g - b) / dlt) % 6, np.where(mx == g, (b - r) / dlt + 2, (r - g) / dlt + 4)) / 6
    sat = np.where(mx > 0, dlt / (mx + 1e-6), 0)
    keep = ~((hue > 0.17) & (hue < 0.47) & (sat > 0.22))                 # not grass
    if keep.sum() < 20:
        return None
    # dark / white / grey kits have no reliable hue: their own bins by brightness
    hb = np.where(sat[keep] < 0.2, 8 + np.minimum(2, (mx[keep] * 3).astype(int)), np.minimum(7, (hue[keep] * 8).astype(int)))
    sb = np.where(sat[keep] < 0.2, 0, np.minimum(2, (sat[keep] * 3).astype(int)))
    hist = np.bincount(hb * 3 + sb, minlength=33).astype(np.float64)
    return _unit(np.sqrt(hist / hist.sum()))
