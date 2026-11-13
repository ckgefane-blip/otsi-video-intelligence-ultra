/** Export (SOT, Page 9): the three panels and the bottom bar, and a failed reels read is named (never shown as empty) with a retry */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
const REEL = "55555555-5555-4555-8555-555555555555";
const PLAYER = "44444444-4444-4444-8444-444444444444";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => "/exports", useSearchParams: () => new URLSearchParams(`reel=${REEL}`) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { role: "OWNER" } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error {} }));
vi.mock("@/lib/wallet", () => ({ useWalletBalance: () => ({ balance: 10, currency: "NGN" }) }));

import { ExportStage } from "@/components/exportstage/ExportStage";

const reel = {
  id: REEL, name: "Chinazom Godwin — highlights", source: "MATCH", aspect: "16:9", version: 3,
  best_moments_rule_version: "2.1", last_good_render: { id: "66666666-6666-4666-8666-666666666666", has_output: true, state: "SUCCEEDED" },
  latest_render: null, settings: {}, player: { player_id: PLAYER, display_name: "Chinazom Godwin", canonical_otsi_id: "OTSI-NGA-2026-000001" },
};

function mockApi(reels: unknown, fail = false) {
  api.mockImplementation((url: string) => {
    if (url === "/v1/reels") return fail ? Promise.reject(new Error("down")) : Promise.resolve(reels);
    if (url === "/v1/export-presets") return Promise.resolve([]);
    if (url === "/v1/brand-assets") return Promise.resolve([]);
    if (url === "/v1/members") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => { api.mockReset(); push.mockReset(); replace.mockReset(); });

async function open(reels: unknown = [reel], fail = false) {
  mockApi(reels, fail);
  render(<ExportStage />);
  if (reels === reel || (Array.isArray(reels) && reels.length > 0)) {
    await waitFor(() => expect(screen.getByRole("heading", { name: "Render" })).toBeInTheDocument());
  }
}

describe("Export (SOT)", () => {
  it("shows the three panels and the bottom bar for the reel", async () => {
    await open();
    expect(screen.getByRole("heading", { name: /Deliver Chinazom Godwin/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delivery" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scouting Pack" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Render only" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Render & send" })).toBeInTheDocument();
    expect(screen.getByText("Best moment rule")).toBeInTheDocument();
    expect(screen.getByText("Chinazom Godwin")).toBeInTheDocument();
  });

  it("] and [ switch between the Reel and Scouting Pack export types", async () => {
    await open();
    const seg = screen.getByRole("group", { name: "Export type" });
    const reelBtn = within(seg).getByRole("button", { name: "Reel" });
    const packBtn = within(seg).getByRole("button", { name: "Scouting Pack" });
    expect(reelBtn.className).toContain("on");
    fireEvent.keyDown(window, { key: "]" });
    expect(packBtn.className).toContain("on");
    fireEvent.keyDown(window, { key: "[" });
    expect(reelBtn.className).toContain("on");
  });

  it("names the failed reels read and retries it, instead of showing no jobs", async () => {
    await open([], true);
    await waitFor(() => expect(screen.getByText("The render queue could not be loaded.")).toBeInTheDocument());
    expect(screen.queryByText("No render jobs queued")).toBeNull();
    const reads = () => api.mock.calls.filter(([u]) => u === "/v1/reels").length;
    expect(reads()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("says to open a reel when the read succeeds with an empty list — and still shows the three panels, disabled and empty", async () => {
    await open([]);
    // the line shows twice: the page message and the Highlight reel row, which is unticked with no reel (never "Ready")
    await waitFor(() => expect(screen.getAllByText("Open a reel to export").length).toBeGreaterThan(0));
    expect(screen.queryByText("Ready")).toBeNull();
    // the SOT always shows the three panels; with no reel they are a disabled, empty version
    expect(screen.getByRole("heading", { name: "Render" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Delivery" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scouting Pack" })).toBeInTheDocument();
    // the panels sit in a disabled fieldset (jsdom does not propagate a fieldset's disabled state to a
    // control's .disabled, so assert the fieldset itself) and the email field is still present
    const fieldset = document.querySelector("fieldset");
    expect(fieldset).not.toBeNull();
    expect((fieldset as HTMLFieldSetElement).disabled).toBe(true);
    expect(screen.getByLabelText("Recipient email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Render only" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Render & send" })).toBeDisabled();
  });

  it("offers only codecs the renderer makes and that are royalty-free (H.264, AV1, VP9 — ADR-030), and the recipient email is always present", async () => {
    await open();
    const codec = screen.getByLabelText("Codec") as HTMLSelectElement;
    expect(Array.from(codec.options).map((o) => o.value)).toEqual(["h264", "av1", "vp9"]);
    expect(within(codec).queryByText("H.265 / HEVC")).toBeNull();
    expect(within(codec).queryByText("ProRes 422")).toBeNull();
    fireEvent.change(codec, { target: { value: "av1" } });
    expect(codec.value).toBe("av1");
    // the recipient email field is there whatever Send to is (the SOT's field, not only for Client)
    expect(screen.getByLabelText("Recipient email")).toBeInTheDocument();
    const teamBtn = screen.getByRole("button", { name: "Team member" });
    fireEvent.click(teamBtn);
    expect(screen.getByLabelText("Recipient email")).toBeInTheDocument();
  });
});
