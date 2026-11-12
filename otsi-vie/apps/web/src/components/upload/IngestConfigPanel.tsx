"use client";
/**
 * Page 02 Sections 03 and 04 — visual processing configuration, and detection and ingest options, on the Desktop UI flow layout.
 * Every switch is one of three kinds, from what the engine really does (analyze.py, the analysis PROFILES). All ten that are choices switch and are saved with the upload:
 *   live    Stabilize Video (on = the High accuracy profile, which stabilises; off = Standard) and Send to Analysis (start an analysis
 *           once the upload or import is verified: the SERVER does it) — the viewer's defaults, sent with each upload or import
 *   always  done by every ingest or analysis, shown on and locked: players and kit colours, ball tracking, shirt numbers, file metadata
 *   not built  a request: switches freely, is saved, and reads "saved · not performed yet" while on (the engine cannot do the step yet)
 * Tabs: Filters shows all three groups as the reference does; Overlays and AI Tools show their own group.
 * v3 Phase A.10 (ADR-076): AI Tools also holds the analysis profile card (ProfileCard) under Ingest Options. Stabilize Video and the profile
 * agree: switching Stabilize on lifts Standard to High accuracy, off brings a stabilising profile back to Standard.
 */
import { Fragment } from "react";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { usePage02, type UploadPrefs } from "./page02";
import { ProfileCard } from "./ProfileCard";

type Kind = "live" | "always" | "not-built";
type Switch = Exclude<keyof UploadPrefs, "profile">;
type Row = [label: string, kind: Kind, why: string, pref?: Switch];

/** The dictionary subsection these rows come from (ADR-139 Group A). */
type UploadDict = Dictionary["body"]["upload"];

/** the rows in this language: kinds stay, only the words are translated. */
const rowsFor = (d: UploadDict): { visual: Row[]; overlays: Row[]; ingest: Row[] } => ({
  visual: [
    [d.stabilize, "live", d.whyStabilize, "stabilize"],
    [d.autoCrop, "not-built", d.whyAutoCrop, "autoCrop"],
    [d.enhance, "not-built", d.whyEnhance, "enhance"],
    [d.crowdNoise, "not-built", d.whyCrowdNoise, "crowdNoise"],
    [d.aspect, "not-built", d.whyAspect, "aspect"],
  ],
  overlays: [
    [d.playersTeams, "always", d.whyPlayersTeams],
    [d.ballTracking, "always", d.whyBallTracking],
    [d.jerseyNumbers, "always", d.whyJerseyNumbers],
    [d.pitchLines, "not-built", d.whyPitchLines, "pitchLines"],
    [d.eventMarkers, "not-built", d.whyEventMarkers, "eventMarkers"],
  ],
  ingest: [
    [d.autoMatch, "not-built", d.whyAutoMatch, "autoMatch"],
    [d.extractMetadata, "always", d.whyExtractMetadata],
    [d.generateHighlights, "not-built", d.whyGenerateHighlights, "highlights"],
    [d.sendToAnalysis, "live", d.whySendToAnalysis, "sendToAnalysis"],
  ],
});
/** the tab names in this language. */
const tabsFor = (d: UploadDict): string[] => [d.tabFilters, d.tabOverlays, d.tabAiTools];

/**
 * One toggle row. `kind`: live (the engine carries it out), always (every analysis does it: locked on, a click says so), or
 * not-built (a REQUEST the engine cannot perform yet: it switches freely, is saved with the upload, and shows
 * "saved · not performed yet" while on, so it never claims a step that did not happen)
 */
function ToggleRow({ label, on, kind, why, onToggle, say }: {
  label: string; on: boolean; kind: Kind; why: string; onToggle?: () => void; say: (t: string) => void;
}) {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const shownOn = kind === "always" ? true : on;
  const click = () => {
    if (kind === "always" || !onToggle) return say(`${label}: ${why}`);
    onToggle();
    say(`${label} ${on ? d.toggleOff : d.toggleOn}: ${why}`);
  };
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <span className="t-body block">{label}</span>
        {kind === "not-built" && on && <span className="t-small block text-amber">{d.savedNotPerformed}</span>}
        {kind === "always" && <span className="t-small block">{why}</span>}
      </div>
      <button type="button" role="switch" aria-checked={shownOn} aria-disabled={kind === "always" || undefined} title={why} aria-label={`${label}: ${why}`}
        onClick={click} className="vie-sw" />
    </div>
  );
}

export function IngestConfigPanel() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { prefs, setPrefs, say, optionsTab: tab, setOptionsTab: setTab } = usePage02();
  const { visual: VISUAL, overlays: OVERLAYS, ingest: INGEST } = rowsFor(d);
  const TABS = tabsFor(d);
  const toggle = (pref: Switch) => {
    const next = { ...prefs, [pref]: !prefs[pref] };
    if (pref === "stabilize" && prefs.profile !== "RECOMMENDED") next.profile = next.stabilize ? (prefs.profile === "STANDARD" ? "HIGH_ACCURACY" : prefs.profile) : "STANDARD";
    setPrefs(next);
  };
  const rows = (list: Row[]) => list.map(([label, kind, why, pref]) => (
    <ToggleRow key={label} label={label} kind={kind} why={why} say={say} on={pref ? prefs[pref] : kind === "always"}
      {...(pref ? { onToggle: () => toggle(pref) } : {})} />
  ));
  const groups: [string, string | null, Row[]][] = [[d.visualProcessing, null, VISUAL], [d.aiOverlays, d.autoDetect, OVERLAYS], [d.ingestOptions, null, INGEST]];
  const visible = tab === 0 ? groups : [groups[tab]!];

  return (
    <section aria-label={d.visualProcessing} data-section="p02-s03" className="vie-panel">
      <div className="vie-ph">
        <div role="tablist" aria-label={d.ingestOptions} className="flex gap-1">
          {TABS.map((l, i) => (
            <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
              className={`rounded-ctl px-2.5 py-1 text-sm font-semibold ${tab === i ? "bg-primary text-white" : "text-ink2 hover:bg-raised hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="space-y-4 p-3" data-section="p02-s04">
        {visible.map(([title, sub, list]) => (
          <Fragment key={title}>
            <div>
              <h3 className="t-panel">{title}{sub && <span className="ml-2 font-normal text-muted">{sub}</span>}</h3>
              <div className="mt-1">{rows(list)}</div>
            </div>
          </Fragment>
        ))}
        {tab === 2 && <ProfileCard />}
      </div>
    </section>
  );
}
