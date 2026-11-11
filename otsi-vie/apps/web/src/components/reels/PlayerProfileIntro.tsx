"use client";
/**
 * Player Profile Intro (ADR-130): the 16:9 opening segment of a generated highlight reel, automatically placed at the very beginning,
 * before the first football clip — and its preview in the Reel Builder. It shows the selected player's ACTUAL profile: the identity from
 * the one registry, the profile a person recorded (marked "Entered by user", never guessed), and the engine's measured values only.
 * Anything not measured or not confirmed is null in the data and is shown as "Not measured" / "Not entered" / "Unconfirmed" — never
 * invented, never filled from the design reference, never a placeholder number (ADR-124: unknown beats wrong). Assists and Recent Form
 * are always not measured (the engine has no model for either); the UI renders that with the reason, never a number.
 */
import type { PlayerProfileIntro } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { FOOT_NAMES, POSITION_NAMES } from "@/components/players/PlayersList";
import { HeatPitch } from "@/components/workspace/HeatPitch";

/** the small provenance mark every user-entered field carries */
export function UserEntered() {
  const { t: dict } = useLocale();
  return <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 align-middle text-[10px] font-semibold text-amber-300">{dict.body.reels.enteredByUser}</span>;
}

const field = "text-sm";
const label = "text-xs text-muted";
const notMeasured = "text-sm text-muted";

function heightText(cm: number | null): string | null {
  if (cm === null) return null;
  const m = cm / 100;
  return `${Number.isInteger(m) ? m : m.toFixed(2)} m`;
}

function positionName(code: string | null, d: Dictionary): string | null {
  if (!code) return null;
  return POSITION_NAMES(d)[code] ?? code;
}

/** a pitch outline with no measured time in it: the shape is real, the data is not */
function PitchOutline() {
  const { t: dict } = useLocale();
  return (
    <svg viewBox="0 0 105 68" role="img" aria-label={dict.body.reels.pitchOutlineAria} className="h-full w-full">
      <rect x="1" y="1" width="103" height="66" fill="#1d5a2e" stroke="#d7efe0" strokeWidth="1" />
      <line x1="52.5" y1="1" x2="52.5" y2="67" stroke="#d7efe0" strokeWidth="1" />
      <circle cx="52.5" cy="34" r="9" fill="none" stroke="#d7efe0" strokeWidth="1" />
      <rect x="1" y="24" width="11" height="20" fill="none" stroke="#d7efe0" strokeWidth="1" />
      <rect x="93" y="24" width="11" height="20" fill="none" stroke="#d7efe0" strokeWidth="1" />
    </svg>
  );
}

function Stat({ name, value, note }: { name: string; value: string | null; note?: string }) {
  const { t: dict } = useLocale();
  return (
    <div className="rounded-ctl border border-line/70 bg-raised/40 p-3">
      <div className="text-2xl font-bold tabular-nums">{value ?? <span className={notMeasured}>{dict.body.reports.notMeasured}</span>}</div>
      <div className="text-xs text-muted">{name}</div>
      {note && <div className="mt-0.5 text-[11px] leading-snug text-muted">{note}</div>}
    </div>
  );
}

/** the reference layout in 16:9, from a PlayerProfileIntro object — no invented data anywhere */
export function PlayerProfileIntroView({ intro, onContinue }: { intro: PlayerProfileIntro; onContinue?: (() => void) | undefined }) {
  const { t: dict } = useLocale();
  const p = intro.profile;
  const d = p.details;
  const team = p.latest_team;
  const club = team?.team ?? d?.club_name ?? null;
  const clubFromRoster = !!team?.team;
  const position = positionName(team?.position ?? p.position, dict);
  const height = heightText(d?.height_cm ?? null);
  const weight = d?.weight_kg != null ? `${d.weight_kg} kg` : null;
  const foot = p.preferred_foot ? FOOT_NAMES(dict)[p.preferred_foot] ?? p.preferred_foot : null;
  const age = p.age != null ? `${p.age}${p.birth_date ? dict.body.reels.ageBorn.replace("{a}", p.birth_date) : ""}` : p.birth_date ? dict.body.reels.bornOnly.replace("{a}", p.birth_date) : null;
  const intl = d?.international_country_code
    ? { country: d.international_country_name ?? d.international_country_code, caps: d.international_caps, goals: d.international_goals }
    : null;
  const minutes = intro.stats.minutes_seen != null ? dict.body.reels.minutesSeen.replace("{a}", String(intro.stats.minutes_seen)) : null;
  return (
    <div data-profile-intro="" className="overflow-hidden rounded-card border border-line bg-panel text-ink">
      <div className="aspect-video w-full overflow-y-auto">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line/70 px-4 py-2">
          <span className="text-xs font-semibold tracking-wide text-muted">{dict.body.reels.introBreadcrumb}</span>
          {intro.verified ? (
            <span role="status" className="rounded-full border border-ok/60 bg-ok/15 px-3 py-1 text-xs font-semibold text-ok" title={intro.verified_rule}>
              {dict.body.reels.verifiedBadge}
            </span>
          ) : (
            <span role="status" className="rounded-full border border-amber-500/60 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300" title={intro.verified_rule}>
              {dict.body.reels.unconfirmedBadge}
            </span>
          )}
        </div>
        {!intro.verified && (
          <p className="border-b border-line/70 bg-amber-500/5 px-4 py-1.5 text-xs text-muted">{intro.verified_rule}</p>
        )}
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.5fr)]">
          <div>
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-ctl border border-line bg-raised/60">
              {d?.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.photo_url} alt={dict.body.reels.photoAlt.replace("{a}", intro.player.display_name)} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-muted">{dict.body.reels.noPhoto}</div>
              )}
              <span className="absolute left-2 top-2 rounded-full bg-ok/90 px-2 py-0.5 text-[11px] font-bold text-white">{dict.body.reels.targetPlayerBadge}</span>
              {d?.photo_url && <span className="absolute bottom-2 left-2"><UserEntered /></span>}
            </div>
            <p className="mt-1.5 text-xs text-muted">{p.nationality?.name ?? dict.body.reels.nationalityNotEntered}</p>
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold leading-tight">
              {intro.player.display_name}{" "}
              {team?.jersey_number != null && <span className="ml-1 rounded bg-primary px-2 py-0.5 align-middle text-lg font-bold text-white">#{team.jersey_number}</span>}
            </h2>
            <p className="text-sm text-muted">{position ?? dict.body.reels.positionNotEntered}</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div><dt className={label}>OTSI PIN</dt>
                <dd className="font-semibold text-ok">{intro.player.canonical_otsi_id ?? <span className="font-normal text-muted">{dict.body.reels.pinUnconfirmed}</span>}</dd></div>
              <div><dt className={label}>{dict.body.reels.currentClub}</dt>
                <dd className={field}>{club ?? <span className={notMeasured}>{dict.body.reels.notEntered}</span>}{club && !clubFromRoster && <UserEntered />}</dd></div>
              <div><dt className={label}>{dict.body.players.nationality}</dt>
                <dd className={field}>{p.nationality?.name ?? <span className={notMeasured}>{dict.body.reels.notEntered}</span>}</dd></div>
              <div><dt className={label}>{dict.body.reels.ageLabel}</dt>
                <dd className={field}>{age ?? <span className={notMeasured}>{dict.body.reels.notEntered}</span>}</dd></div>
              <div><dt className={label}>{dict.body.reels.heightWeightLabel}</dt>
                <dd className={field}>
                  {height ?? <span className={notMeasured}>{dict.body.reels.notEntered}</span>}{height && weight ? " / " : ""}{weight ?? (height ? "" : <span className={notMeasured}>{dict.body.reels.notEntered}</span>)}
                  {(height || weight) && <UserEntered />}
                </dd></div>
              <div><dt className={label}>{dict.body.reels.preferredFootLabel}</dt>
                <dd className={field}>{foot ?? <span className={notMeasured}>{dict.body.reels.notEntered}</span>}</dd></div>
            </dl>
          </div>
          <div className="min-w-0">
            <h3 className="mb-2 text-sm font-semibold">{dict.body.reels.keyStats}</h3>
            <div className="grid grid-cols-2 gap-2">
              <Stat name={dict.body.reels.statGames} value={intro.stats.games_analysed != null ? String(intro.stats.games_analysed) : null} />
              <Stat name={dict.body.reels.statMinutes} value={minutes} note={dict.body.reels.minutesSeenNote} />
              <Stat name={dict.body.reels.statGoals} value={intro.stats.goals != null ? String(intro.stats.goals) : null} />
              <Stat name={dict.body.reels.statAssists} value={null} note={intro.stats.assists_reason} />
            </div>
            <p className="mt-1.5 text-[11px] text-muted">{intro.stats.basis}</p>
            <h3 className="mb-1.5 mt-4 text-sm font-semibold">{dict.body.reels.strengths} {d && d.strengths.length > 0 && <UserEntered />}</h3>
            {d && d.strengths.length > 0 ? (
              <ul className="space-y-1 text-sm">{d.strengths.map((s) => <li key={s}>✓ {s}</li>)}</ul>
            ) : (
              <p className={notMeasured}>{dict.body.reels.notEntered}</p>
            )}
            <h3 className="mb-1.5 mt-4 text-sm font-semibold">{dict.body.reports.heatmap} <span className="font-normal text-muted">{dict.body.reels.heatmapMainPos.replace("{a}", position ?? dict.body.reels.notEntered)}</span></h3>
            <div className="aspect-[105/68] w-full overflow-hidden rounded-ctl border border-line">
              {intro.heat ? <HeatPitch zones={intro.heat} label={dict.body.reels.heatMapOf.replace("{a}", intro.player.display_name)} /> : <PitchOutline />}
            </div>
            {!intro.heat && <p className="mt-1 text-[11px] text-muted">{dict.body.reports.notMeasured}</p>}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 border-t border-line/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <h3 className="mb-1 text-sm font-semibold">{dict.body.reels.summary} {d?.summary && <UserEntered />}</h3>
            {d?.summary ? <p className="text-sm leading-snug">{d.summary}</p> : <p className={notMeasured}>{dict.body.reels.notEntered}</p>}
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">{dict.body.reels.recentForm}</h3>
            {intro.recent_form.ratings ? (
              <div className="flex gap-1.5">{intro.recent_form.ratings.map((r, i) => (
                <span key={i} className="flex h-10 w-10 items-center justify-center rounded-full border border-ok/60 text-sm font-bold tabular-nums">{r.toFixed(1)}</span>
              ))}</div>
            ) : (
              <p className={notMeasured}>{dict.body.reports.notMeasured}</p>
            )}
            <p className="mt-1 text-[11px] text-muted">{intro.recent_form.reason}</p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">{dict.body.reels.clubLeague}</h3>
            <p className={field}>{club ?? <span className={notMeasured}>{dict.body.reels.notEntered}</span>}{club && !clubFromRoster && <UserEntered />}</p>
            <p className={field}>{d?.league ?? <span className={notMeasured}>{dict.body.reels.notEntered}</span>}{d?.league && <UserEntered />}</p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">{dict.body.reels.intlCareer} {intl && <UserEntered />}</h3>
            {intl ? (
              <>
                <p className={field}>{intl.country}</p>
                <p className="text-sm text-muted">
                  {intl.caps != null ? dict.body.reels.capsLine.replace("{a}", String(intl.caps)) : dict.body.reels.capsNotEntered} | {intl.goals != null ? dict.body.reels.goalsLine.replace("{a}", String(intl.goals)) : dict.body.reels.goalsNotEntered}
                </p>
              </>
            ) : (
              <p className={notMeasured}>{dict.body.reels.notEntered}</p>
            )}
          </div>
        </div>
      </div>
      {onContinue && (
        <div className="flex items-center justify-between gap-3 border-t border-line/70 px-4 py-3">
          <p className="text-xs text-ok">{dict.body.reels.profileLoaded}</p>
          <button type="button" onClick={onContinue}
            className="rounded-ctl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90">{dict.body.reels.continueToReel}</button>
        </div>
      )}
    </div>
  );
}

/** fetches GET /v1/players/:id/profile-intro (optional ?reel_id= for the reel-aware badge) and renders the preview */
export function PlayerProfileIntroPanel({ playerId, reelId, onContinue }: { playerId: string; reelId?: string | undefined; onContinue?: (() => void) | undefined }) {
  const { t: dict } = useLocale();
  const [intro, setIntro] = useState<PlayerProfileIntro | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setIntro(null); setFailed(false);
    const q = reelId ? `?reel_id=${encodeURIComponent(reelId)}` : "";
    void api<PlayerProfileIntro>(`/v1/players/${playerId}/profile-intro${q}`).then(
      (i) => { if (live) setIntro(i); },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
  }, [playerId, reelId]);
  if (failed) return <p role="alert" className="text-sm text-danger">{dict.body.reels.loadProfileFailed}</p>;
  if (!intro) return <p className="text-sm text-muted">{dict.body.reels.loadingProfile}</p>;
  return <PlayerProfileIntroView intro={intro} onContinue={onContinue} />;
}

/** the intro preview as the first step of the Reel Builder flow: a dialog over the stage, "Continue to Reel" advances past it */
export function ProfileIntroDialog({ playerId, reelId, open, onContinue, onClose }: {
  playerId: string; reelId?: string | undefined; open: boolean; onContinue(): void; onClose(): void;
}) {
  const { t: dict } = useLocale();
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={dict.body.reels.profileIntroLabel} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-[min(1100px,96vw)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <PlayerProfileIntroPanel playerId={playerId} reelId={reelId} onContinue={onContinue} />
      </div>
    </div>
  );
}
