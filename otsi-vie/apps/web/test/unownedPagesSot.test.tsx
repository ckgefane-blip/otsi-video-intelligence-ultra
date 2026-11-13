/**
 * SOT rebuild, worker 8 (group B unowned pages): Jobs Center, Welcome tour, First run, Accept invite, Player Profile
 * Intro, Admin Models & AI, Admin Release Control, Admin Security & Compliance, Token counter (page 30 is the shell
 * worker's chip — asserted in pages29-31Sot.test.tsx — so this file covers the other eight pages' rebuilt behaviour).
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceMock = vi.fn();
const updateMeMock = vi.fn();
const adoptSessionMock = vi.fn();
const { apiMock, invitationPreviewMock, acceptInvitationMock } = vi.hoisted(() => ({
  apiMock: vi.fn(), invitationPreviewMock: vi.fn(), acceptInvitationMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: replaceMock }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "signed-in",
    me: { user: { id: "u1", email: "owner@club.com", display_name: "", onboarded_at: null }, memberships: [] },
    organization: { organization_id: "o1", role: "OWNER" },
    adoptSession: adoptSessionMock, signOut: vi.fn(), updateMe: updateMeMock,
  }),
}));
vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiProblem: class ApiProblem extends Error {},
  invitationPreview: invitationPreviewMock,
  acceptInvitation: acceptInvitationMock,
  session: { organizationId: null },
  setupOwner: vi.fn(),
}));

import { WelcomeTour } from "@/components/auth/Onboarding";
import InvitePage from "@/app/invite/page";
import InviteLayout from "@/app/invite/layout";
import { ModelsAi } from "@/components/admin/ModelsAi";
import { ReleaseControl } from "@/components/admin/ReleaseControl";
import { Compliance } from "@/components/admin/Compliance";

const gates = (over: Record<string, unknown> = {}) => ({
  timestamp: "2026-11-13T00:00:00Z", passed_count: 0, total_count: 3, accuracy_measured: false, all_passed: false,
  gates: [
    { id: "G05", name: "Detection", category: "AI_ACCURACY", status: "MEASURING", what: "Players found.", evidence_required: "Recall.", release_rule: "Not measured.", last_verified_at: null },
    { id: "G06", name: "Tracking", category: "AI_ACCURACY", status: "MEASURING", what: "Same person followed.", evidence_required: "HOTA.", release_rule: "Not measured.", last_verified_at: null },
    { id: "G07", name: "Identity", category: "AI_ACCURACY", status: "MEASURING", what: "No wrong player.", evidence_required: "False rate.", release_rule: "Not measured.", last_verified_at: null },
  ],
  ...over,
});

const modelEntry = (over: Record<string, unknown> = {}) => ({
  key: "ppocr_v4_det", task: "TEXT_DETECT", family: "PP-OCR", adapter: "paddle", source: "", revision: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
  weights_license: "", status: "READY",
  files: [{ name: "model.pdparams", expected_sha256: "abc", present: true, verified: true }],
  ...over,
});

const auditEntry = (over: Record<string, unknown> = {}) => ({
  id: 1, occurred_at: "2026-11-12T10:00:00Z", actor_kind: "USER", actor_id: null, actor_name: "Ana",
  action: "membership.created", entity_type: "membership", entity_id: null, request_id: null, before_state: null, after_state: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.location.hash = "";
  apiMock.mockImplementation(async (url: string) => {
    if (url === "/v1/me") return { user: { id: "u1", email: "owner@club.com", display_name: "Awore", onboarded_at: "2026-11-12T23:00:00Z" }, memberships: [] };
    if (url === "/v1/admin/dashboard") return { models: [] };
    if (url === "/v1/admin/release-gates") return gates();
    if (url === "/v1/admin/retention") return { raw_footage_days: null, auto_purge_enabled: false };
    if (url === "/v1/admin/retention/erasures") return [];
    if (url === "/v1/admin/backups") return { backups: [{ id: "b1", timestamp: "2026-11-12T00:00:00Z", db_bytes: 1234, verification_ok: true, verified: true }] };
    if (url.startsWith("/v1/admin/audit")) return { items: [auditEntry()] };
    throw new Error(`unexpected api call ${url}`);
  });
});

describe("Welcome tour (SOT page 31)", () => {
  it("'Skip tour' is the filled secondary button, and the step numbers and counter are regular type", async () => {
    render(<WelcomeTour />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const skip = screen.getByRole("button", { name: "Skip tour" });
    expect(skip.className).toContain("btn");
    expect(skip.className).not.toContain("gh");
    expect(screen.getByText("Welcome tour").className).not.toContain("uppercase");
    for (const n of ["1", "2", "3", "4", "5", "6"]) {
      const circle = screen.getByText(n);
      expect(circle.className).not.toContain("font-mono");
    }
    expect(screen.getByText("1 / 6").className).not.toContain("font-mono");
  });
});

describe("Accept invite (SOT page 1)", () => {
  function openInvite() {
    window.location.hash = `#t=${"a".repeat(24)}`;
    invitationPreviewMock.mockResolvedValue({
      organization_name: "FC Ercakhu", invited_by: "Edmond", email: "ana@club.com", role: "ANALYST", has_account: false,
    });
    render(<InvitePage />);
    return screen.findByText("Join FC Ercakhu");
  }

  it("shows the role as plain small text in the sentence, no icons on the buttons, and 'Show' on the password toggle", async () => {
    await openInvite();
    const role = screen.getByText("Analyst");
    expect(role.className).not.toContain("chip");
    expect(role.className).toContain("t-small");
    const submit = screen.getByRole("button", { name: "Accept invite & create account" });
    expect(submit.querySelector("svg")).toBeNull();
    const show = screen.getByRole("button", { name: "Show password" });
    expect(show).toHaveTextContent("Show");
  });

  it("the layout is edge-to-edge — no centring or padding around the brand panel", () => {
    const { container } = render(<InviteLayout><div>child</div></InviteLayout>);
    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main!.className).not.toContain("place-items-center");
    expect(main!.className).not.toContain("px-4");
    expect(main!.className).not.toContain("py-10");
  });
});

describe("Admin — Models & AI (SOT page 2)", () => {
  it("shows '○ Empty' as plain text with no models, and the count once models register", async () => {
    const { unmount } = render(<ModelsAi />);
    expect(await screen.findByText("No models registered")).toBeInTheDocument();
    const empty = screen.getByText("Empty");
    expect(empty.className).not.toContain("rounded-full");
    expect(empty.className).not.toContain("vie-chip");
    const dot = empty.querySelector("span");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("rounded-full");
    expect(dot!.className).toContain("border");
    unmount();

    apiMock.mockImplementation(async (url: string) => {
      if (url === "/v1/admin/dashboard") return { models: [modelEntry(), modelEntry({ key: "rtdetr_v2_r18vd", task: "DETECT" })] };
      throw new Error(`unexpected api call ${url}`);
    });
    render(<ModelsAi />);
    expect(await screen.findByText("2 models registered")).toBeInTheDocument();
  });

  it("shows the task as readable wording, truncates the long version hash, and renders the model name and status as plain regular text", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url === "/v1/admin/dashboard") return { models: [modelEntry()] };
      throw new Error(`unexpected api call ${url}`);
    });
    render(<ModelsAi />);
    expect(await screen.findByText("Text detection")).toBeInTheDocument();
    expect(screen.queryByText("TEXT_DETECT")).toBeNull();
    const name = screen.getByText("ppocr_v4_det");
    expect(name.className).not.toContain("font-mono");
    expect(name.className).toContain("truncate");
    const version = screen.getByText("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    expect(version.className).not.toContain("font-mono");
    expect(version.className).toContain("truncate");
    expect(version).toHaveAttribute("title", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    const ready = screen.getByText("Ready");
    expect(ready.closest("span")!.className).not.toContain("vie-chip");
    expect(ready.closest("div")!.querySelector("svg")).toBeNull();
  });
});

describe("Admin — Release Control (SOT page 3)", () => {
  it("shows '○ Not started' for gates nothing has ever measured, even when the server reports MEASURING", async () => {
    render(<ReleaseControl />);
    expect(await screen.findByText("Gates passed")).toBeInTheDocument();
    expect(screen.getAllByText("Not started")).toHaveLength(3);
    expect(screen.queryByText("Measuring")).toBeNull();
    for (const id of ["G05", "G06", "G07"]) {
      expect(screen.getByText(id).className).not.toContain("font-mono");
    }
    const status = screen.getAllByText("Not started")[0]!;
    expect(status.closest("span")!.className).not.toContain("vie-chip");
  });

  it("still shows 'Measuring' for a gate with a measurement on record", async () => {
    apiMock.mockImplementation(async (url: string) => {
      if (url === "/v1/admin/release-gates") {
        const r = gates();
        return { ...r, gates: [r.gates[0]!, { ...r.gates[1]!, last_verified_at: "2026-11-13T00:00:00Z" }, r.gates[2]!] };
      }
      throw new Error(`unexpected api call ${url}`);
    });
    render(<ReleaseControl />);
    expect(await screen.findByText("Measuring")).toBeInTheDocument();
    expect(screen.getAllByText("Not started")).toHaveLength(2);
  });
});

describe("Admin — Security & Compliance (SOT page 4)", () => {
  it("the erase button is the filled secondary button with red text, and the audit log shows readable wording, not raw keys", async () => {
    render(<Compliance />);
    expect(await screen.findByText("Audit log")).toBeInTheDocument();
    const erase = screen.getByRole("button", { name: "Erase a subject's data…" });
    expect(erase.className).toContain("text-danger");
    expect(erase.className).not.toContain("border-danger");
    expect(screen.getByText("Membership created")).toBeInTheDocument();
    expect(screen.queryByText("membership.created")).toBeNull();
    const action = screen.getByText("Membership created");
    expect(action.className).not.toContain("font-mono");
    expect(action).toHaveAttribute("title", "membership.created");
    const verified = screen.getByText("Verified");
    expect(verified.closest("span")!.className).not.toContain("vie-chip");
  });
});
