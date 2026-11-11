"use client";
/**
 * Home — the page header and the hero. Left: the title, the subtitle, the two upload controls (they open the real upload page in the
 * matching source mode) with the per-video limit of this account (tier limit capped by the server's own), and the state-aware next
 * action. Right of the header row sits the Featured Reel; under it, the live picture (HeroLive).
 */
import { Link2, Upload } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { fill } from "@/lib/fill";
import { formatGB, useTierLimit } from "@/lib/uploadTier";
import { HeroLive } from "./HeroLive";
import { NextActionBar } from "./HomeInbox";

export function HeroSection() {
  const { t } = useLocale();
  const lim = useTierLimit();
  const tier = lim?.tier === "Free" ? t.desktop.tierFree : lim?.tier === "Pro" ? t.desktop.tierPro : lim?.tier === "Enterprise" ? t.desktop.tierEnterprise : lim?.plan ?? "—";
  return (
    <section aria-label="Hero: football video intelligence" data-section="p01-s02" className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">{t.nav.home}</h1>
          <p className="t-body mt-0.5 text-muted">{t.desktop.homeSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/upload?mode=url" className="vie-btn" data-cta="paste-link"><Link2 className="h-4 w-4" aria-hidden />{t.body.home.pasteLink}</Link>
          <Link href="/upload?mode=file" className="vie-btn vie-btn-pri" data-cta="upload"><Upload className="h-4 w-4" aria-hidden />{t.body.home.uploadVideo}</Link>
        </div>
      </header>
      <p className="t-small -mt-1 text-right text-muted" data-upload-limit>
        {lim?.maxBytes ? fill(t.desktop.uploadLimitLine, { a: tier, b: formatGB(lim.maxBytes) }) : "MP4, MOV"} · {t.desktop.uploadTiersLine}
      </p>
      <NextActionBar />
      <div className="min-h-[340px] flex-1" data-illustration><HeroLive /></div>
    </section>
  );
}
