"use client";
/**
 * Admin Console — Security & Compliance (SOT, AdminCompliance.dc.html).
 * Retention, erasure, backups and audit. Sign-in security lives under
 * Settings > Security. Available to Owners and Admins.
 *
 * Retention: "Keep data for" maps to the policy's raw_footage_days
 * (null = Until deleted, 365 = 1 year, 730 = 2 years) and Auto-purge
 * to auto_purge_enabled; both save immediately via PATCH
 * /v1/admin/retention (the SOT has no save button). Purge trash posts
 * to /v1/admin/retention/trash/purge. Erasure requests come from
 * GET /v1/admin/retention/erasures; the "Erase a subject's data…"
 * button opens a dialog that posts to /v1/admin/retention/erasure.
 * Backups come from GET /v1/admin/backups; the audit log from
 * GET /v1/admin/audit (newest first).
 */
import type { AdminAuditEntry, AdminBackupsStatus, OrgRetentionPolicy, PurgeTrashResult, SubjectErasureRecord } from "@otsi-vie/contracts";
import { AlertTriangle, Loader2, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { api, ApiProblem } from "@/lib/api";

const ctl = "rounded-ctl border border-line bg-canvas px-3 py-2 outline-none focus:border-primary";

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

type KeepFor = "until" | "365" | "730";

function keepForValue(days: number | null | undefined): KeepFor {
  if (days === 365) return "365";
  if (days === 730) return "730";
  return "until";
}

function keepForDays(value: KeepFor): number | null {
  if (value === "365") return 365;
  if (value === "730") return 730;
  return null;
}

export function Compliance() {
  const { organization } = useAuth();
  const { t } = useLocale();
  const myRole = organization?.role;
  const isAuthorized = myRole === "OWNER" || myRole === "ADMIN";

  const [policy, setPolicy] = useState<OrgRetentionPolicy | null>(null);
  const [erasures, setErasures] = useState<SubjectErasureRecord[]>([]);
  const [backups, setBackups] = useState<AdminBackupsStatus | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);

  const [erasureOpen, setErasureOpen] = useState(false);
  const [erasureKind, setErasureKind] = useState<"PLAYER" | "USER">("PLAYER");
  const [erasureSubjectId, setErasureSubjectId] = useState("");
  const [erasureReason, setErasureReason] = useState("");
  const [erasureBusy, setErasureBusy] = useState(false);
  const [erasureError, setErasureError] = useState<string | null>(null);
  const [erasureSuccess, setErasureSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthorized) return;
    setLoading(true);
    setError(null);
    try {
      const [policyRes, erasuresRes, backupsRes, auditsRes] = await Promise.all([
        api<OrgRetentionPolicy>("/v1/admin/retention").catch(() => null),
        api<SubjectErasureRecord[]>("/v1/admin/retention/erasures").catch(() => null),
        api<AdminBackupsStatus>("/v1/admin/backups").catch(() => null),
        api<{ items?: AdminAuditEntry[] } | AdminAuditEntry[]>("/v1/admin/audit?limit=50").catch(() => null),
      ]);
      if (policyRes) setPolicy(policyRes);
      if (erasuresRes) setErasures(erasuresRes);
      if (backupsRes) setBackups(backupsRes);
      if (auditsRes) setAuditLogs(Array.isArray(auditsRes) ? auditsRes : (auditsRes.items ?? []));
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.admin.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [isAuthorized]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  const patchPolicy = useCallback(async (patch: Partial<OrgRetentionPolicy>) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api<OrgRetentionPolicy>("/v1/admin/retention", { method: "PATCH", json: patch });
      setPolicy(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.admin.policyFailed);
    } finally {
      setSaving(false);
    }
  }, []);

  const handlePurgeTrash = useCallback(async () => {
    setPurging(true);
    setPurgeResult(null);
    setError(null);
    try {
      const res = await api<PurgeTrashResult>("/v1/admin/retention/trash/purge", { method: "POST", json: {} });
      setPurgeResult(t.body.admin.purged.replace("{a}", String(res.purged_count)).replace("{b}", formatBytes(res.freed_bytes)));
      await loadData();
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.admin.purgeFailed);
    } finally {
      setPurging(false);
    }
  }, [loadData]);

  const handleExecuteErasure = useCallback(async () => {
    if (!erasureSubjectId.trim()) return;
    setErasureBusy(true);
    setErasureError(null);
    try {
      const res = await api<SubjectErasureRecord>("/v1/admin/retention/erasure", {
        method: "POST",
        json: {
          subject_kind: erasureKind,
          subject_id: erasureSubjectId.trim(),
          reason: erasureReason.trim() || undefined,
        },
      });
      setErasureSuccess(t.body.admin.erased.replace("{a}", res.subject_ref ?? "").replace("{b}", res.summary.pseudonymized_name));
      setErasureSubjectId("");
      setErasureReason("");
      setErasureOpen(false);
      await loadData();
    } catch (err) {
      setErasureError(err instanceof ApiProblem ? err.message : t.body.admin.erasureFailed);
    } finally {
      setErasureBusy(false);
    }
  }, [erasureKind, erasureSubjectId, erasureReason, loadData]);

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

  const subtitleParts = t.body.admin.compSubtitle.split("{a}");
  const keepFor = keepForValue(policy?.raw_footage_days);

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-[18px]" data-testid="admin-compliance">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="t-th">{t.body.shell.adminConsole}</span>
          <h1 className="t-page">{t.body.admin.compTitle}</h1>
          <span className="t-body text-muted">
            {subtitleParts[0]}
            <Link href="/settings/security" className="text-primary hover:underline">
              {t.body.admin.compSignInLink}
            </Link>
            {subtitleParts[1] ?? ""}
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-ctl border border-danger/40 bg-danger/10 p-3 t-body text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
          <section className="vie-panel flex flex-col" aria-labelledby="comp-retention">
            <div className="vie-ph">
              <h2 id="comp-retention" className="t-section">{t.body.admin.compRetention}</h2>
              {saved && <span className="t-small text-primary">{t.body.admin.compSaved}</span>}
            </div>
            <div className="flex flex-col gap-3.5 p-3.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1.5">
                  <label className="t-label" htmlFor="comp-keep-for">{t.body.admin.compKeepFor}</label>
                  <select
                    id="comp-keep-for"
                    className={ctl}
                    value={keepFor}
                    disabled={saving}
                    onChange={(e) => void patchPolicy({ raw_footage_days: keepForDays(e.target.value as KeepFor) })}
                  >
                    <option value="until">{t.body.admin.compKeepUntilDeleted}</option>
                    <option value="365">{t.body.admin.compKeep1Year}</option>
                    <option value="730">{t.body.admin.compKeep2Years}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="t-label">{t.body.admin.compAutoPurge}</span>
                  <div className="flex h-9 items-center gap-2.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={policy?.auto_purge_enabled ?? false}
                      aria-label={t.body.admin.compAutoPurge}
                      disabled={saving}
                      className="vie-sw shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void patchPolicy({ auto_purge_enabled: !(policy?.auto_purge_enabled ?? false) })}
                    />
                    <span className="t-body text-muted">
                      {policy?.auto_purge_enabled ? t.body.admin.compOn : t.body.admin.compOff}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="vie-btn vie-btn-sm"
                  disabled={purging}
                  onClick={() => void handlePurgeTrash()}
                >
                  {purging ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t.body.admin.compPurgeTrash}
                </button>
                {purgeResult && <span className="t-small text-primary">{purgeResult}</span>}
              </div>
            </div>
          </section>

          <section className="vie-panel flex flex-col" aria-labelledby="comp-erasure">
            <div className="vie-ph">
              <h2 id="comp-erasure" className="t-section">{t.body.admin.compErasure}</h2>
              <button
                type="button"
                className="vie-btn vie-btn-sm border-danger/40 text-danger hover:bg-danger/10"
                onClick={() => { setErasureError(null); setErasureOpen(true); }}
              >
                {t.body.admin.compEraseButton}
              </button>
            </div>
            <div className="flex flex-col gap-1.5 p-3.5">
              <span className="t-body text-muted">{t.body.admin.compErasureDesc}</span>
              {erasureSuccess && <span className="t-small text-primary">{erasureSuccess}</span>}
              {erasures.length === 0 ? (
                <span className="t-body text-muted">{t.body.admin.compNoErasures}</span>
              ) : (
                <div className="divide-y divide-line/60">
                  {erasures.map((rec) => (
                    <div key={rec.id} className="flex items-center gap-3 py-2">
                      <span className="t-body">{rec.subject_ref ?? rec.subject_id}</span>
                      <span className="t-small text-muted">{rec.subject_kind}</span>
                      <span className="ml-auto t-small text-muted">{formatDate(rec.executed_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="vie-panel flex flex-col" aria-labelledby="comp-backups">
            <div className="vie-ph">
              <h2 id="comp-backups" className="t-section">{t.body.admin.compBackups}</h2>
            </div>
            <div className="flex flex-col gap-1.5 p-3.5">
              <span className="t-body text-muted">{t.body.admin.compBackupsDesc}</span>
              {!backups || backups.backups.length === 0 ? (
                <span className="t-body text-muted">{t.body.admin.compNoBackups}</span>
              ) : (
                <div className="divide-y divide-line/60">
                  {backups.backups.map((b) => (
                    <div key={b.id} className="flex items-center gap-3 py-2">
                      <span className="t-body">{formatDate(b.timestamp)}</span>
                      <span className="t-small text-muted">{formatBytes(b.db_bytes)}</span>
                      <span className="ml-auto">
                        {b.verification_ok ? (
                          <span className="vie-chip ev ev-c">{t.body.admin.compBackupVerified}</span>
                        ) : b.verified ? (
                          <span className="vie-chip ev ev-f">{t.body.admin.compBackupMismatch}</span>
                        ) : (
                          <span className="vie-chip ev ev-n">{t.body.admin.compBackupNotChecked}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section id="audit" className="vie-panel flex flex-col" aria-labelledby="comp-audit">
            <div className="vie-ph">
              <h2 id="comp-audit" className="t-section">{t.body.admin.compAudit}</h2>
            </div>
            <div className="flex flex-col gap-1.5 p-3.5">
              <span className="t-body text-muted">{t.body.admin.compAuditDesc}</span>
              {auditLogs.length === 0 ? (
                <span className="t-body text-muted">{t.body.admin.compNoAudit}</span>
              ) : (
                <div className="divide-y divide-line/60">
                  {auditLogs.slice(0, 8).map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 py-2">
                      <span className="t-small text-muted">{formatDate(entry.occurred_at)}</span>
                      <span className="rounded bg-panel px-2 py-0.5 font-mono text-xs font-normal text-foreground border border-line">
                        {entry.action}
                      </span>
                      <span className="ml-auto truncate t-small text-muted">
                        {entry.actor_name ?? entry.actor_id ?? t.body.admin.auditSystem}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <span className="t-small text-muted">{t.body.admin.compAuditNewest}</span>
            </div>
          </section>
        </div>
      )}

      {erasureOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setErasureOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="comp-erasure-dialog-title"
            className="vie-panel w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="comp-erasure-dialog-title" className="t-section">{t.body.admin.compErasureTitle}</h2>
              <button
                type="button"
                aria-label={t.body.admin.compErasureCancel}
                className="vie-ib"
                onClick={() => setErasureOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 t-body text-muted">{t.body.admin.compErasureDesc}</p>
            {erasureError && (
              <div className="mt-3 flex items-center gap-2 rounded-ctl border border-danger/40 bg-danger/10 p-3 t-body text-danger">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{erasureError}</span>
              </div>
            )}
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="t-label" htmlFor="comp-erasure-kind">{t.body.admin.gdprSubjectKind}</label>
                <select
                  id="comp-erasure-kind"
                  className={ctl}
                  value={erasureKind}
                  onChange={(e) => setErasureKind(e.target.value as "PLAYER" | "USER")}
                >
                  <option value="PLAYER">{t.body.admin.gdprPlayer}</option>
                  <option value="USER">{t.body.admin.gdprUser}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="t-label" htmlFor="comp-erasure-id">{t.body.admin.gdprSubjectUuid}</label>
                <input
                  id="comp-erasure-id"
                  type="text"
                  className={ctl}
                  value={erasureSubjectId}
                  onChange={(e) => setErasureSubjectId(e.target.value)}
                  placeholder={t.body.admin.gdprSubjectPlaceholder}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="t-label" htmlFor="comp-erasure-reason">{t.body.admin.gdprReason}</label>
                <input
                  id="comp-erasure-reason"
                  type="text"
                  className={ctl}
                  value={erasureReason}
                  onChange={(e) => setErasureReason(e.target.value)}
                  placeholder={t.body.admin.gdprReasonPlaceholder}
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="vie-btn" onClick={() => setErasureOpen(false)}>
                {t.body.admin.compErasureCancel}
              </button>
              <button
                type="button"
                className="vie-btn border-danger/40 bg-danger/10 text-danger hover:bg-danger/20"
                disabled={erasureBusy || !erasureSubjectId.trim()}
                onClick={() => void handleExecuteErasure()}
              >
                {erasureBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t.body.admin.compErasureConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
