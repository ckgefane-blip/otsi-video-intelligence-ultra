/**
 * v3 Phase A.11 (ADR-077): the rights declared on Upload, and the rule every analysis start obeys.
 *   declareRights        the four answers become the video's rights grant (with the upload or import, or later for a video that has none)
 *   analysisRightsBlock  why the video's current grant does not allow analysis (null: it does); insertRun refuses with it
 */
import { analysisBlock, ANALYSIS_RIGHTS_REASONS, grantOfDeclaration, type AnalysisRightsReason, type UploadRights } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, type Actor } from "../../core/audit";
import type { Executor } from "../../core/db";

const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

export async function declareRights(c: Executor, actor: Actor, org: string, videoId: string, d: UploadRights): Promise<string> {
  const id = uuidv7(), g = grantOfDeclaration(d);
  await c.query(`INSERT INTO rights_grants (id, organization_id, video_id, rights_state, allowed_uses, valid_from, valid_until, guardian_consent_state)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), NULL, ?)`, [id, org, videoId, g.rights_state, JSON.stringify(g.allowed_uses), d.guardian_consent]);
  await recordChange(c, actor, { action: "video.rights_declared", entityType: "video", entityId: videoId,
    after: { grant_id: id, analyse: d.analyse, share: d.share, download: d.download, guardian_consent: d.guardian_consent, rights_state: g.rights_state, allowed_uses: g.allowed_uses } });
  return id;
}

/** use PRODUCE: may new pictures and videos be made from it (snapshots, B.5); the same grant, the same validity and consent rules */
export async function analysisRightsBlock(ex: Executor, org: string, videoId: string, use: "ANALYZE" | "PRODUCE" = "ANALYZE"): Promise<{ code: AnalysisRightsReason; text: string } | null> {
  const [rows] = await ex.query<RowDataPacket[]>(
    "SELECT rights_state, allowed_uses, valid_from, valid_until, guardian_consent_state FROM rights_grants WHERE video_id = ? AND organization_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
    [videoId, org]);
  const g = rows[0];
  const code = analysisBlock(g ? { rights_state: g.rights_state, allowed_uses: json<string[]>(g.allowed_uses) ?? [], valid_from: g.valid_from, valid_until: g.valid_until,
    guardian_consent_state: g.guardian_consent_state } : null, new Date(), use);
  return code ? { code, text: ANALYSIS_RIGHTS_REASONS[code] } : null;
}
