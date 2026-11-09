import { describe, expect, it } from "vitest";
import { ACCURACY_GATES, accuracyMeasured, type ReleaseGate } from "@otsi-vie/contracts";
import { EVIDENCE, evidenceTitle } from "../src/components/evidence/Evidence";

describe("evidence badge (ADR-063)", () => {
  it("has the four S06 levels", () => {
    expect(Object.keys(EVIDENCE).sort()).toEqual(["CONFIRMED", "DETECTED", "INFERRED", "NOT_MEASURED"]);
  });
  it("adds the accuracy note to detected and inferred values only while gates are open", () => {
    expect(evidenceTitle("DETECTED", undefined, false)).toContain("Accuracy not yet measured");
    expect(evidenceTitle("INFERRED", "from positions", false)).toContain("(from positions)");
    expect(evidenceTitle("INFERRED", undefined, false)).toContain("Accuracy not yet measured");
    expect(evidenceTitle("CONFIRMED", undefined, false)).not.toContain("Accuracy");
    expect(evidenceTitle("NOT_MEASURED", undefined, false)).not.toContain("Accuracy");
    expect(evidenceTitle("DETECTED", undefined, true)).not.toContain("Accuracy");
  });
});

describe("accuracy gates (ADR-063)", () => {
  it("are G05-G07 and not passed today, so the banner shows", () => {
    expect(ACCURACY_GATES.map((g) => g.id)).toEqual(["G05", "G06", "G07"]);
    expect(accuracyMeasured()).toBe(false);
  });
  it("count as measured only when every gate passed", () => {
    const pass = ACCURACY_GATES.map((g): ReleaseGate => ({ ...g, status: "PASSED" }));
    expect(accuracyMeasured(pass)).toBe(true);
    expect(accuracyMeasured([...pass.slice(0, 2), { ...pass[2]!, status: "MEASURING" }])).toBe(false);
  });
});
