"use client";
/**
 * Page 01 Section 09 — five-stage How It Works (approved reference 01_HOME_OVERVIEW, "how it works").
 *
 * An illustrated walkthrough, not data: the small pictures carry only placeholder labels ("Player name", "—"), never a real or invented
 * player or value. Step 1 opens the Upload page; each later step opens the page where it happens.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ACC, B, Ic, P, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { UploadMax } from "./UploadMax";
import { useLocale } from "@/lib/i18n";

const card = { background: "#06142a", border: `${u(1.5)} solid #17406f`, borderRadius: u(6) };

export function HowItWorks() {
  const { t } = useLocale();
  const STEPS: [number, string, [string, ReactNode], number, string][] = [
    [422, t.body.home.uploadVideo, [t.body.home.stepUploadDesc, <>(MP4, MOV, up to <UploadMax />).</>], 410, "/upload"],
    [837, t.body.home.stepAnalyze, [t.body.home.stepAnalyzeDescA, t.body.home.stepAnalyzeDescB], 822, "/processing"],
    [1281, t.body.home.stepSelect, [t.body.home.stepSelectDescA, t.body.home.stepSelectDescB], 1253, "/analysis"],
    [1705, t.body.home.stepGenerate, [t.body.home.stepGenerateDescA, t.body.home.stepGenerateDescB], 1669, "/reels"],
    [2139, t.body.home.stepExport, [t.body.home.stepExportDescA, t.body.home.stepExportDescB], 2108, "/exports"],
  ];
  return (
    <section aria-label="How It Works journey" data-section="p01-s09">
      <P x={39} y={1180} w={2483} h={247} />
      <ACC x={63} y={1213} h={49} />
      <T x={87} y={1238} size={34} weight={700} as="h2">{t.body.home.howItWorks}</T>
      <T x={86} y={1291} size={24} color="#cfe0f5">{t.body.home.howItWorksSubtitle}</T>
      <T x={86} y={1327} size={24} color="#cfe0f5">{t.body.home.howItWorksSubtitleB}</T>

      <div aria-hidden>
        {/* 1 upload */}
        <B x={422} y={1200} w={313} h={112} style={{ border: `${u(2)} dashed #1e90ff`, background: "rgba(5,16,36,.5)" }} />
        <Ic x={573} y={1258} k="cloud" size={72} color="#33a8ff" sw={1.5} />
        {/* 2 analyse: pitch with detection frames */}
        <B x={838} y={1196} w={329} h={119} style={{ background: "radial-gradient(ellipse at 40% 65%,#6fb8ee 0,#2a6fb8 12%,transparent 13%),linear-gradient(180deg,#27487a,#2d7a3a 40%,#1d5a28)", borderRadius: u(4) }} />
        {[870, 920, 975, 1030, 1080].map((x, i) => <B key={x} x={x} y={1230 + (i % 2) * 26} w={16} h={34} style={{ border: `${u(2)} solid #33a8ff` }} />)}
        {/* 3 select a player */}
        <B x={1282} y={1196} w={308} h={120} style={card} />
        {[0, 1, 2].map((i) => {
          const y = 1217 + i * 38;
          return (
            <div key={i}>
              <B x={1348} y={y - 14} w={28} h={28} style={{ background: "#b98466", borderRadius: "50%" }} />
              <B x={1294} y={y - 9} w={18} h={18} style={{ border: `${u(1.5)} solid #33a8ff`, borderRadius: "50%" }} />
              <T x={1398} y={y} size={16}>Player name</T>
              <B x={1526} y={y - 12} w={40} h={24} style={{ background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(4) }} />
              <T x={1546} y={y} size={13} weight={600} color="#33a8ff" align="center">TEAM</T>
            </div>
          );
        })}
        {/* 4 generate: timeline */}
        <B x={1704} y={1196} w={315} h={122} style={card} />
        {[1216, 1236, 1256, 1277, 1297].map((y, i) => (
          <B key={y} x={1716} y={y} w={290} h={10} style={{ background: i === 2 ? "#0a84ff" : i === 4 ? "#f5a623" : "#1e5aa0", borderRadius: u(3) }} />
        ))}
        {/* 5 export: report card */}
        <B x={2137} y={1200} w={364} h={116} style={card} />
        <B x={2150} y={1210} w={34} h={40} style={{ background: "#b98466", borderRadius: u(4) }} />
        <T x={2221} y={1222} size={15} weight={600}>Player name</T>
        <T x={2221} y={1243} size={12} color="#8ea3bf">Position • Team</T>
        {([["Actions", 2184], ["Distance", 2271], ["Touches", 2342]] as const).map(([label, x]) => (
          <div key={label}>
            <T x={x} y={1279} size={18} weight={600} align="center">—</T>
            <T x={x} y={1299} size={12} color="#8ea3bf" align="center">{label}</T>
          </div>
        ))}
        <B x={2378} y={1214} w={120} h={96} style={{ background: "radial-gradient(ellipse at 55% 50%,#ff3a1a 0,#ffd21a 25%,#2fe3a0 50%,#1d6a2a 85%)", borderRadius: u(4) }} />
        {/* arrows between the stages */}
        {[777, 1217, 1632, 2068].map((x) => <Ic key={x} x={x} y={1270} k="arr" size={44} color="#1e90ff" sw={1.5} />)}
      </div>

      {STEPS.map(([x, title, [l1, l2], nx, href], i) => (
        <div key={title}>
          <B x={nx - 22} y={1184} w={44} h={44} style={{ background: "#0a84ff", border: `${u(2)} solid #6cc4ff`, borderRadius: "50%" }} />
          <T x={nx} y={1206} size={24} weight={600} align="center">{i + 1}</T>
          <Link href={href} className={s.cta} style={{ left: u(x), top: u(1322 - 101), width: u(380), height: u(36) }} aria-label={`Step ${i + 1}: ${title}`}>
            <T o={[x, 1322]} x={x} y={1339} size={26} weight={600} as="span">{title}</T>
          </Link>
          <T x={x} y={1371} size={21} color="#b9cbe2">{l1}</T>
          <T x={x} y={1399} size={21} color="#b9cbe2">{l2}</T>
        </div>
      ))}
    </section>
  );
}
