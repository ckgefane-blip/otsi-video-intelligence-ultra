"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

export interface StatCardProps {
  /** Icon rendered in the 40px raised square (a lucide icon, h-5 w-5). */
  icon: ReactNode;
  /** Big number — always with its unit/source, never a bare number (spec §2). */
  value: string;
  label: string;
  /** Destination the whole card links to. Without one the card is static. */
  href?: string;
  onClick?: () => void;
  className?: string;
}

/** Spec §4 StatCard: 40px raised icon square, 28px semibold tabular metric, 13px muted label, chevron. */
export function StatCard({ icon, value, label, href, onClick, className }: StatCardProps) {
  const inner = (
    <>
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-ctl bg-raised text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-metric tabular-nums text-ink">{value}</span>
        <span className="block truncate text-body-small text-muted">{label}</span>
      </span>
      {(href || onClick) && <ChevronRight className="h-5 w-5 flex-none text-muted" aria-hidden />}
    </>
  );
  const cls = cx(
    "flex items-center gap-3 rounded-card border border-line bg-panel p-4 transition-colors duration-150 ease-in-out",
    (href || onClick) && "hover:bg-raised/60",
    className,
  );
  if (href) return <a href={href} className={cls}>{inner}</a>;
  if (onClick) return <button type="button" onClick={onClick} className={cx(cls, "w-full text-left")}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}
