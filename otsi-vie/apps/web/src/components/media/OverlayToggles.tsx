"use client";
/**
 * The eight visual overlays (Desktop UI): Player Boxes, Player IDs, Player Tracks, Team Shapes, Ball Tracking, Pass Arrows, Heatmaps (Live),
 * Offside Line. Defaults: Boxes, IDs and Ball on; the rest off. One preference for this browser (lib/overlayPrefs), shared by every
 * player that draws overlays. A toggle only says what to draw: an overlay with no measured data behind it draws nothing.
 */
import { useLocale } from "@/lib/i18n";
import { useOverlayPrefs, type OverlayPrefs } from "@/lib/overlayPrefs";

const ROWS: { key: keyof OverlayPrefs; label: "ovBoxes" | "ovIds" | "ovTracks" | "ovShapes" | "ovBall" | "ovPasses" | "ovHeat" | "ovOffside" }[] = [
  { key: "boxes", label: "ovBoxes" }, { key: "ids", label: "ovIds" }, { key: "trails", label: "ovTracks" }, { key: "shapes", label: "ovShapes" },
  { key: "ball", label: "ovBall" }, { key: "passes", label: "ovPasses" }, { key: "heat", label: "ovHeat" }, { key: "offside", label: "ovOffside" },
];

export function OverlayToggles({ compact = false }: { compact?: boolean }) {
  const { t } = useLocale();
  const [prefs, save] = useOverlayPrefs();
  return (
    <section className="vie-panel" data-overlay-toggles aria-labelledby="ov-title">
      <div className="vie-ph"><h2 id="ov-title" className="t-panel">{t.desktop.overlaysTitle}</h2></div>
      <ul className={compact ? "grid grid-cols-2 gap-x-4 px-3 py-2" : "flex flex-col px-3 py-1.5"}>
        {ROWS.map((r) => (
          <li key={r.key} className="flex h-8 items-center justify-between gap-3">
            <span className="t-body">{t.desktop[r.label]}</span>
            <button type="button" role="switch" aria-checked={prefs[r.key]} aria-label={t.desktop[r.label]} className="vie-sw" data-overlay={r.key}
              onClick={() => save({ ...prefs, [r.key]: !prefs[r.key] })} />
          </li>
        ))}
      </ul>
    </section>
  );
}
