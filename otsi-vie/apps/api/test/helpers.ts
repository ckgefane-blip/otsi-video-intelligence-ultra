/** Test helpers: the API under test, signed access tokens, and seed rows written with the ROOT account (fixtures, not via the API). */
import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { importJWK, SignJWT } from "jose";
import mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { inject } from "vitest";
import { createApp } from "../src/app";
import { Db } from "../src/core/db";

export const ISSUER = "https://issuer.test.otsi.invalid/";
export const AUDIENCE = "otsi-vie-api";

export async function startApi(opts: { storageDir?: string; partBytes?: number; maxUploadBytes?: number; credentialKey?: string } = {}): Promise<NestFastifyApplication> {
  return createApp({
    dbDsn: inject("appDsn"), jwtIssuer: ISSUER, jwtAudience: AUDIENCE, jwtPublicKeyPem: inject("publicKeyPem"), port: 0,
    ...(opts.credentialKey ? { credentialKey: opts.credentialKey } : {}),
    ...(opts.storageDir ? { storage: { dir: opts.storageDir, partBytes: opts.partBytes ?? 1024 * 1024, maxUploadBytes: opts.maxUploadBytes ?? 64 * 1024 ** 3 } } : {}),
  });
}

export async function rootDb() {
  const u = new URL(inject("rootDsn"));
  return mysql.createConnection({ host: u.hostname, port: Number(u.port), user: "root", password: decodeURIComponent(u.password), database: u.pathname.slice(1), dateStrings: true });
}

export async function token(sub: string, over: { iss?: string; aud?: string; expSeconds?: number } = {}): Promise<string> {
  const key = await importJWK(JSON.parse(inject("privateJwk")), "RS256");
  return new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setSubject(sub).setIssuer(over.iss ?? ISSUER).setAudience(over.aud ?? AUDIENCE)
    .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + (over.expSeconds ?? 600)).sign(key);
}

export interface Member { userId: string; subject: string; orgId: string; role: string; headers: Record<string, string> }

/** An organization with one ACTIVE member of `role`. */
export async function seedMember(db: mysql.Connection, role = "OWNER", orgId?: string): Promise<Member> {
  const org = orgId ?? uuidv7();
  if (!orgId) await db.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [org, `Org ${org.slice(-6)}`, `org-${org}`]);
  const userId = uuidv7();
  const subject = `sub-${randomUUID()}`;
  await db.query("INSERT INTO users (id, external_subject, email, display_name) VALUES (?, ?, ?, ?)", [userId, subject, `${subject}@test.invalid`, "Test User"]);
  await db.query("INSERT INTO memberships (organization_id, user_id, role, status) VALUES (?, ?, ?, 'ACTIVE')", [org, userId, role]);
  return { userId, subject, orgId: org, role, headers: { authorization: `Bearer ${await token(subject)}`, "x-organization-id": org } };
}

/** project -> video -> processing run -> `n` tracks, all in `m`'s organization. */
export async function seedTracks(db: mysql.Connection, m: Member, n = 1): Promise<{ runId: string; videoId: string; trackIds: string[] }> {
  const projectId = uuidv7(), videoId = uuidv7(), runId = uuidv7();
  await db.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [projectId, m.orgId, m.userId]);
  await db.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, created_by) VALUES (?, ?, ?, 'UPLOAD', ?)", [videoId, m.orgId, projectId, m.userId]);
  await db.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version) VALUES (?, ?, ?, 'test')", [runId, videoId, m.orgId]);
  const trackIds: string[] = [];
  for (let i = 1; i <= n; i++) {
    const t = uuidv7();
    await db.query("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, first_pts_us, last_pts_us) VALUES (?, ?, ?, ?, 'PLAYER', 0, 1000000)", [t, runId, videoId, i]);
    trackIds.push(t);
  }
  return { runId, videoId, trackIds };
}

export const key = () => `k-${randomUUID()}`;

/** The API's own database access class on the least-privilege RUNTIME account (what the dispatcher worker uses in production). */
export function appDb(): Db {
  return new Db({ dbDsn: inject("appDsn") });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A.11 (ADR-077): a video may be analysed only with rights that allow it; tests that analyse record them as Upload would */
export async function seedRights(root: mysql.Connection | mysql.Pool, org: string, videoId: string, uses = ["VIEW", "ANALYZE", "PRODUCE"], guardian = "NOT_APPLICABLE"): Promise<void> {
  await root.query(`INSERT INTO rights_grants (id, organization_id, video_id, rights_state, allowed_uses, valid_from, valid_until, guardian_consent_state)
                    VALUES (?, ?, ?, 'INTERNAL', ?, CURRENT_TIMESTAMP(6), NULL, ?)`, [uuidv7(), org, videoId, JSON.stringify(uses), guardian]);
}
