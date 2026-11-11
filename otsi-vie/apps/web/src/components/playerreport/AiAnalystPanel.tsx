"use client";
/**
 * Page 08 Player Report — AI Analyst panel (ADR-141, ultra-only; scope: ai-analyst-scope.md).
 *
 * The assessment renders beside the human assessment, clearly labelled "AI-generated — draft until published".
 * Each claim shows its evidence link (match + minute, opening the clip in Analysis), its confidence (computed by
 * code, never by the model), and a warning where the confidence is Low. Recommendations and the tactical fit are
 * labelled as suggestions, not facts. "Not measured" is shown where the engine measured nothing, never a guess.
 * Nothing is published until a person has read it and pressed Publish; a draft never reaches a club or a
 * Scouting Pack (the export hook refuses it). The panel is a normal-flow section placed below the reference's
 * 1339 design pixels (ReportStage passes extra room); its claims list scrolls inside a fixed height so a long
 * assessment never overflows the stage.
 */
import type { AiAnalystAssessment, AiAnalystClaim, AiAnalystProviderStatus } from "@otsi-vie/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { u } from "@/components/stage/DesignStage";

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
    <span style={{ ...style, borderRadius: u(6), padding: `${u(2)} ${u(8)}`, fontSize: u(13), fontWeight: 600, whiteSpace: "nowrap" }}>{label}</span>
  );
}

function ClaimList({ claims, dict }: { claims: AiAnalystClaim[]; dict: ReturnType<typeof useLocale>["t"] }) {
  if (!claims.length) return <p style={{ color: "#8ea3bf", fontSize: u(15) }}>—</p>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: u(10) }}>
      {claims.map((c, i) => (
        <li key={i} style={{ background: "#071a33", border: `${u(1.5)} solid #12335f`, borderRadius: u(8), padding: `${u(10)} ${u(12)}` }}>
          <div style={{ display: "flex", gap: u(10), alignItems: "flex-start", justifyContent: "space-between" }}>
            <span style={{ fontSize: u(16), lineHeight: 1.4 }}>{c.text}</span>
            <ConfidenceBadge confidence={c.confidence} dict={dict} />
          </div>
          {c.confidence === "LOW" && <p style={{ margin: `${u(6)} 0 0`, color: "#f1a824", fontSize: u(13) }}>{dict.body.aiAnalyst.lowConfidenceWarning}</p>}
          <p style={{ margin: `${u(8)} 0 0`, color: "#8ea3bf", fontSize: u(13) }}>
            {dict.body.aiAnalyst.evidence}:{" "}
            {c.evidence.map((e, j) => (
              <span key={j}>
                {j > 0 && " · "}
                <Link href={e.clip_ref} style={{ color: "#33a8ff" }}>{e.match} · {e.minute ?? "?"}&prime; · {e.event} × {e.count}</Link>
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
    <section id="p08-analyst" aria-label="AI Analyst" data-section="p08-s13"
      style={{ position: "absolute", left: u(24), top: u(1420 - 101), width: u(2512) }}>
      <div style={{ background: "linear-gradient(#081a35, #06122a)", border: `${u(1.5)} solid #12335f`, borderRadius: u(14), padding: `${u(18)} ${u(24)}` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: u(14), flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: u(24), fontWeight: 700 }}>{dict.body.aiAnalyst.title}</h2>
          {a && (
            <span style={{ fontSize: u(14), fontWeight: 600, color: a.status === "PUBLISHED" ? "#3ee6a8" : "#f1a824" }}>
              {a.status === "PUBLISHED" ? dict.body.aiAnalyst.published : dict.body.aiAnalyst.draft}
            </span>
          )}
          <span style={{ fontSize: u(14), color: "#8ea3bf" }}>{dict.body.aiAnalyst.aiGeneratedDraft}</span>
          {a && <ConfidenceBadge confidence={a.confidence_overall} dict={dict} />}
        </div>

        {status === undefined || assessment === undefined ? (
          <p style={{ color: "#8ea3bf", fontSize: u(15) }}>Loading…</p>
        ) : status === null ? (
          <p role="alert" style={{ color: "#ff6b5e", fontSize: u(15) }}>The AI Analyst status could not be loaded.</p>
        ) : !status.configured ? (
          <p style={{ color: "#8ea3bf", fontSize: u(15) }}>{dict.body.aiAnalyst.notConfigured}</p>
        ) : error ? (
          <p role="alert" style={{ color: "#ff6b5e", fontSize: u(15) }}>{error}</p>
        ) : !a ? (
          <>
            <p style={{ color: "#b9cbe2", fontSize: u(15) }}>{dict.body.aiAnalyst.noAssessment}</p>
            <p style={{ color: "#8ea3bf", fontSize: u(14) }}>{dict.body.aiAnalyst.costNote} {dict.body.aiAnalyst.privacyNote}</p>
            {canAssess && (
              <>
                <label style={{ display: "flex", gap: u(8), alignItems: "flex-start", fontSize: u(14), color: "#b9cbe2", marginBottom: u(10) }}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>{dict.body.aiAnalyst.consent}</span>
                </label>
                <button type="button" disabled={busy || !consent} onClick={generate}
                  style={{ background: consent ? "#0a84ff" : "#12335f", color: "#fff", border: "none", borderRadius: u(6), padding: `${u(8)} ${u(16)}`, fontSize: u(15), fontWeight: 600, cursor: consent ? "pointer" : "not-allowed" }}>
                  {dict.body.aiAnalyst.generate}
                </button>
              </>
            )}
          </>
        ) : a.not_enough_data_reason ? (
          <p style={{ color: "#f1a824", fontSize: u(15) }}>{dict.body.aiAnalyst.notEnoughData}: {a.not_enough_data_reason}</p>
        ) : a.failure ? (
          <>
            <p role="alert" style={{ color: "#ff6b5e", fontSize: u(15) }}>{dict.body.aiAnalyst.couldNotVerify}</p>
            <p style={{ color: "#8ea3bf", fontSize: u(14) }}>{dict.body.aiAnalyst.costNote}</p>
          </>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: u(20), marginTop: u(14) }}>
            <div style={{ display: "flex", flexDirection: "column", gap: u(16), maxHeight: u(430), overflowY: "auto", paddingRight: u(8) }}>
              <div>
                <h3 style={{ margin: `0 0 ${u(8)}`, fontSize: u(18), fontWeight: 600 }}>{dict.body.aiAnalyst.strengths}</h3>
                <ClaimList claims={a.strengths} dict={dict} />
              </div>
              <div>
                <h3 style={{ margin: `0 0 ${u(8)}`, fontSize: u(18), fontWeight: 600 }}>{dict.body.aiAnalyst.developmentAreas}</h3>
                <ClaimList claims={a.development_areas} dict={dict} />
              </div>
              <div>
                <h3 style={{ margin: `0 0 ${u(8)}`, fontSize: u(18), fontWeight: 600 }}>{dict.body.aiAnalyst.recommendations}</h3>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: u(10) }}>
                  {a.recommendations.map((r, i) => (
                    <li key={i} style={{ background: "#071a33", border: `${u(1.5)} solid #12335f`, borderRadius: u(8), padding: `${u(10)} ${u(12)}` }}>
                      <div style={{ display: "flex", gap: u(10), alignItems: "flex-start", justifyContent: "space-between" }}>
                        <span style={{ fontSize: u(16), lineHeight: 1.4 }}>{r.text}</span>
                        <ConfidenceBadge confidence={r.confidence} dict={dict} />
                      </div>
                      <p style={{ margin: `${u(6)} 0 0`, fontSize: u(15), color: "#b9cbe2" }}>{r.action}</p>
                      <p style={{ margin: `${u(4)} 0 0`, fontSize: u(13), color: "#f1a824" }}>{dict.body.aiAnalyst.suggestionNotFact}</p>
                      <p style={{ margin: `${u(8)} 0 0`, color: "#8ea3bf", fontSize: u(13) }}>
                        {dict.body.aiAnalyst.evidence}:{" "}
                        {r.evidence.map((e, j) => (
                          <span key={j}>
                            {j > 0 && " · "}
                            <Link href={e.clip_ref} style={{ color: "#33a8ff" }}>{e.match} · {e.minute ?? "?"}&prime; · {e.event} × {e.count}</Link>
                          </span>
                        ))}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: u(16), maxHeight: u(430), overflowY: "auto", paddingRight: u(8) }}>
              <div>
                <h3 style={{ margin: `0 0 ${u(8)}`, fontSize: u(18), fontWeight: 600 }}>{dict.body.aiAnalyst.tacticalFit}</h3>
                {a.tactical_fit && (
                  <div style={{ background: "#071a33", border: `${u(1.5)} solid #12335f`, borderRadius: u(8), padding: `${u(10)} ${u(12)}` }}>
                    <div style={{ display: "flex", gap: u(10), alignItems: "flex-start", justifyContent: "space-between" }}>
                      <span style={{ fontSize: u(16), lineHeight: 1.4 }}>{a.tactical_fit.text}</span>
                      <ConfidenceBadge confidence={a.tactical_fit.confidence} dict={dict} />
                    </div>
                    <p style={{ margin: `${u(4)} 0 0`, fontSize: u(13), color: "#f1a824" }}>{dict.body.aiAnalyst.suggestionNotFact}</p>
                  </div>
                )}
              </div>
              {a.scout_brief && (
                <div>
                  <h3 style={{ margin: `0 0 ${u(8)}`, fontSize: u(18), fontWeight: 600 }}>{dict.body.aiAnalyst.scoutBrief}</h3>
                  <div style={{ background: "#071a33", border: `${u(1.5)} solid #12335f`, borderRadius: u(8), padding: `${u(10)} ${u(12)}`, fontSize: u(15), lineHeight: 1.5 }}>
                    <p style={{ margin: "0 0 8px" }}>{a.scout_brief.strengths_summary}</p>
                    <p style={{ margin: "0 0 8px" }}>{a.scout_brief.fit_summary}</p>
                    <p style={{ margin: "0 0 8px" }}><strong>{dict.body.aiAnalyst.whatToWatch}:</strong> {a.scout_brief.what_to_watch}</p>
                    {a.scout_brief.key_clips.length > 0 && (
                      <p style={{ margin: 0 }}>
                        <strong>{dict.body.aiAnalyst.keyClips}:</strong>{" "}
                        {a.scout_brief.key_clips.map((k, i) => (
                          <span key={i}>
                            {i > 0 && " · "}
                            <Link href={`/analysis?video=${k.video_id}&t=${Math.max(0, k.minute * 60 - 2)}`} style={{ color: "#33a8ff" }}>
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
                  <h3 style={{ margin: `0 0 ${u(8)}`, fontSize: u(18), fontWeight: 600 }}>{dict.body.aiAnalyst.notMeasured}</h3>
                  <ul style={{ margin: 0, paddingLeft: u(18), color: "#8ea3bf", fontSize: u(14), lineHeight: 1.5 }}>
                    {a.not_measured.map((n, i) => (
                      <li key={i}><strong style={{ color: "#b9cbe2" }}>{n.topic}:</strong> {n.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p style={{ margin: 0, color: "#8ea3bf", fontSize: u(13) }}>
                {a.data_basis.games_analysed} match{a.data_basis.games_analysed === 1 ? "" : "es"} analysed · {a.data_basis.minutes_seen} min seen on camera · {a.data_basis.events_count} events · {a.model} · {a.generated_at.slice(0, 10)}
                {a.published_by_name && ` · ${dict.body.aiAnalyst.published} by ${a.published_by_name}, ${a.published_at?.slice(0, 10) ?? ""}`}
              </p>
            </div>
          </div>
        )}

        {a && !a.not_enough_data_reason && !a.failure && canAssess && (
          <div style={{ display: "flex", gap: u(10), marginTop: u(16), alignItems: "center", flexWrap: "wrap" }}>
            {a.status === "DRAFT" ? (
              <button type="button" disabled={busy || a.stale} onClick={publish}
                title={a.stale ? dict.body.aiAnalyst.stale : undefined}
                style={{ background: a.stale ? "#12335f" : "#0a84ff", color: "#fff", border: "none", borderRadius: u(6), padding: `${u(8)} ${u(16)}`, fontSize: u(15), fontWeight: 600, cursor: a.stale ? "not-allowed" : "pointer" }}>
                {dict.body.aiAnalyst.publish}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={unpublish}
                style={{ background: "#12335f", color: "#fff", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6), padding: `${u(8)} ${u(16)}`, fontSize: u(15), fontWeight: 600, cursor: "pointer" }}>
                {dict.body.aiAnalyst.unpublish}
              </button>
            )}
            <label style={{ display: "flex", gap: u(8), alignItems: "center", fontSize: u(14), color: "#b9cbe2" }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{dict.body.aiAnalyst.consent}</span>
            </label>
            <button type="button" disabled={busy || !consent} onClick={generate}
              style={{ background: consent ? "#12335f" : "#0a2447", color: "#fff", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6), padding: `${u(8)} ${u(16)}`, fontSize: u(15), fontWeight: 600, cursor: consent ? "pointer" : "not-allowed" }}>
              {dict.body.aiAnalyst.regenerate}
            </button>
            <span style={{ fontSize: u(13), color: "#8ea3bf" }}>{dict.body.aiAnalyst.costNote}</span>
          </div>
        )}
        {a?.stale && <p role="alert" style={{ margin: `${u(12)} 0 0`, color: "#f1a824", fontSize: u(14) }}>{dict.body.aiAnalyst.stale}</p>}
      </div>
    </section>
  );
}
