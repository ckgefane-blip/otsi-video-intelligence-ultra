"use client";
/**
 * Admin Console — Models & AI (SOT, AdminModels.dc.html).
 * The models available to the engine: registered-model count, engine
 * accuracy (Not measured until the release gates measure it), where the
 * engine runs, and the model registry table (Model / Task / Version /
 * Weights / Status). Available to Owners and Admins.
 */
import type { AdminDashboard, AdminModelEntry } from "@otsi-vie/contracts";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { api, ApiProblem } from "@/lib/api";

export function ModelsAi() {
  const { organization } = useAuth();
  const { t } = useLocale();
  const myRole = organization?.role;
  const isAuthorized = myRole === "OWNER" || myRole === "ADMIN";

  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthorized) return;
    setLoading(true);
    setError(null);
    try {
      const dash = await api<AdminDashboard>("/v1/admin/dashboard");
      setDashboard(dash);
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.admin.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [isAuthorized]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!isAuthorized) {
    return (
      <main className="flex min-w-0 flex-1 flex-col gap-3 px-7 py-[18px]">
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

  const models: AdminModelEntry[] = dashboard?.models ?? [];
  const isEmpty = !loading && models.length === 0;

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 px-7 py-[18px]" data-testid="admin-models-ai">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="t-th">{t.body.shell.adminConsole}</span>
          <h1 className="t-page">{t.body.admin.modelsAiTitle}</h1>
          <span className="t-body text-muted">{t.body.admin.modelsAiSubtitle}</span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-ctl border border-danger/40 bg-danger/10 p-3 t-body text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="vie-panel flex flex-col gap-1 px-4 py-3">
          <span className="t-label">{t.body.admin.modelsRegistered}</span>
          <span className="t-section">{loading ? "—" : String(models.length)}</span>
        </div>
        <div className="vie-panel flex flex-col gap-1 px-4 py-3">
          <span className="t-label">{t.body.admin.modelsAccuracy}</span>
          <span className="t-section leading-7 text-amber">{t.body.admin.modelsNotMeasured}</span>
          <Link href="/settings/admin/release" className="t-body text-primary hover:underline">
            {t.body.admin.modelsSeeGates}
          </Link>
        </div>
        <div className="vie-panel flex flex-col gap-1 px-4 py-3">
          <span className="t-label">{t.body.admin.modelsRunsOn}</span>
          <span className="t-section leading-7">{t.body.admin.modelsThisComputer}</span>
          <span className="t-body text-muted">{t.body.admin.modelsLocalNote}</span>
        </div>
      </div>

      <section className="vie-panel flex flex-col" aria-labelledby="models-registry">
        <div className="vie-ph">
          <h2 id="models-registry" className="t-section">{t.body.admin.modelsRegistry}</h2>
          {isEmpty && (
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-dashed border-line2 px-2.5 t-small text-muted">
              <span className="h-[5px] w-[5px] rounded-full border border-current" aria-hidden="true" />
              {t.body.admin.modelsEmpty}
            </span>
          )}
        </div>
        <div className="flex min-h-[34px] items-center gap-3 px-4 t-small text-muted">
          <span className="flex-[2]">{t.body.admin.modelsColModel}</span>
          <span className="flex-1">{t.body.admin.modelsColTask}</span>
          <span className="flex-1">{t.body.admin.modelsColVersion}</span>
          <span className="flex-1">{t.body.admin.modelsColWeights}</span>
          <span className="flex-1">{t.body.admin.colStatus}</span>
        </div>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-start gap-2 px-4 py-7">
            <span className="t-section">{t.body.admin.modelsNone}</span>
            <span className="t-body max-w-[620px] text-muted">
              {t.body.admin.modelsNoneHint
                .replace("{a}", "services/worker/vie_worker/models/registry.json")
                .replace("{b}", ".local/models/<key>")}
            </span>
          </div>
        ) : (
          <div className="divide-y divide-line/60">
            {models.map((mod) => {
              const allVerified = mod.files.length > 0 && mod.files.every((f) => f.verified);
              const presentCount = mod.files.filter((f) => f.present).length;
              return (
                <div key={mod.key} className="flex items-center gap-3 px-4 py-3 hover:bg-raised/40">
                  <span className="flex-[2] font-mono text-xs font-normal">{mod.key}</span>
                  <span className="flex-1 capitalize t-body">{mod.task}</span>
                  <span className="flex-1 font-mono text-xs">{mod.revision}</span>
                  <span className="flex-1 t-body text-muted">
                    {mod.files.length === 1
                      ? t.body.admin.modelFilesOne.replace("{a}", String(mod.files.length)).replace("{b}", String(presentCount))
                      : t.body.admin.modelFilesMany.replace("{a}", String(mod.files.length)).replace("{b}", String(presentCount))}
                  </span>
                  <span className="flex-1">
                    {allVerified ? (
                      <span className="inline-flex items-center gap-1 rounded bg-ok/10 px-2 py-0.5 text-xs font-normal text-ok">
                        <CheckCircle2 className="h-3 w-3" /> {t.body.admin.modelReady}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-muted/20 px-2 py-0.5 text-xs font-normal text-muted">
                        <XCircle className="h-3 w-3" /> {t.body.admin.modelAbsent}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
