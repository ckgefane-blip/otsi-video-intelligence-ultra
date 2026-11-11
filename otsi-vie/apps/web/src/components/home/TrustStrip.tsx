"use client";
/**
 * Page 01 Section 05 — trust and verification strip (approved reference 01_HOME_OVERVIEW, "TRUSTED PARTNERS").
 *
 * The approved image shows partner marks; none is licensed for use, so the corrected reference's empty state is shown exactly. Partner
 * logos are added here only once their licensing is confirmed by the owner (never a club or league mark without permission).
 */
import { P, T } from "@/components/stage/DesignStage";
import { useLocale } from "@/lib/i18n";

export function TrustStrip() {
  const { t } = useLocale();
  return (
    <section aria-label="Trust and credibility strip" data-section="p01-s05">
      <P x={1735} y={602} w={787} h={135} />
      <T x={1767} y={628} size={17} ls={5} color="#b9cbe2" as="h2">{t.body.home.trustedPartners}</T>
      <T x={1767} y={690} size={22} color="#8ea3bf">{t.body.home.trustStrip}</T>
    </section>
  );
}
