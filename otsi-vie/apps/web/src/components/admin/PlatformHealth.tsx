"use client";
/**
 * Admin Console — Platform Health (SOT, Admin.dc.html).
 * The live state of the platform: review inbox, jobs running, licence,
 * release control and models (stat panels), plus the concurrency rows
 * and the review inbox with its Approve / Reject decisions. Available to
 * Owners and Admins.
 *
 * One honest note, visible here, not hidden:
 * - Concurrency shows the SOT's "Not set" text (no numeric value) with
 *   a Pause button per queue; the track under it is still the working
 *   1–8 control — drag it to change the limit, the value is in the
 *   control's title. The API always returns a configured value
 *   (defaults 1 / 2 / 2), so "Not set" is the SOT's label, not a live
 *   unset state.
 *
 * Decisions (SOT rebuild 2026-11-13): POST /v1/overview/inbox/decisions with the row's stable id
 * ("<KIND>:<video-or-reel-uuid>"). APPROVE works for all four kinds. REJECT is deliberately unsupported
 * for STALE_REEL and FAILED_JOB (the endpoint answers 422 DECISION_NOT_SUPPORTED) — those rows show no
 * working Reject. After a decision the inbox is re-fetched: the returned inbox may still list a FAILED_JOB
 * row for a moment, because the retry is queued through the outbox and clears the row when the dispatcher
 * fires.
 */
import type {
  AdminConcurrencySettings,
  AdminDashboard,
  HomeInbox,
  InboxDecision,
  InboxDecisionResult,
  InboxItem,
  JobList,
  LicenceSnapshot,
  ReleaseGatesReport,
  WorkerGroupStatus,
} from "@otsi-vie/contracts";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { api, ApiProblem } from "@/lib/api";

type QueueKey = "analysis" | "renders" | "ingest";
type ConcurrencyField = "max_concurrent_analysis" | "max_concurrent_renders" | "max_concurrent_ingest";
type PausedField = "analysis_paused" | "renders_paused" | "ingest_paused";

/** The review-inbox decision endpoint (POST InboxDecisionRequest, returns InboxDecisionResult). */
const REVIEW_DECISION_URL = "/v1/overview/inbox/decisions";

/** REJECT is deliberately unsupported for these kinds (the endpoint answers 422 DECISION_NOT_SUPPORTED):
 *  a stale reel is refreshed from the reel, a failed job is retried — neither is declined from here. */
const REJECT_UNSUPPORTED: readonly InboxItem["kind"][] = ["STALE_REEL", "FAILED_JOB"];

export function PlatformHealth() {
  const { organization } = useAuth();
  const { t } = useLocale();
  const myRole = organization?.role;
  const isAuthorized = myRole === "OWNER" || myRole === "ADMIN";
  const d = t.desktop;
  const a = t.body.admin;
  const home = t.body.home;

  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [inbox, setInbox] = useState<HomeInbox | null>(null);
  const [jobs, setJobs] = useState<JobList | null>(null);
  const [lic, setLic] = useState<LicenceSnapshot | null | undefined>(undefined);
  const [gates, setGates] = useState<ReleaseGatesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sliders, setSliders] = useState({ analysis: 1, renders: 2, ingest: 2 });
  const [savingConcurrency, setSavingConcurrency] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  /** a real decision on one review-inbox row: APPROVE does what the row asks for, REJECT declines it with a reason.
   *  The inbox is re-fetched afterwards — the returned inbox may still list a FAILED_JOB row for a moment
   *  (the retry is queued through the outbox and clears the row when the dispatcher fires), so it is fetched
   *  again at once and once more after a short delay. */
  const decideReview = useCallback(
    async (item: InboxItem, decision: InboxDecision, reason: string | null) => {
      setDeciding(item.id);
      setError(null);
      try {
        const res = await api<InboxDecisionResult>(REVIEW_DECISION_URL, {
          method: "POST",
          json: { item_id: item.id, decision, reason: reason?.trim() ? reason.trim() : null },
        });
        setInbox(res.inbox);
        setRejecting(null);
        setRejectReason("");
        const refetch = () => api<HomeInbox>("/v1/overview/inbox").then(setInbox, () => {});
        void refetch();
        window.setTimeout(() => void refetch(), 3000);
      } catch (err) {
        setError(err instanceof ApiProblem ? err.message : a.concurrencyFailed);
      } finally {
        setDeciding(null);
      }
    },
    [a.concurrencyFailed],
  );

  const loadData = useCallback(async () => {
    if (!isAuthorized) return;
    setLoading(true);
    setError(null);
    const [dashRes, inboxRes, jobsRes, licRes, gatesRes] = await Promise.allSettled([
      api<AdminDashboard>("/v1/admin/dashboard"),
      api<HomeInbox>("/v1/overview/inbox"),
      api<JobList>("/v1/jobs"),
      api<LicenceSnapshot>("/v1/licence"),
      api<ReleaseGatesReport>("/v1/admin/release-gates"),
    ]);
    if (dashRes.status === "fulfilled") {
      setDashboard(dashRes.value);
      setSliders({
        analysis: dashRes.value.concurrency.max_concurrent_analysis,
        renders: dashRes.value.concurrency.max_concurrent_renders,
        ingest: dashRes.value.concurrency.max_concurrent_ingest,
      });
    }
    if (inboxRes.status === "fulfilled") setInbox(inboxRes.value);
    if (jobsRes.status === "fulfilled") setJobs(jobsRes.value);
    if (licRes.status === "fulfilled") setLic(licRes.value);
    else setLic(null);
    if (gatesRes.status === "fulfilled") setGates(gatesRes.value);
    const failed = [dashRes, inboxRes, jobsRes, licRes, gatesRes].filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      const first = failed[0] as PromiseRejectedResult;
      setError(first.reason instanceof ApiProblem ? first.reason.message : a.loadFailed);
    }
    setLoading(false);
  }, [isAuthorized, a.loadFailed]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const patchConcurrency = useCallback(
    async (patch: Partial<AdminConcurrencySettings>) => {
      setSavingConcurrency(true);
      setSaveSuccess(false);
      setError(null);
      try {
        const res = await api<{ concurrency: AdminConcurrencySettings; workers: WorkerGroupStatus[] }>(
          "/v1/admin/concurrency",
          { method: "PATCH", json: patch },
        );
        setDashboard((prev) => (prev ? { ...prev, concurrency: res.concurrency } : prev));
        setSliders({
          analysis: res.concurrency.max_concurrent_analysis,
          renders: res.concurrency.max_concurrent_renders,
          ingest: res.concurrency.max_concurrent_ingest,
        });
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } catch (err) {
        setError(err instanceof ApiProblem ? err.message : a.concurrencyFailed);
      } finally {
        setSavingConcurrency(false);
      }
    },
    [a.concurrencyFailed],
  );

  const commitSlider = (field: ConcurrencyField, value: number) => {
    const current = dashboard?.concurrency[field];
    if (current === undefined || current === value) return;
    void patchConcurrency({ [field]: value } as Partial<AdminConcurrencySettings>);
  };

  if (!isAuthorized) {
    return (
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-[18px]">
        <div className="flex w-full max-w-4xl items-center gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-danger">
          <ShieldAlert className="h-6 w-6 shrink-0" />
          <div>
            <h2 className="font-normal">{t.body.admin.accessRequired}</h2>
            <p className="t-body opacity-90">{t.body.admin.accessOnly}</p>
          </div>
        </div>
      </main>
    );
  }

  const queuePaused = dashboard?.concurrency.queue_paused ?? false;
  const modelCount = dashboard?.models.length ?? 0;
  const modelsText =
    modelCount === 0 ? a.modelsNone : a.healthModelsCount.replace("{a}", String(modelCount));
  const accuracyText = gates?.accuracy_measured ? a.releaseAccuracyMeasured : a.modelsNotMeasured;
  const licenceText =
    lic === undefined
      ? "…"
      : lic === null
        ? d.licenceNotVerified
        : lic.valid_until
          ? `${lic.plan} · ${d.licenceValidUntil.replace("{a}", lic.valid_until.slice(0, 10))}`
          : d.licenceFree;

  const items = inbox?.items ?? [];
  const inboxCount = items.length;
  const inboxChip = inboxCount === 1 ? a.healthInboxOne : a.healthInboxMany.replace("{a}", String(inboxCount));

  const queues: {
    key: QueueKey;
    label: string;
    value: number;
    field: ConcurrencyField;
    pausedField: PausedField;
    paused: boolean;
  }[] = [
    {
      key: "analysis",
      label: a.healthConcAnalysis,
      value: sliders.analysis,
      field: "max_concurrent_analysis",
      pausedField: "analysis_paused",
      paused: dashboard?.concurrency.analysis_paused ?? false,
    },
    {
      key: "renders",
      label: a.healthConcRenders,
      value: sliders.renders,
      field: "max_concurrent_renders",
      pausedField: "renders_paused",
      paused: dashboard?.concurrency.renders_paused ?? false,
    },
    {
      key: "ingest",
      label: a.healthConcIngests,
      value: sliders.ingest,
      field: "max_concurrent_ingest",
      pausedField: "ingest_paused",
      paused: dashboard?.concurrency.ingest_paused ?? false,
    },
  ];

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-[18px]" data-testid="admin-platform-health">
      {/* SOT (Admin.dc.html): the concurrency slider thumb is a 14px disc, ink centre with a teal ring.
          The shared .vie-range thumb is solid ink; this rule is scoped to this page's testid so only
          these sliders change — globals.css is another worker's file. */}
      <style>{`[data-testid="admin-platform-health"] .vie-range::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: rgb(var(--ink)); border: 3px solid rgb(var(--primary)); } [data-testid="admin-platform-health"] .vie-range::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: rgb(var(--ink)); border: 3px solid rgb(var(--primary)); }`}</style>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="t-th">{t.body.shell.adminConsole}</span>
          <h1 className="t-page">{a.healthTitle}</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void patchConcurrency({ queue_paused: !queuePaused })}
            disabled={savingConcurrency}
            className={`vie-btn vie-btn-sm ${queuePaused ? "border-amber/40 bg-amber/10 text-amber" : ""}`}
          >
            {queuePaused ? a.healthResumeAll : a.healthPauseAll}
          </button>
          <Link href="/settings/admin/compliance#audit" className="vie-btn vie-btn-sm">
            {a.healthAuditLog}
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-ctl border border-danger/40 bg-danger/10 p-3 t-body text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-1 border-t border-line px-4 py-3">
          <span className="t-label">{home.reviewInbox}</span>
          <span className="t-section">{loading ? "—" : String(inboxCount)}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-1 border-t border-line px-4 py-3">
          <span className="t-label">{a.healthJobsRunning}</span>
          <span className="t-section">{loading ? "—" : String(jobs?.running ?? 0)}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-1 border-t border-line px-4 py-3">
          <span className="t-label">{a.healthLicence}</span>
          <span className={`t-section leading-7 ${lic === null ? "text-amber" : ""}`}>{licenceText}</span>
        </div>
        <Link href="/settings/admin/release" className="flex min-w-0 flex-col gap-1 border-t border-line px-4 py-3">
          <span className="t-label">{a.healthReleaseControl}</span>
          <span className="t-section leading-7 text-ink2">
            {a.healthReleaseAccuracy.replace("{a}", accuracyText)}
          </span>
          <span className="t-body text-muted">{a.healthReleaseNote}</span>
        </Link>
        <Link href="/settings/admin/models" className="flex min-w-0 flex-col gap-1 border-t border-line px-4 py-3">
          <span className="t-label">{a.healthModelsAi}</span>
          <span className="t-section leading-7 text-ink2">{modelsText}</span>
        </Link>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col border-t border-line" aria-labelledby="health-concurrency">
          <div className="vie-ph">
            <h2 id="health-concurrency" className="t-section">{a.healthConcurrency}</h2>
            <span className="t-small text-muted">{a.healthConcurrencyHint}</span>
          </div>
          <div className="flex flex-col gap-4 p-4">
            {queues.map((q) => (
              <div key={q.key} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{q.label}</span>
                  <span className="flex items-center gap-3">
                    {/* "Not set" in regular type (SOT §B), not mono */}
                    <span className="text-xs text-muted">{t.body.reels.piNotSet}</span>
                    <button
                      type="button"
                      onClick={() =>
                        void patchConcurrency({ [q.pausedField]: !q.paused } as Partial<AdminConcurrencySettings>)
                      }
                      disabled={savingConcurrency}
                      className="vie-btn vie-btn-sm"
                    >
                      {q.paused ? a.healthResume : a.healthPause}
                    </button>
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={q.value}
                  disabled={q.paused || savingConcurrency}
                  onChange={(e) => setSliders((prev) => ({ ...prev, [q.key]: Number(e.target.value) }))}
                  onPointerUp={() => commitSlider(q.field, q.value)}
                  onKeyUp={() => commitSlider(q.field, q.value)}
                  className="vie-range w-full"
                  aria-label={q.label}
                  aria-valuetext={String(q.value)}
                  title={`${q.label}: ${q.value}`}
                />
              </div>
            ))}
          </div>
          {saveSuccess && (
            <div className="border-t border-line px-4 py-2.5 t-small text-ok">{a.compSaved}</div>
          )}
        </section>

        <section className="flex min-w-0 flex-col border-t border-line" aria-labelledby="health-inbox">
          <div className="vie-ph">
            <h2 id="health-inbox" className="t-section">{home.reviewInbox}</h2>
            <span className="t-small text-muted">• {inboxChip}</span>
          </div>
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col gap-2 px-4 py-7">
              <span className="t-section">{a.healthInboxEmpty}</span>
            </div>
          ) : (
            <div className="divide-y divide-line/60">
              {items.map((item) => {
                const rejectable = !REJECT_UNSUPPORTED.includes(item.kind);
                return (
                <div key={item.id} className="flex min-h-16 flex-col gap-2 px-4 py-3">
                  <div className="flex min-h-16 items-center gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-semibold">{item.title}</span>
                      {item.detail && <span className="t-small text-muted">{item.detail}</span>}
                    </div>
                    <button
                      type="button"
                      disabled={deciding !== null || !rejectable}
                      title={rejectable ? undefined : a.healthRejectUnsupported}
                      onClick={() => {
                        if (rejecting === item.id) { setRejecting(null); setRejectReason(""); }
                        else { setRejecting(item.id); setRejectReason(""); }
                      }}
                      className="vie-btn vie-btn-sm"
                    >
                      {a.healthReject}
                    </button>
                    <button
                      type="button"
                      disabled={deciding !== null}
                      onClick={() => void decideReview(item, "APPROVE", null)}
                      className="vie-btn vie-btn-pri vie-btn-sm"
                    >
                      {deciding === item.id ? "…" : a.healthApprove}
                    </button>
                  </div>
                  {rejecting === item.id && (
                    <div className="flex flex-col gap-2">
                      <label className="grid gap-1">
                        <span className="t-small text-muted">{a.healthDecisionsLogged}</span>
                        <input
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder={a.healthReasonPh}
                          maxLength={500}
                          disabled={deciding !== null}
                          className="in h-9 w-full"
                        />
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={deciding !== null}
                          onClick={() => void decideReview(item, "REJECT", rejectReason)}
                          className="vie-btn vie-btn-sm"
                        >
                          {deciding === item.id ? "…" : a.healthReject}
                        </button>
                        <button
                          type="button"
                          disabled={deciding !== null}
                          onClick={() => { setRejecting(null); setRejectReason(""); }}
                          className="vie-btn vie-btn-sm"
                        >
                          {t.common.cancel}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
          <div className="border-t border-line px-4 py-2.5 t-small text-muted">
            {a.healthDecisionsLogged}
          </div>
        </section>
      </div>
    </main>
  );
}
