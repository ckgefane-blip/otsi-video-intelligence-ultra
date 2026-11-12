"use client";
/**
 * v3 Phase B.6 (ADR-084): the selected track's Properties, everything recorded about it in one place.
 *   Track          number, kind, when it is seen (click a time to go there), detections, mean detection confidence, kit colour group and team
 *   Identity       the current decision: the player and his OTSI Player ID only when CONFIRMED, who decided and when, on what basis and why;
 *                  then every earlier decision (superseded ones say so). A suggestion is never shown as the identity.
 *   Evidence       the shirt number read on the track (or a person's verdict) and the engine's ranked suggestions, labelled as suggestions
 *   Linked tracks  tracks the engine thinks are the same person before or after this one, with each link's state
 *   Look-alikes    tracks anywhere in the match that look like this person (appearance similarity, not a probability); click to select one
 * Read only: deciding stays in the Identify dialog and the identity review.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { IdentityHistoryEntry, JerseyEvidence, LookAlikes, TrackCandidates, TrackIdentity, TrackLink, TrackSummary } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Evidence } from "@/components/evidence/Evidence";
import { assignmentOf, clock, type Shared } from "./shared";
import { getDictionary, useLocale, type Dictionary } from "@/lib/i18n";

type Data = {
  identity: TrackIdentity | null; history: IdentityHistoryEntry[] | null; jersey: JerseyEvidence | null; candidates: TrackCandidates | null;
  links: TrackLink[] | null; lookAlikes: LookAlikes | null;
};
const EMPTY: Data = { identity: null, history: null, jersey: null, candidates: null, links: null, lookAlikes: null };
const BASIS = (d: Dictionary): Record<IdentityHistoryEntry["basis"], string> => ({ HUMAN: d.body.workspace.byPerson, AUTO_POLICY: d.body.workspace.byEngineRule, REGISTRY: d.body.workspace.fromRegistry });
const STATE = (d: Dictionary): Record<string, string> => ({ CONFIRMED: d.body.workspace.confirmedLabel, CANDIDATE: d.body.workspace.suggestedLabel, UNRESOLVED: d.body.workspace.notIdentified, REJECTED: d.body.workspace.rejectedLabel, CONFLICT: d.body.workspace.conflictLabel });
const day = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** what the card says about who the track is: a name only for a CONFIRMED decision */
export function identityLine(id: TrackIdentity | null, current: IdentityHistoryEntry | null, d?: Dictionary): { title: string; detail: string | null } {
  const dict = d ?? getDictionary("en");
  if (!id) return { title: dict.body.processing.reading, detail: null };
  if (id.state === "CONFIRMED" && id.player) {
    return { title: `${id.player.display_name} · ${id.player.canonical_otsi_id ?? dict.body.workspace.provisionalNoId}`,
      detail: current ? dict.body.workspace.confirmedDetail.replace("{a}", BASIS(dict)[current.basis]).replace("{b}", current.decided_by ? dict.body.workspace.decidedBy.replace("{a}", current.decided_by.name) : "").replace("{c}", day(current.decided_at)) : null };
  }
  return { title: STATE(dict)[id.state] ?? id.state, detail: id.state === "CANDIDATE" ? dict.body.workspace.suggestionOnly : null };
}

export function PropertiesDialog({ s, track, open, onOpenChange }: { s: Shared; track: TrackSummary | null; open: boolean; onOpenChange(o: boolean): void }) {
  const { t: dict } = useLocale();
  const ws = s.ws;
  const [d, setD] = useState<Data>(EMPTY);
  const id = track?.track_id ?? null;
  const person = !!track && track.class_name !== "BALL";
  useEffect(() => {
    setD(EMPTY);
    if (!open || !id || !person) return;
    let live = true;
    const put = <K extends keyof Data>(k: K) => (v: Data[K]) => { if (live) setD((x) => ({ ...x, [k]: v })); };
    const get = <T,>(path: string) => api<T>(path).catch(() => null);
    void get<TrackIdentity>(`/v1/tracks/${id}/identity`).then(put("identity"));
    void get<IdentityHistoryEntry[]>(`/v1/tracks/${id}/identity-history`).then((v) => put("history")(v ?? []));
    void get<JerseyEvidence>(`/v1/tracks/${id}/jersey`).then(put("jersey"));
    void get<TrackCandidates>(`/v1/tracks/${id}/candidates`).then(put("candidates"));
    void get<TrackLink[]>(`/v1/tracks/${id}/links`).then((v) => put("links")(v ?? []));
    void get<LookAlikes>(`/v1/tracks/${id}/look-alikes`).then(put("lookAlikes"));
    return () => { live = false; };
  }, [open, id, person]);
  if (!track) return null;
  const a = assignmentOf(s.kits, track);
  const current = d.history?.find((h) => h.current) ?? null;
  const who = identityLine(d.identity, current, dict);
  const go = (us: number) => { ws?.seek(us); onOpenChange(false); };
  const pick = (trackId: string, us: number) => { ws?.select(trackId); ws?.seek(us); onOpenChange(false); };
  const Time = ({ us }: { us: number }) => <button type="button" className="font-mono text-[#9fd0ff] underline-offset-2 hover:underline" onClick={() => go(us)}>{clock(us)}</button>;
  const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="properties" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(760px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-semibold">{dict.body.workspace.propertiesTrack.replace("{a}", String(track.track_number))}</Dialog.Title>
          <Dialog.Description className="text-xs text-muted">{dict.body.workspace.everythingRecorded}</Dialog.Description>

          <H>{dict.body.workspace.trackLabel}</H>
          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1" data-props="track">
            <dt className="text-muted">{dict.body.analysis.kindLabel}</dt><dd>{track.class_name === "GOALKEEPER" ? dict.body.workspace.goalkeeper : track.class_name === "REFEREE" ? dict.body.workspace.referee : track.class_name === "BALL" ? dict.body.processing.ball : dict.body.workspace.personLabel}</dd>
            <dt className="text-muted">{dict.body.analysis.seenLabel}</dt><dd><Time us={track.first_pts_us} /> – <Time us={track.last_pts_us} /> ({Math.max(0, Math.round((track.last_pts_us - track.first_pts_us) / 1_000_000))} s)</dd>
            <dt className="text-muted">{dict.body.workspace.detectionsLabel}</dt><dd className="flex items-center gap-2">{track.observation_count} · mean confidence {track.mean_confidence?.toFixed(2) ?? "—"} <Evidence level="DETECTED" size={12} /></dd>
            <dt className="text-muted">{dict.body.library.team}</dt><dd>{a ? (a.club_name ?? dict.body.workspace.noTeam) : dict.body.workspace.notAssigned}{a ? <span className="text-xs text-muted">{dict.body.workspace.kitGroupByPerson}</span> : <span className="text-xs text-muted">{dict.body.workspace.assignKitsFirst}</span>}</dd>
          </dl>

          {person && (
            <>
              <H>{dict.body.upload.identity}</H>
              <div data-props="identity" className="rounded-ctl border border-line/60 p-2.5">
                <p className="font-semibold" data-props-who>{who.title}</p>
                {who.detail && <p className="text-xs text-muted">{who.detail}</p>}
                {current?.reason && <p className="mt-1 text-xs">{dict.body.workspace.whyWithReason.replace("{a}", current.reason)}</p>}
              </div>
              {d.history && d.history.length > 1 && (
                <ol className="mt-2 space-y-1" data-props-history>
                  {d.history.filter((h) => !h.current).map((h) => (
                    <li key={h.decision_id} className="text-xs text-muted">
                      <span className="line-through">{STATE(dict)[h.state] ?? h.state}{h.player ? ` ${h.player.display_name}` : ""}</span>
                      {dict.body.workspace.historyReplaced.replace("{a}", BASIS(dict)[h.basis]).replace("{b}", h.decided_by ? dict.body.workspace.decidedBy.replace("{a}", h.decided_by.name) : "").replace("{c}", day(h.decided_at))}{h.reason ? ` · ${h.reason}` : ""}
                    </li>
                  ))}
                </ol>
              )}
              {d.history && d.history.length === 0 && <p className="mt-1 text-xs text-muted">{dict.body.workspace.noIdentityDecision}</p>}

              <H>{dict.body.aiAnalyst.evidence}</H>
              <div data-props="evidence" className="space-y-1">
                <p>Shirt number: {d.jersey ? (d.jersey.decision ? (d.jersey.decision.state === "CONFIRMED" ? <span className="font-semibold">{dict.body.workspace.shirtConfirmedByPerson.replace("{a}", String(d.jersey.decision.number))}</span> : dict.body.workspace.unreadablePerson)
                  : d.jersey.number ? <>{d.jersey.number} <span className="text-xs text-muted">{(d.jersey.frames.length === 1 ? dict.body.workspace.readOnFramesOne : dict.body.workspace.readOnFramesMany).replace("{a}", String(d.jersey.frames.length)).replace("{b}", d.jersey.confidence?.toFixed(2) ?? "—")}</span></> : dict.body.workspace.notReadShirt)
                  : "—"}</p>
                {d.candidates && d.candidates.candidates.length > 0 ? (
                  <ul className="text-xs" data-props-candidates>
                    <li className="text-muted">{dict.body.workspace.suggestionsRanked}</li>
                    {d.candidates.candidates.slice(0, 3).map((c) => (
                      <li key={c.player_id}>{c.display_name}{c.canonical_otsi_id ? ` · ${c.canonical_otsi_id}` : ""} <span className="text-muted">strength {c.strength.toFixed(2)}{c.conflicts.length ? ` · ${c.conflicts.join("; ")}` : ""}</span></li>
                    ))}
                  </ul>
                ) : d.candidates ? <p className="text-xs text-muted">{dict.body.workspace.noSuggestionsRoster}</p> : null}
              </div>

              <H>{dict.body.workspace.linkedTracks}</H>
              {d.links === null ? <p className="text-xs text-muted">{dict.body.processing.reading}</p> : d.links.length === 0 ? <p className="text-xs text-muted" data-props-links="0">{dict.body.workspace.noLinkedTracks}</p> : (
                <ul className="space-y-1 text-xs" data-props-links={d.links.length}>
                  {d.links.map((l) => (
                    <li key={l.link_id} className="flex items-center gap-2">
                      <button type="button" className="text-[#9fd0ff] hover:underline" onClick={() => pick(l.other.track_id, l.other.first_pts_us)}>{dict.body.workspace.trackButton.replace("{a}", String(l.other.track_number))}</button>
                      <span className="text-muted">{dict.body.workspace.linkLine.replace("{a}", l.direction === "before" ? dict.body.workspace.beforeWord : dict.body.workspace.afterWord).replace("{b}", clock(l.other.first_pts_us)).replace("{c}", clock(l.other.last_pts_us)).replace("{d}", l.state.toLowerCase()).replace("{e}", l.crosses_cut ? dict.body.workspace.acrossCutSuffix : "")}</span>
                    </li>
                  ))}
                </ul>
              )}

              <H>{dict.body.workspace.lookAlikes}</H>
              {d.lookAlikes === null ? <p className="text-xs text-muted">{dict.body.processing.reading}</p> : d.lookAlikes.items.length === 0 ? <p className="text-xs text-muted" data-props-looks="0">{dict.body.workspace.noLookalikes}</p> : (
                <ul className="space-y-1 text-xs" data-props-looks={d.lookAlikes.items.length}>
                  <li className="text-muted">{dict.body.workspace.appearanceSimilarity}</li>
                  {d.lookAlikes.items.slice(0, 6).map((x) => (
                    <li key={x.other.track_id} className="flex items-center gap-2">
                      <button type="button" className="text-[#9fd0ff] hover:underline" onClick={() => pick(x.other.track_id, x.other.first_pts_us)}>{dict.body.workspace.trackButton.replace("{a}", String(x.other.track_number))}</button>
                      <span className="text-muted">{clock(x.other.first_pts_us)} · {dict.body.workspace.similarityValue.replace("{a}", x.similarity.toFixed(2))} · {x.other.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="mt-4 text-right"><Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.close}</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
