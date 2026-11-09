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

type Data = {
  identity: TrackIdentity | null; history: IdentityHistoryEntry[] | null; jersey: JerseyEvidence | null; candidates: TrackCandidates | null;
  links: TrackLink[] | null; lookAlikes: LookAlikes | null;
};
const EMPTY: Data = { identity: null, history: null, jersey: null, candidates: null, links: null, lookAlikes: null };
const BASIS: Record<IdentityHistoryEntry["basis"], string> = { HUMAN: "by a person", AUTO_POLICY: "by an engine rule", REGISTRY: "from the player registry" };
const STATE: Record<string, string> = { CONFIRMED: "Confirmed", CANDIDATE: "Suggested", UNRESOLVED: "Not identified", REJECTED: "Rejected", CONFLICT: "Conflict" };
const day = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** what the card says about who the track is: a name only for a CONFIRMED decision */
export function identityLine(id: TrackIdentity | null, current: IdentityHistoryEntry | null): { title: string; detail: string | null } {
  if (!id) return { title: "Reading…", detail: null };
  if (id.state === "CONFIRMED" && id.player) {
    return { title: `${id.player.display_name} · ${id.player.canonical_otsi_id ?? "provisional, no OTSI Player ID yet"}`,
      detail: current ? `Confirmed ${BASIS[current.basis]}${current.decided_by ? ` (${current.decided_by.name})` : ""} on ${day(current.decided_at)}` : null };
  }
  return { title: STATE[id.state] ?? id.state, detail: id.state === "CANDIDATE" ? "A suggestion only: nobody has confirmed who this is" : null };
}

export function PropertiesDialog({ s, track, open, onOpenChange }: { s: Shared; track: TrackSummary | null; open: boolean; onOpenChange(o: boolean): void }) {
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
  const who = identityLine(d.identity, current);
  const go = (us: number) => { ws?.seek(us); onOpenChange(false); };
  const pick = (trackId: string, us: number) => { ws?.select(trackId); ws?.seek(us); onOpenChange(false); };
  const Time = ({ us }: { us: number }) => <button type="button" className="font-mono text-[#9fd0ff] underline-offset-2 hover:underline" onClick={() => go(us)}>{clock(us)}</button>;
  const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">{children}</h3>;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="properties" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(760px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-semibold">Properties · track {track.track_number}</Dialog.Title>
          <Dialog.Description className="text-xs text-muted">Everything recorded about this track. A track is one stretch of one person in this analysis, not a player ID.</Dialog.Description>

          <H>Track</H>
          <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1" data-props="track">
            <dt className="text-muted">Kind</dt><dd>{track.class_name === "GOALKEEPER" ? "Goalkeeper" : track.class_name === "REFEREE" ? "Referee" : track.class_name === "BALL" ? "Ball" : "Person"}</dd>
            <dt className="text-muted">Seen</dt><dd><Time us={track.first_pts_us} /> – <Time us={track.last_pts_us} /> ({Math.max(0, Math.round((track.last_pts_us - track.first_pts_us) / 1_000_000))} s)</dd>
            <dt className="text-muted">Detections</dt><dd className="flex items-center gap-2">{track.observation_count} · mean confidence {track.mean_confidence?.toFixed(2) ?? "—"} <Evidence level="DETECTED" size={12} /></dd>
            <dt className="text-muted">Team</dt><dd>{a ? (a.club_name ?? "No team") : "Not assigned"}{a ? <span className="text-xs text-muted"> · kit colour group set by a person</span> : <span className="text-xs text-muted"> · assign kit colours to teams first</span>}</dd>
          </dl>

          {person && (
            <>
              <H>Identity</H>
              <div data-props="identity" className="rounded-ctl border border-line/60 p-2.5">
                <p className="font-semibold" data-props-who>{who.title}</p>
                {who.detail && <p className="text-xs text-muted">{who.detail}</p>}
                {current?.reason && <p className="mt-1 text-xs">Why: {current.reason}</p>}
              </div>
              {d.history && d.history.length > 1 && (
                <ol className="mt-2 space-y-1" data-props-history>
                  {d.history.filter((h) => !h.current).map((h) => (
                    <li key={h.decision_id} className="text-xs text-muted">
                      <span className="line-through">{STATE[h.state] ?? h.state}{h.player ? ` ${h.player.display_name}` : ""}</span>
                      {` · ${BASIS[h.basis]}${h.decided_by ? ` (${h.decided_by.name})` : ""} · ${day(h.decided_at)} · replaced`}{h.reason ? ` · ${h.reason}` : ""}
                    </li>
                  ))}
                </ol>
              )}
              {d.history && d.history.length === 0 && <p className="mt-1 text-xs text-muted">No identity decision yet.</p>}

              <H>Evidence</H>
              <div data-props="evidence" className="space-y-1">
                <p>Shirt number: {d.jersey ? (d.jersey.decision ? (d.jersey.decision.state === "CONFIRMED" ? <b>{d.jersey.decision.number} (confirmed by a person)</b> : "unreadable (a person said so)")
                  : d.jersey.number ? <>{d.jersey.number} <span className="text-xs text-muted">read on {d.jersey.frames.length} frame{d.jersey.frames.length === 1 ? "" : "s"}, confidence {d.jersey.confidence?.toFixed(2) ?? "—"}</span></> : "not read")
                  : "—"}</p>
                {d.candidates && d.candidates.candidates.length > 0 ? (
                  <ul className="text-xs" data-props-candidates>
                    <li className="text-muted">Suggestions (ranked, not a decision):</li>
                    {d.candidates.candidates.slice(0, 3).map((c) => (
                      <li key={c.player_id}>{c.display_name}{c.canonical_otsi_id ? ` · ${c.canonical_otsi_id}` : ""} <span className="text-muted">strength {c.strength.toFixed(2)}{c.conflicts.length ? ` · ${c.conflicts.join("; ")}` : ""}</span></li>
                    ))}
                  </ul>
                ) : d.candidates ? <p className="text-xs text-muted">No suggestions: the match roster and the shirt number do not point to anyone.</p> : null}
              </div>

              <H>Linked tracks</H>
              {d.links === null ? <p className="text-xs text-muted">Reading…</p> : d.links.length === 0 ? <p className="text-xs text-muted" data-props-links="0">No linked tracks.</p> : (
                <ul className="space-y-1 text-xs" data-props-links={d.links.length}>
                  {d.links.map((l) => (
                    <li key={l.link_id} className="flex items-center gap-2">
                      <button type="button" className="text-[#9fd0ff] hover:underline" onClick={() => pick(l.other.track_id, l.other.first_pts_us)}>Track {l.other.track_number}</button>
                      <span className="text-muted">{l.direction === "before" ? "before" : "after"} · {clock(l.other.first_pts_us)}–{clock(l.other.last_pts_us)} · {l.state.toLowerCase()} link{l.crosses_cut ? " · across a cut" : ""}</span>
                    </li>
                  ))}
                </ul>
              )}

              <H>Look-alikes</H>
              {d.lookAlikes === null ? <p className="text-xs text-muted">Reading…</p> : d.lookAlikes.items.length === 0 ? <p className="text-xs text-muted" data-props-looks="0">No look-alikes found.</p> : (
                <ul className="space-y-1 text-xs" data-props-looks={d.lookAlikes.items.length}>
                  <li className="text-muted">Appearance similarity, not a probability: check each before deciding.</li>
                  {d.lookAlikes.items.slice(0, 6).map((x) => (
                    <li key={x.other.track_id} className="flex items-center gap-2">
                      <button type="button" className="text-[#9fd0ff] hover:underline" onClick={() => pick(x.other.track_id, x.other.first_pts_us)}>Track {x.other.track_number}</button>
                      <span className="text-muted">{clock(x.other.first_pts_us)} · similarity {x.similarity.toFixed(2)} · {x.other.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="mt-4 text-right"><Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">Close</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
