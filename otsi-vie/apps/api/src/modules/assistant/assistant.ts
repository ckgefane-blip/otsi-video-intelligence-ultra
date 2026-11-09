import { Body, Controller, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { AssistantRequest, AssistantStep, parseAssistantCommand, type AssistantPlan, type AssistantResult } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { userActor, writeAudit } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, type Principal } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { JobsService } from "../jobs/jobs";
import { SearchService } from "../overview/search";
import { uuidParam } from "../players/players.controller";

interface PlanRow extends RowDataPacket {
  preview_role: string;
  step: unknown;
  approved_at: string | null;
  expired: number;
}

const SELECT = `SELECT preview_role, step, approved_at, expires_at <= UTC_TIMESTAMP(6) AS expired
  FROM assistant_plans WHERE id = ? AND organization_id = ? AND user_id = ?`;

@Injectable()
export class AssistantService {
  constructor(private readonly db: Db, private readonly search: SearchService, private readonly jobs: JobsService) {}

  async preview(command: string, p: Principal): Promise<AssistantPlan> {
    const step = parseAssistantCommand(command);
    if (!step) throw new ApiError(422, "UNKNOWN_ASSISTANT_COMMAND", "Use search, show jobs, or open one of the listed workspaces.");
    const id = uuidv7();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    await this.db.pool.query("DELETE FROM assistant_plans WHERE organization_id = ? AND user_id = ? AND expires_at <= UTC_TIMESTAMP(6)", [p.organizationId, p.userId]);
    await this.db.pool.query(
      "INSERT INTO assistant_plans (id, organization_id, user_id, preview_role, step, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      [id, p.organizationId, p.userId, p.role, JSON.stringify(step), expiresAt.slice(0, 23).replace("T", " ")],
    );
    return { id, step, expires_at: expiresAt };
  }

  private available(row: PlanRow | undefined, p: Principal): PlanRow {
    if (!row) throw notFound("Assistant plan");
    if (row.approved_at || Number(row.expired) || row.preview_role !== p.role) {
      throw new ApiError(409, "ASSISTANT_PLAN_UNAVAILABLE", "This plan expired, was already approved, or your role changed. Preview a new plan.");
    }
    return row;
  }

  private async readStep(step: AssistantStep, p: Principal): Promise<AssistantResult> {
    switch (step.kind) {
      case "search": return { kind: "search", result: await this.search.search(step.query, p) };
      case "jobs": return { kind: "jobs", result: await this.jobs.list(p) };
      case "open": return { kind: "open", page: step.page };
    }
  }

  async approve(id: string, p: Principal): Promise<AssistantResult> {
    const key = [id, p.organizationId, p.userId];
    const actor = userActor(p);
    const step = await this.db.tx(async (c) => {
      const row = this.available(await this.db.one<PlanRow>(SELECT + " FOR UPDATE", key, c), p);
      const step = AssistantStep.parse(typeof row.step === "string" ? JSON.parse(row.step) : row.step);
      await c.query("UPDATE assistant_plans SET approved_at = UTC_TIMESTAMP(6), step = NULL WHERE id = ?", [id]);
      await writeAudit(c, actor, { action: "assistant.plan_approved", entityType: "assistant_plan", entityId: id, after: { kind: step.kind } });
      return step;
    });
    let result: AssistantResult;
    try {
      result = await this.readStep(step, p);
    } catch (e) {
      await writeAudit(this.db.pool, actor, { action: "assistant.step_failed", entityType: "assistant_plan", entityId: id, after: { kind: step.kind } });
      throw e;
    }
    const summary = result.kind === "search" ? { hits: result.result.hits.length }
      : result.kind === "jobs" ? { jobs: result.result.jobs.length } : { page: result.page };
    await writeAudit(this.db.pool, actor, { action: "assistant.step_completed", entityType: "assistant_plan", entityId: id, after: { kind: step.kind, ...summary } });
    return result;
  }
}

@Controller("v1/assistant/plans")
@UseGuards(AuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post()
  preview(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const input = AssistantRequest.safeParse(body);
    if (!input.success) throw new ApiError(422, "BAD_ASSISTANT_COMMAND", "Enter one command, up to 96 characters.");
    return this.assistant.preview(input.data.command, p);
  }

  @Post(":id/approve")
  @HttpCode(200)
  approve(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    if (body !== undefined) throw new ApiError(422, "BAD_ASSISTANT_APPROVAL", "Approve the preview by its ID. The previewed action cannot be changed.");
    return this.assistant.approve(uuidParam(id, "Assistant plan"), p);
  }
}
