/** Page 07 Clip Studio: the reference's buttons, input boxes (.in) and chips (.ch), in flow layout. */
import type { CSSProperties, ReactNode } from "react";
import { notBuilt } from "@/lib/devMode";

const bc = (c: string) => ({ ["--bc" as string]: c }) as CSSProperties;
/** the reference's input box (.in) */
export const IN: CSSProperties = { background: "#041022", borderRadius: 8, border: "1px solid #17406f" };
/** the reference's chip (.ch) */
export const CH: CSSProperties = { background: "#0a2447", borderRadius: 6, border: "1px solid #1d4f8a" };
export const frame = bc;

/** a flow button. Never disabled: `dim` only shows that it cannot act right now, and its click then explains why (no dead controls). */
export function Btn({ label, onClick, dim, title, style, children, pressed, className }: {
  label: string; onClick: () => void; dim?: boolean; title?: string; style?: CSSProperties;
  children?: ReactNode; pressed?: boolean; className?: string;
}) {
  return (
    <button type="button" aria-label={label} title={title ?? label} onClick={onClick} aria-pressed={pressed} aria-disabled={dim || undefined}
      className={`vie-btn ${pressed ? "border-primary text-primary" : ""} ${className ?? ""}`}
      style={{ opacity: dim ? 0.6 : 1, ...style }}>
      {children}
    </button>
  );
}

/** what every studio control can do when it cannot act: say why (status line), or open the reel chooser */
export interface Ui { say: (text: string) => void; pick: () => void }

export const NOT_BUILT = notBuilt();

/** mm:ss.cc as the reference writes timecodes */
export function tc(t: number) {
  const sec = Math.max(0, t) / 1e6;
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${(sec % 60).toFixed(2).padStart(5, "0")}`;
}
