"use client";

import React, { useState } from "react";
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
  const [selectedCategory, setSelectedCategory] = useState<GateCategory | "ALL">("ALL");

  if (!report) {
    return (
      <div className="rounded-card border border-line bg-panel p-6 text-center text-muted">
        Loading release gates status...
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
      <div className="rounded-card border border-line bg-panel p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-primary/20 px-2.5 py-0.5 text-xs font-semibold text-primary uppercase tracking-wide">
                Master Release Policy
              </span>
              <span className="text-xs text-muted">
                Last evaluated: {new Date(report.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">
              Release Gates (G01–G15) Status
            </h2>
            <p className="mt-1 text-sm text-muted">
              Non-negotiable acceptance criteria from 09_RELEASE_AND_TEST_MATRIX.md. AI evaluation gates (G05–G08) display
              &ldquo;accuracy not yet measured&rdquo; until ground-truth benchmark passes.
            </p>
          </div>

          <div className="flex flex-col items-end gap-1.5 min-w-[200px]">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white">{passedCount}</span>
              <span className="text-sm font-medium text-muted">/ {totalCount} Gates Passed</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-muted">{progressPercent}% Production Acceptance</span>
          </div>
        </div>

        {/* Accuracy Gate Alert Callout */}
        {!report.accuracy_measured && (
          <div className="mt-5 flex items-start gap-3 rounded-ctl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-200">Evaluation Gates G05–G08 In Progress:</span> Accuracy
              banners remain active across all video analysis screens in accordance with the &ldquo;unknown beats wrong&rdquo; truth
              policy. Evaluation evidence must be recorded on licensed holdouts before marking passed.
            </div>
          </div>
        )}
      </div>

      {/* Category Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedCategory("ALL")}
          className={`rounded-ctl px-3 py-1.5 text-xs font-semibold transition ${
            selectedCategory === "ALL"
              ? "bg-primary text-white"
              : "border border-line bg-panel text-muted hover:text-white"
          }`}
        >
          All Gates ({report.gates.length})
        </button>
        {(["INFRASTRUCTURE", "SECURITY", "MEDIA", "AI_ACCURACY", "GOVERNANCE"] as GateCategory[]).map((cat) => {
          const count = report.gates.filter((g) => g.category === cat).length;
          const Icon = CATEGORY_ICONS[cat];
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`flex items-center gap-1.5 rounded-ctl px-3 py-1.5 text-xs font-semibold transition ${
                selectedCategory === cat
                  ? "bg-primary text-white"
                  : "border border-line bg-panel text-muted hover:text-white"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{cat.replace("_", " ")}</span>
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
              className={`flex flex-col justify-between rounded-card border bg-panel p-5 transition-shadow hover:shadow-md ${
                isPassed
                  ? "border-emerald-500/20 bg-emerald-500/[0.02]"
                  : isMeasuring
                  ? "border-amber-500/20 bg-amber-500/[0.02]"
                  : "border-line"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-white bg-line/50 px-2 py-0.5 rounded">
                      {gate.id}
                    </span>
                    <h3 className="text-base font-semibold text-white">{gate.name}</h3>
                  </div>

                  {isPassed ? (
                    <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      PASSED
                    </span>
                  ) : isMeasuring ? (
                    <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
                      <Clock className="h-3.5 w-3.5" />
                      MEASURING
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full border border-line bg-line/20 px-2.5 py-0.5 text-xs font-semibold text-muted">
                      {gate.status}
                    </span>
                  )}
                </div>

                <div className="mt-3 text-xs text-slate-300">
                  <p>{gate.what}</p>
                </div>

                <div className="mt-4 space-y-2 border-t border-line/60 pt-3 text-xs">
                  <div>
                    <span className="font-medium text-muted">Evidence Required: </span>
                    <span className="text-slate-200">{gate.evidence_required}</span>
                  </div>
                  <div>
                    <span className="font-medium text-muted">Release Rule: </span>
                    <span className="text-slate-200">{gate.release_rule}</span>
                  </div>
                  {gate.evidence_reference && (
                    <div>
                      <span className="font-medium text-muted">Evidence Ref: </span>
                      <span className="font-mono text-cyan-400">{gate.evidence_reference}</span>
                    </div>
                  )}
                </div>
              </div>

              {gate.notes && (
                <div className="mt-4 rounded border border-line/40 bg-surface/50 p-2 text-2xs text-muted">
                  <span className="font-semibold text-slate-400">Note: </span>
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
