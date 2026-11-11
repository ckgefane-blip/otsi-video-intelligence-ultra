/**
 * AI Analyst (ADR-141, ultra-only; scope: ai-analyst-scope.md).
 *
 *   GET    /v1/players/:id/ai-analysis/status             provider configured? cost? privacy note
 *   GET    /v1/players/:id/ai-analysis                    latest assessment (draft or published), with staleness
 *   POST   /v1/players/:id/ai-analysis                    generate (draft) — 10 tokens, charged at enqueue
 *   POST   /v1/players/:id/ai-analysis/:aid/publish       draft -> published (a person has read it)
 *   POST   /v1/players/:id/ai-analysis/:aid/unpublish     published -> draft
 *
 * The guardrails live in packages/contracts/src/ai-analyst.ts and are enforced here in this order:
 *   1. identity gate — verified OTSI PIN only (the same verified rule as the Profile Intro: registered, at
 *      least one track confirmed by a person). A provisional player gets 409 IDENTITY_UNCONFIRMED, never an
 *      assessment. 2. minimum-data gate — fewer than 1 match or 5 events stores a NOT_ENOUGH_DATA draft and
 *      stops (no provider call, no charge). 3. provider gate — no provider configured answers 503
 *      AI_ANALYST_NOT_CONFIGURED and never fabricates output. 4. the charge (10 tokens, AI_ANALYSIS, in the
 *      same transaction as the assessment row, so a job that fails to enqueue charges nothing). 5. the provider
 *      call (structured measured data only — never video), then the DETERMINISTIC post-check in code. A failed
 *      check retries once with a stricter prompt; a second failure refunds the 10 tokens, records the failure
 *      on the row, and answers 502 AI_ANALYSIS_UNVERIFIED — no unverified text is stored or shown.
 *   6. publish gate — only a verified, non-stale draft with a verified output may be published, by a person.
 *
 * This module is NOT the command assistant (modules/assistant): that routes typed commands to search, jobs and
 * pages. The Analyst reasons about measured player data. The two share nothing.
 */
import { Body, Controller, Get, Inject, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import {
  AI_ANALYST_COST_TOKENS,
  AI_ANALYST_PROMPT_VERSION,
  AiAnalystAssessment,
  AiAnalystAssessmentBodyStored,
  AiAnalystEvidence,
  AiAnalystInputSnapshot,
  AiAnalystProviderStatus,
  AI_ANALYST_PRIVACY_NOTE,
  buildAnalystPrompt,
  confidenceFor,
  dataBasisOf,
  analystAssessmentStale,
  evidenceLinksOf,
  GenerateAiAnalysisRequest,
  minimumDataReason,
  postCheckAssessment,
  TOKEN_COSTS,
  type AiAnalystConfidence,
} from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { CONFIG, Config, type AiAnalystConfig } from "../../core/config";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { HeatZonesService } from "../analysis/heat";
import { requireIdentity } from "../playerreport/gate";
import { ASSESSORS } from "../playerreport/playerreport";
import { uuidParam } from "../players/players.controller";
import { ProfileIntroService } from "../profileintro/profileintro";
import { WalletService } from "../wallet/wallet";

export const AI_ANALYST_NOT_CONFIGURED = "AI_ANALYST_NOT_CONFIGURED";
export const AI_ANALYSIS_UNVERIFIED = "AI_ANALYSIS_UNVERIFIED";

/** What the `output` JSON column holds: the verified body plus the code-computed overall confidence and links. */
const StoredOutput = AiAnalystAssessmentBodyStored.extend({
  confidence_overall: z.enum(["HIGH", "MEDIUM", "LOW", "NOT_ENOUGH_DATA"]),
  evidence_links: z.array(AiAnalystEvidence),
});
type StoredOutput = z.infer<typeof StoredOutput>;

/** A MySQL JSON column arrives as an object or a string depending on the driver: accept both. */
function asJson<T>(v: unknown): T {
  if (typeof v === "string") return JSON.parse(v) as T;
  return v as T;
}

function toDbDate(iso: string): string {
  return iso.replace("T", " ").replace("Z", "").slice(0, 19) + ".000000";
}

// ------------------------------------------------------------------ provider (pluggable)
/** The pluggable provider interface: one method, structured input in, structured output out. Option B (a local
 *  model on the owner's machine) is a later on-premises option if a club requires it — it would implement this
 *  same interface, and nothing else in this module would change. */
export interface AiAnalystProvider {
  /** "provider/model", recorded with the assessment */
  readonly name: string;
  generate(prompt: { version: string; system: string; user: string }): Promise<unknown>;
}

/** The hosted-LLM path (Option A, recommended): an OpenAI-compatible chat-completions endpoint. Only the input
 *  snapshot JSON is sent — never video, never raw tracking data, never another player's data. The key travels in
 *  one Authorization header and is never logged, never stored, never returned. */
export class HostedLlmProvider implements AiAnalystProvider {
  readonly name: string;
  constructor(private readonly cfg: AiAnalystConfig) {
    this.name = `${cfg.provider}/${cfg.model}`;
  }

  async generate(prompt: { version: string; system: string; user: string }): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    try {
      const r = await fetch(this.cfg.apiUrl, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      });
      if (!r.ok) throw new ApiError(502, "AI_ANALYST_PROVIDER_FAILED", `The AI provider answered ${r.status}. No assessment was produced.`);
      const data = (await r.json()) as { choices?: { message?: { content?: string | null } }[] };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new ApiError(502, "AI_ANALYST_PROVIDER_FAILED", "The AI provider returned no assessment text.");
      // the model sometimes wraps JSON in a markdown fence: strip it before parsing, never before checking
      const text = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ApiError(502, "AI_ANALYST_PROVIDER_FAILED", "The AI provider returned text that is not a structured assessment.");
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as Error).name === "AbortError") throw new ApiError(502, "AI_ANALYST_PROVIDER_FAILED", "The AI provider took too long to answer. No assessment was produced.");
      throw new ApiError(502, "AI_ANALYST_PROVIDER_FAILED", "The AI provider could not be reached. No assessment was produced.");
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Null when no provider is configured: the feature reports "not configured" and never fabricates output. */
export function resolveAiAnalystProvider(cfg: Config): AiAnalystProvider | null {
  if (!cfg.aiAnalyst) return null;
  return new HostedLlmProvider(cfg.aiAnalyst);
}

// ------------------------------------------------------------------ service
@Injectable()
export class AiAnalystService {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly cfg: Config,
    @Inject(ProfileIntroService) private readonly intro: ProfileIntroService,
    @Inject(HeatZonesService) private readonly heat: HeatZonesService,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  providerStatus(): AiAnalystProviderStatus {
    const c = this.cfg.aiAnalyst;
    return AiAnalystProviderStatus.parse({
      configured: !!c,
      provider: c?.provider ?? null,
      model: c?.model ?? null,
      cost_tokens: AI_ANALYST_COST_TOKENS,
      privacy_note: AI_ANALYST_PRIVACY_NOTE,
    });
  }

  /** Assemble exactly the measured input the scope allows (scope §4), from the Profile Intro + PlayerMeasures +
   *  the player's events. Per-match minutes seen are NOT split by match: the engine measures time seen on camera
   *  for the player overall, not per match, so the snapshot says so rather than splitting it by guesswork. */
  async assembleInput(playerId: string, p: Principal): Promise<AiAnalystInputSnapshot> {
    const intro = await this.intro.assemble(playerId, p, null);
    const m = await this.heat.player(playerId, p);
    const ev = await this.heat.playerEvents(playerId, p);
    const profile = intro.profile;
    const details = profile.details;
    const club = profile.latest_team?.team ?? details?.club_name ?? null;
    const clubSource = profile.latest_team?.team ? "ROSTER" as const : details?.club_name ? "USER_ENTERED" as const : null;
    const goals = ev.videos > 0 ? ev.items.filter((e) => e.kind === "GOAL").length : null;
    const perMatch = new Map<string, { video_id: string; video_title: string; events: Record<string, number>; events_count: number }>();
    for (const e of ev.items) {
      let pm = perMatch.get(e.video_id);
      if (!pm) {
        pm = { video_id: e.video_id, video_title: e.video_title, events: { PASS: 0, PASS_RECEIVED: 0, BALL_WON: 0, PRESSURE: 0, SHOT: 0, SET_PIECE: 0, GOAL: 0 }, events_count: 0 };
        perMatch.set(e.video_id, pm);
      }
      pm.events[e.kind] = (pm.events[e.kind] ?? 0) + 1;
      pm.events_count += 1;
    }
    return AiAnalystInputSnapshot.parse({
      player_id: playerId,
      otsi_pin: intro.player.canonical_otsi_id,
      display_name: intro.player.display_name,
      position: profile.latest_team?.position ?? profile.position ?? null,
      club,
      club_source: clubSource,
      nationality: profile.nationality?.name ?? null,
      age: profile.age,
      height_cm: details?.height_cm ?? null,
      weight_kg: details?.weight_kg ?? null,
      foot: profile.preferred_foot ?? null,
      league: details?.league ?? null,
      international: details?.international_country_code
        ? { country: details.international_country_name ?? details.international_country_code, caps: details.international_caps, goals: details.international_goals }
        : null,
      user_entered: {
        strengths: details?.strengths ?? [],
        summary: details?.summary ?? null,
        club: details?.club_name ?? null,
        league: details?.league ?? null,
      },
      verified: intro.verified,
      measures: {
        games_analysed: m.videos,
        minutes_seen: Math.max(0, Math.round(m.seen_s / 60)),
        tracks: m.tracks,
        distance_m: m.distance_m,
        top_speed_kmh: m.top_speed_kmh,
        high_speed_m: m.high_speed_m,
        sprint_m: m.sprint_m,
        sprints: m.sprints,
        mean_confidence: m.mean_confidence,
        events: ev.videos > 0
          ? {
              passes: m.events?.passes ?? 0, key_passes: m.events?.key_passes ?? 0, passes_received: m.events?.passes_received ?? 0,
              balls_won: m.events?.balls_won ?? 0, pressures: m.events?.pressures ?? 0, shots: m.events?.shots ?? 0, goals: goals ?? 0,
            }
          : null,
      },
      per_match: [...perMatch.values()],
      events: ev.items.slice(0, 200).map((e) => ({
        video_id: e.video_id, video_title: e.video_title, kind: e.kind,
        minute: Math.max(0, Math.floor(e.start_us / 60_000_000)), key: e.key,
      })),
      events_capped_at: 200,
      events_total: ev.items.length,
      basis: m.videos > 0
        ? `Engine measurements on tracks a person confirmed as him: ${m.videos} video${m.videos === 1 ? "" : "s"}, ${Math.round(m.seen_s / 60)} minutes seen on camera.`
        : "No video analysed for him yet: no track is confirmed as him.",
    });
  }

  private rowToAssessment(r: RowDataPacket): AiAnalystAssessment {
    const input = AiAnalystInputSnapshot.parse(asJson(r.input_snapshot));
    const output = r.output == null ? null : StoredOutput.parse(asJson(r.output));
    const postCheck = asJson(r.post_check) as AiAnalystAssessment["post_check"];
    const basis = dataBasisOf(input);
    return AiAnalystAssessment.parse({
      id: r.id,
      player_id: r.player_id,
      otsi_pin: input.otsi_pin,
      status: r.status,
      language: r.language,
      generated_at: new Date(r.created_at).toISOString(),
      model: r.model,
      prompt_version: r.prompt_version,
      data_basis: basis,
      confidence_overall: (output?.confidence_overall ?? "NOT_ENOUGH_DATA") as AiAnalystConfidence,
      strengths: output?.strengths ?? [],
      development_areas: output?.development_areas ?? [],
      recommendations: output?.recommendations ?? [],
      tactical_fit: output?.tactical_fit ?? null,
      scout_brief: output?.scout_brief ?? null,
      not_measured: output?.not_measured ?? [],
      evidence_links: output?.evidence_links ?? [],
      post_check: postCheck,
      stale: !!r.stale,
      not_enough_data_reason: r.not_enough_data_reason ?? null,
      requested_by: r.requested_by,
      requested_by_name: null,
      published_by: r.published_by ?? null,
      published_by_name: null,
      published_at: r.published_at ? new Date(r.published_at).toISOString() : null,
      version: Number(r.version),
      failure: r.failure ?? null,
    });
  }

  private async loadRow(assessmentId: string, playerId: string, p: Principal): Promise<RowDataPacket> {
    const r = await this.db.one<RowDataPacket>(
      "SELECT * FROM ai_analyst_assessments WHERE id = ? AND player_id = ? AND organization_id = ?",
      [assessmentId, playerId, p.organizationId]);
    if (!r) throw notFound("AI analysis");
    return r;
  }

  /** Latest assessment for the player, with staleness recomputed against today's data (a new match analysed
   *  since generation marks it stale; a stale draft must be regenerated before it can be published). */
  async latest(playerId: string, p: Principal): Promise<AiAnalystAssessment> {
    await this.intro.assemble(playerId, p, null); // 404 when there is no such player in the registry
    const r = await this.db.one<RowDataPacket>(
      "SELECT * FROM ai_analyst_assessments WHERE player_id = ? AND organization_id = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      [playerId, p.organizationId]);
    if (!r) throw notFound("AI analysis");
    const a = this.rowToAssessment(r);
    // staleness only applies to a real assessment: a not-enough-data row is re-decided on the next generate
    if (a.not_enough_data_reason === null) {
      const input = await this.assembleInput(playerId, p);
      const stale = analystAssessmentStale(a, dataBasisOf(input));
      if (stale !== a.stale) {
        await this.db.rows("UPDATE ai_analyst_assessments SET stale = ? WHERE id = ?", [stale ? 1 : 0, r.id]);
        return { ...a, stale };
      }
    }
    return a;
  }

  async generate(playerId: string, body: unknown, p: Principal): Promise<AiAnalystAssessment> {
    const req = GenerateAiAnalysisRequest.parse(body ?? {});
    const input = await this.assembleInput(playerId, p);
    // Gate 1 — identity: verified OTSI PIN only. No assessment, no charge, no provider call for a provisional player.
    if (!input.verified) {
      throw new ApiError(409, "IDENTITY_UNCONFIRMED",
        "Not enough data — identity unconfirmed: the Analyst runs only for a player with a confirmed identity (a registered OTSI PIN and at least one track confirmed by a person).");
    }
    // Gate 2 — minimum data: below the minimum the Analyst writes nothing except the reason (no charge, no call).
    const reason = minimumDataReason(input);
    if (reason) {
      const id = uuidv7();
      const now = new Date().toISOString();
      await this.db.tx(async (c) => {
        await c.query(
          `INSERT INTO ai_analyst_assessments (id, organization_id, player_id, status, language, input_snapshot, output, model, prompt_version,
             post_check, stale, not_enough_data_reason, failure, requested_by, consent_by, consent_at, version)
           VALUES (?, ?, ?, 'DRAFT', ?, ?, NULL, 'none', ?, ?, 0, ?, NULL, ?, ?, ?, 1)`,
          [id, p.organizationId, playerId, req.language, JSON.stringify(input), AI_ANALYST_PROMPT_VERSION,
           JSON.stringify({ ok: true, dropped: [], failures: [], attempts: 1 }), reason, p.userId, p.userId, toDbDate(now)]);
        await recordChange(c, userActor(p), { action: "ai_analyst.not_enough_data", entityType: "player", entityId: playerId,
          after: { assessment_id: id, reason } });
      });
      return this.rowToAssessment((await this.loadRow(id, playerId, p))!);
    }
    // Gate 3 — provider: not configured means "not configured", never a fabricated assessment.
    const provider = resolveAiAnalystProvider(this.cfg);
    if (!provider) {
      throw new ApiError(503, AI_ANALYST_NOT_CONFIGURED,
        "The AI Analyst is not configured on this server: no AI provider has been set up. No assessment was produced and nothing was charged.");
    }
    const id = uuidv7();
    const now = new Date().toISOString();
    // Gate 4 — charge at enqueue, in the same transaction as the assessment row (ADR-140 pattern): a job that
    // fails to enqueue charges nothing. The post_check placeholder is overwritten below, before any read.
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO ai_analyst_assessments (id, organization_id, player_id, status, language, input_snapshot, output, model, prompt_version,
           post_check, stale, not_enough_data_reason, failure, requested_by, consent_by, consent_at, version)
         VALUES (?, ?, ?, 'DRAFT', ?, ?, NULL, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, 1)`,
        [id, p.organizationId, playerId, req.language, JSON.stringify(input), provider.name, AI_ANALYST_PROMPT_VERSION,
         JSON.stringify({ ok: false, dropped: [], failures: ["verification pending"], attempts: 1 }), p.userId, p.userId, toDbDate(now)]);
      await this.wallet.charge(c, p.organizationId, p.userId,
        { type: "AI_ANALYSIS", id, amount: TOKEN_COSTS.aiAnalysis, reason: `AI Analyst assessment for ${playerId} (10 tokens).` });
      await recordChange(c, userActor(p), { action: "ai_analyst.requested", entityType: "player", entityId: playerId,
        after: { assessment_id: id, model: provider.name, language: req.language, cost_tokens: TOKEN_COSTS.aiAnalysis } });
    });
    // Gate 5 — the provider call, then the deterministic post-check. One strict retry, then refund + 502.
    let checked = await this.attempt(provider, input, req.language, false);
    let attempts = 1;
    if (!checked.ok) {
      checked = await this.attempt(provider, input, req.language, true);
      attempts = 2;
    }
    if (!checked.ok || !checked.body) {
      const failures = checked.failures.length ? checked.failures : ["The model output could not be verified."];
      await this.db.tx(async (c) => {
        await c.query("UPDATE ai_analyst_assessments SET post_check = ?, failure = ? WHERE id = ?",
          [JSON.stringify({ ok: false, dropped: checked.dropped, failures, attempts }), failures.join(" ").slice(0, 500), id]);
        await this.wallet.refundForJob(c, p.organizationId, p.userId,
          { type: "AI_ANALYSIS", id, reason: `AI Analyst assessment for ${playerId} could not be verified, so its tokens were returned.` });
        await recordChange(c, userActor(p), { action: "ai_analyst.unverified", entityType: "player", entityId: playerId,
          after: { assessment_id: id, attempts, failures } });
      });
      throw new ApiError(502, AI_ANALYSIS_UNVERIFIED,
        "Analysis could not be verified — try again. The AI's output failed the engine's evidence checks, so no unverified text is shown and the 10 tokens were returned.");
    }
    const overall = confidenceFor(input.measures.games_analysed, input.events_total, input.events_total);
    const output: StoredOutput = { ...checked.body, confidence_overall: overall, evidence_links: evidenceLinksOf(checked.body) };
    await this.db.tx(async (c) => {
      await c.query("UPDATE ai_analyst_assessments SET output = ?, post_check = ? WHERE id = ?",
        [JSON.stringify(output), JSON.stringify({ ok: true, dropped: checked.dropped, failures: [], attempts }), id]);
      await recordChange(c, userActor(p), { action: "ai_analyst.generated", entityType: "player", entityId: playerId,
        after: { assessment_id: id, model: provider.name, attempts, dropped_claims: checked.dropped.length, confidence_overall: overall } });
    });
    return this.rowToAssessment((await this.loadRow(id, playerId, p))!);
  }

  /** One provider call + deterministic post-check. A provider failure is a job failure: refund + 502, no text. */
  private async attempt(provider: AiAnalystProvider, input: AiAnalystInputSnapshot, language: GenerateAiAnalysisRequest["language"], strict: boolean) {
    const prompt = buildAnalystPrompt(input, language, strict);
    let raw: unknown;
    try {
      raw = await provider.generate(prompt);
    } catch (e) {
      // the provider itself failed: treat it as an unverifiable attempt so generate() refunds and reports 502
      return { ok: false as const, body: null, dropped: [], failures: [e instanceof ApiError ? e.message : "The AI provider could not be reached."] };
    }
    return postCheckAssessment(input, raw, strict ? 2 : 1);
  }

  async publish(assessmentId: string, playerId: string, p: Principal): Promise<AiAnalystAssessment> {
    const r = await this.loadRow(assessmentId, playerId, p);
    const a = this.rowToAssessment(r);
    if (a.status === "PUBLISHED") return a;
    if (a.failure) {
      throw new ApiError(409, "AI_ANALYSIS_NOT_READY", "This assessment could not be verified, so there is nothing to publish. Generate a new one.");
    }
    if (a.not_enough_data_reason) {
      throw new ApiError(409, "AI_ANALYSIS_NOT_READY", "There is not enough measured data for an assessment to publish.");
    }
    await requireIdentity(this.db, playerId, p.organizationId); // the identity must still be confirmed
    const input = await this.assembleInput(playerId, p);
    if (analystAssessmentStale(a, dataBasisOf(input))) {
      throw new ApiError(409, "AI_ANALYSIS_STALE", "This assessment is stale — a new match has been analysed since it was generated. Regenerate it before publishing.");
    }
    const now = new Date().toISOString();
    await this.db.tx(async (c) => {
      await c.query("UPDATE ai_analyst_assessments SET status = 'PUBLISHED', published_by = ?, published_at = ?, version = version + 1 WHERE id = ?",
        [p.userId, toDbDate(now), assessmentId]);
      await recordChange(c, userActor(p), { action: "ai_analyst.published", entityType: "player", entityId: playerId,
        after: { assessment_id: assessmentId, version: a.version + 1 } });
    });
    return this.rowToAssessment((await this.loadRow(assessmentId, playerId, p))!);
  }

  async unpublish(assessmentId: string, playerId: string, p: Principal): Promise<AiAnalystAssessment> {
    const r = await this.loadRow(assessmentId, playerId, p);
    const a = this.rowToAssessment(r);
    if (a.status === "DRAFT") return a;
    await this.db.tx(async (c) => {
      await c.query("UPDATE ai_analyst_assessments SET status = 'DRAFT', published_by = NULL, published_at = NULL, version = version + 1 WHERE id = ?",
        [assessmentId]);
      await recordChange(c, userActor(p), { action: "ai_analyst.unpublished", entityType: "player", entityId: playerId,
        after: { assessment_id: assessmentId, version: a.version + 1 } });
    });
    return this.rowToAssessment((await this.loadRow(assessmentId, playerId, p))!);
  }
}

// ------------------------------------------------------------------ controller
@Controller("v1/players")
@UseGuards(AuthGuard)
export class AiAnalystController {
  constructor(private readonly svc: AiAnalystService) {}

  @Get(":playerId/ai-analysis/status")
  status() {
    return this.svc.providerStatus();
  }

  @Get(":playerId/ai-analysis")
  get(@Param("playerId") id: string, @CurrentPrincipal() p: Principal) {
    return this.svc.latest(uuidParam(id, "Player"), p);
  }

  @Post(":playerId/ai-analysis")
  @Roles(...ASSESSORS)
  generate(@Param("playerId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.svc.generate(uuidParam(id, "Player"), body, p);
  }

  @Post(":playerId/ai-analysis/:assessmentId/publish")
  @Roles(...ASSESSORS)
  publish(@Param("playerId") id: string, @Param("assessmentId") aid: string, @CurrentPrincipal() p: Principal) {
    return this.svc.publish(uuidParam(aid, "AI analysis"), uuidParam(id, "Player"), p);
  }

  @Post(":playerId/ai-analysis/:assessmentId/unpublish")
  @Roles(...ASSESSORS)
  unpublish(@Param("playerId") id: string, @Param("assessmentId") aid: string, @CurrentPrincipal() p: Principal) {
    return this.svc.unpublish(uuidParam(aid, "AI analysis"), uuidParam(id, "Player"), p);
  }
}
