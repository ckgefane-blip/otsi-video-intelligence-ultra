/** v3 Phase A.12 (ADR-078): the Media Info panel */
import { render, screen } from "@testing-library/react";
import { mediaChecks, type MediaInfo } from "@otsi-vie/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  class ApiProblem extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
  return { ApiProblem, api: (...a: unknown[]) => api(...a) };
});

import { evidenceLines, MediaInfoBody, MediaInfoDialog } from "@/components/media/MediaInfoDialog";

const INFO: MediaInfo = {
  video_id: "01a18837-dbfd-719b-93e0-2916132bac92", state: "INGESTED",
  file: { name: "match.mp4", bytes: 2048, sha256: "ab".repeat(32), mime_type: "video/mp4", signature: "mp4/mov", ingest_mode: "UPLOAD", source_uri: null, added_by: "Osio",
    added_at: "2026-11-01T10:00:00.000Z", verified_at: "2026-11-01T10:05:00.000Z" },
  streams: { container: "mov,mp4", video_codec: "h264", audio_codec: null, width: 1920, height: 1080, frame_rate: { num: 25, den: 1 }, variable_frame_rate: false, frame_count: 1500,
    duration_us: 60000000, time_base: { num: 1, den: 12800 }, rotation_degrees: 0 },
  checks: mediaChecks("INGESTED", null, null, "ab".repeat(32), { sniffed: "mp4/mov", malware_scan: { scanner: "microsoft-defender", result: "clean", detail: null }, decode: { frames_decoded: 12, frames_tested: 12 } }),
  ingest_job: { state: "SUCCEEDED", attempts: 1, started_at: null, finished_at: "2026-11-01T10:05:00.000Z", error_code: null },
  copies: { playback: null, thumbnail: true },
  evidence: { analyses: 2, latest_analysis: { id: "r", status: "SUCCEEDED", finished_at: null, tracks: 23742, confirmed_tracks: 3 }, footage_check: null,
    rights: { rights_state: "INTERNAL", allowed_uses: ["VIEW", "ANALYZE", "PRODUCE"], guardian_consent_state: "NOT_APPLICABLE", analysis_blocked: null }, reels: 1, renders: 0 },
};

beforeEach(() => api.mockReset());

describe("media info panel", () => {
  it("the evidence reads from recorded rows only", () => {
    expect(evidenceLines(INFO.evidence)).toEqual(["2 analyses; latest succeeded: 23,742 tracks, 3 with a confirmed identity", "Footage not checked", "Rights: analyse", "1 reel made from it, 0 finished renders"]);
    expect(evidenceLines({ ...INFO.evidence, analyses: 0, latest_analysis: null, rights: null })[0]).toBe("Not analysed yet");
    expect(evidenceLines({ ...INFO.evidence, rights: null })[2]).toMatch(/No rights recorded/);
  });

  it("shows the file, the measured streams, every check and the copies; unmeasured facts are a dash", () => {
    render(<MediaInfoBody info={INFO} />);
    expect(screen.getByText("ab".repeat(32))).toBeInTheDocument();
    expect(screen.getByText("no audio track")).toBeInTheDocument();
    expect(screen.getByText("1/12800")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-check-status=PASSED]")).toHaveLength(6);
    expect(document.querySelector("[data-check=DECODE]")).toHaveTextContent("12 of 12 test frames decoded");
    expect(document.querySelector("[data-check=MALWARE_SCAN]")).toHaveTextContent("Microsoft Defender: no threat found");
    expect(screen.getByText("not made yet")).toBeInTheDocument();
  });

  it("the dialog reads the video's media info when opened, and shows a refusal", async () => {
    api.mockResolvedValueOnce(INFO);
    const { rerender } = render(<MediaInfoDialog videoId={INFO.video_id} name="Match" open onOpenChange={() => undefined} />);
    expect(await screen.findByText("Media Info · Match")).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(`/v1/videos/${INFO.video_id}/media-info`);
    expect(await screen.findByText("match.mp4")).toBeInTheDocument();
    const { ApiProblem } = await import("@/lib/api");
    api.mockRejectedValueOnce(new ApiProblem(404, "NOT_FOUND", "Video not found."));
    rerender(<MediaInfoDialog videoId="other" name="Other" open onOpenChange={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Video not found.");
  });
});
