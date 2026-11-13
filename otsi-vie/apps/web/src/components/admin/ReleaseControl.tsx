"use client";
/**
 * Admin Console — Release Control (SOT, AdminRelease.dc.html).
 * The accuracy gates on labelled football footage: engine accuracy,
 * gates passed (of the 3 accuracy gates G05–G07), what holds until
 * they pass, and the accuracy-gates table (Gate / Name / What it
 * proves / Status). Data is read live from GET /v1/admin/release-gates;
 * the SOT copy (names, "what it proves", next step) is the display
 * text. Available to Owners and Admins.
 */
import type { GateStatus, ReleaseGatesReport } from "@otsi-vie/contracts";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { api, ApiProblem } from "@/lib/api";

const ACCURACY_GATE_IDS = ["G05", "G06", "G07"] as const;

type AccuracyGateId = (typeof ACCURACY_GATE_IDS)[number];

const GATE_COPY: Record<AccuracyGateId, { name: "releaseGateG05Name" | "releaseGateG06Name" | "releaseGateG07Name"; proves: "releaseGateG05Proves" | "releaseGateG06Proves" | "releaseGateG07Proves" }> = {
  G05: { name: "releaseGateG05Name", proves: "releaseGateG05Proves" },
  G06: { name: "releaseGateG06Name", proves: "releaseGateG06Proves" },
  G07: { name: "releaseGateG07Name", proves: "releaseGateG07Proves" },
};

export function ReleaseControl() {
  const { organization } = useAuth();
  const { t } = useLocale();
  const myRole = organization?.role;
  const isAuthorized = myRole === "OWNER" || myRole === "ADMIN";

  const [report, setReport] = useState<ReleaseGatesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!isAuthorized) return;
    setLoading(true);
    setError(null);
    try {
      const rep = await api<ReleaseGatesReport>("/v1/admin/release-gates");
      setReport(rep);
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

  const gates = ACCURACY_GATE_IDS.map((id) => {
    const record = report?.gates.find((g) => g.id === id);
    const raw = (record?.status ?? "NOT_STARTED") as GateStatus;
    // SOT: a gate nothing has ever measured is "Not started" — the server still reports MEASURING for G05–G07 with
    // last_verified_at null (no benchmark has run), which is what the screen contradicted itself over
    const status = raw === "MEASURING" && !record?.last_verified_at ? "NOT_STARTED" : raw;
    return { id, status };
  });
  const passedCount = gates.filter((g) => g.status === "PASSED").length;
  const accuracyMeasured = report?.accuracy_measured ?? false;

  const statusLabel = (status: GateStatus) => {
    switch (status) {
      case "NOT_STARTED":
        return t.body.admin.releaseStatusNotStarted;
      case "MEASURING":
        return t.body.admin.releaseStatusMeasuring;
      case "PASSED":
        return t.body.admin.releaseStatusPassed;
      case "FAILED":
        return t.body.admin.releaseStatusFailed;
      case "WAIVED":
        return t.body.admin.releaseStatusWaived;
    }
  };

  /** the SOT's plain dot text: an open circle for not-started / waived, a filled dot otherwise, coloured by state. */
  const statusTone = (status: GateStatus) => status === "PASSED" ? "text-ok"
    : status === "MEASURING" ? "text-amber" : status === "FAILED" ? "text-danger" : "text-muted";
  const statusDot = (status: GateStatus) => status === "NOT_STARTED" || status === "WAIVED"
    ? <span className="h-[5px] w-[5px] shrink-0 rounded-full border border-current" aria-hidden="true" />
    : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />;

  const nextStepParts = t.body.admin.releaseNextStep.split("{a}");

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-[18px]" data-testid="admin-release-control">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="t-th">{t.body.shell.adminConsole}</span>
          <h1 className="t-page">{t.body.admin.releaseTitle}</h1>
          <span className="t-body text-muted">{t.body.admin.releaseSubtitle}</span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-ctl border border-danger/40 bg-danger/10 p-3 t-body text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* SOT: open sections — a hairline top rule only, no boxed card */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1 border-t border-line px-4 py-3">
          <span className="t-label">{t.body.admin.releaseAccuracy}</span>
          <span className={`t-section leading-7 ${accuracyMeasured ? "text-primary" : "text-amber"}`}>
            {loading ? "—" : accuracyMeasured ? t.body.admin.releaseAccuracyMeasured : t.body.admin.modelsNotMeasured}
          </span>
        </div>
        <div className="flex flex-col gap-1 border-t border-line px-4 py-3">
          <span className="t-label">{t.body.admin.releaseGatesPassed}</span>
          <span className="t-section leading-7">
            {loading
              ? "—"
              : t.body.admin.releaseGatesPassedValue.replace("{a}", String(passedCount)).replace("{b}", String(gates.length))}
          </span>
        </div>
        <div className="flex flex-col gap-1 border-t border-line px-4 py-3">
          <span className="t-label">{t.body.admin.releaseUntilTheyPass}</span>
          <span className="t-body text-muted">{t.body.admin.releaseUntilNote}</span>
        </div>
      </div>

      <section className="flex flex-col border-t border-line" aria-labelledby="accuracy-gates">
        <div className="vie-ph">
          <h2 id="accuracy-gates" className="t-section">{t.body.admin.releaseGatesTitle}</h2>
          <span className="t-small text-muted">{t.body.admin.releaseGatesSource}</span>
        </div>
        <div className="flex min-h-[34px] items-center gap-3 px-4 t-small text-muted">
          <span className="w-[52px] shrink-0">{t.body.admin.releaseColGate}</span>
          <span className="w-[110px] shrink-0">{t.body.admin.releaseColName}</span>
          <span className="min-w-0 flex-1">{t.body.admin.releaseColProves}</span>
          <span className="w-[110px] shrink-0">{t.body.admin.releaseColStatus}</span>
        </div>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="divide-y divide-line/60">
            {gates.map((gate) => (
              <div key={gate.id} className="flex min-h-[52px] items-center gap-3 px-4 py-3">
                <span className="w-[52px] shrink-0 t-body">{gate.id}</span>
                <span className="w-[110px] shrink-0 font-normal t-body">{t.body.admin[GATE_COPY[gate.id].name]}</span>
                <span className="min-w-0 flex-1 t-body text-muted">{t.body.admin[GATE_COPY[gate.id].proves]}</span>
                <span className="w-[110px] shrink-0">
                  <span className={`inline-flex items-center gap-1.5 t-body ${statusTone(gate.status)}`}>
                    {statusDot(gate.status)}{statusLabel(gate.status)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="px-4 py-2.5 t-small text-muted">
          {nextStepParts[0]}
          <Link href="/settings/admin/models" className="text-primary hover:underline">
            {t.body.admin.navModelsAi}
          </Link>
          {nextStepParts[1] ?? ""}
        </p>
      </section>
    </main>
  );
}
