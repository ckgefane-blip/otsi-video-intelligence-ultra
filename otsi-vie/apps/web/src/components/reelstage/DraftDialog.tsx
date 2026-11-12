"use client";
/**
 * E4 (ADR-067) "Faster assembly": Build a draft. Plain inputs (length, what the reel is about, frame) → up to three draft reels the
 * engine makes from the confirmed player's own moments (POST /v1/reels/:id/candidates; nothing changes yet), each with what it holds
 * and why, drawn as a strip over the match → "Use this draft" (POST /v1/reels/:id/assemble; replaces the clips only after a second
 * confirmation when the reel has some) → Edit in Clip Studio.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { ReelTheme, type CandidatesResponse, type Reel, type ReelCandidate } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import type { ReelState } from "@/components/reels/ReelBuilder";

const LENGTHS = [30, 60, 90, 120, 180];
const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const;
const secs = (us: number, d: Dictionary["body"]["reelstage"]) => { const s = Math.round(us / 1e6); return s >= 60 ? (s % 60 ? d.draftDurMinSec.replace("{a}", String(Math.floor(s / 60))).replace("{b}", String(s % 60)) : d.draftDurMin.replace("{a}", String(Math.floor(s / 60)))) : d.draftDurSec.replace("{a}", String(s)); };
const chip = (on: boolean) => `rounded-ctl border px-2.5 py-1 text-xs ${on ? "border-primary bg-primary/20 font-normal" : "border-line"}`;

export function DraftDialog({ r, open, onOpenChange }: { r: ReelState | null; open: boolean; onOpenChange(o: boolean): void }) {
  const { t: dict } = useLocale();
  const d = dict.body.reelstage;
  const reel = r?.reel ?? null;
  const THEME: Record<ReelTheme, string> = { BEST: d.themeBest, ATTACK: d.themeAttack, DEFENCE: d.themeDefence, SET_PIECES: d.themeSetPieces, ALL: d.themeAll };
  const EFFECT: Record<string, string> = { SLOW: d.effectSlow, FREEZE: d.effectFreeze, RAMP: d.effectHero };
  const [target, setTarget] = useState(60);
  const [theme, setTheme] = useState<ReelTheme>("BEST");
  const [aspect, setAspect] = useState<Reel["aspect"]>(reel?.aspect ?? "16:9");
  const [res, setRes] = useState<CandidatesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [done, setDone] = useState<ReelCandidate | null>(null);
  const reelId = reel?.id ?? null;

  useEffect(() => { if (open && reel) { setAspect(reel.aspect); setDone(null); setSure(null); } }, [open]);    // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !reelId) return;
    let live = true;
    setRes(null); setErr(null); setSure(null);
    api<CandidatesResponse>(`/v1/reels/${reelId}/candidates`, { method: "POST", json: { target_s: target, theme } })
      .then((x) => live && setRes(x), (x) => live && setErr(x instanceof ApiProblem ? x.message : d.draftErrMake));
    return () => { live = false; };
  }, [open, reelId, target, theme]);

  const use = async (c: ReelCandidate) => {
    if (!reel || !r) return;
    if (reel.clips.length && sure !== c.key) { setSure(c.key); return; }
    setBusy(true); setErr(null);
    try {
      let v = reel.version;
      if (aspect !== reel.aspect) v = (await api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: v, aspect } })).version;
      await api<Reel>(`/v1/reels/${reel.id}/assemble`, { method: "POST", json: { key: c.key, target_s: target, theme, version: v, replace: reel.clips.length > 0 } });
      await r.reload();
      setDone(c);
    } catch (x) { setErr(x instanceof ApiProblem ? x.message : d.draftErrUse); }
    finally { setBusy(false); }
  };

  const span = res?.candidates.length ? Math.max(...res.candidates.flatMap((c) => c.clips.map((x) => x.out_pts_us))) : 1;
  const best = res?.candidates.length ? res.candidates.reduce((a, b) => (b.score > a.score ? b : a)).key : null;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="draft" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(820px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 t-body shadow-xl">
          <Dialog.Title className="t-section">{d.draftTitle}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            {reel?.player ? d.draftDescPlayer.replace("{a}", reel.player.display_name) : d.draftDescNoReel}
            {" "}{d.draftDescRest}
          </Dialog.Description>

          {done && reel ? (
            <div className="grid gap-3" data-draft-done={done.key}>
              <p>{d.draftDone.replace("{a}", done.title).replace("{b}", String(done.clips.length)).replace("{c}", secs(done.duration_us, d))}</p>
              <div className="flex gap-2">
                <Link href={`/studio?reel=${reel.id}`} data-edit-in-studio className="rounded-ctl bg-primary px-3 py-1.5 font-normal text-white">{d.draftEditStudio}</Link>
                <button type="button" onClick={() => onOpenChange(false)} className="rounded-ctl border border-line px-3 py-1.5">{d.draftStay}</button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-3 grid gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={d.draftLength}>{d.draftLength}
                  {LENGTHS.map((s) => <button key={s} type="button" role="radio" aria-checked={target === s} data-length={s} className={chip(target === s)} onClick={() => setTarget(s)}>{s < 60 ? d.draftDurSec.replace("{a}", String(s)) : d.draftDurMin.replace("{a}", String(s / 60))}</button>)}
                </div>
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={d.draftAbout}>{d.draftAbout}
                  {ReelTheme.options.map((t) => <button key={t} type="button" role="radio" aria-checked={theme === t} data-theme={t} className={chip(theme === t)} onClick={() => setTheme(t)}>{THEME[t]}</button>)}
                </div>
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={d.draftFrame}>{d.draftFrame}
                  {ASPECTS.map((a) => <button key={a} type="button" role="radio" aria-checked={aspect === a} data-frame={a} className={chip(aspect === a)} onClick={() => setAspect(a)}>{a}</button>)}
                </div>
              </div>

              {err && <p className="mb-2 text-xs text-[#ff8a8a]" role="alert">{err}</p>}
              {!res ? <p className="text-xs text-muted">{d.draftMaking}</p> : res.candidates.length === 0 ? (
                <p className="text-xs text-muted" data-no-drafts>
                  {res.moments === 0 ? d.draftNoMoments : d.draftNoFit}
                </p>
              ) : (
                <ul className="grid gap-2" aria-label={d.draftsAria}>
                  {res.candidates.map((c) => (
                    <li key={c.key} data-draft={c.key} className="rounded-ctl border border-line p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-normal">{c.title}{c.key === best ? <span className="ml-2 rounded bg-primary/25 px-1.5 py-0.5 text-xs font-normal">{d.draftMostAction}</span> : null}</span>
                        <span className="text-xs text-muted">{secs(c.duration_us, d)}</span>
                      </div>
                      <p className="mb-2 text-xs text-muted">{c.why}</p>
                      <div className="relative mb-2 h-3 rounded bg-black/40" aria-label={d.draftWhereAria} role="img">
                        {c.clips.map((x) => (
                          <span key={x.in_pts_us} title={`${x.label}${x.effect.kind !== "NONE" ? ` · ${EFFECT[x.effect.kind] ?? x.effect.kind.toLowerCase()}` : ""}`} className="absolute top-0 h-3 rounded-sm"
                            style={{ left: `${(x.in_pts_us / span) * 100}%`, width: `${Math.max(0.6, ((x.out_pts_us - x.in_pts_us) / span) * 100)}%`,
                              background: x.kind === "VISIBLE" ? "#5a6b80" : x.effect.kind !== "NONE" ? "#ffb21a" : "#33a8ff" }} />
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" data-use-draft={c.key} disabled={busy || !r?.canEdit} onClick={() => void use(c)}
                          className={`rounded-ctl px-3 py-1 text-xs font-normal text-white disabled:opacity-50 ${sure === c.key ? "bg-[#a33]" : "bg-primary"}`}>
                          {sure === c.key ? d.draftReplace.replace("{a}", String(reel?.clips.length)) : d.draftUse}</button>
                        {sure === c.key && <button type="button" onClick={() => setSure(null)} className="rounded-ctl border border-line px-3 py-1 text-xs">{d.draftKeep}</button>}
                        {!r?.canEdit && <span className="text-xs text-muted">{d.draftCannotEdit}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 t-small">{d.draftLegend}</p>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
