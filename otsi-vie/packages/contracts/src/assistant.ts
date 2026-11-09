import { z } from "zod";
import { JobList } from "./jobs";
import { hasCriteria, parseSmartQuery, SearchQuery, SearchResponse } from "./search";

export const ASSISTANT_PAGES = {
  library: { label: "Library", href: "/library" },
  processing: { label: "AI Processing", href: "/processing" },
  analysis: { label: "Analysis", href: "/analysis" },
  studio: { label: "Clip Studio", href: "/studio" },
} as const;

const Page = z.enum(["library", "processing", "analysis", "studio"]);
export const AssistantStep = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("search"), query: SearchQuery.shape.q }),
  z.object({ kind: z.literal("jobs") }),
  z.object({ kind: z.literal("open"), page: Page }),
]);
export type AssistantStep = z.infer<typeof AssistantStep>;

export const AssistantRequest = z.object({ command: z.string().trim().min(1).max(96) }).strict();
export const AssistantPlan = z.object({ id: z.string().uuid(), step: AssistantStep, expires_at: z.string() });
export type AssistantPlan = z.infer<typeof AssistantPlan>;
export const AssistantResult = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("search"), result: SearchResponse }),
  z.object({ kind: z.literal("jobs"), result: JobList }),
  z.object({ kind: z.literal("open"), page: Page }),
]);
export type AssistantResult = z.infer<typeof AssistantResult>;

export function parseAssistantCommand(command: string): AssistantStep | null {
  const input = AssistantRequest.safeParse({ command });
  if (!input.success) return null;
  const text = input.data.command;
  if (/^(?:show )?jobs$/i.test(text)) return { kind: "jobs" };
  const open = /^open (library|processing|analysis|studio)$/i.exec(text);
  if (open) return { kind: "open", page: Page.parse(open[1]!.toLowerCase()) };
  const search = /^search (.+)$/i.exec(text);
  if (!search) return null;
  const query = SearchQuery.safeParse({ q: search[1] });
  if (!query.success) return null;
  const criteria = parseSmartQuery(query.data.q);
  return hasCriteria(criteria) && criteria.unknown.length === 0 ? { kind: "search", query: query.data.q } : null;
}

export function assistantStepLabel(step: AssistantStep): string {
  switch (step.kind) {
    case "search": return `Search for “${step.query}”`;
    case "jobs": return "Read recent and active job status";
    case "open": return `Open ${ASSISTANT_PAGES[step.page].label}`;
  }
}

export const ASSISTANT_GUIDES = [
  { title: "Find a moment", instructions: "Search recorded moments by event, then select a result to open Analysis at its timestamp.", command: "search event:goal type:moment" },
  { title: "Check processing", instructions: "Read recent and active jobs you can see. Open AI Processing for the full job table.", command: "show jobs" },
  { title: "Find project media", instructions: "Open Library to browse media and check its rights and evidence.", command: "open library" },
] as const;
