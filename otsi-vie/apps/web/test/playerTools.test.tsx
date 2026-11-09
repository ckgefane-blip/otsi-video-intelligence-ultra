/** v3 Phase B.4 / B.5 (ADR-083): the Analysis player's marks, loop, zoom, overlay opacity and the Snapshot dialog */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { path: string; init: { method?: string; json?: unknown } | undefined }[] = [];
URL.createObjectURL = () => "blob:x";
URL.revokeObjectURL = () => undefined;
let snapshots: unknown[] = [];
vi.mock("@/lib/api", () => ({
  ApiProblem: class extends Error {},
  api: vi.fn(async (path: string, init?: { method?: string; json?: unknown }) => {
    calls.push({ path, init });
    if (init?.method === "POST") { snapshots = [{ ...snap, id: `${U}2`, status: "QUEUED", width: null, height: null, boxes_drawn: null, frame_pts_us: null, finished_at: null }, ...snapshots]; return snapshots[0]; }
    return snapshots;
  }),
  apiBlob: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
}));

import { clampOpacity, loopTarget, readOpacity, setMark, SnapshotDialog, zoomOrigin } from "@/components/workspace/PlayerTools";
import type { AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";

const U = "0190a000-0000-7000-8000-00000000000";
const snap = { id: `${U}1`, video_id: `${U}9`, pts_us: 5_000_000, frame_pts_us: 5_000_000, overlays: { boxes: true, labels: false, selected_track_id: null, caption: true },
  status: "SUCCEEDED", width: 1920, height: 1160, boxes_drawn: 14, failure: null, requested_by: { user_id: `${U}8`, name: "Ana" }, created_at: new Date().toISOString(), finished_at: new Date().toISOString() };

describe("In / Out marks and loop", () => {
  it("keeps In before Out", () => {
    let m = { inUs: null, outUs: null, loop: false } as { inUs: number | null; outUs: number | null; loop: boolean };
    m = setMark(m, "in", 10); m = setMark(m, "out", 20);
    expect(m).toMatchObject({ inUs: 10, outUs: 20 });
    expect(setMark(m, "in", 25)).toMatchObject({ inUs: 25, outUs: null });     // In after Out drops Out
    expect(setMark(m, "out", 5)).toMatchObject({ inUs: null, outUs: 5 });
  });
  it("returns to In at Out only while looping with both marks", () => {
    const m = { inUs: 1_000_000, outUs: 3_000_000, loop: true };
    expect(loopTarget(m, 2_000_000)).toBeNull();
    expect(loopTarget(m, 3_000_000)).toBe(1_000_000);
    expect(loopTarget(m, 0)).toBe(1_000_000);                                   // before In (a seek back): into the span
    expect(loopTarget({ ...m, loop: false }, 3_500_000)).toBeNull();
    expect(loopTarget({ ...m, outUs: null }, 3_500_000)).toBeNull();
  });
});

describe("zoom and overlay opacity", () => {
  it("zooms on the selected player's box centre, else the picture's centre", () => {
    expect(zoomOrigin(null)).toBe("50% 50%");
    expect(zoomOrigin({ x: 0.2, y: 0.4, w: 0.1, h: 0.2 })).toBe("25% 50%");
  });
  it("reads saved opacities safely: never invisible, never above full", () => {
    expect(readOpacity(null)).toEqual({ boxes: 1, pitch: 1, ball: 1 });
    expect(readOpacity('{"boxes":0.4,"pitch":0,"ball":7}')).toEqual({ boxes: 0.4, pitch: 0.1, ball: 1 });
    expect(readOpacity("not json")).toEqual({ boxes: 1, pitch: 1, ball: 1 });
    expect(clampOpacity("x")).toBe(1);
  });
});

describe("Snapshot dialog", () => {
  beforeEach(() => { calls.length = 0; snapshots = [snap]; });
  const ws = (over: Partial<AnalysisWorkspaceState> = {}) => ({
    video: { id: `${U}9`, title: "Cup final" }, run: { id: `${U}7` }, timeUs: 12_400_000, selectedId: `${U}6`, canWrite: true, seek: vi.fn(), ...over,
  }) as unknown as AnalysisWorkspaceState;

  it("lists the video's snapshots and asks for one at the playhead with the chosen overlays", async () => {
    await act(async () => { render(<SnapshotDialog ws={ws()} open onOpenChange={() => undefined} />); });
    expect(document.querySelectorAll("[data-snap-list] li")).toHaveLength(1);
    expect(screen.getByText(/1920×1160 · 14 boxes/)).toBeTruthy();
    await act(async () => { fireEvent.click(document.querySelector("[data-snap-opt=labels]")!); });
    await act(async () => { fireEvent.click(document.querySelector("[data-snap-make]")!); });
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect(post.path).toBe(`/v1/videos/${U}9/snapshots`);
    expect(post.init!.json).toEqual({ at_pts_us: 12_400_000, overlays: { boxes: true, labels: true, selected_track_id: `${U}6`, caption: true } });
    expect(screen.getByText("Being made…")).toBeTruthy();
  });

  it("offers boxes only with a finished analysis, the highlight only with a selected player, and nothing to make for a viewer", async () => {
    await act(async () => { render(<SnapshotDialog ws={ws({ run: null, selectedId: null } as Partial<AnalysisWorkspaceState>)} open onOpenChange={() => undefined} />); });
    expect((document.querySelector("[data-snap-opt=boxes]") as HTMLInputElement).disabled).toBe(true);
    expect((document.querySelector("[data-snap-opt=selected]") as HTMLInputElement).disabled).toBe(true);
    cleanup();
    await act(async () => { render(<SnapshotDialog ws={ws({ canWrite: false })} open onOpenChange={() => undefined} />); });
    expect(document.querySelector("[data-snap-make]")).toBeNull();
    expect(document.querySelector("[data-snap-remove]")).toBeNull();
    expect(document.querySelector("[data-snap-save]")).toBeTruthy();                // reading and saving stay open to the organization
  });
});
