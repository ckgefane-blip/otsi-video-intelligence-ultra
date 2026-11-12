"use client";

import type { ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";

export interface EmptyStateProps {
  /** 48px muted icon (a lucide icon with className "h-12 w-12"). */
  icon: ReactNode;
  title: string;
  /** One line naming the exact next action. */
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  className?: string;
}

/**
 * Spec §4 EmptyState: centred 48px muted icon, 16px semibold title, 13px
 * muted explanation naming the exact next action, and the primary button
 * that does it. Never a blank panel. Never a zero where nothing was
 * measured — a real measured zero is shown as 0, because it is data.
 */
export function EmptyState({ icon, title, description, actionLabel, actionHref, onAction, className }: EmptyStateProps) {
  const handleAction = onAction ?? (actionHref ? () => { window.location.href = actionHref; } : undefined);
  return (
    <div className={cx("flex flex-col items-center px-4 py-8 text-center", className)}>
      <span className="mb-3 text-muted" aria-hidden>{icon}</span>
      <h3 className="text-panel-title text-ink">{title}</h3>
      <p className="mt-1 max-w-md text-body-small text-muted">{description}</p>
      {actionLabel && handleAction && (
        <Button className="mt-4" onClick={handleAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
