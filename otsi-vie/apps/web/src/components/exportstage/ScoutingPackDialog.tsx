"use client";
/**
 * Single Match Spotlight + Scouting Pack (ADR-142, ultra-only; Roadmap Phase 4, Option B).
 *
 * The paid offer as one named export bundle, from the Export page: the highlight reel (Player Profile Intro
 * first, then the moments per Best Moment Rule v2.1), the player report, and the AI Analyst brief when it is
 * published — as one ZIP with a manifest. A Single Match Spotlight is the Pack for one match's reel; the same
 * bundle over a cross-match reel covers all his matches. The dialog shows the Pack's manifest — what is inside,
 * which match(es), the rule version stamped, and which items are included or excluded and why — and downloads
 * the finished ZIP. A draft Analyst brief is never in a Pack: the manifest says so, in words.
 *
 * Cost: 10 tokens for the whole Pack (the export-pack cost, ADR-140). The reel, the report and the brief inside
 * it are covered by that one charge and are never charged again.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { SCOUTING_PACK_COST_TOKENS, SCOUTING_PACK_ITEM_LABELS, SCOUTING_PACK_SOURCE_LABELS, type Reel, type ScoutingPack } from "@otsi-vie/contracts";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";

const STATE_TONE: Record<string, string> = { INCLUDED: "#3ee6a8", EXCLUDED: "#f5b82e", NOT_MEASURED: "#f5b82e", FAILED: "#ff8a8a" };

export function ScoutingPackDialog({ reel, canWrite = true, open, onOpenChange }: {
  reel: Reel | null;
  canWrite?: boolean;
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const player = reel?.player ?? null;
  const source = reel?.source === "ALL_MATCHES" ? "CROSS_MATCH" as const : "SINGLE_MATCH" as const;
  const [packs, setPacks] = useState<ScoutingPack[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [includeReport, setIncludeReport] = useState(true);
  const [includeBrief, setIncludeBrief] = useState(true);

  const load = useCallback(() => {
    if (!player) return;
    setErr(null);
    void api<ScoutingPack[]>(`/v1/players/${player.player_id}/scouting-packs`)
      .then(setPacks, (x) => { setErr(x instanceof ApiProblem ? x.message : "The Scouting Packs could not be read."); setPacks([]); });
  }, [player]);
  useEffect(() => { if (open) { setPacks(null); setMsg(null); load(); } }, [open, load]);

  const build = () => {
    if (!reel || !player || !canWrite) return;
    setBusy(true); setMsg(null); setErr(null);
    void api<ScoutingPack>(`/v1/players/${player.player_id}/scouting-packs`, {
      method: "POST", json: { reel_id: reel.id, include_report: includeReport, include_analyst_brief: includeBrief },
    }).then((p) => { setMsg(`Scouting Pack built — ${SCOUTING_PACK_COST_TOKENS} tokens.`); setPacks((xs) => (xs ? [p, ...xs] : [p])); },
      (x) => setErr(x instanceof ApiProblem ? x.message : "The Scouting Pack could not be built.")).finally(() => setBusy(false));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="scouting-pack" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(680px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-normal">Scouting Pack — {SCOUTING_PACK_SOURCE_LABELS[source]}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            One named bundle for the club: the highlight reel (Player Profile Intro first, then the best moments
            under Best Moment Rule v2.1), the player report, and the AI Analyst brief when it is published — as one
            download with a manifest. {SCOUTING_PACK_COST_TOKENS} tokens for the whole Pack; nothing inside it is
            charged again.
          </Dialog.Description>
          {!reel || !player ? (
            <p className="mb-3 text-xs text-muted">Open a reel with a confirmed player first.</p>
          ) : (
            <>
              <div data-scouting-pack-reel className="mb-3 rounded border border-line bg-raised p-2.5 text-xs">
                <div className="font-normal">{reel.name} · {player.display_name}{player.canonical_otsi_id ? ` · ${player.canonical_otsi_id}` : ""}</div>
                <div className="text-muted">
                  {source === "SINGLE_MATCH" ? "Single Match Spotlight — one match, one reel, one report." : "All matches — the cross-match reel, every match he was tracked in."}
                  {reel.best_moments_rule_version ? ` Best Moment Rule v${reel.best_moments_rule_version}.` : " Best Moment Rule v2.1."}
                </div>
              </div>
              <div className="mb-3 flex flex-wrap gap-4 text-xs">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={includeReport} onChange={(e) => setIncludeReport(e.target.checked)} disabled={busy || !canWrite} /> Include the player report
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={includeBrief} onChange={(e) => setIncludeBrief(e.target.checked)} disabled={busy || !canWrite} /> Include the AI Analyst brief, when published
                </label>
              </div>
              <p className="mb-3 text-xs text-muted">A draft Analyst brief is never in a Pack — the manifest says &ldquo;not included (draft, not published)&rdquo; instead. Everything in a Pack comes from measured data only; anything not measured is labelled Not measured.</p>
              {err ? <p role="alert" data-scouting-pack-error className="mb-3 text-xs text-[#ff8a8a]">{err}</p> : null}
              {msg ? <p data-scouting-pack-message className="mb-3 text-xs text-[#3ee6a8]">{msg}</p> : null}
              <div className="mb-3 flex flex-wrap gap-2">
                <button type="button" data-build-scouting-pack onClick={build} disabled={busy || !canWrite || !reel.last_good_render}
                  title={reel.last_good_render ? "Build the Scouting Pack (10 tokens)" : "Render the reel first"}
                  className="rounded bg-primary px-3 py-1.5 font-normal text-white disabled:opacity-50">
                  {busy ? "Building…" : `Build the Scouting Pack — ${SCOUTING_PACK_COST_TOKENS} tokens`}
                </button>
                {!reel.last_good_render ? <span className="self-center text-xs text-muted">Render the reel first: the Pack holds the finished reel file.</span> : null}
                {!canWrite ? <span className="self-center text-xs text-muted">Your role can look, not build.</span> : null}
              </div>
              <h3 className="mb-1.5 text-xs font-normal uppercase tracking-wide text-muted">Packs for this player</h3>
              {!packs ? (
                <p className="mb-3 text-xs text-muted">Reading the Packs…</p>
              ) : !packs.length ? (
                <p data-scouting-pack-empty className="mb-3 text-xs text-muted">No Scouting Pack yet for this player.</p>
              ) : (
                <ul data-scouting-pack-list className="mb-3 space-y-2 text-xs">
                  {packs.map((p) => (
                    <li key={p.id} data-scouting-pack={p.id} className="rounded border border-line/60 p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-normal">{p.manifest.name}</span>
                        <span style={{ color: p.state === "READY" ? "#3ee6a8" : p.state === "FAILED" ? "#ff8a8a" : "#f5b82e" }}>{p.state}</span>
                      </div>
                      <div className="text-muted">Best Moment Rule v{p.manifest.best_moments_rule_version} · {p.manifest.match_titles.join(" · ")} · {p.cost_tokens} tokens · {p.created_at.slice(0, 10)}</div>
                      <ul className="mt-1.5 space-y-1">
                        {p.manifest.items.map((it) => (
                          <li key={it.kind} data-pack-item={it.kind} data-pack-item-state={it.state} className="flex justify-between gap-3">
                            <span>{SCOUTING_PACK_ITEM_LABELS[it.kind]}</span>
                            <span style={{ color: STATE_TONE[it.state] ?? "#cfe0f5" }}>{it.state}{it.reason ? ` — ${it.reason}` : ""}</span>
                          </li>
                        ))}
                      </ul>
                      {p.zip ? (
                        <a data-download-scouting-pack href={p.zip.download_url} className="mt-1.5 inline-block font-normal text-[#33a8ff] underline">Download the Pack ({(p.zip.bytes / 1_000_000).toFixed(1)} MB)</a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close className="rounded border border-line px-3 py-1.5">Close</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
