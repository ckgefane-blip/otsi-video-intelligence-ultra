"use client";
/**
 * Home — trust strip (ui-ux-spec §6.1, §5): the Evidence Integrity card. The four evidence badges with their one-line
 * meanings, and the line "Unknown beats wrong." This is a legend, not data — the badges here carry no counts. The badge
 * itself is the shared Evidence component; the meanings are the spec's §5 words.
 */
import { Evidence, type EvidenceLevel } from "@/components/evidence/Evidence";
import { useLocale } from "@/lib/i18n";

const ROWS: { level: EvidenceLevel; meaningKey: string }[] = [
  { level: "CONFIRMED", meaningKey: "hmTrustConfirmed" },
  { level: "DETECTED", meaningKey: "hmTrustDetected" },
  { level: "INFERRED", meaningKey: "hmTrustInferred" },
  { level: "NOT_MEASURED", meaningKey: "hmTrustNotMeasured" },
];

export function TrustStrip() {
  const { t } = useLocale();
  const h = t.body.home;
  return (
    <section aria-label={h.hmTrustTitle} className="min-w-0 rounded-md border border-line bg-panel px-4 py-3" data-trust-strip>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h2 className="t-panel shrink-0">{h.hmTrustTitle}</h2>
        <ul className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-2">
          {ROWS.map(({ level, meaningKey }) => (
            <li key={level} className="flex items-center gap-2">
              <Evidence level={level} />
              <span className="t-small text-muted">{h[meaningKey as keyof typeof h] as string}</span>
            </li>
          ))}
        </ul>
        <span className="t-small shrink-0 font-semibold">{h.hmTrustUnknown}</span>
      </div>
    </section>
  );
}
