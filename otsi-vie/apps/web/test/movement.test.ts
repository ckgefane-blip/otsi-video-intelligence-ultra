import { describe, expect, it } from "vitest";
import { movementOf } from "@otsi-vie/contracts";

/** positions every 0.5 s along x at the given speeds (km/h), one per second of the list */
function path(kmh: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  let x = -40, t = 0;
  for (const v of kmh) for (let h = 0; h < 2; h++) { out.push([t, x, 5]); x += (v / 3.6) * 0.5; t += 500_000; }
  out.push([t, x, 5]);
  return out;
}

describe("runs and sprints from measured positions", () => {
  it("finds one sprint inside a jog, with where it started and ended", () => {
    const m = movementOf(path([10, 10, 10, 10, 22, 28, 30, 27, 21, 12, 10, 10, 10, 10]), 14);
    expect(m.sprints).toBe(1);
    expect(m.runs).toHaveLength(1);
    const r = m.runs[0]!;
    expect(r.sprint).toBe(true);
    expect(r.top_kmh).toBeGreaterThanOrEqual(27);
    expect(r.to[0]).toBeGreaterThan(r.from[0]);                   // ran towards +x
    expect(r.distance_m).toBeGreaterThan(25);
    expect(m.sprint_m!).toBeGreaterThan(15);
    expect(m.high_speed_m!).toBeGreaterThan(m.sprint_m!);
  });

  it("a fast run below sprint speed is high-speed running, not a sprint; a jog is neither", () => {
    expect(movementOf(path([10, 21, 22, 23, 21, 10, 10]), 7)).toMatchObject({ sprints: 0, runs: [{ sprint: false }] });
    expect(movementOf(path([8, 9, 10, 11, 10, 9, 8]), 7)).toMatchObject({ sprints: 0, runs: [], high_speed_m: 0, sprint_m: 0 });
  });

  it("nothing measured: no runs and no distances", () => {
    expect(movementOf([], 30)).toMatchObject({ distance_m: null, high_speed_m: null, sprint_m: null, sprints: 0, runs: [] });
  });
});
