/**
 * v3 Phase C.4 (ADR-104): Archive bundle rights evaluation (`checkArchiveRights`), UI rights descriptions, and byte formatting.
 */
import { describe, expect, it } from "vitest";
import { checkArchiveRights } from "@otsi-vie/contracts";
import { describeArchiveRights, formatArchiveBytes } from "@/components/exportstage/ArchiveBundle";

const VIDEO_1 = "00000000-0000-4000-8000-000000000001";
const VIDEO_2 = "00000000-0000-4000-8000-000000000002";
const GRANT_1 = "00000000-0000-4000-8000-000000000011";
const GRANT_2 = "00000000-0000-4000-8000-000000000012";

describe("Archive bundle rights and helpers (C.4)", () => {
  it("allows packing and opening when every source video has a valid PRODUCE grant and followed tracks are current", () => {
    const now = new Date("2026-11-09T12:00:00Z");
    const check = checkArchiveRights({
      now,
      staleTargets: 0,
      videos: [
        {
          video_id: VIDEO_1,
          title: "Sporting Lagos vs Enyimba — Half 1",
          grant: {
            id: GRANT_1,
            rights_state: "INTERNAL",
            allowed_uses: ["VIEW", "ANALYZE", "PRODUCE"],
            valid_from: "2026-11-01T00:00:00Z",
            valid_until: null,
            guardian_consent_state: "NOT_APPLICABLE",
          },
        },
        {
          video_id: VIDEO_2,
          title: "Sporting Lagos vs Enyimba — Half 2",
          grant: {
            id: GRANT_2,
            rights_state: "EXPORT_ALLOWED",
            allowed_uses: ["VIEW", "ANALYZE", "PRODUCE", "EXPORT", "SHARE"],
            valid_from: "2026-11-01T00:00:00Z",
            valid_until: "2027-11-01T00:00:00Z",
            guardian_consent_state: "VERIFIED",
          },
        },
      ],
    });

    expect(check.allowed).toBe(true);
    expect(check.rule_version).toBe("archive-v1");
    expect(check.reason_codes).toEqual([]);
    expect(check.reason_text).toBeNull();
    expect(check.videos.every((v) => v.allowed)).toBe(true);

    const ui = describeArchiveRights(check);
    expect(ui.tone).toBe("ok");
    expect(ui.headline).toContain("packing and opening allowed");
    expect(ui.videos).toEqual([
      {
        video_id: VIDEO_1,
        title: "Sporting Lagos vs Enyimba — Half 1",
        label: "INTERNAL · VIEW, ANALYZE, PRODUCE · consent NOT_APPLICABLE",
        tone: "ok",
      },
      {
        video_id: VIDEO_2,
        title: "Sporting Lagos vs Enyimba — Half 2",
        label: "EXPORT_ALLOWED · VIEW, ANALYZE, PRODUCE, EXPORT, SHARE · consent VERIFIED",
        tone: "ok",
      },
    ]);
  });

  it("blocks when rights are unrecorded, expired, lacking PRODUCE, pending guardian consent, removed, or when reel targets are stale", () => {
    const now = new Date("2026-11-09T12:00:00Z");

    // 1. Unrecorded rights + stale targets
    const unrecorded = checkArchiveRights({
      now,
      staleTargets: 1,
      videos: [{ video_id: VIDEO_1, title: "Raw Feed", grant: null }],
    });
    expect(unrecorded.allowed).toBe(false);
    expect(unrecorded.reason_codes).toEqual(["REEL_STALE", "NO_RIGHTS_RECORDED"]);
    expect(unrecorded.videos[0]).toMatchObject({
      rights_state: "UNRECORDED",
      allowed: false,
      reason_code: "NO_RIGHTS_RECORDED",
    });

    // 2. Expired grant + pending guardian consent
    const expired = checkArchiveRights({
      now,
      videos: [
        {
          video_id: VIDEO_1,
          title: "Expired Clip",
          grant: {
            id: GRANT_1,
            rights_state: "INTERNAL",
            allowed_uses: ["VIEW", "ANALYZE", "PRODUCE"],
            valid_from: "2026-01-01T00:00:00Z",
            valid_until: "2026-06-01T00:00:00Z",
            guardian_consent_state: "NOT_APPLICABLE",
          },
        },
        {
          video_id: VIDEO_2,
          title: "Academy Clip",
          grant: {
            id: GRANT_2,
            rights_state: "INTERNAL",
            allowed_uses: ["VIEW", "ANALYZE", "PRODUCE"],
            valid_from: "2026-01-01T00:00:00Z",
            valid_until: null,
            guardian_consent_state: "PENDING",
          },
        },
      ],
    });
    expect(expired.allowed).toBe(false);
    expect(expired.reason_codes).toEqual(["RIGHTS_NOT_VALID_NOW", "GUARDIAN_CONSENT"]);

    // 3. Removed source video or empty match
    const removed = checkArchiveRights({
      now,
      videos: [{ video_id: VIDEO_1, title: "Trashed Video", removed: true, grant: null }],
    });
    expect(removed.allowed).toBe(false);
    expect(removed.reason_codes).toEqual(["SOURCE_VIDEO_REMOVED"]);

    const emptyMatch = checkArchiveRights({ now, videos: [] });
    expect(emptyMatch.allowed).toBe(false);
    expect(emptyMatch.reason_codes).toEqual(["NO_VIDEOS_IN_MATCH"]);

    const ui = describeArchiveRights(expired);
    expect(ui.tone).toBe("warn");
    expect(ui.videos.map((v) => v.tone)).toEqual(["warn", "warn"]);
  });

  it("formats archive bundle byte sizes cleanly", () => {
    expect(formatArchiveBytes(512)).toBe("512 B");
    expect(formatArchiveBytes(4_200)).toBe("4.2 KB");
    expect(formatArchiveBytes(2_500_000)).toBe("2.50 MB");
  });
});
