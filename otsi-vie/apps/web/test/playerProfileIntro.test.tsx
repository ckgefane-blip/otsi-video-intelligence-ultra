/**
 * Player Profile Intro (ADR-130): the preview shows real numbers when measured and "Not measured" / "Not entered" / "Unconfirmed"
 * everywhere else — never a placeholder number; the verified badge only when verified; user-entered fields carry their provenance mark
 * and the team sheet's club beats the user-entered one; the details form sends only what changed; the photo upload sends raw bytes.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpotlightSettings, type PlayerProfileIntro, type Reel } from "@otsi-vie/contracts";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => ({ get: vi.fn(() => null) }), useRouter: () => ({ push: vi.fn() }), usePathname: () => "/reels" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { role: "OWNER" } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), apiBlob: vi.fn(), ApiProblem: class ApiProblem extends Error {} }));

import { PlayerProfileIntroPanel, PlayerProfileIntroView, ProfileIntroDialog } from "@/components/reels/PlayerProfileIntro";
import { ReelBuilder, ReelOverlays, ReelProfileIntro, ReelSteps } from "@/components/reels/ReelBuilder";
import { ReelExtras } from "@/components/reelstage/ReelExtras";
import { buildDetailsPatch, PlayersList } from "@/components/players/PlayersList";

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn() as never;

const RULE = "Player Identity Verified means: the player is registered with his permanent OTSI Player ID, a person confirmed at least one track as him, and (for a reel) the reel's targets are still current.";
const ASSISTS_REASON = "The engine does not link a pass to a goal.";
const FORM_REASON = "No per-match rating model yet.";

const details = (over: Record<string, unknown> = {}) => ({
  height_cm: 182, weight_kg: 73, photo_asset_id: "0193132e-5034-7bc3-9565-df048bb010a1", photo_url: "https://example.invalid/photo.png",
  strengths: ["Excellent Ball Control", "Strong Passing Ability"], summary: "Dynamic midfielder with excellent vision.",
  club_name: "Rayo Vallecano", league: "La Liga",
  international_country_code: "FRA", international_country_name: "France", international_caps: 32, international_goals: 7,
  updated_by_name: "Ana", updated_at: "2026-11-10T00:00:00.000Z", ...over,
});
const profile = (over: Record<string, unknown> = {}) => ({
  birth_date: "2002-06-24", age: 24, preferred_foot: "RIGHT", nationality: { code: "FRA", name: "France" }, position: "CM",
  role_confirmed: true, role_confirmation_state: "ROLE_CONFIRMED", role_confirmed_by: "u1", role_confirmed_at: "2026-11-09T00:00:00.000Z",
  role_confirmed_by_name: "Ana", latest_team: { team: "Real Madrid", jersey_number: 15, position: "CM" },
  details: details(), editable: true, ...over,
});
const intro = (over: Record<string, unknown> = {}): PlayerProfileIntro => ({
  player: {
    player_id: "0193132e-5034-7bc3-9565-df048bb01001", canonical_otsi_id: "OTSI-FRA-2026-000123",
    own_canonical_otsi_id: "OTSI-FRA-2026-000123", canonical_state: "REGISTERED",
    resolved_player_id: "0193132e-5034-7bc3-9565-df048bb01001", display_name: "Sugh", identity_label: "REGISTERED_PLAYER",
  },
  profile: profile(),
  verified: true, verified_rule: RULE, reel_id: null,
  stats: { games_analysed: 8, minutes_seen: 712, goals: 2, assists: null, basis: "Measured from his confirmed tracks.", assists_reason: ASSISTS_REASON },
  heat: null,
  recent_form: { ratings: null, reason: FORM_REASON },
  ...over,
} as unknown as PlayerProfileIntro);

beforeEach(() => { api.mockReset(); });

describe("PlayerProfileIntroView", () => {
  it("shows real numbers when measured, and 'Not measured' with the reason for assists and recent form", () => {
    render(<PlayerProfileIntroView intro={intro()} onContinue={() => undefined} />);
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("712 min")).toBeTruthy();
    expect(screen.getByText("minutes seen on camera")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText(ASSISTS_REASON)).toBeTruthy();
    expect(screen.getByText(FORM_REASON)).toBeTruthy();
    expect(screen.getAllByText("Not measured").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Measured from his confirmed tracks.")).toBeTruthy();
  });

  it("shows 'Not measured' for a null stat instead of a placeholder number", () => {
    const i = intro({ stats: { games_analysed: null, minutes_seen: null, goals: null, assists: null, basis: "Measured from his confirmed tracks.", assists_reason: ASSISTS_REASON } });
    render(<PlayerProfileIntroView intro={i} />);
    expect(screen.getAllByText("Not measured").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("712 min")).toBeNull();
  });

  it("shows the verified badge only when verified, and the unconfirmed note when not", () => {
    const { unmount } = render(<PlayerProfileIntroView intro={intro({ verified: true })} />);
    expect(screen.getByText("✓ Player Identity Verified")).toBeTruthy();
    expect(screen.queryByText("Identity unconfirmed")).toBeNull();
    unmount();
    render(<PlayerProfileIntroView intro={intro({ verified: false })} />);
    expect(screen.queryByText("✓ Player Identity Verified")).toBeNull();
    expect(screen.getByText("Identity unconfirmed")).toBeTruthy();
    expect(screen.getByText(RULE)).toBeTruthy();
  });

  it("marks user-entered fields, and the team sheet's club beats the user-entered one", () => {
    render(<PlayerProfileIntroView intro={intro()} />);
    expect(screen.getAllByText("Real Madrid")).toHaveLength(2);   // Current Club + Club & League
    expect(screen.queryByText("Rayo Vallecano")).toBeNull();
    expect(screen.getAllByText("Entered by user")).toHaveLength(6);  // photo, height/weight, strengths, summary, league, international
    expect(screen.getByText("1.82 m / 73 kg")).toBeTruthy();
    expect(screen.getByText("32 Caps | 7 Goals")).toBeTruthy();
  });

  it("shows the user-entered club with its mark when there is no team sheet, and 'Unconfirmed' with no OTSI Player ID", () => {
    const i = intro({
      player: { player_id: "0193132e-5034-7bc3-9565-df048bb01001", canonical_otsi_id: null, own_canonical_otsi_id: null, canonical_state: "PROVISIONAL", resolved_player_id: "0193132e-5034-7bc3-9565-df048bb01001", display_name: "Sugh", identity_label: "PROVISIONAL_PLAYER" },
      profile: profile({ latest_team: null }),
    });
    render(<PlayerProfileIntroView intro={i} />);
    expect(screen.getAllByText("Rayo Vallecano")).toHaveLength(2);
    expect(screen.getByText("Unconfirmed — no OTSI Player ID yet")).toBeTruthy();
  });

  it("shows 'Not entered' for empty user-entered fields and 'No photo' with no picture — never a stock face", () => {
    const i = intro({ profile: profile({ latest_team: null, details: details({ height_cm: null, weight_kg: null, photo_url: null, strengths: [], summary: null, club_name: null, league: null, international_country_code: null, international_country_name: null, international_caps: null, international_goals: null }) }) });
    render(<PlayerProfileIntroView intro={i} />);
    expect(screen.getByText("No photo")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Photo of/ })).toBeNull();
    expect(screen.getAllByText("Not entered").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("Entered by user")).toBeNull();
  });

  it("draws the measured heat grid when present, and the pitch outline with 'Not measured' when not", () => {
    const heat = { subject: { kind: "TRACK", id: "t1" }, length_m: 105, width_m: 68, cols: 7, rows: 5, seconds: Array(35).fill(0).map((_, i) => (i === 17 ? 120 : 0)), seen_s: 600, measured_s: 120, ends_as_filmed: true as const };
    const { unmount } = render(<PlayerProfileIntroView intro={intro({ heat })} />);
    expect(screen.getByLabelText("Heat map of Sugh")).toBeTruthy();
    expect(screen.queryByLabelText("Pitch outline, no heat measured")).toBeNull();
    unmount();
    render(<PlayerProfileIntroView intro={intro({ heat: null })} />);
    expect(screen.getByLabelText("Pitch outline, no heat measured")).toBeTruthy();
  });

  it("calls onContinue from 'Continue to Reel'", () => {
    const onContinue = vi.fn();
    render(<PlayerProfileIntroView intro={intro()} onContinue={onContinue} />);
    fireEvent.click(screen.getByText("Continue to Reel ›"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe("PlayerProfileIntroPanel and dialog", () => {
  it("fetches the intro with ?reel_id= and shows it; a failed read is named", async () => {
    api.mockImplementation((url: string) => {
      if (url === "/v1/players/0193132e-5034-7bc3-9565-df048bb01001/profile-intro?reel_id=0193132e-5034-7bc3-9565-df048bb01e01") return Promise.resolve(intro());
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    const onContinue = vi.fn();
    render(<ProfileIntroDialog playerId="0193132e-5034-7bc3-9565-df048bb01001" reelId="0193132e-5034-7bc3-9565-df048bb01e01" open onContinue={onContinue} onClose={() => undefined} />);
    expect(await screen.findByText("Sugh")).toBeTruthy();
    expect(api).toHaveBeenCalledWith("/v1/players/0193132e-5034-7bc3-9565-df048bb01001/profile-intro?reel_id=0193132e-5034-7bc3-9565-df048bb01e01");
    fireEvent.click(screen.getByText("Continue to Reel ›"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("names a failed intro read instead of showing an empty preview", async () => {
    api.mockRejectedValue(new Error("down"));
    render(<PlayerProfileIntroPanel playerId="0193132e-5034-7bc3-9565-df048bb01001" />);
    expect(await screen.findByText("The player profile could not be loaded.")).toBeTruthy();
  });
});

describe("profile_intro setting", () => {
  it("flips in the ReelExtras dialog (where the match card toggle lives)", () => {
    api.mockResolvedValue([]);
    const onChange = vi.fn();
    render(<ReelExtras settings={SpotlightSettings.parse({})} onChange={onChange} onClose={() => undefined} />);
    fireEvent.click(screen.getByText("Player Profile Intro"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ profile_intro: false }));
    expect(onChange.mock.calls[0]![0]).toMatchObject({ match_card: true });
  });
});

const reelFixture = (over: Record<string, unknown> = {}): Reel => ({
  id: "0193132e-5034-7bc3-9565-df048bb01e01", name: "Sugh — highlights", video_id: "0193132e-5034-7bc3-9565-df048bb01e02",
  player: { player_id: "0193132e-5034-7bc3-9565-df048bb01001", display_name: "Sugh", canonical_otsi_id: "OTSI-FRA-2026-000123" },
  targets: [], clips: [], duration_us: 0, version: 3, stale: false, latest_render: null, last_good_render: null,
  settings: SpotlightSettings.parse({}), match: null, ...over,
} as unknown as Reel);

function mockReelApi(reel: Reel, introValue: unknown = intro()) {
  api.mockImplementation((url: string) => {
    if (url === `/v1/reels/${reel.id}`) return Promise.resolve(reel);
    if (url === `/v1/reels/${reel.id}/moments`) return Promise.resolve([]);
    if (url === `/v1/reels/${reel.id}/history`) return Promise.resolve(null);
    if (url.startsWith("/v1/players/") && url.includes("/profile-intro")) return Promise.resolve(introValue);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

describe("Reel Builder profile step", () => {
  it("lists Profile Intro first in the steps, and the preview's Continue advances", async () => {
    const reel = reelFixture();
    mockReelApi(reel);
    const onContinue = vi.fn();
    render(<ReelBuilder reelId={reel.id}><ReelSteps /><ReelProfileIntro onContinue={onContinue} /></ReelBuilder>);
    expect(await screen.findByText("Sugh — highlights")).toBeTruthy();
    const steps = document.querySelectorAll("[data-reel-step]");
    expect([...steps].map((li) => li.getAttribute("data-reel-step"))[0]).toBe("Profile Intro");
    expect(screen.getByText(/opens the reel: Sugh/)).toBeTruthy();
    expect(await screen.findByText("Key Performance Stats")).toBeTruthy();
    fireEvent.click(screen.getByText("Continue to Reel ›"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("shows nothing for the intro step when the intro is off for the reel", async () => {
    const reel = reelFixture({ settings: SpotlightSettings.parse({ profile_intro: false }) });
    mockReelApi(reel);
    render(<ReelBuilder reelId={reel.id}><ReelSteps /><ReelProfileIntro /></ReelBuilder>);
    expect(await screen.findByText("Sugh — highlights")).toBeTruthy();
    expect(screen.getByText(/off for this reel/)).toBeTruthy();
    expect(screen.queryByText("Key Performance Stats")).toBeNull();
  });

  it("the Overlays toggle persists profile_intro through the existing settings PATCH", async () => {
    const reel = reelFixture();
    mockReelApi(reel);
    render(<ReelBuilder reelId={reel.id}><ReelOverlays /></ReelBuilder>);
    const box = await screen.findByLabelText(/Player Profile Intro/);
    expect((box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/reels/${reel.id}`,
      expect.objectContaining({ method: "PATCH", json: { version: 3, settings: { profile_intro: false } } })));
  });
});

describe("buildDetailsPatch", () => {
  it("sends only changed fields, clears emptied ones to null, and caps strengths at 6", () => {
    const saved = details({ height_cm: 180, club_name: "Old Club", strengths: ["Pace"] });
    // the draft mirrors everything saved except the field under test
    const base = { height: "180", weight: "73", strengths: ["Pace"], summary: "Dynamic midfielder with excellent vision.", club: "Old Club", league: "La Liga", country: "FRA", caps: "32", goals: "7" };
    expect(buildDetailsPatch(saved, { ...base, height: "182" })).toEqual({ height_cm: 182 });
    expect(buildDetailsPatch(saved, { ...base, club: "" })).toEqual({ club_name: null });
    expect(buildDetailsPatch(null, { ...base, height: "", weight: "", strengths: ["a", "b", "c", "d", "e", "f", "g"], summary: "", club: "", league: "", country: "", caps: "", goals: "" }))
      .toEqual({ strengths: ["a", "b", "c", "d", "e", "f"] });
    expect(buildDetailsPatch(saved, { ...base, strengths: [] })).toEqual({ strengths: null });
    expect(buildDetailsPatch(saved, base)).toEqual({});
  });
});

const playerEntry = (over: Record<string, unknown> = {}) => ({
  player_id: "0193132e-5034-7bc3-9565-df048bb01001", display_name: "Sugh", canonical_otsi_id: "OTSI-FRA-2026-000123",
  profile: profile({ details: details({ height_cm: 180, club_name: "Old Club", strengths: ["Pace"], photo_url: null, photo_asset_id: null }) }),
  ...over,
});

function mockPlayersApi(entry: ReturnType<typeof playerEntry>, updatedProfile?: unknown) {
  api.mockImplementation((url: string, init?: { method?: string }) => {
    if (url === "/v1/player-list") return Promise.resolve([entry]);
    if (url === "/v1/countries") return Promise.resolve([{ code: "FRA", name: "France" }]);
    if (url === `/v1/players/${entry.player_id}/profile-details` && init?.method === "PATCH") return Promise.resolve(updatedProfile);
    if (url === `/v1/players/${entry.player_id}/photo` && init?.method === "POST") return Promise.resolve(updatedProfile);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

async function openDetails() {
  render(<PlayersList />);
  expect(await screen.findByText("Sugh")).toBeTruthy();
  fireEvent.click(screen.getByText("Profile details for the intro"));
}

describe("PlayersList profile details", () => {
  it("sends only the changed field when saving details", async () => {
    const entry = playerEntry();
    const updated = profile({ details: details({ height_cm: 182, club_name: "Old Club", strengths: ["Pace"], photo_url: null, photo_asset_id: null }) });
    mockPlayersApi(entry, updated);
    await openDetails();
    fireEvent.change(screen.getByLabelText("Sugh height in centimetres"), { target: { value: "182" } });
    fireEvent.click(screen.getByText("Save profile details"));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/players/${entry.player_id}/profile-details`,
      expect.objectContaining({ method: "PATCH", json: { height_cm: 182 } })));
    expect(await screen.findByText("Profile details saved.")).toBeTruthy();
  });

  it("clears an emptied field to null and never to 0", async () => {
    const entry = playerEntry();
    const updated = profile({ details: details({ height_cm: 180, club_name: null, strengths: ["Pace"], photo_url: null, photo_asset_id: null }) });
    mockPlayersApi(entry, updated);
    await openDetails();
    fireEvent.change(screen.getByLabelText("Sugh club"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save profile details"));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/players/${entry.player_id}/profile-details`,
      expect.objectContaining({ json: { club_name: null } })));
  });

  it("caps strengths at 6 inputs in the form", async () => {
    mockPlayersApi(playerEntry());
    await openDetails();
    expect(screen.getAllByLabelText(/Sugh strength \d/)).toHaveLength(1);
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText("+ Add strength"));
    expect(screen.getAllByLabelText(/Sugh strength \d/)).toHaveLength(6);
    expect((screen.getByText("+ Add strength") as HTMLButtonElement).disabled).toBe(true);
  });

  it("uploads the photo as raw bytes with the rights meta header, like the brand uploads", async () => {
    const entry = playerEntry();
    const updated = profile({ details: details({ height_cm: 180, club_name: "Old Club", strengths: ["Pace"], photo_url: "https://example.invalid/p2.png", photo_asset_id: "0193132e-5034-7bc3-9565-df048bb010a2" }) });
    mockPlayersApi(entry, updated);
    await openDetails();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Sugh photo"), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText("Sugh photo rights holder"), { target: { value: "The club" } });
    fireEvent.change(screen.getByLabelText("Sugh photo rights basis"), { target: { value: "OWN_BRAND" } });
    fireEvent.click(screen.getByLabelText(/I confirm we have the right to show this photo/));
    fireEvent.click(screen.getByText("Upload photo"));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/players/${entry.player_id}/photo`,
      expect.objectContaining({ method: "POST", body: file, headers: expect.objectContaining({ "content-type": "image/png" }) })));
    const init = api.mock.calls.find(([u]: unknown[]) => (u as string).endsWith("/photo"))![1] as { headers: Record<string, string> };
    const meta = JSON.parse(Buffer.from(init.headers["x-asset-meta"]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    expect(meta).toEqual({ rights_holder: "The club", rights_basis: "OWN_BRAND", confirm_rights: true });
    expect(await screen.findByText("Photo saved.")).toBeTruthy();
  });

  it("refuses a photo over 512 KB or not a PNG/JPEG, and sends nothing", async () => {
    mockPlayersApi(playerEntry());
    await openDetails();
    const big = new File([new Uint8Array(512 * 1024 + 1)], "big.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Sugh photo"), { target: { files: [big] } });
    expect(screen.getByText("The picture is larger than 512 KB.")).toBeTruthy();
    expect((screen.getByText("Upload photo") as HTMLButtonElement).disabled).toBe(true);
    const bad = new File(["x"], "photo.gif", { type: "image/gif" });
    fireEvent.change(screen.getByLabelText("Sugh photo"), { target: { files: [bad] } });
    expect(screen.getByText("Choose a PNG or JPEG picture.")).toBeTruthy();
    expect(api.mock.calls.filter(([u]: unknown[]) => (u as string).endsWith("/photo"))).toHaveLength(0);
  });
});
