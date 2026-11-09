"use client";

import { ASSISTANT_GUIDES, ASSISTANT_PAGES, assistantStepLabel, hitHref, type AssistantPlan, type AssistantResult } from "@otsi-vie/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiProblem } from "@/lib/api";

export function LocalAssistant({ navigate }: { navigate: (href: string) => void }) {
  const [command, setCommand] = useState("");
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  function changeCommand(value: string) {
    setCommand(value);
    setPlan(null);
    setResult(null);
    setError("");
  }

  async function request<T>(call: (signal: AbortSignal) => Promise<T>, complete: (value: T) => void) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const value = await call(controller.signal);
      if (!controller.signal.aborted) complete(value);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof ApiProblem ? e.message : "The assistant could not answer. Try again.");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function preview(e: FormEvent) {
    e.preventDefault();
    setPlan(null);
    setResult(null);
    void request(
      (signal) => api<AssistantPlan>("/v1/assistant/plans", { method: "POST", json: { command }, signal }),
      setPlan,
    );
  }

  function approve() {
    if (!plan) return;
    void request(
      (signal) => api<AssistantResult>(`/v1/assistant/plans/${plan.id}/approve`, { method: "POST", signal }),
      (value) => {
        setPlan(null);
        if (value.kind === "open") navigate(ASSISTANT_PAGES[value.page].href);
        else setResult(value);
      },
    );
  }

  const button = "rounded-ctl border border-line px-3 py-1.5 text-sm disabled:opacity-50";

  return (
    <div className="max-h-[65vh] space-y-3 overflow-auto px-2 py-3" data-local-assistant>
      <h2 className="text-sm font-semibold">Local assistant</h2>
      <p className="text-xs text-muted">Choose a guide or enter a command. Review the plan before approving it.</p>
      <div className="grid gap-2 sm:grid-cols-3" aria-label="Assistant guides">
        {ASSISTANT_GUIDES.map((guide) => (
          <div key={guide.title} className="space-y-1 rounded-ctl border border-line bg-raised p-2">
            <h3 className="text-sm font-medium">{guide.title}</h3>
            <p className="text-xs text-muted">{guide.instructions}</p>
            <button type="button" className={button} aria-label={`Use command for ${guide.title}`} disabled={busy} onClick={() => changeCommand(guide.command)}>
              Use command
            </button>
          </div>
        ))}
      </div>
      <form onSubmit={preview} className="flex flex-wrap gap-2">
        <input autoFocus aria-label="Assistant command" value={command} maxLength={96} disabled={busy}
          onChange={(e) => changeCommand(e.target.value)} placeholder="search event:goal type:moment"
          className="min-w-48 flex-1 rounded-ctl border border-line bg-transparent px-2 py-1.5 text-sm" />
        <button type="submit" className={button} disabled={busy || !command.trim()}>Preview plan</button>
      </form>
      {plan && (
        <div className="space-y-2 rounded-ctl border border-line p-2" aria-label="Plan preview">
          <h3 className="text-sm font-semibold">Plan preview</h3>
          <ol className="list-decimal pl-5 text-sm"><li>{assistantStepLabel(plan.step)}</li></ol>
          <p className="text-xs text-muted">This plan is valid for five minutes. Approval is recorded in the audit trail.</p>
          <div className="flex gap-2">
            <button type="button" className={button + " bg-primary/15"} onClick={approve} disabled={busy}>Approve and run</button>
            <button type="button" className={button} onClick={() => { setPlan(null); setError(""); }} disabled={busy}>Discard preview</button>
          </div>
        </div>
      )}
      {busy && <p role="status" className="text-xs text-muted">Working…</p>}
      {error && <p role="alert" className="text-sm text-amber">{error}</p>}
      {result?.kind === "search" && (
        <div className="space-y-1 text-sm" aria-label="Assistant search results">
          <p>{result.result.hits.length ? "Recorded matches" : "Nothing recorded matches this search."}</p>
          <ul>{result.result.hits.map((hit) => <li key={`${hit.kind}-${hit.id}`}>
            <button type="button" className="py-1 text-left underline" onClick={() => navigate(hitHref(hit))}>{hit.title}</button>
            {hit.detail && <span className="ml-2 text-xs text-muted">{hit.detail}</span>}
          </li>)}</ul>
        </div>
      )}
      {result?.kind === "jobs" && (
        <div className="space-y-1 text-sm" aria-label="Assistant job status">
          <p>{result.result.jobs.length ? `${result.result.active} active · ${result.result.running} running · ${result.result.failed_recent} failed recently` : "No recent or active jobs are visible."}</p>
          <ul>{result.result.jobs.map((job) => <li key={job.id}>
            {job.kind_label}{job.subject_title ? ` · ${job.subject_title}` : ""} · {job.state.toLowerCase()}
          </li>)}</ul>
        </div>
      )}
    </div>
  );
}
