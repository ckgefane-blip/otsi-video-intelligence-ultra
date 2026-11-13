/**
 * SOT Pages 25-28: the shared link (password gate + recipient view) and the sign-in page, rebuilt to the SOT.
 * The gate is the centred panel; the view has the header, the player, the three file rows, the comments
 * aside and the measured-figures footer. The sign-in page is the two-column layout with the form top-aligned
 * and the two-step panel below it — the boxes stay disabled until a challenge arrives, then they take the code.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ token: "abc123" }),
}));

const signIn = vi.fn();
const signInWithCode = vi.fn();
const signInWithPasskey = vi.fn();
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "signed-out",
    me: null,
    organization: null,
    signIn,
    signInWithCode,
    signInWithPasskey,
    adoptSession: vi.fn(),
    signOut: vi.fn(),
    chooseOrganization: vi.fn(),
    updateMe: vi.fn(),
  }),
}));
const webauthn = vi.hoisted(() => ({ supported: true }));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: () => webauthn.supported }));
vi.mock("@/lib/api", () => ({
  ApiProblem: class ApiProblem extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
  },
}));

import LoginPage from "@/app/login/page";
import SharedReelPage from "@/app/s/[token]/page";

const VIDEO_VIEW = {
  kind: "VIDEO",
  title: "Chinazom Godwin — highlights",
  player_name: "Chinazom Godwin",
  player_jersey_number: 4,
  player_position: "DM",
  player_club: "FC Ercakhu",
  organization_name: "Gefane United",
  url: "https://example.invalid/reel.mp4",
  download_url: "https://example.invalid/reel.mp4?dl=1",
  mime: "video/mp4",
  link_expires_at: "2026-12-01T00:00:00.000Z",
  notice: "Shared from OTSI VIE. Development output: commercial distribution is not activated.",
  can_comment: true,
  comments: [],
};

/** the page reads the gate (GET .../gate) and the view (GET ...) separately: route the stub by URL */
function mockShare(gateBody: unknown, openBody: unknown, openOk = true, openStatus = 200) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/gate")) {
      return gateBody === null
        ? Promise.resolve({ ok: false, status: 404, json: async () => ({ message: "This link does not exist." }) })
        : Promise.resolve({ ok: true, status: 200, json: async () => gateBody });
    }
    return Promise.resolve({ ok: openOk, status: openStatus, json: async () => openBody });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  webauthn.supported = true;
});

describe("shared link password gate (Page 25)", () => {
  it("shows the SOT gate: title, organisation line, password with Show, Open, and the expiry", async () => {
    // the org and expiry come from the gate endpoint, not the 401 body
    mockShare({ organization_name: "Gefane United", expires_at: "2026-12-01T00:00:00.000Z", has_password: true },
      { code: "PASSWORD_REQUIRED", message: "This video is protected by a password." }, false, 401);
    render(<SharedReelPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "This link is protected" })).toBeInTheDocument());
    expect(screen.getByText(/Gefane United shared a Scouting Pack with you/)).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    // SOT: the Show button is text-only ("Show"), no eye icon
    expect(screen.getByRole("button", { name: "Show password" })).toHaveTextContent(/^Show$/);
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(screen.getByText(/Link expires/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    expect(screen.getByRole("button", { name: "Open" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  });

  it("without an organisation or expiry from the gate keeps the generic line and shows no expiry", async () => {
    mockShare({ organization_name: null, expires_at: null, has_password: true },
      { code: "PASSWORD_REQUIRED", message: "This video is protected by a password." }, false, 401);
    render(<SharedReelPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "This link is protected" })).toBeInTheDocument());
    expect(screen.getByText(/An organisation shared a Scouting Pack with you/)).toBeInTheDocument();
    expect(screen.queryByText(/Link expires/)).not.toBeInTheDocument();
  });

  it("a bad link shows the OTSI logo over 'This link does not exist.'", async () => {
    mockShare(null, { message: "This link does not exist." }, false, 404);
    render(<SharedReelPage />);
    await waitFor(() => expect(screen.getByText("This link does not exist.")).toBeInTheDocument());
    expect(screen.getByAltText("OTSI")).toBeInTheDocument();
  });
});

describe("shared link recipient view (Page 26)", () => {
  it("shows the header, the reel, the three file rows, the comments aside and the footer", async () => {
    mockShare({ organization_name: "Gefane United", expires_at: "2026-12-01T00:00:00.000Z", has_password: false }, VIDEO_VIEW);
    render(<SharedReelPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Chinazom Godwin — highlights" })).toBeInTheDocument());
    expect(screen.getByText("Shared with you by Gefane United")).toBeInTheDocument();
    // the expiry is plain text, not a chip
    expect(screen.getByText(/Link expires/)).toBeInTheDocument();
    expect(screen.getByText(/Link expires/).className).not.toContain("chip");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", VIDEO_VIEW.download_url);
    expect(screen.getByText("Scouting Pack")).toBeInTheDocument();
    expect(screen.getByText("Chinazom Godwin · #4 · DM · FC Ercakhu")).toBeInTheDocument();
    // the player plays the signed reel address; the SOT's "No playable footage" is the player's
    // no-footage state, which appears when the video cannot be played
    const video = document.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("src", VIDEO_VIEW.url);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    // a video that cannot be played shows the failed state, with "Open local footage" to play it here
    fireEvent.error(video!);
    await waitFor(() => expect(screen.getByText("Playback unavailable")).toBeInTheDocument());
    expect(screen.getByText("Open local footage")).toBeInTheDocument();
    // the three file rows are open rows with a top rule, not boxed panels
    expect(screen.getByText("Highlight reel").closest("div")!.className).not.toContain("panel");
    expect(document.querySelectorAll(".panel")).toHaveLength(0);
    // the comments aside
    expect(screen.getByText("Comments")).toBeInTheDocument();
    // the comment count is regular type, not monospace
    expect(within(screen.getByLabelText("Comments")).getByText("0").className).not.toContain("mono");
    expect(screen.getByText("MP4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download reel" })).toHaveAttribute("href", VIDEO_VIEW.download_url);
    expect(screen.getByText("Player report")).toBeInTheDocument();
    expect(screen.getByText("AI Analyst brief")).toBeInTheDocument();
    expect(screen.getAllByText("Not included")).toHaveLength(1);
    expect(screen.getByText("Not included · not published")).toBeInTheDocument();
    // the comments aside
    expect(screen.getByText("Comments")).toBeInTheDocument();
    expect(screen.getByText("No comments yet.")).toBeInTheDocument();
    expect(screen.getByText("Comments are pinned to the current time.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveAttribute("placeholder", "Shown with your comment");
    expect(screen.getByLabelText(/Comment at/)).toHaveAttribute("placeholder", "What did you notice here?");
    expect(screen.getByRole("button", { name: "Post comment" })).toBeDisabled();
    expect(screen.getByText("Figures measured by OTSI VIE. Unmeasured values are marked.")).toBeInTheDocument();
  });

  it("posts a comment pinned to the current time", async () => {
    const comments = [{ id: "11111111-1111-1111-1111-111111111111", name: "Scout", body: "Good run", at_s: 0, created_at: "2026-11-12T10:00:00.000Z" }];
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({ ok: true, status: 200, json: async () => (String(url).includes("/comments") ? comments : VIDEO_VIEW) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SharedReelPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Post comment" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Scout" } });
    fireEvent.change(screen.getByLabelText(/Comment at/), { target: { value: "Good run" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const postCall = fetchMock.mock.calls[2]!;
    expect(postCall[0]).toContain("/comments");
    expect(JSON.parse(String(postCall[1].body))).toMatchObject({ name: "Scout", body: "Good run", at_s: 0 });
    await waitFor(() => expect(screen.getByText("Good run")).toBeInTheDocument());
  });
});

describe("sign-in page (Page 27)", () => {
  it("shows the SOT layout: the pitch and promise, the form top-aligned, and the two-step panel below it (disabled)", async () => {
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Prove what a player did on the pitch." })).toBeInTheDocument());
    expect(screen.getByText("Video work stays on this computer")).toBeInTheDocument();
    expect(screen.getByText("Welcome back")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    // the form is top-aligned and the two-step card sits BELOW it, not beside it (SOT)
    const main = screen.getByRole("main");
    expect(main.className).toContain("flex-col");
    expect(main.className).toContain("justify-start");
    const form = main.querySelector("form")!;
    const panel = screen.getByText("Enter your verification code").closest("section")!;
    expect(form.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // no icons on the buttons (the SOT has none; a spinner shows only while a press is busy)
    for (const name of ["Sign in", /Sign in with a passkey/, "Verify"] as const) {
      expect(screen.getByRole("button", { name }).querySelector("svg")).toBeNull();
    }
    expect(screen.getByLabelText("Email")).toHaveAttribute("placeholder", "you@club.com");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    // SOT: "Forgot password?" is a link, not a button — and there is still no self-service reset (ADR-143)
    expect(screen.getByRole("link", { name: "Forgot password?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in with a passkey/ })).toBeInTheDocument();
    expect(screen.getByText("v[—]")).toBeInTheDocument();
    expect(screen.getByText("Invited by your organisation?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Accept your invite" })).toHaveAttribute("href", "/invite");
    // the two-step panel is the "next step" preview: the boxes and Verify are disabled until a challenge
    expect(screen.getByRole("heading", { name: "Enter your verification code" })).toBeInTheDocument();
    expect(screen.getByText("Next step · when two-step is on")).toBeInTheDocument();
    expect(screen.getByLabelText("Digit 1")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use a recovery code instead" })).toBeInTheDocument();
    // the forgot-password note says there is no self-service reset
    fireEvent.click(screen.getByRole("link", { name: "Forgot password?" }));
    expect(screen.getByText(/no self-service password reset/)).toBeInTheDocument();
  });

  it("shows the passkey button even where passkeys do not work, and says so on click", async () => {
    webauthn.supported = false;
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument());
    const passkey = screen.getByRole("button", { name: /Sign in with a passkey/ });
    expect(passkey).toBeInTheDocument();
    fireEvent.click(passkey);
    expect(await screen.findByText("This browser does not support passkeys here. Use your password.")).toBeInTheDocument();
    expect(signInWithPasskey).not.toHaveBeenCalled();
  });

  it("activates the two-step panel after the password is accepted, and verifies the code", async () => {
    signIn.mockResolvedValue({ mfa_token: "tok123", expires_in: 300 });
    signInWithCode.mockResolvedValue(undefined);
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "karo@club.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByLabelText("Digit 1")).not.toBeDisabled());
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
    const panel = screen.getByRole("heading", { name: "Enter your verification code" }).closest("section") as HTMLElement;
    const boxes = within(panel).getAllByRole("textbox");
    expect(boxes).toHaveLength(6);
    "123456".split("").forEach((d, i) => fireEvent.change(boxes[i]!, { target: { value: d } }));
    expect(screen.getByRole("button", { name: "Verify" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(signInWithCode).toHaveBeenCalledWith("tok123", "123456"));
  });

  it("swaps the boxes for a recovery-code field", async () => {
    signIn.mockResolvedValue({ mfa_token: "tok123", expires_in: 300 });
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "karo@club.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByLabelText("Digit 1")).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code instead" }));
    expect(screen.queryByLabelText("Digit 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use the 6-digit code instead" })).toBeInTheDocument();
  });
});
