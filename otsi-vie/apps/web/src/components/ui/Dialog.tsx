"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";

export interface DialogAction {
  label: string;
  onClick: () => void;
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Primary action (rightmost). */
  primaryAction: DialogAction;
  /** Button variant for the primary action — "danger" for destructive confirms. */
  primaryVariant?: ButtonVariant;
  /** Secondary action. Defaults to a Close button. */
  secondaryAction?: DialogAction;
}

/**
 * Spec §4 Dialog: centred, panel, 12px radius, 16px semibold title,
 * primary + secondary actions. Radix supplies Esc-to-close and the focus
 * trap; the pattern matches the existing export-stage dialogs.
 */
export function Dialog({ open, onOpenChange, title, description, children, primaryAction, primaryVariant = "primary", secondaryAction }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-6 shadow-2xl">
          <DialogPrimitive.Title className="text-panel-title text-ink">{title}</DialogPrimitive.Title>
          {description && <DialogPrimitive.Description className="mt-1 text-body-small text-muted">{description}</DialogPrimitive.Description>}
          {children && <div className="mt-4 text-body text-ink">{children}</div>}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={secondaryAction ? secondaryAction.onClick : () => onOpenChange(false)}
            >
              {secondaryAction ? secondaryAction.label : "Close"}
            </Button>
            <Button
              variant={primaryVariant}
              onClick={() => { primaryAction.onClick(); }}
            >
              {primaryAction.label}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
