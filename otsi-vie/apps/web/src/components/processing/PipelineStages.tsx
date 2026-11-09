/**
 * Page 03 Section 03 — the pipeline ribbon (approved reference 03_AI_PROCESSING, "pipeline stages"; v3 Phase A.4, ADR-061).
 *
 * The ribbon is the engine's real steps for this video, in order: the run's Shot cuts, Detection, Tracking and Identity evidence (no
 * identity is assigned; a player is named only after a person confirms it), then Ball, Pitch, Team sheets and Football facts. Each shows
 * waiting, running, done, not run, failed, cancelled or out of date (done on an older analysis). A click on a step filters the log to it.
 */
import { B, T, u } from "@/components/stage/DesignStage";
import { pct, RIBBON_PILL, type RibbonStep } from "./model";

const X0 = 43, W = 1938, N = 8, CELL = W / N;

function Ring({ cx, s }: { cx: number; s: RibbonStep }) {
  const base = { borderRadius: "50%" };
  if (s.state === "DONE" || s.state === "STALE") {
    const c = s.state === "DONE" ? "#19e6c0" : "#ffc94d";
    return (
      <B x={cx - 28} y={312} w={56} h={56} style={{ ...base, border: `${u(4)} solid ${c}`, background: s.state === "DONE" ? "#0a3a3f" : "#3a2f10", boxShadow: `0 0 ${u(10)} ${c}`,
        color: c, fontSize: u(s.state === "DONE" ? 26 : 24), display: "flex", alignItems: "center", justifyContent: "center" }}>{s.state === "DONE" ? "✓" : "!"}</B>
    );
  }
  if (s.state === "ACTIVE") {
    return (
      <>
        <B x={cx - 28} y={312} w={56} h={56} style={{ ...base, background: `conic-gradient(#1a8cff ${s.progress ?? 0}%,#1a2a44 0)` }} />
        <B x={cx - 20} y={320} w={40} h={40} style={{ ...base, background: "#071a33" }} />
      </>
    );
  }
  const ring = s.state === "FAILED" ? "#7a2a35" : s.state === "SKIPPED" ? "#141f33" : "#1c2a40";
  return <B x={cx - 28} y={312} w={56} h={56} style={{ ...base, border: `${u(4)} ${s.state === "SKIPPED" ? "dashed" : "solid"} ${ring}`, background: "#0a1630" }} />;
}

export function PipelineStages({ steps, selected, onSelect }: { steps: RibbonStep[]; selected: string | null; onSelect: (key: string | null) => void }) {
  return (
    <section aria-label="Engine steps for this video" data-section="p03-s02">
      <B x={X0} y={293} w={W} h={230} style={{ border: `${u(1.5)} solid #12335f`, borderRadius: u(10), background: "linear-gradient(180deg,#081a35,#06122a)" }} />
      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {steps.map((s, i) => {
          const x = X0 + i * CELL, cx = x + CELL / 2, on = selected === s.key;
          return (
            <li key={s.key} data-stage-step={s.key} data-stage-state={s.state}>
              <button type="button" aria-pressed={on} onClick={() => onSelect(on ? null : s.key)}
                aria-label={`${i + 1}. ${s.title}: ${s.label}${s.progress !== null ? `, ${Math.round(s.progress)}%` : ""}. ${on ? "Show every step in the log" : "Show only this step in the log"}`}
                title={on ? "Showing only this step in the log; click again for all" : "Show only this step in the log"}
                className="absolute" style={{ left: u(x + 6), top: u(299 - 101), width: u(CELL - 12), height: u(218), padding: 0, cursor: "pointer", fontFamily: "inherit",
                  background: on ? "rgba(30,144,255,.10)" : "transparent", border: on ? `${u(1.5)} solid #1e6fb0` : `${u(1.5)} solid transparent`, borderRadius: u(8) }} />
              <div style={{ pointerEvents: "none" }}>
                <Ring cx={cx} s={s} />
                <T x={cx} y={392} size={20} weight={700} align="center" style={{ maxWidth: u(CELL - 16), whiteSpace: "nowrap" }}>{`${i + 1}. ${s.title}`}</T>
                <T x={cx} y={420} size={16} color="#b3c4dc" align="center" style={{ maxWidth: u(CELL - 16), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.line}</T>
                <B x={x + 18} y={442} w={CELL - 36} h={7} style={{ background: "#17304f", borderRadius: u(4) }}>
                  <i style={{ display: "block", height: "100%", width: `${s.progress ?? 0}%`, borderRadius: u(4), background: s.state === "STALE" ? "#ffc94d" : "#1a8cff" }} />
                </B>
                <T x={x + 18} y={482} size={19}>{pct(s.progress)}</T>
                <B x={x + CELL - 18 - 120} y={466} w={120} h={32} style={{ ...RIBBON_PILL[s.state], borderRadius: u(16), fontSize: u(16), fontWeight: 600,
                  display: "flex", alignItems: "center", justifyContent: "center" }}>{s.label}</B>
              </div>
              {i < N - 1 && <B x={x + CELL - 9} y={326} w={18} h={28} aria-hidden style={{ color: "#1e90ff", fontSize: u(24), lineHeight: u(28), pointerEvents: "none" }}>›</B>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
