"use client";
/**
 * Home — Recent Matches: the four most recently analysed match videos (GET /v1/overview/recent-matches: a finished analysis run). A row
 * shows the video's real thumbnail (GET /v1/videos/:id/thumbnail, the frame stored beside its source) — or, when it has none, an honest
 * empty thumbnail that says so — its real length, the linked match (home vs away, competition, kick-off date, score) when someone linked
 * one, otherwise the video's own title and "Not linked to a match". The score only when both were recorded. A row opens the video in the
 * Analysis workspace; View all opens the Library. Nothing analysed: the empty state. A failed read says so and retries.
 */
import type { RecentMatch } from "@otsi-vie/contracts";
import { ArrowRight, ChevronRight, ImageOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, apiBlob } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

/** a duration as m:ss, minutes running past the hour for a full match (138:10) */
export const clock = (us: number | null) => {
  if (!us) return "—";
  const t = Math.round(us / 1e6);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

function title(m: RecentMatch) {
  if (m.match) return `${m.match.home ?? "—"} vs ${m.match.away ?? "—"}`;
  return m.video_title ?? "Untitled video";
}
function subtitle(m: RecentMatch) {
  if (!m.match) return "Not linked to a match";
  return [m.match.competition, day(m.match.kickoff_at)].filter(Boolean).join(" • ") || "No competition or date yet (Upload › Set match details)";
}
const score = (m: RecentMatch) =>
  m.match && m.match.home_score !== null && m.match.away_score !== null ? `${m.match.home_score} - ${m.match.away_score}` : null;

function Thumb({ m }: { m: RecentMatch }) {
  const { t } = useLocale();
  const [src, setSrc] = useState<string | null | undefined>(m.has_thumbnail ? undefined : null);
  useEffect(() => {
    if (!m.has_thumbnail) { setSrc(null); return; }
    let live = true, url: string | null = null;
    void apiBlob(`/v1/videos/${m.video_id}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => { if (live) setSrc(null); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [m.video_id, m.has_thumbnail]);
  return (
    <span className="relative grid h-[54px] w-[96px] shrink-0 place-items-center overflow-hidden rounded border border-line bg-p0" data-thumb={src ? "frame" : src === null ? "none" : "loading"}>
      {src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
        : src === null ? <span title={t.desktop.noThumb} className="text-muted"><ImageOff className="h-4 w-4" aria-hidden /><span className="sr-only">{t.desktop.noThumb}</span></span> : null}
      <span className="t-mono absolute bottom-0.5 right-0.5 rounded-sm bg-black/75 px-1 text-[10px] leading-4">{clock(m.duration_us)}</span>
    </span>
  );
}

export function RecentMatches() {
  const { t } = useLocale();
  const [list, setList] = useState<RecentMatch[] | null | undefined>(undefined);   // undefined = loading, null = could not read
  const [reload, setReload] = useState(0);
  useEffect(() => { void api<RecentMatch[]>("/v1/overview/recent-matches").then(setList, () => setList(null)); }, [reload]);
  const failed = list === null;
  const empty = list !== undefined && !failed && list.length === 0;

  return (
    <section aria-label="Recent matches" className="vie-panel min-w-0" data-section="p01-s06" data-count={list ? String(list.length) : list === null ? "error" : "loading"}>
      <div className="vie-ph">
        <h2 className="t-panel">{t.body.home.recentMatches}</h2>
        <Link href="/library" className="t-small flex items-center gap-1 text-primary hover:underline" aria-label="View all matches in the Library">
          {t.body.home.viewAll}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <ul className="flex flex-col p-1.5">
        {list === undefined && <li className="t-small px-2 py-3 text-muted">{t.common.loading}</li>}
        {failed && (
          <li><button type="button" className="t-small w-full rounded px-2 py-3 text-left text-primary hover:bg-raised"
            onClick={() => { setList(undefined); setReload((r) => r + 1); }} aria-label="Recent matches could not be read. Retry">
            {t.body.home.matchesLoadFailed} · {t.body.home.tapRetry}</button></li>
        )}
        {empty && (
          <li className="px-2 py-3"><span className="t-body block">{t.body.home.noMatchesYet}</span><span className="t-small text-muted">{t.body.home.matchesListedHere}</span></li>
        )}
        {list?.slice(0, 4).map((m) => (
          <li key={m.video_id}>
            <Link href={`/videos/${m.video_id}/analyze`} className="flex items-center gap-3 rounded px-1.5 py-1.5 hover:bg-raised"
              aria-label={`${title(m)}, ${subtitle(m)}: open in the Analysis workspace`}>
              <Thumb m={m} />
              <span className="min-w-0 flex-1">
                <span className="t-body block truncate font-medium">{title(m)}</span>
                <span className="t-small block truncate text-muted">{subtitle(m)}</span>
              </span>
              {score(m) && <span className="t-metric text-[15px]">{score(m)}</span>}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
