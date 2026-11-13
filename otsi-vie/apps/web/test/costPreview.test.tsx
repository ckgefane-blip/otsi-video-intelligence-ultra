/**
 * Cost preview (billing blueprint §4.2(2)): before a charged action runs, the dialog shows the exact
 * cost, the balance before and after, and asks for confirmation. When the balance is too low the
 * action must not start: the dialog says how many more tokens are needed and offers to buy a pack.
 * The API is mocked; the cost math itself is unit-tested in tokenCost.test.ts.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error { constructor(readonly status: number, code: string, message: string) { super(message); } } }));

import { CostPreviewDialog } from "@/components/wallet/CostPreview";

const ORG = "0190a000-0000-7000-8000-000000000001";
const balance = (spendable: number) => ({ organization_id: ORG, balance: spendable, spendable_balance: spendable, expired_unwritten_off: 0, low_balance: spendable < 90 });

beforeEach(() => { api.mockReset(); });

function openDialog(cost = 10, action = "Render reel") {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(<CostPreviewDialog action={action} cost={cost} open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
  return { onConfirm, onOpenChange };
}

describe("CostPreviewDialog", () => {
  // NOTE: useWalletBalance keeps the last good read in module state, shared by every test in this
  // file — so the "could not be read" case must run FIRST, before any test gives it a good balance
  // to remember. In the app the same is true: "unknown" only happens when no balance was ever read.
  it("lets the user confirm when the balance cannot be read — the server checks it before charging", async () => {
    api.mockRejectedValue(new Error("no wallet yet"));
    const { onConfirm } = openDialog(10, "Render reel");
    expect(await screen.findByText("Your balance could not be read. The server checks it before charging.")).toBeTruthy();
    const confirm = document.querySelector("[data-confirm-cost]") as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows the cost, the balance before and after, and runs the action on Continue", async () => {
    api.mockResolvedValue(balance(500));
    const { onConfirm } = openDialog(10, "Render reel");
    expect(await screen.findByText("Render reel — 10 tokens. Balance 500. After: 490.")).toBeTruthy();
    const confirm = document.querySelector("[data-confirm-cost]") as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("blocks the action when the balance is too low, states the shortfall, and offers to buy a pack", async () => {
    api.mockResolvedValue(balance(5));
    const { onConfirm } = openDialog(10, "Render reel");
    expect(await screen.findByText("Render reel — 10 tokens. Balance 5. After: —.")).toBeTruthy();
    expect(screen.getByText("You need 5 more tokens.")).toBeTruthy();
    const buy = screen.getByText("Buy tokens");
    expect(buy.closest("a")?.getAttribute("href")).toBe("/settings/wallet#tp");
    const confirm = document.querySelector("[data-confirm-cost]") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes on Cancel without running the action", async () => {
    api.mockResolvedValue(balance(500));
    const { onConfirm, onOpenChange } = openDialog(10, "Render reel");
    expect(await screen.findByText("Render reel — 10 tokens. Balance 500. After: 490.")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
