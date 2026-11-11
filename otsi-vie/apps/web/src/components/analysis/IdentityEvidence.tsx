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
import { useLocale } from "@/lib/i18n";

const small = "rounded border border-line px-2 py-0.5 text-xs hover:border-primary/60 disabled:opacity-50";

export function ShirtNumberPanel({ track, canReview, seek, onChanged }: { track: TrackSummary; canReview: boolean; seek(t: number): void; onChanged(): void }) {
  const { t: dict } = useLocale();
  const STATE_TEXT: Record<JerseyEvidence["state"], string> = {
    RECOGNIZED: dict.body.analysis.jerseyReadConsistent,
    UNCERTAIN: dict.body.analysis.jerseyReadUncertain,
    UNREADABLE: dict.body.analysis.jerseyUnreadableDesc,
    TOO_SMALL: dict.body.analysis.jerseyTooSmall,
  };
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
  if (ev === "none") return <p className="text-xs text-muted" data-jersey-state="NOT_MEASURED">{dict.body.analysis.shirtNotMeasured}</p>;
  const correcting = !!ev.decision;
  const decide = (state: "CONFIRMED" | "UNREADABLE") => {
    setBusy(true); setMsg(null);
    void api<JerseyEvidence>(`/v1/tracks/${track.track_id}/jersey-decisions`, { method: "POST",
      json: { state, number: state === "CONFIRMED" ? num : null, supersedes_id: ev.decision?.decision_id ?? null, reason: correcting ? reason.trim() : null } })
      .then((e) => { setEv(e); setReason(""); setMsg({ ok: true, text: state === "CONFIRMED" ? dict.body.analysis.shirtConfirmed.replace("{a}", num) : dict.body.analysis.markedUnreadable }); onChanged(); },
        (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.analysis.verdictNotSaved })).finally(() => setBusy(false));
  };
  const reads = ev.frames.filter((f) => f.number);
  return (
    <div className="space-y-1.5 rounded-ctl border border-line/70 p-2 text-sm" aria-label={dict.body.analysis.shirtNumber} data-jersey-state={ev.state}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{dict.body.analysis.shirtNumber}</p>
      <p>
        {ev.decision ? (
          <span data-jersey-decision={ev.decision.state}>{ev.decision.state === "CONFIRMED" ? <>{dict.body.analysis.noNumber}<b>{ev.decision.number}</b>, {dict.body.analysis.confirmedByPerson}</> : dict.body.analysis.unreadableDecided}</span>
        ) : ev.number ? <>{dict.body.analysis.noNumber}<b>{ev.number}</b> · {STATE_TEXT[ev.state]}</> : STATE_TEXT[ev.state]}
      </p>
      <p className="text-xs text-muted">{ev.candidate_frames === 1 ? dict.body.analysis.framesExaminedOne.replace("{a}", String(ev.candidate_frames)) : dict.body.analysis.framesExaminedMany.replace("{a}", String(ev.candidate_frames))}{ev.side !== "UNKNOWN" ? ` ${dict.body.analysis.shirtSideOf.replace("{a}", ev.side === "BACK" ? dict.body.analysis.shirtBack : dict.body.analysis.shirtFront)}` : ""}
        {ev.confidence !== null ? ` ${dict.body.analysis.agreementPct.replace("{a}", (ev.confidence * 100).toFixed(0))}` : ""}{ev.alternatives.length ? ` ${dict.body.analysis.alsoRead.replace("{a}", ev.alternatives.map((a) => `${a.number} (${a.frames}×)`).join(", "))}` : ""}</p>
      {reads.length > 0 && (
        <ul className="flex flex-wrap gap-1 text-[11px]" aria-label={dict.body.analysis.framesRead}>
          {reads.map((f) => (
            <li key={f.pts_us}><button type="button" onClick={() => seek(f.pts_us)} className="rounded border border-line/60 px-1 py-0.5 hover:border-primary/60" title={dict.body.analysis.showFrame}>
              {(f.pts_us / 1e6).toFixed(1)} s: {f.number} ({f.confidence.toFixed(2)})</button></li>
          ))}
        </ul>
      )}
      {canReview && (ev.state !== "TOO_SMALL" || ev.decision) && (
        <div className="space-y-1">
          {correcting && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dict.body.analysis.whyChangeRequired} aria-label={dict.body.analysis.reasonShirtChange} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1 text-xs" />}
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" aria-label={dict.body.analysis.shirtNumberSeen} placeholder={dict.body.analysis.noNumber} className="w-14 rounded-ctl border border-line bg-canvas px-2 py-1 text-xs" />
            <button type="button" disabled={busy || !num || (correcting && reason.trim().length < 3)} onClick={() => decide("CONFIRMED")} className={small}>{dict.body.analysis.canSeeNumber}</button>
            <button type="button" disabled={busy || (correcting && reason.trim().length < 3)} onClick={() => decide("UNREADABLE")} className={small}>{dict.body.analysis.notReadable}</button>
          </div>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      <p className="text-[11px] text-muted">{dict.body.analysis.numberClothing}</p>
    </div>
  );
}

export function CandidatesPanel({ track, identity, canReview, refreshKey, onDecided }: {
  track: TrackSummary; identity: TrackIdentity | null; canReview: boolean; refreshKey: number; onDecided(): Promise<void>;
}) {
  const { t: dict } = useLocale();
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
      json: { state: "CONFIRMED", player_id: playerId, supersedes_id: identity.decision_id, reason: identity.decision_id ? dict.body.analysis.chosenFromSuggestions : null } })
      .then(async () => { setMsg({ ok: true, text: dict.body.analysis.confirmedAs.replace("{a}", trackLabel(track.track_number)).replace("{b}", name) }); await onDecided(); },
        (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.analysis.decisionNotSaved })).finally(() => setBusy(false));
  };
  return (
    <div className="space-y-1.5 rounded-ctl border border-line/70 p-2 text-sm" aria-label={dict.body.analysis.identitySuggestions} data-candidates={c.candidates.length}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{dict.body.analysis.whoCouldBe}</p>
      <p className="text-xs text-muted">{c.team ? dict.body.analysis.teamAssigned.replace("{a}", c.team.name) : c.match_id ? dict.body.analysis.teamNotAssigned : dict.body.analysis.noMatchLinked}
        {c.shirt_number ? ` ${dict.body.analysis.shirtNoSource.replace("{a}", String(c.shirt_number.number)).replace("{b}", c.shirt_number.source.toLowerCase())}` : ""}</p>
      {c.candidates.length === 0 ? (
        <p className="text-xs text-muted">{dict.body.analysis.noSuggestionEvidence}</p>
      ) : (
        <ul className="space-y-1.5" aria-label={dict.body.analysis.suggestedPlayers}>
          {c.candidates.map((p) => (
            <li key={p.player_id} data-candidate={p.display_name} className="rounded border border-line/50 p-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{p.display_name} <span className="font-normal text-muted">· {p.canonical_otsi_id ?? dict.body.analysis.provisionalBadge}</span></span>
                <span className="flex w-24 items-center gap-1" title={dict.body.analysis.evidenceStrength}>
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
                  title={p.conflicts.length ? dict.body.analysis.resolveConflictFirst : undefined}>{dict.body.analysis.thisIsPlayer.replace("{a}", p.display_name)}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
      <p className="text-[11px] text-muted">{dict.body.analysis.suggestionsDecideNothing}</p>
    </div>
  );
}
