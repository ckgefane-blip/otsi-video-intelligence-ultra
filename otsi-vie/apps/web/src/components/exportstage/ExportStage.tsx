"use client";
/**
 * Page 10 Export & Delivery on the approved composition (corrected reference 10_EXPORT_DELIVERY). The reel comes from the address
 * (?reel=); without one the page opens on the reel being rendered, else the newest reel with a render, else shows the reference's empty
 * state. Reels and their renders are polled while one renders. The export settings that exist (video format, quality, aspect, and the
 * E3 Output Preset: the reel, a scout + social pair, or an archive master) are sent with the render; nothing else is invented.
 */
import { BUILTIN_PRESETS, type BatchRenderResult, type BrandAsset, type ExportPreset, type Match, type Member, type Playback, type Reel, type Video } from "@otsi-vie/contracts";
import { renderedState } from "@/components/studio/spotlight";
import { ExportPreflight } from "./ExportPreflight";
import { InterchangeDialog } from "./Interchange";
import { PresetLibrary } from "./PresetLibrary";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { DesignStage } from "@/components/stage/DesignStage";
import { api, ApiProblem } from "@/lib/api";
import { isUuid } from "@/lib/identity";
import { Preview, Summary, Workflow } from "./Centre";
import { useOutbox } from "./Deliver";
import { Right } from "./Right";
import { active, ExportProvider, type Codec, type ExportState, type Links, type Preset } from "./state";
import { typing } from "@/lib/keymap";

const WRITERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR"];
const TAB_TARGET = ["p10-settings", "p10-branding", "p10-reports", "p10-delivery"];

export function ExportStage() {
  const { organization } = useAuth();
  const router = useRouter();
  const want = useSearchParams().get("reel");
  const [reels, setReels] = useState<Reel[] | null>(null);
  // a failed reels read is named, never shown as empty (Blueprint §4): the read keeps the last good list, if any
  const [reelsErr, setReelsErr] = useState(false);
  const [links, setLinks] = useState<Links | null>(null);
  const [match, setMatch] = useState<ExportState["match"]>(null);
  const [codec, setCodec] = useState<Codec>("h264");
  const [bitrate, setBitrate] = useState(8);
  const [preset, setPresetId] = useState<Preset>("builtin-reel");
  // B.22 (ADR-097): the preset library (built in until the organization's and the member's own are read), the library and preflight dialogs
  const [presets, setPresets] = useState<ExportPreset[]>(BUILTIN_PRESETS);
  const [library, setLibrary] = useState(false);
  const [interchange, setInterchange] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const loadPresets = useCallback(() => api<ExportPreset[]>("/v1/export-presets").then(setPresets, () => setPresets(BUILTIN_PRESETS)), []);
  useEffect(() => { void loadPresets(); }, [loadPresets]);
  const chosen = useMemo(() => presets.find((p) => p.id === preset) ?? BUILTIN_PRESETS[0]!, [presets, preset]);
  /** choosing a preset that keeps a format and quality sets them on the page too */
  const setPreset = useCallback((id: Preset) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (p?.spec.codec) setCodec(p.spec.codec);
    if (p?.spec.bitrate_mbps) setBitrate(p.spec.bitrate_mbps);
  }, [presets]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ExportState["msg"]>(null);
  const [tab, setTab] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [brand, setBrand] = useState<BrandAsset[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  useEffect(() => {
    void api<BrandAsset[]>("/v1/brand-assets").then(setBrand, () => setBrand([]));
    void api<Member[]>("/v1/members").then(setMembers, () => setMembers([]));
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);   // the focus highlight never outlives the page
  /** move between the export tabs (lib/keymap.ts, Exports scope): only here, never while typing or with a dialog open */
  const jump = useCallback((i: number) => {
    setTab(i);
    const id = TAB_TARGET[i]!;
    setFocus(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocus((f) => (f === id ? null : f)), 1600);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || library || interchange || confirm) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "]") jump(Math.min(TAB_TARGET.length - 1, tab + 1));
      else if (e.key === "[") jump(Math.max(0, tab - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, jump, library, interchange, confirm]);

  const load = useCallback(() => api<Reel[]>("/v1/reels").then((r) => { setReels(r); setReelsErr(false); }, () => setReelsErr(true)), []);
  useEffect(() => { void load(); }, [load]);
  const anyActive = !!reels?.some(active);
  useEffect(() => { if (!anyActive) return; const t = setInterval(() => void load(), 2000); return () => clearInterval(t); }, [anyActive, load]);

  const valid = !!want && isUuid(want);
  const reel = valid ? reels?.find((r) => r.id === want) ?? null : null;
  // open on what is rendering, else the newest reel that has a render
  useEffect(() => {
    if (valid || !reels?.length) return;
    const pick = reels.find(active) ?? reels.find((r) => !!r.last_good_render) ?? null;
    if (pick) router.replace(`/exports?reel=${pick.id}`, { scroll: false });
  }, [valid, reels, router]);

  const renderId = reel?.last_good_render?.has_output ? reel.last_good_render.id : null;   // the finished file, even while a new render runs
  useEffect(() => {
    setLinks(null);
    if (renderId) void api<Links>(`/v1/renders/${renderId}/playback`).then(setLinks, () => setLinks(null));
  }, [renderId]);
  const videoId = reel?.video_id ?? null;
  useEffect(() => {
    setMatch(null);
    if (!videoId) return;
    void api<Video>(`/v1/videos/${videoId}`).then((v) => (v.match_id ? api<Match>(`/v1/matches/${v.match_id}`) : null)).then((m) => {
      if (m) setMatch({ title: `${m.home?.name ?? "—"} vs ${m.away?.name ?? "—"}`, competition: m.competition ?? "—", date: m.kickoff_at ? new Date(m.kickoff_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—" });
    }, () => undefined);
  }, [videoId]);

  const fail = useCallback((x: unknown, d: string) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : d }), []);
  const reload = useCallback(async () => { await load(); }, [load]);
  const canEdit = !!organization && WRITERS.includes(organization.role);
  const canManageTeam = !!organization && ["OWNER", "ADMIN"].includes(organization.role);
  // the provider value is memoised: the page polls the reels every 2 s while a render runs, and that must not re-render every consumer
  const base: Omit<ExportState, "outbox"> = useMemo(() => ({
    reels, reel, reload, canEdit, busy, msg, codec, setCodec, bitrate, setBitrate, links, match, tab, focus, autoChapters: auto, setAutoChapters: setAuto,
    brand, members, canManageTeam, reelsFailed: reelsErr,
    setSettings: (patch, ok) => {
      if (!reel) return;
      setBusy(true); setMsg(null);
      void api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, settings: patch } })
        .then(() => { setMsg({ ok: true, text: ok }); return load(); }, (x) => fail(x, "The branding was not saved.")).finally(() => setBusy(false));
    },
    reset: () => { setCodec("h264"); setBitrate(8); setPresetId("builtin-reel"); setMsg({ ok: true, text: "Export settings reset." }); },
    preset, setPreset, presets, openLibrary: () => setLibrary(true), openInterchange: () => setInterchange(true),
    download: (id) => { void api<Links>(`/v1/renders/${id}/playback`).then((l) => { window.location.href = l.download_url; }, (x) => fail(x, "That file cannot be downloaded.")); },
    setAspect: (a) => {
      if (!reel) return;
      setBusy(true); setMsg(null);
      void api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, aspect: a } }).then(() => load(), (x) => fail(x, "The aspect ratio was not saved.")).finally(() => setBusy(false));
    },
    // B.22 (ADR-097): Export opens the preflight; its Start makes every file of the preset in one batch request
    render: () => { if (reel) setConfirm(true); },
    pick: () => router.push("/exports"),
    jump,
  }), [reels, reel, reload, canEdit, busy, msg, codec, bitrate, links, match, tab, focus, auto, brand, members, canManageTeam, reelsErr, setPreset, presets, jump, load, fail, router]);
  const start = () => {
    if (!reel) return;
    setConfirm(false); setBusy(true); setMsg(null);
    void api<BatchRenderResult>(`/v1/reels/${reel.id}/renders/batch`, { method: "POST", json: { outputs: chosen.spec.outputs, codec, bitrate_mbps: bitrate, loudness_lufs: chosen.spec.loudness_lufs },
      headers: { "idempotency-key": `batch-${reel.id}-${reel.version}-${chosen.id}-${codec}-${bitrate}-${Date.now()}` } })
      .then((r) => {
        const n = r.started.length, s = r.skipped.length;
        setMsg({ ok: n > 0, text: n ? `Rendering ${n} file${n === 1 ? "" : "s"}${n > 1 ? ", one after the other" : ""}.${s ? ` ${s} already rendering, skipped.` : ""}` : "Every file of this preset is already rendering." });
        return load();
      }, (x) => { fail(x, "The render could not be started."); return load(); }).finally(() => setBusy(false));
  };
  const outbox = useOutbox(base);
  const state: ExportState = useMemo(() => ({ ...base, outbox }), [base, outbox]);
  return (
    <DesignStage page="exports" background="#000a16">
      <ExportProvider value={state}>
        <Workflow />
        <Summary />
        <Preview />
        <Right />
      </ExportProvider>
      {reel && <ExportPreflight reel={reel} preset={chosen} codec={codec} bitrate={bitrate} upToDate={renderedState(reel).reel.state === "RENDERED"} canWrite={!!organization && WRITERS.includes(organization.role)} open={confirm} onOpenChange={setConfirm} onStart={start} />}
      <PresetLibrary presets={presets} canAdmin={!!organization && ["OWNER", "ADMIN"].includes(organization.role)} canSave={!!organization && WRITERS.includes(organization.role)}
        codec={codec} bitrate={bitrate} open={library} onOpenChange={setLibrary} reload={async () => { await loadPresets(); }} choose={setPreset} />
      <InterchangeDialog reel={reel} presetId={chosen.id} canWrite={!!organization && WRITERS.includes(organization.role)} open={interchange} onOpenChange={setInterchange} />
    </DesignStage>
  );
}
