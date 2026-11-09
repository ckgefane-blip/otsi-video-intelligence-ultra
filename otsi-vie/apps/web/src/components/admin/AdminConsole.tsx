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
      setError(err instanceof ApiProblem ? err.message : "Failed to load admin console data");
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
      setError(err instanceof ApiProblem ? err.message : "Failed to update concurrency");
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
      setError(err instanceof ApiProblem ? err.message : "Failed to update retention policy");
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
      setPurgeResult(`Purged ${res.purged_count} items (freed ${formatBytes(res.freed_bytes)})`);
      await loadData();
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : "Failed to purge expired trash");
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
      setErasureSuccess(`Erased ${res.subject_ref}: pseudonymized as "${res.summary.pseudonymized_name}"`);
      setErasureSubjectId("");
      setErasureReason("");
      await loadData();
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : "Failed to execute subject erasure");
    } finally {
      setExecutingErasure(false);
    }
  };

  if (!isAuthorized) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-danger">
          <ShieldAlert className="h-6 w-6 shrink-0" />
          <div>
            <h2 className="font-semibold">Administrator Access Required</h2>
            <p className="text-sm opacity-90">
              Only organization Owners and Admins have permission to access the Admin Console.
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
    <div className="mx-auto max-w-6xl p-6" data-testid="admin-console">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Admin Console</h1>
            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              v3 Phase D.3
            </span>
          </div>
          <p className="text-sm text-muted">
            Governance, model registry, worker concurrency, and security audit log.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-2 rounded-ctl border border-line bg-panel px-3 py-1.5 text-sm font-medium hover:border-primary/50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-card border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* System Monitoring Alerts Banner */}
      {monitoring?.alerts && monitoring.alerts.length > 0 && (
        <div className="mb-6 space-y-2" data-testid="monitoring-alerts">
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
                  <div className="font-semibold">{alt.title}</div>
                  <div className="mt-0.5 opacity-90">{alt.message}</div>
                  {alt.suggested_action && (
                    <div className="mt-1 font-mono text-[11px] opacity-80">
                      Recommendation: {alt.suggested_action}
                    </div>
                  )}
                </div>
              </div>
              <span className="rounded bg-canvas/60 px-2 py-0.5 font-mono text-[10px] uppercase font-semibold">
                {alt.severity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="mb-6 flex gap-1 border-b border-line">
        {[
          { id: "overview", label: "Overview", icon: Activity },
          { id: "gates", label: "Release Gates (G01–G15)", icon: ShieldCheck },
          { id: "members", label: "Members & Roles", icon: Users },
          { id: "models", label: "Model Registry", icon: Database },
          { id: "workers", label: "Concurrency & Workers", icon: Sliders },
          { id: "retention", label: "Retention & Privacy", icon: Archive },
          { id: "audit", label: "Security & Audit", icon: Shield },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id as Tab)}
            data-tab={id}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
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
                <div className="rounded-card border border-line bg-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="text-xs uppercase font-medium">Members</span>
                    <Users className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-2xl font-bold">{dashboard.organization.member_count}</div>
                  <div className="text-[11px] text-muted">Active accounts</div>
                </div>

                <div className="rounded-card border border-line bg-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="text-xs uppercase font-medium">Videos</span>
                    <Layers className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-2xl font-bold">{dashboard.organization.video_count}</div>
                  <div className="text-[11px] text-muted">{dashboard.organization.reel_count} reels cut</div>
                </div>

                <div className="rounded-card border border-line bg-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="text-xs uppercase font-medium">Storage</span>
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-2xl font-bold">
                    {formatBytes(dashboard.organization.storage_bytes)}
                  </div>
                  <div className="text-[11px] text-muted">Footage & assets</div>
                </div>

                <div className="rounded-card border border-line bg-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="text-xs uppercase font-medium">Workers</span>
                    <Cpu className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-2xl font-bold">
                    {dashboard.workers.reduce((acc, g) => acc + g.active_workers, 0)}
                  </div>
                  <div className="text-[11px] text-muted">Running nodes</div>
                </div>

                <div className="rounded-card border border-line bg-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="text-xs uppercase font-medium">AI Models</span>
                    <Database className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-2xl font-bold">{dashboard.models.length}</div>
                  <div className="text-[11px] text-muted">
                    {dashboard.models.filter((m) => m.files.every((f) => f.verified)).length} cached
                  </div>
                </div>

                <div className="rounded-card border border-line bg-panel p-4">
                  <div className="flex items-center justify-between text-muted">
                    <span className="text-xs uppercase font-medium">Queued</span>
                    <FileText className="h-4 w-4" />
                  </div>
                  <div className="mt-2 text-2xl font-bold">
                    {dashboard.workers.reduce((acc, g) => acc + g.queued_jobs, 0)}
                  </div>
                  <div className="text-[11px] text-muted">Pending jobs</div>
                </div>
              </div>

              {/* System & Runtime Host Specs */}
              <div className="rounded-card border border-line bg-panel p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
                  System Runtime & Host
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                  <div>
                    <div className="text-xs text-muted">Host Machine</div>
                    <div className="font-medium">{dashboard.system_resources.host ?? "localhost"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">CPU Status</div>
                    <div className="font-medium">
                      {dashboard.system_resources.cpu_count ?? "—"} cores ({dashboard.system_resources.cpu_percent != null ? `${dashboard.system_resources.cpu_percent}%` : "—"})
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Host Memory</div>
                    <div className="font-medium">
                      {dashboard.system_resources.memory_used_bytes && dashboard.system_resources.memory_total_bytes
                        ? `${formatBytes(dashboard.system_resources.memory_used_bytes)} / ${formatBytes(dashboard.system_resources.memory_total_bytes)}`
                        : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">GPU Acceleration</div>
                    <div className="font-medium">
                      {dashboard.system_resources.gpu_name ?? "CPU / DirectML"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Worker Groups Summary */}
              <div className="rounded-card border border-line bg-panel p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
                  Active Worker Groups
                </h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {dashboard.workers.map((group) => (
                    <div key={group.group_name} className="rounded-card border border-line bg-canvas p-3">
                      <div className="flex items-center justify-between font-semibold">
                        <span>{group.group_name}</span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          group.active_workers > 0 ? "bg-ok/10 text-ok" : "bg-muted/20 text-muted"
                        }`}>
                          {group.active_workers} online
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted truncate">Kinds: {group.kinds.join(", ")}</p>
                      <div className="mt-3 flex justify-between text-xs">
                        <span>Running: <strong>{group.running_jobs}</strong></span>
                        <span>Queued: <strong>{group.queued_jobs}</strong></span>
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
            <div className="rounded-card border border-line bg-panel p-5" data-testid="tab-members">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold">Organization Members</h2>
                  <p className="text-xs text-muted">
                    Total: {dashboard.members.length} registered accounts in {dashboard.organization.name}.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase text-muted">
                      <th className="pb-3 font-medium">Member</th>
                      <th className="pb-3 font-medium">Role</th>
                      <th className="pb-3 font-medium">2FA Status</th>
                      <th className="pb-3 font-medium">Joined</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {dashboard.members.map((m) => (
                      <tr key={m.user_id} className="hover:bg-raised/40">
                        <td className="py-3">
                          <div className="font-medium">{m.display_name}</div>
                          <div className="text-xs text-muted">{m.email}</div>
                        </td>
                        <td className="py-3">
                          <span
                            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${
                              m.role === "OWNER"
                                ? "bg-amber-500/10 text-amber-500 border border-amber-500/30"
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
                              <ShieldCheck className="h-3.5 w-3.5" /> Enforced
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted">
                              Off
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-xs text-muted">{formatDate(m.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: MODEL REGISTRY */}
          {activeTab === "models" && (
            <div className="rounded-card border border-line bg-panel p-5" data-testid="tab-models">
              <div className="mb-4">
                <h2 className="text-base font-semibold">Model Registry & Artifact Introspection</h2>
                <p className="text-xs text-muted">
                  Computer vision, pitch calibration, tracking, and audio models registered in the worker pipeline.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase text-muted">
                      <th className="pb-3 font-medium">Model Key</th>
                      <th className="pb-3 font-medium">Family / Task</th>
                      <th className="pb-3 font-medium">License</th>
                      <th className="pb-3 font-medium">Adapter</th>
                      <th className="pb-3 font-medium">Weights Files</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {dashboard.models.map((mod: AdminModelEntry) => {
                      const allVerified = mod.files.length > 0 && mod.files.every((f) => f.verified);
                      const presentCount = mod.files.filter((f) => f.present).length;
                      return (
                        <tr key={mod.key} className="hover:bg-raised/40">
                          <td className="py-3">
                            <div className="font-mono text-xs font-medium">{mod.key}</div>
                            <div className="text-[11px] text-muted">{mod.source}</div>
                          </td>
                          <td className="py-3">
                            <div className="text-xs font-medium">{mod.family}</div>
                            <div className="text-[11px] text-muted capitalize">{mod.task}</div>
                          </td>
                          <td className="py-3 text-xs text-muted">{mod.weights_license}</td>
                          <td className="py-3 text-xs font-mono">{mod.adapter}</td>
                          <td className="py-3 text-xs text-muted">
                            {mod.files.length} file{mod.files.length === 1 ? "" : "s"} ({presentCount} on disk)
                          </td>
                          <td className="py-3">
                            {allVerified ? (
                              <span className="inline-flex items-center gap-1 rounded bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok">
                                <CheckCircle2 className="h-3 w-3" /> Ready
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-muted/20 px-2 py-0.5 text-xs font-medium text-muted">
                                <XCircle className="h-3 w-3" /> Absent
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
          )}

          {/* TAB 4: CONCURRENCY & WORKERS */}
          {activeTab === "workers" && (
            <div className="space-y-6" data-testid="tab-workers">
              {/* Concurrency Sliders */}
              <div className="rounded-card border border-line bg-panel p-5">
                <div className="mb-4">
                  <h2 className="text-base font-semibold">Worker Job Concurrency Caps</h2>
                  <p className="text-xs text-muted">
                    Regulate maximum simultaneous jobs scheduled across queues to match host CPU/GPU capacity.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  <div className="rounded-card border border-line bg-canvas p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Render Concurrency</span>
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">
                        {renderConcurrency}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Max parallel reel video renders, snapshot extractions & beat grids.
                    </p>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={renderConcurrency}
                      onChange={(e) => setRenderConcurrency(Number(e.target.value))}
                      className="mt-4 w-full accent-primary"
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-muted">
                      <span>1</span>
                      <span>4</span>
                      <span>8</span>
                    </div>
                  </div>

                  <div className="rounded-card border border-line bg-canvas p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Analysis Concurrency</span>
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">
                        {analysisConcurrency}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Max simultaneous YOLO / tracking & pitch calibration jobs.
                    </p>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={analysisConcurrency}
                      onChange={(e) => setAnalysisConcurrency(Number(e.target.value))}
                      className="mt-4 w-full accent-primary"
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-muted">
                      <span>1</span>
                      <span>4</span>
                      <span>8</span>
                    </div>
                  </div>

                  <div className="rounded-card border border-line bg-canvas p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Ingest Concurrency</span>
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">
                        {ingestConcurrency}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Max parallel ingest transcode & proxy file generation jobs.
                    </p>
                    <input
                      type="range"
                      min={1}
                      max={8}
                      value={ingestConcurrency}
                      onChange={(e) => setIngestConcurrency(Number(e.target.value))}
                      className="mt-4 w-full accent-primary"
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-muted">
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
                    className={`flex items-center gap-2 rounded-ctl border px-3 py-1.5 text-xs font-medium transition-colors ${
                      queuePaused
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                        : "border-line bg-canvas hover:border-primary/50"
                    }`}
                  >
                    {queuePaused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
                    {queuePaused ? "Queue Paused (Click to Resume)" : "Pause Queue Execution"}
                  </button>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
                  <div className="text-xs text-muted">
                    Queue status: {queuePaused ? "Paused" : "Active"}
                  </div>
                  <div className="flex items-center gap-3">
                    {saveSuccess && (
                      <span className="flex items-center gap-1 text-xs text-ok">
                        <CheckCircle2 className="h-4 w-4" /> Concurrency updated
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveConcurrency}
                      disabled={savingConcurrency}
                      className="flex items-center gap-2 rounded-ctl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                      {savingConcurrency ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Apply Concurrency Caps
                    </button>
                  </div>
                </div>
              </div>

              {/* Worker Groups Status Detailed */}
              <div className="rounded-card border border-line bg-panel p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
                  Worker Group Queues & Topology
                </h3>
                <div className="space-y-3">
                  {dashboard.workers.map((group) => (
                    <div
                      key={group.group_name}
                      className="flex flex-col gap-2 rounded-card border border-line bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{group.group_name}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              group.active_workers > 0 ? "bg-ok/10 text-ok" : "bg-muted/20 text-muted"
                            }`}
                          >
                            {group.active_workers} Worker{group.active_workers === 1 ? "" : "s"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted">Kinds: {group.kinds.join(", ")}</p>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div>
                          <span className="text-xs text-muted">Running</span>
                          <div className="font-semibold">{group.running_jobs}</div>
                        </div>
                        <div>
                          <span className="text-xs text-muted">Queued</span>
                          <div className="font-semibold">{group.queued_jobs}</div>
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
              <div className="rounded-card border border-line bg-panel p-5">
                <div className="mb-4">
                  <h2 className="text-base font-semibold">Data Retention Schedules</h2>
                  <p className="text-xs text-muted">
                    Configure retention lifetimes for deleted items, raw footage, rendered highlights, and audit logs.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-card border border-line bg-canvas p-4">
                    <label className="text-xs font-medium text-muted">Trash Retention (Days)</label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={retentionDraft.trash_days}
                      onChange={(e) => setRetentionDraft({ ...retentionDraft, trash_days: parseInt(e.target.value) || 0 })}
                      className="mt-2 w-full rounded-ctl border border-line bg-panel px-3 py-1.5 font-mono text-sm outline-none focus:border-primary"
                    />
                    <p className="mt-1 text-[11px] text-muted">Default 30 days before items can be purged</p>
                  </div>

                  <div className="rounded-card border border-line bg-canvas p-4">
                    <label className="text-xs font-medium text-muted">Audit Log Retention (Days)</label>
                    <input
                      type="number"
                      min={30}
                      max={3650}
                      value={retentionDraft.audit_log_days}
                      onChange={(e) => setRetentionDraft({ ...retentionDraft, audit_log_days: parseInt(e.target.value) || 365 })}
                      className="mt-2 w-full rounded-ctl border border-line bg-panel px-3 py-1.5 font-mono text-sm outline-none focus:border-primary"
                    />
                    <p className="mt-1 text-[11px] text-muted">Minimum 30 days; default 365 days</p>
                  </div>

                  <div className="rounded-card border border-line bg-canvas p-4">
                    <label className="text-xs font-medium text-muted">Auto-Purge Expired Trash</label>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="auto_purge"
                        checked={retentionDraft.auto_purge_enabled}
                        onChange={(e) => setRetentionDraft({ ...retentionDraft, auto_purge_enabled: e.target.checked })}
                        className="h-4 w-4 rounded border-line text-primary focus:ring-primary"
                      />
                      <label htmlFor="auto_purge" className="text-xs cursor-pointer select-none">
                        {retentionDraft.auto_purge_enabled ? "Enabled" : "Disabled (Manual purge only)"}
                      </label>
                    </div>
                  </div>

                  <div className="flex flex-col justify-between rounded-card border border-line bg-canvas p-4">
                    <div>
                      <span className="text-xs font-medium text-muted">Maintenance Action</span>
                      <p className="text-[11px] text-muted mt-1">Purge items exceeding trash retention threshold</p>
                    </div>
                    <button
                      type="button"
                      disabled={purgingTrash}
                      onClick={handlePurgeTrash}
                      className="mt-2 rounded-ctl border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
                    >
                      {purgingTrash ? "Purging…" : "Purge Expired Trash Now"}
                    </button>
                  </div>
                </div>

                {purgeResult && (
                  <div className="mt-3 text-xs text-ok flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> {purgeResult}
                  </div>
                )}

                <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
                  <div className="text-xs text-muted">
                    {retentionPolicy?.updated_at ? `Last updated: ${new Date(retentionPolicy.updated_at).toLocaleString()}` : ""}
                  </div>
                  <div className="flex items-center gap-3">
                    {policySaved && (
                      <span className="flex items-center gap-1 text-xs text-ok">
                        <CheckCircle2 className="h-4 w-4" /> Retention policy updated
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleSavePolicy}
                      disabled={savingPolicy}
                      className="flex items-center gap-2 rounded-ctl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                      {savingPolicy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save Retention Policy
                    </button>
                  </div>
                </div>
              </div>

              {/* GDPR Subject Erasure */}
              <div className="rounded-card border border-line bg-panel p-5">
                <div className="mb-4">
                  <h2 className="text-base font-semibold">GDPR Data Subject Erasure (Right to be Forgotten)</h2>
                  <p className="text-xs text-muted">
                    Permanently pseudonymize player or member identity records, clear scouting dossiers and ratings, and maintain cryptographic audit consistency.
                  </p>
                </div>

                <div className="rounded-card border border-line bg-canvas p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="text-xs font-medium text-muted">Subject Kind</label>
                      <select
                        value={erasureSubjectKind}
                        onChange={(e) => setErasureSubjectKind(e.target.value as "PLAYER" | "USER")}
                        className="mt-1 w-full rounded-ctl border border-line bg-panel px-3 py-1.5 text-xs outline-none focus:border-primary"
                      >
                        <option value="PLAYER">Player (Athlete)</option>
                        <option value="USER">User (Staff / Member)</option>
                      </select>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-xs font-medium text-muted">Subject UUID</label>
                      <input
                        type="text"
                        value={erasureSubjectId}
                        onChange={(e) => setErasureSubjectId(e.target.value)}
                        placeholder="e.g. 018f76... (player_id or user_id)"
                        className="mt-1 w-full rounded-ctl border border-line bg-panel px-3 py-1.5 font-mono text-xs outline-none focus:border-primary"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-muted">Action</label>
                      <button
                        type="button"
                        disabled={executingErasure || !erasureSubjectId.trim()}
                        onClick={handleExecuteErasure}
                        className="mt-1 w-full rounded-ctl border border-danger/50 bg-danger px-3 py-1.5 text-xs font-semibold text-white hover:bg-danger/90 disabled:opacity-40"
                      >
                        {executingErasure ? "Processing…" : "Execute Erasure"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="text-xs font-medium text-muted">Legal / Request Reason (Optional)</label>
                    <input
                      type="text"
                      value={erasureReason}
                      onChange={(e) => setErasureReason(e.target.value)}
                      placeholder="e.g. GDPR Article 17 request received 2026-11-09"
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
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                    Executed Erasure Requests ({erasures.length})
                  </h3>
                  <div className="max-h-60 overflow-y-auto rounded-card border border-line bg-canvas">
                    {erasures.length === 0 ? (
                      <p className="p-4 text-center text-xs text-muted">No subject erasure requests executed.</p>
                    ) : (
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-line bg-panel/50 text-[11px] text-muted">
                          <tr>
                            <th className="p-2.5">Date</th>
                            <th className="p-2.5">Kind</th>
                            <th className="p-2.5">Subject Ref</th>
                            <th className="p-2.5">Summary / Pseudonym</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {erasures.map((r) => (
                            <tr key={r.id}>
                              <td className="p-2.5 font-mono text-[11px] text-muted">
                                {new Date(r.executed_at).toLocaleString()}
                              </td>
                              <td className="p-2.5">
                                <span className="rounded bg-panel px-1.5 py-0.5 text-[10px] font-semibold border border-line">
                                  {r.subject_kind}
                                </span>
                              </td>
                              <td className="p-2.5 font-mono text-[11px]">{r.subject_ref ?? r.subject_id}</td>
                              <td className="p-2.5 text-muted">
                                {r.summary?.pseudonymized_name}
                                {r.summary?.cleared_identities ? ` · ${r.summary.cleared_identities} identities cleared` : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>

              {/* Backups & Disaster Recovery */}
              <div className="rounded-card border border-line bg-panel p-5">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">Database Backups & Disaster Recovery</h2>
                    <p className="text-xs text-muted">
                      Snapshot backups with isolated container verification and row-count consistency checks.
                    </p>
                  </div>
                  {backupsStatus && (
                    <span
                      className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        backupsStatus.healthy ? "bg-ok/10 text-ok border border-ok/30" : "bg-danger/10 text-danger border border-danger/30"
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {backupsStatus.healthy ? "Backups Healthy & Verified" : "Needs Verification"}
                    </span>
                  )}
                </div>

                <div className="rounded-card border border-line bg-canvas p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <span className="text-xs text-muted">Total Available Backups</span>
                      <div className="text-lg font-bold">{backupsStatus?.backups.length ?? 0}</div>
                    </div>
                    <div>
                      <span className="text-xs text-muted">Latest Backup Snapshot</span>
                      <div className="text-sm font-mono mt-0.5">
                        {backupsStatus?.latest_backup_at ? new Date(backupsStatus.latest_backup_at).toLocaleString() : "None"}
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-muted">Last Verified Drill</span>
                      <div className="text-sm font-mono mt-0.5 text-ok">
                        {backupsStatus?.latest_verified_at ? new Date(backupsStatus.latest_verified_at).toLocaleString() : "None"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Backups Inventory Table */}
                <div className="mt-4 max-h-60 overflow-y-auto rounded-card border border-line bg-canvas">
                  {!backupsStatus || backupsStatus.backups.length === 0 ? (
                    <p className="p-4 text-center text-xs text-muted">No backup archives discovered under .local/backups.</p>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-line bg-panel/50 text-[11px] text-muted">
                        <tr>
                          <th className="p-2.5">Snapshot ID</th>
                          <th className="p-2.5">Dump Size</th>
                          <th className="p-2.5">Schema Counts</th>
                          <th className="p-2.5">Verification</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {backupsStatus.backups.map((b) => (
                          <tr key={b.id}>
                            <td className="p-2.5 font-mono text-[11px] font-semibold">{b.id}</td>
                            <td className="p-2.5 font-mono text-[11px] text-muted">{formatBytes(b.db_bytes)}</td>
                            <td className="p-2.5 text-muted">
                              {b.tables} tables · {b.rows.toLocaleString()} rows
                            </td>
                            <td className="p-2.5">
                              {b.verification_ok ? (
                                <span className="inline-flex items-center gap-1 rounded bg-ok/10 px-2 py-0.5 text-[10px] font-semibold text-ok border border-ok/20">
                                  <CheckCircle2 className="h-3 w-3" /> VERIFIED (0 mismatches)
                                </span>
                              ) : b.verified ? (
                                <span className="inline-flex items-center gap-1 rounded bg-danger/10 px-2 py-0.5 text-[10px] font-semibold text-danger border border-danger/20">
                                  <XCircle className="h-3 w-3" /> MISMATCH
                                </span>
                              ) : (
                                <span className="rounded bg-panel px-2 py-0.5 text-[10px] text-muted border border-line">
                                  PENDING DRILL
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
          )}

          {/* TAB 6: AUDIT LOG */}
          {activeTab === "audit" && (
            <div className="rounded-card border border-line bg-panel p-5" data-testid="tab-audit">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">Security & Audit Trail</h2>
                  <p className="text-xs text-muted">
                    Immutable activity log recording state mutations, role changes, and admin interventions.
                  </p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
                  <input
                    type="text"
                    value={auditFilter}
                    onChange={(e) => setAuditFilter(e.target.value)}
                    placeholder="Filter actions or actors..."
                    className="w-full rounded-ctl border border-line bg-canvas py-1.5 pl-9 pr-3 text-xs outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase text-muted">
                      <th className="pb-3 font-medium">Timestamp</th>
                      <th className="pb-3 font-medium">Action</th>
                      <th className="pb-3 font-medium">Actor</th>
                      <th className="pb-3 font-medium">Entity</th>
                      <th className="pb-3 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {filteredAudits.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-xs text-muted">
                          No audit entries match your filter.
                        </td>
                      </tr>
                    ) : (
                      filteredAudits.map((item) => (
                        <tr key={item.id} className="hover:bg-raised/40">
                          <td className="py-3 text-xs text-muted">{formatDate(item.occurred_at)}</td>
                          <td className="py-3">
                            <span className="rounded bg-panel px-2 py-0.5 font-mono text-xs font-semibold text-foreground border border-line">
                              {item.action}
                            </span>
                          </td>
                          <td className="py-3">
                            <div className="text-xs font-mono">{item.actor_name ?? item.actor_id ?? "system"}</div>
                            <div className="text-[10px] text-muted">{item.actor_kind}</div>
                          </td>
                          <td className="py-3 text-xs">
                            <span className="font-medium capitalize">{item.entity_type}</span>
                            {item.entity_id && (
                              <div className="font-mono text-[11px] text-muted">{item.entity_id}</div>
                            )}
                          </td>
                          <td className="py-3 text-xs">
                            {item.after_state ? (
                              <pre className="max-w-xs truncate rounded bg-canvas p-1 font-mono text-[10px] text-muted">
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
          )}
        </div>
      ) : null}
    </div>
  );
}
