"use client";

import { cx } from "./cx";

export interface SkeletonProps {
  className?: string;
  label?: string;
}

/**
 * Spec §4 Skeleton: raised shimmer blocks in the shape of the content while
 * loading. No spinners on full pages. The global prefers-reduced-motion rule
 * in globals.css disables the pulse animation where requested.
 */
export function Skeleton({ className, label = "Loading" }: SkeletonProps) {
  return <div aria-hidden className={cx("animate-pulse rounded-ctl bg-raised", className)} role="presentation" data-loading={label} />;
}

/** A text-line shaped skeleton. */
export function SkeletonText({ className }: { className?: string }) {
  return <Skeleton className={cx("h-4 w-full", className)} label="Loading text" />;
}

/** A panel-shaped skeleton. */
export function SkeletonPanel({ className }: { className?: string }) {
  return <Skeleton className={cx("h-32 w-full rounded-card", className)} label="Loading panel" />;
}
