/** B.23 (ADR-098): the chapters filter's rule (unknown when none of his events is recorded) and the rights line of the preflight */
import { describe, expect, it } from "vitest";
import { actionClips, rightsAllowShare, shareCheck, type VideoRights } from "@otsi-vie/contracts";

const V = "00000000-0000-4000-8000-000000000001";
const clips = [{ id: "c1", in_pts_us: 0, out_pts_us: 5e6 }, { id: "c2", in_pts_us: 10e6, out_pts_us: 15e6 }, { id: "c3", in_pts_us: 20e6, out_pts_us: 25e6 }];

describe("hide no-action chapters", () => {
  it("a clip has action when an event of his starts inside it (ends included); other videos do not count", () => {
    const a = actionClips(V, clips, [{ video_id: V, start_us: 5e6 }, { video_id: V, start_us: 12e6 }, { video_id: "other", start_us: 21e6 }]);
    expect([...a!]).toEqual(["c1", "c2"]);
  });
  it("with none of his events recorded in the video it is not known (null), never 'no clip has action'", () => {
    expect(actionClips(V, clips, [])).toBeNull();
    expect(actionClips(V, clips, [{ video_id: "other", start_us: 1e6 }])).toBeNull();
  });
});

describe("the video's rights in the preflight", () => {
  const grant = (g: Partial<NonNullable<VideoRights["grant"]>>): VideoRights => ({ video_id: V, analysis_blocked: null, grant: {
    id: V, rights_state: "EXPORT_ALLOWED", allowed_uses: ["SHARE"], valid_from: null, valid_until: null, guardian_consent_state: "NOT_APPLICABLE", created_at: "2026-11-07T00:00:00Z", ...g } });
  it("none recorded warns and can be recorded there; internal warns; sharing is fine", () => {
    expect(shareCheck(null).level).toBe("WARN");
    expect(shareCheck({ video_id: V, grant: null, analysis_blocked: null }).text).toContain("No rights are recorded");
    expect(shareCheck(grant({ rights_state: "INTERNAL" })).level).toBe("WARN");
    expect(shareCheck(grant({})).text).toBe("The video's rights allow sharing.");
    expect(shareCheck(grant({ allowed_uses: ["SHARE", "DOWNLOAD"] })).text).toBe("The video's rights allow sharing and downloads.");
  });
  it("expired rights and pending guardian consent do not allow sharing", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(rightsAllowShare(grant({ valid_until: "2026-11-07T11:00:00Z" }), now)).toBe(false);
    expect(rightsAllowShare(grant({ valid_until: "2026-11-08T00:00:00Z" }), now)).toBe(true);
    expect(rightsAllowShare(grant({ guardian_consent_state: "PENDING" }), now)).toBe(false);
    expect(rightsAllowShare(grant({ allowed_uses: [] }), now)).toBe(false);
  });
});
