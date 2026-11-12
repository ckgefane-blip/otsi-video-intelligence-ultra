"use client";
/**
 * Page 08 Player Report on the approved composition (corrected reference 08_PLAYER_REPORT). A report is addressed by the permanent OTSI
 * Player ID (or the internal id of a provisional player). The identity comes from the player registry; measurements from his confirmed
 * tracks; notes, dossiers, PDFs, share links and the assessment through their dialogs (ADR-056). Without a player it shows the reference's
 * empty state and a player picker.
 *
 * Drop 1 layout: the same rail, hero, KPIs, lower sections, dialogs and API reads, laid out in the page's flow (sticky section rail on
 * the left, content column on the right) on the Desktop UI shell, instead of the 2560-px DesignStage composition. Nothing was removed
 * or rewired.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { PlayerAssessment, PlayerIdentity, PlayerListEntry, PlayerMeasures, PlayerProfile } from "@otsi-vie/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { parsePlayerRef, type PlayerRef } from "@/lib/identity";
import { typing } from "@/lib/keymap";
import { Lower } from "./Bottom";
import { AssessmentDialog, DossierDialog, NotesDialog, ReportDialog, type DialogName } from "./Dialogs";
import { Hero, Kpis, Rail, RAIL, type Report } from "./Top";

function PlayerPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t: dict } = useLocale();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Pick<PlayerIdentity, "player_id" | "display_name" | "canonical_otsi_id" | "canonical_state">[] | null | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    // B.24 (ADR-099): the search needs two characters; before that the picker lists the organization's players (the Players list)
    const t = q.trim();
    const h = setTimeout(() => void (t.length >= 2 ? api<PlayerIdentity[]>(`/v1/players?q=${encodeURIComponent(t)}`)
      : api<PlayerListEntry[]>("/v1/player-list").then((l) => l.filter((x) => !t || x.display_name.toLowerCase().startsWith(t.toLowerCase())).slice(0, 50)
        .map((x) => ({ player_id: x.player_id, display_name: x.display_name, canonical_otsi_id: x.canonical_otsi_id, canonical_state: x.canonical_otsi_id ? "REGISTERED" as const : "PROVISIONAL" as const }))))
      .then(setHits, () => setHits(null)), 200);
    return () => clearTimeout(h);
  }, [open, q]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 t-body shadow-2xl" data-dialog="choose-player">
          <Dialog.Title className="t-section">{dict.body.reports.choosePlayer}</Dialog.Title>
          <Dialog.Description className="mb-3 t-small">{dict.body.reports.pickerDesc}
            {" "}<Link href="/players" className="text-primary hover:underline">{dict.body.reports.playersListLink}</Link></Dialog.Description>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label={dict.body.reports.pickerSearchAria} placeholder={dict.body.reports.searchPlayers} className="mb-2 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
          {hits === undefined && <p className="text-muted">{dict.common.loading}</p>}
          {hits === null && <p role="alert" className="text-danger">{dict.body.reports.playersNotLoaded}</p>}
          {hits?.length === 0 && <p className="text-muted">{dict.body.reports.noPlayerFound}</p>}
          <ul aria-label={dict.body.players.playersListAria} className="space-y-1">
            {hits?.map((p) => (
              <li key={p.player_id}>
                <button type="button" data-player={p.player_id} onClick={() => { onOpenChange(false); router.push(`/reports/players/${p.canonical_otsi_id ?? p.player_id}`); }}
                  className="flex w-full items-center justify-between gap-3 rounded-ctl border border-line/70 px-3 py-2 text-left hover:border-primary/60">
                  <span className="min-w-0 truncate font-medium">{p.display_name}</span>
                  <span className="shrink-0 t-small" data-player-state={p.canonical_state}>{p.canonical_otsi_id ?? dict.body.reports.provisionalNoIdShort}{p.canonical_state === "RETIRED" ? dict.body.reports.retiredSuffix : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ReportStage({ playerRef }: { playerRef?: string }) {
  const { t: dict } = useLocale();
  const ref: PlayerRef | null = playerRef ? parsePlayerRef(playerRef) : null;
  const [player, setPlayer] = useState<PlayerIdentity | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [picking, setPicking] = useState(!playerRef);              // B.24 (ADR-099): the landing without a player opens the picker
  const [selected, setSelected] = useState(0);
  const [measures, setMeasures] = useState<PlayerMeasures | null>(null);
  /** the measures read failed (null then means failed, not loading): the KPI cards name it instead of showing "—" */
  const [measuresFailed, setMeasuresFailed] = useState(false);
  useEffect(() => {                                  // what the footage measured: tracks a person confirmed as this player only
    setMeasures(null); setMeasuresFailed(false);
    if (player) void api<PlayerMeasures>(`/v1/players/${player.player_id}/measures`).then(setMeasures, () => { setMeasures(null); setMeasuresFailed(true); });
  }, [player]);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  useEffect(() => {
    setProfile(null);
    if (player) void api<PlayerProfile>(`/v1/players/${player.player_id}/profile`).then(setProfile, () => setProfile(null));
  }, [player]);
  const [assessment, setAssessment] = useState<PlayerAssessment | null>(null);
  useEffect(() => {
    setAssessment(null);
    if (player) void api<PlayerAssessment>(`/v1/players/${player.player_id}/assessment`).then(setAssessment, () => setAssessment(null));
  }, [player]);
  const [dialog, setDialog] = useState<DialogName>(null);
  const role = useAuth().organization?.role ?? "VIEWER";
  const can = useMemo(() => ({ write: ["OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT"].includes(role), assess: ["OWNER", "ADMIN", "ANALYST", "SCOUT"].includes(role), share: ["OWNER", "ADMIN", "ANALYST", "EDITOR"].includes(role) }), [role]);
  const [focus, setFocus] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const key = ref ? `${ref.kind}:${ref.id}` : "";
  useEffect(() => {
    setPlayer(null); setMissing(null);
    if (!ref) return;
    const path = ref.kind === "canonical" ? `/v1/players/by-otsi-id/${ref.id}` : `/v1/players/${ref.id}`;
    void api<PlayerIdentity>(path).then(setPlayer, (x) => setMissing(x instanceof ApiProblem && x.status === 404 ? dict.body.reports.noSuchPlayer : dict.body.reports.playerLoadFailed));
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const go = useCallback((i: number) => {
    setSelected(i);
    const [label, , , target] = RAIL[i]!;
    if (!target) { if (label === "Video Clips") router.push("/reels"); return; }
    setFocus(target);
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocus((f) => (f === target ? null : f)), 1600);
  }, [router]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);   // the focus highlight never outlives the page
  const pick = useCallback(() => setPicking(true), []);
  const close = useCallback(() => setDialog(null), []);
  // [ / ] move between the rail's sections (lib/keymap.ts, Reports scope): only on this page, never while typing or with a dialog open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || dialog !== null || picking) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "]") go(Math.min(RAIL.length - 1, selected + 1));
      else if (e.key === "[") go(Math.max(0, selected - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, go, dialog, picking]);
  // the Report object is memoised so opening a dialog or the picker does not re-render Rail, Hero, Kpis and Lower (they are memoised)
  const r: Report = useMemo(() => ({ player, missing, focus, selected, go, pick, measures, measuresFailed, profile, assessment, open: setDialog, can }),
    [player, missing, focus, selected, go, pick, measures, measuresFailed, profile, assessment, can]);
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4 lg:flex-row" data-page="reports">
      <Rail r={r} />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Hero r={r} />
        <Kpis r={r} />
        <Lower r={r} />
      </div>
      <PlayerPicker open={picking} onOpenChange={setPicking} />
      {player && (
        <>
          <NotesDialog player={player} open={dialog === "notes"} onClose={close} />
          <DossierDialog player={player} open={dialog === "dossier"} onClose={close} canWrite={can.write} />
          <ReportDialog player={player} open={dialog === "pdf" || dialog === "share"} share={dialog === "share"} onClose={close} canMake={can.write} canShare={can.share} />
          <AssessmentDialog player={player} open={dialog === "assess" || dialog === "read"} edit={dialog === "assess"} onClose={close} onSaved={setAssessment} confirmed={!!measures?.tracks} />
        </>
      )}
    </div>
  );
}
