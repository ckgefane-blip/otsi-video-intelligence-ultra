"use client";
/**
 * Page 08 Player Report — AI Analyst panel (ADR-141, ultra-only; scope: ai-analyst-scope.md).
 *
 * Drop 1 layout: the same panel, controls and API calls, laid out in the page's flow on the shared `vie-panel` / `vie-btn` classes
 * instead of the DesignStage's absolute coordinates. Nothing was removed or rewired.
 *
 * The assessment renders beside the human assessment, clearly labelled "AI-generated — draft until published".
 * Each claim shows its evidence link (match + minute, opening the clip in Analysis), its confidence (computed by
 * code, never by the model), and a warning where the confidence is Low. Recommendations and the tactical fit are
 * labelled as suggestions, not facts. "Not measured" is shown where the engine measured nothing, never a guess.
 * Nothing is published until a person has read it and pressed Publish; a draft never reaches a club or a
 * Scouting Pack (the export hook refuses it). The panel is a normal-flow section; its claims lists scroll inside a
 * fixed height so a long assessment never overflows the page.
 */
import type { AiAnalystAssessment, AiAnalystClaim, AiAnalystProviderStatus } from "@otsi-vie/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

const CONFIDENCE_STYLE: Record<string, { color: string; background: string }> = {
  HIGH: { color: "#3ee6a8", background: "#0a2a1e" },
  MEDIUM: { color: "#33a8ff", background: "#0a2447" },
  LOW: { color: "#f1a824", background: "#2a1f0a" },
  NOT_ENOUGH_DATA: { color: "#8ea3bf", background: "#122b4d" },
};

function ConfidenceBadge({ confidence, dict }: { confidence: string; dict: ReturnType<typeof useLocale>["t"] }) {
  const label =
    confidence === "HIGH" ? dict.body.aiAnalyst.confidenceHigh
    : confidence === "MEDIUM" ? dict.body.aiAnalyst.confidenceMedium
    : confidence === "LOW" ? dict.body.aiAnalyst.confidenceLow
    : dict.body.aiAnalyst.notEnoughData;
  const style = CONFIDENCE_STYLE[confidence] ?? CONFIDENCE_STYLE.NOT_ENOUGH_DATA!;
  return (
    <span style={style} className="shrink-0 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold">{label}</span>
  );
}

function ClaimList({ claims, dict }: { claims: AiAnalystClaim[]; dict: ReturnType<typeof useLocale>["t"] }) {
  if (!claims.length) return <p className="t-body text-muted">—</p>;
  return (
    <ul className="flex list-none flex-col gap-2.5 p-0">
      {claims.map((c, i) => (
        <li key={i} className="rounded-ctl border border-line/70 bg-[#071a33] px-3 py-2.5">
          <div className="flex items-start justify-between gap-2.5">
            <span className="t-body">{c.text}</span>
            <ConfidenceBadge confidence={c.confidence} dict={dict} />
          </div>
          {c.confidence === "LOW" && <p className="mt-1.5 text-xs text-amber">{dict.body.aiAnalyst.lowConfidenceWarning}</p>}
          <p className="mt-2 t-small">
            {dict.body.aiAnalyst.evidence}:{" "}
            {c.evidence.map((e, j) => (
              <span key={j}>
                {j > 0 && " · "}
                <Link href={e.clip_ref} className="text-primary hover:underline">{e.match} · {e.minute ?? "?"}&prime; · {e.event} × {e.count}</Link>
              </span>
            ))}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function AiAnalystPanel({ playerId, canAssess }: { playerId: string; canAssess: boolean }) {
  const { t: dict, locale } = useLocale();
  const [status, setStatus] = useState<AiAnalystProviderStatus | null | undefined>(undefined);
  const [assessment, setAssessment] = useState<AiAnalystAssessment | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);

  const load = useCallback(() => {
    setAssessment(undefined);
    setError(null);
    void api<AiAnalystProviderStatus>(`/v1/players/${playerId}/ai-analysis/status`).then(setStatus, () => setStatus(null));
    void api<AiAnalystAssessment>(`/v1/players/${playerId}/ai-analysis`).then(setAssessment, (x) => {
      // 404 = no assessment yet (not an error state for this panel); anything else is
      setAssessment(null);
      if (!(x instanceof ApiProblem && x.status === 404)) setError(x instanceof Error ? x.message : "The assessment could not be loaded.");
    });
  }, [playerId]);
  useEffect(load, [load]);

  const act = useCallback(async (fn: () => Promise<AiAnalystAssessment>) => {
    setBusy(true);
    setError(null);
    try {
      setAssessment(await fn());
    } catch (x) {
      setError(x instanceof ApiProblem ? x.message : "The AI Analyst could not answer. Try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const generate = () => act(() => api<AiAnalystAssessment>(`/v1/players/${playerId}/ai-analysis`,
    { method: "POST", json: { language: locale, consent_acknowledged: true, regenerate: !!assessment } }));
  const publish = () => assessment && act(() => api<AiAnalystAssessment>(`/v1/players/${playerId}/ai-analysis/${assessment.id}/publish`, { method: "POST", json: {} }));
  const unpublish = () => assessment && act(() => api<AiAnalystAssessment>(`/v1/players/${playerId}/ai-analysis/${assessment.id}/unpublish`, { method: "POST", json: {} }));

  const a = assessment ?? null;
  return (
    <section id="p08-analyst" aria-label="AI Analyst" data-section="p08-s13" className="vie-panel p-4">
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <h2 className="t-section font-semibold">{dict.body.aiAnalyst.title}</h2>
        {a && (
          <span className={`t-panel ${a.status === "PUBLISHED" ? "text-ok" : "text-amber"}`}>
            {a.status === "PUBLISHED" ? dict.body.aiAnalyst.published : dict.body.aiAnalyst.draft}
          </span>
        )}
        <span className="t-body text-muted">{dict.body.aiAnalyst.aiGeneratedDraft}</span>
        {a && <ConfidenceBadge confidence={a.confidence_overall} dict={dict} />}
      </div>

      {status === undefined || assessment === undefined ? (
        <p className="mt-2 t-body text-muted">Loading…</p>
      ) : status === null ? (
        <p role="alert" className="mt-2 t-body text-danger">The AI Analyst status could not be loaded.</p>
      ) : !status.configured ? (
        <p className="mt-2 t-body text-muted">{dict.body.aiAnalyst.notConfigured}</p>
      ) : error ? (
        <p role="alert" className="mt-2 t-body text-danger">{error}</p>
      ) : !a ? (
        <>
          <p className="mt-2 t-body text-muted">{dict.body.aiAnalyst.noAssessment}</p>
          <p className="mt-1 t-small">{dict.body.aiAnalyst.costNote} {dict.body.aiAnalyst.privacyNote}</p>
          {canAssess && (
            <>
              <label className="mb-2.5 mt-3 flex items-start gap-2 t-body text-muted">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                <span>{dict.body.aiAnalyst.consent}</span>
              </label>
              <button type="button" disabled={busy || !consent} onClick={generate} className="vie-btn vie-btn-pri">
                {dict.body.aiAnalyst.generate}
              </button>
            </>
          )}
        </>
      ) : a.not_enough_data_reason ? (
        <p className="mt-2 t-body text-amber">{dict.body.aiAnalyst.notEnoughData}: {a.not_enough_data_reason}</p>
      ) : a.failure ? (
        <>
          <p role="alert" className="mt-2 t-body text-danger">{dict.body.aiAnalyst.couldNotVerify}</p>
          <p className="mt-1 t-small">{dict.body.aiAnalyst.costNote}</p>
        </>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="flex max-h-[430px] flex-col gap-4 overflow-y-auto pr-2">
            <div>
              <h3 className="mb-2 t-panel">{dict.body.aiAnalyst.strengths}</h3>
              <ClaimList claims={a.strengths} dict={dict} />
            </div>
            <div>
              <h3 className="mb-2 t-panel">{dict.body.aiAnalyst.developmentAreas}</h3>
              <ClaimList claims={a.development_areas} dict={dict} />
            </div>
            <div>
              <h3 className="mb-2 t-panel">{dict.body.aiAnalyst.recommendations}</h3>
              <ul className="flex list-none flex-col gap-2.5 p-0">
                {a.recommendations.map((r, i) => (
                  <li key={i} className="rounded-ctl border border-line/70 bg-[#071a33] px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2.5">
                      <span className="t-body">{r.text}</span>
                      <ConfidenceBadge confidence={r.confidence} dict={dict} />
                    </div>
                    <p className="mt-1.5 t-body text-muted">{r.action}</p>
                    <p className="mt-1 text-xs text-amber">{dict.body.aiAnalyst.suggestionNotFact}</p>
                    <p className="mt-2 t-small">
                      {dict.body.aiAnalyst.evidence}:{" "}
                      {r.evidence.map((e, j) => (
                        <span key={j}>
                          {j > 0 && " · "}
                          <Link href={e.clip_ref} className="text-primary hover:underline">{e.match} · {e.minute ?? "?"}&prime; · {e.event} × {e.count}</Link>
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex max-h-[430px] flex-col gap-4 overflow-y-auto pr-2">
            <div>
              <h3 className="mb-2 t-panel">{dict.body.aiAnalyst.tacticalFit}</h3>
              {a.tactical_fit && (
                <div className="rounded-ctl border border-line/70 bg-[#071a33] px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2.5">
                    <span className="t-body">{a.tactical_fit.text}</span>
                    <ConfidenceBadge confidence={a.tactical_fit.confidence} dict={dict} />
                  </div>
                  <p className="mt-1 text-xs text-amber">{dict.body.aiAnalyst.suggestionNotFact}</p>
                </div>
              )}
            </div>
            {a.scout_brief && (
              <div>
                <h3 className="mb-2 t-panel">{dict.body.aiAnalyst.scoutBrief}</h3>
                <div className="rounded-ctl border border-line/70 bg-[#071a33] px-3 py-2.5 t-body">
                  <p className="mb-2">{a.scout_brief.strengths_summary}</p>
                  <p className="mb-2">{a.scout_brief.fit_summary}</p>
                  <p className="mb-2"><strong>{dict.body.aiAnalyst.whatToWatch}:</strong> {a.scout_brief.what_to_watch}</p>
                  {a.scout_brief.key_clips.length > 0 && (
                    <p className="m-0">
                      <strong>{dict.body.aiAnalyst.keyClips}:</strong>{" "}
                      {a.scout_brief.key_clips.map((k, i) => (
                        <span key={i}>
                          {i > 0 && " · "}
                          <Link href={`/analysis?video=${k.video_id}&t=${Math.max(0, k.minute * 60 - 2)}`} className="text-primary hover:underline">
                            {k.video_title} · {k.minute}&prime; — {k.reason}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </div>
            )}
            {a.not_measured.length > 0 && (
              <div>
                <h3 className="mb-2 t-panel">{dict.body.aiAnalyst.notMeasured}</h3>
                <ul className="pl-[18px] t-body text-muted">
                  {a.not_measured.map((n, i) => (
                    <li key={i}><strong className="text-ink">{n.topic}:</strong> {n.reason}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="m-0 t-small">
              {a.data_basis.games_analysed} match{a.data_basis.games_analysed === 1 ? "" : "es"} analysed · {a.data_basis.minutes_seen} min seen on camera · {a.data_basis.events_count} events · {a.model} · {a.generated_at.slice(0, 10)}
              {a.published_by_name && ` · ${dict.body.aiAnalyst.published} by ${a.published_by_name}, ${a.published_at?.slice(0, 10) ?? ""}`}
            </p>
          </div>
        </div>
      )}

      {a && !a.not_enough_data_reason && !a.failure && canAssess && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          {a.status === "DRAFT" ? (
            <button type="button" disabled={busy || a.stale} onClick={publish}
              title={a.stale ? dict.body.aiAnalyst.stale : undefined}
              className="vie-btn vie-btn-pri">
              {dict.body.aiAnalyst.publish}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={unpublish} className="vie-btn">
              {dict.body.aiAnalyst.unpublish}
            </button>
          )}
          <label className="flex items-center gap-2 t-body text-muted">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{dict.body.aiAnalyst.consent}</span>
          </label>
          <button type="button" disabled={busy || !consent} onClick={generate} className="vie-btn">
            {dict.body.aiAnalyst.regenerate}
          </button>
          <span className="t-small">{dict.body.aiAnalyst.costNote}</span>
        </div>
      )}
      {a?.stale && <p role="alert" className="mt-3 t-body text-amber">{dict.body.aiAnalyst.stale}</p>}
    </section>
  );
}
