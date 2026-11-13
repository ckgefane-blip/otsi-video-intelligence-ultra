import { z } from "zod";
import { AiAnalystAssessment, publishedScoutBriefForPack } from "./ai-analyst";
import { BEST_MOMENTS_RULE_VERSION } from "./cross-match";
import { TOKEN_COSTS } from "./wallet";

/**
 * Single match spotlight + Scouting Pack (ADR-142, ultra-only; Roadmap Phase 4, Option B).
 *
 * The paid offer as one named export bundle: the highlight reel (Player profile intro first, then the moments
 * picked by the Best moment rule v2.1), the player report, and the AI Analyst brief — packaged as ONE export
 * with a clear manifest. The "Single match spotlight" is the single-match version of the offer (one reel + one
 * report for one match); the Scouting Pack is the same bundle shape and may also cover a cross-match reel (all
 * matches). The bundle is generic over the reel source — single-match or cross-match — and the choice is
 * recorded in the manifest.
 *
 * Cost (Token Wallet scope, ADR-140): a Scouting Pack is an export pack — 10 tokens, charged at enqueue via
 * the WalletService (job type EXPORT_PACK). The reel, the report and the brief inside the Pack are covered by
 * that one charge and are never charged again (the report is made with charge: false, the brief is a read of
 * an already-paid assessment, the reel is an already-rendered file).
 *
 * Honesty rules (ADR-124, ADR-141 Rule 4): the manifest states the Best moment rule version and that every
 * included item comes from measured/verified data only. The AI Analyst brief is included ONLY when the
 * assessment is PUBLISHED — this file calls the Piece 3 hook `publishedScoutBriefForPack` and never
 * re-implements the publish gate. A draft brief is never included, never silently: the manifest records it as
 * EXCLUDED with the reason "AI Analyst brief: not included (draft, not published)". Nothing is invented: a
 * missing or failed item is recorded as EXCLUDED / FAILED with why, never filled in.
 */

/** A Scouting Pack costs 10 tokens — the export-pack cost (ADR-140, Token Wallet scope). */
export const SCOUTING_PACK_COST_TOKENS = TOKEN_COSTS.exportPack;

/** Which reel the Pack is built from: one match (Single match spotlight) or all matches (cross-match). */
export const ScoutingPackReelSource = z.enum(["SINGLE_MATCH", "CROSS_MATCH"]);
export type ScoutingPackReelSource = z.infer<typeof ScoutingPackReelSource>;
export const SCOUTING_PACK_SOURCE_LABELS: Record<ScoutingPackReelSource, string> = {
  SINGLE_MATCH: "Single match spotlight",
  CROSS_MATCH: "Scouting Pack (all matches)",
};

/** The three things a Pack can hold. The reel is always in a Pack; the report and the brief are opt-out. */
export const ScoutingPackItemKind = z.enum(["REEL", "PLAYER_REPORT", "AI_ANALYST_BRIEF"]);
export type ScoutingPackItemKind = z.infer<typeof ScoutingPackItemKind>;
export const SCOUTING_PACK_ITEM_LABELS: Record<ScoutingPackItemKind, string> = {
  REEL: "Highlight reel (Player profile intro first)",
  PLAYER_REPORT: "Player report",
  AI_ANALYST_BRIEF: "AI Analyst brief",
};

/** Whether an item made it into the Pack, and if not, why — the manifest never hides an absence. */
export const ScoutingPackItemState = z.enum(["INCLUDED", "EXCLUDED", "NOT_MEASURED", "FAILED"]);
export type ScoutingPackItemState = z.infer<typeof ScoutingPackItemState>;

/** One line of the manifest: what the item is, whether it is in the Pack, and why not when it is not. */
export const ScoutingPackManifestItem = z.object({
  kind: ScoutingPackItemKind,
  state: ScoutingPackItemState,
  /** what the item is, in the club's terms (for the reel: Profile intro first, then the moments) */
  detail: z.string(),
  /** why an item is not in the Pack, or null when it is included */
  reason: z.string().nullable(),
});
export type ScoutingPackManifestItem = z.infer<typeof ScoutingPackManifestItem>;

/** The manifest that travels inside the Pack (as manifest.json in the ZIP): what is inside, which match(es),
 *  which player, the rule version stamped, and which items are included or excluded and why. */
export const ScoutingPackManifest = z.object({
  name: z.string(),
  player_id: z.string().uuid(),
  display_name: z.string(),
  otsi_pin: z.string().nullable(),
  reel_id: z.string().uuid(),
  reel_name: z.string(),
  reel_source: ScoutingPackReelSource,
  /** one title for a Single match spotlight; every match for a cross-match Pack */
  match_titles: z.array(z.string()),
  /** the Best moment rule version the reel was built with (ADR-131 v2.1), stamped on the Pack */
  best_moments_rule_version: z.literal(BEST_MOMENTS_RULE_VERSION),
  /** 10 tokens — the one charge that covers the whole Pack */
  cost_tokens: z.literal(SCOUTING_PACK_COST_TOKENS),
  /** the honesty statement: measured/verified data only, nothing invented */
  measured_only_statement: z.string(),
  items: z.array(ScoutingPackManifestItem).min(1),
  created_at: z.string(),
});
export type ScoutingPackManifest = z.infer<typeof ScoutingPackManifest>;

export const MEASURED_ONLY_STATEMENT =
  "Every item in this Pack comes from measured engine data only (ADR-124): the reel follows the Best moment rule " +
  "v2.1 on moments the engine measured for this player under his verified OTSI PIN, the report shows his measured " +
  "numbers, and the AI Analyst brief — when included — is a published assessment whose every claim cites measured " +
  "evidence. Nothing in this Pack is invented; anything not measured is labelled Not measured, and anything not " +
  "included is listed below with its reason.";

/** Build a Pack: choose the reel (single-match or cross-match — the source is read from the reel and recorded),
 *  and opt out of the report or the Analyst brief. The player is the reel's player. */
export const CreateScoutingPackRequest = z.object({
  reel_id: z.string().uuid(),
  include_report: z.boolean().default(true),
  include_analyst_brief: z.boolean().default(true),
});
export type CreateScoutingPackRequest = z.infer<typeof CreateScoutingPackRequest>;

export const ScoutingPackState = z.enum(["CREATED", "READY", "FAILED"]);
export type ScoutingPackState = z.infer<typeof ScoutingPackState>;

/** A Scouting Pack: the manifest plus its state and, once built, the ZIP to download. */
export const ScoutingPack = z.object({
  id: z.string().uuid(),
  player_id: z.string().uuid(),
  reel_id: z.string().uuid(),
  reel_source: ScoutingPackReelSource,
  state: ScoutingPackState,
  manifest: ScoutingPackManifest,
  cost_tokens: z.literal(SCOUTING_PACK_COST_TOKENS),
  requested_by_name: z.string(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  /** the ZIP of the Pack, once built */
  zip: z.object({ bytes: z.number().int(), download_url: z.string() }).nullable(),
});
export type ScoutingPack = z.infer<typeof ScoutingPack>;

// ------------------------------------------------------------------ manifest builder (pure)
/** The latest AI Analyst assessment, or null when the player has none — only its publish state matters here. */
export type ScoutingPackAnalystInput = Pick<AiAnalystAssessment, "status" | "scout_brief" | "published_by_name" | "published_at"> | null;

/** What the builder needs: the reel and player, what was asked for, and the state of each piece. The report
 *  state is the outcome of making it (INCLUDED when the report file was made); at plan time the API passes
 *  INCLUDED and rewrites the manifest if making it fails. */
export interface BuildScoutingPackManifestInput {
  player_id: string;
  display_name: string;
  otsi_pin: string | null;
  reel_id: string;
  reel_name: string;
  reel_source: ScoutingPackReelSource;
  match_titles: string[];
  /** false when the reel has no finished render: the Pack cannot hold a reel that was never rendered */
  reel_rendered: boolean;
  include_report: boolean;
  report: { state: "INCLUDED" | "NOT_MEASURED" | "FAILED"; reason: string | null };
  include_analyst_brief: boolean;
  analyst_assessment: ScoutingPackAnalystInput;
}

/**
 * Build the Pack manifest from the reel, the report outcome and the Analyst publish state. The Analyst brief
 * goes through the Piece 3 hook: it is INCLUDED only when the assessment is PUBLISHED with a brief. A draft is
 * EXCLUDED with the reason "AI Analyst brief: not included (draft, not published)" — never silently included,
 * never invented. A reel with no finished render is FAILED, not faked.
 */
export function buildScoutingPackManifest(input: BuildScoutingPackManifestInput, createdAt = new Date().toISOString()): ScoutingPackManifest {
  const scope = SCOUTING_PACK_SOURCE_LABELS[input.reel_source];
  const matches = input.match_titles.length ? input.match_titles.join(" · ") : "No match";
  const name = `Scouting Pack — ${input.display_name} — ${input.reel_source === "SINGLE_MATCH" ? matches : "All matches"}`;
  const items: ScoutingPackManifestItem[] = [
    input.reel_rendered
      ? { kind: "REEL", state: "INCLUDED", detail: `Player profile intro first, then the best moments (Best moment rule v${BEST_MOMENTS_RULE_VERSION}). ${scope}: ${matches}.`, reason: null }
      : { kind: "REEL", state: "FAILED", detail: "Highlight reel (Player profile intro first).", reason: "The reel has no finished render yet — render it first." },
  ];
  if (!input.include_report) {
    items.push({ kind: "PLAYER_REPORT", state: "EXCLUDED", detail: "Player report.", reason: "Not requested for this Pack." });
  } else if (input.report.state === "INCLUDED") {
    items.push({ kind: "PLAYER_REPORT", state: "INCLUDED", detail: "Player report: his measured numbers, events and published assessment.", reason: null });
  } else {
    items.push({ kind: "PLAYER_REPORT", state: input.report.state, detail: "Player report.", reason: input.report.reason ?? "The player report could not be made." });
  }
  if (!input.include_analyst_brief) {
    items.push({ kind: "AI_ANALYST_BRIEF", state: "EXCLUDED", detail: "AI Analyst brief.", reason: "Not requested for this Pack." });
  } else {
    // ADR-141 Rule 4, via the Piece 3 hook: only a PUBLISHED brief may leave the organization.
    const brief = input.analyst_assessment ? publishedScoutBriefForPack(input.analyst_assessment) : null;
    if (brief) {
      const by = input.analyst_assessment!.published_by_name ? ` Published by ${input.analyst_assessment!.published_by_name}` : "";
      const at = input.analyst_assessment!.published_at ? ` on ${input.analyst_assessment!.published_at.slice(0, 10)}` : "";
      items.push({ kind: "AI_ANALYST_BRIEF", state: "INCLUDED", detail: `AI Analyst brief: strengths, development areas, recommendations, tactical fit and key clips — published, every claim citing measured evidence.${by}${at}.`, reason: null });
    } else if (!input.analyst_assessment) {
      items.push({ kind: "AI_ANALYST_BRIEF", state: "EXCLUDED", detail: "AI Analyst brief.", reason: "No AI Analyst assessment for this player yet." });
    } else if (input.analyst_assessment.status !== "PUBLISHED") {
      items.push({ kind: "AI_ANALYST_BRIEF", state: "EXCLUDED", detail: "AI Analyst brief.", reason: "AI Analyst brief: not included (draft, not published)." });
    } else {
      items.push({ kind: "AI_ANALYST_BRIEF", state: "EXCLUDED", detail: "AI Analyst brief.", reason: "The published assessment has no scout brief." });
    }
  }
  return ScoutingPackManifest.parse({
    name,
    player_id: input.player_id,
    display_name: input.display_name,
    otsi_pin: input.otsi_pin,
    reel_id: input.reel_id,
    reel_name: input.reel_name,
    reel_source: input.reel_source,
    match_titles: input.match_titles,
    best_moments_rule_version: BEST_MOMENTS_RULE_VERSION,
    cost_tokens: SCOUTING_PACK_COST_TOKENS,
    measured_only_statement: MEASURED_ONLY_STATEMENT,
    items,
    created_at: createdAt,
  });
}
