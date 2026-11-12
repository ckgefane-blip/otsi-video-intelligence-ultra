"use client";
/**
 * Admin Console (v3 Phase D.3, ADR-111).
 * High-performance governance dashboard for organization owners and administrators:
 * - Overview KPI metrics & system load
 * - Members & roles introspection
 * - Model registry introspection & local weights verification
 * - Worker groups & job concurrency sliders
 * - Security & audit log timeline viewer
 */
import {
  type AdminAuditEntry,
  type AdminDashboard,
  type AdminModelEntry,
  type WorkerGroupStatus,
  type OrgRetentionPolicy,
  type SubjectErasureRecord,
  type PurgeTrashResult,
  type AdminBackupsStatus,
  type AdminBackupRecord,
  type ReleaseGatesReport,
  type SystemMonitoringReport,
  type SystemAlert,
} from "@otsi-vie/contracts";
import { ReleaseGatesView } from "./ReleaseGatesView";
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileText,
  HardDrive,
  Layers,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Users,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { api, ApiProblem } from "@/lib/api";

type Tab = "overview" | "gates" | "members" | "models" | "workers" | "retention" | "audit";

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AdminConsole() {
  const { organization } = useAuth();
  const { t } = useLocale();
  const myRole = organization?.role;
  const isAuthorized = myRole === "OWNER" || myRole === "ADMIN";

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [releaseGates, setReleaseGates] = useState<ReleaseGatesReport | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditEntry[]>([]);
  const [auditFilter, setAuditFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingConcurrency, setSavingConcurrency] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Concurrency slider draft state
  const [renderConcurrency, setRenderConcurrency] = useState(2);
  const [analysisConcurrency, setAnalysisConcurrency] = useState(1);
  const [ingestConcurrency, setIngestConcurrency] = useState(2);
  const [queuePaused, setQueuePaused] = useState(false);

  // Retention policy & erasure state
  const [retentionPolicy, setRetentionPolicy] = useState<OrgRetentionPolicy | null>(null);
  const [retentionDraft, setRetentionDraft] = useState<{ trash_days: number; audit_log_days: number; auto_purge_enabled: boolean }>({ trash_days: 30, audit_log_days: 365, auto_purge_enabled: false });
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policySaved, setPolicySaved] = useState(false);
  const [purgingTrash, setPurgingTrash] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const [erasures, setErasures] = useState<SubjectErasureRecord[]>([]);
  const [erasureSubjectKind, setErasureSubjectKind] = useState<"PLAYER" | "USER">("PLAYER");
  const [erasureSubjectId, setErasureSubjectId] = useState("");
  const [erasureReason, setErasureReason] = useState("");
  const [executingErasure, setExecutingErasure] = useState(false);
  const [erasureSuccess, setErasureSuccess] = useState<string | null>(null);
  const [backupsStatus, setBackupsStatus] = useState<AdminBackupsStatus | null>(null);
  const [monitoring, setMonitoring] = useState<SystemMonitoringReport | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthorized) return;
    setLoading(true);
    setError(null);
    try {
      const [dash, auditsRes, policyRes, erasuresRes, backupsRes, monRes, gatesRes] = await Promise.all([
        api<AdminDashboard>("/v1/admin/dashboard"),
        api<{ items?: AdminAuditEntry[] } | AdminAuditEntry[]>("/v1/admin/audit?limit=50").catch(() => null),
        api<OrgRetentionPolicy>("/v1/admin/retention").catch(() => null),
        api<SubjectErasureRecord[]>("/v1/admin/retention/erasures").catch(() => null),
        api<AdminBackupsStatus>("/v1/admin/backups").catch(() => null),
        api<SystemMonitoringReport>("/v1/admin/monitoring").catch(() => null),
        api<ReleaseGatesReport>("/v1/admin/release-gates").catch(() => null),
      ]);
      setDashboard(dash);
      const auditItems = Array.isArray(auditsRes)
        ? auditsRes
        : (auditsRes?.items ?? dash.recent_audit ?? []);
      setAuditLogs(auditItems);
      setRenderConcurrency(dash.concurrency.max_concurrent_renders);
      setAnalysisConcurrency(dash.concurrency.max_concurrent_analysis);
      setIngestConcurrency(dash.concurrency.max_concurrent_ingest);
      setQueuePaused(dash.concurrency.queue_paused);

      if (policyRes) {
        setRetentionPolicy(policyRes);
        setRetentionDraft({
          trash_days: policyRes.trash_days,
          audit_log_days: policyRes.audit_log_days,
          auto_purge_enabled: policyRes.auto_purge_enabled,
        });
      }
      if (erasuresRes) {
        setErasures(erasuresRes);
      }
      if (backupsRes) {
        setBackupsStatus(backupsRes);
      }
      if (monRes) {
        setMonitoring(monRes);
      }
      if (gatesRes) {
        setReleaseGates(gatesRes);
      }
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.admin.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [isAuthorized]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveConcurrency = async () => {
    setSavingConcurrency(true);
    setSaveSuccess(false);
    setError(null);
    try {
      const res = await api<{ concurrency: AdminDashboard["concurrency"]; workers: WorkerGroupStatus[] }>(
        "/v1/admin/concurrency",
        {
          method: "PATCH",
          json: {
            max_concurrent_renders: renderConcurrency,
            max_concurrent_analysis: analysisConcurrency,
            max_concurrent_ingest: ingestConcurrency,
            queue_paused: queuePaused,
          },
        },
      );
      if (dashboard) {
        setDashboard({
          ...dashboard,
          concurrency: res.concurrency,
          workers: res.workers,
        });
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.admin.concurrencyFailed);
    } finally {
      setSavingConcurrency(false);
    }
  };

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    setPolicySaved(false);
    setError(null);
    try {
      const updated = await api<OrgRetentionPolicy>("/v1/admin/retention", {
        method: "PATCH",
        json: retentionDraft,
      });
      setRetentionPolicy(updated);
      setPolicySaved(true);
      setTimeout(() => setPolicySaved(false), 3000);
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.admin.policyFailed);
    } finally {
      setSavingPolicy(false);
    }
  };

  const handlePurgeTrash = async () => {
    setPurgingTrash(true);
    setPurgeResult(null);
    setError(null);
    try {
      const res = await api<PurgeTrashResult>("/v1/admin/retention/trash/purge", {
        method: "POST",
        json: {},
      });
      setPurgeResult(t.body.admin.purged.replace("{a}", String(res.purged_count)).replace("{b}", formatBytes(res.freed_bytes)));
      await loadData();
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.admin.purgeFailed);
    } finally {
      setPurgingTrash(false);
    }
  };

  const handleExecuteErasure = async () => {
    if (!erasureSubjectId.trim()) return;
    setExecutingErasure(true);
    setErasureSuccess(null);
    setError(null);
    try {
      const res = await api<SubjectErasureRecord>("/v1/admin/retention/erasure", {
        method: "POST",
        json: {
          subject_kind: erasureSubjectKind,
          subject_id: erasureSubjectId.trim(),
          reason: erasureReason.trim() || undefined,
        },
      });
      setErasureSuccess(t.body.admin.erased.replace("{a}", res.subject_ref ?? "").replace("{b}", res.summary.pseudonymized_name));
      setErasureSubjectId("");
      setErasureReason("");
      await loadData();
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.admin.erasureFailed);
    } finally {
      setExecutingErasure(false);
    }
  };

  if (!isAuthorized) {
    return (
      <div className="w-full max-w-4xl">
        <div className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-danger">
          <ShieldAlert className="h-6 w-6 shrink-0" />
          <div>
            <h2 className="font-normal">{t.body.admin.accessRequired}</h2>
            <p className="t-body opacity-90">
              {t.body.admin.accessOnly}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const filteredAudits = (auditLogs || []).filter((a) => {
    if (!auditFilter.trim()) return true;
    const term = auditFilter.toLowerCase();
    return (
      a.action.toLowerCase().includes(term) ||
      (a.actor_name && a.actor_name.toLowerCase().includes(term)) ||
      (a.actor_id && a.actor_id.toLowerCase().includes(term)) ||
      a.entity_type.toLowerCase().includes(term)
    );
  });

  return (
    <div className="w-full max-w-6xl space-y-4" data-testid="admin-console">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="t-page">{t.body.admin.title}</h1>
            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-normal text-primary">
              v3 Phase D.3
            </span>
          </div>
          <p className="t-body mt-1 text-muted">
            {t.body.admin.subtitle}
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="vie-btn vie-btn-sm"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t.body.admin.refresh}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-ctl border border-danger/40 bg-danger/10 p-3 t-body text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* System Monitoring Alerts Banner */}
      {monitoring?.alerts && monitoring.alerts.length > 0 && (
        <div className="space-y-2" data-testid="monitoring-alerts">
          {monitoring.alerts.map((alt) => (
            <div
              key={alt.id}
              className={`flex items-start justify-between rounded-card border p-3 text-xs ${
                alt.severity === "CRITICAL"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-amber/40 bg-amber/10 text-amber"
              }`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-normal">{alt.title}</div>
                  <div className="mt-0.5 opacity-90">{alt.message}</div>
                  {alt.suggested_action && (
                    <div className="mt-1 font-mono t-small opacity-80">
                      {t.body.admin.recommendation.replace("{a}", alt.suggested_action)}
                    </div>
                  )}
                </div>
              </div>
              <span className="rounded bg-canvas/60 px-2 py-0.5 font-mono text-xs font-normal uppercase">
                {({ INFO: t.body.admin.severityInfo, WARNING: t.body.admin.severityWarning, CRITICAL: t.body.admin.severityCritical } as Record<string, string>)[alt.severity] ?? alt.severity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {[
          { id: "overview", label: t.body.admin.tabOverview, icon: Activity },
          { id: "gates", label: t.body.admin.tabGates, icon: ShieldCheck },
          { id: "members", label: t.body.admin.tabMembers, icon: Users },
          { id: "models", label: t.body.admin.tabModels, icon: Database },
          { id: "workers", label: t.body.admin.tabWorkers, icon: Sliders },
          { id: "retention", label: t.body.admin.tabRetention, icon: Archive },
          { id: "audit", label: t.body.admin.tabAudit, icon: Shield },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id as Tab)}
            data-tab={id}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 font-normal transition-colors ${
              activeTab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:border-line hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {loading && !dashboard ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : dashboard ? (
        <div>
          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-6" data-testid="tab-overview">
              {/* Metric Cards Grid */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <div className="vie-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="t-th">{t.body.admin.metricMembers}</span>
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="t-metric mt-2">{dashboard.organization.member_count}</div>
                  <div className="t-small">{t.body.admin.metricActiveAccounts}</div>
                </div>

                <div className="vie-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="t-th">{t.body.admin.metricVideos}</span>
                    <Layers className="h-4 w-4" />
                  </div>
                  <div className="t-metric mt-2">{dashboard.organization.video_count}</div>
                  <div className="t-small">{t.body.admin.metricReelsCut.replace("{a}", String(dashboard.organization.reel_count))}</div>
                </div>

                <div className="vie-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="t-th">{t.body.admin.metricStorage}</span>
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <div className="t-metric mt-2">
                    {formatBytes(dashboard.organization.storage_bytes)}
                  </div>
                  <div className="t-small">{t.body.admin.metricFootage}</div>
                </div>

                <div className="vie-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="t-th">{t.body.admin.metricWorkers}</span>
                    <Cpu className="h-4 w-4" />
                  </div>
                  <div className="t-metric mt-2">
                    {dashboard.workers.reduce((acc, g) => acc + g.active_workers, 0)}
                  </div>
                  <div className="t-small">{t.body.admin.metricRunningNodes}</div>
                </div>

                <div className="vie-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="t-th">{t.body.admin.metricModels}</span>
                    <Database className="h-4 w-4" />
                  </div>
                  <div className="t-metric mt-2">{dashboard.models.length}</div>
                  <div className="t-small">
                    {t.body.admin.metricCached.replace("{a}", String(dashboard.models.filter((m) => m.files.every((f) => f.verified)).length))}
                  </div>
                </div>

                <div className="vie-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="t-th">{t.body.admin.metricQueued}</span>
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="t-metric mt-2">
                    {dashboard.workers.reduce((acc, g) => acc + g.queued_jobs, 0)}
                  </div>
                  <div className="t-small">{t.body.admin.metricPendingJobs}</div>
                </div>
              </div>

              {/* System & Runtime Host Specs */}
              <div className="vie-panel">
                <div className="vie-ph"><h3 className="t-section">{t.body.admin.sysRuntime}</h3></div>
                <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-4">
                  <div>
                    <div className="t-small">{t.body.admin.sysHost}</div>
                    <div className="font-normal">{dashboard.system_resources.host ?? "localhost"}</div>
                  </div>
                  <div>
                    <div className="t-small">{t.body.admin.sysCpu}</div>
                    <div className="font-normal">
                      {t.body.admin.sysCores.replace("{a}", String(dashboard.system_resources.cpu_count ?? "—")).replace("{b}", dashboard.system_resources.cpu_percent != null ? String(dashboard.system_resources.cpu_percent) : "—")}
                    </div>
                  </div>
                  <div>
                    <div className="t-small">{t.body.admin.sysMemory}</div>
                    <div className="font-normal">
                      {dashboard.system_resources.memory_used_bytes && dashboard.system_resources.memory_total_bytes
                        ? `${formatBytes(dashboard.system_resources.memory_used_bytes)} / ${formatBytes(dashboard.system_resources.memory_total_bytes)}`
                        : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="t-small">{t.body.admin.sysGpu}</div>
                    <div className="font-normal">
                      {dashboard.system_resources.gpu_name ?? t.body.admin.sysGpuFallback}
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Worker Groups Summary */}
              <div className="vie-panel">
                <div className="vie-ph"><h3 className="t-section">{t.body.admin.workerGroups}</h3></div>
                <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
                  {dashboard.workers.map((group) => (
                    <div key={group.group_name} className="rounded-card border border-line bg-canvas p-3">
                      <div className="flex items-center justify-between font-normal">
                        <span>{group.group_name}</span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-normal ${
                          group.active_workers > 0 ? "bg-ok/10 text-ok" : "bg-muted/20 text-muted"
                        }`}>
                          {t.body.admin.workerOnline.replace("{a}", String(group.active_workers))}
                        </span>
                      </div>
                      <p className="mt-1 t-small truncate">{t.body.admin.workerKinds.replace("{a}", group.kinds.join(", "))}</p>
                      <div className="mt-3 flex justify-between text-xs">
                        <span>{t.body.admin.workerRunning}: <strong>{group.running_jobs}</strong></span>
                        <span>{t.body.admin.workerQueued}: <strong>{group.queued_jobs}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: RELEASE GATES (G01–G15) */}
          {activeTab === "gates" && (
            <div data-testid="tab-gates">
              <ReleaseGatesView report={releaseGates} />
            </div>
          )}

          {/* TAB 2: MEMBERS & ROLES */}
          {activeTab === "members" && (
            <div className="vie-panel" data-testid="tab-members">
              <div className="vie-ph"><h2 className="t-section">{t.body.admin.membersTitle}</h2></div>
              <div className="p-4">
                <p className="t-small">
                  {t.body.admin.membersTotal.replace("{a}", String(dashboard.members.length)).replace("{b}", dashboard.organization.name)}
                </p>
                <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="t-th border-b border-line text-left">
                      <th className="pb-3">{t.body.admin.colMember}</th>
                      <th className="pb-3">{t.body.admin.colRole}</th>
                      <th className="pb-3">{t.body.admin.colTwoFa}</th>
                      <th className="pb-3">{t.body.admin.colJoined}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {dashboard.members.map((m) => (
                      <tr key={m.user_id} className="hover:bg-raised/40">
                        <td className="py-3">
                          <div className="font-normal">{m.display_name}</div>
                          <div className="t-small">{m.email}</div>
                        </td>
                        <td className="py-3">
                          <span
                            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-normal ${
                              m.role === "OWNER"
                                ? "bg-amber/10 text-amber border border-amber/30"
                                : m.role === "ADMIN"
                                ? "bg-primary/10 text-primary border border-primary/30"
                                : "bg-panel text-muted border border-line"
                            }`}
                          >
                            {m.role}
                          </span>
                        </td>
                        <td className="py-3">
                          {m.two_step ? (
                            <span className="inline-flex items-center gap-1 text-xs text-ok">
                              <ShieldCheck className="h-3.5 w-3.5" /> {t.body.admin.twoFaEnforced}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 t-small">
                              {t.body.admin.twoFaOff}
                            </span>
                          )}
                        </td>
                        <td className="py-3 t-small">{formatDate(m.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MODEL REGISTRY */}
          {activeTab === "models" && (
            <div className="vie-panel" data-testid="tab-models">
              <div className="vie-ph"><h2 className="t-section">{t.body.admin.modelsTitle}</h2></div>
              <div className="p-4">
                <p className="t-small">
                  {t.body.admin.modelsSubtitle}
                </p>
                <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="t-th border-b border-line text-left">
                      <th className="pb-3">{t.body.admin.colModelKey}</th>
                      <th className="pb-3">{t.body.admin.colFamilyTask}</th>
                      <th className="pb-3">{t.body.admin.colLicense}</th>
                      <th className="pb-3">{t.body.admin.colAdapter}</th>
                      <th className="pb-3">{t.body.admin.colWeights}</th>
                      <th className="pb-3">{t.body.admin.colStatus}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {dashboard.models.map((mod: AdminModelEntry) => {
                      const allVerified = mod.files.length > 0 && mod.files.every((f) => f.verified);
                      const presentCount = mod.files.filter((f) => f.present).length;
                      return (
                        <tr key={mod.key} className="hover:bg-raised/40">
                          <td className="py-3">
                            <div className="font-mono text-xs font-normal">{mod.key}</div>
                            <div className="t-small">{mod.source}</div>
                          </td>
                          <td className="py-3">
                            <div className="text-xs font-normal">{mod.family}</div>
                            <div className="t-small capitalize">{mod.task}</div>
                          </td>
                          <td className="py-3 t-small">{mod.weights_license}</td>
                          <td className="py-3 text-xs font-mono">{mod.adapter}</td>
                          <td className="py-3 t-small">
                            {mod.files.length === 1 ? t.body.admin.modelFilesOne.replace("{a}", String(mod.files.length)).replace("{b}", String(presentCount)) : t.body.admin.modelFilesMany.replace("{a}", String(mod.files.length)).replace("{b}", String(presentCount))}
                          </td>
                          <td className="py-3">
                            {allVerified ? (
                              <span className="inline-flex items-center gap-1 rounded bg-ok/10 px-2 py-0.5 text-xs font-normal text-ok">
                                <CheckCircle2 className="h-3 w-3" /> {t.body.admin.modelReady}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-muted/20 px-2 py-0.5 text-xs font-normal text-muted">
                                <XCircle className="h-3 w-3" /> {t.body.admin.modelAbsent}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CONCURRENCY & WORKERS */}
          {activeTab === "workers" && (
            <div className="space-y-6" data-testid="tab-workers">
              {/* Concurrency Sliders */}
              <div className="vie-panel">
                <div className="vie-ph"><h2 className="t-section">{t.body.admin.concurrencyTitle}</h2></div>
                <div className="p-4">
                <p className="t-small">
                  {t.body.admin.concurrencySubtitle}
                </p>
                <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
                  <div className="rounded-card border border-line bg-canvas p-4">
                    <div className="flex items-center justify-between">
                      <span className="t-panel">{t.body.admin.concRender}</span>
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-normal text-primary">
                        {renderConcurrency}
                      </span>
                    </div>
                    <p className="mt-1 t-small">
                      {t.body.admin.concRenderDesc}
                    </p>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={renderConcurrency}
                      onChange={(e) => setRenderConcurrency(Number(e.target.value))}
                      className="vie-range mt-4 w-full"
                    />
                    <div className="mt-1 flex justify-between t-small">
                      <span>1</span>
                      <span>4</span>
                      <span>8</span>
                    </div>
                  </div>

                  <div className="rounded-card border border-line bg-canvas p-4">
                    <div className="flex items-center justify-between">
                      <span className="t-panel">{t.body.admin.concAnalysis}</span>
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-normal text-primary">
                        {analysisConcurrency}
                      </span>
                    </div>
                    <p className="mt-1 t-small">
                      {t.body.admin.concAnalysisDesc}
                    </p>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={analysisConcurrency}
                      onChange={(e) => setAnalysisConcurrency(Number(e.target.value))}
                      className="vie-range mt-4 w-full"
                    />
                    <div className="mt-1 flex justify-between t-small">
                      <span>1</span>
                      <span>4</span>
                      <span>8</span>
                    </div>
                  </div>

                  <div className="rounded-card border border-line bg-canvas p-4">
                    <div className="flex items-center justify-between">
                      <span className="t-panel">{t.body.admin.concIngest}</span>
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-normal text-primary">
                        {ingestConcurrency}
                      </span>
                    </div>
                    <p className="mt-1 t-small">
                      {t.body.admin.concIngestDesc}
                    </p>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={ingestConcurrency}
                      onChange={(e) => setIngestConcurrency(Number(e.target.value))}
                      className="vie-range mt-4 w-full"
                    />
                    <div className="mt-1 flex justify-between t-small">
                      <span>1</span>
                      <span>4</span>
                      <span>8</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQueuePaused(!queuePaused)}
                    className={`t-button inline-flex items-center gap-2 rounded-ctl border px-3 py-1.5 ${
                      queuePaused
                        ? "border-amber/40 bg-amber/10 text-amber"
                        : "border-line bg-canvas hover:border-primary/50"
                    }`}
                  >
                    {queuePaused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
                    {queuePaused ? t.body.admin.queuePausedBtn : t.body.admin.queuePauseBtn}
                  </button>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
                  <div className="t-small">
                    {t.body.admin.queueStatus.replace("{a}", queuePaused ? t.body.admin.queuePausedWord : t.body.admin.queueActiveWord)}
                  </div>
                  <div className="flex items-center gap-3">
                    {saveSuccess && (
                      <span className="flex items-center gap-1 text-xs text-ok">
                        <CheckCircle2 className="h-4 w-4" /> {t.body.admin.concUpdated}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveConcurrency}
                      disabled={savingConcurrency}
                      className="vie-btn vie-btn-pri"
                    >
                      {savingConcurrency ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      {t.body.admin.concApply}
                    </button>
                  </div>
                </div>
                </div>
              </div>

              {/* Worker Groups Status Detailed */}
              <div className="vie-panel">
                <div className="vie-ph"><h3 className="t-section">{t.body.admin.workerTopology}</h3></div>
                <div className="space-y-3 p-4">
                  {dashboard.workers.map((group) => (
                    <div
                      key={group.group_name}
                      className="flex flex-col gap-2 rounded-card border border-line bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-normal">{group.group_name}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-normal ${
                              group.active_workers > 0 ? "bg-ok/10 text-ok" : "bg-muted/20 text-muted"
                            }`}
                          >
                            {group.active_workers === 1 ? t.body.admin.workerCountOne.replace("{a}", String(group.active_workers)) : t.body.admin.workerCountMany.replace("{a}", String(group.active_workers))}
                          </span>
                        </div>
                        <p className="mt-0.5 t-small">{t.body.admin.workerKinds.replace("{a}", group.kinds.join(", "))}</p>
                      </div>
                      <div className="flex items-center gap-6">
                        <div>
                          <span className="t-small">{t.body.admin.workerRunning}</span>
                          <div className="font-normal">{group.running_jobs}</div>
                        </div>
                        <div>
                          <span className="t-small">{t.body.admin.workerQueued}</span>
                          <div className="font-normal">{group.queued_jobs}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: RETENTION & PRIVACY */}
          {activeTab === "retention" && (
            <div className="space-y-6" data-testid="tab-retention">
              {/* Retention Policy Settings */}
              <div className="vie-panel">
                <div className="vie-ph"><h2 className="t-section">{t.body.admin.retentionTitle}</h2></div>
                <div className="p-4">
                <p className="t-small">
                  {t.body.admin.retentionSubtitle}
                </p>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-card border border-line bg-canvas p-4">
                    <label className="text-xs font-normal text-muted">{t.body.admin.retTrash}</label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={retentionDraft.trash_days}
                      onChange={(e) => setRetentionDraft({ ...retentionDraft, trash_days: parseInt(e.target.value) || 0 })}
                      className="mt-2 w-full rounded-ctl border border-line bg-panel px-3 py-1.5 font-mono outline-none focus:border-primary"
                    />
                    <p className="mt-1 t-small">{t.body.admin.retTrashHint}</p>
                  </div>

                  <div className="rounded-card border border-line bg-canvas p-4">
                    <label className="text-xs font-normal text-muted">{t.body.admin.retAudit}</label>
                    <input
                      type="number"
                      min={30}
                      max={3650}
                      value={retentionDraft.audit_log_days}
                      onChange={(e) => setRetentionDraft({ ...retentionDraft, audit_log_days: parseInt(e.target.value) || 365 })}
                      className="mt-2 w-full rounded-ctl border border-line bg-panel px-3 py-1.5 font-mono outline-none focus:border-primary"
                    />
                    <p className="mt-1 t-small">{t.body.admin.retAuditHint}</p>
                  </div>

                  <div className="rounded-card border border-line bg-canvas p-4">
                    <label className="text-xs font-normal text-muted">{t.body.admin.retAutoPurge}</label>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="auto_purge"
                        checked={retentionDraft.auto_purge_enabled}
                        onChange={(e) => setRetentionDraft({ ...retentionDraft, auto_purge_enabled: e.target.checked })}
                        className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
                      />
                      <label htmlFor="auto_purge" className="text-xs cursor-pointer select-none">
                        {retentionDraft.auto_purge_enabled ? t.body.admin.retEnabled : t.body.admin.retDisabled}
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-col justify-between rounded-card border border-line bg-canvas p-4">
                    <div>
                      <span className="text-xs font-normal text-muted">{t.body.admin.retMaintenance}</span>
                      <p className="t-small mt-1">{t.body.admin.retMaintenanceDesc}</p>
                    </div>
                    <button
                      type="button"
                      disabled={purgingTrash}
                      onClick={handlePurgeTrash}
                      className="t-button mt-2 inline-flex items-center gap-2 rounded-ctl border border-danger/40 bg-danger/10 px-3 py-1.5 text-danger hover:bg-danger/20 disabled:opacity-50"
                    >
                      {purgingTrash ? t.body.admin.retPurging : t.body.admin.retPurgeBtn}
                    </button>
                  </div>
                </div>

                {purgeResult && (
                  <div className="mt-3 text-xs text-ok flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> {purgeResult}
                  </div>
                )}

                <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
                  <div className="t-small">
                    {retentionPolicy?.updated_at ? t.body.admin.retLastUpdated.replace("{a}", new Date(retentionPolicy.updated_at).toLocaleString()) : ""}
                  </div>
                  <div className="flex items-center gap-3">
                    {policySaved && (
                      <span className="flex items-center gap-1 text-xs text-ok">
                        <CheckCircle2 className="h-4 w-4" /> {t.body.admin.retPolicyUpdated}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleSavePolicy}
                      disabled={savingPolicy}
                      className="vie-btn vie-btn-pri"
                    >
                      {savingPolicy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {t.body.admin.retSave}
                    </button>
                  </div>
                </div>
                </div>
              </div>

              {/* GDPR Subject Erasure */}
              <div className="vie-panel">
                <div className="vie-ph"><h2 className="t-section">{t.body.admin.gdprTitle}</h2></div>
                <div className="p-4">
                <p className="t-small">
                  {t.body.admin.gdprSubtitle}
                </p>
                <div className="mt-4 rounded-ctl border border-line bg-canvas p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="text-xs font-normal text-muted">{t.body.admin.gdprSubjectKind}</label>
                      <select
                        value={erasureSubjectKind}
                        onChange={(e) => setErasureSubjectKind(e.target.value as "PLAYER" | "USER")}
                        className="mt-1 w-full rounded-ctl border border-line bg-panel px-3 py-1.5 text-xs outline-none focus:border-primary"
                      >
                        <option value="PLAYER">{t.body.admin.gdprPlayer}</option>
                        <option value="USER">{t.body.admin.gdprUser}</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-xs font-normal text-muted">{t.body.admin.gdprSubjectUuid}</label>
                      <input
                        type="text"
                        value={erasureSubjectId}
                        onChange={(e) => setErasureSubjectId(e.target.value)}
                        placeholder={t.body.admin.gdprSubjectPlaceholder}
                        className="mt-1 w-full rounded-ctl border border-line bg-panel px-3 py-1.5 font-mono text-xs outline-none focus:border-primary"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-normal text-muted">{t.body.admin.gdprAction}</label>
                      <button
                        type="button"
                        disabled={executingErasure || !erasureSubjectId.trim()}
                        onClick={handleExecuteErasure}
                        className="t-button mt-1 flex w-full items-center justify-center gap-2 rounded-ctl bg-danger px-3 py-1.5 text-white hover:bg-danger/90 disabled:opacity-40"
                      >
                        {executingErasure ? t.body.admin.gdprProcessing : t.body.admin.gdprExecute}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="text-xs font-normal text-muted">{t.body.admin.gdprReason}</label>
                    <input
                      type="text"
                      value={erasureReason}
                      onChange={(e) => setErasureReason(e.target.value)}
                      placeholder={t.body.admin.gdprReasonPlaceholder}
                      className="mt-1 w-full rounded-ctl border border-line bg-panel px-3 py-1.5 text-xs outline-none focus:border-primary"
                    />
                  </div>

                  {erasureSuccess && (
                    <div className="mt-3 flex items-center gap-1 text-xs text-ok">
                      <CheckCircle2 className="h-4 w-4" /> {erasureSuccess}
                    </div>
                  )}
                </div>

                {/* Erasure Requests Audit List */}
                <div className="mt-5">
                  <h3 className="mb-2 text-xs font-normal uppercase tracking-wider text-muted">
                    {t.body.admin.gdprExecuted.replace("{a}", String(erasures.length))}
                  </h3>
                  <div className="max-h-60 overflow-y-auto rounded-card border border-line bg-canvas">
                    {erasures.length === 0 ? (
                      <p className="p-4 text-center t-small">{t.body.admin.gdprNone}</p>
                    ) : (
                      <table className="w-full text-left text-xs">
                        <thead className="t-th border-b border-line bg-panel/50 text-left">
                          <tr>
                            <th className="p-2.5">{t.body.admin.gdprColDate}</th>
                            <th className="p-2.5">{t.body.admin.gdprColKind}</th>
                            <th className="p-2.5">{t.body.admin.gdprColSubject}</th>
                            <th className="p-2.5">{t.body.admin.gdprColSummary}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {erasures.map((r) => (
                            <tr key={r.id}>
                              <td className="p-2.5 t-tc text-muted">
                                {new Date(r.executed_at).toLocaleString()}
                              </td>
                              <td className="p-2.5">
                                <span className="rounded bg-panel px-1.5 py-0.5 text-xs font-normal border border-line">
                                  {r.subject_kind}
                                </span>
                              </td>
                              <td className="p-2.5 t-tc">{r.subject_ref ?? r.subject_id}</td>
                              <td className="p-2.5 text-muted">
                                {r.summary?.pseudonymized_name}
                                {r.summary?.cleared_identities ? t.body.admin.gdprCleared.replace("{a}", String(r.summary.cleared_identities)) : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
                </div>
              </div>

              {/* Backups & Disaster Recovery */}
              <div className="vie-panel">
                <div className="vie-ph">
                  <h2 className="t-section">{t.body.admin.backupsTitle}</h2>
                  {backupsStatus && (
                    <span
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-normal ${
                        backupsStatus.healthy ? "bg-ok/10 text-ok border border-ok/30" : "bg-danger/10 text-danger border border-danger/30"
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {backupsStatus.healthy ? t.body.admin.backupsHealthy : t.body.admin.backupsNeeds}
                    </span>
                  )}
                </div>
                <div className="p-4">
                <p className="t-small">{t.body.admin.backupsSubtitle}</p>

                <div className="rounded-card border border-line bg-canvas p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <span className="t-small">{t.body.admin.backupsTotal}</span>
                      <div className="t-metric">{backupsStatus?.backups.length ?? 0}</div>
                    </div>
                    <div>
                      <span className="t-small">{t.body.admin.backupsLatest}</span>
                      <div className="t-tc mt-0.5">
                        {backupsStatus?.latest_backup_at ? new Date(backupsStatus.latest_backup_at).toLocaleString() : t.body.admin.backupsNone}
                      </div>
                    </div>
                    <div>
                      <span className="t-small">{t.body.admin.backupsDrill}</span>
                      <div className="t-tc mt-0.5 text-ok">
                        {backupsStatus?.latest_verified_at ? new Date(backupsStatus.latest_verified_at).toLocaleString() : t.body.admin.backupsNone}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Backups Inventory Table */}
                <div className="mt-4 max-h-60 overflow-y-auto rounded-card border border-line bg-canvas">
                  {!backupsStatus || backupsStatus.backups.length === 0 ? (
                    <p className="p-4 text-center t-small">{t.body.admin.backupsNoArchives}</p>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="t-th border-b border-line bg-panel/50 text-left">
                        <tr>
                          <th className="p-2.5">{t.body.admin.backupsColSnapshot}</th>
                          <th className="p-2.5">{t.body.admin.backupsColSize}</th>
                          <th className="p-2.5">{t.body.admin.backupsColSchema}</th>
                          <th className="p-2.5">{t.body.admin.backupsColVerification}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {backupsStatus.backups.map((b) => (
                          <tr key={b.id}>
                            <td className="p-2.5 t-tc">{b.id}</td>
                            <td className="p-2.5 t-tc text-muted">{formatBytes(b.db_bytes)}</td>
                            <td className="p-2.5 text-muted">
                              {t.body.admin.backupsTables.replace("{a}", String(b.tables)).replace("{b}", b.rows.toLocaleString())}
                            </td>
                            <td className="p-2.5">
                              {b.verification_ok ? (
                                <span className="inline-flex items-center gap-1 rounded bg-ok/10 px-2 py-0.5 text-xs font-normal text-ok border border-ok/20">
                                  <CheckCircle2 className="h-3 w-3" /> {t.body.admin.backupsVerified}
                                </span>
                              ) : b.verified ? (
                                <span className="inline-flex items-center gap-1 rounded bg-danger/10 px-2 py-0.5 text-xs font-normal text-danger border border-danger/20">
                                  <XCircle className="h-3 w-3" /> {t.body.admin.backupsMismatch}
                                </span>
                              ) : (
                                <span className="rounded bg-panel px-2 py-0.5 text-xs text-muted border border-line">
                                  {t.body.admin.backupsPending}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: AUDIT LOG */}
          {activeTab === "audit" && (
            <div className="vie-panel" data-testid="tab-audit">
              <div className="vie-ph">
                <h2 className="t-section">{t.body.admin.auditTitle}</h2>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
                  <input
                    type="text"
                    value={auditFilter}
                    onChange={(e) => setAuditFilter(e.target.value)}
                    placeholder={t.body.admin.auditFilterPlaceholder}
                    className="w-full rounded-ctl border border-line bg-canvas py-1.5 pl-9 pr-3 text-xs outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div className="p-4">
                <p className="t-small">{t.body.admin.auditSubtitle}</p>
                <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="t-th border-b border-line text-left">
                      <th className="pb-3">{t.body.admin.auditColTimestamp}</th>
                      <th className="pb-3">{t.body.admin.auditColAction}</th>
                      <th className="pb-3">{t.body.admin.auditColActor}</th>
                      <th className="pb-3">{t.body.admin.auditColEntity}</th>
                      <th className="pb-3">{t.body.admin.auditColDetails}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {filteredAudits.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center t-small">
                          {t.body.admin.auditNone}
                        </td>
                      </tr>
                    ) : (
                      filteredAudits.map((item) => (
                        <tr key={item.id} className="hover:bg-raised/40">
                          <td className="py-3 t-small">{formatDate(item.occurred_at)}</td>
                          <td className="py-3">
                            <span className="rounded bg-panel px-2 py-0.5 font-mono text-xs font-normal text-foreground border border-line">
                              {item.action}
                            </span>
                          </td>
                          <td className="py-3">
                            <div className="text-xs font-mono">{item.actor_name ?? item.actor_id ?? t.body.admin.auditSystem}</div>
                            <div className="t-small">{item.actor_kind}</div>
                          </td>
                          <td className="py-3 text-xs">
                            <span className="font-normal capitalize">{item.entity_type}</span>
                            {item.entity_id && (
                              <div className="t-tc text-muted">{item.entity_id}</div>
                            )}
                          </td>
                          <td className="py-3 text-xs">
                            {item.after_state ? (
                              <pre className="max-w-xs truncate rounded bg-canvas p-1 t-tc text-muted">
                                {JSON.stringify(item.after_state)}
                              </pre>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
