"use client";
/**
 * Page 06 Reel Builder, rebuilt to the SOT (Page 20, Reels.dc.html).
 *
 * Three columns inside a viewport-height row, like the SOT: the left Reel settings sidebar (Best moment rule v2.1 — moments source,
 * length with the per-match caps, tier legend, Build reel pinned in the footer), the centre (Reel Builder header, the reel summary, the
 * budget bar, the preview capped at 700 px, the Sequence with the Profile intro fixed first), and the right Clip inspector (the selected
 * clip's details, or "No clip selected"). The row is constrained to the height AppMain gives it, so each column scrolls on its own and
 * the Build reel footer stays visible; the page chrome (header, summary, Budget, Sequence) renders with honest empty values when no reel
 * is open. There is no Spotlight/Overlays/Branding inspector, no Suggested Moments or Timeline section, no render-confirmation dialog
 * (Build reel starts the render directly), no cross-match creation flow, no auto-opening Profile intro modal, and no preview overlays.
 * The Profile intro lives in the Sequence as a card.
 *
 * With a reel id it works on that reel through the Reel Builder context (clips, moments, render); without one it shows the builder's
 * empty state and the organization's reels to open. The stage carries the draft (spotlight settings + name, saved by the inspector),
 * the tab/focus jump target and the preview mode; the old inspector/moments/confirm/spotlight modules were deleted in the
 * reconciliation pass (2026-11-13), so nothing here references them.
 */
import type { Reel, SpotlightSettings } from "@otsi-vie/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReelBuilder, useReel, type ReelState } from "@/components/reels/ReelBuilder";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { typing } from "@/lib/keymap";
import { DEFAULTS, StageProvider, useDirty, useStage, type ReelLengthS, type Stage } from "./shared";
import { ConfirmRender } from "./ConfirmRender";
import { PreviewPanel } from "./PreviewPanel";

/** minutes without a leading zero, for the budget bar ("0:00 of 5:00") */
const mss = (us: number) => `${Math.floor(us / 6e7)}:${String(Math.floor(us / 1e6) % 60).padStart(2, "0")}`;
/** the render state as a word in the current language (API states are codes, never shown raw) */
const renderWord = (state: string | null | undefined, d: Dictionary["body"]["reels"]) =>
  state === "SUCCEEDED" ? d.renderStateSucceeded : state === "FAILED" ? d.renderStateFailed : state === "QUEUED" ? d.renderStateQueued : state === "RUNNING" ? d.renderStateRunning : d.renderStateNotRendered;
/** the per-match cap for a target length (Best moment rule v2.1): 90 s → 3, 3 min → 4, 5 min → 5; Tier S is exempt */
const capOf = (s: ReelLengthS) => (s === 90 ? 3 : s === 300 ? 5 : 4);

/* ------------------------------------------------------------------ left: Reel settings */
function ReelSettingsSidebar() {
  const { t: dict } = useLocale();
  const { r, lengthS, setLengthS, lengthFixed, buildReel, setBuildOpen, buildOpen, draft, dirty } = useStage();
  const reel = r?.reel ?? null;
  const d = dict.body.reels;
  const router = useRouter();
  // "All matches" makes a NEW cross-match reel for the same player (the reel being looked at is untouched); "This match" is the reel.
  // Owner 2026-11-13: cross-match creation stays here (the SOT rebuild had removed its only entry point).
  const [mode, setMode] = useState<"MATCH" | "ALL_MATCHES">("MATCH");
  const [crossLength, setCrossLength] = useState<ReelLengthS>(180);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canEdit = !!r?.canEdit && !r.busy && !!reel;
  const create = async () => {
    if (!reel?.player) return;
    setCreating(true); setErr(null);
    try {
      const created = await api<{ id: string }>("/v1/reels", { method: "POST",
        json: { source: "ALL_MATCHES", length_s: crossLength, player_id: reel.player.player_id } });
      router.push(`/reels/${created.id}`);
    } catch (x) { setErr(x instanceof ApiProblem ? x.message : dict.body.analysis.thatDidNotWork); } finally { setCreating(false); }
  };
  const render = reel?.latest_render ?? null;
  const active = !!render && ["QUEUED", "RUNNING"].includes(render.state);
  const buildReason = !reel ? dict.body.reelstage.openReelFirst : !r?.canEdit ? dict.body.reelstage.cannotEdit : reel.stale ? dict.body.reelstage.genReasonStale
    : reel.clips.length === 0 && !active ? dict.body.reelstage.genReasonNoClips : undefined;
  const lengths: [ReelLengthS, string][] = [[90, d.sourceUpTo90], [180, d.sourceUpTo180], [300, d.sourceUpTo300]];
  const tiers: [string, string, string][] = [
    ["S", d.rbTierS, "rgba(43,212,176,.16)|rgb(var(--primary))"],
    ["A", d.rbTierA, "rgba(120,172,255,.16)|rgb(var(--cyan))"],
    ["B", d.rbTierB, "rgba(237,181,79,.16)|rgb(var(--amber))"],
    ["C", d.rbTierC, "|rgb(var(--ink2))"],
  ];
  return (
    <aside className="side" aria-label={d.rbSettings} style={{ flex: "0 0 300px", maxWidth: 300, overflowY: "auto", minHeight: 0 }}>
      <div className="ph" style={{ minHeight: 44 }}><h2 className="h3">{d.rbSettings}</h2><span className="sm mu">{d.rbRule}</span></div>
      <div className="sect" style={{ gap: 8 }}>
        <span className="eb">{d.rbMomentsFrom}</span>
        {reel?.source === "ALL_MATCHES" ? (
          <p className="t-body" data-reel-source="ALL_MATCHES">{d.crossSourceSummary.replace("{a}", reel.cross_match_length_s === 90 ? d.len90s : reel.cross_match_length_s === 300 ? d.len5min : d.len3min).replace("{b}", reel.best_moments_rule_version ?? "2.1")}</p>
        ) : (
          <>
            <div className="seg f" role="group" aria-label={d.rbMomentsFrom}>
              <button type="button" className={mode === "MATCH" ? "on" : ""} aria-pressed={mode === "MATCH"} onClick={() => setMode("MATCH")}>{d.sourceThisMatch}</button>
              <button type="button" className={mode === "ALL_MATCHES" ? "on" : ""} aria-pressed={mode === "ALL_MATCHES"} disabled={!reel?.player} onClick={() => setMode("ALL_MATCHES")}>{d.sourceAllMatches}</button>
            </div>
            {mode === "ALL_MATCHES" && reel?.player && (
              <>
                <p className="hint">{d.sourceOneReel.replace("{a}", reel.player.display_name).replace("{b}", crossLength === 90 ? d.sourceUpTo90 : crossLength === 180 ? d.sourceUpTo180 : d.sourceUpTo300)}</p>
                <button type="button" disabled={!canEdit || creating} onClick={() => void create()} className="btn pri w">{d.sourceCreate}</button>
                {err && <p role="alert" className="text-xs text-danger">{err}</p>}
              </>
            )}
          </>
        )}
      </div>
      <div className="sect" style={{ gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span className="eb">{d.rbLength}</span><span className="sm mu">{d.rbNeverOver}</span></div>
        {/* one length seg (SOT): the reel's target length. Measured in Chromium with real Inter 500 (2026-11-13): at the SOT's
            13px/12px-padding the longest label ("90 Sekunden", 82px) needs 94px in an 87px slot and truncates; at 12px with 4px
            side padding it needs 85px and reads in full in every locale — so the buttons are 12px/4px, not the shared 13px/12px. */}
        <div className="seg f" role="group" aria-label={d.rbLength}>
          {lengths.map(([s, label]) => {
            // for "This match" it is the reel's target length; for "All matches" it is the new cross-match reel's
            const on = mode === "ALL_MATCHES" ? crossLength === s : lengthS === s;
            return (
              <button key={s} type="button" className={on ? "on" : ""} aria-pressed={on} disabled={lengthFixed || !reel || creating}
                style={{ fontSize: 11, padding: "0 4px" }}
                onClick={() => { if (mode === "ALL_MATCHES") setCrossLength(s); else setLengthS(s); }}>{label}</button>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4, textAlign: "center" }} className="sm">
          {([3, 4, 5] as const).map((c) => {
            const on = capOf(lengthS) === c;
            return (
              <span key={c} style={{ padding: 4, borderRadius: 5, background: on ? "rgb(var(--raised))" : "rgb(var(--p0))", color: on ? "rgb(var(--ink))" : "rgb(var(--muted))", boxShadow: on ? "inset 0 0 0 1px rgb(var(--line2))" : undefined }}>
                {c === 3 ? d.rbCap3 : c === 4 ? d.rbCap4 : d.rbCap5}
              </span>
            );
          })}
        </div>
        <span className="hint">{d.rbCapsHint}</span>
      </div>
      <div className="sect" style={{ flex: 1, gap: 8, borderBottom: 0 }}>
        <span className="eb">{d.rbTierLegend}</span>
        <ol style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tiers.map(([t, label, style]) => {
            const [bg, col] = style.split("|");
            return (
              <li key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", borderRadius: 8, background: "rgb(var(--p0))", border: "1px solid rgb(var(--line))" }}>
                <span className="tag" style={bg ? { background: bg, color: col } : undefined}>{t}</span><span className="sm">{label}</span>
              </li>
            );
          })}
        </ol>
        <p className="hint">{d.rbTierHint}</p>
      </div>
      <div style={{ padding: "12px 14px", borderTop: "1px solid rgb(var(--line))", background: "rgb(var(--p0))" }}>
        <button type="button" className="btn pri w" disabled={!!buildReason || active} title={buildReason ?? undefined} onClick={() => setBuildOpen(true)}>
          {d.rbBuildReel}<span className="mono" style={{ marginLeft: "auto", opacity: .8 }}>{d.rbTokens10}</span>
        </button>
      </div>
      {/* Build reel spends tokens: it asks first, with what the render holds (owner 2026-11-13) */}
      {reel && <ConfirmRender reel={reel} settings={draft ?? DEFAULTS} codec="h264" dirty={dirty} open={buildOpen} onOpenChange={setBuildOpen} onStart={buildReel} />}
    </aside>
  );
}

/* ------------------------------------------------------------------ centre: header, summary, budget */
function ReelSummaryBar({ reelCount }: { reelCount: number | null }) {
  const { t: dict } = useLocale();
  const { r } = useStage();
  const reel = r?.reel ?? null;
  const d = dict.body.reels;
  const res = reel?.latest_render?.result as { width?: number; height?: number; encoder?: string } | null;
  const height = res?.height ?? null;
  const fmt = height === null ? null : height >= 1080 ? "FHD" : height >= 720 ? "HD" : "SD";
  const codec = reel?.latest_render ? (res?.encoder ?? "H.264") : "H.264";
  const rendered = reel?.latest_render?.state === "SUCCEEDED";
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h1 className="h1">{d.rbHeading}</h1>
          <span className="sm mu">{reel?.player ? (reelCount === 1 ? d.rbReelsOne.replace("{a}", reel.player.display_name) : reelCount !== null ? d.rbReelsMany.replace("{a}", reel.player.display_name).replace("{b}", String(reelCount)) : reel.player.display_name) : dict.body.workspace.noPlayerSelected}</span>
        </div>
        <Link href={reel ? `/exports?reel=${reel.id}` : "/exports"} className="btn sm">{d.rbExportReel}</Link>
      </div>
      <section aria-label={reel?.name ?? d.rbHeading} style={{ display: "flex", alignItems: "center", gap: 16, minHeight: 48, flexWrap: "nowrap", padding: "0 12px", background: "transparent", border: 0, borderRadius: 0 }}>
        <span style={{ flex: "1 1 auto", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {reel ? (
            <>{reel.name} <span className="mu">· {(reel.clips.length === 1 ? d.reelListClipsOne : d.reelListClipsMany).replace("{a}", String(reel.clips.length))} · {mss(reel.duration_us)} · {reel.aspect} {codec}{fmt ? ` ${fmt}` : ""}{rendered ? ` · ${d.rbRenderedBeforeCap}` : reel.latest_render ? ` · ${renderWord(reel.latest_render.state, d)}` : ""}</span></>
          ) : (
            <>— <span className="mu">· {d.reelListClipsMany.replace("{a}", "0")} · 0:00</span></>
          )}
        </span>
        <Link href="/library" className="btn sm" style={{ flex: "none" }}>{d.rbPlayLibrary}</Link>
        <Link href={reel ? `/studio?reel=${reel.id}` : "/studio"} className="btn sm" style={{ flex: "none" }}>{d.rbOpenStudio}</Link>
      </section>
    </>
  );
}

/** Best moment rule v2.1 budget bar: the clips' total against the 5:00 hard cap, with the target-length marker (3:00 by default) */
function BudgetBarSot() {
  const { t: dict } = useLocale();
  const { r, lengthS } = useStage();
  const reel = r?.reel ?? null;
  const d = dict.body.reels;
  const totalUs = reel?.duration_us ?? 0;
  const capUs = 300e6;
  const pct = Math.min(100, (totalUs / capUs) * 100);
  const targetPct = (lengthS / 300) * 100;
  const targetLabel = d.rbTarget3.replace("3:00", mss(lengthS * 1e6));
  return (
    <section aria-label={d.rbBudget} style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, background: "transparent", border: 0, borderRadius: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="lab">{d.rbBudget}</span>
        <span><span className="mono" style={{ fontWeight: 400 }}>{mss(totalUs)}</span> <span className="sm mu">of</span> <span className="mono" style={{ fontWeight: 400 }}>5:00</span></span>
      </div>
      <div style={{ position: "relative" }}>
        <div className="bud" role="meter" aria-label={d.rbBudget} aria-valuemin={0} aria-valuemax={300} aria-valuenow={Math.round(totalUs / 1e6)}>
          <span className="used" style={{ width: `${pct}%` }} />
          <span style={{ position: "absolute", left: `${targetPct}%`, top: 0, bottom: 0, width: 2, background: "rgb(var(--cyan))" }} title={targetLabel} />
        </div>
        <span style={{ position: "absolute", right: -1, top: -4, bottom: -4, width: 3, borderRadius: 2, background: "rgb(var(--ink))" }} title={d.rbCapNever} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }} className="sm mu">
        <span className="mono">0:00</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "rgb(var(--cyan))" }} /> {targetLabel}</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "rgb(var(--ink))" }} /> {d.rbCapNever}</span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ centre: the Sequence */
function SequencePanel() {
  const { t: dict } = useLocale();
  const { r } = useStage();
  const reel = r?.reel ?? null;
  const d = dict.body.reels;
  const clips = reel?.clips ?? [];
  const isCross = reel?.source === "ALL_MATCHES";
  const moments = isCross ? [] : (r?.moments ?? []);
  const cross = r?.crossMatch ?? null;
  // the Tier S line for the empty state: goals counted from the ranked events, assists are not measured (ADR-124), events ranked
  const events = isCross ? (cross ? cross.selected.length + cross.not_selected.length : 0) : moments.reduce((n, m) => n + (m.events?.length ?? 0), 0);
  const goals = isCross ? cross?.selected.filter((m) => m.tier === "S").length ?? 0
    : moments.filter((m) => (m.events ?? []).some((e) => e === "GOAL" || e === "FREE_KICK_GOAL" || e === "PENALTY_GOAL")).length;
  const showIntro = !!reel?.player && reel.settings.profile_intro !== false;
  return (
    <section aria-label={d.rbSequence} style={{ display: "flex", flexDirection: "column", background: "transparent", border: 0, borderRadius: 0 }}>
      <div className="ph"><h2 className="h3">{d.rbSequence}</h2>
        <span className="sm mu">{d.rbIntroFixed}</span>
      </div>
      <ol style={{ display: "flex", gap: 8, padding: 12, alignItems: "stretch", overflowX: "auto" }}>
        {showIntro && reel?.player && (
          <li style={{ flex: "0 0 160px", borderRadius: 8, border: "1.5px solid rgb(var(--primary))", background: "rgba(43,212,176,.06)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ aspectRatio: "16/9", borderRadius: 4, background: "rgb(var(--canvas))", border: "1px solid rgb(var(--line))", display: "grid", placeItems: "center" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, color: "rgb(var(--primary))" }} fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            </span>
            <span className="sm" style={{ fontWeight: 400 }}>{d.stepProfileIntro}</span>
            <span className="sm mu">{d.rbIntroAlways}</span>
          </li>
        )}
        {clips.length === 0 ? (
          <li style={{ flex: 1, borderRadius: 8, border: "1px dashed rgb(var(--line2))", padding: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, textAlign: "center" }}>
            <span className="h3">{d.rbNoRanked}</span>
            <span className="sm mu">{d.rbTierSEmpty.replace("{a}", String(goals)).replace("{b}", "0").replace("{c}", String(events))}</span>
          </li>
        ) : clips.map((c, i) => {
          const on = c.id === r?.selectedClip;
          const dur = (c.out_pts_us - c.in_pts_us) / 1e6;
          return (
            <li key={c.id} data-clip={i} style={{ flex: "0 0 160px", borderRadius: 8, border: on ? "1.5px solid rgb(var(--primary))" : "1px solid rgb(var(--line))", background: on ? "rgba(43,212,176,.06)" : "rgb(var(--p0))", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <button type="button" onClick={() => r?.setSelectedClip(on ? null : c.id)} aria-pressed={on} aria-label={`${i + 1}. ${c.label ?? d.rbClip} · ${mss(c.in_pts_us)} – ${mss(c.out_pts_us)}`} style={{ all: "unset", cursor: "pointer", display: "contents" }}>
                <span style={{ aspectRatio: "16/9", borderRadius: 4, background: "rgb(var(--canvas))", border: "1px solid rgb(var(--line))", display: "grid", placeItems: "center" }}>
                  <span className="mono" style={{ fontSize: 11, color: "rgb(var(--muted))" }}>{`${i + 1} · ${dur.toFixed(1)}s`}</span>
                </span>
                <span className="sm" style={{ fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label ?? `${d.rbClip} ${i + 1}`}</span>
                <span className="sm mu">{`${mss(c.in_pts_us)} – ${mss(c.out_pts_us)}`}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ right: the Clip inspector */
function ClipInspector() {
  const { t: dict } = useLocale();
  const { r } = useStage();
  const reel = r?.reel ?? null;
  const d = dict.body.reels;
  const sel = reel?.clips.find((c) => c.id === r?.selectedClip) ?? null;
  const idx = sel && reel ? reel.clips.indexOf(sel) : -1;
  const [edit, setEdit] = useState({ a: "", b: "" });
  useEffect(() => { if (sel) setEdit({ a: (sel.in_pts_us / 1e6).toFixed(1), b: (sel.out_pts_us / 1e6).toFixed(1) }); }, [sel?.id, sel?.in_pts_us, sel?.out_pts_us]);   // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = !!r?.canEdit && !r.busy && !!reel;
  const move = (dir: number) => {
    if (!reel || !r || idx < 0) return;
    const ids = reel.clips.map((c) => c.id);
    [ids[idx], ids[idx + dir]] = [ids[idx + dir]!, ids[idx]!];
    r.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/order`, { method: "POST", json: { clip_ids: ids } }));
  };
  return (
    <aside className="insp" aria-label={d.rbClip} style={{ flex: "0 0 280px", maxWidth: 280, overflowY: "auto", minHeight: 0 }}>
      <div className="ph" style={{ minHeight: 44 }}><h2 className="h3">{d.rbClip}</h2></div>
      {!sel ? (
        <div className="empty" style={{ flex: 1 }}>
          <span className="ei"><svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16" /></svg></span>
          <h3>{d.rbNoClip}</h3>
          <p>{d.rbTrimHint}</p>
          <Link href={reel ? `/studio?reel=${reel.id}` : "/studio"} className="btn sm">{d.rbOpenClipStudio}</Link>
        </div>
      ) : (
        <div className="sect" style={{ gap: 8 }}>
          <p className="t-body"><span className="font-normal">{idx + 1}. {sel.label ?? d.rbClip}</span> <span className="text-muted">· {mss(sel.in_pts_us)} – {mss(sel.out_pts_us)}</span></p>
          <label className="flex items-center gap-1 t-body">{d.clipInLabel} <input value={edit.a} disabled={!canEdit} aria-label={d.clipInAria.replace("{a}", String(idx + 1))} onChange={(e) => setEdit({ ...edit, a: e.target.value })} className="w-16 rounded border border-line bg-canvas px-1 py-0.5" /></label>
          <label className="flex items-center gap-1 t-body">{d.clipOutLabel} <input value={edit.b} disabled={!canEdit} aria-label={d.clipOutAria.replace("{a}", String(idx + 1))} onChange={(e) => setEdit({ ...edit, b: e.target.value })} className="w-16 rounded border border-line bg-canvas px-1 py-0.5" /></label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!canEdit} onClick={() => reel && r?.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${sel.id}`, { method: "PATCH", json: { in_pts_us: Math.round(Number(edit.a) * 1e6), out_pts_us: Math.round(Number(edit.b) * 1e6) } }), d.clipTrimmed)} className="btn sm">{d.clipTrim}</button>
            <button type="button" aria-label={d.moveUp} disabled={!canEdit || idx === 0} onClick={() => move(-1)} className="btn sm">◀</button>
            <button type="button" aria-label={d.moveDown} disabled={!canEdit || idx === (reel?.clips.length ?? 0) - 1} onClick={() => move(1)} className="btn sm">▶</button>
            <button type="button" aria-label={d.removeClip} disabled={!canEdit} onClick={() => reel && r?.run(() => api<Reel>(`/v1/reels/${reel.id}/clips/${sel.id}`, { method: "DELETE" }), dict.body.reelstage.clipRemoved)} className="btn sm" style={{ color: "rgb(var(--danger))" }}>{d.removeClip}</button>
          </div>
          <Link href={`/studio?reel=${reel!.id}`} className="btn sm">{d.rbOpenClipStudio}</Link>
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ the page */
const TAB_OF: Record<string, number> = { "p06-spotlight": 0, "p06-overlays": 1, "p06-branding": 2 };
/** Best moment rule v2.1: a single-match reel's target length is remembered per reel in this browser (like the worked step) */
const LENGTH_KEY = (id: string) => `otsi.reel-length.${id}`;

function Sections({ r }: { r: ReelState | null }) {
  const { t: dict } = useLocale();
  const reel = r?.reel ?? null;
  const [draft, setDraft] = useState<SpotlightSettings | null>(null);
  const [name, setName] = useState("");
  const [focus, setFocus] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [mode, setMode] = useState<"clip" | "render">("clip");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = reel?.version, reelId = reel?.id;
  useEffect(() => { if (reel) { setDraft(reel.settings); setName(reel.name); } else { setDraft(null); setName(""); } }, [reelId, version]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMode("clip"); }, [reelId]);
  const dirty = useDirty(reel, draft, name);
  // Best moment rule v2.1 target length: a cross-match reel's was fixed when it was made; a single-match reel's is chosen here
  const lengthFixed = reel?.source === "ALL_MATCHES" && !!reel.cross_match_length_s;
  const [lengthSState, setLengthSState] = useState<ReelLengthS>(180);
  useEffect(() => {
    if (!reel || lengthFixed) return;
    let n: ReelLengthS = 180;
    try { const v = Number(localStorage.getItem(LENGTH_KEY(reel.id))); if (v === 90 || v === 180 || v === 300) n = v; } catch { /* default */ }
    setLengthSState(n);
  }, [reel?.id, lengthFixed]);  // eslint-disable-line react-hooks/exhaustive-deps
  const lengthS: ReelLengthS = lengthFixed ? (reel!.cross_match_length_s as ReelLengthS) : lengthSState;
  const setLengthS = useCallback((n: ReelLengthS) => {
    setLengthSState(n);
    if (reel) { try { localStorage.setItem(LENGTH_KEY(reel.id), String(n)); } catch { /* not remembered */ } }
  }, [reel]);
  const jump = useCallback((id: string) => {
    if (id in TAB_OF) setTab(TAB_OF[id]!);
    setFocus(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocus((f) => (f === id ? null : f)), 1600);
  }, []);
  const save = useCallback(async (): Promise<Reel | null> => {
    if (!reel || !draft) return null;
    try {
      const body: Record<string, unknown> = { version: reel.version, settings: draft };
      if (name.trim() && name.trim() !== reel.name) body.name = name.trim();
      const saved = await api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: body });
      await r?.reload();
      return saved;
    } catch {
      return null;
    }
  }, [reel, draft, name, r]);
  // the SOT has no Profile intro dialog on this page: the intro is a card in the Sequence, so opening it is a no-op here
  const openProfileIntro = useCallback(() => {}, []);
  /** Build reel (after the confirmation): unsaved edits are saved first, then the H.264 render starts — it spends tokens,
   *  so the sidebar button always opens ConfirmRender before this runs (owner 2026-11-13) */
  const buildReel = useCallback(() => {
    if (!reel || !r) return;
    r.run(async () => {
      let cur: Reel = reel;
      if (dirty && draft) cur = await api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, ...(name.trim() && name.trim() !== reel.name ? { name: name.trim() } : {}), settings: draft } });
      await api(`/v1/reels/${reel.id}/renders`, { method: "POST", json: { codec: "h264", bitrate_mbps: 8 }, headers: { "idempotency-key": `render-${cur.id}-${cur.version}-h264-${Date.now()}` } });
      return cur;
    }, dict.body.reels.renderStarted);
  }, [reel, r, dict, dirty, draft, name]);
  /** the render confirmation's open state (the sidebar's Build reel button opens it) */
  const [buildOpen, setBuildOpen] = useState(false);
  /** how many reels this player has (the header's "1 reel generated") */
  const [reelCount, setReelCount] = useState<number | null>(null);
  useEffect(() => {
    setReelCount(null);
    if (!reel?.player) return;
    const pid = reel.player.player_id;
    void api<Reel[]>("/v1/reels").then((l) => setReelCount(l.filter((x) => x.player?.player_id === pid).length), () => setReelCount(null));
  }, [reel?.player?.player_id]);  // eslint-disable-line react-hooks/exhaustive-deps
  const value: Stage = useMemo(() => ({ r, draft, setDraft, name, setName, dirty, save, focus, jump, tab, mode, setMode, openProfileIntro, lengthS, setLengthS, lengthFixed, buildOpen, setBuildOpen, buildReel }),
    [r, draft, name, dirty, save, focus, jump, tab, mode, openProfileIntro, lengthS, setLengthS, lengthFixed, buildOpen, setBuildOpen, buildReel]);   // setDraft / setName / setMode / setBuildOpen are the stable setters
  // the same undo / redo keys as Clip Studio (lib/keymap.ts, Reels scope): they only live on this page, never while typing,
  // and only when there is something to undo or redo, so no request is made for a no-op
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === "z" || k === "y")) {
        e.preventDefault();
        if (k === "y" || e.shiftKey) { if (r?.history?.can_redo) r.redo(); } else if (r?.history?.can_undo) r.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [r]);
  return (
    <div className="flex min-h-0 min-w-0" data-page="reels" style={{ height: "100%", overflow: "hidden" }}>
      <StageProvider value={value}>
        <ReelSettingsSidebar />
        <main className="content" style={{ padding: 12, gap: 10, overflowY: "auto", minHeight: 0 }}>
          <ReelSummaryBar reelCount={reelCount} />
          <BudgetBarSot />
          <PreviewPanel />
          <SequencePanel />
        </main>
        <ClipInspector />
      </StageProvider>
    </div>
  );
}

function WithReel() {
  return <Sections r={useReel()} />;
}

export function ReelStage({ reelId }: { reelId?: string }) {
  if (!reelId) return <Sections r={null} />;
  return <ReelBuilder key={reelId} reelId={reelId}><WithReel /></ReelBuilder>;
}
