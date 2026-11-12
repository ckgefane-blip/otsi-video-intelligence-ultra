"use client";
/**
 * Page 06 Analysis — the left rail (SOT, Analysis.dc.html).
 *
 * Identities (the people tracks of the latest finished run, most-seen
 * first, with the confirmed count), the eight visual overlays (the
 * viewer's shared preference), and the team sheet (the lineup cards'
 * approval state, with the review dialog). The match card, team filter,
 * time range and AI tools of the old rail are not on this SOT page: the
 * match is in the top bar, the team is the kit assignment, and the
 * identify / ball / pitch tools live in the centre tool bar.
 */
import { useMemo, useState } from "react";
import type { TrackSummary } from "@otsi-vie/contracts";
import { useLocale } from "@/lib/i18n";
import { useOverlayPrefs, type OverlayPrefs } from "@/lib/overlayPrefs";
import { assignmentOf, isPerson, type Shared } from "@/components/workspace/shared";
import { LineupsDialog, useLineups } from "@/components/workspace/Lineups";

const PAGE = 40;

const OVERLAY_ROWS: { key: keyof OverlayPrefs; label: "ovBoxes" | "ovIds" | "ovTracks" | "ovShapes" | "ovBall" | "ovPasses" | "ovHeat" | "ovOffside" }[] = [
  { key: "boxes", label: "ovBoxes" }, { key: "ids", label: "ovIds" }, { key: "trails", label: "ovTracks" }, { key: "shapes", label: "ovShapes" },
  { key: "ball", label: "ovBall" }, { key: "passes", label: "ovPasses" }, { key: "heat", label: "ovHeat" }, { key: "offside", label: "ovOffside" },
];

function stateChip(state: TrackSummary["identity_state"], a: { confirmed: string; unresolved: string; candidate: string; rejected: string; conflict: string }) {
  switch (state) {
    case "CONFIRMED": return { label: a.confirmed, cls: "vie-chip ev ev-c" };
    case "CANDIDATE": return { label: a.candidate, cls: "vie-chip ev ev-i" };
    case "REJECTED": return { label: a.rejected, cls: "vie-chip ev ev-f" };
    case "CONFLICT": return { label: a.conflict, cls: "vie-chip ev ev-f" };
    default: return { label: a.unresolved, cls: "vie-chip ev ev-n" };
  }
}

export function AnalysisLeft({ s }: { s: Shared }) {
  const { t: dict } = useLocale();
  const a = dict.body.analysis;
  const d = dict.desktop;
  const { ws, kits } = s;
  const [prefs, save] = useOverlayPrefs();
  const [shown, setShown] = useState(PAGE);
  const [lineupsOpen, setLineupsOpen] = useState(false);
  const lineups = useLineups(ws?.video?.id);

  const people = useMemo(
    () => (ws?.tracks ?? []).filter((t) => isPerson(t) && t.observation_count >= 3).sort((x, y) => y.observation_count - x.observation_count),
    [ws?.tracks],
  );
  const confirmed = people.filter((t) => t.identity_state === "CONFIRMED").length;
  const cards = (lineups.data?.cards ?? []).filter((c) => c.state !== "DISMISSED");
  const openCards = cards.filter((c) => c.state === "PROPOSED");
  const teamSheetState = !lineups.data?.read
    ? null
    : openCards.length > 0
      ? { label: a.anAwaitingApproval, cls: "vie-chip ev ev-i" }
      : { label: a.anApproved, cls: "vie-chip ev ev-c" };

  return (
    <aside className="flex w-[272px] shrink-0 flex-col overflow-y-auto border-r border-line" aria-label={a.anIdentities}>
      <div className="vie-ph" style={{ minHeight: 44 }}>
        <h2 className="t-section">{a.anIdentities}</h2>
        <span className="t-small text-muted">{a.anConfirmedCount.replace("{a}", String(confirmed))}</span>
      </div>

      {people.length === 0 ? (
        <div className="flex min-h-10 items-center px-4">
          <span className="t-small text-muted">{a.anNoOtherPeople}</span>
        </div>
      ) : (
        <div className="flex flex-col">
          {people.slice(0, shown).map((t) => {
            const on = t.track_id === ws?.selectedId;
            const chip = stateChip(t.identity_state, {
              confirmed: dict.body.reports.confirmedShort,
              unresolved: a.anUnresolved,
              candidate: a.anCandidate,
              rejected: a.anRejected,
              conflict: a.anConflict,
            });
            const team = assignmentOf(kits, t);
            return (
              <button
                key={t.track_id}
                type="button"
                onClick={() => { ws?.select(t.track_id); ws?.seek(t.first_pts_us); }}
                className={`flex min-h-[52px] items-center gap-2.5 px-4 text-left hover:bg-raised/40 ${on ? "bg-raised/40" : ""}`}
                aria-current={on}
              >
                <span aria-hidden className="h-7 w-[3px] shrink-0 rounded-full" style={{ background: on ? "rgb(var(--primary))" : "transparent" }} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{t.label.split(" · ")[0]}</span>
                  <span className="t-small truncate text-muted">{team?.club_name ?? `Track ${t.track_number}`}</span>
                </span>
                <span className={chip.cls}>{chip.label}</span>
              </button>
            );
          })}
          {people.length > shown && (
            <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mx-auto my-2 rounded-md border border-line px-3 py-1.5 text-sm">
              {dict.body.workspace.showMoreLeft.replace("{a}", String(Math.min(PAGE, people.length - shown))).replace("{b}", String(people.length - shown))}
            </button>
          )}
        </div>
      )}
      {people.length === 1 && (
        <div className="flex min-h-10 items-center px-4">
          <span className="t-small text-muted">{a.anNoOtherPeople}</span>
        </div>
      )}

      <div className="flex flex-col gap-0.5 border-t border-line px-4 py-2.5">
        <span className="t-th">{d.overlaysTitle}</span>
        {OVERLAY_ROWS.map((r) => (
          <div key={r.key} className="flex h-[29px] items-center justify-between gap-3">
            <span className="t-body">{d[r.label]}</span>
            <button type="button" role="switch" aria-checked={prefs[r.key]} aria-label={d[r.label]} className="vie-sw" data-overlay={r.key}
              onClick={() => save({ ...prefs, [r.key]: !prefs[r.key] })} />
          </div>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="t-body font-medium">{a.anTeamSheet}</span>
          {teamSheetState && <span className={teamSheetState.cls}>{teamSheetState.label}</span>}
        </div>
        <button type="button" onClick={() => setLineupsOpen(true)} className="vie-btn w-full">
          {a.anReviewTeamSheet}
        </button>
      </div>

      {ws?.video && (
        <LineupsDialog open={lineupsOpen} onOpenChange={setLineupsOpen} videoId={ws.video.id} lineups={lineups} onApplied={() => void ws.reloadVideo()} />
      )}
    </aside>
  );
}
