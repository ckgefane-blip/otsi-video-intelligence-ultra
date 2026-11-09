"use client";
/**
 * Shirt-number evidence and identity suggestions for the selected track (Block 07, ADR-033).
 *  - ShirtNumberPanel: what the engine read in which frames (click a frame to see it), alternatives, and a person's verdict
 *    (confirm the number / unreadable), append-only.
 *  - CandidatesPanel: players this track may show — shirt number looked up in the match roster, the team of its kit group, confirmed and
 *    suggested same-person links, look-alike tracks — each with its evidence and conflicts. Strength ranks suggestions; it is not a
 *    probability. Choosing one is the person's identity decision; a candidate with a conflict cannot be chosen until the conflict is resolved.
 */
import type { JerseyEvidence, TrackCandidates, TrackIdentity, TrackSummary } from "@otsi-vie/contracts";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { trackLabel } from "@/lib/identity";

const small = "rounded border border-line px-2 py-0.5 text-xs hover:border-primary/60 disabled:opacity-50";
const STATE_TEXT: Record<JerseyEvidence["state"], string> = {
  RECOGNIZED: "read consistently in several frames",
  UNCERTAIN: "read, but not consistently: check it",
  UNREADABLE: "visible but not readable",
  TOO_SMALL: "the player is never large enough on screen to read a number",
};

export function ShirtNumberPanel({ track, canReview, seek, onChanged }: { track: TrackSummary; canReview: boolean; seek(t: number): void; onChanged(): void }) {
  const [ev, setEv] = useState<JerseyEvidence | null | "none">(null);
  const [num, setNum] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setEv(null); setMsg(null); setReason("");
    void api<JerseyEvidence>(`/v1/tracks/${track.track_id}/jersey`).then((e) => { setEv(e); setNum(e.decision?.number ?? e.number ?? ""); },
      (x) => setEv(x instanceof ApiProblem && x.status === 404 ? "none" : null));
  }, [track.track_id]);
  if (ev === null) return null;
  if (ev === "none") return <p className="text-xs text-muted" data-jersey-state="NOT_MEASURED">Shirt number: not measured in this analysis.</p>;
  const correcting = !!ev.decision;
  const decide = (state: "CONFIRMED" | "UNREADABLE") => {
    setBusy(true); setMsg(null);
    void api<JerseyEvidence>(`/v1/tracks/${track.track_id}/jersey-decisions`, { method: "POST",
      json: { state, number: state === "CONFIRMED" ? num : null, supersedes_id: ev.decision?.decision_id ?? null, reason: correcting ? reason.trim() : null } })
      .then((e) => { setEv(e); setReason(""); setMsg({ ok: true, text: state === "CONFIRMED" ? `Shirt number ${num} confirmed.` : "Marked unreadable." }); onChanged(); },
        (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : "The verdict was not saved." })).finally(() => setBusy(false));
  };
  const reads = ev.frames.filter((f) => f.number);
  return (
    <div className="space-y-1.5 rounded-ctl border border-line/70 p-2 text-sm" aria-label="Shirt number" data-jersey-state={ev.state}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Shirt number</p>
      <p>
        {ev.decision ? (
          <span data-jersey-decision={ev.decision.state}>{ev.decision.state === "CONFIRMED" ? <>No. <b>{ev.decision.number}</b>, confirmed by a person</> : "Unreadable (decided by a person)"}</span>
        ) : ev.number ? <>No. <b>{ev.number}</b> · {STATE_TEXT[ev.state]}</> : STATE_TEXT[ev.state]}
      </p>
      <p className="text-xs text-muted">{ev.candidate_frames} clear frame{ev.candidate_frames === 1 ? "" : "s"} examined{ev.side !== "UNKNOWN" ? ` · ${ev.side === "BACK" ? "back" : "front"} of the shirt` : ""}
        {ev.confidence !== null ? ` · agreement ${(ev.confidence * 100).toFixed(0)}%` : ""}{ev.alternatives.length ? ` · also read: ${ev.alternatives.map((a) => `${a.number} (${a.frames}×)`).join(", ")}` : ""}</p>
      {reads.length > 0 && (
        <ul className="flex flex-wrap gap-1 text-[11px]" aria-label="Frames read">
          {reads.map((f) => (
            <li key={f.pts_us}><button type="button" onClick={() => seek(f.pts_us)} className="rounded border border-line/60 px-1 py-0.5 hover:border-primary/60" title="Show this frame">
              {(f.pts_us / 1e6).toFixed(1)} s: {f.number} ({f.confidence.toFixed(2)})</button></li>
          ))}
        </ul>
      )}
      {canReview && (ev.state !== "TOO_SMALL" || ev.decision) && (
        <div className="space-y-1">
          {correcting && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why change it? (required)" aria-label="Reason for the shirt-number change" className="w-full rounded-ctl border border-line bg-canvas px-2 py-1 text-xs" />}
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" aria-label="Shirt number seen" placeholder="No." className="w-14 rounded-ctl border border-line bg-canvas px-2 py-1 text-xs" />
            <button type="button" disabled={busy || !num || (correcting && reason.trim().length < 3)} onClick={() => decide("CONFIRMED")} className={small}>I can see this number</button>
            <button type="button" disabled={busy || (correcting && reason.trim().length < 3)} onClick={() => decide("UNREADABLE")} className={small}>Not readable</button>
          </div>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      <p className="text-[11px] text-muted">A number is clothing, not identity: it only suggests a player through the match roster.</p>
    </div>
  );
}

export function CandidatesPanel({ track, identity, canReview, refreshKey, onDecided }: {
  track: TrackSummary; identity: TrackIdentity | null; canReview: boolean; refreshKey: number; onDecided(): Promise<void>;
}) {
  const [c, setC] = useState<TrackCandidates | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => api<TrackCandidates>(`/v1/tracks/${track.track_id}/candidates`).then(setC, () => setC(null)), [track.track_id]);
  useEffect(() => { setC(null); setMsg(null); void load(); }, [load, refreshKey]);
  if (!c || identity?.state === "CONFIRMED") return null;
  const choose = (playerId: string, name: string) => {
    if (!identity) return;
    setBusy(true); setMsg(null);
    void api<TrackIdentity>(`/v1/tracks/${track.track_id}/identity-decisions`, { method: "POST",
      json: { state: "CONFIRMED", player_id: playerId, supersedes_id: identity.decision_id, reason: identity.decision_id ? "chosen from the reviewed suggestions" : null } })
      .then(async () => { setMsg({ ok: true, text: `${trackLabel(track.track_number)} confirmed as ${name}.` }); await onDecided(); },
        (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : "The decision was not saved." })).finally(() => setBusy(false));
  };
  return (
    <div className="space-y-1.5 rounded-ctl border border-line/70 p-2 text-sm" aria-label="Identity suggestions" data-candidates={c.candidates.length}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Who could this be?</p>
      <p className="text-xs text-muted">{c.team ? `Team: ${c.team.name} (kit group assigned by a person)` : c.match_id ? "Team: not assigned yet" : "No match linked"}
        {c.shirt_number ? ` · No. ${c.shirt_number.number} (${c.shirt_number.source.toLowerCase()})` : ""}</p>
      {c.candidates.length === 0 ? (
        <p className="text-xs text-muted">No suggestion: not enough evidence. That is fine — leave the track unidentified rather than guess.</p>
      ) : (
        <ul className="space-y-1.5" aria-label="Suggested players">
          {c.candidates.map((p) => (
            <li key={p.player_id} data-candidate={p.display_name} className="rounded border border-line/50 p-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{p.display_name} <span className="font-normal text-muted">· {p.canonical_otsi_id ?? "provisional"}</span></span>
                <span className="flex w-24 items-center gap-1" title="Evidence strength for ranking — not a probability">
                  <span className="h-1.5 flex-1 rounded bg-raised"><span className="block h-1.5 rounded bg-cyan" style={{ width: `${Math.round(p.strength * 100)}%` }} /></span>
                  <span className="tabular-nums text-muted">{p.strength.toFixed(2)}</span>
                </span>
              </div>
              <ul className="mt-1 space-y-0.5 text-muted">
                {p.signals.filter((s) => s.kind !== "CONFLICT").map((s, i) => <li key={i}>• {s.detail}</li>)}
              </ul>
              {p.conflicts.map((x, i) => <p key={i} role="note" className="mt-0.5 flex items-start gap-1 text-danger"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{x}</p>)}
              {canReview && (
                <button type="button" disabled={busy || !identity || p.conflicts.length > 0} onClick={() => choose(p.player_id, p.display_name)} className={`mt-1 ${small}`}
                  title={p.conflicts.length ? "Resolve the conflict first" : undefined}>This is {p.display_name}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      <p className="text-[11px] text-muted">Suggestions decide nothing. Only your confirmation names the player; a miss is better than a wrong name.</p>
    </div>
  );
}
