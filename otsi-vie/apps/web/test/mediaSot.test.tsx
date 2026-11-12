/** SOT rebuild page 15 (alphabetical), Media — upload & ingest: the centre (drop zone, tier cards, add from a link, ingest queue)
 * and the right inspector (ingest settings: analysis profile, the three switch groups, footage rights, link to match, Start analysis). */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MediaStage } from "@/components/upload/MediaStage";
import { Page02Controller } from "@/components/upload/page02";
import { UploadWorkspace } from "@/components/upload/UploadWorkspace";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api, ApiProblem: class ApiProblem extends Error { constructor(public code: string, msg: string) { super(msg); } } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }), usePathname: () => "/upload" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { organization_id: "org-1", role: "OWNER" }, me: { user: { id: "u1" } } }) }));

const PROJECT = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Default", status: "ACTIVE", video_count: 1 };
const VIDEO = {
  id: "22222222-2222-4222-8222-222222222222", project_id: PROJECT.id, title: "Nart v Ercakhu – round 2",
  original_filename: "nart-v-ercakhu-round-2.mp4", ingest_mode: "UPLOAD", source_uri: null, state: "INGESTED",
  byte_size: 3629147208, duration_us: 8280000000, width: 1280, height: 720, frame_rate: { num: 60, den: 1 },
  is_variable_frame_rate: false, container_format: "mp4", video_codec: "h264", audio_codec: "aac", sha256: null,
  failure_code: null, failure_detail: null, has_thumbnail: true, analysis: null, ingest_options: null,
  match_id: "11111111-1111-4111-8111-111111111111", job: null, upload: null, created_by: null,
  created_at: "2026-11-10T00:00:00Z", updated_at: "2026-11-10T00:00:00Z",
};
const MATCH = {
  id: "11111111-1111-4111-8111-111111111111", competition: "Abkhazia Premier League", season: null, kickoff_at: null, venue: null,
  home: { id: "h1", name: "Nart", short_name: "Nart" }, away: { id: "a1", name: "Ercakhu", short_name: "Ercakhu" },
  home_score: null, away_score: null, version: 1, video_ids: [VIDEO.id], roster: [],
};

api.mockImplementation((path: string) => {
  if (path === "/v1/projects") return Promise.resolve([PROJECT]);
  if (path === "/v1/videos") return Promise.resolve([VIDEO]);
  if (path === "/v1/matches") return Promise.resolve([MATCH]);
  if (path === "/v1/upload-limits") return Promise.resolve({ max_upload_bytes: 2 * 1024 ** 3, accepted_extensions: ["mp4", "mov"] });
  if (path === "/v1/licence") return Promise.resolve({ plan: "FREE" });
  if (path.startsWith("/v1/videos/") && path.endsWith("/rights")) return Promise.resolve({ grant: { rights_state: "INTERNAL", allowed_uses: ["VIEW", "ANALYZE"] }, analysis_blocked: null });
  return Promise.reject(new Error(`unexpected ${path}`));
});

const renderPage = () => render(
  <UploadWorkspace><Page02Controller><MediaStage /></Page02Controller></UploadWorkspace>,
);

describe("Media (SOT)", () => {
  it("shows the SOT's centre and the ingest settings inspector", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add match videos" })).toBeInTheDocument());
    // drop zone + tier cards
    expect(screen.getByText("Drop videos or browse")).toBeInTheDocument();
    expect(screen.getByText("Browse files")).toBeInTheDocument();
    expect(screen.getByText("Free tier · 2 GB")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Enterprise")).toBeInTheDocument();
    expect(screen.getByText("24 GB")).toBeInTheDocument();
    expect(screen.getByText("64 GB")).toBeInTheDocument();
    // add from a link
    expect(screen.getByRole("heading", { name: "Add from a link" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/direct file, HLS/)).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("Direct link")).toBeInTheDocument();
    expect(screen.getByText("Dropbox")).toBeInTheDocument();
    expect(screen.getByText("Refused — platform terms do not allow it")).toBeInTheDocument();
    expect(screen.getByText("YouTube")).toBeInTheDocument();
    // ingest queue with the real video
    expect(screen.getByRole("heading", { name: "Ingest queue" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Nart v Ercakhu – round 2")).toBeInTheDocument());
    expect(screen.getByText("1 videos")).toBeInTheDocument();
    // inspector: profile + switches + rights + match + footer
    expect(screen.getByText("Ingest settings")).toBeInTheDocument();
    expect(screen.getByText("Analysis profile")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText("Balanced passes for most footage")).toBeInTheDocument();
    expect(screen.getByText("High Accuracy")).toBeInTheDocument();
    expect(screen.getByText("Visual filters")).toBeInTheDocument();
    expect(screen.getByText("Overlays")).toBeInTheDocument();
    expect(screen.getByText("Ingest switches")).toBeInTheDocument();
    expect(screen.getByText("Footage rights")).toBeInTheDocument();
    expect(screen.getByText("Rights holder")).toBeInTheDocument();
    expect(screen.getByText("A minor appears in this footage")).toBeInTheDocument();
    expect(screen.getByText("Link to match")).toBeInTheDocument();
    expect(screen.getByText("1 token per analysed minute")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start analysis" })).toBeInTheDocument();
  });

  it("shows the empty queue when no video has been added", async () => {
    api.mockImplementation((path: string) => {
      if (path === "/v1/videos") return Promise.resolve([]);
      if (path === "/v1/projects") return Promise.resolve([PROJECT]);
      if (path === "/v1/matches") return Promise.resolve([]);
      if (path === "/v1/upload-limits") return Promise.resolve({ max_upload_bytes: 2 * 1024 ** 3, accepted_extensions: ["mp4", "mov"] });
      if (path === "/v1/licence") return Promise.resolve({ plan: "FREE" });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Add match videos" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("No videos added yet")).toBeInTheDocument());
    expect(screen.getByText("Drop files or paste a link.")).toBeInTheDocument();
    expect(screen.getByText("0 videos")).toBeInTheDocument();
  });
});
