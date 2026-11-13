/**
 * v3 Phase C.10 (ADR-109, migration 0062): Organization Templates for Spotlight, Style, and Branding.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let a: Member, viewer: Member, b: Member;

async function call(m: Member, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

async function seedReel(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'OrgTemplateProject', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)", [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  for (const s of [2, 3, 4, 5]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  await root.query("INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 2000000, 5000000, 'ENDED', 4)", [track, run, video, shot]);
  for (const s of [2, 3, 4, 5]) await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, s * 25, track, s * 1_000_000]);
  const player = (await call(m, "POST", "/v1/players", { display_name: "Template Player" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });
  const reel = (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player })).body;
  return { video, player, reel: (await call(m, "GET", `/v1/reels/${reel.id}`)).body };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-templates-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});

afterAll(async () => {
  await app?.close();
  await root?.end();
  await rm(dir, { recursive: true, force: true });
});

describe("organization templates API", () => {
  it("lists built-in templates and allows kind filtering", async () => {
    const rAll = await call(a, "GET", "/v1/templates");
    expect(rAll.status).toBe(200);
    expect(rAll.body.length).toBeGreaterThanOrEqual(3);
    expect(rAll.body.some((t: any) => t.name === "Broadcast gold")).toBe(true);

    const rSpotlight = await call(a, "GET", "/v1/templates?kind=SPOTLIGHT");
    expect(rSpotlight.status).toBe(200);
    expect(rSpotlight.body.every((t: any) => t.kind === "SPOTLIGHT" || t.kind === "FULL")).toBe(true);
  });

  it("creates, updates, and deletes an organization template", async () => {
    const s = await seedReel(a);

    // Create SPOTLIGHT template from reel
    const c1 = await call(a, "POST", "/v1/templates", {
      name: "Club Fast Spotlight",
      description: "Fast reframe with cyan tracker",
      kind: "SPOTLIGHT",
      reel_id: s.reel.id,
    });
    expect(c1.status).toBe(201);
    expect(c1.body.name).toBe("Club Fast Spotlight");
    expect(c1.body.kind).toBe("SPOTLIGHT");
    expect(c1.body.spec.spotlight).toBeDefined();

    // Duplicate name rejected in same org
    const cDup = await call(a, "POST", "/v1/templates", {
      name: "Club Fast Spotlight",
      kind: "SPOTLIGHT",
      reel_id: s.reel.id,
    });
    expect(cDup.status).toBe(409);
    expect(cDup.body.code).toBe("NAME_TAKEN");

    // Viewer cannot create
    const cViewer = await call(viewer, "POST", "/v1/templates", {
      name: "Viewer Template",
      kind: "SPOTLIGHT",
      reel_id: s.reel.id,
    });
    expect(cViewer.status).toBe(403);

    // Other org cannot see it
    const getOther = await call(b, "GET", `/v1/templates/${c1.body.id}`);
    expect(getOther.status).toBe(404);

    // Update template
    const u1 = await call(a, "PUT", `/v1/templates/${c1.body.id}`, {
      description: "Updated description for fast spotlight",
    });
    expect(u1.status).toBe(200);
    expect(u1.body.description).toBe("Updated description for fast spotlight");

    // Cannot delete built-in
    const delBuiltin = await call(a, "DELETE", "/v1/templates/00000000-0000-4000-8000-000000000001");
    expect(delBuiltin.status).toBe(403);

    // Delete custom template
    const del = await call(a, "DELETE", `/v1/templates/${c1.body.id}`);
    expect(del.status).toBe(204);

    const checkDel = await call(a, "GET", `/v1/templates/${c1.body.id}`);
    expect(checkDel.status).toBe(404);
  });

  it("selectively applies template sections to a reel", async () => {
    const s = await seedReel(a);

    // Set initial custom settings on reel
    await call(a, "PATCH", `/v1/reels/${s.reel.id}`, {
      version: s.reel.version,
      settings: {
        ring_color: "#123456",
        score_bug: false,
        match_card: false,
      },
    });
    const current = (await call(a, "GET", `/v1/reels/${s.reel.id}`)).body;
    expect(current.settings.ring_color).toBe("#123456");

    // Apply Broadcast Gold (FULL) but selectively only SPOTLIGHT
    const applySpotlight = await call(a, "POST", `/v1/reels/${s.reel.id}/apply-org-template`, {
      template_id: "00000000-0000-4000-8000-000000000001",
      version: current.version,
      apply_kinds: ["SPOTLIGHT"],
    });
    expect(applySpotlight.status).toBe(200);
    expect(applySpotlight.body.reel.settings.ring_color).toBe("#F5D02E");
    // Style was NOT applied, so match_card remains false
    expect(applySpotlight.body.reel.settings.match_card).toBe(false);

    // Now apply STYLE from Broadcast Gold
    const applyStyle = await call(a, "POST", `/v1/reels/${s.reel.id}/apply-org-template`, {
      template_id: "00000000-0000-4000-8000-000000000001",
      version: applySpotlight.body.reel.version,
      apply_kinds: ["STYLE"],
    });
    expect(applyStyle.status).toBe(200);
    // Now match_card IS updated to true
    expect(applyStyle.body.reel.settings.match_card).toBe(true);

    // Verify audit log
    const [audit] = await root.query<RowDataPacket[]>(
      "SELECT * FROM audit_events WHERE organization_id = ? AND action = 'reel.org_template_applied' ORDER BY occurred_at DESC LIMIT 1",
      [a.orgId]
    );
    expect(audit.length).toBe(1);
    const after = typeof audit[0]!.after_state === "string" ? JSON.parse(audit[0]!.after_state) : audit[0]!.after_state;
    expect(after.template_id).toBe("00000000-0000-4000-8000-000000000001");
  });
});
