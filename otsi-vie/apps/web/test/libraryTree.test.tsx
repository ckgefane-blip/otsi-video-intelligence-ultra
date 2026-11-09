/** v3 Phase A.14 (ADR-073): the Library's left tree */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
const FAIL = "fail";                                                 // the API refuses (a sentinel, so the mock itself never holds a rejected promise)
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => { const v = api(...a); return v === "fail" ? Promise.reject(new Error("down")) : v; } }));

import { LibraryTree, SHARED_TAB, treeCounts } from "@/components/library/LibraryTree";
import type { Asset } from "@/components/library/useLibrary";

const asset = (kind: Asset["kind"], id: string, extra: Partial<Asset> = {}): Asset => ({
  key: `${kind}-${id}`, id, kind, title: id, sub: "", durationUs: null, updated: "", created: "", status: "Ready", player: null, videoId: null, matchId: null,
  competition: null, teams: [], bytes: null, width: null, height: null, href: null, renderId: null, raw: {} as Asset["raw"], folderId: null, createdBy: null, project: null, ...extra,
});
const folder = (id: string, name: string, n: number) => asset("Folder", id, { title: name, raw: { id, name, item_count: n } as unknown as Asset["raw"] });
const ALL: Asset[] = [
  asset("Reel", "r1", { folderId: "f1" }), asset("Video", "v1", { project: { shared_with_me: true } as Asset["project"] }), asset("Match", "m1"),
  folder("f2", "U19 scouting", 0), folder("f1", "Academy", 1),
];

beforeEach(() => api.mockReset());

describe("Library tree", () => {
  it("counts the Library, its folders (by name) and what is shared with me", () => {
    const c = treeCounts(ALL);
    expect(c.all).toBe(3);
    expect(c.shared).toBe(1);
    expect(c.folders.map((f) => [f.name, f.item_count])).toEqual([["Academy", 1], ["U19 scouting", 0]]);
  });

  it("opens the whole Library, a folder, Shared With Me and the Trash; says the Trash count", async () => {
    const bin = { id: "0190a000-0000-7000-8000-000000000009", name: "Confirmed goals", q: "event:goal is:confirmed", count: 3, more: false, created_at: "2026-11-07T10:00:00.000Z" };
    api.mockImplementation(async (path: string) => (path === "/v1/smart-bins" ? [bin] : [{ id: "t1" }, { id: "t2" }]));
    const setFolder = vi.fn(), setTab = vi.fn(), openTrash = vi.fn(), newFolder = vi.fn(), say = vi.fn();
    render(<LibraryTree all={ALL} folder="f1" setFolder={setFolder} tab={0} setTab={setTab} canWrite openTrash={openTrash} newFolder={newFolder} say={say} version={1} />);
    expect(api).toHaveBeenCalledWith("/v1/library/trash");
    await waitFor(() => expect(document.querySelector("[data-tree=trash]")).toHaveTextContent("Trash2"));
    expect(document.querySelector("[data-tree=folder-f1]")).toHaveAttribute("aria-current", "true");
    expect(document.querySelector("[data-tree=all]")).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByTitle("Academy"));
    expect(setFolder).toHaveBeenLastCalledWith("f1");
    fireEvent.click(screen.getByTitle("Shared With Me"));
    expect(setFolder).toHaveBeenLastCalledWith(null);
    expect(setTab).toHaveBeenLastCalledWith(SHARED_TAB);
    fireEvent.click(screen.getByTitle("All assets"));
    expect(setTab).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByTitle("Trash"));
    expect(openTrash).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("New folder"));
    expect(newFolder).toHaveBeenCalledTimes(1);
    // B.11 (ADR-087): the person's Smart Bins with what each holds now
    await waitFor(() => expect(document.querySelector(`[data-tree=bin-${bin.id}]`)).toHaveTextContent("Confirmed goals3"));
    expect(screen.getByLabelText("New Smart Bin")).toBeInTheDocument();
  });

  it("a viewer is told why there is no New folder; an unreadable Trash shows no count", async () => {
    api.mockReturnValue(FAIL);                                       // the Trash cannot be read: no count is shown, never a guess
    const newFolder = vi.fn(), say = vi.fn();
    render(<LibraryTree all={[]} folder={null} setFolder={vi.fn()} tab={0} setTab={vi.fn()} canWrite={false} openTrash={vi.fn()} newFolder={newFolder} say={say} version={1} />);
    fireEvent.click(screen.getByLabelText("New folder"));
    expect(newFolder).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith("Your role can view the Library but not make folders");
    expect(screen.getByText(/No folders yet/)).toBeInTheDocument();
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/library/trash"));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("[data-tree=trash]")!.textContent).toBe("🗑Trash");
  });

  it("says when the Library is loading or could not be loaded", () => {
    api.mockResolvedValue([]);
    const p = { folder: null, setFolder: vi.fn(), tab: 0, setTab: vi.fn(), canWrite: true, openTrash: vi.fn(), newFolder: vi.fn(), say: vi.fn(), version: 1 };
    const { rerender } = render(<LibraryTree all={undefined} {...p} />);
    expect(screen.getByText("Loading the Library…")).toBeInTheDocument();
    rerender(<LibraryTree all={null} {...p} />);
    expect(screen.getByText("The Library could not be loaded.")).toBeInTheDocument();
  });
});
