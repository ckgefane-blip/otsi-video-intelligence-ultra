/** Reel Builder: the reels list names a failed read instead of showing "No reels yet", with a retry */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { role: "OWNER" } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error {} }));

import { ReelList } from "@/components/reels/ReelBuilder";

const reel = (id: string, name: string, clips: number) => ({ id, name, clips: Array.from({ length: clips }, (_, i) => ({ id: `${id}-c${i}` })), latest_render: null });

beforeEach(() => { api.mockReset(); });

describe("ReelList", () => {
  it("lists the reels with their clip counts and render state", async () => {
    api.mockResolvedValue([reel("r1", "Ada — highlights", 2), reel("r2", "Boys — goals", 1)]);
    render(<ReelList />);
    expect(await screen.findByText("Ada — highlights")).toBeTruthy();
    expect(screen.getByText("Boys — goals")).toBeTruthy();
    expect(screen.getByText(/2 clips/)).toBeTruthy();
    expect(screen.getByText(/1 clips/)).toBeTruthy();
    expect(screen.getAllByText(/not rendered/)).toHaveLength(2);
  });

  it("an empty list says no reels yet", async () => {
    api.mockResolvedValue([]);
    render(<ReelList />);
    expect(await screen.findByText(/No reels yet/)).toBeTruthy();
  });

  it("a failed read is named as one, and Try again re-reads", async () => {
    api.mockRejectedValueOnce(new Error("down"));
    api.mockResolvedValueOnce([reel("r1", "Ada — highlights", 2)]);
    render(<ReelList />);
    expect(await screen.findByText(/Reels could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/No reels yet/)).toBeNull();
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("Ada — highlights")).toBeTruthy();
    expect(api).toHaveBeenCalledTimes(2);
  });
});
