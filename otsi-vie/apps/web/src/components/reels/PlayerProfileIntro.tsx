"use client";
/**
 * Player Profile Intro (ADR-130): the 16:9 opening segment of a generated highlight reel, automatically placed at the very beginning,
 * before the first football clip — and its preview in the Reel Builder. It shows the selected player's ACTUAL profile: the identity from
 * the one registry, the profile a person recorded (marked "Entered by user", never guessed), and the engine's measured values only.
 * Anything not measured or not confirmed is null in the data and is shown as "Not measured" / "Not entered" / "Unconfirmed" — never
 * invented, never filled from the design reference, never a placeholder number (ADR-124: unknown beats wrong). Assists and Recent Form
 * are always not measured (the engine has no model for either); the UI renders that with the reason, never a number.
 *
 * SOT UI rebuild Page 16 of 31 (ProfileIntro.dc.html): the intro is a fixed 1600×900 graphic — three columns (photo 400px | profile
 * 1fr | heatmap 440px) over a footer bar, on a dark canvas with a faint pitch outline behind it. The view renders that exact canvas at
 * 1600×900 and scales it to the width it is given (a ResizeObserver measures the wrapper), so the proportions and the SOT's type sizes
 * hold at any preview width. The SOT's type is Inter; the app's lock is Segoe UI, but this is a graphic, so the SOT's Inter stack is
 * used here, as the mock specifies.
 *
 * What maps where (read before editing):
 *   - Photo: the player's recorded photo (d.photo_url) when one exists; otherwise the person icon + "No photo yet · rights recorded on
 *     upload". A photo is a user-entered asset, so it carries the "Entered by user" mark.
 *   - Badge: "Player Identity Verified" + the OTSI PIN when intro.verified is true (the registry + a confirmed track + the reel's targets
 *     still current, PROFILE_INTRO_VERIFIED_RULE). Otherwise the amber "Identity unconfirmed" badge with the rule as its title.
 *   - Centre: "Player profile" + the jersey number (accent, mono) + the name + "position · club". The dl is Nationality / Age · Date of
 *     birth / Preferred foot / Height / Weight / Main position — Main position is the position the engine measured from his tracks, which
 *     is not the same as the team sheet's position; it is "Not measured" until the engine measures it.
 *   - Stat tiles: Videos analysed / Minutes on camera / Goals / Assists — the measured values only. Assists is always null (no
 *     pass-to-goal linkage), so it always reads "Not measured" with the reason.
 *   - Strengths / Summary / International / Club & league: the recorded profile, "Not set" where nothing was entered. The club comes
 *     from the team sheet first (ROSTER), then the recorded club name (USER_ENTERED, marked as entered).
 *   - Heatmap: the measured heat (HeatPitch) when intro.heat exists; otherwise the SOT's dark pitch outline + "Heatmap not measured".
 *     The header shows the video count the heat stands on.
 *   - Footer: the OTSI mark + "Measured by the engine. Where something was not measured, it says so." + the reel progress bar +
 *     "Continue to Reel". The progress bar is the reel's playback position; the preview is not playing, so it takes the `progress` prop
 *     (0–1), defaulting to the SOT mock's 0.32. A caller that knows the real playback position passes it.
 */
import type { PlayerProfileIntro } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { FOOT_NAMES, POSITION_NAMES } from "@/components/players/PlayersList";
import { HeatPitch } from "@/components/workspace/HeatPitch";

/** the small provenance mark every user-entered field carries */
export function UserEntered() {
  const { t: dict } = useLocale();
  return <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 align-middle text-xs font-normal text-amber-300">{dict.body.reels.enteredByUser}</span>;
}

function heightText(cm: number | null): string | null {
  if (cm === null) return null;
  const m = cm / 100;
  return `${Number.isInteger(m) ? m : m.toFixed(2)} m`;
}

function positionName(code: string | null, d: Dictionary): string | null {
  if (!code) return null;
  return POSITION_NAMES(d)[code] ?? code;
}

/** the SOT's dark pitch outline (no measured time in it): the shape is real, the data is not */
function PitchOutline() {
  const { t: dict } = useLocale();
  return (
    <svg viewBox="0 0 105 68" role="img" aria-label={dict.body.reels.pitchOutlineAria} style={{ width: "100%", height: "auto", display: "block" }}>
      <rect x=".5" y=".5" width="104" height="67" rx="1" fill="#0E1512" stroke="#2A3A31" strokeWidth=".5" />
      <path d="M52.5 .5v67" stroke="#2A3A31" strokeWidth=".5" />
      <circle cx="52.5" cy="34" r="9.15" fill="none" stroke="#2A3A31" strokeWidth=".5" />
      <rect x=".5" y="13.85" width="16.5" height="40.3" fill="none" stroke="#2A3A31" strokeWidth=".5" />
      <rect x="88" y="13.85" width="16.5" height="40.3" fill="none" stroke="#2A3A31" strokeWidth=".5" />
    </svg>
  );
}

const notMeasured = { fontStyle: "italic" as const, color: "var(--mu)" };

/** one stat tile: the label + the measured number, or "Not measured" with the reason */
function StatTile({ name, value, note }: { name: string; value: string | null; note?: string }) {
  const { t: dict } = useLocale();
  return (
    <div style={{ padding: "16px 18px", borderRadius: 12, background: "var(--p0)", border: "1px solid var(--ln)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span className="eb" style={{ fontSize: 12 }}>{name}</span>
      {value != null ? (
        <span className="mono" style={{ fontSize: 32, lineHeight: 1 }}>{value}</span>
      ) : (
        <span style={{ fontSize: 15, ...notMeasured }}>{dict.body.reports.notMeasured}{note ? ` — ${note}` : ""}</span>
      )}
    </div>
  );
}

/** the SOT's 1600×900 canvas, scaled to the width it is given */
function ScaledIntro({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.max(0.1, el.clientWidth / 1600));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} data-profile-intro="" style={{ width: "100%", height: 900 * scale, overflow: "hidden", position: "relative" }}>
      <div style={{ width: 1600, height: 900, position: "absolute", top: 0, left: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

/** the reference layout in 16:9, from a PlayerProfileIntro object — no invented data anywhere */
export function PlayerProfileIntroView({ intro, onContinue, progress = 0.32 }: { intro: PlayerProfileIntro; onContinue?: (() => void) | undefined; progress?: number }) {
  const { t: dict } = useLocale();
  const d = dict.body.reels;
  const p = intro.profile;
  const det = p.details;
  const team = p.latest_team;
  const club = team?.team ?? det?.club_name ?? null;
  const clubFromRoster = !!team?.team;
  const position = positionName(team?.position ?? p.position, dict);
  const height = heightText(det?.height_cm ?? null);
  const weight = det?.weight_kg != null ? `${det.weight_kg} kg` : null;
  const foot = p.preferred_foot ? FOOT_NAMES(dict)[p.preferred_foot] ?? p.preferred_foot : null;
  const age = p.age != null ? String(p.age) : null;
  const ageDob = age != null ? (p.birth_date ? `${age} · ${p.birth_date}` : age) : (p.birth_date ?? null);
  const intl = det?.international_country_code
    ? { country: det.international_country_name ?? det.international_country_code, caps: det.international_caps, goals: det.international_goals }
    : null;
  const videos = intro.stats.games_analysed;
  return (
    <div className="overflow-hidden rounded-card border border-line bg-panel text-ink">
      <ScaledIntro>
        <div style={{ width: 1600, height: 900, position: "relative", overflow: "hidden", background: "#07080A", color: "var(--tx)", fontFamily: "Inter, system-ui, sans-serif", display: "grid", gridTemplateColumns: "400px minmax(0, 1fr) 440px", gridTemplateRows: "minmax(0, 1fr) 84px", columnGap: 48, padding: "56px 64px 0" }}>
          <svg viewBox="0 0 680 440" aria-hidden="true" style={{ position: "absolute", right: -180, top: -120, width: 980, opacity: .22 }}>
            <g fill="none" stroke="#24342C" strokeWidth="1.2">
              <rect x="10" y="10" width="660" height="420" rx="4" /><path d="M340 10v420" /><circle cx="340" cy="220" r="62" />
              <rect x="562" y="118" width="108" height="204" />
            </g>
          </svg>

          {/* left: photo + identity badge */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 18, minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, borderRadius: 14, background: "var(--p1)", border: "1px solid var(--ln)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "var(--mu)", overflow: "hidden" }}>
              {det?.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={det.photo_url} alt={d.photoAlt.replace("{a}", intro.player.display_name)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <>
                  <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 56, height: 56, strokeWidth: 1.1, fill: "none", stroke: "currentColor" }}>
                    <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
                  </svg>
                  <span style={{ fontSize: 14 }}>{d.piNoPhoto}</span>
                </>
              )}
            </div>
            {det?.photo_url && <span style={{ position: "absolute", left: 12, bottom: 76 }}><UserEntered /></span>}
            <div role="status" title={intro.verified ? intro.verified_rule : intro.verified_rule}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 12, border: `1px solid ${intro.verified ? "rgba(43,212,176,.45)" : "rgba(237,181,79,.45)"}`, background: intro.verified ? "rgba(43,212,176,.08)" : "rgba(237,181,79,.08)" }}>
              <span style={{ width: 36, height: 36, borderRadius: "50%", background: intro.verified ? "var(--ac)" : "var(--amber)", color: "var(--ac-ink)", display: "grid", placeItems: "center" }}>
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 20, height: 20, strokeWidth: 2.2, fill: "none", stroke: "currentColor" }}>
                  <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" />
                </svg>
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{intro.verified ? d.piVerified : d.unconfirmedBadge}</span>
                <span className="mono" style={{ fontSize: 13, color: intro.verified ? "var(--ac)" : "var(--amber)" }}>
                  {intro.player.canonical_otsi_id ?? d.pinUnconfirmed}
                </span>
              </div>
            </div>
          </div>

          {/* centre: profile + facts + stats + strengths */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 30, minWidth: 0, paddingTop: 6 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="eb" style={{ fontSize: 13, letterSpacing: ".16em", color: "var(--ac)" }}>{d.piPlayerProfile}</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
                {team?.jersey_number != null && <span className="mono" style={{ fontSize: 52, fontWeight: 500, lineHeight: 1, color: "var(--ac)" }}>{team.jersey_number}</span>}
                <h1 style={{ fontSize: 44, fontWeight: 600, lineHeight: 1.05, letterSpacing: "-.03em", whiteSpace: "nowrap" }}>{intro.player.display_name}</h1>
              </div>
              <span style={{ fontSize: 20, color: "var(--tx2)" }}>{[position, club].filter(Boolean).join(" · ") || d.notEntered}</span>
            </div>

            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "22px 28px", padding: "24px 0", borderTop: "1px solid var(--ln)", borderBottom: "1px solid var(--ln)" }}>
              <div><dt className="eb" style={{ fontSize: 12 }}>{d.piNationality}</dt><dd style={{ margin: "6px 0 0", fontSize: 18 }}>{p.nationality?.name ?? <span style={notMeasured}>{d.notEntered}</span>}</dd></div>
              <div><dt className="eb" style={{ fontSize: 12 }}>{d.piAgeDob}</dt><dd style={{ margin: "6px 0 0", fontSize: 18, whiteSpace: "nowrap" }}>{ageDob ?? <span style={notMeasured}>{d.notEntered}</span>}</dd></div>
              <div><dt className="eb" style={{ fontSize: 12 }}>{d.piPreferredFoot}</dt><dd style={{ margin: "6px 0 0", fontSize: 18 }}>{foot ?? <span style={notMeasured}>{d.notEntered}</span>}</dd></div>
              <div><dt className="eb" style={{ fontSize: 12 }}>{d.piHeight}</dt><dd className="mono" style={{ margin: "6px 0 0", fontSize: 18 }}>{height ?? <span style={notMeasured}>{d.notEntered}</span>}{height && <UserEntered />}</dd></div>
              <div><dt className="eb" style={{ fontSize: 12 }}>{d.piWeight}</dt><dd className="mono" style={{ margin: "6px 0 0", fontSize: 18 }}>{weight ?? <span style={notMeasured}>{d.notEntered}</span>}{weight && <UserEntered />}</dd></div>
              <div><dt className="eb" style={{ fontSize: 12 }}>{d.piMainPosition}</dt><dd style={{ margin: "6px 0 0", fontSize: 17, ...notMeasured }}>{dict.body.reports.notMeasured}</dd></div>
            </dl>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <StatTile name={d.piVideosAnalysed} value={videos != null ? String(videos) : null} />
              <StatTile name={d.piMinutesOnCamera} value={intro.stats.minutes_seen != null ? String(intro.stats.minutes_seen) : null} />
              <StatTile name={d.piGoals} value={intro.stats.goals != null ? String(intro.stats.goals) : null} />
              <StatTile name={d.piAssists} value={null} note={intro.stats.assists_reason} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span className="eb" style={{ fontSize: 12 }}>{d.piStrengths}{det && det.strengths.length > 0 && <UserEntered />}</span>
              {det && det.strengths.length > 0 ? (
                <ul style={{ fontSize: 15, margin: 0, paddingLeft: 18 }}>{det.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
              ) : (
                <span style={{ fontSize: 15, ...notMeasured }}>{d.piNotSet}</span>
              )}
            </div>
          </div>

          {/* right: heatmap + summary + form / international + club */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
            <div style={{ padding: 18, borderRadius: 12, background: "var(--p0)", border: "1px solid var(--ln)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="eb" style={{ fontSize: 12 }}>{d.piHeatmapMainPos}</span>
                <span className="mono sm mu">{d.piVideosCount.replace("{a}", String(videos ?? 0))}</span>
              </div>
              {intro.heat ? <HeatPitch zones={intro.heat} label={d.heatMapOf.replace("{a}", intro.player.display_name)} /> : <PitchOutline />}
              {!intro.heat && <span style={{ alignSelf: "center", fontSize: 14, ...notMeasured }}>{d.piHeatmapNotMeasured}</span>}
            </div>
            <div style={{ padding: 18, borderRadius: 12, background: "var(--p0)", border: "1px solid var(--ln)", display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="eb" style={{ fontSize: 12 }}>{d.piSummary}{det?.summary && <UserEntered />}</span>
              {det?.summary ? <p style={{ fontSize: 15, margin: 0 }}>{det.summary}</p> : <p style={{ fontSize: 15, margin: 0, ...notMeasured }}>{d.piNotSet}</p>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
              <div style={{ padding: "16px 18px", borderRadius: 12, background: "var(--p0)", border: "1px solid var(--ln)", display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="eb" style={{ fontSize: 12 }}>{d.piRecentForm}</span>
                <span style={{ fontSize: 15, ...notMeasured }}>{dict.body.reports.notMeasured}</span>
              </div>
              <div style={{ padding: "16px 18px", borderRadius: 12, background: "var(--p0)", border: "1px solid var(--ln)", display: "flex", flexDirection: "column", gap: 8 }}>
                <span className="eb" style={{ fontSize: 12 }}>{d.piInternational}{intl && <UserEntered />}</span>
                {intl ? (
                  <span style={{ fontSize: 15 }}>{intl.country}{intl.caps != null ? ` · ${d.capsLine.replace("{a}", String(intl.caps))}` : ""}</span>
                ) : (
                  <span style={{ fontSize: 15, ...notMeasured }}>{d.piNotSet}</span>
                )}
              </div>
            </div>
            <div style={{ padding: "16px 18px", borderRadius: 12, background: "var(--p0)", border: "1px solid var(--ln)", display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ width: 40, height: 40, borderRadius: 8, background: "var(--p2)", border: "1px solid var(--ln2)", flex: "none" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                <span className="eb" style={{ fontSize: 12 }}>{d.piClubLeague}</span>
                <span style={{ fontSize: 15 }}>
                  <span>{club ?? <span style={notMeasured}>{d.notEntered}</span>}{club && !clubFromRoster && <UserEntered />}</span>
                  {" · "}
                  <span>{det?.league ? <>{det.league}<UserEntered /></> : <span style={notMeasured}>{d.piLeagueNotSet}</span>}</span>
                </span>
              </div>
            </div>
          </div>

          {/* footer: mark + measured-by + progress + continue */}
          <div style={{ gridColumn: "1 / -1", position: "relative", display: "flex", alignItems: "center", gap: 24, margin: "0 -64px", padding: "0 64px", borderTop: "1px solid var(--p2)", background: "var(--bg)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontWeight: 600, letterSpacing: ".08em", fontSize: 16 }}>OTSI</span>
              <span style={{ color: "var(--mu)", fontWeight: 500, letterSpacing: ".14em", fontSize: 12 }}>VIE</span>
            </span>
            <span style={{ fontSize: 13, color: "var(--mu)" }}>{d.piMeasuredBy}</span>
            <span style={{ flex: 1, height: 2, borderRadius: 1, background: "var(--p2)", overflow: "hidden" }}>
              <span style={{ display: "block", width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`, height: "100%", background: "var(--ac)" }} />
            </span>
            {onContinue ? (
              <button type="button" onClick={onContinue} className="btn pri lg" style={{ height: 48, padding: "0 24px", fontSize: 15 }}>
                {d.piContinueToReel}
                <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </button>
            ) : (
              <Link href={`/players?player=${intro.player.player_id}`} className="btn pri lg" style={{ height: 48, padding: "0 24px", fontSize: 15, textDecoration: "none" }}>
                {dict.body.reelstage.openPlayerProfile}
              </Link>
            )}
          </div>
        </div>
      </ScaledIntro>
      {!intro.verified && (
        <p className="border-t border-line/70 bg-amber-500/5 px-4 py-1.5 t-small text-muted">{intro.verified_rule}</p>
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
  if (failed) return <p role="alert" className="t-body text-danger">{dict.body.reels.loadProfileFailed}</p>;
  if (!intro) return <p className="t-body text-muted">{dict.body.reels.loadingProfile}</p>;
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
