/** v3 Phase B.12 (ADR-088): the Library table's columns from recorded facts, its selection, and the CSV of the selected rows */
import { fireEvent, render, screen } from "@testing-library/react";
import type { VideoFacts } from "@otsi-vie/contracts";
import { describe, expect, it, vi } from "vitest";
import { LibraryTable, rowFacts, rowsCsv } from "@/components/library/LibraryTable";
import { getDictionary } from "@/lib/i18n";
import type { Asset } from "@/components/library/useLibrary";

const V = "01a18837-dbfd-719b-93e0-2916132bac92", R = "0190a000-0000-7000-8000-000000000001", X = "0190a000-0000-7000-8000-000000000002";
const asset = (kind: Asset["kind"], id: string, extra: Partial<Asset> = {}): Asset => ({
  key: `${kind}-${id}`, id, kind, title: `${kind} "one"`, sub: "", durationUs: null, updated: "2026-11-07T10:00:00.000Z", created: "", status: "Ready", player: null, videoId: null, matchId: null,
  competition: null, teams: [], bytes: null, width: null, height: null, href: null, renderId: null, raw: {} as Asset["raw"], folderId: null, createdBy: null, project: null, ...extra,
});
const facts = new Map<string, VideoFacts>([[V, { video_id: V, rights: { state: "INTERNAL", uses: ["VIEW", "ANALYZE", "PRODUCE"], produce_block: null, analyse_block: null },
  analysed: true, tracks: 4453, confirmed_tracks: 3, profile: "STANDARD" }]]);
const reel = { aspect: "9:16", formats: [{ render_id: X, profile: "SCOUT", aspect: "16:9", width: 1920, height: 1080, completed_at: null }] };
const video = asset("Video", V, { raw: { id: V, match_id: "m1" } as unknown as Asset["raw"] });
const ROWS = [video, asset("Match", "m1"), asset("Reel", R, { videoId: V, raw: reel as unknown as Asset["raw"] }),
  asset("Export", X, { videoId: V, renderId: X, raw: reel as unknown as Asset["raw"] }), asset("Project", "p1", { project: { access: "RESTRICTED" } as Asset["project"] })];

describe("Library table (B.12)", () => {
  it("reads every column from the recorded facts", () => {
    const vm = new Map([["m1", V]]);
    expect(rowFacts(ROWS[0]!, facts, vm, getDictionary("en"))).toEqual({ rights: "Internal · view, analyze, produce", locked: null, evidence: "4,453 tracks · 3 confirmed", profile: "Standard", device: "Camera not recorded" });
    expect(rowFacts(ROWS[1]!, facts, vm, getDictionary("en")).evidence).toBe("4,453 tracks · 3 confirmed");                 // a match: its video's facts
    expect(rowFacts(ROWS[2]!, facts, vm, getDictionary("en"))).toMatchObject({ profile: "Frame 9:16", device: "Phone" });
    expect(rowFacts(ROWS[3]!, facts, vm, getDictionary("en"))).toMatchObject({ profile: "Scout cut 16:9", device: "TV / desktop" });
    expect(rowFacts(ROWS[4]!, facts, vm, getDictionary("en"))).toMatchObject({ rights: "—", locked: "Restricted project: only its people see it" });
    const none = rowFacts(asset("Video", "v9"), new Map(), vm, getDictionary("en"));
    expect(none).toMatchObject({ rights: "—", locked: null, evidence: "—" });                              // not in the facts: a dash
    const bare = new Map<string, VideoFacts>([["v9", { video_id: "v9", rights: null, analysed: false, tracks: 0, confirmed_tracks: 0, profile: null }]]);
    expect(rowFacts(asset("Video", "v9"), bare, vm, getDictionary("en"))).toMatchObject({ rights: "Not recorded", locked: "No rights recorded for this video", evidence: "Not analysed" });
    expect(rowFacts(ROWS[0]!, null, vm, getDictionary("en"))).toMatchObject({ rights: "…", evidence: "…" });                  // still loading: never a guess
  });
  it("selects rows, opens one on click, and lists the selection as CSV", () => {
    const setChecked = vi.fn(), onRow = vi.fn();
    render(<LibraryTable rows={ROWS} all={ROWS} facts={facts} checked={new Set()} setChecked={setChecked} selected={null} onRow={onRow} />);
    expect(screen.getAllByRole("row")).toHaveLength(6);
    expect(screen.getByLabelText("Locked: Restricted project: only its people see it")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select Reel "one"'));
    expect(setChecked).toHaveBeenCalledWith(new Set([`Reel-${R}`]));
    fireEvent.click(document.querySelector(`[data-table-row="Export-${X}"]`)!);
    expect(onRow).toHaveBeenCalledWith(ROWS[3]);
    const csv = rowsCsv([ROWS[2]!], ROWS, facts, getDictionary("en")).split("\r\n");
    expect(csv[0]).toBe('"Title","Type","Locked","Rights","Evidence","Profile","Device","Updated","Status"');
    expect(csv[1]).toBe('"Reel ""one""","Reel","","Internal · view, analyze, produce","4,453 tracks · 3 confirmed","Frame 9:16","Phone","2026-11-07T10:00:00.000Z","Ready"');
  });
});
