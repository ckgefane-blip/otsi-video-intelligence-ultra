"use client";
/**
 * Page 02 Section 02 — match context panel, on the Desktop UI flow layout.
 *
 * Competition, Season and Match come from the organization's real match records (GET /v1/matches: competition, season, clubs,
 * kick-off). Choosing a match links it to the selected upload at once (POST /v1/videos/:id/match), or to the next upload as soon as it
 * is created. "New match…" opens the match form (home and away club, competition, date) for the selected upload. The arrow folds
 * the panel's fields away and back.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Match } from "@otsi-vie/contracts";
import { ChevronUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MatchLinker } from "@/components/matches/MatchPanels";
import { useLocale } from "@/lib/i18n";
import { DATE_TAG, usePage02 } from "./page02";
import { useUpload } from "./UploadWorkspace";

const NEW = "__new";
const name = (m: Match, tag = "en-GB") => `${m.home?.short_name ?? m.home?.name ?? "—"} vs ${m.away?.short_name ?? m.away?.name ?? "—"}${m.kickoff_at ? ` · ${new Date(m.kickoff_at).toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" })}` : ""}`;

export function MatchContextSection() {
  const { t: dict, locale } = useLocale();
  const d = dict.body.upload;
  const tag = DATE_TAG[locale];
  const { selected, canWrite, reloadVideos } = useUpload();
  const { matches, matchId, chooseMatch, reloadMatches, say } = usePage02();
  const [competition, setCompetition] = useState("");
  const [season, setSeason] = useState("");
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  // "+ New match…" without a selected video explains and stops, but shouldn't be a dead end: once one gets selected (in
  // Recent Uploads), open the dialog automatically instead of making the person re-pick "+ New match…" a second time
  const [pendingCreate, setPendingCreate] = useState(false);
  useEffect(() => {
    if (selected && pendingCreate) { setPendingCreate(false); setCreating(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const all = matches ?? [];
  const current = selected?.match_id ?? matchId;
  const competitions = useMemo(() => [...new Set(all.map((m) => m.competition).filter((c): c is string => !!c))].sort(), [all]);
  const seasons = useMemo(() => [...new Set(all.filter((m) => !competition || m.competition === competition).map((m) => m.season).filter((x): x is string => !!x))].sort().reverse(),
    [all, competition]);
  const shown = all.filter((m) => (!competition || m.competition === competition) && (!season || m.season === season));
  const none = matches === null ? d.loadingMatches : d.noMatches;

  const pickMatch = (v: string) => {
    if (v === NEW) {
      if (!canWrite) return say(d.viewUploadsNoCreateMatches);
      if (!selected) { setPendingCreate(true); return say(d.selectUploadForMatch); }
      return setCreating(true);
    }
    if (v && !canWrite) return say(d.viewUploadsNoLinkMatches);
    chooseMatch(v || null);
  };

  const selectCls = "mt-1 w-full rounded-ctl border border-line bg-canvas px-2 py-2 text-sm";
  return (
    <section aria-label={d.matchContext} data-section="p02-s02" data-match={current ?? ""} className="vie-panel">
      <div className="vie-ph">
        <h2 className="t-panel">{d.matchContext} <span className="font-normal text-muted">{d.optional}</span></h2>
        <button type="button" aria-expanded={open} aria-label={open ? d.foldMatchContext : d.showMatchContext} onClick={() => setOpen((o) => !o)} className="vie-ib !h-7 !w-7">
          <ChevronUp className={`h-4 w-4 transition-transform ${open ? "" : "rotate-180"}`} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="space-y-3 p-3 text-sm">
          <label className="block">
            <span className="t-label">{dict.body.library.competition}</span>
            <select aria-label={dict.body.library.competition} value={competition} onChange={(e) => { setCompetition(e.target.value); setSeason(""); }} className={selectCls}>
              <option value="">{d.chooseCompetition}</option>
              {competitions.length ? competitions.map((c) => <option key={c} value={c}>{c}</option>)
                : <option value="none" disabled>{none}</option>}
            </select>
          </label>
          <label className="block">
            <span className="t-label">{d.season}</span>
            <select aria-label={d.season} value={season} onChange={(e) => setSeason(e.target.value)} className={selectCls}>
              <option value="">{d.chooseSeason}</option>
              {seasons.length ? seasons.map((x) => <option key={x} value={x}>{x}</option>)
                : <option value="none" disabled>{competition ? d.noSeasonForCompetition : none}</option>}
            </select>
          </label>
          <label className="block">
            <span className="t-label">{dict.body.analysis.match}</span>
            <select aria-label={dict.body.analysis.match} value={current ?? ""} onChange={(e) => pickMatch(e.target.value)} className={selectCls}>
              <option value="">{d.selectMatch}</option>
              {shown.map((m) => <option key={m.id} value={m.id}>{name(m, tag)}</option>)}
              <option value={NEW}>{d.newMatchOption}</option>
            </select>
          </label>
        </div>
      )}

      <Dialog.Root open={creating} onOpenChange={setCreating}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-semibold">{d.newMatch}</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">{d.newMatchDesc.replace("{name}", selected?.title ?? selected?.original_filename ?? d.thisUpload)}</Dialog.Description>
            {selected && (
              <MatchLinker key={selected.id} videoId={selected.id} matchId={selected.match_id} canWrite={canWrite}
                onLinked={() => { void reloadVideos(); void reloadMatches(); setCreating(false); say(d.matchCreatedLinked); }} />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
