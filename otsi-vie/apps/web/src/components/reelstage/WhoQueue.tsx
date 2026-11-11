"use client";
/**
 * v3 Phase B.15 (ADR-091): "Is this him?" inside the Reel Builder. The tracks anywhere in the match that look like the reel's player
 * (GET /v1/tracks/:id/look-alikes, from his confirmed tracks), one at a time: Show plays that moment here, "This is him" / "Not him" record
 * one identity decision by this person, Skip moves on. Only the reel's player is asked about (never "who is everyone"). After a "This is
 * him", "Take in his new tracks" refreshes the reel's followed tracks so his new moments appear. Suggestions are appearance only, not proof.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { LookAlikes, Playback, Reel, TrackIdentity } from "@otsi-vie/contracts";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { trackLabel } from "@/lib/identity";
import { TrackThumb } from "@/components/analysis/SamePerson";
import type { ReelState } from "@/components/reels/ReelBuilder";

const mmss = (us: number) => { const s = Math.floor(us / 1e6); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function WhoQueue({ r, reel, open, onOpenChange }: { r: ReelState; reel: Reel; open: boolean; onOpenChange(o: boolean): void }) {
  const { t: dict } = useLocale();
  const d = dict.body.reelstage;
  const seed = reel.targets.find((t) => t.decision_current)?.track_id ?? null;
  const player = reel.player;
  const [data, setData] = useState<LookAlikes | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [added, setAdded] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const vid = useRef<HTMLVideoElement | null>(null);
  const load = useCallback(async () => {
    if (!seed) { setData({ track_id: "", player: null, seeds: 0, items: [], more: 0 } as LookAlikes); return; }
    setData(await api<LookAlikes>(`/v1/tracks/${seed}/look-alikes`));
  }, [seed]);
  useEffect(() => {
    if (!open) return;
    setData(null); setMsg(null); setAdded(0); setSkipped(new Set());
    void load().catch(() => setData({ track_id: "", player: null, seeds: 0, items: [], more: 0 } as LookAlikes));
    void api<Playback>(`/v1/videos/${reel.video_id}/playback`).then((p) => setUrl(p.url ?? null), () => setUrl(null));
  }, [open, load, reel.video_id]);
  useEffect(() => () => vid.current?.pause(), []);

  const queue = (data?.items ?? []).filter((x) => !skipped.has(x.other.track_id));
  const cur = queue[0] ?? null;
  const show = (t: number) => { const v = vid.current; if (v) { v.currentTime = t / 1e6; void v.play().catch(() => undefined); } };
  useEffect(() => { if (cur && vid.current) { vid.current.pause(); vid.current.currentTime = cur.other.first_pts_us / 1e6; } }, [cur?.other.track_id, url]);   // eslint-disable-line react-hooks/exhaustive-deps

  const decide = (state: "CONFIRMED" | "REJECTED") => {
    if (!cur || !player) return;
    const o = cur.other;
    setBusy(true); setMsg(null); vid.current?.pause();
    void (async () => {
      const id = await api<TrackIdentity>(`/v1/tracks/${o.track_id}/identity`);
      await api(`/v1/tracks/${o.track_id}/identity-decisions`, { method: "POST", json: { state, player_id: player.player_id, supersedes_id: id.decision_id,
        reason: id.decision_id ? (state === "CONFIRMED" ? `looks like ${player.display_name} (reviewed in the Reel Builder)` : `not ${player.display_name} (reviewed in the Reel Builder)`) : null } });
    })().then(async () => {
      if (state === "CONFIRMED") setAdded((n) => n + 1);
      setMsg({ ok: true, text: state === "CONFIRMED" ? d.whoIs.replace("{a}", d.trackWord.replace("{a}", String(o.track_number))).replace("{b}", player.display_name) : d.whoIsNot.replace("{a}", d.trackWord.replace("{a}", String(o.track_number))).replace("{b}", player.display_name) });
      await load();
    }, (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.analysis.thatDidNotWork })).finally(() => setBusy(false));
  };
  const takeIn = () => {
    onOpenChange(false);
    r.run(() => api<Reel>(`/v1/reels/${reel.id}/refresh-targets`, { method: "POST" }),
      (nr, m) => d.whoTakeInMsg.replace("{a}", String(nr?.targets.length ?? 0)).replace("{b}", player?.display_name ?? dict.body.reels.momentsIntroPlayer).replace("{c}", String(m?.length ?? 0)));
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) vid.current?.pause(); onOpenChange(o); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="who-queue" className="fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(720px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-semibold">{d.whoTitle.replace("{a}", player?.display_name ?? d.whoTitleHim)}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            {d.whoDesc}
          </Dialog.Description>
          {!player || !seed ? <p className="text-xs text-muted">{d.whoNoPlayer}</p>
            : !data ? <p className="text-xs text-muted">{d.whoLoading}</p>
            : !cur ? <p className="text-xs text-muted" data-who-empty>{data.seeds > 1 ? d.whoEmptySeeds.replace("{a}", String(data.seeds)) : d.whoEmpty}.</p>
            : (
              <div className="grid gap-2" data-who-current={cur.other.track_number}>
                {url ? <video ref={vid} src={url} preload="metadata" playsInline muted controls className="aspect-video w-full rounded bg-black" aria-label={d.whoMomentAria} />
                  : <p className="text-xs text-muted">{d.whoNoPlayback}</p>}
                <div className="flex items-center gap-2">
                  <TrackThumb trackId={cur.other.track_id} has={cur.other.has_thumbnail} size={48} />
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-medium">{d.trackWord.replace("{a}", String(cur.other.track_number))} · {mmss(cur.other.first_pts_us)}–{mmss(cur.other.last_pts_us)}</p>
                    <p className="text-muted">{d.whoLooks.replace("{a}", String(Math.round(cur.similarity * 100)))}{cur.resembles > 1 ? d.whoResembles.replace("{a}", String(cur.resembles)) : ""}{d.whoToCheck.replace("{a}", String(queue.length))}</p>
                  </div>
                  <button type="button" onClick={() => show(cur.other.first_pts_us)} disabled={!url} className="rounded-ctl border border-line px-2 py-1 text-xs disabled:opacity-50">{d.whoShow}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" data-who="him" disabled={busy || !r.canEdit} onClick={() => decide("CONFIRMED")} className="rounded-ctl border border-ok/60 px-3 py-1.5 text-ok disabled:opacity-50">{d.whoHim}</button>
                  <button type="button" data-who="not" disabled={busy || !r.canEdit} onClick={() => decide("REJECTED")} className="rounded-ctl border border-line px-3 py-1.5 disabled:opacity-50">{d.whoNot}</button>
                  <button type="button" data-who="skip" disabled={busy} onClick={() => setSkipped(new Set([...skipped, cur.other.track_id]))} className="rounded-ctl border border-line px-3 py-1.5 text-muted">{d.whoSkip}</button>
                </div>
                {!r.canEdit && <p className="text-xs text-muted">{d.whoCannotDecide}</p>}
              </div>
            )}
          {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Link href={`/analysis?video=${reel.video_id}${player ? `&find=${player.player_id}` : ""}`} className="mr-auto text-xs text-[#33a8ff]">{d.whoOpenAnalysis}</Link>
            {added > 0 && <button type="button" data-who-take-in onClick={takeIn} className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">{(added === 1 ? d.whoTakeInOne : d.whoTakeInMany).replace("{a}", String(added))}</button>}
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-ctl border border-line px-3 py-1.5">{dict.common.close}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
