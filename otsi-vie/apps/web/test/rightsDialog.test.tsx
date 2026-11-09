/** v3 Phase A.11 (ADR-077): Upload's rights block */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  class ApiProblem extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
  return { ApiProblem, api: (...a: unknown[]) => api(...a) };
});
const page = { prefs: { sendToAnalysis: true } as Record<string, unknown>, say: vi.fn() };
vi.mock("@/components/upload/page02", () => ({ usePage02: () => page }));
const up = { rights: null as unknown, setRights: vi.fn(), rightsDialog: true, setRightsDialog: vi.fn() };
vi.mock("@/components/upload/UploadWorkspace", () => ({ useUpload: () => up }));

import { DeclareRightsDialog, rightsOf, rightsSummary, UploadRightsDialog } from "@/components/upload/RightsDialog";

const answer = (q: string, choice: string) => fireEvent.click(within(document.querySelector(`[data-question=${q}]`) as HTMLElement).getByRole("radio", { name: choice }));

beforeEach(() => {
  api.mockReset(); page.say.mockReset(); up.setRights.mockReset(); up.setRightsDialog.mockReset();
  up.rights = null; up.rightsDialog = true;
});

describe("rights block", () => {
  it("complete answers only; downloads need sharing; the summary reads plainly", () => {
    const base = { analyse: true, share: false, download: null, guardian_consent: "NOT_APPLICABLE" as const, confirm: true };
    expect(rightsOf(base)).toEqual({ analyse: true, share: false, download: false, guardian_consent: "NOT_APPLICABLE", confirm: true });
    expect(rightsOf({ ...base, confirm: false })).toBeNull();
    expect(rightsOf({ ...base, share: true })).toBeNull();                      // sharing asks the download question
    expect(rightsOf({ ...base, analyse: null })).toBeNull();
    expect(rightsSummary({ analyse: true, share: false, download: false, guardian_consent: "NOT_APPLICABLE", confirm: true })).toBe("analyse · internal only");
    expect(rightsSummary({ analyse: false, share: true, download: true, guardian_consent: "PENDING", confirm: true })).toBe("no analysis · share + download · consent pending");
  });

  it("the page's answers: saved only when every question is answered and confirmed", () => {
    render(<UploadRightsDialog />);
    const save = screen.getByRole("button", { name: "Use for my uploads" });
    expect(save).toBeDisabled();
    answer("analyse", "Yes");
    answer("share", "No");
    expect(within(document.querySelector("[data-question=download]") as HTMLElement).getByRole("radio", { name: "Yes" })).toBeDisabled();
    answer("guardian_consent", "Minors, consent asked for but not given yet");
    expect(screen.getByText(/not analysed until an Owner or Admin records the consent/)).toBeInTheDocument();
    answer("guardian_consent", "No minors in it");
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm" }));
    fireEvent.click(save);
    expect(up.setRights).toHaveBeenCalledWith({ analyse: true, share: false, download: false, guardian_consent: "NOT_APPLICABLE", confirm: true });
    expect(up.setRightsDialog).toHaveBeenCalledWith(false);
    expect(page.say).toHaveBeenCalledWith("Rights for the next uploads: analyse · internal only");
  });

  it("No to analysis with Send to Analysis on says the video will not be analysed", () => {
    render(<UploadRightsDialog />);
    answer("analyse", "No");
    expect(screen.getByText(/uploaded and not analysed/)).toBeInTheDocument();
  });

  it("a video without rights: they are recorded on it, and a refusal is shown", async () => {
    const done = vi.fn(), close = vi.fn();
    api.mockResolvedValueOnce({ video_id: "v1", grant: { allowed_uses: ["VIEW", "ANALYZE", "PRODUCE"] }, analysis_blocked: null });
    render(<DeclareRightsDialog videoId="v1" name="Bell Match" open onOpenChange={close} onDone={done} />);
    answer("analyse", "Yes"); answer("share", "Yes"); answer("download", "No"); answer("guardian_consent", "Minors, guardian consent on file");
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm" }));
    fireEvent.click(screen.getByRole("button", { name: "Record rights" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith("/v1/videos/v1/rights/declaration", { method: "POST", json: { analyse: true, share: true, download: false, guardian_consent: "VERIFIED", confirm: true } });
    expect(close).toHaveBeenCalledWith(false);
    const { ApiProblem } = await import("@/lib/api");
    api.mockRejectedValueOnce(new ApiProblem(409, "RIGHTS_ALREADY_RECORDED", "This video's rights are already recorded."));
    fireEvent.click(screen.getByRole("button", { name: "Record rights" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already recorded");
  });
});
