"use client";
/**
 * Page 07 Clip Studio — the telestration tool bar (SOT, Studio.dc.html).
 *
 * Draws on the open footage: Select (no tool), Arrow, Circle, Line are the
 * engine's three drawing kinds (DrawKind); Freehand, Spotlight and Text
 * are in the SOT but not built in the engine, so they are shown dimmed and
 * say so when clicked (never a dead control). The colour is the accent and
 * the width 2 px, as the SOT shows. The tool lives in useStudio
 * (st.drawTool); the Preview's draw surface does the dragging.
 */
import type { ReactElement } from "react";
import type { DrawKind } from "@otsi-vie/contracts";
import { useLocale } from "@/lib/i18n";
import { NOT_BUILT, type Ui } from "./kit";
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
  const tools: [string, string, DrawKind | null, boolean][] = [
    ["select", s.csToolSelect, null, false],
    ["arrow", s.csToolArrow, "ARROW", false],
    ["circle", s.csToolCircle, "CIRCLE", false],
    ["line", s.csToolLine, "LINE", false],
    ["freehand", s.csToolFreehand, null, true],
    ["spotlight", s.spotlightLabel, null, true],
    ["text", s.csToolText, null, true],
  ];
  const active = st.drawTool;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="seg" role="group" aria-label={s.csDrawsOnFootage}>
        {tools.map(([key, label, kind, notBuilt]) => {
          const on = key === "select" ? !active : active === kind;
          return (
            <button key={key} type="button" aria-label={label} aria-pressed={on} title={notBuilt ? `${label} — ${s.csToolNotBuilt}` : label}
              className={on ? "on" : ""} style={notBuilt ? { opacity: 0.45 } : undefined}
              onClick={() => {
                if (notBuilt) return ui.say(`${label}: ${NOT_BUILT}`);
                st.setDrawTool(kind === active ? null : kind);
              }}>
              <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[key]}
              </svg>
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="t-small text-muted">{s.csDrawsOnFootage}</span>
        <span className="vie-chip" style={{ color: "rgb(var(--ink))" }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: "rgb(var(--primary))" }} />
          {s.csAccent}
        </span>
        <span className="vie-chip">2 px</span>
      </div>
    </div>
  );
}
