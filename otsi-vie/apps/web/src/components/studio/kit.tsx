/** Page 07 Clip Studio: the reference's buttons, input boxes (.in) and chips (.ch) in design coordinates. */
import type { CSSProperties, ReactNode } from "react";
import { stageStyles as s, u } from "@/components/stage/DesignStage";
import { notBuilt } from "@/lib/devMode";

const bc = (c: string) => ({ ["--bc" as string]: c }) as CSSProperties;
/** the reference's input box (.in); the border is drawn by the stage's frame overlay */
export const IN: CSSProperties = { background: "#041022", borderRadius: u(8), ...bc("#17406f") };
/** the reference's chip (.ch) */
export const CH: CSSProperties = { background: "#0a2447", borderRadius: u(6), ...bc("#1d4f8a") };
export const frame = bc;

/** a button whose children are placed in design coordinates from its outer corner; border drawn by the frame overlay (--bc).
 * Never disabled: `dim` only shows that it cannot act right now, and its click then explains why (no dead controls). */
export function Btn({ x, y, w, h, label, onClick, dim, title, style, children, pressed }: {
  x: number; y: number; w: number; h: number; label: string; onClick: () => void; dim?: boolean; title?: string; style?: CSSProperties;
  children?: ReactNode; pressed?: boolean;
}) {
  return (
    <button type="button" aria-label={label} title={title ?? label} onClick={onClick} aria-pressed={pressed} aria-disabled={dim || undefined}
      className={`${s.a} ${s.framed}`}
      style={{ left: u(x), top: u(y - 101), width: u(w), height: u(h), padding: 0, color: "inherit", font: "inherit", border: 0,
        cursor: "pointer", opacity: dim ? 0.6 : 1, background: "transparent", ...bc("transparent"), ...style }}>
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
