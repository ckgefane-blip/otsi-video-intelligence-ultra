"use client";

import React, { useState } from "react";
import { useLocale } from "@/lib/i18n";
import type { ReleaseGatesReport, GateCategory, ReleaseGateRecord } from "@otsi-vie/contracts";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  Layers,
  Database,
  Lock,
  Film,
  Brain,
  Scale,
} from "lucide-react";

interface ReleaseGatesViewProps {
  report: ReleaseGatesReport | null;
}

const CATEGORY_ICONS: Record<GateCategory, React.ComponentType<{ className?: string }>> = {
  INFRASTRUCTURE: Database,
  SECURITY: Lock,
  MEDIA: Film,
  AI_ACCURACY: Brain,
  GOVERNANCE: Scale,
};

export function ReleaseGatesView({ report }: ReleaseGatesViewProps) {
  const { t } = useLocale();
  const [selectedCategory, setSelectedCategory] = useState<GateCategory | "ALL">("ALL");

  if (!report) {
    return (
      <div className="vie-panel p-4 text-center text-muted">
        {t.body.admin.gatesLoading}
      </div>
    );
  }

  const filteredGates = report.gates.filter(
    (g) => selectedCategory === "ALL" || g.category === selectedCategory
  );

  const passedCount = report.passed_count;
  const totalCount = report.total_count;
  const progressPercent = Math.round((passedCount / totalCount) * 100);

  return (
    <div className="space-y-6">
      {/* Top Banner / Hero */}
      <div className="vie-panel p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-primary/20 px-2.5 py-0.5 text-xs font-normal text-primary uppercase tracking-wide">
                {t.body.admin.gatesPolicy}
              </span>
              <span className="text-xs text-muted">
                {t.body.admin.gatesLastEvaluated.replace("{a}", new Date(report.timestamp).toLocaleTimeString())}
              </span>
            </div>
            <h2 className="mt-2 t-page">
              {t.body.admin.gatesTitle}
            </h2>
            <p className="mt-1 t-small">
              {t.body.admin.gatesSubtitle}
            </p>
          </div>

          <div className="flex flex-col items-end gap-1.5 min-w-[200px]">
            <div className="flex items-baseline gap-2">
              <span className="t-metric">{passedCount}</span>
              <span className="t-small">{t.body.admin.gatesPassedCount.replace("{a}", String(totalCount))}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-ok transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-muted">{t.body.admin.gatesAcceptance.replace("{a}", String(progressPercent))}</span>
          </div>
        </div>

        {/* Accuracy Gate Alert Callout */}
        {!report.accuracy_measured && (
          <div className="mt-5 flex items-start gap-3 rounded-ctl border border-amber/20 bg-amber/10 p-4 text-xs text-amber">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber mt-0.5" />
            <div>
              <span className="font-normal text-amber">{t.body.admin.gatesInProgress}</span> {t.body.admin.gatesInProgressBody}
            </div>
          </div>
        )}
      </div>

      {/* Category Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedCategory("ALL")}
          className={`rounded-ctl px-3 py-1.5 text-xs font-normal transition ${
            selectedCategory === "ALL"
              ? "bg-primary"
              : "border border-line bg-panel text-muted hover:text-ink"
          }`}
        >
          {t.body.admin.gatesAll.replace("{a}", String(report.gates.length))}
        </button>
        {(["INFRASTRUCTURE", "SECURITY", "MEDIA", "AI_ACCURACY", "GOVERNANCE"] as GateCategory[]).map((cat) => {
          const count = report.gates.filter((g) => g.category === cat).length;
          const Icon = CATEGORY_ICONS[cat];
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`flex items-center gap-1.5 rounded-ctl px-3 py-1.5 text-xs font-normal transition ${
                selectedCategory === cat
                  ? "bg-primary"
                  : "border border-line bg-panel text-muted hover:text-ink"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{({ INFRASTRUCTURE: t.body.admin.gatesCatInfrastructure, SECURITY: t.body.admin.gatesCatSecurity, MEDIA: t.body.admin.gatesCatMedia, AI_ACCURACY: t.body.admin.gatesCatAiAccuracy, GOVERNANCE: t.body.admin.gatesCatGovernance } as Record<GateCategory, string>)[cat]}</span>
              <span className="opacity-75">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Gates Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {filteredGates.map((gate) => {
          const Icon = CATEGORY_ICONS[gate.category];
          const isPassed = gate.status === "PASSED";
          const isMeasuring = gate.status === "MEASURING";

          return (
            <div
              key={gate.id}
              className={`flex flex-col justify-between vie-panel p-4 ${
                isPassed
                  ? "border-ok/20 bg-ok/[0.02]"
                  : isMeasuring
                  ? "border-amber/20 bg-amber/[0.02]"
                  : "border-line"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="t-tc text-ink bg-line/50 px-2 py-0.5 rounded">
                      {gate.id}
                    </span>
                    <h3 className="t-panel text-ink">{gate.name}</h3>
                  </div>

                  {isPassed ? (
                    <span className="flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2.5 py-0.5 text-xs font-normal text-ok">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t.body.admin.gatePassed}
                    </span>
                  ) : isMeasuring ? (
                    <span className="flex items-center gap-1 rounded-full border border-amber/30 bg-amber/10 px-2.5 py-0.5 text-xs font-normal text-amber">
                      <Clock className="h-3.5 w-3.5" />
                      {t.body.admin.gateMeasuring}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full border border-line bg-line/20 px-2.5 py-0.5 text-xs font-normal text-muted">
                      {gate.status}
                    </span>
                  )}
                </div>

                <div className="mt-3 text-xs text-ink2">
                  <p>{gate.what}</p>
                </div>

                <div className="mt-4 space-y-2 border-t border-line/60 pt-3 text-xs">
                  <div>
                    <span className="font-normal text-muted">{t.body.admin.gateEvidence}</span>
                    <span className="text-ink2">{gate.evidence_required}</span>
                  </div>
                  <div>
                    <span className="font-normal text-muted">{t.body.admin.gateRule}</span>
                    <span className="text-ink2">{gate.release_rule}</span>
                  </div>
                  {gate.evidence_reference && (
                    <div>
                      <span className="font-normal text-muted">{t.body.admin.gateRef}</span>
                      <span className="font-mono text-cyan">{gate.evidence_reference}</span>
                    </div>
                  )}
                </div>
              </div>

              {gate.notes && (
                <div className="mt-4 rounded border border-line/40 bg-raised p-2 text-xs text-muted">
                  <span className="font-normal text-muted">{t.body.admin.gateNote}</span>
                  {gate.notes}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
