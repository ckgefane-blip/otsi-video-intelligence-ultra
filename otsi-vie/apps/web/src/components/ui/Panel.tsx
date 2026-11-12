"use client";

import type { ReactNode } from "react";
import { cx } from "./cx";

export interface PanelProps {
  title?: string;
  /** Optional "View all" link at the top right. */
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  children: ReactNode;
  className?: string;
}

/** Spec §4 Panel: panel bg, 1px line border, 12px radius, 16px padding, 16px semibold title. */
export function Panel({ title, actionLabel, actionHref, onAction, children, className }: PanelProps) {
  return (
    <section className={cx("rounded-card border border-line bg-panel p-4", className)}>
      {title && (
        <header className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-panel-title text-ink">{title}</h2>
          {actionLabel && (actionHref || onAction) && (
            <a
              href={actionHref}
              onClick={onAction ? (e) => { e.preventDefault(); onAction(); } : undefined}
              className="shrink-0 text-body-small text-primary hover:underline"
            >
              {actionLabel}
            </a>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
