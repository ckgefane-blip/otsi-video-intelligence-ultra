"""3D parabolic ball flight (U.9): the ball in the air is not a player.

A ball in flight, air resistance aside, moves at constant horizontal velocity
while its height follows a parabola under gravity: P(t) = P0 + V*t in the
ground plane, z(t) = z0 + vz*t - g*t^2/2 above it (g = 9.81 m/s^2). Projected
into the picture, that 3D parabola is a conic; over one flight segment in a
broadcast view it is well approximated by a parabola in picture coordinates
(x(t), y(t) both quadratic in t), whose picture-y acceleration points
downward (y grows downward in the picture). A boot, a rolling ball and a
running player do none of that: they move on the ground, at roughly constant
velocity, with no sustained downward acceleration.

The fit is done in the picture, where the ball is observed, because
recovering the ball's true height needs the camera centre, and the pitch
homography alone does not determine it (it fixes the ground plane, not where
the camera sits above it). No height is invented here, and no calibration is
needed: the fit is self-contained, from the observed positions alone. The
gravity check - a downward picture-y acceleration - is the 3D signature that
survives the projection. (A full 3D reconstruction, height included, would
need the camera centre from a calibrated camera; that is a follow-up, not
claimed here.)

Uses, all behind `use_flight` (off by default):

  * prediction: a tracklet that is in flight predicts its next position from
    its arc, not from its tangent. At 6 fps a smooth arc is nearly straight
    between samples, so this matters most when frames are missed or the
    sample rate is low (the default analysis runs at 2 fps): there the
    tangent has drifted a long way from the arc and a boot sitting near the
    tangent would win the association instead of the ball.
  * joining: in `ball.best_paths` a piece that continues a flight must lie on
    the flight's parabola; one that does not is a restart, not the same
    flight. A kick or a bounce starts a new flight, so the old parabola no
    longer applies - the join check correctly calls that a restart too, and
    no INFERRED positions are invented across it.
  * evidence: a piece whose points fit a flight earns FLIGHT_BONUS in the
    path search. A sustained gravity-consistent arc is strong evidence of
    the ball (boots and players do not fly); the bonus is a tuning constant
    to be calibrated on labelled Sukhum flights, like DINO_REJECT_COS was
    calibrated on data in U.2 - it is not a measured threshold. Sized at
    about five detections' net score: a boot piece displacing the ball's
    points gains about 0.8 in the synthetic scenes, so the bonus has to
    clear that to matter at all; at 1.0 the decision was a knife-edge.

A rolling ball is not a flight (its vertical acceleration is ~0), and neither
is a jittering boot (its points do not fit any parabola). A flight needs at
least FLIGHT_MIN_POINTS observations; fewer than that, or a fit that does not
clear the checks, is not a flight - unknown beats wrong.

U.10 (bounce/rolling handover): a flight ends in a bounce, and the ball then
rolls - a roll is the same constant-velocity run a flight is not, so `is_roll`
is the complement here: a tight quadratic fit with (nearly) no picture-y
acceleration. A roll on its own is not ball evidence (a boot rolls along the
ground too, in the picture) - it only matters as the continuation of a flight:
a roll piece that starts where a flight landed is the same ball across the
bounce. And a boot is told from a rolling ball not by its motion but by its
glue: it keeps a (nearly) fixed offset from its player's foot, while a rolling
ball separates from the player - see `ball.is_glued`, which needs the foot
offsets `ball.plausible` records on each candidate.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

FLIGHT_MIN_POINTS = 4       # a parabola has 3 coefficients per axis; 4 points leave one degree of freedom to judge the fit
FLIGHT_MAX_RESIDUAL = 0.004  # picture widths RMS: detection jitter is ~0.001, so a real arc fits far inside this
FLIGHT_MIN_ACCEL = 0.05     # picture widths/s^2 downward in y: a real flight curves (a ball 20-60 m away shows 0.14-0.42,
                            # the synthetic arcs here 0.12-0.16). The floor is the defence against SPURIOUS flights: a
                            # straight-line boot plus detection jitter fits some parabola, and the fitted acceleration of
                            # that parabola is pure noise - 0.021 widths/s^2 on the synthetic boot (jitter sigma 0.001),
                            # i.e. the noise scale of a quadratic fit over 6 points. 0.05 sits ~2.4x above that noise and
                            # ~2.4x below the smallest real flight here. It is a tuning constant: on noisier real detections
                            # the noise scale grows, so the floor must be calibrated on labelled Sukhum flights (a missed
                            # flight only loses the bonus - the old behaviour - while a spurious one can mislead the path
                            # search, so err high). Assumes a roughly level broadcast camera: under a steep top-down view
                            # gravity projects mostly along the optical axis and little into picture-y.
FLIGHT_LINK_TOL = 0.012     # picture widths: how close a continuation must lie to the flight's parabola (TRACK_SLACK scale)
FLIGHT_BONUS = 1.5          # path-search bonus per flight piece: about five detections' net score, roughly two-thirds of a
                            # 6-point piece's own weight (see module docstring); a tuning constant, to calibrate on labelled
                            # Sukhum flights. It has to clear the weight a boot piece gains by displacing the ball's points
                            # (about 0.8 in the synthetic scenes): at 1.0 the decision was a knife-edge, at 1.5 it is not.
ROLL_MAX_ACCEL = 0.05       # picture widths/s^2: a roll moves at (nearly) constant velocity on the ground, so its fitted
                            # picture-y acceleration is ~0 - the noise scale of a quadratic fit over 6 points (up to 0.02
                            # on the synthetic boot in U.9, 0.019 on a boot piece here). A flight's is 0.12-0.42 (gravity).
                            # 0.05 sits ~2.5x above the noise and ~2.4x below the smallest real flight here, the same
                            # margin as FLIGHT_MIN_ACCEL - it is a tuning constant, to calibrate on labelled Sukhum
                            # flights. A roll that misses the cut only loses the handover bonus in U.10, never a position.
GRAVITY_MPS2 = 9.81         # recorded for the model above; the fit itself needs no gravity value (it measures the acceleration)


@dataclass(frozen=True)
class Flight:
    """A fitted parabola: x(t) and y(t) are quadratics in seconds since t0_us."""
    cx: tuple[float, float, float]   # x(t) = cx[0] + cx[1]*t + cx[2]*t^2 (normalised picture x)
    cy: tuple[float, float, float]   # y(t) = cy[0] + cy[1]*t + cy[2]*t^2 (normalised picture y, growing downward)
    t0_us: int                       # the time origin (the first point's pts_us)
    n: int                           # how many points the fit used
    rms: float                       # RMS residual, picture widths (y scaled by 1/aspect, as in ball.dist)
    aspect: float = 16 / 9           # width / height of the frame the fit came from (for the acceleration units)

    @property
    def accel_y(self) -> float:
        """The picture-y acceleration, widths/s^2: positive is downward (gravity's direction in the picture).
        cy is fitted in normalised heights, so it is divided by the aspect to read in picture widths."""
        return 2.0 * self.cy[2] / self.aspect

    def predict(self, pts_us: int) -> tuple[float, float]:
        t = (pts_us - self.t0_us) / 1_000_000
        return (self.cx[0] + self.cx[1] * t + self.cx[2] * t * t,
                self.cy[0] + self.cy[1] * t + self.cy[2] * t * t)


def _times(points) -> np.ndarray:
    return np.array([(p.pts_us - points[0].pts_us) / 1_000_000 for p in points], float)


def fit_flight(points, aspect: float) -> Flight | None:
    """Least-squares quadratic fits of x(t) and y(t) to `points` (Cand / BallPoint
    / anything with pts_us, x, y), or None when there are too few points, the
    times do not determine a fit, or the fit fails. No validation here: call
    `is_flight` for that."""
    pts = list(points)
    if len(pts) < FLIGHT_MIN_POINTS:
        return None
    t = _times(pts)
    if float(t[-1] - t[0]) <= 0 or len(set(t)) < len(t):
        return None
    a = np.c_[np.ones(len(t)), t, t * t]
    try:
        cx, *_ = np.linalg.lstsq(a, np.array([p.x for p in pts]), rcond=None)
        cy, *_ = np.linalg.lstsq(a, np.array([p.y for p in pts]), rcond=None)
    except np.linalg.LinAlgError:                                   # a fit that cannot be computed is not a flight
        return None
    if not (np.isfinite(cx).all() and np.isfinite(cy).all()):
        return None
    dx = np.array([p.x for p in pts]) - a @ cx
    dy = (np.array([p.y for p in pts]) - a @ cy) / aspect
    rms = float(np.sqrt(np.mean(dx * dx + dy * dy)))
    if not np.isfinite(rms):
        return None
    return Flight(tuple(float(v) for v in cx), tuple(float(v) for v in cy), int(pts[0].pts_us), len(pts), rms, float(aspect))


def is_flight(flight: Flight | None) -> bool:
    """Is this fitted parabola a ball in flight? Small residual (the points
    really lie on an arc) and a downward picture-y acceleration clearly above
    zero (gravity, not a roll and not jitter)."""
    if flight is None:
        return False
    return flight.n >= FLIGHT_MIN_POINTS and flight.rms <= FLIGHT_MAX_RESIDUAL and flight.accel_y >= FLIGHT_MIN_ACCEL


def flight_of(points, aspect: float) -> Flight | None:
    """`fit_flight` plus the validation: the flight of these points, or None."""
    f = fit_flight(points, aspect)
    return f if is_flight(f) else None


def is_roll(points, aspect: float) -> bool:
    """Is this run of points a ball rolling on the ground? A constant-velocity run: the quadratic fit is tight (the
    points really lie on a straight line) and the picture-y acceleration is ~0 (no gravity) - as opposed to a flight,
    whose accel_y is 0.12+. A jittering boot passes this test too: it is a roll-shaped run of points, and only the
    glue test in ball.py (a boot stays glued to one player's feet) tells it from a rolling ball. A roll needs at
    least FLIGHT_MIN_POINTS observations; fewer, or a fit that does not clear the checks, is not a roll - unknown
    beats wrong."""
    f = fit_flight(points, aspect)
    if f is None:
        return False
    return f.n >= FLIGHT_MIN_POINTS and f.rms <= FLIGHT_MAX_RESIDUAL and abs(f.accel_y) <= ROLL_MAX_ACCEL


def deviation(flight: Flight, pts_us: int, x: float, y: float, aspect: float) -> float:
    """How far (picture widths) a point at (pts_us, x, y) lies from the flight's
    parabola at that moment."""
    px, py = flight.predict(pts_us)
    return float(np.hypot(x - px, (y - py) / aspect))
