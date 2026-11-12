"use client";
/**
 * Page 10 Sections 06-13 — export tabs, Export Settings, Branded Overlays, Export Queue, Output & Reports, Shareable Link, Team
 * Collaboration, Render Progress, Download All and Deliver to Client (approved reference 10_EXPORT_DELIVERY, right column and bottom),
 * laid out in the page's flow on the Desktop UI components instead of the 2560-px DesignStage composition.
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
import { Check, Cloud, Download, FileText, Film, LayoutTemplate, Plus, Send } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
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
    <p data-formats={String(files.length)} title={about} className="truncate text-xs text-muted">
      {files.length ? (<>Files: {files.map((f, i) => (
        <span key={f.render_id}>{i ? " · " : ""}<button type="button" data-format={`${f.profile}-${f.aspect}`} onClick={() => e.download(f.render_id)}
          className="text-primary underline" aria-label={`Download the ${PROFILE_NAME[f.profile]} file, ${f.aspect}`}>{PROFILE_NAME[f.profile]} {f.aspect}</button></span>
      ))}</>) : about}
    </p>
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

const fieldCls = "rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm text-ink";
const TABS: [string, typeof Cloud, string][] = [["Export", Cloud, "p10-settings"], ["Branding", LayoutTemplate, "p10-branding"],
  ["Reports", FileText, "p10-reports"], ["Delivery", Send, "p10-delivery"]];

export function Right() {
  const { t: dict } = useLocale();
  const e = useExport();
  const reel = e.reel;
  const canEdit = e.canEdit && !e.busy && !!reel;
  const setAspect = (a: ReelAspectT) => { if (reel && a !== reel.aspect) e.setAspect(a); };
  const quality = QUALITY.find(([, b]) => b === e.bitrate)?.[0] ?? "high";
  const qualityLabel = { standard: dict.body.exportstage.qualityStandard, high: dict.body.exportstage.qualityHigh, maximum: dict.body.exportstage.qualityMaximum }[quality];
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-label="Export tabs" data-section="p10-s06" className="vie-panel p-3">
        <div role="tablist" aria-label="Export workspace" className="flex flex-wrap gap-1">
          {TABS.map(([l, Icon], i) => (
            <button key={l} type="button" role="tab" aria-label={l} aria-pressed={e.tab === i} onClick={() => e.jump(i)}
              className={`flex items-center gap-1.5 rounded-md border-b-2 px-3 py-2 text-sm ${e.tab === i ? "border-primary font-semibold text-primary" : "border-transparent text-ink hover:bg-raised"}`}>
              <Icon className="h-4 w-4" aria-hidden />{l}
            </button>
          ))}
        </div>
        {note && <p role="status" className="mt-2 text-xs text-muted">{note}</p>}
      </section>

      <section id="p10-settings" aria-label="Export settings" data-section="p10-s07" data-codec={e.codec} data-bitrate={e.bitrate}
        className={`vie-panel p-3 ${e.focus === "p10-settings" ? "border-primary" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="t-panel">{dict.body.exports.exportSettings}</h2>
          <button type="button" aria-label="Reset the export settings" onClick={e.reset} className="text-sm text-primary hover:underline">Reset</button>
        </div>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span>{dict.body.exports.outputPreset}</span>
            <select aria-label={dict.body.exports.outputPreset} value={e.preset}
              onChange={(ev) => e.setPreset(ev.target.value)} className={fieldCls}>
              {e.presets.map((p) => <option key={p.id} value={p.id}>{p.scope === "BUILT_IN" ? p.name : `${p.name} (${p.scope === "PERSONAL" ? "mine" : "organization"})`}</option>)}
            </select>
          </label>
          {/* B.22 (ADR-097): the preset library */}
          <button type="button" data-open-presets="" onClick={e.openLibrary} title="Choose, save or delete export presets"
            className="self-start text-sm text-primary underline">{dict.body.exports.exportPresets}…</button>
          <Formats e={e} />
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span>{dict.body.exports.resolution}</span>
              <select aria-label="Resolution" value="src" onChange={() => { /* the renderer keeps the source resolution */ }} className={fieldCls}>
                <option value="src">Same as source</option>
                <option value="4k" disabled>4K (3840 × 2160) — the renderer keeps the source resolution</option>
                <option value="hd" disabled>Full HD (1920 × 1080) — the renderer keeps the source resolution</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{dict.body.exports.frameRate}</span>
              <select aria-label="Frame rate" value="src" onChange={() => { /* the renderer keeps the source frame rate */ }} className={fieldCls}>
                <option value="src">Source</option>
                <option value="60" disabled>60 fps — the renderer keeps the source frame rate</option>
                <option value="30" disabled>30 fps — the renderer keeps the source frame rate</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm">{dict.body.reels.aspectRatio}</legend>
            <div role="radiogroup" aria-label="Aspect ratio" className="grid grid-cols-4 gap-2">
              {([["16:9", "Landscape"], ["9:16", "Vertical"], ["1:1", "Square"], ["4:5", "Social"]] as const).map(([a, d]) => {
                const on = reel?.aspect === a || (!reel && a === "16:9");
                return (
                  <button key={a} type="button" role="radio" aria-checked={on} aria-label={`Aspect ratio ${a}`}
                    onClick={() => (canEdit ? setAspect(a) : setNote(reel ? "You cannot edit this reel" : "Open a reel first"))}
                    className={`rounded-md border px-1 py-2 text-center ${on ? "border-primary bg-raised" : "border-line bg-transparent hover:bg-raised"}`}>
                    <span className={`block text-sm font-semibold ${on ? "text-primary" : ""}`}>{a}</span>
                    <span className={`block text-xs ${on ? "text-primary" : "text-muted"}`}>{d}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span>{dict.body.exports.fileFormat}</span>
              <select aria-label="File format" value={e.codec} onChange={(ev) => e.setCodec(ev.target.value as typeof e.codec)} className={fieldCls}>
                {FORMATS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>{dict.body.exports.quality}</span>
              <select aria-label="Quality" value={quality} onChange={(ev) => e.setBitrate(QUALITY.find(([l]) => l === ev.target.value)![1])} className={fieldCls}>
                {QUALITY.map(([l]) => <option key={l} value={l}>{({ standard: dict.body.exportstage.qualityStandard, high: dict.body.exportstage.qualityHigh, maximum: dict.body.exportstage.qualityMaximum } as Record<string, string>)[l]}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            {/* C.3 (ADR-103): OpenTimelineIO (.otio) and .otsi-reel manifest interchange */}
            <button type="button" data-open-interchange="" onClick={e.openInterchange} disabled={!reel}
              title={reel ? "Export OpenTimelineIO (.otio) and .otsi-reel manifest with evidence flags" : "Open a reel first"}
              className="text-sm text-primary underline disabled:opacity-50">Interchange…</button>
            {/* ADR-142: the Single Match Spotlight / Scouting Pack — the paid bundle (reel + report + published brief, 10 tokens) */}
            <button type="button" data-open-scouting-pack="" onClick={e.openScoutingPack} disabled={!reel}
              title={reel ? "Build the Scouting Pack for the club: reel, player report and published AI Analyst brief in one download (10 tokens)" : "Open a reel first"}
              className="text-sm text-primary underline disabled:opacity-50">Scouting Pack…</button>
          </div>
          <p className="text-xs text-muted">{e.codec === "h264" ? "Best compatibility, high quality, smaller file size." : e.codec === "av1" ? "Royalty-free, smaller files, plays in modern browsers." : "Royalty-free WebM, plays in modern browsers."}</p>
          <p className="text-xs text-muted">Quality: {qualityLabel} · {e.bitrate} Mbps</p>
        </div>
      </section>

      <section id="p10-branding" aria-label="Branded overlays" data-section="p10-s08" className={`vie-panel p-3 ${e.focus === "p10-branding" ? "border-primary" : ""}`}>
        <h2 className="t-panel">Branded Overlays</h2>
        <Branding />
      </section>

      <DeliverDialog e={e} o={e.outbox} />
    </div>
  );
}

/** the bottom row of the Export page: the render queue, Output & Reports, the Shareable Link and Team Collaboration */
export function ExportBottom() {
  const { t: dict } = useLocale();
  const e = useExport();
  const o = e.outbox;
  // the queue rows are filtered and sorted once per reels read, not once per render (and not once per section that reads them)
  const queueRows = useMemo(() => (e.reels ?? []).filter((r) => r.latest_render && !(r.latest_render.cleared && !active(r)))
    .sort((a, b) => (active(b) ? 1 : 0) - (active(a) ? 1 : 0)), [e.reels]);
  const finishedCount = useMemo(() => queueRows.filter((r) => r.latest_render && !r.latest_render.cleared && !active(r)).length, [queueRows]);
  const tw = e.canEdit ? undefined : "Your role can look, not deliver";
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
      <section aria-label="Export queue" data-section="p10-s09" data-queue={String(queueRows.length)} className="vie-panel p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="t-panel">{`Export Queue (${queueRows.length})`}</h2>
          <ClearAll finished={finishedCount} />
        </div>
        <Queue rows={queueRows} />
      </section>

      <section id="p10-reports" aria-label="Output and reports" data-section="p10-s10" className={`vie-panel p-3 ${e.focus === "p10-reports" ? "border-primary" : ""}`}>
        <h2 className="t-panel">Output &amp; Reports</h2>
        <Reports e={e} o={o} />
      </section>

      <SharePanel focus={e.focus === "p10-delivery"} />

      <section aria-label="Team collaboration" data-section="p10-s12" className="vie-panel p-3">
        <h2 className="t-panel">Team Collaboration</h2>
        <Team />
        {([["Notify team when ready", o.notifyTeam, o.setNotifyTeam], ["Notify client", o.notifyClient, o.setNotifyClient]] as const).map(([l, on, set]) => (
          <div key={l} data-notify={l} data-on={String(on)} className="mt-2 flex items-center justify-between gap-2 text-sm">
            <span className={on ? "" : "text-muted"}>{l}</span>
            <button type="button" role="switch" aria-checked={on} aria-label={l} aria-disabled={!!tw || undefined} className="vie-sw"
              onClick={() => (tw ? setNote(tw) : set(!on))} title={tw} />
          </div>
        ))}
        {note && <p role="status" className="mt-1.5 text-xs text-muted">{note}</p>}
        <label className="mt-2 block text-xs text-muted">{dict.body.exports.message}
          <textarea aria-label="Message for recipients" placeholder="Add a message for recipients (optional)" maxLength={MESSAGE_MAX} disabled={!e.canEdit} value={o.message} onChange={(x) => o.setMessage(x.target.value)}
            className="mt-1 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm text-ink" rows={3} />
        </label>
        <p className="text-right text-xs text-muted">{`${o.message.length}/${MESSAGE_MAX}`}</p>
      </section>
    </div>
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
    <span className="flex items-center gap-2">
      {msg && <span className="text-xs text-muted">{msg}</span>}
      <button type="button" aria-label={`Clear all finished renders (${finished})`} title={finished ? undefined : "No finished render in the queue"}
        onClick={() => {
          if (!e.canEdit) return setMsg("Your role can look, not change the queue");
          if (!finished) return setMsg("No finished render in the queue");
          run();
        }} className="text-sm text-primary hover:underline">Clear All</button>
    </span>
  );
}

function Queue({ rows }: { rows: Reel[] }) {
  const { t: dict } = useLocale();
  const e = useExport();
  const shown = rows.slice(0, 4);
  if (e.reels === null && !e.reelsFailed) return <p className="py-4 text-center text-sm text-muted">Loading the render queue…</p>;
  if (e.reelsFailed) return (
    <div className="py-4 text-center">
      <p className="text-sm text-muted">{dict.body.exports.renderQueueNotLoaded}</p>
      <button type="button" aria-label="Try again: read the reels again" onClick={() => void e.reload()} className="vie-btn mt-2">{dict.common.retry}</button>
    </div>
  );
  if (!shown.length) return <p className="py-4 text-center text-sm text-muted">{dict.body.exports.noRenderJobs}</p>;
  return (
    <div role="list" aria-label="Render jobs" className="mt-2 flex max-h-[245px] flex-col gap-1.5 overflow-y-auto">
      {shown.map((r) => {
        const j = r.latest_render!;
        return (
          <Link key={r.id} role="listitem" href={`/exports?reel=${r.id}`} data-job={j.state}
            className={`flex items-center gap-3 rounded-md border px-2.5 py-2 ${r.id === e.reel?.id ? "border-primary bg-raised" : "border-line bg-raised/40 hover:border-primary/60"}`}>
            <span className="grid h-11 w-20 shrink-0 place-items-center rounded border border-line bg-p0 text-muted" aria-hidden>
              <Film className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{r.name}</span>
              <span className={`block truncate text-xs ${j.state === "FAILED" ? "text-danger" : "text-muted"}`}>
                {j.state === "SUCCEEDED" ? "Rendered" : j.state === "FAILED" ? `Failed: ${j.failure_code ?? ""}` : j.state === "QUEUED" ? "Waiting for the worker" : `Rendering ${j.progress != null ? Math.round(j.progress) + "%" : ""}`}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** Render Progress, Download All and Deliver to Client — the foot of the Export page */
export function ExportFooter() {
  const { t: dict } = useLocale();
  const e = useExport();
  const o = e.outbox;
  const r = e.reel?.latest_render ?? null;
  const res = (r?.result ?? null) as { width?: number; height?: number; duration_s?: number; encoder?: string } | null;
  const st = !r ? -1 : r.state === "QUEUED" ? 0 : r.state === "RUNNING" ? 1 : r.state === "SUCCEEDED" ? 4 : r.state === "FAILED" ? 1 : -1;
  const stages: [string][] = [["Preparing Files"], ["Rendering Video"], ["Processing Reports"], ["Finalizing"]];
  const made = o.bundle?.items.filter((x) => x.state === "SUCCEEDED").length ?? 0, left = (o.bundle?.items.length ?? 0) - made;
  const reports = o.making ? "Making the files…" : o.bundle ? `${made} made${left ? ` · ${left} not made` : ""}` : "Not requested";
  const say = (i: number) => (st === 4 ? (i === 2 ? reports : "Done") : st === i ? (r?.state === "FAILED" ? "Failed" : r?.state === "QUEUED" ? "Waiting for the worker…" : (r?.stage_message ?? "Working…")) : st > i ? "Done" : "Waiting...");
  const pct = st === 4 ? 1 : r?.progress != null ? Math.max(0, Math.min(1, r.progress / 100)) : 0;
  const ready = r?.state === "SUCCEEDED" && !!e.links;
  const last = o.deliveries?.find((d) => d.state === "SUCCEEDED") ?? null;
  const [note, setNote] = useState<string | null>(null);
  return (
    <section aria-label="Render progress" data-section="p10-s13" data-render-state={r?.state ?? "NONE"} className="vie-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-panel">{dict.body.exports.renderProgress}</h2>
        {e.msg && <p role="status" className={`text-xs ${e.msg.ok ? "text-ok" : "text-danger"}`}>{e.msg.text}</p>}
        {note && <p role="status" className="text-xs text-muted">{note}</p>}
      </div>
      <ol className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {stages.map(([l], i) => {
          const done = st === 4 ? i !== 2 || (!!o.bundle && !o.making) : st > i, now = st === i || (st === 4 && i === 2 && o.making);
          return (
            <li key={l} data-stage={l} className="flex items-start gap-2 rounded-md border border-line/60 bg-raised/40 p-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-ok text-white" : now ? "bg-primary text-white" : "border border-line bg-panel text-muted"}`} aria-hidden>
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{l}</span>
                <span className={`block truncate text-xs ${r?.state === "FAILED" && now ? "text-danger" : "text-muted"}`}>{say(i)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={dict.body.exports.renderProgress}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className={`flex h-8 w-8 items-center justify-center rounded-full ${ready ? "bg-ok text-white" : "bg-raised text-muted"}`} aria-hidden>
          {ready ? <Check className="h-4 w-4" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{!ready ? "Delivery not ready" : last ? "Delivered" : "Ready to deliver"}</span>
          <span className="block truncate text-sm text-primary">
            {ready ? `${res?.width ?? "—"}×${res?.height ?? "—"} · ${res?.duration_s ?? "—"} s${last?.link ? ` · link opened ${last.link.opened}×` : ""}` : r?.state === "FAILED" ? "The render failed." : r ? "Rendering…" : "Nothing has been rendered yet."}
          </span>
        </span>
        <button type="button" aria-label={o.picks.length ? `Download All: the render and ${o.picks.length} file${o.picks.length > 1 ? "s" : ""} in one ZIP` : "Download All: the render"}
          onClick={() => {
            if (!ready) return setNote("Nothing has been rendered yet");
            if (o.making) return setNote("Making the files…");
            if (o.picks.length && !e.canEdit) return setNote("Your role can download the render; untick the files");
            o.downloadAll();
          }} className="vie-btn">
          <Download className="h-4 w-4" aria-hidden />{dict.body.exports.downloadAll}
        </button>
        <button type="button" aria-label={dict.body.exports.deliverToClient}
          onClick={() => {
            if (!ready) return setNote("Render the reel first");
            if (!e.canEdit) return setNote("Your role can look, not deliver");
            o.setDialog(true);
          }} className="vie-btn vie-btn-pri">
          <Send className="h-4 w-4" aria-hidden />{dict.body.exports.deliverToClient}
        </button>
      </div>
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
  const [note, setNote] = useState<string | null>(null);
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
    <div className="mt-2 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{dict.body.exports.includeBranding}</span>
        <button type="button" role="switch" aria-checked={b.any} aria-label="Include branding" title={can ? undefined : why} className="vie-sw"
          onClick={() => (can ? master() : setNote(why))} />
      </div>
      <label className="flex items-center gap-2 rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-primary text-xs font-semibold" aria-hidden>
          {b.logo ? b.logo.name.slice(0, 1).toUpperCase() : "—"}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">{b.logo ? b.logo.name : b.logos.length ? "No logo chosen" : "No logo uploaded"}</span>
        <select aria-label="Brand logo" value={b.logo?.id ?? ""} disabled={!can} onChange={(ev) => chooseLogo(ev.target.value)}
          className="rounded border border-line bg-raised px-1 py-1 text-sm disabled:opacity-60">
          <option value="">No logo</option>
          {b.logos.map((a) => <option key={a.id} value={a.id} disabled={!a.rights_ok}>{a.name}{a.rights_ok ? "" : " — rights not in force"}</option>)}
        </select>
      </label>
      <ul className="flex flex-col gap-1.5">
        {LINES.map(([k, l, noteText]) => {
          const on = b.on[k];
          return (
            <li key={l} data-branding={l} data-on={String(on)}>
              <button type="button" role="checkbox" aria-checked={on} aria-label={`${l}: ${noteText}`}
                onClick={() => {
                  if (!can) return setNote(why);
                  if (k === "logo" && !on && !b.logo && !firstLogo) return setNote("No logo uploaded yet: upload one with its rights in the Reel Builder (Branding)");
                  flip(k);
                }}
                className="flex w-full items-center gap-2 rounded-md border border-line/60 px-2 py-1.5 text-left text-sm hover:bg-raised">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-white" : "border-muted text-transparent"}`} aria-hidden>
                  {on ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className={on ? "" : "text-muted"}>{l}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-label="Choose the intro and outro in Clip Studio"
          onClick={() => (reel ? (window.location.href = `/studio?reel=${reel.id}`) : setNote("Open a reel first"))}
          className="vie-btn vie-btn-sm">Edit</button>
        <p className="min-w-0 flex-1 text-sm">
          <span className="text-muted">The next render draws: </span>
          <span className="font-semibold">{summary}</span>
        </p>
      </div>
      {note && <p role="status" className="text-xs text-muted">{note}</p>}
    </div>
  );
}

/** Team Collaboration: the organization's members; owners and admins manage the team on Settings › Team */
function Team() {
  const e = useExport();
  const m = e.members;
  const manage = e.canManageTeam ? { onClick: () => { window.location.href = "/settings/team"; } } : { reason: "Only an owner or admin manages the team" };
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2" aria-label={`${m?.length ?? 0} members`} data-members={String(m?.length ?? 0)}>
          {m === null ? <span className="text-sm text-muted">Loading…</span> : m.length === 0 ? <span className="text-sm text-muted">No members yet</span> : (
            <>
              {m.slice(0, 3).map((x) => (
                <span key={x.user_id} title={`${x.display_name} · ${ROLE[x.role] ?? x.role}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-primary bg-raised text-sm font-semibold">{x.display_name.trim().slice(0, 1).toUpperCase() || "?"}</span>
              ))}
              {m.length > 3 && <span title={m.slice(3).map((x) => x.display_name).join(", ")} className="text-sm text-ink">+{m.length - 3}</span>}
            </>
          )}
        </span>
        <button type="button" aria-label="Invite a member" title={e.canManageTeam ? undefined : manage.reason}
          onClick={() => (e.canManageTeam ? (window.location.href = "/settings/team") : setNote("Only an owner or admin manages the team"))}
          className="vie-ib"><Plus className="h-4 w-4" aria-hidden /></button>
        <button type="button" aria-label="Manage the team" title={e.canManageTeam ? undefined : manage.reason}
          onClick={() => (e.canManageTeam ? (window.location.href = "/settings/team") : setNote("Only an owner or admin manages the team"))}
          className="text-sm text-primary hover:underline">Manage</button>
      </div>
      {note && <p role="status" className="text-xs text-muted">{note}</p>}
    </div>
  );
}
