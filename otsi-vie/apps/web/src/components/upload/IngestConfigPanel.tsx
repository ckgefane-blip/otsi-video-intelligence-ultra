"use client";
/**
 * Page 02 Sections 03 and 04 — visual processing configuration, and detection and ingest options (approved reference 02_UPLOAD_INGEST,
 * "left", second panel). Every switch is one of three kinds, from what the engine really does (analyze.py, the analysis PROFILES). All ten that are choices switch and are saved with the upload:
 *   live    Stabilize Video (on = the High accuracy profile, which stabilises; off = Standard) and Send to Analysis (start an analysis
 *           once the upload or import is verified: the SERVER does it) — the viewer's defaults, sent with each upload or import
 *   always  done by every ingest or analysis, shown on and locked: players and kit colours, ball tracking, shirt numbers, file metadata
 *   not built  a request: switches freely, is saved, and reads "saved · not performed yet" while on (the engine cannot do the step yet)
 * Tabs: Filters shows all three groups as the reference does; Overlays and AI Tools show their own group.
 * v3 Phase A.10 (ADR-076): AI Tools also holds the analysis profile card (ProfileCard) under Ingest Options. Stabilize Video and the profile
 * agree: switching Stabilize on lifts Standard to High accuracy, off brings a stabilising profile back to Standard.
 */
import { Fragment } from "react";
import { B, P, T, u } from "@/components/stage/DesignStage";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { RIGHT_EXTRA } from "./layout";
import { ToggleRow, usePage02, type UploadPrefs } from "./page02";
import { ProfileCard } from "./ProfileCard";

type Kind = "live" | "always" | "not-built";
type Switch = Exclude<keyof UploadPrefs, "profile">;
type Row = [icon: string, label: string, y: number, kind: Kind, why: string, pref?: Switch];

/** The dictionary subsection these rows come from (ADR-139 Group A). */
type UploadDict = Dictionary["body"]["upload"];

/** the rows in this language: positions and kinds stay, only the words are translated. */
const rowsFor = (d: UploadDict): { visual: Row[]; overlays: Row[]; ingest: Row[] } => ({
  visual: [
    ["stab", d.stabilize, 637, "live", d.whyStabilize, "stabilize"],
    ["crop", d.autoCrop, 683, "not-built", d.whyAutoCrop, "autoCrop"],
    ["enh", d.enhance, 728, "not-built", d.whyEnhance, "enhance"],
    ["vol", d.crowdNoise, 775, "not-built", d.whyCrowdNoise, "crowdNoise"],
    ["asp", d.aspect, 821, "not-built", d.whyAspect, "aspect"],
  ],
  overlays: [
    ["ppl", d.playersTeams, 937, "always", d.whyPlayersTeams],
    ["u_ball", d.ballTracking, 982, "always", d.whyBallTracking],
    ["jer", d.jerseyNumbers, 1027, "always", d.whyJerseyNumbers],
    ["pit", d.pitchLines, 1072, "not-built", d.whyPitchLines, "pitchLines"],
    ["mk", d.eventMarkers, 1118, "not-built", d.whyEventMarkers, "eventMarkers"],
  ],
  ingest: [
    ["cal", d.autoMatch, 1236, "not-built", d.whyAutoMatch, "autoMatch"],
    ["meta", d.extractMetadata, 1282, "always", d.whyExtractMetadata],
    ["hl", d.generateHighlights, 1328, "not-built", d.whyGenerateHighlights, "highlights"],
    ["snd", d.sendToAnalysis, 1373, "live", d.whySendToAnalysis, "sendToAnalysis"],
  ],
});
/** the Filters tab is as tall as the other two columns: its switches are spread evenly over the added height (from the first group title to the last switch) */
const FIRST = 593, LAST = 1373;
const spread = (y: number) => y + (RIGHT_EXTRA * (y - FIRST)) / (LAST - FIRST);
/** the tab names in this language (positions stay). */
const tabsFor = (d: UploadDict): [string, number, number, number][] => [[d.tabFilters, 41, 24, 97], [d.tabOverlays, 151, 134, 110], [d.tabAiTools, 289, 272, 104]];

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
  const place = (y: number) => (tab === 0 ? spread(y) : y);       // only the Filters tab shows all three groups: the others sit at the top
  const rows = (list: Row[], dy = 0) => list.map(([icon, label, y, kind, why, pref]) => (
    <ToggleRow key={label} y={place(y + dy)} icon={icon} label={label} kind={kind} why={why} say={say} on={pref ? prefs[pref] : kind === "always"}
      {...(pref ? { onToggle: () => toggle(pref) } : {})} />
  ));
  // on the Overlays and AI Tools tabs their group moves up to the top of the panel
  const groups: [string, string | null, number, Row[]][] = [[d.visualProcessing, null, 593, VISUAL], [d.aiOverlays, d.autoDetect, 891, OVERLAYS], [d.ingestOptions, null, 1188, INGEST]];
  const visible = tab === 0 ? groups : [groups[tab]!];

  return (
    <>
      <section aria-label={d.visualProcessing} data-section="p02-s03">
        <P x={22} y={496} w={383} h={922 + RIGHT_EXTRA} />
        <div role="tablist" aria-label={d.ingestOptions}>
          {TABS.map(([l, x, ux, uw], i) => (
            <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className="absolute"
              style={{ left: u(ux), top: u(506 - 101), width: u(uw), height: u(49), padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" }}>
              <T o={[ux, 506]} x={x} y={528} size={22} weight={tab === i ? 600 : 400} color={tab === i ? "#33a8ff" : "#cfe0f5"} as="span">{l}</T>
            </button>
          ))}
        </div>
        <B x={TABS[tab]![2]} y={555} w={TABS[tab]![3]} h={3} style={{ background: "#1e90ff" }} />
        <B x={24} y={560} w={380} h={1} style={{ background: "#12335f" }} />
        {tab === 0 && (
          <>
            <T x={42} y={593} size={22} weight={600} as="h3">{d.visualProcessing}</T>
            {rows(VISUAL)}
          </>
        )}
      </section>
      <section aria-label={d.ingestOptions} data-section="p02-s04">
        {visible.filter(([t]) => t !== d.visualProcessing).map(([title, sub, y, list]) => {
          const dy = tab === 0 ? 0 : 593 - y;
          return (
            <Fragment key={title}>
              <T x={42} y={place(y + dy)} size={22} weight={600} as="h3">{title}</T>
              {sub && <T x={163} y={place(y + dy)} size={22} color="#b9cbe2">{sub}</T>}
              {rows(list, dy)}
            </Fragment>
          );
        })}
        {tab === 2 && <ProfileCard y={800} />}
      </section>
    </>
  );
}
