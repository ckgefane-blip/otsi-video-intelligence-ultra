/**
 * Export batch cost preview (billing blueprint §4.2(2), the batch bypass fix): Export's "Render only"
 * batch used to start several renders at 10 tokens each without showing the cost first. Now "Start N
 * files" opens the SAME shared cost preview with the TOTAL cost (N × 10 tokens) and the balance
 * before/after, and nothing starts until Continue is pressed. A short balance disables Continue,
 * states the shortfall, and offers to buy tokens. The API is mocked; the batch request itself is
 * covered by the API tests.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error { constructor(readonly status: number, code: string, message: string) { super(message); } } }));

import type { ExportPreset, Reel } from "@otsi-vie/contracts";
import { ExportPreflight } from "@/components/exportstage/ExportPreflight";

const ORG = "0190a000-0000-7000-8000-000000000001";
const balance = (spendable: number) => ({ organization_id: ORG, balance: spendable, spendable_balance: spendable, expired_unwritten_off: 0, low_balance: spendable < 90 });
const preflight = { checks: [{ key: "clips", level: "OK", text: "3 clips, 90 s." }], open: [] };

// a cross-match reel (no video_id, so no rights fetch) with a preset of three files.
const reel = {
  id: "0190a000-0000-7000-8000-000000000001",
  video_id: undefined,
  aspect: "16:9",
  version: 1,
  settings: { loudness_lufs: null },
} as unknown as Reel;
const preset = (outputs: { profile: string; aspect: string | null }[]) => ({
  id: "test-preset",
  name: "Test preset",
  scope: "ORGANIZATION",
  note: "",
  spec: { outputs, codec: null, bitrate_mbps: null, loudness_lufs: null },
} as unknown as ExportPreset);
const three = preset([
  { profile: "REEL", aspect: "16:9" },
  { profile: "SCOUT", aspect: "16:9" },
  { profile: "SOCIAL", aspect: "9:16" },
]);
const one = preset([{ profile: "REEL", aspect: "16:9" }]);

beforeEach(() => { api.mockReset(); });

function route(spendable: number) {
  api.mockImplementation((url: unknown) => {
    if (typeof url === "string" && url.includes("/preflight")) return Promise.resolve(preflight);
    if (typeof url === "string" && url.startsWith("/v1/wallet")) return Promise.resolve(balance(spendable));
    return Promise.reject(new Error("unexpected " + String(url)));
  });
}

async function openPreflight(p: ExportPreset, onStart: () => void) {
  render(<ExportPreflight reel={reel} preset={p} codec="h264" bitrate={8} upToDate={false} canWrite open onOpenChange={() => undefined} onStart={onStart} />);
  // the Start button is disabled until the preflight checks have loaded.
  const start = await screen.findByText(/Start \d+ files?/) as HTMLButtonElement;
  expect(start.disabled).toBe(false);
  return start;
}

describe("ExportPreflight batch cost preview", () => {
  it("shows the total cost for the batch and starts nothing until Continue is pressed", async () => {
    route(500);
    const onStart = vi.fn();
    const start = await openPreflight(three, onStart);
    fireEvent.click(start);
    expect(await screen.findByText("Render 3 files — 30 tokens. Balance 500. After: 470.")).toBeTruthy();
    expect(onStart).not.toHaveBeenCalled();
    const confirm = document.querySelector("[data-confirm-cost]") as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("blocks the batch when the balance is short of the total, states the shortfall, and offers to buy tokens", async () => {
    route(20);
    const onStart = vi.fn();
    const start = await openPreflight(three, onStart);
    fireEvent.click(start);
    expect(await screen.findByText("Render 3 files — 30 tokens. Balance 20. After: —.")).toBeTruthy();
    expect(screen.getByText("You need 10 more tokens.")).toBeTruthy();
    const buy = screen.getByText("Buy tokens");
    expect(buy.closest("a")?.getAttribute("href")).toBe("/settings/wallet#tp");
    const confirm = document.querySelector("[data-confirm-cost]") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("says 'Render 1 file' for a single file, at 10 tokens", async () => {
    route(500);
    const onStart = vi.fn();
    const start = await openPreflight(one, onStart);
    fireEvent.click(start);
    expect(await screen.findByText("Render 1 file — 10 tokens. Balance 500. After: 490.")).toBeTruthy();
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector("[data-confirm-cost]") as HTMLButtonElement);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("closes the preview on Cancel without starting anything", async () => {
    route(500);
    const onStart = vi.fn();
    const start = await openPreflight(three, onStart);
    fireEvent.click(start);
    expect(await screen.findByText("Render 3 files — 30 tokens. Balance 500. After: 470.")).toBeTruthy();
    // both dialogs have a Cancel button; the preview's is the one inside its own dialog.
    const preview = document.querySelector("[data-dialog='cost-preview']") as HTMLElement;
    fireEvent.click(within(preview).getByText("Cancel"));
    expect(onStart).not.toHaveBeenCalled();
    expect(document.querySelector("[data-dialog='cost-preview']")).toBeNull();
  });
});
