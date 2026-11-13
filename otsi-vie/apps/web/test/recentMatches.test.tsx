/** Home — Recent matches (SOT, Page 11): sentence-case heading and "View all" link, open section, real thumbnails */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, apiBlob: vi.fn(), ApiProblem: class ApiProblem extends Error {} }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

import { RecentMatches } from "@/components/home/RecentMatches";

const MATCHES = [
  { video_id: "11111111-1111-4111-8111-111111111111", video_title: "Nart v Ercakhu – round 2", duration_us: 8_290_000_000, has_thumbnail: false, match: null },
  { video_id: "22222222-2222-4222-8222-222222222222", video_title: "FC Ercakhu v FC Dynamo", duration_us: 9_375_000_000, has_thumbnail: false, match: null },
];

beforeEach(() => { api.mockReset(); });

describe("Recent matches (SOT)", () => {
  it("shows 'Recent matches' and 'View all' in sentence case, with no arrow", async () => {
    api.mockImplementation((url: string) => {
      if (url === "/v1/overview/recent-matches") return Promise.resolve(MATCHES);
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<RecentMatches />);
    await waitFor(() => expect(screen.getByText("Nart v Ercakhu – round 2")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Recent matches" })).toBeInTheDocument();
    const viewAll = screen.getByRole("link", { name: "View all matches" });
    expect(viewAll).toHaveTextContent("View all");
    expect(viewAll.querySelector("svg")).toBeNull();
    expect(screen.queryByText("Recent Matches")).toBeNull();
    expect(screen.queryByText("View All")).toBeNull();
    // the rows are an open section, not a boxed panel
    expect(document.querySelector("section.vie-panel")).toBeNull();
    expect(screen.getByText("FC Ercakhu v FC Dynamo")).toBeInTheDocument();
    expect(screen.getAllByText("Not linked to a match")).toHaveLength(2);
  });
});
