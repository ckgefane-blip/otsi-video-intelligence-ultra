"use client";
/**
 * Page 10 Sections 06-13 — export tabs, Export Settings, Branded Overlays, Export Queue, Output & Reports, Shareable Link, Team
 * Collaboration, Render Progress, Download All and Deliver to Client (approved reference 10_EXPORT_DELIVERY, right column and bottom).
 *
 * Real: video format (codec/container), quality (bitrate), aspect (the reel's), the queue of the organization's renders with their
 * state, Render Progress from the latest render, Download All (the finished render). Branded Overlays switch what the renderer draws
 * on the next render (the reel's saved look): the organization's logo (chosen in Brand, only one whose rights are in force), the lower
 * third (name, OTSI Player ID, club), the match info (team names and the match clock) and the intro / outro (chosen in Clip Studio ›
 * Graphics). Team Collaboration lists the organization's members; owners and admins manage the team and invite on Settings › Team.
 * Output & Reports, Notify team / client, the message, Download All (one ZIP with a manifest) and Deliver to Client (a rights-checked link
 * handed to the sender's own mail app, recorded) are real (ADR-058, Deliver.tsx). Output Preset is real (E3, ADR-066): the reel, a scout
 * 16:9 + social 9:16 pair from one edit, or an archive master, each with its loudness; the files made are listed under it to download.
 * The renderer has no resolution / frame-rate choice (it keeps the source's): drawn as in the reference, disabled with the reason.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Reel, ReelAspectT } from "@otsi-vie/contracts";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { Sel } from "@/components/tactics/kit";
import { Switch } from "@/components/reelstage/shared";
import { Hit } from "@/components/workspace/shared";
import { DeliverDialog, MESSAGE_MAX, Reports, type Outbox } from "./Deliver";
import { SharePanel } from "./Share";
import { active, FORMATS, QUALITY, useExport, type ExportState, type Preset } from "./state";
import { describeOutputs } from "./PresetLibrary";

const LOGOS = ["CUSTOM_LOGO", "COMPETITION_LOGO"];
type Brandable = "logo" | "lower_third" | "score_bug" | "intro";
const ROLE: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", ANALYST: "Analyst", EDITOR: "Editor", VIEWER: "Viewer", CLIENT: "Client" };

const PROFILE_NAME: Record<string, string> = { REEL: "Reel", SCOUT: "Scout", SOCIAL: "Social", ARCHIVE: "Archive" };

/** E3: the preset's description, then the reel's finished files (newest of each profile and frame) to download */
function Formats({ e }: { e: ExportState }) {
  const files = e.reel?.formats ?? [];
  const p = e.presets.find((x) => x.id === e.preset);
  const about = p ? p.note || describeOutputs(p.spec.outputs) : "";
  return (
    <div data-formats={String(files.length)} title={about} style={{ position: "absolute", left: u(2020), top: u(314), width: u(495), fontSize: u(16), color: "#8ea3bf", lineHeight: 1.25,
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {files.length ? (<>Files: {files.map((f, i) => (
        <span key={f.render_id}>{i ? " · " : ""}<button type="button" data-format={`${f.profile}-${f.aspect}`} onClick={() => e.download(f.render_id)}
          style={{ background: "none", border: 0, padding: 0, color: "#33a8ff", cursor: "pointer", font: "inherit", textDecoration: "underline" }}
          aria-label={`Download the ${PROFILE_NAME[f.profile]} file, ${f.aspect}`}>{PROFILE_NAME[f.profile]} {f.aspect}</button></span>
      ))}</>) : about}
    </div>
  );
}

/** what each Branded Overlays line means in the reel's saved look */
function branding(e: ExportState) {
  const s = e.reel?.settings;
  const logos = (e.brand ?? []).filter((a) => LOGOS.includes(a.kind));
  const logo = s ? logos.find((a) => a.id === (s.custom_logo_id ?? s.competition_logo_id)) ?? null : null;
  const on: Record<Brandable, boolean> = {
    logo: !!s && !!(s.custom_logo_id || s.competition_logo_id), lower_third: !!s?.lower_third, score_bug: !!s?.score_bug, intro: !!s && !!(s.intro_id || s.outro_id),
  };
  return { s, logos, logo, on, any: Object.values(on).some(Boolean) };
}

const field = { background: "#041022", borderColor: "#17406f", borderRadius: u(8) };
const hl = (on: boolean) => (on ? { borderColor: "#33a8ff" } : undefined);
const TABS: [string, string, number, number, string, string][] = [["Export", "cloud", 1905, 172, "p10-settings", "Export"], ["Branding", "tmpl", 2073, 172, "p10-branding", "Branding"],
  ["Reports", "doc", 2271, 200, "p10-reports", "Reports"], ["Delivery", "cloud", 2444, 168, "p10-delivery", "Delivery"]];

export function Right() {
  const { t: dict } = useLocale();
  const e = useExport();
  const reel = e.reel;
  const canEdit = e.canEdit && !e.busy && !!reel;
  const setAspect = (a: ReelAspectT) => { if (reel && a !== reel.aspect) e.setAspect(a); };
  const quality = QUALITY.find(([, b]) => b === e.bitrate)?.[0] ?? "High";
  const o = e.outbox;
  // the queue rows are filtered and sorted once per reels read, not once per render (and not once per section that reads them)
  const queueRows = useMemo(() => (e.reels ?? []).filter((r) => r.latest_render && !(r.latest_render.cleared && !active(r)))
    .sort((a, b) => (active(b) ? 1 : 0) - (active(a) ? 1 : 0)), [e.reels]);
  const finishedCount = useMemo(() => queueRows.filter((r) => r.latest_render && !r.latest_render.cleared && !active(r)).length, [queueRows]);
  const tw = e.canEdit ? undefined : "Your role can look, not deliver";
  return (
    <>
      <section aria-label="Export tabs" data-section="p10-s06">
        <P x={1830} y={120} w={710} h={65} />
        <B x={[1830, 2002, 2174, 2374][e.tab]!} y={120} w={[172, 172, 200, 166][e.tab]!} h={65} style={{ background: "#08213f", borderBottom: `${u(3)} solid #1e90ff`, borderRadius: `${u(10)} ${u(10)} 0 0` }} />
        <div role="tablist" aria-label="Export workspace">
          {TABS.map(([l, icon, x, w], i) => (
            <div key={l}>
              <Ic x={x - 60 + (i === 0 ? 0 : 0)} y={153} k={icon} size={28} color={e.tab === i ? "#33a8ff" : "#cfe0f5"} />
              <T x={x - 36} y={153} size={22} weight={e.tab === i ? 600 : 400} color={e.tab === i ? "#33a8ff" : undefined}>{l}</T>
              <Hit x={[1830, 2002, 2174, 2374][i]!} y={120} w={[172, 172, 200, 166][i]!} h={65} label={l} pressed={e.tab === i} onClick={() => e.jump(i)} />
            </div>
          ))}
        </div>
      </section>

      <section id="p10-settings" aria-label="Export settings" data-section="p10-s07" data-codec={e.codec} data-bitrate={e.bitrate}>
        <P x={1830} y={200} w={710} h={455} style={hl(e.focus === "p10-settings")} />
        <B x={1849} y={216} w={3} h={28} style={{ background: "#1e90ff" }} />
        <T x={1871} y={230} size={24} weight={600} as="h2">{dict.body.exports.exportSettings}</T>
        <T x={2508} y={230} size={20} color="#33a8ff" align="right">Reset</T>
        <Hit x={2440} y={214} w={80} h={32} label="Reset the export settings" onClick={e.reset} />
        <T x={1851} y={287} size={21}>{dict.body.exports.outputPreset}</T>
        <Sel x={2020} y={263} w={495} h={46} label="Output preset" value={e.preset} options={e.presets.map((p) => [p.id, p.scope === "BUILT_IN" ? p.name : `${p.name} (${p.scope === "PERSONAL" ? "mine" : "organization"})`] as [Preset, string])} onChange={(v) => e.setPreset(v)} style={{ ...field, fontSize: u(21) }} pad={24} />
        {/* B.22 (ADR-097): the preset library */}
        <button type="button" data-open-presets="" onClick={e.openLibrary} className="absolute" title="Choose, save or delete export presets"
          style={{ left: u(1851), top: u(306), height: u(26), padding: 0, background: "none", border: 0, color: "#33a8ff", fontSize: u(16), cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>Presets…</button>
        <Formats e={e} />
        <T x={1851} y={378} size={21}>{dict.body.exports.resolution}</T>
        <Sel x={1994} y={355} w={224} h={45} label="Resolution" value="src" options={[["src", "Same as source"], ["4k", "4K (3840 × 2160)", "the renderer keeps the source resolution"], ["hd", "Full HD (1920 × 1080)", "the renderer keeps the source resolution"]]} style={field} pad={20} />
        <T x={2256} y={377} size={21}>{dict.body.exports.frameRate}</T>
        <Sel x={2379} y={355} w={136} h={45} label="Frame rate" value="src" options={[["src", "Source"], ["60", "60 fps", "the renderer keeps the source frame rate"], ["30", "30 fps", "the renderer keeps the source frame rate"]]} style={field} pad={20} />
        <T x={1851} y={434} size={21}>{dict.body.reels.aspectRatio}</T>
        <div role="radiogroup" aria-label="Aspect ratio">
          {([["16:9", "Landscape", 1995, 123, "cam"], ["9:16", "Vertical", 2132, 117, "ph"], ["1:1", "Square", 2263, 120, "sq"], ["4:5", "Social", 2396, 121, "sq"]] as const).map(([a, d, x, w, icon]) => {
            const on = reel?.aspect === a || (!reel && a === "16:9");
            return (
              <div key={a} role="radio" aria-checked={on}>
                <B x={x} y={420} w={w} h={111} style={{ background: on ? "#0a2b55" : "#0a1d38", border: on ? `${u(3)} solid #1e90ff` : `${u(1.5)} solid #17406f`, borderRadius: u(8), boxSizing: "border-box", }} />
                <Ic x={x + w / 2} y={451} k={icon} size={34} color={on ? "#33a8ff" : "#cfe0f5"} />
                <T x={x + w / 2} y={485} size={20} weight={600} color={on ? "#33a8ff" : undefined} align="center">{a}</T>
                <T x={x + w / 2} y={510} size={19} color={on ? "#33a8ff" : "#cfe0f5"} align="center">{d}</T>
                <Hit x={x} y={420} w={w} h={111} label={`Aspect ratio ${a}`} pressed={on} {...(canEdit ? { onClick: () => setAspect(a) } : { reason: reel ? "You cannot edit this reel" : "Open a reel first" })} />
              </div>
            );
          })}
        </div>
        <T x={1851} y={576} size={21}>{dict.body.exports.fileFormat}</T>
        <Sel x={1994} y={553} w={224} h={45} label="File format" value={e.codec} options={FORMATS.map(([c, l]) => [c, l] as [typeof e.codec, string])} onChange={(v) => e.setCodec(v)} style={field} pad={20} />
        <T x={2276} y={576} size={21}>{dict.body.exports.quality}</T>
        <Sel x={2384} y={555} w={131} h={43} label="Quality" value={quality} options={QUALITY.map(([l]) => [l, `       ${l}`] as [string, string])} onChange={(v) => e.setBitrate(QUALITY.find(([l]) => l === v)![1])} style={field} pad={10} />
        <Ic x={2411} y={577} k="layers" size={26} color="#33a8ff" />
        {/* C.3 (ADR-103): OpenTimelineIO (.otio) and .otsi-reel manifest interchange */}
        <button type="button" data-open-interchange="" onClick={e.openInterchange} disabled={!reel}
          className="absolute disabled:opacity-50" title={reel ? "Export OpenTimelineIO (.otio) and .otsi-reel manifest with evidence flags" : "Open a reel first"}
          style={{ left: u(1851), top: u(506), height: u(26), padding: 0, background: "none", border: 0, color: "#33a8ff", fontSize: u(16), cursor: reel ? "pointer" : "default", textDecoration: "underline", fontFamily: "inherit" }}>Interchange…</button>
        <T x={1996} y={617} size={17} color="#8ea3bf">{e.codec === "h264" ? "Best compatibility, high quality, smaller file size." : e.codec === "av1" ? "Royalty-free, smaller files, plays in modern browsers." : "Royalty-free WebM, plays in modern browsers."}</T>
      </section>

      <section id="p10-branding" aria-label="Branded overlays" data-section="p10-s08">
        <P x={1830} y={672} w={710} h={295} style={hl(e.focus === "p10-branding")} />
        <B x={1849} y={686} w={3} h={28} style={{ background: "#1e90ff" }} />
        <T x={1871} y={699} size={23} weight={600} as="h2">Branded Overlays</T>
        <Branding />
      </section>

      <section aria-label="Export queue" data-section="p10-s09" data-queue={String(queueRows.length)}>
        <P x={444} y={980} w={743} h={317} />
        <B x={462} y={995} w={3} h={25} style={{ background: "#1e90ff" }} />
        <T x={482} y={1007} size={22} weight={600} as="h2">{`Export Queue (${queueRows.length})`}</T>
        <T x={1160} y={1008} size={19} color="#33a8ff" align="right">Clear All</T>
        <ClearAll finished={finishedCount} />
        <Queue rows={queueRows} />
      </section>

      <section id="p10-reports" aria-label="Output and reports" data-section="p10-s10">
        <P x={1204} y={980} w={411} h={317} style={hl(e.focus === "p10-reports")} />
        <B x={1214} y={995} w={3} h={25} style={{ background: "#1e90ff" }} />
        <T x={1231} y={1009} size={22} weight={600} as="h2">Output &amp; Reports</T>
        <Reports e={e} o={o} />
      </section>

      <SharePanel focus={e.focus === "p10-delivery"} />

      <section aria-label="Team collaboration" data-section="p10-s12">
        <P x={2117} y={980} w={423} h={317} />
        <B x={2133} y={995} w={3} h={25} style={{ background: "#1e90ff" }} />
        <T x={2151} y={1008} size={22} weight={600} as="h2">Team Collaboration</T>
        <Team />
        {([["mail", "Notify team when ready", 1112, 1111, o.notifyTeam, o.setNotifyTeam], ["user", "Notify client", 1148, 1146, o.notifyClient, o.setNotifyClient]] as const).map(([icon, l, y, ty, on, set]) => (
          <div key={l} data-notify={l} data-on={String(on)}>
            <Ic x={2154} y={y} k={icon} size={24} color={on ? "#33a8ff" : "#8ea3bf"} /><T x={2186} y={y} size={19} color={on ? "#e3eefb" : "#8ea3bf"}>{l}</T>
            <Switch x={2465} y={ty} on={on} off={!e.canEdit} />
            <Hit x={2150} y={y - 16} w={380} h={32} label={l} pressed={on} {...(tw ? { reason: tw } : { onClick: () => set(!on) })} />
          </div>
        ))}
        <textarea aria-label="Message for recipients" placeholder="Add a message for recipients (optional)" maxLength={MESSAGE_MAX} disabled={!e.canEdit} value={o.message} onChange={(x) => o.setMessage(x.target.value)}
          className="absolute" style={{ left: u(2140), top: u(1171 - 101), width: u(378), height: u(97), boxSizing: "border-box", padding: `${u(10)} ${u(14)}`, color: "#fff", fontSize: u(18), resize: "none", background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(8) }} />
        <T x={2512} y={1281} size={15} color="#8ea3bf" align="right">{`${o.message.length}/${MESSAGE_MAX}`}</T>
      </section>
      <Footer o={o} />
      <DeliverDialog e={e} o={o} />
    </>
  );
}

/** Clear All: finished renders leave the queue (POST /v1/renders/clear-finished); the renders and their files stay in the Library */
function ClearAll({ finished }: { finished: number }) {
  const e = useExport();
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);   // the "cleared" note never outlives the page
  const run = () => {
    void api<{ cleared: number }>("/v1/renders/clear-finished", { method: "POST" }).then(async (x) => { await e.reload(); setMsg(x.cleared ? `${x.cleared} cleared` : "Nothing to clear"); },
      () => setMsg("Could not clear")).finally(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 2500); });
  };
  return (
    <>
      {msg && <T x={1080} y={1008} size={15} color="#8ea3bf" align="right">{msg}</T>}
      <Hit x={1090} y={994} w={80} h={30} label={`Clear all finished renders (${finished})`}
        {...(!e.canEdit ? { reason: "Your role can look, not change the queue" } : !finished ? { reason: "No finished render in the queue" } : { onClick: run })} />
    </>
  );
}

function Queue({ rows }: { rows: Reel[] }) {
  const { t: dict } = useLocale();
  const e = useExport();
  const shown = rows.slice(0, 4);
  if (e.reels === null && !e.reelsFailed) return <T x={815} y={1150} size={20} color="#8ea3bf" align="center">Loading the render queue…</T>;
  if (e.reelsFailed) return (<>
    <T x={815} y={1150} size={20} color="#8ea3bf" align="center">{dict.body.exports.renderQueueNotLoaded}</T>
    <B x={760} y={1190} w={180} h={40} style={{ background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(8) }} />
    <T x={850} y={1205} size={18} color="#33a8ff" align="center">Try again</T>
    <Hit x={760} y={1190} w={180} h={40} label="Try again: read the reels again" onClick={() => void e.reload()} />
  </>);
  if (!shown.length) return <T x={815} y={1150} size={20} color="#8ea3bf" align="center">{dict.body.exports.noRenderJobs}</T>;
  return (
    <div role="list" aria-label="Render jobs" className="absolute" style={{ left: u(462), top: u(1040 - 101), width: u(707), height: u(245), overflowY: "auto" }}>
      {shown.map((r) => {
        const j = r.latest_render!;
        return (
          <Link key={r.id} role="listitem" href={`/exports?reel=${r.id}`} data-job={j.state}
            style={{ display: "flex", alignItems: "center", gap: u(14), height: u(58), marginBottom: u(6), padding: `0 ${u(12)}`, background: "#06142a", border: `${u(1.5)} solid ${r.id === e.reel?.id ? "#1e90ff" : "#12335f"}`, borderRadius: u(8), color: "#fff", textDecoration: "none" }}>
            <span style={{ width: u(80), height: u(44), borderRadius: u(4), background: "linear-gradient(135deg,#1b4d8f,#0b2a52)", flex: "none" }} />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "block", fontSize: u(19), fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
              <span style={{ display: "block", fontSize: u(15), color: j.state === "FAILED" ? "#ff8a8a" : "#9fb3cc" }}>
                {j.state === "SUCCEEDED" ? "Rendered" : j.state === "FAILED" ? `Failed: ${j.failure_code ?? ""}` : j.state === "QUEUED" ? "Waiting for the worker" : `Rendering ${j.progress != null ? Math.round(j.progress) + "%" : ""}`}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function Footer({ o }: { o: Outbox }) {
  const { t: dict } = useLocale();
  const e = useExport();
  const r = e.reel?.latest_render ?? null;
  const res = (r?.result ?? null) as { width?: number; height?: number; duration_s?: number; encoder?: string } | null;
  const st = !r ? -1 : r.state === "QUEUED" ? 0 : r.state === "RUNNING" ? 1 : r.state === "SUCCEEDED" ? 4 : r.state === "FAILED" ? 1 : -1;
  const stages: [string, number, number][] = [["Preparing Files", 288, 326], ["Rendering Video", 597, 635], ["Processing Reports", 891, 931], ["Finalizing", 1186, 1229]];
  const made = o.bundle?.items.filter((x) => x.state === "SUCCEEDED").length ?? 0, left = (o.bundle?.items.length ?? 0) - made;
  const reports = o.making ? "Making the files…" : o.bundle ? `${made} made${left ? ` · ${left} not made` : ""}` : "Not requested";
  const say = (i: number) => (st === 4 ? (i === 2 ? reports : "Done") : st === i ? (r?.state === "FAILED" ? "Failed" : r?.state === "QUEUED" ? "Waiting for the worker…" : (r?.stage_message ?? "Working…")) : st > i ? "Done" : "Waiting...");
  const pct = st === 4 ? 1 : r?.progress != null ? Math.max(0, Math.min(1, r.progress / 100)) : 0;
  const ready = r?.state === "SUCCEEDED" && !!e.links;
  const last = o.deliveries?.find((d) => d.state === "SUCCEEDED") ?? null;
  return (
    <section aria-label="Render progress" data-section="p10-s13" data-render-state={r?.state ?? "NONE"}>
      <P x={30} y={1312} w={2510} h={110} />
      <B x={40} y={1326} w={3} h={26} style={{ background: "#1e90ff" }} />
      <T x={57} y={1337} size={22} weight={600} as="h2">{dict.body.exports.renderProgress}</T>
      {stages.map(([l, cx, tx], i) => {
        const done = st === 4 ? i !== 2 || (!!o.bundle && !o.making) : st > i, now = st === i || (st === 4 && i === 2 && o.making);
        return (
          <div key={l} data-stage={l}>
            <B x={cx - 20} y={1322} w={40} h={40} style={{ borderRadius: "50%", background: done ? "#17c27a" : now ? "#0a84ff" : "#0a1d38", border: `${u(2)} solid ${done ? "#17c27a" : now ? "#0a84ff" : "#3a5a88"}`, boxSizing: "border-box", fontSize: u(19), fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{done ? "✓" : i + 1}</B>
            <T x={tx} y={1342} size={22} weight={600}>{l}</T>
            <T x={tx} y={1370} size={18} color={r?.state === "FAILED" && now ? "#ff8a8a" : "#8ea3bf"} style={{ maxWidth: u(240), overflow: "hidden", textOverflow: "ellipsis" }}>{say(i)}</T>
          </div>
        );
      })}
      {[509, 807, 1109].map((x) => <Ic key={x} x={x} y={1340} k="fwd" size={24} color="#3a5a88" />)}
      <B x={270} y={1387} w={1169} h={13} style={{ background: "#0b2a4d", borderRadius: u(7) }}><i style={{ display: "block", height: "100%", width: `${pct * 100}%`, background: "#1e90ff", borderRadius: u(7) }} /></B>
      <B x={1477} y={1335} w={1.5} h={45} style={{ background: "#12335f" }} />
      <B x={1500} y={1330} w={38} h={38} style={{ borderRadius: "50%", background: ready ? "#17c27a" : "#26364d" }} />
      <T x={1561} y={1345} size={22} weight={600}>{!ready ? "Delivery not ready" : last ? "Delivered" : "Ready to deliver"}</T>
      <T x={1561} y={1380} size={18} color="#33a8ff" style={{ maxWidth: u(380), overflow: "hidden", textOverflow: "ellipsis" }}>
        {ready ? `${res?.width ?? "—"}×${res?.height ?? "—"} · ${res?.duration_s ?? "—"} s${last?.link ? ` · link opened ${last.link.opened}×` : ""}` : r?.state === "FAILED" ? "The render failed." : r ? "Rendering…" : "Nothing has been rendered yet."}</T>
      <B x={1948} y={1331} w={243} h={68} style={{ background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(8), opacity: ready ? 1 : 0.7 }} />
      <Ic x={1995} y={1365} k="dl" size={28} /><T x={2040} y={1365} size={22} weight={600}>{dict.body.exports.downloadAll}</T>
      <Hit x={1948} y={1331} w={243} h={68} label={o.picks.length ? `Download All: the render and ${o.picks.length} file${o.picks.length > 1 ? "s" : ""} in one ZIP` : "Download All: the render"}
        {...(!ready ? { reason: "Nothing has been rendered yet" } : o.making ? { reason: "Making the files…" } : o.picks.length && !e.canEdit ? { reason: "Your role can download the render; untick the files" } : { onClick: o.downloadAll })} />
      <B x={2211} y={1331} w={315} h={68} style={{ background: "#0a84ff", borderRadius: u(8), opacity: ready && e.canEdit ? 1 : 0.6 }} />
      <Ic x={2257} y={1365} k="send" size={28} /><T x={2291} y={1365} size={22} weight={600}>{dict.body.exports.deliverToClient}</T>
      <B x={2467} y={1341} w={1.5} h={48} style={{ background: "#4fa8ff" }} /><Ic x={2496} y={1365} k="chev" size={22} />
      <Hit x={2211} y={1331} w={315} h={68} label={dict.body.exports.deliverToClient} {...(!ready ? { reason: "Render the reel first" } : !e.canEdit ? { reason: "Your role can look, not deliver" } : { onClick: () => o.setDialog(true) })} />
      {e.msg && <T x={1561} y={1318} size={15} color={e.msg.ok ? "#3ee6a8" : "#ff8a8a"}>{e.msg.text}</T>}
    </section>
  );
}

/** Branded Overlays: the reel's logo, lower third, match info and intro / outro, as the next render draws them */
function Branding() {
  const { t: dict } = useLocale();
  const e = useExport();
  const b = useMemo(() => branding(e), [e.reel, e.brand]);
  const reel = e.reel;
  const can = !!reel && e.canEdit && !e.busy;
  const why = !reel ? "Open a reel first" : !e.canEdit ? "Your role cannot change this reel" : "Saving the previous change…";
  const firstLogo = b.logos.find((a) => a.rights_ok) ?? null;
  const flip = (k: Brandable) => {
    if (!b.s) return;
    if (k === "logo") {
      if (b.on.logo) return e.setSettings({ custom_logo_id: null, competition_logo_id: null }, "Logo taken out of the render");
      const pick = b.logo ?? firstLogo;
      if (!pick) return;
      return e.setSettings(pick.kind === "CUSTOM_LOGO" ? { custom_logo_id: pick.id } : { competition_logo_id: pick.id }, `Logo ${pick.name} added to the render`);
    }
    if (k === "intro") {
      if (b.on.intro) return e.setSettings({ intro_id: null, outro_id: null }, "Intro and outro taken out of the render");
      window.location.href = `/studio?reel=${reel!.id}`;
      return;
    }
    e.setSettings({ [k]: !b.s[k] }, `${k === "lower_third" ? "Player name" : "Match info"} ${b.s[k] ? "taken out of" : "added to"} the render`);
  };
  const master = () => {
    if (b.any) return e.setSettings({ custom_logo_id: null, competition_logo_id: null, lower_third: false, score_bug: false, intro_id: null, outro_id: null }, "Branding taken out of the render");
    e.setSettings({ lower_third: true, score_bug: true, ...(firstLogo ? (firstLogo.kind === "CUSTOM_LOGO" ? { custom_logo_id: firstLogo.id } : { competition_logo_id: firstLogo.id }) : {}) }, "Branding added to the render");
  };
  const chooseLogo = (id: string) => {
    const a = b.logos.find((x) => x.id === id);
    if (!id) return e.setSettings({ custom_logo_id: null, competition_logo_id: null }, "No logo in the render");
    if (a) e.setSettings({ custom_logo_id: a.kind === "CUSTOM_LOGO" ? a.id : null, competition_logo_id: a.kind === "COMPETITION_LOGO" ? a.id : null }, `Logo ${a.name} in the render`);
  };
  const LINES: [Brandable, string, string][] = [["logo", "Logo Overlay", "the logo chosen in Brand, in the corner of every clip"],
    ["lower_third", "Player Name & Stats", "the player's name, OTSI Player ID and club as each clip starts (no stats: they are not measured)"],
    ["score_bug", "Match Info Banner", "the team names and the match clock from the match halves (the score is not measured)"],
    ["intro", "Custom Intro/Outro", "an intro / outro video chosen in Clip Studio › Graphics"]];
  const summary = !reel ? "Open a reel first" : !b.any ? "No branding in the render" : [b.on.logo && `Logo: ${b.logo?.name ?? "chosen"}`, b.on.lower_third && "Player name", b.on.score_bug && "Match info", b.on.intro && "Intro / outro"].filter(Boolean).join(" · ");
  return (
    <>
      <T x={2345} y={701} size={15} color="#cfe0f5">{dict.body.exports.includeBranding}</T>
      <Switch x={2464} y={700} on={b.any} off={!can} />
      <Hit x={2460} y={686} w={64} h={30} label="Include branding" pressed={b.any} {...(can ? { onClick: master } : { reason: why })} />
      <div className="absolute" style={{ left: u(1851), top: u(735 - 101), width: u(284), height: u(65), boxSizing: "border-box", border: `${u(1.5)} solid #17406f`, borderRadius: u(8), background: "#041022",
        display: "flex", alignItems: "center", gap: u(10), padding: `0 ${u(14)}`, opacity: can ? 1 : 0.7 }} data-brand={b.logo?.id ?? "none"}>
        <span style={{ width: u(36), height: u(36), borderRadius: "50%", border: `${u(4)} solid #1e90ff`, flex: "none" }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: u(b.logo ? 21 : 18), fontWeight: 700, color: b.logo ? "#fff" : "#8ea3bf", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {b.logo ? b.logo.name : b.logos.length ? "No logo chosen" : "No logo uploaded"}</span>
        <span style={{ fontSize: u(20), color: "#8ea3bf" }}>⌄</span>
        <select aria-label="Brand logo" value={b.logo?.id ?? ""} disabled={!can} onChange={(ev) => chooseLogo(ev.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: can ? "pointer" : "not-allowed" }}>
          <option value="">No logo</option>
          {b.logos.map((a) => <option key={a.id} value={a.id} disabled={!a.rights_ok}>{a.name}{a.rights_ok ? "" : " — rights not in force"}</option>)}
        </select>
      </div>
      {LINES.map(([k, l, note], i) => {
        const y = [826, 861, 896, 930][i]!, on = b.on[k];
        return (
          <div key={l} data-branding={l} data-on={String(on)}>
            <B x={1855} y={y - 13} w={26} h={26} style={{ border: `${u(2)} solid ${on ? "#1e90ff" : "#8ea3bf"}`, background: on ? "#1e90ff" : "transparent", borderRadius: u(4), opacity: can ? 1 : 0.6 }} />
            {on && <Ic x={1868} y={y} k="chk" size={14} />}
            <T x={1893} y={y} size={19} color={on ? "#e3eefb" : "#8ea3bf"}>{l}</T>
            <Hit x={1850} y={y - 16} w={200} h={32} label={`${l}: ${note}`} pressed={on} {...(!can ? { reason: why } : k === "logo" && !on && !b.logo && !firstLogo ? { reason: "No logo uploaded yet: upload one with its rights in the Reel Builder (Branding)" } : { onClick: () => flip(k) })} />
          </div>
        );
      })}
      <B x={2067} y={909} w={66} h={40} style={{ ...field, border: `${u(1.5)} solid #17406f`, background: "#041022", opacity: reel ? 1 : 0.7 }} /><T x={2100} y={929} size={17} align="center">Edit</T>
      <Hit x={2067} y={909} w={66} h={40} label="Choose the intro and outro in Clip Studio" {...(reel ? { onClick: () => { window.location.href = `/studio?reel=${reel.id}`; } } : { reason: "Open a reel first" })} />
      <B x={2161} y={735} w={357} h={208} style={{ borderRadius: u(8), background: "radial-gradient(circle at 50% 40%,#4aa0f0,#14407a 55%,#06142a)", opacity: b.any ? 0.9 : 0.55 }} />
      <T x={2339} y={826} size={17} color="#cfe0f5" align="center">The next render draws:</T>
      <T x={2339} y={856} size={19} weight={600} align="center" style={{ maxWidth: u(340), whiteSpace: "normal", textAlign: "center" }}>{summary}</T>
    </>
  );
}

/** Team Collaboration: the organization's members; owners and admins manage the team on Settings › Team */
function Team() {
  const e = useExport();
  const m = e.members;
  const manage = e.canManageTeam ? { onClick: () => { window.location.href = "/settings/team"; } } : { reason: "Only an owner or admin manages the team" };
  return (
    <>
      <T x={2512} y={1009} size={18} color="#33a8ff" align="right">Manage</T>
      <Hit x={2440} y={994} w={80} h={30} label="Manage the team" {...manage} />
      {m === null ? <T x={2140} y={1058} size={18} color="#8ea3bf">Loading…</T> : m.length === 0 ? <T x={2140} y={1058} size={18} color="#8ea3bf">No members yet</T> : (
        <div aria-label={`${m.length} members`} data-members={String(m.length)} className="absolute" style={{ left: u(2140), top: u(1034 - 101), width: u(176), height: u(50), display: "flex", gap: u(6) }}>
          {m.slice(0, 3).map((x) => (
            <span key={x.user_id} title={`${x.display_name} · ${ROLE[x.role] ?? x.role}`}
              style={{ width: u(50), height: u(50), borderRadius: "50%", background: "#0a2b55", border: `${u(1.5)} solid #1e90ff`, color: "#fff", fontSize: u(19), fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{x.display_name.trim().slice(0, 1).toUpperCase() || "?"}</span>
          ))}
          {m.length > 3 && <span title={m.slice(3).map((x) => x.display_name).join(", ")} style={{ alignSelf: "center", fontSize: u(18), color: "#cfe0f5" }}>+{m.length - 3}</span>}
        </div>
      )}
      <B x={2324} y={1034} w={52} h={50} style={{ border: `${u(1.5)} solid ${e.canManageTeam ? "#1e90ff" : "#17406f"}`, borderRadius: "50%", opacity: e.canManageTeam ? 1 : 0.7 }} />
      <Ic x={2350} y={1058} k="plus" size={20} color={e.canManageTeam ? "#33a8ff" : "#8ea3bf"} />
      <Hit x={2324} y={1034} w={52} h={50} label="Invite a member" {...manage} />
    </>
  );
}
