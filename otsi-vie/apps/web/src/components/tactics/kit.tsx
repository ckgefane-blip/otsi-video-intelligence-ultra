/**
 * Page 05 Tactical Intelligence: the reference's own drawing pieces (box, panel heading with info mark, pitch, select, toggle,
 * check square, "Not measured" chip), placed in design coordinates on the shared stage.
 */
import { useEffect, useState, type ReactNode } from "react";
import { B, Ic, T, u } from "@/components/stage/DesignStage";

export const box = (border = "#12335f") => ({ border: `${u(1.5)} solid ${border}`, borderRadius: u(10), background: "linear-gradient(180deg,#081a35,#06122a)" });

export function Box({ x, y, w, h, border, noTop }: { x: number; y: number; w: number; h: number; border?: string; noTop?: boolean }) {
  return <B x={x} y={y} w={w} h={h} style={{ ...box(border), ...(noTop ? { borderTop: "none" } : {}) }} />;
}

/** panel heading: blue bar, bold title, and (when `info` is given) the reference's circled "i" that explains what the panel shows */
export function Head({ x, y, title, info }: { x: number; y: number; title: string; info?: string }) {
  return (
    <>
      <B x={x + 8} y={y - 14} w={6} h={28} style={{ background: "#1e90ff", borderRadius: u(3) }} />
      <T x={x + 24} y={y} size={25} weight={700} as="h2">
        {title}
        {info && " "}
        {info && (
          <span tabIndex={0} role="note" aria-label={info} title={info} style={{ color: "#8ea3bf", fontWeight: 400, fontSize: u(18),
            border: `${u(1.5)} solid #6a84aa`, borderRadius: "50%", padding: `0 ${u(6)}`, cursor: "help" }}>i</span>
        )}
      </T>
    </>
  );
}

export function Pitch({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const line = "#cfe8d6aa";
  return (
    <div aria-hidden>
      <B x={x} y={y} w={w} h={h} style={{ background: "linear-gradient(90deg,#1c6a30,#26793a 50%,#1c6a30)", border: `${u(2)} solid #cfe8d6` }} />
      <B x={x + w / 2} y={y} w={2} h={h} style={{ background: line }} />
      <B x={x + w / 2 - 40} y={y + h / 2 - 40} w={80} h={80} style={{ border: `${u(2)} solid ${line}`, borderRadius: "50%" }} />
      <B x={x} y={y + h / 2 - 50} w={w * 0.1} h={100} style={{ border: `${u(2)} solid ${line}` }} />
      <B x={x + w * 0.9} y={y + h / 2 - 50} w={w * 0.1} h={100} style={{ border: `${u(2)} solid ${line}` }} />
    </div>
  );
}

/** "Not measured" on a pitch, as the reference draws it */
export const NotMeasured = ({ x, y, size = 22, children = "Not measured" }: { x: number; y: number; size?: number; children?: ReactNode }) => (
  // the reference sets the text's top at y - size/2 and then pads it, so the chip's centre sits 4 px below y
  <T x={x} y={y + 4} size={size} color="#e6f3ea" align="center" style={{ background: "rgba(7,20,42,.78)", padding: `${u(4)} ${u(12)}`, borderRadius: u(6), lineHeight: 1 }}>{children}</T>
);

/** one option of a selector: value, label, and — when it cannot be chosen yet — the reason (shown greyed in the list) */
export type Opt<V extends string> = [V, string] | [V, string, string];

/**
 * The reference's select (.sel) over a real native select. It always opens: choosable options work, options without data are listed
 * greyed with their reason ("not measured yet"). Without `onChange` the choice is still remembered here (a view choice of this panel).
 */
export function Sel<V extends string>({ x, y, w, h, label, value, options, onChange, style, pad = 14 }: {
  x: number; y: number; w: number; h: number; label: string; value: V; options: Opt<V>[]; onChange?: (v: V) => void; reason?: string;
  style?: React.CSSProperties; pad?: number;
}) {
  const [local, setLocal] = useState<V>(value);
  useEffect(() => { setLocal(value); }, [value]);
  const current = onChange ? value : local;
  return (
    <div className="absolute" style={{ left: u(x), top: u(y - 101), width: u(w), height: u(h), boxSizing: "border-box",
      border: `${u(1.5)} solid #17355f`, borderRadius: u(6), background: "#0a1d38", color: "#dbe8f8", display: "flex", alignItems: "center",
      padding: `0 ${u(pad)}`, fontSize: u(19), ...style }}>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{options.find((o) => o[0] === current)?.[1] ?? ""}</span>
      <span style={{ marginLeft: "auto", fontSize: u(20) }}>⌄</span>
      <select aria-label={label} value={current} onChange={(e) => { const v = e.target.value as V; if (onChange) onChange(v); else setLocal(v); }}
        style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}>
        {options.map(([v, l, why]) => <option key={v} value={v} disabled={!!why}>{why ? `${l.trim()} — ${why}` : l.trim()}</option>)}
      </select>
    </div>
  );
}

/** the reference's toggle (.tr); `reason` when it cannot be switched (the feature is not built) */
export function Toggle({ x, y, on, label, onChange, reason }: { x: number; y: number; on: boolean; label: string; onChange?: (on: boolean) => void; reason?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={!onChange} title={!onChange ? reason : undefined}
      onClick={() => onChange?.(!on)} className="absolute"
      style={{ left: u(x), top: u(y - 101), width: u(46), height: u(26), borderRadius: u(13), border: 0, padding: 0,
        background: on ? "#1580ff" : "#1a2a44", cursor: onChange ? "pointer" : "not-allowed", opacity: onChange ? 1 : 0.55 }}>
      <i style={{ position: "absolute", top: u(3), ...(on ? { right: u(3) } : { left: u(3) }), width: u(20), height: u(20), borderRadius: "50%", background: "#fff" }} />
    </button>
  );
}

/** the overlay's own icon in the reference's 24 px icon slot (.ic): what the switch beside it shows, not a checkbox */
export const OverlayIcon = ({ x, y, k, on }: { x: number; y: number; k: string; on: boolean }) => (
  <Ic x={x + 12} y={y + 12} k={k} size={24} color={on ? "#33a8ff" : "#7fa4d4"} />
);
