/** Player naming rules in the UI (ADR-016): jersey number, track number and OTSI Player ID stay distinct; unknown stays unknown. */
import { describe, expect, it } from "vitest";
import { identityLine, jerseyLabel, parsePlayerRef, trackLabel, unidentifiedLabel } from "@/lib/identity";

describe("player references", () => {
  it("accepts an exact canonical OTSI Player ID or an internal player UUID, nothing else", () => {
    expect(parsePlayerRef("OTSI-NGA-2026-000001")).toEqual({ kind: "canonical", id: "OTSI-NGA-2026-000001" });
    expect(parsePlayerRef("0190C6A0-0000-7000-8000-000000000000")).toEqual({ kind: "player", id: "0190c6a0-0000-7000-8000-000000000000" });
    for (const bad of ["otsi-nga-2026-000001", "OTSI-NGA-2026-00001", "OTSI-NG-2026-000001", "17", "track 4", "Kevin"]) {
      expect(parsePlayerRef(bad), bad).toBeNull();
    }
  });
});

describe("labels", () => {
  it("keeps the three identities visibly different", () => {
    expect(jerseyLabel(17)).toBe("#17");
    expect(trackLabel(4)).toBe("track 4");
    expect(unidentifiedLabel(4)).toBe("Unidentified Player · track 4");
  });

  it("shows an ID only for a registered or retired player", () => {
    const base = { display_name: "A Player" };
    expect(identityLine({ ...base, canonical_otsi_id: "OTSI-NGA-2026-000001", identity_label: "REGISTERED_PLAYER" })).toBe("A Player · OTSI-NGA-2026-000001");
    expect(identityLine({ ...base, canonical_otsi_id: null, identity_label: "PROVISIONAL_PLAYER" })).toBe("A Player (provisional, no OTSI Player ID yet)");
    expect(identityLine({ ...base, canonical_otsi_id: "OTSI-NGA-2026-000002", identity_label: "MERGED_DUPLICATE" })).toBe("A Player · merged into OTSI-NGA-2026-000002");
  });
});
