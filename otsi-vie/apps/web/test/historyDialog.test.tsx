/** v3 Phase B.1 (ADR-081): the reel's History panel, shared by Reel Builder and Clip Studio */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistoryDialog } from "@/components/reels/HistoryDialog";
import type { ReelState } from "@/components/reels/ReelBuilder";

const u = "0190a000-0000-7000-8000-00000000000";
const at = new Date().toISOString();
const actor = { user_id: `${u}9`, name: "Ana" };
const history = {
  entries: [
    { id: `${u}4`, seq: 4, kind: "UNDO", action: "reel.undo", label: "Undo: Frame 4:5", state: null, target_edit_id: `${u}3`, actor, created_at: at },
    { id: `${u}3`, seq: 3, kind: "EDIT", action: "reel.updated", label: "Frame 4:5", state: "UNDONE", target_edit_id: null, actor, created_at: at },
    { id: `${u}2`, seq: 2, kind: "EDIT", action: "reel.clip_trimmed", label: "Trimmed a clip", state: "ACTIVE", target_edit_id: null, actor: null, created_at: at },
    { id: `${u}1`, seq: 1, kind: "EDIT", action: "reel.clip_added", label: "Added a clip", state: "ACTIVE", target_edit_id: null, actor, created_at: at },
  ],
  can_undo: true, can_redo: true, undo_label: "Trimmed a clip", redo_label: "Frame 4:5",
};

const state = (over: Partial<ReelState> = {}) => ({ history, canEdit: true, busy: false, msg: null, undo: vi.fn(), redo: vi.fn(), ...over }) as unknown as ReelState;

describe("History panel", () => {
  it("lists every change newest first, with undone ones marked, and names what Undo and Redo will do", () => {
    render(<HistoryDialog r={state()} open onOpenChange={() => undefined} />);
    const items = document.querySelectorAll("[data-history-list] li");
    expect([...items].map((li) => li.getAttribute("data-edit"))).toEqual(["UNDO", "EDIT", "EDIT", "EDIT"]);
    expect(screen.getByText("Undone")).toBeTruthy();
    expect(screen.getByText("Undo: Trimmed a clip")).toBeTruthy();
    expect(screen.getByText("Redo: Frame 4:5")).toBeTruthy();
    expect(screen.getByText(/Someone ·/)).toBeTruthy();                  // a former member: never a made-up name
    expect(document.querySelectorAll("[data-back-to]")).toHaveLength(2);  // only changes still in the reel
  });
  it("Undo, Redo and Back to before this call the reel's history; viewers cannot", () => {
    const r = state();
    render(<HistoryDialog r={r} open onOpenChange={() => undefined} />);
    fireEvent.click(document.querySelector("[data-history-undo]")!);
    fireEvent.click(document.querySelector("[data-history-redo]")!);
    fireEvent.click(document.querySelector(`[data-back-to="${u}1"]`)!);
    expect(r.undo).toHaveBeenCalledWith();
    expect(r.redo).toHaveBeenCalled();
    expect(r.undo).toHaveBeenCalledWith(`${u}1`);
  });
  it("a viewer sees the history but cannot change it; an empty reel says so", () => {
    const { unmount } = render(<HistoryDialog r={state({ canEdit: false })} open onOpenChange={() => undefined} />);
    expect((document.querySelector("[data-history-undo]") as HTMLButtonElement).disabled).toBe(true);
    unmount();
    render(<HistoryDialog r={state({ history: { entries: [], can_undo: false, can_redo: false, undo_label: null, redo_label: null } })} open onOpenChange={() => undefined} />);
    expect(document.querySelector("[data-history-empty]")).toBeTruthy();
  });
});
