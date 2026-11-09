import { describe, expect, it } from "vitest";
import { ballAt, checkBall, type BallPath } from "@otsi-vie/contracts";
import { engineBallAt } from "@/components/workspace/BallMarks";

const STEP = 166_667;
const path = { video_id: "00000000-0000-7000-8000-000000000000", track: null, check: null,
  t: [1_000_000, 1_166_667, 1_333_333, 3_000_000], s: "DIDD", x: [0.5, 0.51, 0.52, 0.8], y: [0.5, 0.5, 0.5, 0.2], c: [0.9, 0.4, 0.9, 0.9] } satisfies BallPath;

describe("the engine's ball on the video", () => {
  it("follows the ball between analysed frames and shows nothing where the engine does not know", () => {
    expect(engineBallAt(path, 1_000_000, STEP)).toEqual({ x: 0.5, y: 0.5, inferred: false });
    expect(engineBallAt(path, 1_083_333, STEP)!.x).toBeCloseTo(0.505, 3);                  // halfway between two analysed frames
    expect(engineBallAt(path, 2_000_000, STEP)).toBeNull();                                 // a long gap: unknown, never a line across it
    expect(engineBallAt(path, 3_050_000, STEP)).toEqual({ x: 0.8, y: 0.2, inferred: false }); // the last frame, within half a step
    expect(engineBallAt(null, 1_000_000, STEP)).toBeNull();
  });

  it("finds the engine's answer for a frame and checks it against marks", () => {
    expect(ballAt(path.t, 1_166_667, STEP)).toBe(1);
    expect(ballAt(path.t, 1_166_660, STEP)).toBe(1);
    expect(ballAt(path.t, 2_000_000, STEP)).toBe(-1);
    const c = checkBall(path, [{ pts_us: 1_000_000, visible: true, x: 0.505, y: 0.5 }, { pts_us: 3_000_000, visible: true, x: 0.7, y: 0.2 },
      { pts_us: 2_000_000, visible: true, x: 0.1, y: 0.1 }, { pts_us: 1_333_333, visible: false, x: null, y: null }], STEP, 1280, 720);
    expect(c).toEqual({ marked_visible: 3, right: 1, wrong: 1, unknown: 1, marked_hidden: 1, invented: 1, precision: 0.5, recall: 0.333 });
  });
});

import { nameKey } from "@otsi-vie/contracts";
describe("one spelling key for a name in any alphabet", () => {
  it("matches a Cyrillic lineup name to its Latin spelling and ignores word order, accents and common variants", () => {
    expect(nameKey("ЧИНАЗОМ ГОДВИН")).toBe(nameKey("Chinazom Godwin"));
    expect(nameKey("Godwin  Chinazom")).toBe(nameKey("ЧИНАЗОМ ГОДВИН"));
    expect(nameKey("Étienne Dubois")).toBe(nameKey("ETIENNE DUBOIS"));
    expect(nameKey("АХМЕД-ОГЛЫ ВЛАДИСЛАВ")).toBe(nameKey("Akhmed-Ogly Vladislav"));
    expect(nameKey("МУЦБА РАМАЗ")).toBe(nameKey("Mutsba Ramaz"));
    expect(nameKey("КУТЕЛИЯ ЛЕОН")).not.toBe(nameKey("КУТЕЛИЯ МИХАИЛ"));       // different people stay different
    expect(nameKey("МУЦБА АСЛАН")).not.toBe(nameKey("МУЦБА РАУЛЬ"));
  });
});
