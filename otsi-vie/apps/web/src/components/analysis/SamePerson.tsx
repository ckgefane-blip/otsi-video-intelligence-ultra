"use client";
/**
 * Same-person evidence for one track (Block 07, ADR-031): its thumbnail and kit colour, a warning when its appearance changes so much that it
 * may contain two people, link suggestions to tracks before/after it (across occlusions and camera cuts) with confirm / not-the-same
 * decisions, the identity confirmed on a linked track as a SUGGESTION, and "apply to the whole group" — always an explicit human action,
 * recorded as one identity decision per track. Nothing here confirms anything on its own.
 */
import type { LookAlikes, PersonGroup, TrackIdentity, TrackLink, TrackSummary } from "@otsi-vie/contracts";
import { AlertTriangle, Scissors } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { trackLabel } from "@/lib/identity";
import { useLocale } from "@/lib/i18n";

const thumbCache = new Map<string, string | null>();

export function TrackThumb({ trackId, has, size = 40 }: { trackId: string; has: boolean | undefined; size?: number }) {
  const { t: dict } = useLocale();
  const [url, setUrl] = useState<string | null>(thumbCache.get(trackId) ?? null);
  useEffect(() => {
    if (!has || thumbCache.has(trackId)) { setUrl(thumbCache.get(trackId) ?? null); return; }
    let live = true;
    void apiBlob(`/v1/tracks/${trackId}/thumbnail`).then((b) => { const u = URL.createObjectURL(b); thumbCache.set(trackId, u); if (live) setUrl(u); },
      () => { thumbCache.set(trackId, null); });
    return () => { live = false; };
  }, [trackId, has]);
  return url
    ? <img src={url} alt={dict.body.analysis.cropAlt.replace("{a}", trackId.slice(0, 8))} data-thumb={trackId} style={{ width: size, height: size * 1.5 }} className="shrink-0 rounded border border-line object-cover" />
    : <span aria-hidden style={{ width: size, height: size * 1.5 }} className="shrink-0 rounded border border-line/50 bg-raised/40" />;
}

export function KitSwatch({ t }: { t: Pick<TrackSummary, "kit_group" | "kit_rgb"> }) {
  const { t: dict } = useLocale();
  if (!t.kit_rgb) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted" title={dict.body.analysis.kitGroupTitle}>
      <span aria-hidden className="h-2.5 w-2.5 rounded-sm border border-line" style={{ background: t.kit_rgb }} />
      {t.kit_group === null || t.kit_group === undefined ? dict.body.analysis.noKitGroup : dict.body.analysis.kitLetter.replace("{a}", String.fromCharCode(65 + t.kit_group))}
    </span>
  );
}

const fmt = (us: number) => `${(us / 1e6).toFixed(1)} s`;

export function SamePersonPanel({ track, identity, canReview, onChanged, seek, select }: {
  track: TrackSummary; identity: TrackIdentity | null; canReview: boolean; onChanged(): Promise<void>; seek(t: number): void; select(id: string): void;
}) {
  const { t: dict } = useLocale();
  const [links, setLinks] = useState<TrackLink[] | null>(null);
  const [group, setGroup] = useState<PersonGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    const [l, g] = await Promise.all([api<TrackLink[]>(`/v1/tracks/${track.track_id}/links`), api<PersonGroup>(`/v1/tracks/${track.track_id}/person-group`)]);
    setLinks(l); setGroup(g);
  }, [track.track_id]);
  useEffect(() => { setLinks(null); setGroup(null); setMsg(null); setReason(""); void load().catch(() => setLinks([])); }, [load]);

  const act = (f: () => Promise<string>) => {
    setBusy(true); setMsg(null);
    void f().then(async (text) => { setMsg({ ok: true, text }); setReason(""); await load(); await onChanged(); },
      (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.analysis.thatDidNotWork })).finally(() => setBusy(false));
  };
  const decideLink = (l: TrackLink, state: "CONFIRMED" | "REJECTED" | "UNRESOLVED") => act(async () => {
    await api(`/v1/track-links/${l.link_id}/decisions`, { method: "POST", json: { state, supersedes_id: l.decision_id, reason: l.decision_id ? reason.trim() || null : null } });
    return state === "CONFIRMED" ? dict.body.analysis.linkedSame.replace("{a}", trackLabel(track.track_number)).replace("{b}", trackLabel(l.other.track_number))
      : state === "REJECTED" ? dict.body.analysis.recordedNotSame.replace("{a}", trackLabel(l.other.track_number)) : dict.body.analysis.linkReset;
  });
  /** identity decision on one track (a correction when it already has one) */
  const decideIdentity = async (trackId: string, playerId: string, why: string) => {
    const cur = await api<TrackIdentity>(`/v1/tracks/${trackId}/identity`);
    if (cur.state === "CONFIRMED" && cur.player?.player_id === playerId) return "same";
    if (cur.state === "CONFIRMED") return "conflict";
    await api(`/v1/tracks/${trackId}/identity-decisions`, { method: "POST", json: { state: "CONFIRMED", player_id: playerId, supersedes_id: cur.decision_id, reason: cur.decision_id ? why : null } });
    return "done";
  };
  const useSuggestion = (l: TrackLink) => act(async () => {
    const p = l.other.confirmed_player!;
    const r = await decideIdentity(track.track_id, p.player_id, dict.body.analysis.samePersonAsLink.replace("{a}", trackLabel(l.other.track_number)));
    if (r === "conflict") throw new ApiProblem(409, "CONFLICT", dict.body.analysis.conflictAlready);
    return dict.body.analysis.confirmedAs.replace("{a}", trackLabel(track.track_number)).replace("{b}", p.display_name);
  });
  const applyToGroup = () => act(async () => {
    const pid = identity?.player?.player_id;
    if (!pid || !group) throw new ApiProblem(400, "NO_IDENTITY", dict.body.analysis.confirmIdentityFirst);
    let done = 0, conflicts = 0;
    for (const t of group.tracks) {
      if (t.track_id === track.track_id) continue;
      const r = await decideIdentity(t.track_id, pid, dict.body.analysis.samePersonAsConfirmedLink.replace("{a}", trackLabel(track.track_number)));
      if (r === "done") done++; else if (r === "conflict") conflicts++;
    }
    return done === 1
      ? dict.body.analysis.appliedToOne.replace("{a}", conflicts ? dict.body.analysis.appliedConflicts.replace("{a}", String(conflicts)) : "")
      : dict.body.analysis.appliedToMany.replace("{a}", String(done)).replace("{b}", conflicts ? dict.body.analysis.appliedConflicts.replace("{a}", String(conflicts)) : "");
  });

  if (track.class_name === "BALL") return null;
  const open = links?.filter((l) => l.state === "PROPOSED") ?? [];
  const decided = links?.filter((l) => l.state !== "PROPOSED") ?? [];
  const conflict = (group?.confirmed_player_ids.length ?? 0) > 1;
  const needsReason = decided.length > 0;
  return (
    <div className="space-y-2 rounded-ctl border border-line/70 p-2 text-sm" aria-label={dict.body.analysis.samePersonElsewhere}>
      <div className="flex items-center gap-2">
        <TrackThumb trackId={track.track_id} has={track.has_thumbnail} size={36} />
        <div className="min-w-0 space-y-0.5">
          <KitSwatch t={track} />
          {track.possible_identity_switch && (
            <p data-identity-switch className="flex items-center gap-1 text-xs text-amber"><AlertTriangle className="h-3.5 w-3.5" />{dict.body.analysis.appearanceChanges}</p>
          )}
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{dict.body.analysis.samePersonElsewhereQ}</p>
      {!links ? <p className="text-xs text-muted">{dict.common.loading}</p> : links.length === 0 ? <p className="text-xs text-muted">{dict.body.analysis.noSuggestionLookalike}</p> : (
        <ul aria-label={dict.body.analysis.samePersonSuggestions} className="space-y-1.5">
          {[...open, ...decided].map((l) => (
            <li key={l.link_id} data-link={l.link_id} data-link-state={l.state} className="flex items-start gap-2 rounded border border-line/50 p-1.5">
              <button type="button" onClick={() => { select(l.other.track_id); seek(l.other.first_pts_us); }} title={dict.body.analysis.showThatTrack} className="shrink-0">
                <TrackThumb trackId={l.other.track_id} has={l.other.has_thumbnail} size={28} />
              </button>
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate font-medium">{l.other.label}</p>
                <p className="text-muted">{l.direction === "before" ? dict.body.analysis.earlier : dict.body.analysis.later} · {fmt(l.other.first_pts_us)}–{fmt(l.other.last_pts_us)} · {dict.body.analysis.gapLabel} {fmt(l.gap_us)}
                  {l.crosses_cut && <span className="ml-1 inline-flex items-center gap-0.5 text-cyan"><Scissors className="h-3 w-3" />{dict.body.analysis.acrossCut}</span>}
                  {" "}· {dict.body.analysis.scoreLabel} {l.score.toFixed(2)}</p>
                {l.state !== "PROPOSED" && <p className={l.state === "CONFIRMED" ? "text-ok" : "text-muted"}>{l.state === "CONFIRMED" ? dict.body.analysis.confirmedSamePerson : l.state === "REJECTED" ? dict.body.analysis.notSamePerson : dict.body.analysis.resetState}</p>}
                {l.other.confirmed_player && track.identity_state !== "CONFIRMED" && (
                  <p data-identity-suggestion className="mt-0.5">{dict.body.analysis.suggestionLabel}<span className="font-medium">{l.other.confirmed_player.display_name}</span> {dict.body.analysis.confirmedOn.replace("{a}", trackLabel(l.other.track_number))}</p>
                )}
                {canReview && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {l.state !== "CONFIRMED" && <button type="button" disabled={busy || (!!l.decision_id && reason.trim().length < 3)} onClick={() => decideLink(l, "CONFIRMED")} className="rounded border border-line px-1.5 py-0.5 hover:border-ok/60 disabled:opacity-50">{dict.body.analysis.samePersonBtn}</button>}
                    {l.state !== "REJECTED" && <button type="button" disabled={busy || (!!l.decision_id && reason.trim().length < 3)} onClick={() => decideLink(l, "REJECTED")} className="rounded border border-line px-1.5 py-0.5 hover:border-danger/60 disabled:opacity-50">{dict.body.analysis.notSameBtn}</button>}
                    {l.other.confirmed_player && track.identity_state !== "CONFIRMED" && l.state === "CONFIRMED" && (
                      <button type="button" disabled={busy} onClick={() => useSuggestion(l)} className="rounded border border-primary/60 px-1.5 py-0.5 text-primary">{dict.body.analysis.useSuggestion.replace("{a}", l.other.confirmed_player.display_name)}</button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canReview && needsReason && (
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dict.body.analysis.reasonChangingLink} aria-label={dict.body.analysis.reasonChangingLinkLabel}
          className="w-full rounded-ctl border border-line bg-canvas px-2 py-1 text-xs" />
      )}
      {group && group.tracks.length > 1 && (
        <div className="rounded border border-line/50 p-1.5 text-xs" data-person-group={group.tracks.length}>
          <p>{dict.body.analysis.samePersonOnTracks.replace("{a}", String(group.tracks.length)).replace("{b}", group.tracks.map((x) => trackLabel(x.track_number)).join(", "))}</p>
          {conflict && <p role="alert" className="text-danger">{dict.body.analysis.conflictDifferent}</p>}
          {canReview && identity?.state === "CONFIRMED" && identity.player && !conflict && (
            <button type="button" disabled={busy} onClick={applyToGroup} className="mt-1 rounded border border-primary/60 px-1.5 py-0.5 text-primary">{dict.body.analysis.applyToAllLinked.replace("{a}", identity.player.display_name)}</button>
          )}
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      <p className="text-[11px] text-muted">{dict.body.analysis.suggestionsAppearance}</p>
    </div>
  );
}

/** Tracks anywhere in the match that look like this person (GET /v1/tracks/:id/look-alikes): gathered from every track already confirmed as
 * him, so each "This is him" widens the search. Each choice is one identity decision on that track, made by a person. */
export function LookAlikePanel({ track, identity, canReview, onChanged, seek, select }: {
  track: TrackSummary; identity: TrackIdentity | null; canReview: boolean; onChanged(): Promise<void>; seek(t: number): void; select(id: string): void;
}) {
  const { t: dict } = useLocale();
  const [data, setData] = useState<LookAlikes | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const confirmed = identity?.state === "CONFIRMED" ? identity.player : null;
  const load = useCallback(async () => setData(await api<LookAlikes>(`/v1/tracks/${track.track_id}/look-alikes`)), [track.track_id]);
  useEffect(() => { setData(null); setMsg(null); void load().catch(() => setData({ track_id: track.track_id, player: null, seeds: 0, items: [], more: 0 })); }, [load, confirmed?.player_id]);
  if (track.class_name === "BALL") return null;

  const decide = (o: LookAlikes["items"][number]["other"], state: "CONFIRMED" | "REJECTED") => {
    if (!confirmed) return;
    setBusy(o.track_id); setMsg(null);
    void (async () => {
      const cur = await api<TrackIdentity>(`/v1/tracks/${o.track_id}/identity`);
      await api(`/v1/tracks/${o.track_id}/identity-decisions`, { method: "POST", json: { state, player_id: confirmed.player_id, supersedes_id: cur.decision_id,
        reason: cur.decision_id ? (state === "CONFIRMED" ? dict.body.analysis.looksLikeConfirmed.replace("{a}", confirmed.display_name) : dict.body.analysis.notConfirmedLookalike.replace("{a}", confirmed.display_name)) : null } });
      return state === "CONFIRMED" ? dict.body.analysis.lookalikeAdded.replace("{a}", trackLabel(o.track_number)).replace("{b}", confirmed.display_name) : dict.body.analysis.recordedNotName.replace("{a}", trackLabel(o.track_number)).replace("{b}", confirmed.display_name);
    })().then(async (text) => { setMsg({ ok: true, text }); await load(); await onChanged(); },
      (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.analysis.thatDidNotWork })).finally(() => setBusy(null));
  };

  return (
    <div className="space-y-2 rounded-ctl border border-line/70 p-2 text-sm" aria-label={dict.body.analysis.looksLikeElsewhere} data-look-alikes={data?.items.length ?? ""}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{dict.body.analysis.looksLikeElsewhereName.replace("{a}", confirmed ? confirmed.display_name : dict.body.analysis.looksLikeThisPerson)}</p>
      {!confirmed && <p className="text-xs text-muted">{dict.body.analysis.nameFirst}</p>}
      {!data ? <p className="text-xs text-muted">{dict.common.loading}</p> : data.items.length === 0 ? (
        <p className="text-xs text-muted">{data.seeds > 1 ? dict.body.analysis.noMoreLookalikesFrom.replace("{a}", String(data.seeds)) : dict.body.analysis.noMoreLookalikes}</p>
      ) : (
        <ul className="space-y-1.5" aria-label={dict.body.analysis.lookAlikeTracks}>
          {data.items.map(({ other: o, similarity, resembles }) => (
            <li key={o.track_id} data-look-alike={o.track_number} className="flex items-start gap-2 rounded border border-line/50 p-1.5">
              <TrackThumb trackId={o.track_id} has={o.has_thumbnail} size={30} />
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate font-medium">{trackLabel(o.track_number)} · {fmt(o.first_pts_us)}–{fmt(o.last_pts_us)}</p>
                <p className="text-muted">{dict.body.analysis.looksAlike.replace("{a}", String(Math.round(similarity * 100)))}{resembles > 1 ? ` ${dict.body.analysis.resembles.replace("{a}", String(resembles))}` : ""}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <button type="button" onClick={() => seek(o.first_pts_us)} className="rounded border border-line px-1.5 py-0.5">{dict.body.analysis.showBtn}</button>
                  {canReview && confirmed && (
                    <>
                      <button type="button" disabled={!!busy} onClick={() => decide(o, "CONFIRMED")} className="rounded border border-ok/60 px-1.5 py-0.5 text-ok disabled:opacity-50">{dict.body.analysis.thisIsHim}</button>
                      <button type="button" disabled={!!busy} onClick={() => decide(o, "REJECTED")} className="rounded border border-line px-1.5 py-0.5 hover:border-danger/60 disabled:opacity-50">{dict.body.analysis.notHim}</button>
                    </>
                  )}
                  <button type="button" onClick={() => { select(o.track_id); seek(o.first_pts_us); }} title={dict.body.analysis.openTrackWindow} className="rounded border border-line px-1.5 py-0.5 text-muted">{dict.body.processing.openBtn}</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      <p className="text-[11px] text-muted">{dict.body.analysis.lookalikesNote}</p>
    </div>
  );
}
