/**
 * Project access (ADR-057, migration 0043) through the real API and MySQL. A restricted project is seen only by Owners, Admins and the
 * people on it: for everyone else it is "not found" on every route that names it (videos, runs, tracks, reels, renders, matches, the
 * project itself, Library items, reports) and it is left out of every list and total (Library lists, Overview, matches, player numbers,
 * comparison, reports). Changes need Editor or Manager there (a Reviewer may make identity decisions); a project permission never raises
 * an organization role. Managing who is on it is audited and takes effect on the next request.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { namedIds } from "../src/core/access";
import { effectiveCap } from "../src/modules/projects/projects";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let owner: Member, admin: Member, analyst: Member, checker: Member, editor: Member, viewer: Member, scout: Member, other: Member;

async function call(m: Member | null, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

/** a project with one analysed video, a match, a track confirmed as a player */
async function seedProject(m: Member, name: string, player?: string) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), shot = uuidv7(), track = uuidv7(), match = uuidv7(), source = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, ?, ?)", [project, m.orgId, name, m.userId]);
  await root.query("INSERT INTO matches (id, organization_id, competition) VALUES (?, ?, ?)", [match, m.orgId, `${name} Cup`]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, match_id, ingest_mode, state, duration_us, created_by, title, source_asset_id) VALUES (?, ?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?, ?)",
    [video, m.orgId, project, match, m.userId, `${name} video`, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 2000000, 6000000, 'ENDED', 5)`, [track, run, video, shot]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, s * 25, track, s * 1_000_000]);
  const pl = player ?? (await call(m, "POST", "/v1/players", { display_name: `${name} Player` }, { "idempotency-key": key() })).body.player_id as string;
  const d = await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: pl });
  expect(d.status).toBeLessThan(300);
  return { project, video, run, track, match, player: pl };
}

let open: Awaited<ReturnType<typeof seedProject>>, locked: Awaited<ReturnType<typeof seedProject>>;
let reel: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-access-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
  admin = await seedMember(root, "ADMIN", owner.orgId);
  analyst = await seedMember(root, "ANALYST", owner.orgId);
  checker = await seedMember(root, "ANALYST", owner.orgId);
  editor = await seedMember(root, "EDITOR", owner.orgId);
  viewer = await seedMember(root, "VIEWER", owner.orgId);
  scout = await seedMember(root, "SCOUT", owner.orgId);
  other = await seedMember(root, "OWNER");
  open = await seedProject(owner, "Open");
  locked = await seedProject(owner, "Locked", open.player);         // the same player is seen in both projects
  const r = await call(owner, "POST", "/v1/reels", { video_id: locked.video, player_id: locked.player, name: "Locked reel" });
  expect(r.status).toBe(201);
  reel = r.body.id;
});
afterAll(async () => { await app?.close(); await root?.end(); await rm(dir, { recursive: true, force: true }); });

describe("route ids (pure)", () => {
  it("finds every id a request names, by the segment before it, Library kinds, Trash and the body", () => {
    const v = uuidv7(), t = uuidv7(), k = uuidv7();
    expect(namedIds("/v1/videos/:videoId/reels", { videoId: v }, undefined)).toEqual([["video", v]]);
    expect(namedIds("/v1/tracks/:trackId/identity-decisions", { trackId: t }, { player_id: k })).toEqual([["track", t]]);
    expect(namedIds("/v1/library/:kind/:id", { kind: "reel", id: k }, undefined)).toEqual([["reel", k]]);
    expect(namedIds("/v1/library/trash/:id/restore", { id: k }, undefined)).toEqual([["trash", k]]);
    expect(namedIds("/v1/reels", {}, { video_id: v, player_id: k })).toEqual([["video", v]]);
    expect(namedIds("/v1/players/:id/measures", { id: k }, undefined)).toEqual([]);
    expect(effectiveCap("VIEWER", "EDIT")).toBe("VIEW");                 // a project permission never raises the organization role
    expect(effectiveCap("ANALYST", "REVIEW")).toBe("REVIEW");
    expect(effectiveCap("ADMIN", "READ")).toBe("MANAGE");
  });
});

describe("locking a project", () => {
  it("only Owner / Admin / its Manager may manage; members are added with one permission each; all audited", async () => {
    expect((await call(editor, "PUT", `/v1/projects/${locked.project}/access`, { access: "RESTRICTED" })).status).toBe(403);
    expect((await call(viewer, "PUT", `/v1/projects/${locked.project}/access`, { access: "RESTRICTED" })).status).toBe(403);
    const s = await call(owner, "PUT", `/v1/projects/${locked.project}/access`, { access: "RESTRICTED" });
    expect(s.status).toBe(200);
    expect(s.body.access).toBe("RESTRICTED");
    expect(s.body.always.map((x: { user_id: string }) => x.user_id).sort()).toEqual([owner.userId, admin.userId].sort());
    for (const [m, perm] of [[analyst, "ADMIN"], [viewer, "EDIT"], [scout, "REVIEW"], [checker, "REVIEW"]] as const) {
      const r = await call(owner, "PUT", `/v1/projects/${locked.project}/access/people/${m.userId}`, { permission: perm });
      expect(r.status).toBe(200);
    }
    const again = await call(owner, "PUT", `/v1/projects/${locked.project}/access/people/${scout.userId}`, { permission: "REVIEW" });
    expect(again.body.people).toHaveLength(4);
    expect(again.body.people.find((x: { user_id: string }) => x.user_id === viewer.userId).effective).toBe("VIEW");
    expect((await call(owner, "PUT", `/v1/projects/${locked.project}/access/people/${other.userId}`, { permission: "READ" })).status).toBe(404);   // not a member
    expect((await call(owner, "PUT", `/v1/projects/${locked.project}/access/people/${editor.userId}`, { permission: "OWNER" })).status).toBe(422);
    const [audit] = await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE entity_id = ? AND action LIKE 'project.%' ORDER BY id", [locked.project]);
    expect(audit.map((x) => x.action)).toEqual(["project.access_changed", "project.member_added", "project.member_added", "project.member_added", "project.member_added"]);
  });

  it("someone not on it gets 'not found' on every route that names it", async () => {
    const urls = [
      `/v1/projects/${locked.project}`, `/v1/projects/${locked.project}/access`, `/v1/videos/${locked.video}`, `/v1/videos/${locked.video}/analysis-runs`,
      `/v1/analysis-runs/${locked.run}/tracks`, `/v1/tracks/${locked.track}/candidates`, `/v1/reels/${reel}`, `/v1/matches/${locked.match}`,
      `/v1/videos/${locked.video}/events`, `/v1/videos/${locked.video}/rights`, `/v1/library/reel/${reel}/removal`, `/v1/videos/${locked.video}/pitch-calibrations`,
    ];
    for (const u of urls) {
      const r = await call(editor, "GET", u);
      expect([u, r.status]).toEqual([u, 404]);
      expect([u, (await call(owner, "GET", u)).status]).not.toEqual([u, 404]);    // the Owner still sees it
    }
    // changes too: a reel on its video, a rename, deleting from the Library
    expect((await call(editor, "POST", "/v1/reels", { video_id: locked.video, player_id: locked.player })).status).toBe(404);
    expect((await call(editor, "PATCH", `/v1/videos/${locked.video}`, { title: "x" })).status).toBe(404);
    expect((await call(editor, "DELETE", `/v1/library/reel/${reel}`)).status).toBe(404);
    expect((await call(editor, "POST", `/v1/tracks/${locked.track}/identity-decisions`, { state: "REJECTED" })).status).toBe(404);
    // another organization: not found as before
    expect((await call(other, "GET", `/v1/videos/${locked.video}`)).status).toBe(404);
  });

  it("lists and totals leave it out for him and keep it for the people on it", async () => {
    const ids = async (m: Member, u: string) => ((await call(m, "GET", u)).body as { id: string }[]).map((x) => x.id);
    expect(await ids(editor, "/v1/projects")).not.toContain(locked.project);
    expect(await ids(editor, "/v1/projects")).toContain(open.project);
    expect(await ids(editor, "/v1/videos")).not.toContain(locked.video);
    expect(await ids(editor, "/v1/reels")).not.toContain(reel);
    expect(await ids(editor, "/v1/matches")).not.toContain(locked.match);
    expect(await ids(editor, "/v1/matches")).toContain(open.match);
    for (const m of [owner, admin, analyst, viewer, scout]) {
      expect(await ids(m, "/v1/projects")).toContain(locked.project);
      expect(await ids(m, "/v1/videos")).toContain(locked.video);
      expect(await ids(m, "/v1/reels")).toContain(reel);
    }
    const stats = async (m: Member) => (await call(m, "GET", "/v1/overview/stats")).body;
    expect((await stats(editor)).matches_analyzed).toBe(1);
    expect((await stats(owner)).matches_analyzed).toBe(2);
    const recent = (await call(editor, "GET", "/v1/overview/recent-matches")).body as { video_id: string }[];
    expect(recent.map((x) => x.video_id)).not.toContain(locked.video);
    // his numbers: only from the videos he can see
    const seen = async (m: Member) => (await call(m, "GET", `/v1/players/${open.player}/measures`)).body;
    expect((await seen(editor)).videos).toBe(1);
    expect((await seen(owner)).videos).toBe(2);
    const ev = (await call(editor, "GET", `/v1/players/${open.player}/events`)).body;
    expect(JSON.stringify(ev)).not.toContain(locked.video);
    // the Library: folder counts and Trash
    const f = await call(owner, "POST", "/v1/library/folders", { name: "Box" });
    await call(owner, "PUT", `/v1/library/folder-items/reel/${reel}`, { folder_id: f.body.id });
    expect(((await call(editor, "GET", "/v1/library/folders")).body as { id: string; item_count: number }[]).find((x) => x.id === f.body.id)!.item_count).toBe(0);
    expect(((await call(owner, "GET", "/v1/library/folders")).body as { id: string; item_count: number }[]).find((x) => x.id === f.body.id)!.item_count).toBe(1);
    expect(((await call(editor, "GET", "/v1/library/folder-items")).body as { item_id: string }[]).map((x) => x.item_id)).not.toContain(reel);
    // Shared With Me
    const mine = ((await call(viewer, "GET", "/v1/projects")).body as { id: string; shared_with_me: boolean; my_permission: string | null }[]).find((x) => x.id === locked.project)!;
    expect(mine).toMatchObject({ shared_with_me: true, my_permission: "EDIT" });
  });

  it("the work context bar (A.1, ADR-069) names only what he may see: a locked project, its video, reel and choices stay out", async () => {
    const ctx = async (m: Member, q: string) => (await call(m, "GET", `/v1/context?${q}`)).body;
    // the Owner: the reel gives its video, project and player; the choices list both projects, the project's videos, the confirmed player
    const full = await ctx(owner, `reel=${reel}`);
    expect(full).toMatchObject({ project: { id: locked.project, name: "Locked" }, video: { id: locked.video, title: "Locked video", match_label: null, analysed: true },
      match: null, player: { id: locked.player, display_name: "Open Player" }, reel: { id: reel, name: "Locked reel" } });
    expect(full.choices.projects.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([open.project, locked.project]));
    expect(full.choices.videos.map((x: { id: string }) => x.id)).toEqual([locked.video]);
    expect(full.choices.players.map((x: { id: string }) => x.id)).toEqual([locked.player]);
    expect(full.choices.reels).toEqual([{ id: reel, name: "Locked reel", player_id: locked.player }]);
    // not on the locked project: nothing of it, not even through the reel; the player still, from the open project he can see
    const his = await ctx(editor, `reel=${reel}&video=${locked.video}&project=${locked.project}`);
    expect(his).toMatchObject({ project: null, video: null, reel: null, match: null });
    expect(JSON.stringify(his)).not.toContain(locked.video);
    expect(his.choices.projects.map((x: { id: string }) => x.id)).not.toContain(locked.project);
    expect((await ctx(editor, `player=${open.player}`)).player).toMatchObject({ id: open.player });
    expect((await ctx(editor, `video=${open.video}`)).choices.videos.map((x: { id: string }) => x.id)).toEqual([open.video]);
    // another organization: nothing at all; a bad id is simply unknown
    const theirs = await ctx(other, `reel=${reel}&video=${open.video}&player=${open.player}`);
    expect(theirs).toMatchObject({ project: null, video: null, player: null, reel: null });
    expect(theirs.choices.projects).toEqual([]);
    expect((await call(owner, "GET", "/v1/context?video=nope&player=x")).status).toBe(200);
    expect((await call(null, "GET", "/v1/context")).status).toBe(401);
  });

  it("global search (A.8, ADR-070) finds only what he may see, matches the words literally and checks the query", async () => {
    const find = async (m: Member, q: string) => (await call(m, "GET", `/v1/search?q=${encodeURIComponent(q)}`)).body as { hits: { kind: string; id: string; title: string; detail: string | null; ref: string | null }[] };
    const kinds = (r: { hits: { kind: string; id: string }[] }) => r.hits.map((h) => `${h.kind}:${h.id}`);
    // the Owner: the locked project, its match (by video title and by competition) and its reel
    const all = await find(owner, "Lock");
    expect(kinds(all)).toEqual(expect.arrayContaining([`MATCH:${locked.video}`, `REEL:${reel}`, `PROJECT:${locked.project}`]));
    expect(all.hits.find((h) => h.kind === "MATCH")).toMatchObject({ title: "Locked video", detail: "analysed", ref: null });
    expect(all.hits.find((h) => h.kind === "REEL")).toMatchObject({ title: "Locked reel", detail: "Reel of Open Player" });
    expect(kinds(await find(owner, "Locked Cup"))).toEqual([`MATCH:${locked.video}`]);
    // not on the locked project: nothing of it
    const his = await find(editor, "Lock");
    expect(his.hits).toEqual([]);
    const openHits = await find(editor, "Open");
    expect(kinds(openHits)).toEqual(expect.arrayContaining([`MATCH:${open.video}`, `PLAYER:${open.player}`, `PROJECT:${open.project}`]));
    expect(JSON.stringify(openHits)).not.toContain(locked.video);
    // "starts with" first: the player whose name starts with the words is listed, his OTSI Player ID (or provisional) as the detail
    const pl = openHits.hits.find((h) => h.kind === "PLAYER")!;
    expect(pl.title).toBe("Open Player");
    expect(pl.detail).toBe(pl.ref ?? "provisional (no OTSI Player ID yet)");
    // another organization: nothing
    expect((await find(other, "Open")).hits).toEqual([]);
    expect((await find(other, "Lock")).hits).toEqual([]);
    // wildcards are words: % and _ find nothing here
    expect((await find(owner, "%%")).hits).toEqual([]);
    expect((await find(owner, "O_en")).hits).toEqual([]);
    // the query: 2 to 80 characters, signed in
    expect((await call(owner, "GET", "/v1/search?q=o")).status).toBe(422);
    expect((await call(owner, "GET", "/v1/search")).status).toBe(422);
    expect((await call(owner, "GET", `/v1/search?q=${"x".repeat(81)}`)).status).toBe(422);
    expect((await call(null, "GET", "/v1/search?q=Open")).status).toBe(401);
  });

  it("changes need Editor / Manager there; a Reviewer may decide identities; a viewer stays a viewer", async () => {
    // an analyst who is a Reviewer there: identity decisions yes, renaming the video no
    const cur = (await call(checker, "GET", `/v1/tracks/${locked.track}/identity`)).body.decision_id as string;
    const dec = await call(checker, "POST", `/v1/tracks/${locked.track}/identity-decisions`, { state: "REJECTED", player_id: locked.player, supersedes_id: cur, reason: "not him" });
    expect(dec.status).toBeLessThan(300);
    const rv = await call(checker, "PATCH", `/v1/videos/${locked.video}`, { title: "Checker title" });
    expect(rv.status).toBe(403);
    expect(rv.body.code).toBe("PROJECT_READ_ONLY");
    expect((await call(scout, "GET", `/v1/videos/${locked.video}`)).status).toBe(200);
    // the viewer is Editor on the project, but his organization role is Viewer: still refused by the role
    expect((await call(viewer, "POST", "/v1/reels", { video_id: locked.video, player_id: locked.player })).status).toBe(403);
    // the analyst is Manager there: he edits and manages; he cannot take himself off
    expect((await call(analyst, "PATCH", `/v1/videos/${locked.video}`, { title: "Analyst title" })).status).toBe(200);
    expect((await call(analyst, "PUT", `/v1/projects/${locked.project}/access/people/${editor.userId}`, { permission: "READ" })).status).toBe(200);
    expect((await call(analyst, "DELETE", `/v1/projects/${locked.project}/access/people/${analyst.userId}`)).status).toBe(409);
    // the editor is a Viewer there now: he sees it, but cannot change it
    expect((await call(editor, "GET", `/v1/videos/${locked.video}`)).status).toBe(200);
    const w = await call(editor, "PATCH", `/v1/videos/${locked.video}`, { title: "Editor title" });
    expect(w.status).toBe(403);
    expect(w.body.code).toBe("PROJECT_READ_ONLY");
    // taken off: hidden again from his very next request
    expect((await call(analyst, "DELETE", `/v1/projects/${locked.project}/access/people/${editor.userId}`)).status).toBe(200);
    expect((await call(editor, "GET", `/v1/videos/${locked.video}`)).status).toBe(404);
  });

  it("a new project can start restricted with its creator as Manager; opening it again shows it to everyone", async () => {
    const c = await call(editor, "POST", "/v1/projects", { name: "Private start", access: "RESTRICTED" });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ access: "RESTRICTED", my_permission: "ADMIN", can_manage_access: true });
    expect(((await call(analyst, "GET", "/v1/projects")).body as { id: string }[]).map((x) => x.id)).not.toContain(c.body.id);
    expect(((await call(owner, "GET", "/v1/projects")).body as { id: string }[]).map((x) => x.id)).toContain(c.body.id);
    expect((await call(owner, "PUT", `/v1/projects/${locked.project}/access`, { access: "ORGANIZATION" })).status).toBe(200);
    expect((await call(editor, "GET", `/v1/videos/${locked.video}`)).status).toBe(200);
    expect(((await call(editor, "GET", "/v1/reels")).body as { id: string }[]).map((x) => x.id)).toContain(reel);
  });
});
