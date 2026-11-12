"use client";
/**
 * Page 06 Sections 02-04 — introduction and workflow, Aspect Ratio, Reel Info.
 *
 * The four steps reflect the reel's real state (a player a person confirmed, clips added, the render result); a step is only marked done
 * when it is. Clicking a step jumps to its panel. Aspect ratio and the title are real, saved with the reel. Music opens the music picker
 * (ADR-047: uploaded with a rights declaration, mixed under the reel). Description has no place in the reel yet, so it is disabled with its
 * reason; Duration is the Best Moment Rule v2.1 length picker (90 s / 3 min / 5 min, never over 5:00) — the budget bar with the clips'
 * total against it sits over the timeline. Matches (ADR-131) chooses which matches the reel covers: this match, or a new
 * all-matches reel.
 */
import { REEL_STEP_KEY, type Reel, type ReelAspectT } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { MusicPicker, useMusic } from "./MusicPicker";
import { ReelSourceChoice } from "@/components/reels/ReelBuilder";
import { secs, useStage, type ReelLengthS } from "./shared";
import { notBuilt } from "@/lib/devMode";

const STEPS: [string, string][] = [["Select Player", "p06-target"], ["Choose Moments", "p06-moments"], ["Edit & Style", "p06-spotlight"], ["Export", "p06-output"]];

export function LeftColumn() {
  const { t: dict } = useLocale();
  const { r, name, setName, jump, draft, setDraft, lengthS, setLengthS, lengthFixed } = useStage();
  const [musicOpen, setMusicOpen] = useState(false);
  const [music] = useMusic();
  const tune = draft?.music_id ? (music?.find((m) => m.id === draft.music_id)?.name ?? dict.body.reelstage.musicChosen) : null;
  const reel = r?.reel ?? null;
  const render = reel?.latest_render ?? null;
  const done = [!!reel?.player && !reel.stale, (reel?.clips.length ?? 0) > 0, false, render?.state === "SUCCEEDED"];
  const rs = dict.body.reelstage;
  const stepNames = [rs.stepSelectPlayer, rs.stepChooseMoments, rs.stepEditStyle, rs.stepExport];
  const sub = [reel?.player ? reel.player.display_name : dict.body.workspace.noPlayerSelected,
    reel && reel.clips.length ? `${(reel.clips.length === 1 ? dict.body.reels.stepClipsOne : dict.body.reels.stepClipsMany).replace("{a}", String(reel.clips.length)).replace("{b}", secs(reel.duration_us, rs.durationSec))}` : rs.subNoMoments,
    rs.subSpotlight, render ? (render.state === "SUCCEEDED" ? rs.subRendered : render.state === "FAILED" ? rs.subRenderFailed : rs.subRendering) : rs.subRenderShare];
  // B.13 (ADR-089): the step a person last worked on in this reel is remembered in this browser; the reel reopens there
  const [worked, setWorked] = useState<number | null>(null);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!reel || opened.current === reel.id) return;
    opened.current = reel.id;
    let n: number | null = null;
    try { const v = Number(localStorage.getItem(REEL_STEP_KEY(reel.id))); if (Number.isInteger(v) && v >= 0 && v < STEPS.length) n = v; } catch { /* not remembered */ }
    setWorked(n);
    if (n !== null) setTimeout(() => jump(STEPS[n]![1]), 300);
  }, [reel, jump]);
  const goStep = (i: number) => { setWorked(i); if (reel) { try { localStorage.setItem(REEL_STEP_KEY(reel.id), String(i)); } catch { /* not remembered */ } } jump(STEPS[i]![1]); };
  const firstOpen = done.findIndex((d) => !d) === -1 ? 3 : done.findIndex((d) => !d);
  const current = worked ?? firstOpen;
  const aspect = reel?.aspect ?? "16:9";
  const canEdit = !!r?.canEdit && !r.busy && !!reel;
  const setAspect = (a: ReelAspectT) => { if (r && reel && a !== reel.aspect) r.run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, aspect: a } })); };
  const lengths: [ReelLengthS, string][] = [[90, dict.body.reels.len90s], [180, dict.body.reels.len3min], [300, dict.body.reels.len5min]];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section aria-label={rs.workflowAria} data-section="p06-s02" className="vie-panel p-3">
        <Link href="/reels" aria-label={dict.body.reels.backToReels} className="text-xs text-primary hover:underline">← {dict.body.reels.backToReels}</Link>
        <h1 className="t-page mt-2">{dict.nav.reels}</h1>
        <h2 className="t-section text-primary">Spotlight Composer</h2>
        <p className="t-body mt-1 text-muted">{rs.introLine1} {rs.introLine2} {rs.introLine3}</p>
        <ol aria-label={rs.stepsAria} data-worked-step={worked ?? ""} className="mt-3 space-y-1.5">
          {STEPS.map(([n], i) => { const label = stepNames[i]!; return (
            <li key={n} data-reel-step={n} data-done={done[i] ? "1" : "0"} aria-current={current === i ? "step" : undefined}>
              <button type="button" onClick={() => goStep(i)} aria-label={`${label}: ${sub[i]}`}
                className={`flex w-full items-center gap-3 rounded-ctl border px-2.5 py-2 text-left ${current === i ? "border-primary bg-raised" : "border-line/70 bg-raised/40 hover:border-primary/50"}`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full t-panel ${current === i ? "bg-primary text-white" : "bg-raised text-muted"}`}
                  aria-hidden>{done[i] ? "✓" : i + 1}</span>
                <span className="min-w-0">
                  <span className="t-panel block truncate">{label}</span>
                  <span className="t-small block truncate">{sub[i]}</span>
                </span>
              </button>
            </li>
          ); })}
        </ol>
      </section>

      <section aria-label={dict.body.reels.aspectRatio} data-section="p06-s03" data-aspect={aspect} className="vie-panel p-3">
        <h3 className="t-section">{dict.body.reels.aspectRatio}</h3>
        <div role="radiogroup" aria-label={dict.body.reels.aspectRatio} className="mt-2 grid grid-cols-2 gap-1.5">
          {([["16:9", rs.aspectYouTube], ["9:16", rs.aspectReels], ["1:1", rs.aspectInstagram], ["4:5", rs.aspectFeed]] as const).map(([a, d]) => {
            const on = aspect === a;
            return (
              <button key={a} type="button" role="radio" aria-checked={on} disabled={!canEdit} title={canEdit ? rs.aspectHit.replace("{a}", a) : reel ? rs.cannotEdit : rs.openReelFirst}
                onClick={() => setAspect(a)} className={`rounded-ctl border px-2 py-2 text-center disabled:opacity-50 ${on ? "border-primary bg-primary/10" : "border-line hover:border-primary/50"}`}>
                <span className="t-panel block">{a}</span>
                <span className="t-small block">{d}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label={rs.reelInfoAria} data-section="p06-s04" className="vie-panel space-y-3 p-3">
        <h3 className="t-section">{dict.body.reels.reelInfo}</h3>
        <div>
          <label htmlFor="reel-title" className="t-label">{dict.body.reels.reelTitle}</label>
          <input id="reel-title" aria-label={rs.reelTitleAria} placeholder={rs.titlePlaceholder} value={name} maxLength={200} disabled={!canEdit} onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-ctl border border-line2 bg-canvas px-2 py-1.5 t-body disabled:opacity-50" />
        </div>
        <div>
          <label htmlFor="reel-desc" className="t-label">{dict.body.reels.reelDescription}</label>
          <textarea id="reel-desc" aria-label={rs.reelDescAria} placeholder={rs.descPlaceholder} disabled title={notBuilt("a reel has no description field")}
            className="mt-1 w-full resize-none rounded-ctl border border-line2 bg-canvas px-2 py-1.5 t-body opacity-70" rows={2} />
        </div>
        <div>
          <span className="t-label" id="reel-length-label">{rs.lengthLabel}</span>
          <div role="radiogroup" aria-labelledby="reel-length-label" className="mt-1 flex gap-1.5">
            {lengths.map(([s, label]) => (
              <button key={s} type="button" role="radio" aria-checked={lengthS === s} disabled={lengthFixed || !reel}
                title={lengthFixed ? rs.budgetCrossFixed.replace("{a}", label) : undefined}
                onClick={() => setLengthS(s)}
                className={`flex-1 rounded-ctl border px-2 py-1.5 t-button disabled:opacity-50 ${lengthS === s ? "border-primary bg-primary/10 text-primary" : "border-line hover:border-primary/50"}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="t-small mt-1">{lengthFixed ? rs.budgetCrossFixed.replace("{a}", lengthS === 90 ? dict.body.reels.len90s : lengthS === 300 ? dict.body.reels.len5min : dict.body.reels.len3min) : rs.lengthNote}</p>
        </div>
        <div>
          <span className="t-label">{dict.body.reels.music}</span>
          <button type="button" onClick={() => { if (r?.canEdit && reel && draft) setMusicOpen(true); }} disabled={!r?.canEdit || !reel || !draft}
            title={tune ? rs.musicHitChosen.replace("{a}", tune) : rs.chooseMusicHit}
            className="mt-1 flex w-full items-center gap-2 rounded-ctl border border-line2 bg-canvas px-2 py-1.5 t-body disabled:opacity-50">
            <span aria-hidden className={tune ? "text-ok" : ""}>♪</span>
            <span className="min-w-0 flex-1 truncate text-left">{tune ?? rs.chooseMusic}</span>
            <span aria-hidden className="text-muted">›</span>
          </button>
          {musicOpen && draft && <MusicPicker settings={draft} onChange={setDraft} onClose={() => setMusicOpen(false)} />}
        </div>
        {/* ADR-131: which matches this reel covers — "All matches" makes a NEW cross-match reel and opens it; this reel is untouched.
            For a cross-match reel the row is a read-only summary (length + rule version).
            Hidden when no reel is open: ReelSourceChoice needs the ReelBuilder context, which only exists with a reel open. */}
        {r && (
          <div>
            <span className="t-label">{dict.body.reels.matches}</span>
            <div className="mt-1"><ReelSourceChoice compact /></div>
          </div>
        )}
      </section>
    </div>
  );
}
