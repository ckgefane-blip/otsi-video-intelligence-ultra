"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { cx } from "./cx";

export type ToastTone = "info" | "success" | "error";

const TONES: Record<ToastTone, string> = {
  info: "text-primary",
  success: "text-ok",
  error: "text-danger",
};

export interface ToastProps {
  title: string;
  message: string;
  tone?: ToastTone;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  onClose: () => void;
  /** Auto-dismiss delay in ms (spec §4: 6s). Pass 0 to disable. */
  dismissMs?: number;
  className?: string;
}

/** Spec §4 Toast: bottom right, raised with 1px line, title + one line, auto-dismiss 6s, action link where useful. */
export function Toast({ title, message, tone = "info", actionLabel, actionHref, onAction, onClose, dismissMs = 6000, className }: ToastProps) {
  useEffect(() => {
    if (!dismissMs) return;
    const t = setTimeout(onClose, dismissMs);
    return () => clearTimeout(t);
  }, [dismissMs, onClose]);

  return (
    <div role="status" className={cx("fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-2rem))] rounded-card border border-line bg-raised p-4 shadow-2xl", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className={cx("text-body font-semibold", TONES[tone])}>{title}</p>
        <button type="button" onClick={onClose} aria-label="Dismiss notification" className="flex-none rounded-ctl p-1 text-muted hover:bg-panel">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-body-small text-muted">{message}</p>
      {actionLabel && (actionHref || onAction) && (
        <a
          href={actionHref}
          onClick={onAction ? (e) => { e.preventDefault(); onAction(); } : undefined}
          className="mt-2 inline-block text-body-small font-semibold text-primary hover:underline"
        >
          {actionLabel}
        </a>
      )}
    </div>
  );
}
