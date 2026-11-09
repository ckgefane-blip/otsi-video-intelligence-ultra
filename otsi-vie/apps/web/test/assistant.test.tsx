import { parseAssistantCommand } from "@otsi-vie/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LocalAssistant } from "@/components/shell/LocalAssistant";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, ApiProblem: Error }));

it("accepts only explicit supported commands and recognized Smart Search filters", () => {
  expect(parseAssistantCommand(" OPEN Library ")).toEqual({ kind: "open", page: "library" });
  expect(parseAssistantCommand("show jobs")).toEqual({ kind: "jobs" });
  expect(parseAssistantCommand("search event:goal")).toEqual({ kind: "search", query: "event:goal" });
  for (const command of ["open https://example.com", "open export", "confirm identity", "search event:made-up", "search a", "search " + "a".repeat(81)]) {
    expect(parseAssistantCommand(command)).toBeNull();
  }
});

it("previews a guide command and waits for explicit approval before navigation", async () => {
  api.mockReset();
  api.mockResolvedValueOnce({ id: "plan-id", step: { kind: "open", page: "library" } });
  api.mockResolvedValueOnce({ kind: "open", page: "library" });
  const navigate = vi.fn();
  render(<LocalAssistant navigate={navigate} />);
  fireEvent.click(screen.getByRole("button", { name: "Use command for Find project media" }));
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Preview plan" }));
  const approve = await screen.findByRole("button", { name: "Approve and run" });
  expect(api).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(approve);
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/library"));
  expect(api).toHaveBeenLastCalledWith("/v1/assistant/plans/plan-id/approve", expect.objectContaining({ method: "POST" }));
});
