"use client";
/**
 * "Is this him?" (ADR-046): for the player whose reel is being made, the moments of the engine's events where an unnamed player could be
 * him; the person answers Yes / No / Can't tell, or drags the box onto him when it is on someone else. Nobody else is asked about: a user
 * names a player only for the reel he makes.
 * Also: MomentPreview, the in-dialog player used here and by the look-alikes (ADR-045).
 */
import type { Observation, ObservationWindow, TrackIdentity, WhoIsThis, WhoItem } from "@otsi-vie/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";
import { ImpactNote } from "@/components/analysis/ImpactNote";
import { api, ApiProblem } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { useLocale } from "@/lib/i18n";

/** each track's box nearest to time t (within 400 ms) */
function boxesAt(obs: Observation[], t: number): Observation[] {
  const best = new Map<string, Observation>();
  for (const x of obs) {
    const d = Math.abs(x.pts_us - t);
    if (d >= 400_000) continue;
    const b = best.get(x.track_id);
    if (!b || d < Math.abs(b.pts_us - t)) best.set(x.track_id, x);
  }
  return [...best.values()];
}
const inside = (o: Observation, px: number, py: number) => px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h;

/**
 * A moment of the match played inside a dialog (which covers the main video), looping over [from, to] (at most 20 s), with one track's box.
 * With `onMove`, the box can be dragged (or another player clicked): the video stops, the other players' boxes show, and the player under
 * the pointer is handed back (`picked` draws him in blue until the caller answers).
 */
export function MomentPreview({ trackId, runId, from, to, label, onClose, onMove, picked }: {
  trackId: string; runId?: string | null; from: number; to: number; label: string; onClose?(): void; onMove?(o: Observation, boxSeen: boolean): void; picked?: Observation | null;
}) {
  const { t: dict } = useLocale();
  const ws = useAnalysisWorkspace();
  const ref = useRef<HTMLVideoElement | null>(null);
  const area = useRef<HTMLDivElement | null>(null);
  const [obs, setObs] = useState<Observation[]>([]);
  const [now, setNow] = useState(0);
  const [drag, setDrag] = useState<{ dx: number; dy: number; x: number; y: number } | null>(null);
  const [stopped, setStopped] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);
  const run = runId ?? ws?.run?.id;
  const start = Math.max(0, from), end = Math.min(to, start + 20_000_000);
  useEffect(() => {
    if (!run) return;
    let live = true;
    void api<ObservationWindow>(`/v1/analysis-runs/${run}/observations?from_us=${start}&to_us=${end + 1}`)
      .then((w) => { if (live) setObs(onMove ? w.observations.filter((x) => x.class_name === "PERSON" || x.track_id === trackId) : w.observations.filter((x) => x.track_id === trackId)); }, () => undefined);
    return () => { live = false; };
  }, [run, trackId, start, end, !onMove]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = ref.current;
      if (v) {
        const t = v.currentTime * 1e6;
        if (!v.paused && (t > end || t < start - 500_000)) v.currentTime = start / 1e6;
        setNow(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, end]);
  useEffect(() => { if (!picked && stopped) { setStopped(false); void ref.current?.play().catch(() => undefined); } }, [picked]);   // eslint-disable-line react-hooks/exhaustive-deps

  const here = boxesAt(obs, now);
  const box = here.find((x) => x.track_id === trackId) ?? null;
  const others = here.filter((x) => x.track_id !== trackId);
  const at = (e: React.PointerEvent) => { const r = area.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const; };
  const stop = () => { ref.current?.pause(); setStopped(true); };
  const pick = (px: number, py: number) => {
    const hit = others.filter((o) => inside(o, px, py)).sort((p, q) => p.w * p.h - q.w * q.h)[0];
    if (hit) onMove?.(hit, !!box);
  };
  const down = (e: React.PointerEvent) => {
    if (!onMove) return;
    const [px, py] = at(e);
    stop();
    if (box && inside(box, px, py)) { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ dx: px - box.x, dy: py - box.y, x: box.x, y: box.y }); }
    else pick(px, py);
  };
  const move = (e: React.PointerEvent) => { if (drag) { const [px, py] = at(e); setDrag({ ...drag, x: px - drag.dx, y: py - drag.dy }); } };
  const up = () => { if (drag && box) pick(drag.x + box.w / 2, drag.y + box.h / 2); setDrag(null); };
  const target = drag && box ? others.filter((o) => inside(o, drag.x + box.w / 2, drag.y + box.h / 2)).sort((p, q) => p.w * p.h - q.w * q.h)[0] : null;
  const pct = (o: { x: number; y: number; w: number; h: number }) => ({ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` });

  const url = ws?.playback?.url;
  return (
    <div className="rounded border border-primary/60 p-2" data-moment-preview={trackId}>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span>{label} · the green box is the player{onMove ? " · wrong player? drag the box onto the right one, or click him" : ""}</span>
        <span className="flex gap-1">
          {onMove && stopped && !picked && <button type="button" onClick={() => { setStopped(false); void ref.current?.play().catch(() => undefined); }} className="rounded-ctl border border-line px-2 py-0.5">{dict.body.processing.playBtn}</button>}
          {onClose && <button type="button" onClick={onClose} className="rounded-ctl border border-line px-2 py-0.5">{dict.common.close}</button>}
        </span>
      </div>
      {!url ? <p className="text-xs text-muted">{dict.body.workspace.noPlaybackCopy}</p> : (
        <div ref={area} className={`relative mx-auto w-full max-w-[600px] ${onMove ? "touch-none select-none" : ""}`} style={{ aspectRatio: ratio, cursor: onMove ? (drag ? "grabbing" : "crosshair") : undefined }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
          <video ref={ref} src={url} muted playsInline autoPlay preload="auto" className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Moment of the match"
            onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth) setRatio(v.videoWidth / v.videoHeight); v.currentTime = start / 1e6; void v.play().catch(() => undefined); }} />
          {onMove && stopped && others.map((o) => <span key={o.track_id} aria-hidden className={`pointer-events-none absolute border ${target?.track_id === o.track_id ? "border-2 border-primary" : "border-white/50"}`} style={pct(o)} />)}
          {picked && <span aria-hidden data-picked={picked.track_number} className="pointer-events-none absolute border-2 border-primary" style={pct(picked)} />}
          {box && !picked && <span aria-hidden data-box={box.track_number} className={`absolute border-2 border-ok ${onMove ? "cursor-grab" : "pointer-events-none"}`} style={pct(drag ? { ...box, x: drag.x, y: drag.y } : box)} />}
        </div>
      )}
    </div>
  );
}


/**
 * "Is this him?" for the player whose reel is being made: one possible track at a time (the engine's events only, his shirt colour, never on
 * screen with him, never marked not him; most alike to him first), its moment played with the box on that player. Yes names the track (all
 * its events count for him), No records "not him", Can't tell skips it for now. When the box is on someone else and he is in the picture,
 * the person drags the box onto him: that player is him, the boxed one is not (both are seen at the same time). "Go back to the ones I said
 * No to" serves those moments again for exactly that.
 */
export function WhoIsThisPanel({ videoId, playerId, onNamed }: { videoId: string; playerId: string; onNamed(): Promise<void> }) {
  const { t: dict } = useLocale();
  const [data, setData] = useState<WhoIsThis | null>(null);
  const KIND: Record<WhoItem["moment"]["kind"], string> = { SHOT: dict.body.workspace.shootsVerb, PASS_FROM: dict.body.workspace.makesPass, PASS_TO: dict.body.workspace.receivesPass, BALL_WON: dict.body.workspace.winsBall, PRESSURE: dict.body.workspace.pressesVerb, SET_PIECE: dict.body.workspace.takesSetPiece };
  const [revisit, setRevisit] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Observation | null>(null);
  const [boxSeen, setBoxSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => setData(await api<WhoIsThis>(`/v1/videos/${videoId}/who-is-this?player=${playerId}${revisit ? "&revisit=1" : ""}`)), [videoId, playerId, revisit]);
  useEffect(() => { setData(null); setSkipped(new Set()); setPicked(null); void load().catch(() => setMsg({ ok: false, text: dict.body.workspace.couldNotLoadMoments })); }, [load]);
  // A.9 (ADR-071): N, the next possible moment of this player (the same as Can't tell / Next); never an answer about who it is
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
      const c = data && data.state !== "NONE" && !busy && !picked ? data.items.find((x) => !skipped.has(x.track_id)) : null;
      if (!c) return;
      e.preventDefault();
      setSkipped((s) => new Set(s).add(c.track_id));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  if (!data) return <p className="text-xs text-muted">{dict.common.loading}</p>;
  if (data.state === "NONE") return <p className="text-xs text-muted">{dict.body.workspace.noEventsYetWho}</p>;
  const name = data.player.display_name;
  const left = data.items.filter((x) => !skipped.has(x.track_id));
  const cur = left[0] ?? null;

  /** one decision about one track for him; a change of an earlier decision carries the reason */
  const decide = async (trackId: string, yes: boolean, why: string) => {
    const now = await api<TrackIdentity>(`/v1/tracks/${trackId}/identity`);
    if (now.state === (yes ? "CONFIRMED" : "REJECTED") && now.player?.player_id === playerId) return;
    if (now.state === "CONFIRMED" && now.player?.player_id !== playerId) throw new ApiProblem(409, "CONFLICT", dict.body.workspace.thatPlayerAlreadyNamed.replace("{a}", now.player?.display_name ?? dict.body.workspace.asSomeoneElse));
    await api(`/v1/tracks/${trackId}/identity-decisions`, { method: "POST",
      json: { state: yes ? "CONFIRMED" : "REJECTED", player_id: playerId, supersedes_id: now.decision_id, reason: now.decision_id ? why : null } });
  };
  const run = async (f: () => Promise<string>, named: boolean) => {
    setBusy(true); setMsg(null);
    try { const text = await f(); setMsg({ ok: true, text }); setPicked(null); await load(); if (named) await onNamed(); }
    catch (x) { setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.workspace.notSaved }); } finally { setBusy(false); }
  };
  const answer = (it: WhoItem, yes: boolean) => run(async () => {
    await decide(it.track_id, yes, yes ? (it.said_not_him ? dict.body.workspace.wasHimAfterAllName.replace("{a}", name) : dict.body.workspace.recognisedInEvent.replace("{a}", name)) : dict.body.workspace.notNameSeenEvent.replace("{a}", name));
    return yes ? (it.events === 1 ? dict.body.workspace.yesMoreEventsOne : dict.body.workspace.yesMoreEventsMany).replace("{a}", String(it.events)).replace("{b}", name) : dict.body.workspace.recordedNotHim.replace("{a}", name);
  }, yes);
  const moveTo = (it: WhoItem, o: Observation, seen: boolean) => run(async () => {
    // a player on screen together with one of his named tracks is someone else: unknown beats wrong
    const busyWith = data.his_spans.find((h) => h.track_id !== o.track_id && h.first_pts_us <= o.pts_us && o.pts_us <= h.last_pts_us);
    if (busyWith) throw new ApiProblem(409, "CONFLICT", dict.body.workspace.notSavedAlreadyNamed.replace("{a}", name));
    await decide(o.track_id, true, dict.body.workspace.boxMovedOnto.replace("{a}", name));
    // the boxed player seen at the same moment as him is someone else; not seen then, nothing is said about him
    if (seen) await decide(it.track_id, false, dict.body.workspace.boxOnSomeoneElse.replace("{a}", name));
    return dict.body.workspace.movedPlayerIs.replace("{a}", name).replace("{b}", String(o.track_number)).replace("{c}", seen ? dict.body.workspace.boxedOneNotHim : "");
  }, true);

  return (
    <div className="space-y-2" data-who={name}>
      <p className="text-xs text-muted">
        {revisit ? <>{dict.body.workspace.momentsSaidNot}<b>{name}</b>{dict.body.workspace.ifInPictureDrag}</>
          : <>{dict.body.workspace.momentsGreenBoxStart}<b>{name}</b>{dict.body.workspace.momentsGreenBoxEnd}</>} {(data.his_events === 1 ? (data.his_tracks === 1 ? dict.body.workspace.hisEventsOneTrack : dict.body.workspace.hisEventsOneTracks) : (data.his_tracks === 1 ? dict.body.workspace.hisEventsManyTrack : dict.body.workspace.hisEventsManyTracks)).replace("{a}", String(data.his_events)).replace("{b}", String(data.his_tracks))}{" "}
        <button type="button" className="text-primary" data-revisit onClick={() => { setMsg(null); setRevisit(!revisit); }}>{revisit ? dict.body.workspace.backToNewMoments : dict.body.workspace.goBackNo}</button>
      </p>
      {!cur ? <p className="text-xs text-muted">{data.items.length ? dict.body.workspace.youSkippedRest : revisit ? dict.body.workspace.noMomentMarkedNot.replace("{a}", name) : dict.body.workspace.noMorePossibleMoments.replace("{a}", name)}{skipped.size > 0 && <button type="button" className="text-primary" onClick={() => setSkipped(new Set())}>{dict.body.workspace.showSkippedAgain}</button>}</p> : (
        <div className="space-y-2" data-who-item={cur.track_number}>
          <MomentPreview key={cur.track_id} trackId={cur.track_id} runId={data.run_id} from={cur.moment.start_us - 2_000_000} to={cur.moment.end_us + 2_000_000}
            onMove={(o, seen) => { setMsg(null); setPicked(o); setBoxSeen(seen); }} picked={picked}
            label={dict.body.workspace.boxedPlayerLabel.replace("{a}", formatDuration(cur.moment.start_us)).replace("{b}", KIND[cur.moment.kind]).replace("{c}", String(left.length + data.more)).replace("{d}", revisit ? dict.body.workspace.toLookAgain : (left.length + data.more === 1 ? dict.body.workspace.possibleMomentsLeftOne : dict.body.workspace.possibleMomentsLeftMany))} />
          {picked ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{dict.body.workspace.isPlayerInBlueBox.replace("{a}", name)}</span>
              {data.kit_group !== null && picked.kit_group != null && picked.kit_group !== data.kit_group
                && <span className="text-xs text-amber">{dict.body.workspace.shirtColourDiffers.replace("{a}", name)}</span>}
              <button type="button" disabled={busy} onClick={() => void moveTo(cur, picked, boxSeen)} className="rounded-ctl bg-ok px-4 py-1.5 font-semibold text-black disabled:opacity-50">{dict.body.workspace.yesMoveBox}</button>
              <button type="button" disabled={busy} onClick={() => setPicked(null)} className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</button>
              <ImpactNote trackIds={[picked.track_id]} state="CONFIRMED" playerId={playerId} className="w-full" />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{cur.said_not_him ? dict.body.workspace.youSaidNotName.replace("{a}", name) : dict.body.workspace.isThisName.replace("{a}", name)}</span>
              {cur.said_not_him
                ? <button type="button" disabled={busy} onClick={() => void answer(cur, true)} className="rounded-ctl border border-line px-3 py-1.5 disabled:opacity-50">{dict.body.workspace.wasHimAfterAll}</button>
                : <>
                    <button type="button" disabled={busy} onClick={() => void answer(cur, true)} className="rounded-ctl bg-ok px-4 py-1.5 font-semibold text-black disabled:opacity-50">{dict.body.workspace.yesBtn}</button>
                    <button type="button" disabled={busy} onClick={() => void answer(cur, false)} className="rounded-ctl bg-danger px-4 py-1.5 font-semibold text-white disabled:opacity-50">{dict.body.workspace.noBtn}</button>
                  </>}
              <button type="button" disabled={busy} onClick={() => setSkipped((s) => new Set(s).add(cur.track_id))} title={dict.body.workspace.nextMomentTitle} className="rounded-ctl border border-line px-3 py-1.5">{cur.said_not_him ? dict.body.workspace.nextPlain : dict.body.workspace.cantTell}</button>
              <span className="text-xs text-muted">{dict.body.workspace.thisPlayerInEvents.replace("{a}", String(cur.events)).replace("{b}", cur.events === 1 ? dict.body.workspace.eventSingularSuffix : dict.body.workspace.eventPluralSuffix).replace("{c}", cur.look !== null ? dict.body.workspace.looksAlikeSuffix.replace("{a}", String(Math.round(cur.look * 100))) : "")}</span>
              <ImpactNote trackIds={[cur.track_id]} state="CONFIRMED" playerId={playerId} className="w-full" />
            </div>
          )}
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}
