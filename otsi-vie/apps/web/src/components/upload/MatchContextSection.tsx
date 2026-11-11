"use client";
/**
 * Page 02 Section 02 — match context metadata sidebar (approved reference 02_UPLOAD_INGEST, "left", first panel).
 *
 * Competition, Season and Match come from the organization's real match records (GET /v1/matches: competition, season, clubs,
 * kick-off). Choosing a match links it to the selected upload at once (POST /v1/videos/:id/match), or to the next upload as soon as it
 * is created. "New match…" opens the match form (home and away club, competition, date) for the selected upload. The arrow folds
 * the panel's fields away and back.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Match } from "@otsi-vie/contracts";
import { useEffect, useMemo, useState } from "react";
import { MatchLinker } from "@/components/matches/MatchPanels";
import { Ic, P, T, u } from "@/components/stage/DesignStage";
import { useLocale } from "@/lib/i18n";
import { DATE_TAG, Sel, usePage02 } from "./page02";
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

  return (
    <section aria-label={d.matchContext} data-section="p02-s02" data-match={current ?? ""}>
      <P x={22} y={122} w={383} h={open ? 356 : 62} />
      <T x={42} y={153} size={25} weight={600} as="h2">{d.matchContext}</T>
      <T x={214} y={153} size={21} color="#9fb3cc">{d.optional}</T>
      <button type="button" aria-expanded={open} aria-label={open ? d.foldMatchContext : d.showMatchContext} onClick={() => setOpen((o) => !o)}
        className="absolute" style={{ left: u(362), top: u(139 - 101), width: u(28), height: u(28), padding: 0, border: 0, background: "transparent", cursor: "pointer",
          transform: open ? undefined : "rotate(180deg)" }}>
        <Ic o={[362, 139]} x={376} y={153} k="u_up" size={20} />
      </button>
      {open && (
        <>
          <T x={41} y={196} size={20} color="#cfe0f5" as="span">{dict.body.library.competition}</T>
          <Sel x={41} y={211} w={345} h={54} label={dict.body.library.competition} value={competition} placeholder={d.chooseCompetition}
            options={competitions.length ? competitions.map((c) => [c, c] as [string, string]) : [["none", d.competitions, none]]}
            onChange={(v) => { setCompetition(v); setSeason(""); }} />
          <T x={41} y={292} size={20} color="#cfe0f5" as="span">{d.season}</T>
          <Sel x={41} y={308} w={345} h={54} label={d.season} value={season} placeholder={d.chooseSeason}
            options={seasons.length ? seasons.map((x) => [x, x] as [string, string]) : [["none", d.seasons, competition ? d.noSeasonForCompetition : none]]}
            onChange={setSeason} />
          <T x={41} y={389} size={20} color="#cfe0f5" as="span">{dict.body.analysis.match}</T>
          <Sel x={41} y={404} w={345} h={55} label={dict.body.analysis.match} value={current ?? ""} placeholder={d.selectMatch}
            options={[...shown.map((m) => [m.id, name(m, tag)] as [string, string]), [NEW, d.newMatchOption]]} onChange={pickMatch} />
        </>
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
