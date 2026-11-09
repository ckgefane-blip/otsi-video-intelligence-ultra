import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  OrgRetentionPolicy,
  PurgeTrashRequest,
  PurgeTrashResult,
  SubjectErasureRecord,
  SubjectErasureRequest,
  SubjectErasureSummary,
  UpdateRetentionPolicyRequest,
} from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { userActor, writeAudit } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";

const DEFAULT_POLICY: (orgId: string) => OrgRetentionPolicy = (orgId: string) =>
  OrgRetentionPolicy.parse({
    organization_id: orgId,
    trash_days: 30,
    raw_footage_days: null,
    rendered_reels_days: null,
    audit_log_days: 365,
    auto_purge_enabled: false,
    updated_at: new Date().toISOString(),
    updated_by: null,
  });

@Injectable()
export class RetentionService {
  constructor(private readonly db: Db) {}

  async getPolicy(p: Principal): Promise<OrgRetentionPolicy> {
    const row = await this.db.one<RowDataPacket>(
      `SELECT organization_id, trash_days, raw_footage_days, rendered_reels_days, 
              audit_log_days, auto_purge_enabled, updated_at, updated_by
         FROM org_retention_policies
        WHERE organization_id = ?`,
      [p.organizationId],
    );
    if (!row) return DEFAULT_POLICY(p.organizationId);
    return OrgRetentionPolicy.parse({
      organization_id: row.organization_id,
      trash_days: Number(row.trash_days),
      raw_footage_days: row.raw_footage_days != null ? Number(row.raw_footage_days) : null,
      rendered_reels_days: row.rendered_reels_days != null ? Number(row.rendered_reels_days) : null,
      audit_log_days: Number(row.audit_log_days),
      auto_purge_enabled: Boolean(row.auto_purge_enabled),
      updated_at: new Date(row.updated_at).toISOString(),
      updated_by: row.updated_by ?? null,
    });
  }

  async updatePolicy(
    p: Principal,
    req: UpdateRetentionPolicyRequest,
  ): Promise<OrgRetentionPolicy> {
    const parsed = UpdateRetentionPolicyRequest.parse(req);
    const existing = await this.getPolicy(p);

    const merged = {
      trash_days: parsed.trash_days !== undefined ? parsed.trash_days : existing.trash_days,
      raw_footage_days:
        parsed.raw_footage_days !== undefined
          ? parsed.raw_footage_days
          : existing.raw_footage_days,
      rendered_reels_days:
        parsed.rendered_reels_days !== undefined
          ? parsed.rendered_reels_days
          : existing.rendered_reels_days,
      audit_log_days:
        parsed.audit_log_days !== undefined ? parsed.audit_log_days : existing.audit_log_days,
      auto_purge_enabled:
        parsed.auto_purge_enabled !== undefined
          ? parsed.auto_purge_enabled
          : existing.auto_purge_enabled,
    };

    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO org_retention_policies 
           (organization_id, trash_days, raw_footage_days, rendered_reels_days, audit_log_days, auto_purge_enabled, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), ?)
         ON DUPLICATE KEY UPDATE
           trash_days = VALUES(trash_days),
           raw_footage_days = VALUES(raw_footage_days),
           rendered_reels_days = VALUES(rendered_reels_days),
           audit_log_days = VALUES(audit_log_days),
           auto_purge_enabled = VALUES(auto_purge_enabled),
           updated_at = CURRENT_TIMESTAMP(6),
           updated_by = VALUES(updated_by)`,
        [
          p.organizationId,
          merged.trash_days,
          merged.raw_footage_days,
          merged.rendered_reels_days,
          merged.audit_log_days,
          merged.auto_purge_enabled,
          p.userId,
        ],
      );

      await writeAudit(c, userActor(p), {
        action: "retention.policy_updated",
        entityType: "organization",
        entityId: p.organizationId,
        before: existing,
        after: merged,
      });
    });

    return this.getPolicy(p);
  }

  async purgeTrash(p: Principal, req: PurgeTrashRequest): Promise<PurgeTrashResult> {
    const policy = await this.getPolicy(p);
    const thresholdDays = req.all ? 0 : req.older_than_days ?? policy.trash_days;

    return this.db.tx(async (c) => {
      // Find eligible deletions
      const [rows] = await c.query<RowDataPacket[]>(
        `SELECT id, item_kind, item_id, title, deleted_at
           FROM library_deletions
          WHERE organization_id = ?
            AND restored_at IS NULL
            AND deleted_at <= DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL ? DAY)`,
        [p.organizationId, thresholdDays],
      );

      if (rows.length === 0) {
        return PurgeTrashResult.parse({
          purged_count: 0,
          purged_items: [],
          freed_bytes: 0,
          retention_days: thresholdDays,
        });
      }

      const deletionIds = rows.map((r) => r.id as string);
      const purgedItems = rows.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        kind: r.item_kind as string,
      }));

      // Approximate freed bytes from deleted renders/videos in these items
      const [assetRows] = await c.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(a.byte_size), 0) as total_bytes
           FROM library_deletion_items ldi
           LEFT JOIN render_jobs j ON j.id = ldi.item_id AND ldi.item_kind = 'render'
           LEFT JOIN assets a ON a.id = j.output_asset_id
          WHERE ldi.deletion_id IN (?)`,
        [deletionIds],
      );
      const freedBytes = Number(assetRows[0]?.total_bytes ?? 0);

      // Permanently remove deletion items and deletions
      await c.query(`DELETE FROM library_deletion_items WHERE deletion_id IN (?)`, [deletionIds]);
      await c.query(`DELETE FROM library_deletions WHERE id IN (?)`, [deletionIds]);

      await writeAudit(c, userActor(p), {
        action: "trash.purged",
        entityType: "library_trash",
        entityId: p.organizationId,
        before: { count: rows.length, threshold_days: thresholdDays },
        after: { purged: rows.length, freed_bytes: freedBytes },
      });

      return PurgeTrashResult.parse({
        purged_count: rows.length,
        purged_items: purgedItems,
        freed_bytes: freedBytes,
        retention_days: thresholdDays,
      });
    });
  }

  async eraseSubject(
    p: Principal,
    req: SubjectErasureRequest,
  ): Promise<SubjectErasureRecord> {
    const requestId = uuidv7();
    const orgId = p.organizationId;

    return this.db.tx(async (c) => {
      let subjectRef: string | null = null;
      let summary: SubjectErasureSummary;

      if (req.subject_kind === "PLAYER") {
        const [pRows] = await c.query<RowDataPacket[]>(
          "SELECT id, display_name, canonical_otsi_id FROM players WHERE id = ?",
          [req.subject_id],
        );
        if (pRows.length === 0 || !pRows[0]) throw notFound("Player");
        const player = pRows[0];
        subjectRef = (player.canonical_otsi_id as string) ?? (player.id as string);

        // 1. Anonymize player personal identity fields
        const anonName = `Anonymized Player ${subjectRef.slice(0, 16)}`;
        await c.query(
          `UPDATE players 
              SET display_name = ?, birth_date = NULL, preferred_foot = NULL
            WHERE id = ?`,
          [anonName, req.subject_id],
        );

        // 2. Clear scouting dossiers, assessments, notes and tags linked to player
        const [dossierRes] = await c.query(
          "DELETE FROM scouting_dossier_players WHERE player_id = ?",
          [req.subject_id],
        );
        const [assessRes] = await c.query(
          "DELETE FROM player_assessments WHERE player_id = ? AND organization_id = ?",
          [req.subject_id, orgId],
        );
        const [tagsRes] = await c.query(
          "DELETE FROM player_tags WHERE player_id = ? AND organization_id = ?",
          [req.subject_id, orgId],
        );
        await c.query(
          "DELETE FROM comments WHERE player_id = ? AND organization_id = ?",
          [req.subject_id, orgId],
        );

        // 3. Clear identity decisions for this player (append UNRESOLVED superseding decision)
        const [curDecisions] = await c.query<RowDataPacket[]>(
          `SELECT d.id, d.track_id
             FROM track_identity_decisions d
             JOIN tracks t ON t.id = d.track_id
             JOIN video_sources v ON v.id = t.video_id
            WHERE d.player_id = ? AND v.organization_id = ? AND d.state = 'CONFIRMED'`,
          [req.subject_id, orgId],
        );
        let clearedIdentities = 0;
        for (const dec of curDecisions) {
          const newDecId = uuidv7();
          await c.query(
            `INSERT INTO track_identity_decisions (id, track_id, player_id, state, decided_by, basis, supersedes_id, reason)
             VALUES (?, ?, NULL, 'UNRESOLVED', ?, 'MANUAL', ?, 'Subject erasure (GDPR Article 17)')`,
            [newDecId, dec.track_id, p.userId, dec.id],
          );
          clearedIdentities++;
        }

        // 4. Count historical audit records referencing this player
        const [auditCount] = await c.query<RowDataPacket[]>(
          "SELECT COUNT(*) as count FROM audit_events WHERE organization_id = ? AND entity_type = 'player' AND entity_id = ?",
          [orgId, req.subject_id],
        );
        const auditRecordsCount = Number(auditCount[0]?.count ?? 0);

        summary = SubjectErasureSummary.parse({
          pseudonymized_name: anonName,
          redacted_audit_records: auditRecordsCount,
          cleared_identities: clearedIdentities,
          cleared_dossiers: (dossierRes as { affectedRows?: number })?.affectedRows ?? 0,
          cleared_assessments: (assessRes as { affectedRows?: number })?.affectedRows ?? 0,
          cleared_tags: (tagsRes as { affectedRows?: number })?.affectedRows ?? 0,
        });
      } else {
        // User subject erasure
        const [uRows] = await c.query<RowDataPacket[]>(
          `SELECT u.id, u.display_name, u.email, m.role
             FROM users u
             JOIN memberships m ON m.user_id = u.id
            WHERE u.id = ? AND m.organization_id = ?`,
          [req.subject_id, orgId],
        );
        if (uRows.length === 0 || !uRows[0]) throw notFound("User");
        const user = uRows[0];
        if (user.role === "OWNER") {
          const [owners] = await c.query<RowDataPacket[]>(
            "SELECT COUNT(*) as count FROM memberships WHERE organization_id = ? AND role = 'OWNER' AND status = 'ACTIVE'",
            [orgId],
          );
          if (Number(owners[0]?.count ?? 0) <= 1) {
            throw new ApiError(
              409,
              "CANNOT_ERASE_LAST_OWNER",
              "Cannot erase the sole organization owner. Transfer ownership or add another owner first.",
            );
          }
        }

        subjectRef = (user.email as string) ?? "unknown";
        const anonName = "Former Member";
        const anonEmail = `erased-${req.subject_id.slice(0, 8)}@otsi.internal`;

        // 1. Anonymize user table
        await c.query(
          `UPDATE users 
              SET display_name = ?, email = ?
            WHERE id = ?`,
          [anonName, anonEmail, req.subject_id],
        );

        // 2. Remove credentials and 2FA
        await c.query("DELETE FROM user_totp WHERE user_id = ?", [req.subject_id]);
        await c.query("DELETE FROM user_recovery_codes WHERE user_id = ?", [req.subject_id]);
        await c.query("DELETE FROM user_avatars WHERE user_id = ?", [req.subject_id]);

        // 3. Remove membership from organization
        await c.query(
          "DELETE FROM memberships WHERE user_id = ? AND organization_id = ?",
          [req.subject_id, orgId],
        );

        // 4. Count audit log entries referencing this user
        const [auditCount] = await c.query<RowDataPacket[]>(
          "SELECT COUNT(*) as count FROM audit_events WHERE organization_id = ? AND actor_id = ?",
          [orgId, req.subject_id],
        );
        const auditRecordsCount = Number(auditCount[0]?.count ?? 0);

        summary = SubjectErasureSummary.parse({
          pseudonymized_name: anonName,
          redacted_audit_records: auditRecordsCount,
          cleared_identities: 0,
          cleared_dossiers: 0,
          cleared_assessments: 0,
          cleared_tags: 0,
        });
      }

      // Record erasure request
      await c.query(
        `INSERT INTO subject_erasure_requests 
           (id, organization_id, subject_kind, subject_id, subject_ref, requested_by, executed_at, summary)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), ?)`,
        [
          requestId,
          orgId,
          req.subject_kind,
          req.subject_id,
          subjectRef,
          p.userId,
          JSON.stringify(summary),
        ],
      );

      // Append immutable erasure audit record
      await writeAudit(c, userActor(p), {
        action: "subject.erased",
        entityType: req.subject_kind.toLowerCase(),
        entityId: req.subject_id,
        before: { subject_kind: req.subject_kind },
        after: {
          request_id: requestId,
          reason: req.reason ?? "GDPR Data Subject Request",
          summary,
        },
      });

      return SubjectErasureRecord.parse({
        id: requestId,
        organization_id: orgId,
        subject_kind: req.subject_kind,
        subject_id: req.subject_id,
        subject_ref: subjectRef,
        requested_by: p.userId,
        executed_at: new Date().toISOString(),
        summary,
      });
    });
  }

  async listErasures(p: Principal): Promise<SubjectErasureRecord[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT id, organization_id, subject_kind, subject_id, subject_ref, requested_by, executed_at, summary
         FROM subject_erasure_requests
        WHERE organization_id = ?
        ORDER BY executed_at DESC LIMIT 100`,
      [p.organizationId],
    );
    return rows.map((r) =>
      SubjectErasureRecord.parse({
        id: r.id,
        organization_id: r.organization_id,
        subject_kind: r.subject_kind,
        subject_id: r.subject_id,
        subject_ref: r.subject_ref,
        requested_by: r.requested_by,
        executed_at: new Date(r.executed_at).toISOString(),
        summary: typeof r.summary === "string" ? JSON.parse(r.summary) : r.summary,
      }),
    );
  }
}

@Controller("v1/admin/retention")
@UseGuards(AuthGuard)
@Roles("OWNER", "ADMIN")
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  policy(@CurrentPrincipal() p: Principal): Promise<OrgRetentionPolicy> {
    return this.retention.getPolicy(p);
  }

  @Patch()
  update(
    @CurrentPrincipal() p: Principal,
    @Body() body: UpdateRetentionPolicyRequest,
  ): Promise<OrgRetentionPolicy> {
    return this.retention.updatePolicy(p, body);
  }

  @Post("trash/purge")
  @HttpCode(200)
  purgeTrash(
    @CurrentPrincipal() p: Principal,
    @Body() body: PurgeTrashRequest,
  ): Promise<PurgeTrashResult> {
    return this.retention.purgeTrash(p, body);
  }

  @Post("erasure")
  @HttpCode(200)
  erase(
    @CurrentPrincipal() p: Principal,
    @Body() body: SubjectErasureRequest,
  ): Promise<SubjectErasureRecord> {
    return this.retention.eraseSubject(p, body);
  }

  @Get("erasures")
  listErasures(@CurrentPrincipal() p: Principal): Promise<SubjectErasureRecord[]> {
    return this.retention.listErasures(p);
  }
}
