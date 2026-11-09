/** v3 Phase A.12 (ADR-078): Media Info through the real HTTP stack and MySQL; rows seeded as the ingest worker leaves them */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mediaChecks } from "@otsi-vie/contracts";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, seedRights, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member;
let b: Member;
let project: string;

const get = async (m: Member, id: string) => {
  const r = await app.inject({ method: "GET", url: `/v1/videos/${id}/media-info`, headers: m.headers });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};

async function video(state: string, opts: { meta?: object; failure?: [string, string] } = {}): Promise<string> {
  const v = uuidv7(), source = uuidv7();
  if (state === "INGESTED") {
    await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, metadata) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 2048, ?, 'video/mp4', ?)",
      [source, a.orgId, project, `org/${a.orgId}/videos/${v}/source.mp4`, "ab".repeat(32), JSON.stringify(opts.meta ?? {})]);
  }
  await root.query(
    `INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, original_filename, byte_size, duration_us, width, height, avg_frame_rate_num, avg_frame_rate_den,
       timebase_num, timebase_den, container_format, video_codec, audio_codec, is_variable_frame_rate, frame_count, rotation_degrees, created_by, source_asset_id, failure_code, failure_detail)
     VALUES (?, ?, ?, 'UPLOAD', ?, 'match.mp4', 2048, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [v, a.orgId, project, state, ...(state === "INGESTED" ? [60000000, 1920, 1080, 25, 1, 1, 12800, "mov,mp4,m4a,3gp,3g2,mj2", "h264", 0, 1500, 0] : [null, null, null, null, null, null, null, null, null, null, null, null]),
      a.userId, state === "INGESTED" ? source : null, opts.failure?.[0] ?? null, opts.failure?.[1] ?? null]);
  return v;
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  b = await seedMember(root, "OWNER");
  project = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, a.orgId, a.userId]);
});
afterAll(async () => {
  await app?.close();
  await root?.end();
});

describe("media info (A.12, ADR-078)", () => {
  it("a verified video: the file, the measured streams, every check passed with what was recorded, and the evidence so far", async () => {
    const id = await video("INGESTED", { meta: { sniffed: "mp4/mov", malware_scan: { scanner: "microsoft-defender", result: "clean", detail: null }, decode: { frames_decoded: 12, frames_tested: 12 } } });
    await seedRights(root, a.orgId, id);
    await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status) VALUES (?, ?, ?, 'test', 'SUCCEEDED')", [uuidv7(), id, a.orgId]);
    const r = await get(a, id);
    expect(r.status).toBe(200);
    expect(r.body.file).toMatchObject({ name: "match.mp4", bytes: 2048, sha256: "ab".repeat(32), mime_type: "video/mp4", signature: "mp4/mov", ingest_mode: "UPLOAD" });
    expect(r.body.streams).toMatchObject({ video_codec: "h264", audio_codec: null, width: 1920, height: 1080, frame_rate: { num: 25, den: 1 }, time_base: { num: 1, den: 12800 },
      variable_frame_rate: false, frame_count: 1500, rotation_degrees: 0, duration_us: 60000000 });
    expect(r.body.checks.map((c: { status: string }) => c.status)).toEqual(["PASSED", "PASSED", "PASSED", "PASSED", "PASSED", "PASSED"]);
    expect(r.body.checks[2].detail).toBe("Microsoft Defender: no threat found");
    expect(r.body.checks[4].detail).toBe("12 of 12 test frames decoded");
    expect(r.body.evidence).toMatchObject({ analyses: 1, latest_analysis: { status: "SUCCEEDED", tracks: 0, confirmed_tracks: 0 }, footage_check: null, reels: 0, renders: 0,
      rights: { rights_state: "INTERNAL", analysis_blocked: null } });
    expect(r.body.copies).toEqual({ playback: null, thumbnail: false });
  });

  it("a check not recorded says so; a refused file shows where it stopped; a file being checked is pending; other organizations see nothing", async () => {
    const old = await video("INGESTED");
    const checks = (await get(a, old)).body.checks;
    expect(checks[1].detail).toMatch(/not recorded/);
    expect(checks[4].detail).toBe("frames decoded (the count was not recorded)");
    expect((await get(a, old)).body.evidence.rights).toBeNull();

    const bad = await video("FAILED", { failure: ["UNDECODABLE", "No video frame could be decoded."] });
    expect((await get(a, bad)).body.checks.map((c: { key: string; status: string }) => `${c.key}:${c.status}`))
      .toEqual(["TRANSFER:PASSED", "SIGNATURE:PASSED", "MALWARE_SCAN:PASSED", "PROBE:PASSED", "DECODE:FAILED", "POLICY:NOT_RUN"]);
    const busy = await video("VALIDATING");
    expect((await get(a, busy)).body.checks.every((c: { status: string }) => c.status === "PENDING")).toBe(true);
    expect((await get(b, old)).status).toBe(404);
  });

  it("an unscanned file is reported as not scanned, never as clean; an unknown failure stops at the transfer", () => {
    const c = mediaChecks("INGESTED", null, null, null, { malware_scan: { scanner: null, result: "not_scanned", detail: "no malware scanner is available on this machine" } });
    expect(c[2]).toEqual({ key: "MALWARE_SCAN", status: "NOT_RUN", detail: "no malware scanner is available on this machine" });
    expect(mediaChecks("QUARANTINED", "SOMETHING_NEW", null, null, null).map((x) => x.status)).toEqual(["FAILED", "NOT_RUN", "NOT_RUN", "NOT_RUN", "NOT_RUN", "NOT_RUN"]);
  });
});
