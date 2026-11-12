"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  // Spec §4: one primary per screen; height 40px, radius 8px, 14px semibold.
  primary: "bg-primary text-ink hover:bg-primary/90",
  secondary: "border border-line bg-transparent text-ink hover:bg-raised",
  ghost: "bg-transparent text-primary hover:bg-raised",
  danger: "bg-danger text-ink hover:bg-danger/90",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Optional leading icon (a lucide icon sized h-4 w-4 by the caller). */
  icon?: ReactNode;
}

/** Spec §4 Button. Danger is for destructive actions only, always with a confirmation dialog. */
export function Button({ variant = "primary", icon, className, type = "button", children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex h-10 items-center justify-center gap-2 rounded-ctl px-4 text-button transition-colors duration-150 ease-in-out disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
