/**
 * Sharing through the real API and MySQL (apps/api/src/modules/sharing/sharing.ts): rights first, a private link to one finished render,
 * the rule re-checked at every opening, every check and opening recorded, revoke and expiry, other organizations and roles kept out.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decide } from "../src/modules/sharing/sharing";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let a: Member, viewer: Member, b: Member;

async function call(m: Member | null, method: "GET" | "POST" | "DELETE" | "PATCH", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

/** a finished render of a confirmed player's reel, recorded the way the worker records it */
async function seedRender(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)", [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 2000000, 6000000, 'ENDED', 5)`, [track, run, video, shot]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, s * 25, track, s * 1_000_000]);
  const player = (await call(m, "POST", "/v1/players", { display_name: "Shared Player" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });
  const reel = (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player })).body;
  await call(m, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000, origin: "SUGGESTED" });
  const render = (await call(m, "POST", `/v1/reels/${reel.id}/renders`, { codec: "h264", bitrate_mbps: 8 }, { "idempotency-key": key() })).body.id as string;
  const out = uuidv7(), man = uuidv7(), keyOut = `org/${m.orgId}/reels/${reel.id}/render.mp4`;
  await mkdir(path.join(dir, "org", m.orgId, "reels", reel.id), { recursive: true });
  await writeFile(path.join(dir, ...keyOut.split("/")), Buffer.alloc(4000, 7));
  await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'REEL', ?, 'local', 4000, 'video/mp4'), (?, ?, 'MANIFEST', ?, 'local', 2, 'application/json')",
    [out, m.orgId, keyOut, man, m.orgId, `${keyOut}.json`]);
  await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [render]);
  await root.query("UPDATE render_jobs SET state = 'SUCCEEDED', output_asset_id = ?, manifest_asset_id = ?, completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [out, man, render]);
  return { video, render, reel: reel.id as string, player };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-share-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); await rm(dir, { recursive: true, force: true }); });

describe("the sharing rule", () => {
  it("needs a finished render, current identities and rights that allow sharing (pure)", () => {
    const render = { state: "SUCCEEDED", output_asset_id: "x" } as never;
    const grant = (o: Record<string, unknown>) => ({ rights_state: "EXPORT_ALLOWED", allowed_uses: ["SHARE"], guardian_consent_state: "NOT_APPLICABLE", valid_from: null, valid_until: null, ...o }) as never;
    expect(decide({ render, staleTargets: 0, grant: grant({}) }, false)).toEqual([]);
    expect(decide({ render: undefined, staleTargets: 0, grant: grant({}) }, false)).toContain("RENDER_NOT_READY");
    expect(decide({ render, staleTargets: 1, grant: grant({}) }, false)).toEqual(["REEL_STALE"]);
    expect(decide({ render, staleTargets: 0, grant: undefined }, false)).toEqual(["NO_RIGHTS_RECORDED"]);
    expect(decide({ render, staleTargets: 0, grant: grant({ rights_state: "INTERNAL" }) }, false)).toEqual(["RIGHTS_NOT_SHAREABLE"]);
    expect(decide({ render, staleTargets: 0, grant: grant({ allowed_uses: ["VIEW"] }) }, false)).toEqual(["RIGHTS_NOT_SHAREABLE"]);
    expect(decide({ render, staleTargets: 0, grant: grant({}) }, true)).toEqual(["DOWNLOAD_NOT_ALLOWED"]);
    expect(decide({ render, staleTargets: 0, grant: grant({ valid_until: "2000-01-01T00:00:00Z" }) }, false)).toEqual(["RIGHTS_NOT_VALID_NOW"]);
    expect(decide({ render, staleTargets: 0, grant: grant({ guardian_consent_state: "PENDING" }) }, false)).toEqual(["GUARDIAN_CONSENT"]);
  });
});

describe("share links", () => {
  it("rights first; a private link opened without signing in; re-checked at every opening; logged; revoked; expired; organizations apart", async () => {
    const s = await seedRender(a);
    const links = `/v1/renders/${s.render}/share-links`;
    // no rights recorded: refused, and the refusal is recorded
    const none = await call(a, "POST", links, {});
    expect([none.status, none.body.code]).toEqual([409, "SHARING_NOT_ALLOWED"]);
    expect(none.body.message).toContain("No rights are recorded");
    const [[deny]] = await root.query<RowDataPacket[]>("SELECT decision, reason_codes FROM policy_decisions WHERE resource_id = ? AND action = 'SHARE'", [s.render]);
    expect(deny).toMatchObject({ decision: "DENY" });
    // only an owner or admin records rights; internal-only rights still refuse sharing
    expect((await call(viewer, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "PUBLIC", allowed_uses: ["SHARE"], reason: "x y z" })).status).toBe(403);
    expect((await call(a, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "INTERNAL", allowed_uses: ["VIEW"], reason: "club footage, staff only" })).body.grant.rights_state).toBe("INTERNAL");
    expect((await call(a, "POST", links, {})).body.message).toContain("do not allow sharing");
    // rights that allow sharing (not downloads)
    const ok = await call(a, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "EXPORT_ALLOWED", allowed_uses: ["VIEW", "SHARE"], reason: "licence from the league, clause 4" });
    expect(ok.body.grant).toMatchObject({ rights_state: "EXPORT_ALLOWED", allowed_uses: ["VIEW", "SHARE"] });
    expect((await call(a, "POST", links, { can_download: true })).body.message).toContain("do not allow downloads");
    expect((await call(viewer, "POST", links, {})).status).toBe(403);
    const made = await call(a, "POST", links, { expires_in_days: 3 });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ render_id: s.render, can_download: false, state: "ACTIVE", opened: 0 });
    const token = String(made.body.url).replace("/s/", "");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [[stored]] = await root.query<RowDataPacket[]>("SELECT token_hash FROM share_links WHERE id = ?", [made.body.id]);
    expect(stored!.token_hash).not.toContain(token);                                                         // only the hash is kept
    // opened by anyone with the link, no sign-in: one video, a short-lived URL that plays
    const view = await call(null, "GET", `/v1/public/share/${token}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ player_name: "Shared Player", download_url: null, mime: "video/mp4", notice: expect.stringContaining("Shared from OTSI VIE") });
    const [[org]] = await root.query<RowDataPacket[]>("SELECT name FROM organizations WHERE id = ?", [a.orgId]);
    expect(view.body).toMatchObject({ organization_name: org!.name, player_jersey_number: null, player_position: null, player_club: null });   // nothing recorded for this player yet: nulls, not guesses
    const play = await app.inject({ method: "GET", url: String(view.body.url).replace("/api", ""), headers: { range: "bytes=0-99" } });
    expect(play.statusCode).toBe(206);
    const list = (await call(a, "GET", links)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: made.body.id, opened: 1, state: "ACTIVE" });
    expect(JSON.stringify(list)).not.toContain(token);
    // rights withdrawn: the same link stops working at the next opening (logged as DENY)
    await call(a, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "INTERNAL", allowed_uses: ["VIEW"], reason: "licence ended" });
    const blocked = await call(null, "GET", `/v1/public/share/${token}`);
    expect([blocked.status, blocked.body.message]).toEqual([410, "This video can no longer be shared."]);
    await call(a, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "EXPORT_ALLOWED", allowed_uses: ["VIEW", "SHARE"], reason: "licence renewed" });
    expect((await call(null, "GET", `/v1/public/share/${token}`)).status).toBe(200);
    // another organization sees nothing; revoke; a revoked or expired link says so
    expect((await call(b, "GET", links)).status).toBe(404);
    expect((await call(b, "DELETE", `/v1/share-links/${made.body.id}`)).status).toBe(404);
    expect((await call(a, "DELETE", `/v1/share-links/${made.body.id}`)).status).toBe(204);
    const revoked = await call(null, "GET", `/v1/public/share/${token}`);
    expect([revoked.status, revoked.body.message]).toEqual([410, "This link was revoked."]);
    expect((await call(a, "GET", links)).body[0].state).toBe("REVOKED");
    const second = (await call(a, "POST", links, { expires_in_days: 1 })).body;
    await root.query("UPDATE share_links SET expires_at = CURRENT_TIMESTAMP(6) - INTERVAL 1 HOUR WHERE id = ?", [second.id]);
    expect((await call(null, "GET", `/v1/public/share/${String(second.url).replace("/s/", "")}`)).body.message).toBe("This link has expired.");
    expect((await call(null, "GET", "/v1/public/share/not-a-token")).status).toBe(404);
    const [access] = await root.query<RowDataPacket[]>("SELECT decision, COUNT(*) AS n FROM share_link_access WHERE share_link_id = ? GROUP BY decision ORDER BY decision", [made.body.id]);
    expect(access.map((r) => [r.decision, Number(r.n)])).toEqual([["ALLOW", 2], ["DENY", 2]]);              // two openings allowed; withdrawn rights and the revoked link denied
    const [[audit]] = await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('share_link.created', 'share_link.revoked', 'video.rights_recorded') AND organization_id = ?", [a.orgId]);
    expect(Number(audit!.n)).toBeGreaterThanOrEqual(7);
  });
});
describe("share link password and comments (Page 10, ADR-053)", () => {
  it("a password guards opening and commenting (body only, wrong tries locked); comments only where allowed; the team reads them", async () => {
    const s = await seedRender(a);
    await call(a, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "EXPORT_ALLOWED", allowed_uses: ["VIEW", "SHARE"], reason: "licence from the league, clause 4" });
    const links = `/v1/renders/${s.render}/share-links`;
    expect((await call(a, "POST", links, { password: "short" })).status).toBe(422);
    const made = await call(a, "POST", links, { password: "open sesame 1", can_comment: true });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ has_password: true, can_comment: true, comments: 0 });
    const [[row]] = await root.query<RowDataPacket[]>("SELECT password_hash FROM share_links WHERE id = ?", [made.body.id]);
    expect(String(row!.password_hash)).not.toContain("open sesame");                                     // a hash only
    const token = String(made.body.url).replace("/s/", "");
    const pub = `/v1/public/share/${token}`;
    expect((await call(null, "GET", pub)).body.code).toBe("PASSWORD_REQUIRED");
    expect((await call(null, "POST", `${pub}/open`, { password: "wrong one" })).body.code).toBe("PASSWORD_WRONG");
    const view = await call(null, "POST", `${pub}/open`, { password: "open sesame 1" });
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ can_comment: true, comments: [] });
    // a comment needs the password too, a name and a body; it is stored with the link, not as a team note
    expect((await call(null, "POST", `${pub}/comments`, { name: "Scout", body: "Great run" })).body.code).toBe("PASSWORD_REQUIRED");
    expect((await call(null, "POST", `${pub}/comments`, { password: "open sesame 1", name: "", body: "x" })).status).toBe(422);
    const posted = await call(null, "POST", `${pub}/comments`, { password: "open sesame 1", name: "Scout", body: "Great run at the start", at_s: 2.5 });
    expect(posted.status).toBe(201);
    expect(posted.body).toEqual([expect.objectContaining({ name: "Scout", body: "Great run at the start", at_s: 2.5 })]);
    expect((await call(a, "GET", `/v1/reels/${s.reel}/notes`)).body).toEqual([]);                          // team notes stay team notes
    expect((await call(a, "GET", `/v1/share-links/${made.body.id}/comments`)).body).toHaveLength(1);
    expect((await call(b, "GET", `/v1/share-links/${made.body.id}/comments`)).status).toBe(404);
    expect((await call(a, "GET", links)).body.find((l: { id: string }) => l.id === made.body.id)).toMatchObject({ comments: 1, has_password: true });
    // a link without comments refuses them; one without a password opens as before
    const plain = await call(a, "POST", links, {});
    const ptoken = String(plain.body.url).replace("/s/", "");
    expect((await call(null, "GET", `/v1/public/share/${ptoken}`)).body).toMatchObject({ can_comment: false, comments: [] });
    expect((await call(null, "POST", `/v1/public/share/${ptoken}/comments`, { name: "X", body: "y" })).body.code).toBe("COMMENTS_OFF");
    // ten wrong passwords lock the link, even for the right one, for 15 minutes
    for (let i = 0; i < 9; i++) await call(null, "POST", `${pub}/open`, { password: `nope ${i}` });
    const lockedOut = await call(null, "POST", `${pub}/open`, { password: "open sesame 1" });
    expect([lockedOut.status, lockedOut.body.code]).toEqual([429, "SHARE_LOCKED"]);
  });
});

describe("Duplicate and Clear All (Pages 09, 10)", () => {
  it("a copy keeps the reel's player, pinned identities, look and clips, not its renders; Clear All hides finished renders only", async () => {
    const s = await seedRender(a);
    const orig = (await call(a, "GET", `/v1/reels/${s.reel}`)).body;
    expect((await call(viewer, "POST", `/v1/reels/${s.reel}/duplicate`)).status).toBe(403);
    expect((await call(b, "POST", `/v1/reels/${s.reel}/duplicate`)).status).toBe(404);
    const copy = await call(a, "POST", `/v1/reels/${s.reel}/duplicate`);
    expect(copy.status).toBe(201);
    expect(copy.body).toMatchObject({ name: `${orig.name} (copy)`, status: "DRAFT", video_id: s.video, player: { player_id: s.player }, latest_render: null, stale: false });
    expect(copy.body.id).not.toBe(s.reel);
    expect(copy.body.clips.map((c: { in_pts_us: number; out_pts_us: number }) => [c.in_pts_us, c.out_pts_us])).toEqual(orig.clips.map((c: { in_pts_us: number; out_pts_us: number }) => [c.in_pts_us, c.out_pts_us]));
    expect(copy.body.targets.map((t: { track_id: string }) => t.track_id)).toEqual(orig.targets.map((t: { track_id: string }) => t.track_id));
    const [[audit]] = await root.query<RowDataPacket[]>("SELECT after_state FROM audit_events WHERE action = 'reel.duplicated' AND entity_id = ?", [copy.body.id]);
    expect(JSON.parse(typeof audit!.after_state === "string" ? audit!.after_state : JSON.stringify(audit!.after_state))).toMatchObject({ from_reel_id: s.reel });
    // Clear All: the finished render leaves the queue; it and its file stay
    expect((await call(viewer, "POST", "/v1/renders/clear-finished")).status).toBe(403);
    const cleared = await call(a, "POST", "/v1/renders/clear-finished");
    expect(cleared.status).toBe(200);
    expect(cleared.body.cleared).toBeGreaterThanOrEqual(1);
    const after = (await call(a, "GET", `/v1/reels/${s.reel}`)).body;
    expect(after.latest_render).toMatchObject({ id: s.render, cleared: true, has_output: true });
    expect(after.last_good_render).toMatchObject({ id: s.render });
    expect((await call(a, "POST", "/v1/renders/clear-finished")).body.cleared).toBe(0);
    const [[other]] = await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM render_jobs WHERE organization_id = ? AND cleared_at IS NOT NULL", [b.orgId]);
    expect(Number(other!.n)).toBe(0);                                                                         // other organizations untouched
  });
});
describe("share link gate (SOT Pages 25-26)", () => {
  it("shows the organisation, the expiry and whether a password is needed before opening — and opening is not logged", async () => {
    const s = await seedRender(a);
    await call(a, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "EXPORT_ALLOWED", allowed_uses: ["VIEW", "SHARE"], reason: "licence from the league, clause 4" });
    const made = await call(a, "POST", `/v1/renders/${s.render}/share-links`, { expires_in_days: 3 });
    const token = String(made.body.url).replace("/s/", "");
    const [[org]] = await root.query<RowDataPacket[]>("SELECT name FROM organizations WHERE id = ?", [a.orgId]);
    const gate = await call(null, "GET", `/v1/public/share/${token}/gate`);
    expect(gate.status).toBe(200);
    expect(gate.body).toMatchObject({ organization_name: org!.name, has_password: false });
    expect(new Date(gate.body.expires_at).getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
    const [[access]] = await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM share_link_access WHERE share_link_id = ?", [made.body.id]);
    expect(Number(access!.n)).toBe(0);                                                              // the gate is not an opening
    const locked = await call(a, "POST", `/v1/renders/${s.render}/share-links`, { password: "open sesame 1" });
    const gate2 = await call(null, "GET", `/v1/public/share/${String(locked.body.url).replace("/s/", "")}/gate`);
    expect(gate2.body).toMatchObject({ organization_name: org!.name, has_password: true });
    expect((await call(null, "GET", "/v1/public/share/not-a-token/gate")).status).toBe(404);
    // the opened view carries the same organisation and the player's line (nulls: nothing recorded for this player)
    const view = await call(null, "GET", `/v1/public/share/${token}`);
    expect(view.body).toMatchObject({ organization_name: org!.name, player_name: "Shared Player", player_jersey_number: null, player_position: null, player_club: null });
    // and with a roster row the line is the recorded one: "#4 · DM · FC Ercakhu"
    const home = uuidv7(), away = uuidv7(), match = uuidv7();
    await root.query("INSERT INTO clubs (id, canonical_name) VALUES (?, 'FC Ercakhu'), (?, 'Nart Sukhum')", [home, away]);
    await root.query("INSERT INTO matches (id, organization_id, home_club_id, away_club_id, kickoff_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6))", [match, a.orgId, home, away]);
    await root.query("INSERT INTO match_rosters (match_id, player_id, club_id, jersey_number, role, position) VALUES (?, ?, ?, 4, 'STARTER', 'DM')", [match, s.player, home]);
    const lined = await call(null, "GET", `/v1/public/share/${token}`);
    expect(lined.body).toMatchObject({ player_jersey_number: 4, player_position: "DM", player_club: "FC Ercakhu" });
  });
});
