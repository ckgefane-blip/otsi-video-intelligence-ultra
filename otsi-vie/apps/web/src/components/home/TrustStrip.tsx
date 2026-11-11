"use client";
/**
 * Home — trust and verification strip. No partner mark is licensed for use, so it shows the empty state's words only. Partner logos are
 * added here only once their licensing is confirmed by the owner (never a club or league mark without permission).
 */
import { useLocale } from "@/lib/i18n";

export function TrustStrip() {
  const { t } = useLocale();
  return (
    <section aria-label="Trust and credibility strip" className="flex items-center gap-3 rounded-md border border-line px-3.5 py-2" data-section="p01-s05">
      <h2 className="t-th shrink-0">{t.body.home.trustedPartners}</h2>
      <p className="t-small text-muted">{t.body.home.trustStrip}</p>
    </section>
  );
}
