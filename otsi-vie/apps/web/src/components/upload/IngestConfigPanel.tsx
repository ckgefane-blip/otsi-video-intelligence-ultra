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
import { RIGHT_EXTRA } from "./layout";
import { ToggleRow, usePage02, type UploadPrefs } from "./page02";
import { ProfileCard } from "./ProfileCard";

type Kind = "live" | "always" | "not-built";
type Switch = Exclude<keyof UploadPrefs, "profile">;
type Row = [icon: string, label: string, y: number, kind: Kind, why: string, pref?: Switch];

const NB = "saved with your upload as requested, but not performed yet: ";
const VISUAL: Row[] = [
  ["stab", "Stabilize Video", 637, "live", "On: the analysis stabilises shaky footage (High accuracy or Ultra-sensitive; Recommended never goes below High accuracy). Off: Standard, unless Recommended or a profile on AI Tools says otherwise.", "stabilize"],
  ["crop", "Auto Crop Pitch", 683, "not-built", NB + "the video is analysed as recorded", "autoCrop"],
  ["enh", "Enhance Quality", 728, "not-built", NB + "no image enhancement is applied", "enhance"],
  ["vol", "Remove Crowd Noise", 775, "not-built", NB + "audio is kept as recorded", "crowdNoise"],
  ["asp", "Correct Aspect Ratio", 821, "not-built", NB + "the original aspect ratio is kept", "aspect"],
];
const OVERLAYS: Row[] = [
  ["ppl", "Players & Teams", 937, "always", "every analysis detects people and groups kit colours (a person assigns teams), so this cannot be switched off"],
  ["u_ball", "Ball Tracking", 982, "always", "every analysis detects and tracks the ball, so this cannot be switched off"],
  ["jer", "Jersey Numbers", 1027, "always", "every analysis reads shirt numbers where players are large enough, so this cannot be switched off"],
  ["pit", "Pitch Lines", 1072, "not-built", NB + "only the pitch surface is used, no line detection", "pitchLines"],
  ["mk", "Event Markers", 1118, "not-built", NB + "events are found when the ball is followed in Analysis", "eventMarkers"],
];
const INGEST: Row[] = [
  ["cal", "Auto Create Match", 1236, "not-built", NB + "choose or create the match in Match Context instead", "autoMatch"],
  ["meta", "Extract Metadata", 1282, "always", "every upload is probed (duration, resolution, frame rate, codecs), so this cannot be switched off"],
  ["hl", "Generate Highlights", 1328, "not-built", NB + "make highlights in the Reel Builder", "highlights"],
  ["snd", "Send to Analysis", 1373, "live", "On: the server starts an analysis as soon as the upload or link import is verified, even if you close this page. It is saved with the video.", "sendToAnalysis"],
];
/** the Filters tab is as tall as the other two columns: its switches are spread evenly over the added height (from the first group title to the last switch) */
const FIRST = 593, LAST = 1373;
const spread = (y: number) => y + (RIGHT_EXTRA * (y - FIRST)) / (LAST - FIRST);
const TABS: [string, number, number, number][] = [["Filters", 41, 24, 97], ["Overlays", 151, 134, 110], ["AI Tools", 289, 272, 104]];

export function IngestConfigPanel() {
  const { prefs, setPrefs, say, optionsTab: tab, setOptionsTab: setTab } = usePage02();
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
  const groups: [string, string | null, number, Row[]][] = [["Visual Processing", null, 593, VISUAL], ["AI Overlays", "(Auto-Detect)", 891, OVERLAYS], ["Ingest Options", null, 1188, INGEST]];
  const visible = tab === 0 ? groups : [groups[tab]!];

  return (
    <>
      <section aria-label="Visual processing configuration" data-section="p02-s03">
        <P x={22} y={496} w={383} h={922 + RIGHT_EXTRA} />
        <div role="tablist" aria-label="Options">
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
            <T x={42} y={593} size={22} weight={600} as="h3">Visual Processing</T>
            {rows(VISUAL)}
          </>
        )}
      </section>
      <section aria-label="Detection and ingest options" data-section="p02-s04">
        {visible.filter(([t]) => t !== "Visual Processing").map(([title, sub, y, list]) => {
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
