"use client";
/**
 * The flow-layout controls of the Export and Library pages (Desktop UI, Drop 2). They replace the 2560-px stage helpers (B, T, Ic, P, Hit,
 * Sel, Switch) with ordinary elements on the Desktop tokens. One rule for every control: it either works (onClick / onChange given) or it
 * says why not — `reason` is its tooltip and, where `showReason`, a visible line — and it is never drawn as if it worked.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ title, actions, children, className = "", bodyClass = "", focus = false, ...rest }: {
  title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; focus?: boolean;
} & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  return (
    <section {...rest} className={`vie-panel min-w-0 ${focus ? "!border-primary" : ""} ${className}`}>
      <div className="vie-ph">
        <h2 className="t-panel truncate">{title}</h2>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

type ActProps = { label: string; onClick?: (() => void) | undefined; reason?: string | undefined; pressed?: boolean | undefined; children?: ReactNode;
  className?: string; showReason?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children">;

/** a button that works, or says why it cannot (aria-disabled, its reason as tooltip, optionally shown under it) */
export function Act({ label, onClick, reason, pressed, children, className = "vie-btn", showReason = false, ...rest }: ActProps) {
  const off = !onClick;
  const btn = (
    <button type="button" aria-label={label} aria-pressed={pressed} aria-disabled={off || undefined} title={off ? reason : rest.title}
      onClick={off ? undefined : onClick} className={`${className} ${off ? "cursor-not-allowed opacity-50" : ""}`} {...rest}>
      {children ?? label}
    </button>
  );
  if (!(off && showReason && reason)) return btn;
  return <span className="inline-flex flex-col items-start gap-0.5">{btn}<span className="t-small text-muted">{reason}</span></span>;
}

/** a labelled on/off switch row that works, or is shown off with its reason */
export function Toggle({ label, on, onClick, reason, hint, icon }: {
  label: string; on: boolean; onClick?: (() => void) | undefined; reason?: string | undefined; hint?: string | undefined; icon?: ReactNode;
}) {
  const off = !onClick;
  return (
    <div className="flex min-h-8 items-center justify-between gap-3" title={off ? reason : hint}>
      <span className={`flex min-w-0 items-center gap-2 t-body ${off ? "text-muted" : ""}`}>{icon}<span className="truncate">{label}</span></span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} aria-pressed={on} aria-disabled={off || undefined}
        className={`vie-sw ${off ? "cursor-not-allowed opacity-50" : ""}`} onClick={off ? undefined : onClick} />
    </div>
  );
}

export const fieldCls = "h-8 rounded-md border border-line2 bg-p0 px-2 t-body text-ink disabled:opacity-50";

export function Field({ label, children, className = "" }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="t-label text-muted">{label}</span>
      {children}
    </label>
  );
}
