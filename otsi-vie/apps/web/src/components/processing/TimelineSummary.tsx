/**
 * Page 03 Sections 08 and 09 — Processing Timeline and Output Summary (approved reference 03_AI_PROCESSING).
 *
 * The timeline spans the video's measured length. The upper bar is how far detection has gone through the video (the worker's DETECT
 * progress, which follows the frame timestamps); the lower bar shows tracking and identity suggestions. Steps that are not built
 * (events, indexing) never fill. The summary shows what the finished run measured: people tracks, ball tracks, and how much of the
 * run is processed; events are not detected yet, so "—".
 */
"use client";
import type { AnalysisRun } from "@otsi-vie/contracts";
import { Evidence } from "@/components/evidence/Evidence";
import { B, T, u } from "@/components/stage/DesignStage";
import { useLocale } from "@/lib/i18n";
import { DATE_TAG, pct, runProgress } from "./model";

const X0 = 108;
const clock = (us: number | null | undefined) => {
  if (!us) return "—";
  const t = Math.floor(us / 1e6);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const box = (c = "#12335f") => ({ border: `${u(1.5)} solid ${c}`, borderRadius: u(10), background: "linear-gradient(180deg,#081a35,#06122a)" });

export function TimelineSummary({ run, durationUs, events }: { run: AnalysisRun | null; durationUs: number | null; events: number | null }) {
  const { t: dict, locale } = useLocale();
  const d = dict.body.processing;
  const tag = DATE_TAG[locale];
  const step = (n: string) => {
    const s = run?.steps.find((x) => x.name === n);
    return !s ? 0 : s.status === "SUCCEEDED" ? 100 : Math.max(0, Math.min(100, s.progress));
  };
  const detect = step("DETECT"), track = step("TRACK"), ident = step("IDENTIFY");
  const r = run?.status === "SUCCEEDED" ? (run.result as Record<string, unknown> | null) : null;
  const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString(tag) : "—");
  const W1 = 1632 - X0, W2 = 1608 - X0;

  return (
    <>
      <section aria-label={d.processingTimeline} data-section="p03-s10" data-detect={String(Math.round(detect))}>
        <B x={43} y={1228} w={1623} h={182} style={box()} />
        <B x={58} y={1248} w={7} h={52} style={{ background: "#1e90ff", borderRadius: u(3) }} />
        <T x={75} y={1260} size={25} weight={700} as="h2">{d.processingTimeline}</T>
        <T x={75} y={1291} size={19} color="#b3c4dc">{d.frameProgress}</T>
        {([["#19e6c0", d.detection, 596], ["#1a8cff", d.tracking, 728], ["#8a5cff", d.identity, 853]] as const).map(([c, l, x]) => (
          <div key={l}>
            <B x={x} y={1253} w={19} h={19} style={{ borderRadius: "50%", background: c }} />
            <T x={x + 28} y={1262} size={19} color="#cfdcf0">{l}</T>
          </div>
        ))}
        <T x={X0} y={1333} size={17} color="#cfdcf0">0:00</T>
        <T x={1591} y={1333} size={17} color="#cfdcf0">{clock(durationUs)}</T>
        <div role="img" aria-label={d.timelineAria.replace("{d}", String(Math.round(detect))).replace("{t}", String(Math.round(track))).replace("{i}", String(Math.round(ident)))}>
          <B x={X0} y={1358} w={W1} h={10} style={{ background: "#2a3a52" }} />
          <B x={X0} y={1358} w={W1 * detect / 100} h={10} style={{ background: "#19e6c0" }} />
          <B x={X0} y={1373} w={W2} h={13} style={{ background: "#2a3a52" }} />
          <B x={X0} y={1373} w={W2 * track / 100} h={13} style={{ background: "#1a8cff" }} />
          <B x={X0} y={1373 + 9} w={W2 * ident / 100} h={4} style={{ background: "#8a5cff" }} />
        </div>
      </section>

      <section aria-label={d.outputSummary} data-section="p03-s11">
        <B x={1691} y={1228} w={839} h={182} style={box()} />
        <T x={1714} y={1273} size={25} weight={700} as="h2">{d.outputSummary} <span style={{ color: "#8ea3bf", fontWeight: 400 }}>{d.liveSuffix}</span></T>
        {([
          [1707, 188, r ? num(r.person_tracks) : "—", d.playersTracked, d.playersTrackedWhy],
          [1906, 184, r ? num(r.ball_tracks) : "—", d.ballTracked, d.ballTrackedWhy],
          [2103, 223, events != null ? num(events) : "—", d.eventsDetected, events != null ? d.eventsWhy : d.followBallEvents],
          [2341, 189, pct(runProgress(run)), d.processed, d.processedWhy],
        ] as const).map(([x, w, v, l, title]) => (
          <div key={l} role="group" aria-label={`${l}: ${v}`} title={title}>
            <B x={x} y={1297} w={w} h={113} style={box("#142f55")} />
            <B x={x + 14} y={1335} w={46} h={46} style={{ border: `${u(2.5)} solid #19a0ff`, borderRadius: "50%" }} />
            <T x={x + 68} y={1337} size={26} weight={700}>{v}</T>
            <T x={x + 68} y={1369} size={18} color="#b3c4dc">{l}</T>
            {l !== d.processed && v !== "—" && <B x={x + w - 30} y={1305} w={20} h={20}><Evidence level="DETECTED" compact size={12} why={title} /></B>}
          </div>
        ))}
      </section>
    </>
  );
}
