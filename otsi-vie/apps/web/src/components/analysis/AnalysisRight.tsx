"use client";
/**
 * Page 06 Analysis — the identity inspector (SOT, Analysis.dc.html).
 *
 * The selected track's identity: the player card (shirt, position, club,
 * nationality, OTSI PIN — all from the player's real profile, never
 * invented), the confirm / correct / reject actions, the measured
 * evidence (from GET /v1/players/:id/measures), and the look-alikes.
 * A correction needs a reason (the database enforces it too); a reject
 * is a decision on the track's identity history, never a rewrite. The
 * old inspector's KPI grid, heatmap, season/match toggle and reel button
 * are not on this SOT page: they live on the Player Report, the Tactical
 * page and the Reel Builder.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PlayerMeasures, PlayerProfile, TrackIdentity } from "@otsi-vie/contracts";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { LookAlikePanel, TrackThumb } from "@/components/analysis/SamePerson";
import { trackLabel } from "@/lib/identity";
import type { Shared } from "@/components/workspace/shared";

export function AnalysisRight({ s, onIdentify }: { s: Shared; onIdentify: () => void }) {
  const { t: dict } = useLocale();
  const a = dict.body.analysis;
  const { ws } = s;
  const t = useMemo(() => (ws?.tracks ?? []).find((x) => x.track_id === ws?.selectedId) ?? null, [ws?.tracks, ws?.selectedId]);
  const [identity, setIdentity] = useState<TrackIdentity | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [measures, setMeasures] = useState<PlayerMeasures | null>(null);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setIdentity(null); setProfile(null); setMeasures(null); setReason(""); setRejecting(false); setMsg(null);
    if (!t || t.class_name === "BALL") return;
    void api<TrackIdentity>(`/v1/tracks/${t.track_id}/identity`).then((id) => {
      setIdentity(id);
      if (!id.player) return;
      void api<PlayerProfile>(`/v1/players/${id.player.player_id}/profile`).then(setProfile, () => setProfile(null));
      void api<PlayerMeasures>(`/v1/players/${id.player.player_id}/measures`).then(setMeasures, () => setMeasures(null));
    }, () => setIdentity(null));
  }, [t?.track_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!t) return <aside className="flex w-[300px] shrink-0 flex-col border-l border-line p-4"><p className="text-sm text-muted">{dict.body.analysis.clickBoxOrTrack}</p></aside>;

  const confirmed = identity?.state === "CONFIRMED" ? identity.player : null;
  const chip = identity
    ? identity.state === "CONFIRMED"
      ? { label: dict.body.reports.confirmedShort, cls: "vie-chip ev ev-c" }
      : identity.state === "CANDIDATE"
        ? { label: a.anCandidate, cls: "vie-chip ev ev-i" }
        : identity.state === "REJECTED"
          ? { label: a.anRejected, cls: "vie-chip ev ev-f" }
          : identity.state === "CONFLICT"
            ? { label: a.anConflict, cls: "vie-chip ev ev-f" }
            : { label: a.anUnresolved, cls: "vie-chip ev ev-n" }
    : null;
  const correcting = !!identity?.decision_id;
  const reasonOk = !correcting || reason.trim().length >= 3;
  const name = confirmed?.display_name ?? identity?.display.label ?? t.label.split(" · ")[0] ?? t.label;
  const jersey = profile?.latest_team?.jersey_number ?? null;
  const position = profile?.latest_team?.position ?? profile?.position ?? null;
  const club = profile?.latest_team?.team ?? null;
  const nationality = profile?.nationality?.name ?? null;
  const pin = confirmed?.canonical_otsi_id ?? null;

  const reject = () => {
    if (!identity || !reasonOk) return;
    setBusy(true); setMsg(null);
    void api<TrackIdentity>(`/v1/tracks/${t.track_id}/identity-decisions`, {
      method: "POST", json: { state: "REJECTED", player_id: null, supersedes_id: identity.decision_id, reason: correcting ? reason.trim() : null },
    }).then(async (r) => { setIdentity(r); setMsg({ ok: true, text: dict.body.analysis.recordedNotName.replace("{a}", trackLabel(t.track_number)).replace("{b}", name) }); setReason(""); setRejecting(false); await ws?.reloadTracks(); },
      (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : dict.body.analysis.decisionNotSaved })).finally(() => setBusy(false));
  };

  const eventsTotal = measures?.events ? measures.events.passes + measures.events.balls_won + measures.events.pressures + measures.events.shots : null;
  const coverage = measures && measures.seen_s > 0 ? Math.round((100 * Math.min(measures.measured_s, measures.seen_s)) / measures.seen_s) : null;

  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line" aria-label={name}>
      <div className="vie-ph" style={{ minHeight: 44 }}>
        <h2 className="t-section truncate">{name}</h2>
        {chip && <span className={chip.cls}>{chip.label}</span>}
      </div>

      <div className="flex flex-col gap-3 border-b border-line p-4">
        <div className="flex gap-3">
          <TrackThumb trackId={t.track_id} has={t.has_thumbnail} size={60} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{jersey != null ? `#${jersey}` : "—"}{position ? ` · ${position}` : ""}</p>
            <p className="t-small text-muted">{[club, nationality].filter(Boolean).join(" · ") || "—"}</p>
            <p className="t-small font-mono" style={{ color: "rgb(var(--primary))" }}>{pin ?? dict.body.analysis.provisionalBadge}</p>
          </div>
        </div>

        {confirmed ? (
          <button type="button" disabled className="vie-btn vie-btn-pri w-full" aria-disabled="true">
            ✓ {a.anIdentityConfirmed}
          </button>
        ) : (
          <button type="button" disabled={!ws?.canReview} onClick={onIdentify} className="vie-btn vie-btn-pri w-full">
            {a.anConfirmIdentity}
          </button>
        )}

        {ws?.canReview && (
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={onIdentify} className="vie-btn vie-btn-sm">
              {a.anCorrect} <kbd className="kbd">E</kbd>
            </button>
            <button type="button" onClick={() => setRejecting((v) => !v)} className="vie-btn vie-btn-sm vie-btn-danger">
              {a.anReject} <kbd className="kbd">X</kbd>
            </button>
          </div>
        )}
        {rejecting && (
          <div className="space-y-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dict.body.analysis.whyChange} aria-label={dict.body.analysis.reasonCorrection}
              className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm" />
            <button type="button" disabled={busy || !reasonOk} onClick={reject} className="vie-btn vie-btn-danger w-full">
              {a.anReject}
            </button>
          </div>
        )}
        {msg && <p role="status" className={`text-xs ${msg.ok ? "text-primary" : "text-danger"}`}>{msg.text}</p>}
      </div>

      <div className="flex flex-col gap-1.5 border-b border-line p-4">
        <span className="t-th">{a.anEvidence}</span>
        {measures ? (
          <dl className="flex flex-col gap-1.5">
            {([
              [a.anConfirmedTracks, String(measures.tracks)],
              [a.anVideos, String(measures.videos)],
              [a.anTimeOnCamera, dict.body.reports.minSuffix.replace("{a}", String(Math.round(measures.seen_s / 60)))],
              [dict.body.workspace.metricEvents, eventsTotal == null ? dict.body.reports.notMeasured : String(eventsTotal)],
              [a.anEvidenceCoverage, coverage == null ? dict.body.reports.notMeasured : `${coverage}%`],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="t-body text-muted">{k}</dt>
                <dd className="font-mono t-body">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="t-small text-muted">{confirmed ? dict.common.loading : dict.body.analysis.provisionalPlayer}</p>
        )}
      </div>

      <div className="flex flex-col gap-2 p-4">
        <span className="t-th">{dict.body.workspace.lookAlikes}</span>
        {t.class_name === "BALL" ? (
          <p className="t-small text-muted">{a.anNoLookAlikes}</p>
        ) : (
          <LookAlikePanel track={t} identity={identity} canReview={!!ws?.canReview} onChanged={async () => { await ws?.reloadTracks(); }} seek={(us) => ws?.seek(us)} select={(id) => ws?.select(id)} />
        )}
        {confirmed && (
          <Link href={`/reports/players/${confirmed.player_id}`} className="vie-btn vie-btn-sm">
            {a.anOpenPlayerReport}
          </Link>
        )}
      </div>
    </aside>
  );
}
