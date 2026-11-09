/** v3 Phase A.7 (ADR-072): Guided / Pro per person and per page */
import { uiPageOf } from "@otsi-vie/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const path = { value: "/studio" };
vi.mock("next/navigation", () => ({ usePathname: () => path.value, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ me: { user: { id: "u1" } } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }));

import { UiModeProvider, useUiMode } from "@/lib/uiMode";

function Probe() {
  const ui = useUiMode();
  return <div><span data-testid="mode">{ui.page}:{ui.mode}</span><button type="button" onClick={() => void ui.setMode("GUIDED")}>guided</button></div>;
}

beforeEach(() => { localStorage.clear(); api.mockReset(); path.value = "/studio"; });

describe("Guided / Pro", () => {
  it("maps each page's routes", () => {
    expect(uiPageOf("/studio")).toBe("studio");
    expect(uiPageOf("/reports/players/OTSI-NGA-2026-000001")).toBe("reports");
    expect(uiPageOf("/exports")).toBe("export");
    expect(uiPageOf("/tactics")).toBe("tactical");
    expect(uiPageOf("/dashboard")).toBe("home");
    expect(uiPageOf("/studios")).toBeNull();
    expect(uiPageOf("/settings/team")).toBeNull();
  });

  it("is Pro with no choice; the saved choice is applied to the page; Guided shows the chip", async () => {
    api.mockResolvedValueOnce({ modes: { studio: "GUIDED" } });
    render(<UiModeProvider><Probe /></UiModeProvider>);
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("studio:GUIDED"));
    expect(document.documentElement.dataset.uiMode).toBe("GUIDED");
    expect(api).toHaveBeenCalledWith("/v1/me/page-modes", { organization: false });
    expect(JSON.parse(localStorage.getItem("otsi-vie.ui-modes.u1")!)).toEqual({ studio: "GUIDED" });
    // the chip puts the page back to Pro
    api.mockResolvedValueOnce({ modes: { studio: "PRO" } });
    fireEvent.click(screen.getByText("show all controls"));
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("studio:PRO"));
    expect(api).toHaveBeenLastCalledWith("/v1/me/page-modes/studio", { method: "PUT", json: { mode: "PRO" }, organization: false });
    expect(document.documentElement.dataset.uiMode).toBe("PRO");
    expect(document.querySelector("[data-guided-chip]")).toBeNull();
  });

  it("opens in the cached mode at once and keeps the old mode when saving fails", async () => {
    localStorage.setItem("otsi-vie.ui-modes.u1", JSON.stringify({ analysis: "GUIDED" }));
    path.value = "/analysis";
    let answer: (v: unknown) => void = () => {};
    api.mockReturnValueOnce(new Promise((r) => { answer = r; }));
    render(<UiModeProvider><Probe /></UiModeProvider>);
    expect(screen.getByTestId("mode")).toHaveTextContent("analysis:GUIDED");
    await act(async () => answer({ modes: {} }));
    expect(screen.getByTestId("mode")).toHaveTextContent("analysis:PRO");
    api.mockRejectedValueOnce(new Error("down"));
    fireEvent.click(screen.getByText("guided"));
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("analysis:PRO"));
  });

  it("a page without Guided controls has no chip", async () => {
    path.value = "/library";
    api.mockResolvedValueOnce({ modes: { library: "GUIDED" } });
    render(<UiModeProvider><Probe /></UiModeProvider>);
    await waitFor(() => expect(screen.getByTestId("mode")).toHaveTextContent("library:GUIDED"));
    expect(document.querySelector("[data-guided-chip]")).toBeNull();
  });
});
