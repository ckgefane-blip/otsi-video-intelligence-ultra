"use client";

import { Activity, Check, Crosshair, Minus } from "lucide-react";
import { cx } from "./cx";

/** Spec §5 evidence kinds. Badges go on DATA only — never on jobs (see JobStatus). */
export type EvidenceKind = "confirmed" | "detected" | "inferred" | "not-measured";

const KINDS: Record<EvidenceKind, { label: string; classes: string; Icon: typeof Check }> = {
  confirmed: { label: "Confirmed", classes: "border-ok/40 bg-ok/10 text-ok", Icon: Check },
  detected: { label: "Detected", classes: "border-primary/40 bg-primary/10 text-primary", Icon: Crosshair },
  inferred: { label: "Inferred", classes: "border-amber/40 bg-amber/10 text-amber", Icon: Activity },
  "not-measured": { label: "Not measured", classes: "border-line bg-raised text-muted", Icon: Minus },
};

export interface TrustBadgeProps {
  kind: EvidenceKind;
  /** Overrides the default label (e.g. a shorter form). The meaning must not change. */
  label?: string;
  className?: string;
}

/** Spec §4/§5 TrustBadge: pill, 12px semibold, icon + label. */
export function TrustBadge({ kind, label, className }: TrustBadgeProps) {
  const { label: defaultLabel, classes, Icon } = KINDS[kind];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-label font-semibold", classes, className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {label ?? defaultLabel}
    </span>
  );
}
