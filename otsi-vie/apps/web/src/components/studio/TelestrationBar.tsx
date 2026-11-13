"use client";
/**
 * Page 07 Clip Studio — the telestration tool bar (SOT, Studio.dc.html).
 *
 * Draws on the open footage: Select (no tool), Arrow, Circle, Line, Freehand, Spotlight and Text are all working tools
 * (DrawKind, contracts look.ts). Freehand draws a polyline, Spotlight dims everything outside the dragged circle, Text
 * places a text annotation — all saved on the clip like the other drawings. The colour is the accent and the width 2 px,
 * as the SOT shows. The tool lives in useStudio (st.drawTool); the Preview's draw surface does the dragging.
 */
import type { ReactElement } from "react";
import type { DrawKind } from "@otsi-vie/contracts";
import { useLocale } from "@/lib/i18n";
import type { Ui } from "./kit";
import type { Studio } from "./useStudio";

const ICONS: Record<string, ReactElement> = {
  select: <path d="M5 3l14 8-6 2-2 6z" />,
  arrow: <path d="M5 19L19 5M10 5h9v9" />,
  circle: <ellipse cx="12" cy="12" rx="8" ry="5" />,
  line: <path d="M4 18L20 6" />,
  freehand: <path d="M3 17c3-6 6 2 9-4s5-2 9-6" />,
  spotlight: <><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="8.5" strokeDasharray="2 2.5" /></>,
  text: <path d="M5 6h14M12 6v13" />,
};

export function TelestrationBar({ st, ui }: { st: Studio; ui: Ui }) {
  const { t: dict } = useLocale();
  const s = dict.body.studio;
  const tools: [string, string, DrawKind | null][] = [
    ["select", s.csToolSelect, null],
    ["arrow", s.csToolArrow, "ARROW"],
    ["circle", s.csToolCircle, "CIRCLE"],
    ["line", s.csToolLine, "LINE"],
    ["freehand", s.csToolFreehand, "FREEHAND"],
    ["spotlight", s.spotlightLabel, "SPOTLIGHT"],
    ["text", s.csToolText, "TEXT"],
  ];
  const active = st.drawTool;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="seg" role="group" aria-label={s.csDrawsOnFootage}>
        {tools.map(([key, label, kind]) => {
          const on = key === "select" ? !active : active === kind;
          return (
            <button key={key} type="button" aria-label={label} aria-pressed={on} title={label}
              className={on ? "on" : ""}
              onClick={() => st.setDrawTool(kind === active ? null : kind)}>
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[key]}
              </svg>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="t-small text-muted">{s.csDrawsOnFootage}</span>
        {/* "Accent / 2 px" is plain text (SOT §B), not chips — the colour swatch stays */}
        <span className="t-small inline-flex items-center gap-1.5" style={{ color: "rgb(var(--ink))" }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: "rgb(var(--primary))" }} />
          {s.csAccent}
        </span>
        <span className="t-small">2 px</span>
      </div>
    </div>
  );
}
