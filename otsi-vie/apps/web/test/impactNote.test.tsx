/** v3 Phase B.7 (ADR-084): the identity impact note shown before a decision is saved */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let reply: unknown = null;
const seen: string[] = [];
const api = vi.fn(async (path: string) => { seen.push(path); return reply; });
vi.mock("@/lib/api", () => ({ api: (path: string) => api(path) }));

import { ImpactNote } from "@/components/analysis/ImpactNote";
import { impactText } from "@otsi-vie/contracts";

const U = "0190a000-0000-7000-8000-00000000000";
const none = { changing_tracks: 0, unchanged_tracks: 1, reels: [], reports: [] };

describe("identity impact note", () => {
  it("says nothing when nothing would go out of date", async () => {
    reply = none;
    render(<ImpactNote trackIds={[`${U}1`]} state="CONFIRMED" playerId={`${U}2`} />);
    await waitFor(() => expect(seen.length).toBe(1));
    expect(document.querySelector("[data-identity-impact]")).toBeNull();
    expect(seen.at(-1)).toBe(`/v1/identity-impact?track_ids=${U}1&state=CONFIRMED&player_id=${U}2`);
  });
  it("names the reels and reports before the decision is saved", async () => {
    reply = { changing_tracks: 2, unchanged_tracks: 0, reels: [{ reel_id: `${U}3`, name: "A", renders: 1, live_links: 0 }, { reel_id: `${U}4`, name: "B", renders: 0, live_links: 0 }],
      reports: [{ player_id: `${U}5`, name: "Ada", pdfs: 2, latest_at: null, role: "LOSES" }, { player_id: `${U}6`, name: "Bea", pdfs: 0, latest_at: null, role: "GAINS" }] };
    render(<ImpactNote trackIds={[`${U}1`, `${U}7`]} state="UNRESOLVED" playerId={null} />);
    await waitFor(() => expect(document.querySelector("[data-identity-impact]")).not.toBeNull());
    expect(document.querySelector("[data-identity-impact]")!.textContent).toBe(
      "Before you save: 2 reels will need their targets refreshed before rendering again (1 already rendered); Ada's 2 PDF reports will no longer match.");
    expect(impactText(none)).toBeNull();
  });
});
