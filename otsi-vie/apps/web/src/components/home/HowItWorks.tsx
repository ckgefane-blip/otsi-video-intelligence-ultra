"use client";
/**
 * Home — the five-stage How It Works (first-run guidance): numbered steps, each opening the page where it happens. No pictures of
 * players or values — the steps are words only, so nothing here can be mistaken for data. Step 1 carries this account's real per-video
 * upload limit.
 */
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n";
import { UploadMax } from "./UploadMax";

export function HowItWorks() {
  const { t } = useLocale();
  const STEPS: [string, ReactNode, string][] = [
    [t.body.home.uploadVideo, <>{t.body.home.stepUploadDesc} (MP4, MOV, up to <UploadMax />).</>, "/upload"],
    [t.body.home.stepAnalyze, `${t.body.home.stepAnalyzeDescA} ${t.body.home.stepAnalyzeDescB}`, "/processing"],
    [t.body.home.stepSelect, `${t.body.home.stepSelectDescA} ${t.body.home.stepSelectDescB}`, "/analysis"],
    [t.body.home.stepGenerate, `${t.body.home.stepGenerateDescA} ${t.body.home.stepGenerateDescB}`, "/reels"],
    [t.body.home.stepExport, `${t.body.home.stepExportDescA} ${t.body.home.stepExportDescB}`, "/exports"],
  ];
  return (
    <section aria-label="How It Works journey" className="vie-panel" data-section="p01-s09">
      <div className="vie-ph">
        <h2 className="t-panel">{t.body.home.howItWorks}</h2>
        <span className="t-small truncate text-muted">{t.body.home.howItWorksSubtitle} {t.body.home.howItWorksSubtitleB}</span>
      </div>
      <ol className="grid grid-cols-1 gap-2 p-3 md:grid-cols-5">
        {STEPS.map(([title, desc, href], i) => (
          <li key={href}>
            <Link href={href} className="flex h-full flex-col gap-1 rounded-md border border-line bg-p0 p-3 hover:border-line2" aria-label={`Step ${i + 1}: ${title}`}>
              <span className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary t-small font-normal" style={{ color: "rgb(var(--primary-ink))" }}>{i + 1}</span>
                <span className="t-body flex-1 font-normal">{title}</span>
                <ChevronRight className="h-4 w-4 text-muted" aria-hidden />
              </span>
              <span className="t-small text-muted">{desc}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
