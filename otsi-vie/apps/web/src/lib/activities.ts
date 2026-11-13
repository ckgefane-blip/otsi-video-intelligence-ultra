/**
 * Client-side activities: the long synchronous API actions and the browser file
 * upload, which never appear in GET /v1/jobs — so the ActivityLine would never
 * narrate them. Same pattern as jobsLive.ts: module-level state + a window event
 * + publish/use hooks; the store is the single source of truth and the ActivityLine
 * reads it alongside the jobs list.
 *
 * What is published, and what is NOT invented:
 * - the four charged API actions (export pack, player report, AI Analyst, Scouting
 *   Pack — 10 tokens each at enqueue, ADR-140): started when the user confirms the
 *   action, finished when the call resolves or rejects. They carry NO progress and
 *   NO stage — the server reports neither — so the line shows elapsed time only.
 * - the browser file upload: the REAL progress % from the transfers store
 *   (sentBytes / totalBytes), nothing else.
 * Nothing else is published here: quick API calls (identity confirm, clip
 * selection, navigation) are not long-running and would be noise.
 *
 * A finished activity stays in the store so the line can narrate the last
 * completed action briefly (5 min) and a failure (15 min, same window as a failed
 * job); entries older than that are pruned on publish.
 */
import type { WalletJobType } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";

export type ClientActivityKind = "EXPORT_PACK" | "PLAYER_REPORT" | "AI_ANALYSIS" | "SCOUTING_PACK" | "UPLOAD";

export type ClientActivityState = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface ClientActivity {
  /** stable id: `act-<uuid>` for API actions, `upload-<transfer id>` for uploads */
  id: string;
  kind: ClientActivityKind;
  /** reel / player / file name, or null when the trigger has none to give */
  subject: string | null;
  /** client time the action started (ISO) — the elapsed time counts from here */
  startedAt: string;
  /** the real upload % (0-100), or null: the API actions report no progress */
  progress: number | null;
  state: ClientActivityState;
  finishedAt: string | null;
  /** the ledger job type the action charges, or null when it costs nothing (upload) */
  chargedType: WalletJobType | null;
  /** the tokens the action committed at enqueue (10 for the four API actions) */
  cost: number | null;
}

const EVENT = "otsi-activities";
/** finished entries are narrated for at most 15 minutes (failures); prune older ones */
const KEEP_MS = 15 * 60 * 1000;
let last: ClientActivity[] = [];

function prune(list: ClientActivity[], now = Date.now()): ClientActivity[] {
  return list.filter((a) => a.state === "RUNNING" || !a.finishedAt || now - Date.parse(a.finishedAt) <= KEEP_MS);
}

export function publishActivities(list: ClientActivity[]) {
  last = prune(list);
  window.dispatchEvent(new Event(EVENT));
}

export function useActivities(): ClientActivity[] {
  const [v, setV] = useState<ClientActivity[]>(last);
  useEffect(() => {
    const on = () => setV(last);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return v;
}

/** start narrating a long synchronous API action. Returns the activity id; the
 *  caller finishes it (finishActivity) when the call resolves or rejects. */
export function startActivity(kind: ClientActivityKind, subject: string | null, chargedType: WalletJobType | null, cost: number | null): string {
  const id = `act-${crypto.randomUUID()}`;
  publishActivities([...last, {
    id, kind, subject, startedAt: new Date().toISOString(), progress: null,
    state: "RUNNING", finishedAt: null, chargedType, cost,
  }]);
  return id;
}

/** mark an activity finished: true when the call resolved, false when it rejected.
 *  A no-op for an unknown or already finished id. */
export function finishActivity(id: string, ok: boolean): void {
  if (!last.some((a) => a.id === id && a.state === "RUNNING")) return;
  publishActivities(last.map((a) => (a.id === id ? { ...a, state: ok ? "SUCCEEDED" : "FAILED", finishedAt: new Date().toISOString() } : a)));
}

/** drop an activity without narrating it (a paused or cancelled upload: the user
 *  stopped it on purpose, so there is nothing to say about it). */
export function removeActivity(id: string): void {
  if (!last.some((a) => a.id === id)) return;
  publishActivities(last.filter((a) => a.id !== id));
}

/* ------------------------------------------------------------------ uploads */

/** one transfer as the upload page sees it: the real progress, or null before the
 *  first bytes are reported. `state` is the transfer's own state. */
export interface UploadSync {
  id: string;
  name: string;
  state: "sending" | "done" | "error" | "paused";
  progress: number | null;
}

/** the upload page's transfers, synced into the store: a sending transfer is
 *  narrated with its real %; a done one is finished (the line says so briefly);
 *  an errored one is finished as failed; a paused one is dropped silently, and a
 *  transfer that vanished (cancelled) drops with it. Idempotent — called on every
 *  transfer change, including every progress tick. */
export function startUploadActivity(t: UploadSync): void {
  const id = `upload-${t.id}`;
  const cur = last.find((a) => a.id === id);
  if (cur?.state === "RUNNING") {
    if (cur.progress !== t.progress) publishActivities(last.map((a) => (a.id === id ? { ...a, progress: t.progress } : a)));
    return;
  }
  if (cur) return; // already finished: leave the completion / failure narration alone
  publishActivities([...last, {
    id, kind: "UPLOAD", subject: t.name, startedAt: new Date().toISOString(), progress: t.progress,
    state: "RUNNING", finishedAt: null, chargedType: null, cost: null,
  }]);
}

export function finishUploadActivity(id: string, ok: boolean): void {
  finishActivity(`upload-${id}`, ok);
}

export function removeUploadActivity(id: string): void {
  removeActivity(`upload-${id}`);
}

/** drop every still-running upload activity: the upload page unmounted, so this
 *  browser can no longer see the transfer's progress — the line must not keep
 *  narrating a % it cannot see. The upload itself keeps going in the background;
 *  the server-side ingest job is narrated as a job when it starts. */
export function dropRunningUploadActivities(): void {
  if (!last.some((a) => a.kind === "UPLOAD" && a.state === "RUNNING")) return;
  publishActivities(last.filter((a) => !(a.kind === "UPLOAD" && a.state === "RUNNING")));
}
