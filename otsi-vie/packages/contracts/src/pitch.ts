/**
 * Pitch calibration (Blueprint 03_MEDIA_CV_TRACKING step 8, `geometry`): where on the pitch, in metres, a point of the picture is.
 *
 * The pitch template, the named landmarks and the homography maths here MIRROR `services/worker/vie_worker/geometry.py` (the worker fits and
 * follows the camera; the API validates the person's clicks and places players; the web app draws the pitch over the picture while the person
 * marks landmarks). A parity test (`apps/api/test/pitch.api.test.ts` against `tests/fixtures/pitch_parity.json`, written by the worker's tests)
 * fails if the two implementations drift apart.
 *
 * Coordinates: pitch metres with the origin at the centre spot, x along the length and y across the width, both increasing right/down as on a
 * top-down diagram. Picture coordinates are NORMALISED (x / frame width, y / frame height), the same as the boxes.
 */
import { z } from "zod";

export const DEFAULT_PITCH_LENGTH_M = 105;
export const DEFAULT_PITCH_WIDTH_M = 68;
const PENALTY_DEPTH = 16.5, PENALTY_HALF = 20.16, SIX_DEPTH = 5.5, SIX_HALF = 9.16, SPOT = 11.0, CIRCLE_R = 9.15;

export type Pt = [number, number];
export type Mat3 = number[][];

/** Named points a person can recognise on the pitch and in the picture (metres). `left`/`right` are the ends of the top-down diagram, `top`/`bottom` its sides. */
export function pitchLandmarks(length = DEFAULT_PITCH_LENGTH_M, width = DEFAULT_PITCH_WIDTH_M): Record<string, Pt> {
  const hl = length / 2, hw = width / 2;
  const out: Record<string, Pt> = {
    "centre spot": [0, 0], "halfway line, top touchline": [0, -hw], "halfway line, bottom touchline": [0, hw],
    "centre circle, top": [0, -CIRCLE_R], "centre circle, bottom": [0, CIRCLE_R],
  };
  for (const [end, s] of [["left", -1], ["right", 1]] as const) {
    const g = s * hl;
    out[`${end} goal line, top corner`] = [g, -hw];
    out[`${end} goal line, bottom corner`] = [g, hw];
    out[`${end} penalty area, top corner on the goal line`] = [g, -PENALTY_HALF];
    out[`${end} penalty area, bottom corner on the goal line`] = [g, PENALTY_HALF];
    out[`${end} penalty area, top front corner`] = [g - s * PENALTY_DEPTH, -PENALTY_HALF];
    out[`${end} penalty area, bottom front corner`] = [g - s * PENALTY_DEPTH, PENALTY_HALF];
    out[`${end} six-yard box, top corner on the goal line`] = [g, -SIX_HALF];
    out[`${end} six-yard box, bottom corner on the goal line`] = [g, SIX_HALF];
    out[`${end} six-yard box, top front corner`] = [g - s * SIX_DEPTH, -SIX_HALF];
    out[`${end} six-yard box, bottom front corner`] = [g - s * SIX_DEPTH, SIX_HALF];
    out[`${end} penalty spot`] = [g - s * SPOT, 0];
  }
  return out;
}

const seg = (a: Pt, b: Pt, step: number): Pt[] => {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step) + 1);
  return Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)] as Pt);
};
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, step: number): Pt[] => {
  const n = Math.max(8, Math.ceil((Math.abs(a1 - a0) * r) / step));
  return Array.from({ length: n }, (_, i) => { const a = a0 + ((a1 - a0) * i) / (n - 1); return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt; });
};

/** The painted lines of the pitch as point lists (metres), one per line: for drawing over the picture. */
export function pitchLines(length = DEFAULT_PITCH_LENGTH_M, width = DEFAULT_PITCH_WIDTH_M, step = 0.5): Record<string, Pt[]> {
  const hl = length / 2, hw = width / 2;
  const lines: Record<string, Pt[]> = {
    "touchline top": seg([-hl, -hw], [hl, -hw], step), "touchline bottom": seg([-hl, hw], [hl, hw], step),
    "left goal line": seg([-hl, -hw], [-hl, hw], step), "right goal line": seg([hl, -hw], [hl, hw], step),
    "halfway line": seg([0, -hw], [0, hw], step), "centre circle": arc(0, 0, CIRCLE_R, 0, 2 * Math.PI, step),
  };
  for (const [end, s] of [["left", -1], ["right", 1]] as const) {
    const g = s * hl, px = g - s * PENALTY_DEPTH, sx = g - s * SIX_DEPTH;
    lines[`${end} penalty area front`] = seg([px, -PENALTY_HALF], [px, PENALTY_HALF], step);
    lines[`${end} penalty area top`] = seg([g, -PENALTY_HALF], [px, -PENALTY_HALF], step);
    lines[`${end} penalty area bottom`] = seg([g, PENALTY_HALF], [px, PENALTY_HALF], step);
    lines[`${end} six-yard front`] = seg([sx, -SIX_HALF], [sx, SIX_HALF], step);
    lines[`${end} six-yard top`] = seg([g, -SIX_HALF], [sx, -SIX_HALF], step);
    lines[`${end} six-yard bottom`] = seg([g, SIX_HALF], [sx, SIX_HALF], step);
    const spot = g - s * SPOT, a = Math.acos(Math.min(1, Math.max(-1, (PENALTY_DEPTH - SPOT) / CIRCLE_R))), c = s < 0 ? 0 : Math.PI;
    lines[`${end} penalty arc`] = arc(spot, 0, CIRCLE_R, c - a, c + a, step);
  }
  return lines;
}

// ------------------------------------------------------------------ homography maths
export function project(H: Mat3, p: Pt): Pt | null {
  const w = H[2]![0]! * p[0] + H[2]![1]! * p[1] + H[2]![2]!;
  if (!(w > 1e-9)) return null;
  return [(H[0]![0]! * p[0] + H[0]![1]! * p[1] + H[0]![2]!) / w, (H[1]![0]! * p[0] + H[1]![1]! * p[1] + H[1]![2]!) / w];
}

export function invert(M: Mat3): Mat3 | null {
  const [a, b, c] = M[0] as [number, number, number], [d, e, f] = M[1] as [number, number, number], [g, h, i] = M[2] as [number, number, number];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}

export function unproject(H: Mat3, p: Pt): Pt | null {
  const inv = invert(H);
  return inv ? project(inv, p) : null;
}

const mul = (A: Mat3, B: Mat3): Mat3 => A.map((r) => [0, 1, 2].map((j) => r[0]! * B[0]![j]! + r[1]! * B[1]![j]! + r[2]! * B[2]![j]!));

function normalisation(p: Pt[]): { pts: Pt[]; T: Mat3 } {
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  const mean = p.reduce((s, q) => s + Math.hypot(q[0] - cx, q[1] - cy), 0) / p.length;
  const s = Math.SQRT2 / Math.max(mean, 1e-12);
  return { pts: p.map((q) => [s * (q[0] - cx), s * (q[1] - cy)] as Pt), T: [[s, 0, -s * cx], [0, s, -s * cy], [0, 0, 1]] };
}

/** Gaussian elimination with partial pivoting for the 8 x 8 normal equations; null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    if (Math.abs(M[p]![c]!) < 1e-12) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = c + 1; r < n; r++) { const f = M[r]![c]! / M[c]![c]!; for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!; }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r]![n]!; for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!; x[r] = s / M[r]![r]!; }
  return x;
}

/** Normalised direct linear transform (h33 = 1, least squares through the normal equations) from >= 4 point pairs: dst ~ H src. null if undetermined. */
export function dlt(src: Pt[], dst: Pt[]): Mat3 | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  const s = normalisation(src), d = normalisation(dst);
  const AtA = Array.from({ length: 8 }, () => new Array<number>(8).fill(0)), Atb = new Array<number>(8).fill(0);
  const add = (row: number[], rhs: number) => { for (let i = 0; i < 8; i++) { Atb[i]! += row[i]! * rhs; for (let j = 0; j < 8; j++) AtA[i]![j]! += row[i]! * row[j]!; } };
  s.pts.forEach(([x, y], k) => {
    const [u, v] = d.pts[k]!;
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  });
  const h = solve(AtA, Atb);
  if (!h) return null;
  const Hn: Mat3 = [[h[0]!, h[1]!, h[2]!], [h[3]!, h[4]!, h[5]!], [h[6]!, h[7]!, 1]];
  const inv = invert(d.T);
  if (!inv) return null;
  const H = mul(mul(inv, Hn), s.T);
  const k = H[2]![2]!;
  return Math.abs(k) < 1e-14 ? null : H.map((r) => r.map((v) => v / k));
}

/** Smallest / largest spread of a point set: ~0 for points on one line. */
function spread(p: Pt[]): number {
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cy = p.reduce((s, q) => s + q[1], 0) / p.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const q of p) { const x = q[0] - cx, y = q[1] - cy; sxx += x * x; sxy += x * y; syy += y * y; }
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const big = tr / 2 + disc, small = tr / 2 - disc;
  return Math.sqrt(Math.max(0, small) / Math.max(big, 1e-12));
}

export interface PointFit { H: Mat3 | null; rmsPx: number; rmsM: number; mirrored: boolean; collinear: boolean }

/** H from named landmarks matched to places in the picture, with its error; never a fit that is undetermined or mirrored. */
export function fitFromPoints(pitchPts: Pt[], imagePts: Pt[], frameW: number, frameH: number): PointFit {
  if (pitchPts.length < 4 || spread(pitchPts) < 0.02 || spread(imagePts) < 0.02) return { H: null, rmsPx: Infinity, rmsM: Infinity, mirrored: false, collinear: true };
  const H = dlt(pitchPts, imagePts);
  if (!H) return { H: null, rmsPx: Infinity, rmsM: Infinity, mirrored: false, collinear: true };
  let sp = 0, sm = 0;
  pitchPts.forEach((p, i) => {
    const q = project(H, p), b = unproject(H, imagePts[i]!);
    sp += q ? ((q[0] - imagePts[i]![0]) * frameW) ** 2 + ((q[1] - imagePts[i]![1]) * frameH) ** 2 : Infinity;
    sm += b ? (b[0] - p[0]) ** 2 + (b[1] - p[1]) ** 2 : Infinity;
  });
  const c = [[0, 0], [1, 0], [0, 1]].map((p) => project(H, p as Pt));
  const det = c[0] && c[1] && c[2] ? (c[1]![0] - c[0]![0]) * (c[2]![1] - c[0]![1]) - (c[2]![0] - c[0]![0]) * (c[1]![1] - c[0]![1]) : 0;
  return { H, rmsPx: Math.sqrt(sp / pitchPts.length), rmsM: Math.sqrt(sm / pitchPts.length), mirrored: det <= 0, collinear: false };
}

// ------------------------------------------------------------------ the request and what the API returns
export const PitchPointInput = z.object({ landmark: z.string().min(1).max(80), x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export type PitchPointInput = z.infer<typeof PitchPointInput>;
/** A click anywhere on a painted line (a `pitchLines` name): it says the picture point lies on that line, not where along it. Used through the match camera only. */
export const PitchLineInput = z.object({ line: z.string().min(1).max(80), x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export type PitchLineInput = z.infer<typeof PitchLineInput>;
/** Equations a moment's clicks give: two per landmark, one per line click. A moment needs at least this many. */
export const MIN_PITCH_EQUATIONS = 4;
export const pitchEquations = (points: number, lines: number) => 2 * points + lines;

/** Clicks on one moment: 4+ may fix it alone; 2-3 (or 4-5 the white lines cannot confirm) are joined with the video's other moments through the
 * one match camera (worker `camera.solve`), and WAIT until enough moments pin them down. */
export const CreatePitchCalibration = z.object({
  anchor_pts_us: z.number().int().min(0),
  points: z.array(PitchPointInput).min(1).max(24),
  /** clicks anywhere on a line: at least one landmark is still needed, and 2 x landmarks + line clicks >= MIN_PITCH_EQUATIONS (checked by the API) */
  lines: z.array(PitchLineInput).max(16).default([]),
  pitch_length_m: z.number().min(90).max(120).default(DEFAULT_PITCH_LENGTH_M),
  pitch_width_m: z.number().min(45).max(90).default(DEFAULT_PITCH_WIDTH_M),
});
export type CreatePitchCalibration = z.infer<typeof CreatePitchCalibration>;

/** The whole video calibrated by the engine, nobody clicking (ADR-036). The pitch size is the video's (its other moments), else the default. */
export const CreateAutoPitchCalibration = z.object({
  pitch_length_m: z.number().min(90).max(120).optional(),
  pitch_width_m: z.number().min(45).max(90).optional(),
});
export type CreateAutoPitchCalibration = z.infer<typeof CreateAutoPitchCalibration>;

export const PitchCalibration = z.object({
  id: z.string().uuid(),
  video_id: z.string().uuid(),
  anchor_pts_us: z.number().int(),
  /** WAITING: too few clicks for this moment alone; the match camera will settle it once other moments add enough */
  status: z.enum(["QUEUED", "RUNNING", "WAITING", "SUCCEEDED", "FAILED"]),
  /** CLICKS: a person's clicks on one moment; AUTO: the whole video, found by the engine */
  mode: z.enum(["CLICKS", "AUTO"]),
  progress: z.number().nullable(),
  stage_message: z.string().nullable(),
  point_count: z.number().int(),
  /** the landmarks marked in this moment */
  landmarks: z.array(z.string()),
  /** the lines clicked anywhere on, one entry per click */
  lines: z.array(z.string()),
  pitch_length_m: z.number(),
  pitch_width_m: z.number(),
  /** what the worker measured: click error, samples tried and kept; null until it finishes */
  metrics: z.record(z.string(), z.unknown()).nullable(),
  /** the span of the video that now has positions (measured samples only); null when none */
  coverage: z.object({ samples: z.number().int(), first_pts_us: z.number().int().nullable(), last_pts_us: z.number().int().nullable() }),
  failure_code: z.string().nullable(),
  failure_detail: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type PitchCalibration = z.infer<typeof PitchCalibration>;

/** The match camera worked out from the clicks of several moments (the newest of the video). */
export const PitchCamera = z.object({
  id: z.string().uuid(),
  /** where it stands: pitch metres (origin at the centre spot) and height above the pitch */
  position_m: z.tuple([z.number(), z.number()]),
  height_m: z.number(),
  roll_deg: z.number(),
  moments: z.number().int(),
  points: z.number().int(),
  /** how closely it explains the clicks, px of a 1280 px wide frame */
  click_rms_px: z.number(),
  created_at: z.string(),
});
export type PitchCamera = z.infer<typeof PitchCamera>;

/** pitch positions (metres) of a person's feet, or null: not calibrated at that moment, or not placeable on the pitch */
export function feetPosition(H: Mat3, box: { x: number; y: number; w: number; h: number }, length = DEFAULT_PITCH_LENGTH_M, width = DEFAULT_PITCH_WIDTH_M, margin = 6): Pt | null {
  const p = unproject(H, [box.x + box.w / 2, box.y + box.h]);
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  return Math.abs(p[0]) <= length / 2 + margin && Math.abs(p[1]) <= width / 2 + margin ? [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100] : null;
}

// ------------------------------------------------------------------ heat zones (where a player or a team was, from measured pitch positions)
export const HEAT_COLS = 21, HEAT_ROWS = 14;                // 5 m x 4.9 m zones on a 105 x 68 m pitch (scaled with the pitch size)

/** Time spent in each zone of the pitch, from feet positions measured by a pitch calibration only (`seconds` row by row, top-left first,
 * `HEAT_COLS` x `HEAT_ROWS`, x along the length as the pitch diagrams draw it). Never estimated where nothing was measured: `seen_s` is how long
 * the subject was seen at all and `measured_s` how much of that has a pitch position. Teams change ends at half-time; both halves are drawn
 * as filmed (`ends_as_filmed`). */
export const HeatZones = z.object({
  subject: z.object({ kind: z.enum(["TRACK", "KIT_GROUP"]), id: z.string() }),
  length_m: z.number(), width_m: z.number(),
  cols: z.number().int(), rows: z.number().int(),
  seconds: z.array(z.number()),
  seen_s: z.number(), measured_s: z.number(),
  ends_as_filmed: z.literal(true),
});
export type HeatZones = z.infer<typeof HeatZones>;

/** The zone (column, row) of a pitch position, or null outside the pitch. */
export function heatCell(p: Pt, length = DEFAULT_PITCH_LENGTH_M, width = DEFAULT_PITCH_WIDTH_M, cols = HEAT_COLS, rows = HEAT_ROWS): [number, number] | null {
  const c = Math.floor(((p[0] + length / 2) / length) * cols), r = Math.floor(((p[1] + width / 2) / width) * rows);
  return c >= 0 && c < cols && r >= 0 && r < rows ? [c, r] : null;
}

// ------------------------------------------------------------------ team shape (moments where enough of a team stands on a measured pitch)
export const SHAPE_MIN_PLAYERS = 8;                         // a moment counts when at least this many of the team stand on a measured pitch
export const SHAPE_SPAN_M = [70, 50] as const;              // the shape picture: metres around the team's centre (length, width)
export const SHAPE_COLS = 28, SHAPE_ROWS = 20;              // 2.5 m cells

const ShapeStat = z.object({ mean: z.number(), p10: z.number(), p90: z.number() });
/** A team's shape over the moments where at least SHAPE_MIN_PLAYERS of its players were in the picture on a measured pitch (one moment a
 * second). Width / length: extent of those players across / along the pitch; compactness: area of their outline (convex hull, m²);
 * variability: how much that area changes (coefficient of variation). `density`: where players stand relative to the team's centre
 * (SHAPE_COLS x SHAPE_ROWS cells over SHAPE_SPAN_M, row by row): the team's shape without names. Players in the picture only: a team
 * stretched beyond the picture is not seen whole. `not_measured`: what is not measured, and why. */
export const TeamShape = z.object({
  kit_groups: z.array(z.number().int()),
  moments: z.number().int(), seen_moments: z.number().int(), min_players: z.number().int(),
  players_per_moment: z.number().nullable(),
  width_m: ShapeStat.nullable(), length_m: ShapeStat.nullable(), compactness_m2: ShapeStat.nullable(), variability: z.number().nullable(),
  density: z.array(z.number()),
  not_measured: z.record(z.string(), z.string()),
});
export type TeamShape = z.infer<typeof TeamShape>;

/** The convex hull of points, in order (Andrew's monotone chain); fewer than three points come back as given. */
export function convexHull(pts: Pt[]): Pt[] {
  if (pts.length < 3) return [...pts];
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Area (m²) of the convex hull of pitch points; 0 for fewer than three. */
export function hullArea(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  const h = convexHull(pts);
  let a = 0;
  for (let i = 0; i < h.length; i++) { const u = h[i]!, v = h[(i + 1) % h.length]!; a += u[0] * v[1] - v[0] * u[1]; }
  return Math.abs(a) / 2;
}

// ------------------------------------------------------------------ movement (distance and speed from measured positions)
export const MAX_HUMAN_SPEED_KMH = 36;                      // a faster 1-second step is a measurement error (the fastest footballers reach ~36 km/h)

/** How far and how fast a person moved, over the stretches where their position was measured continuously (gaps of more than a second
 * break a stretch; positions smoothed over a second, a median, because the box's feet jitter). Steps faster than MAX_HUMAN_SPEED_KMH
 * are dropped as measurement errors and counted. Top speed is the fastest pace HELD for two consecutive seconds, so one glitch cannot set
 * it (owner's match, 2026-11-01: a single 25 km/h second among 8-12 km/h ones). Nothing is estimated where nothing was measured. */
export const HIGH_SPEED_KMH = 19.8;                          // the usual football thresholds for high-speed running ...
export const SPRINT_KMH = 25.2;                              // ... and sprinting

/** One run at high speed: consecutive one-second steps at HIGH_SPEED_KMH or faster (a sprint when one of them reaches SPRINT_KMH), with
 * where it started and ended on the pitch (metres, centre origin, as filmed). Whether the runner had the ball is not known yet. */
export const Run = z.object({
  start_us: z.number().int(), end_us: z.number().int(),
  from: z.tuple([z.number(), z.number()]), to: z.tuple([z.number(), z.number()]),
  distance_m: z.number(), top_kmh: z.number(), sprint: z.boolean(),
});
export type Run = z.infer<typeof Run>;

export const Movement = z.object({
  seen_s: z.number(), measured_s: z.number(),
  distance_m: z.number().nullable(), top_speed_kmh: z.number().nullable(), dropped_steps: z.number().int(),
  /** metres run at HIGH_SPEED_KMH or faster, and at SPRINT_KMH or faster; null where nothing was measured */
  high_speed_m: z.number().nullable(), sprint_m: z.number().nullable(),
  sprints: z.number().int(),
  runs: z.array(Run),
});
export type Movement = z.infer<typeof Movement>;

/** Movement from time-ordered measured positions [(t µs, x m, y m)] and the time seen. */
export function movementOf(points: [number, number, number][], seenS: number): Movement {
  const runs: [number, number, number][][] = [];
  for (const p of points) {
    const run = runs[runs.length - 1], last = run?.[run.length - 1];
    if (run && last && p[0] - last[0] <= 1_000_000) run.push(p); else runs.push([p]);
  }
  let distance = 0, top: number | null = null, dropped = 0, measured = 0, highSpeed = 0, sprintM = 0;
  const efforts: Run[] = [];
  const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
  for (const run of runs) {
    if (run.length < 2) continue;
    measured += (run[run.length - 1]![0] - run[0]![0]) / 1e6;
    // smoothed: the median of the positions within half a second either side
    const sm = run.map((p) => {
      const near = run.filter((q) => Math.abs(q[0] - p[0]) <= 500_000);
      return [p[0], median(near.map((q) => q[1])), median(near.map((q) => q[2]))] as [number, number, number];
    });
    // one-second steps: distance and speed (top speed: the slower of two consecutive steps, the best such pair)
    let i = 0, prev: number | null = null, cur: Run | null = null;
    const close = () => { if (cur) { efforts.push(cur); cur = null; } };
    for (let j = 1; j < sm.length; j++) {
      const dt = (sm[j]![0] - sm[i]![0]) / 1e6;
      if (dt < 1 && j < sm.length - 1) continue;
      if (dt <= 0) continue;
      const d = Math.hypot(sm[j]![1] - sm[i]![1], sm[j]![2] - sm[i]![2]), kmh = (d / dt) * 3.6;
      if (kmh > MAX_HUMAN_SPEED_KMH) { dropped++; prev = null; close(); }
      else {
        distance += d;
        if (dt >= 0.9) { if (prev !== null) top = Math.max(top ?? 0, Math.min(prev, kmh)); prev = kmh; } else prev = null;
        if (kmh >= HIGH_SPEED_KMH) {
          highSpeed += d;
          if (kmh >= SPRINT_KMH) sprintM += d;
          const a = sm[i]!, b = sm[j]!;
          if (!cur) cur = { start_us: a[0], end_us: b[0], from: [a[1], a[2]], to: [b[1], b[2]], distance_m: 0, top_kmh: 0, sprint: false };
          cur.end_us = b[0]; cur.to = [b[1], b[2]]; cur.distance_m += d; cur.top_kmh = Math.max(cur.top_kmh, kmh); cur.sprint ||= kmh >= SPRINT_KMH;
        } else close();
      }
      i = j;
    }
    close();
  }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const found = efforts.map((e) => ({ ...e, from: [r1(e.from[0]), r1(e.from[1])] as [number, number], to: [r1(e.to[0]), r1(e.to[1])] as [number, number],
    distance_m: Math.round(e.distance_m), top_kmh: r1(e.top_kmh) }));
  return Movement.parse({ seen_s: r1(seenS), measured_s: r1(measured), distance_m: measured > 0 ? Math.round(distance) : null,
    top_speed_kmh: top === null ? null : r1(top), dropped_steps: dropped,
    high_speed_m: measured > 0 ? Math.round(highSpeed) : null, sprint_m: measured > 0 ? Math.round(sprintM) : null,
    sprints: found.filter((e) => e.sprint).length, runs: found });
}

/** What the footage measured about a registered player: only from tracks a person CONFIRMED as this player, in every video of the
 * organization. Time seen on camera (not minutes played), distance and top speed over measured stretches, the heat map (both halves as
 * filmed) and how confident the detector was on those tracks. */
export const PlayerMeasures = z.object({
  player_id: z.string().uuid(),
  tracks: z.number().int(), videos: z.number().int(),
  seen_s: z.number(), measured_s: z.number(),
  distance_m: z.number().nullable(), top_speed_kmh: z.number().nullable(), dropped_steps: z.number().int(),
  high_speed_m: z.number().nullable(), sprint_m: z.number().nullable(), sprints: z.number().int(),
  mean_confidence: z.number().nullable(),
  heat: HeatZones.nullable(),
  /** owner 2026-11-02 (Home and Player Report were "—"): the engine's events he took part in on his confirmed tracks, in match time, over
   *  the videos where the ball was followed; null = the ball was followed in none of them. The engine's reading, not a verified stat sheet. */
  events: z.object({ passes: z.number().int(), key_passes: z.number().int(), passes_received: z.number().int(), balls_won: z.number().int(),
    pressures: z.number().int(), shots: z.number().int(), videos: z.number().int() }).nullable().optional(),
  /** ?half=1|2: the measures cover that half only (null = the whole match) */
  half: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  /** how the halves of his videos are known: confirmed by a person, proposed by the engine, or not known (then a half filter counts nothing) */
  halves: z.object({ confirmed: z.number().int(), proposed: z.number().int(), unknown: z.number().int() }).optional(),
});
export type PlayerMeasures = z.infer<typeof PlayerMeasures>;
