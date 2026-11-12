"use client";
/**
 * The Players list — SOT UI rebuild Page 18 of 31 (Players.dc.html).
 *
 * The SOT's page: a header (Players, search "Search name, number or PIN", identity filter All / Confirmed / Unconfirmed), a player
 * table (OTSI PIN | Player | No. | Club | Pos. | Tracks | Coverage | Identity), a Profile Intro preview (a compact 16:9 card of the
 * selected player, from GET /v1/players/:id/profile-intro), and a right inspector that edits the selected player's profile in place
 * (Basics, Club & international, Summary, Strengths, photo) with Discard / Save profile. One Save profile writes everything that
 * changed: the basics through PATCH /v1/players/:id/profile, the intro details through PATCH /v1/players/:id/profile-details.
 *
 * A person records what the video cannot tell: nationality, preferred foot, birth date (the age is computed) and usual position. Team and
 * shirt number are read from the latest match team sheet, where they are recorded per match (a team sheet's position, for that match, is
 * shown first where there is one). Reels and reports show what is saved here; nothing is guessed. Only the organization that created a
 * player can change the profile (the registry is shared). Tracks and Coverage in the table come from each player's measures
 * (GET /v1/players/:id/measures); a failed read shows "—", never a guess.
 */
import type { BrandRightsBasis, Country, PlayerListEntry, PlayerMeasures, PlayerProfile, PlayerProfileDetails, PlayerProfileIntro, UpdatePlayerProfileDetailsRequest } from "@otsi-vie/contracts";
import { BRAND_MAX_BYTES } from "@otsi-vie/contracts";
import { Camera, User } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";

export const POSITION_NAMES = (d: Dictionary): Record<string, string> => ({
  GK: d.body.players.posGk, RB: d.body.players.posRb, CB: d.body.players.posCb, LB: d.body.players.posLb, RWB: d.body.players.posRwb, LWB: d.body.players.posLwb, DM: d.body.players.posDm,
  CM: d.body.players.posCm, AM: d.body.players.posAm, RM: d.body.players.posRm, LM: d.body.players.posLm, RW: d.body.players.posRw, LW: d.body.players.posLw,
  CF: d.body.players.posCf, ST: d.body.players.posSt, DF: d.body.players.posDf, MF: d.body.players.posMf, FW: d.body.players.posFw,
});
export const FOOT_NAMES = (d: Dictionary): Record<string, string> => ({ LEFT: d.body.players.footLeft, RIGHT: d.body.players.footRight, BOTH: d.body.players.footBoth, UNKNOWN: d.body.players.footUnknown });

type Draft = { nationality: string; foot: string; birth: string; position: string };
const draftOf = (p: PlayerProfile): Draft => ({ nationality: p.nationality?.code ?? "", foot: p.preferred_foot ?? "", birth: p.birth_date ?? "", position: p.position ?? "" });

/** base64url, as the brand music / video uploads send it in `x-asset-meta` (MusicPicker, ReelExtras) */
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const RIGHTS_BASIS = (d: Dictionary): [BrandRightsBasis, string][] => [["OWN_BRAND", d.body.players.rightsOwnPhoto], ["LICENSED", d.body.players.rightsLicensed],
  ["FREE_LICENCE", d.body.players.rightsFreeLicence], ["PERMISSION", d.body.players.rightsPermission]];

/** the profile-details form, as the person typed it (strings: an empty field clears to null, never to 0 or a guess) */
export type DetailsDraft = { height: string; weight: string; strengths: string[]; summary: string; club: string; league: string; country: string; caps: string; goals: string };
export const draftDetailsOf = (det: PlayerProfileDetails | null): DetailsDraft => ({
  height: det?.height_cm != null ? String(det.height_cm) : "",
  weight: det?.weight_kg != null ? String(det.weight_kg) : "",
  strengths: det?.strengths.length ? [...det.strengths] : [""],
  summary: det?.summary ?? "",
  club: det?.club_name ?? "",
  league: det?.league ?? "",
  country: det?.international_country_code ?? "",
  caps: det?.international_caps != null ? String(det.international_caps) : "",
  goals: det?.international_goals != null ? String(det.international_goals) : "",
});

/** only the fields that changed (or were cleared) go out: a field left out is unchanged, an empty one clears to null.
 *  Strengths are trimmed, empties dropped, capped at 6; clearing them all sends null. */
export function buildDetailsPatch(saved: PlayerProfileDetails | null, draft: DetailsDraft): UpdatePlayerProfileDetailsRequest {
  const body: UpdatePlayerProfileDetailsRequest = {};
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
  const str = (v: string): string | null => (v.trim() === "" ? null : v.trim());
  if (num(draft.height) !== (saved?.height_cm ?? null)) body.height_cm = num(draft.height);
  if (num(draft.weight) !== (saved?.weight_kg ?? null)) body.weight_kg = num(draft.weight);
  const strengths = draft.strengths.map((x) => x.trim()).filter(Boolean).slice(0, 6);
  if (JSON.stringify(strengths) !== JSON.stringify(saved?.strengths ?? [])) body.strengths = strengths.length ? strengths : null;
  if (str(draft.summary) !== (saved?.summary ?? null)) body.summary = str(draft.summary);
  if (str(draft.club) !== (saved?.club_name ?? null)) body.club_name = str(draft.club);
  if (str(draft.league) !== (saved?.league ?? null)) body.league = str(draft.league);
  if (str(draft.country) !== (saved?.international_country_code ?? null)) body.international_country_code = str(draft.country);
  if (num(draft.caps) !== (saved?.international_caps ?? null)) body.international_caps = num(draft.caps);
  if (num(draft.goals) !== (saved?.international_goals ?? null)) body.international_goals = num(draft.goals);
  return body;
}

/** the compact 16:9 Profile Intro preview for the selected player, from GET /v1/players/:id/profile-intro */
function IntroPreview({ entry }: { entry: PlayerListEntry | null }) {
  const { t: dict } = useLocale();
  const [intro, setIntro] = useState<PlayerProfileIntro | null | undefined>(undefined);
  useEffect(() => {
    setIntro(undefined);
    if (!entry) return;
    let live = true;
    void api<PlayerProfileIntro>(`/v1/players/${entry.player_id}/profile-intro`).then((x) => { if (live) setIntro(x); }, () => { if (live) setIntro(null); });
    return () => { live = false; };
  }, [entry]);
  const p = entry?.profile ?? null;
  const det = p?.details ?? null;
  const team = p?.latest_team ?? null;
  const pos = team?.position ?? p?.position ?? null;
  const height = det?.height_cm != null ? `${(det.height_cm / 100).toFixed(2)} m` : null;
  const weight = det?.weight_kg != null ? `${det.weight_kg} kg` : null;
  const minutes = intro?.stats.minutes_seen ?? null;
  const goals = intro?.stats.goals ?? null;
  return (
    <section className="vie-panel flex flex-1 flex-col" aria-labelledby="pl-intro-preview">
      <div className="vie-ph">
        <h2 id="pl-intro-preview" className="t-panel">{dict.body.players.plIntroPreview}</h2>
        {entry && <Link href={`/reports/players/${entry.canonical_otsi_id ?? entry.player_id}`} className="t-small text-primary hover:underline">{dict.body.players.plOpenIntro}</Link>}
      </div>
      <div className="flex flex-1 items-center justify-center p-3.5">
        {!entry ? (
          <p className="t-body text-muted">{dict.body.players.noPlayersYet}</p>
        ) : intro === undefined ? (
          <p className="t-body text-muted">{dict.common.loading}</p>
        ) : intro === null ? (
          <p role="alert" className="t-body text-danger">{dict.body.reports.playerLoadFailed}</p>
        ) : (
          <div className="grid w-full gap-5 rounded-ctl border border-line bg-canvas p-5" style={{ maxWidth: 680, aspectRatio: "16/9", gridTemplateColumns: "30% minmax(0, 1fr)" }}>
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-ctl border border-dashed border-line2 bg-panel text-muted">
              {det?.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={det.photo_url} alt={dict.body.players.photoAlt.replace("{a}", entry.display_name)} className="h-full w-full rounded-ctl object-cover" />
              ) : (
                <>
                  <User className="h-8 w-8" aria-hidden />
                  <span className="t-small">{dict.body.players.plNoPhoto}</span>
                </>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="eb">{dict.body.reels.piPlayerProfile}</span>
                <span className="t-section">#{team?.jersey_number ?? "—"} {entry.display_name}</span>
                <span className="t-small">{pos ? `${pos} · ` : ""}{team?.team ?? det?.club_name ?? ""}</span>
              </div>
              <dl className="m-0 grid grid-cols-3 gap-x-3.5 gap-y-2.5">
                <div><dt className="lab">{dict.body.players.nationality}</dt><dd className="m-0 mt-0.5">{p?.nationality?.name ?? "—"}</dd></div>
                <div><dt className="lab">{dict.body.players.plAgeDob}</dt><dd className="m-0 mt-0.5 font-mono">{p?.age != null && p?.birth_date ? `${p.age} · ${p.birth_date}` : "—"}</dd></div>
                <div><dt className="lab">{dict.body.players.plFoot}</dt><dd className="m-0 mt-0.5">{p?.preferred_foot ? FOOT_NAMES(dict)[p.preferred_foot]! : "—"}</dd></div>
                <div><dt className="lab">{dict.body.players.plHeight}</dt><dd className="m-0 mt-0.5 font-mono">{height ?? "—"}</dd></div>
                <div><dt className="lab">{dict.body.players.plWeight}</dt><dd className="m-0 mt-0.5 font-mono">{weight ?? "—"}</dd></div>
                <div><dt className="lab">{dict.body.reports.rpRecentForm}</dt><dd className="m-0 mt-0.5 italic text-muted">{dict.body.reports.notMeasured}</dd></div>
                <div><dt className="lab">{dict.body.players.plGoals}</dt><dd className="m-0 mt-0.5 font-mono">{goals ?? "—"}</dd></div>
                <div><dt className="lab">{dict.body.reports.rpAssists}</dt><dd className="m-0 mt-0.5 font-mono">{dict.body.reports.notMeasured}</dd></div>
                <div><dt className="lab">{dict.body.players.plOnCamera}</dt><dd className="m-0 mt-0.5 font-mono">{minutes != null ? `${minutes} min` : "—"}</dd></div>
              </dl>
              <p className="hint mt-auto">{dict.body.players.plFromSaved}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** the right inspector: edits the selected player's profile in place (Basics, Club & international, Summary, Strengths, photo) */
function ProfileEditor({ entry, countries, onSaved }: { entry: PlayerListEntry; countries: Country[]; onSaved(p: PlayerProfile): void }) {
  const { t: dict } = useLocale();
  const [d, setD] = useState<Draft>(draftOf(entry.profile));
  const [dd, setDd] = useState<DetailsDraft>(draftDetailsOf(entry.profile.details ?? null));
  const [strengthInput, setStrengthInput] = useState("");
  const [state, setState] = useState<{ busy?: boolean; ok?: string; err?: string }>({});
  useEffect(() => { setD(draftOf(entry.profile)); setDd(draftDetailsOf(entry.profile.details ?? null)); setStrengthInput(""); setState({}); }, [entry]);
  const savedDetails = entry.profile.details ?? null;
  const detailsPatch = buildDetailsPatch(savedDetails, dd);
  const detailsChanged = Object.keys(detailsPatch).length > 0;
  const saved = draftOf(entry.profile);
  const basicsChanged = d.nationality !== saved.nationality || d.foot !== saved.foot || d.birth !== saved.birth || d.position !== saved.position;
  const changed = basicsChanged || detailsChanged;
  const heightOk = dd.height.trim() === "" || (/^\d+$/.test(dd.height.trim()) && Number(dd.height) >= 100 && Number(dd.height) <= 250);
  const weightOk = dd.weight.trim() === "" || (!Number.isNaN(Number(dd.weight)) && Number(dd.weight) >= 30 && Number(dd.weight) <= 200);
  const capsOk = dd.caps.trim() === "" || (/^\d+$/.test(dd.caps.trim()) && Number(dd.caps) >= 0);
  const goalsOk = dd.goals.trim() === "" || (/^\d+$/.test(dd.goals.trim()) && Number(dd.goals) >= 0);
  const strengthsOk = dd.strengths.every((x) => x.length <= 60);
  const detailsError = !heightOk ? dict.body.players.heightError : !weightOk ? dict.body.players.weightError : !capsOk ? dict.body.players.capsError
    : !goalsOk ? dict.body.players.intlGoalsError : !strengthsOk ? dict.body.players.strengthsError : null;
  const can = entry.profile.editable;
  const discard = () => { setD(draftOf(entry.profile)); setDd(draftDetailsOf(entry.profile.details ?? null)); setStrengthInput(""); setState({}); };
  const save = async () => {
    setState({ busy: true });
    try {
      let p = entry.profile;
      if (basicsChanged) {
        const body: Record<string, string | boolean | null> = {};
        if (d.nationality !== saved.nationality) body.nationality = d.nationality || null;
        if (d.foot !== saved.foot) body.preferred_foot = d.foot || null;
        if (d.birth !== saved.birth) body.birth_date = d.birth || null;
        if (d.position !== saved.position) { body.position = d.position || null; body.confirm_role = true; }
        p = await api<PlayerProfile>(`/v1/players/${entry.player_id}/profile`, { method: "PATCH", json: body });
      }
      if (detailsChanged) {
        p = await api<PlayerProfile>(`/v1/players/${entry.player_id}/profile-details`, { method: "PATCH", json: detailsPatch });
      }
      onSaved(p); setState({ ok: dict.body.players.detailsSaved });
    } catch (x) {
      setState({ err: x instanceof ApiProblem ? x.message : dict.body.players.couldNotSave });
    }
  };
  // the player's photo (ADR-130): raw file bytes, like the brand music / video uploads — never multipart FormData.
  // POST /v1/players/:id/photo, PNG or JPEG, at most 512 KB (the brand-logo limit); the answer is the updated profile.
  const [photo, setPhoto] = useState<File | null>(null);
  const [holder, setHolder] = useState("");
  const [basis, setBasis] = useState<BrandRightsBasis | "">("");
  const [confirmRights, setConfirmRights] = useState(false);
  const [photoState, setPhotoState] = useState<{ busy?: boolean; ok?: string; err?: string }>({});
  const photoErr = photo && photo.size > BRAND_MAX_BYTES ? dict.body.players.photoTooBig
    : photo && !/^image\/(png|jpeg)$/.test(photo.type) ? dict.body.players.photoTypeError : null;
  const photoReady = !!photo && !photoErr && holder.trim().length >= 2 && !!basis && confirmRights && !photoState.busy;
  const uploadPhoto = async () => {
    if (!photo || !basis) return;
    setPhotoState({ busy: true });
    try {
      const meta = b64url(JSON.stringify({ rights_holder: holder.trim(), rights_basis: basis, confirm_rights: true }));
      const p = await api<PlayerProfile>(`/v1/players/${entry.player_id}/photo`, { method: "POST", body: photo, headers: { "content-type": photo.type, "x-asset-meta": meta } });
      onSaved(p); setPhoto(null); setHolder(""); setBasis(""); setConfirmRights(false);
      setPhotoState({ ok: dict.body.players.photoSaved });
    } catch (x) {
      setPhotoState({ err: x instanceof ApiProblem ? x.message : dict.body.players.photoUploadFailed });
    }
  };
  const field = "in";
  const t = entry.profile.latest_team;
  const pos = t?.position ?? entry.profile.position ?? "";
  const confirmed = !!entry.canonical_otsi_id;
  const addStrength = () => {
    const s = strengthInput.trim();
    if (!s || dd.strengths.filter(Boolean).length >= 6) return;
    setDd({ ...dd, strengths: [...dd.strengths.filter(Boolean), s, ""].slice(0, 6) });
    setStrengthInput("");
  };
  return (
    <aside className="insp" aria-label={dict.body.players.plSaveProfile} style={{ flex: "0 0 420px", maxWidth: 420 }}>
      <div className="flex items-center gap-3.5 border-b border-line p-3.5 px-4">
        <label className="grid h-14 w-14 shrink-0 cursor-pointer place-items-center rounded-[10px] border border-dashed border-line2 bg-raised text-muted hover:border-primary hover:text-primary">
          <input type="file" accept="image/png,image/jpeg" aria-label={dict.body.players.uploadPhoto} disabled={!can} className="hidden"
            onChange={(x) => setPhoto(x.target.files?.[0] ?? null)} />
          {savedDetails?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={savedDetails.photo_url} alt={dict.body.players.photoAlt.replace("{a}", entry.display_name)} className="h-full w-full rounded-[10px] object-cover" />
          ) : (
            <Camera className="h-6 w-6" aria-hidden />
          )}
        </label>
        <div className="min-w-0 flex-1">
          <span className="t-section block truncate">{entry.display_name}</span>
          <span className="t-small text-primary">{confirmed ? dict.body.players.plConfirmedPin.replace("{a}", entry.canonical_otsi_id!) : dict.body.players.provisional}</span>
          {!savedDetails?.photo_url && <span className="hint block">{dict.body.players.plPhotoRights}</span>}
        </div>
        <span className="vie-chip">{dict.body.players.plManualProfile}</span>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="sect">
          <span className="eb">{dict.body.players.plBasics}</span>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="field">
              <label className="lab" htmlFor="pl-pos">{dict.body.players.position}</label>
              <select id="pl-pos" value={d.position} disabled={!can} onChange={(x) => setD({ ...d, position: x.target.value })} className={field}>
                <option value="">{dict.body.players.notRecorded}</option>
                {Object.entries(POSITION_NAMES(dict)).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
              </select>
            </div>
            <div className="field">
              <span className="lab" id="pl-foot">{dict.body.players.preferredFoot}</span>
              <div className="seg f" role="group" aria-labelledby="pl-foot">
                {(["LEFT", "RIGHT", "BOTH"] as const).map((f) => (
                  <button key={f} type="button" disabled={!can} aria-pressed={d.foot === f} onClick={() => setD({ ...d, foot: f })} className={d.foot === f ? "on" : ""}>{FOOT_NAMES(dict)[f]}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="lab" htmlFor="pl-nat">{dict.body.players.nationality}</label>
              <select id="pl-nat" value={d.nationality} disabled={!can} onChange={(x) => setD({ ...d, nationality: x.target.value })} className={field}>
                <option value="">{dict.body.players.notRecorded}</option>
                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="lab" htmlFor="pl-dob">{dict.body.players.birthDate}{entry.profile.age !== null ? dict.body.players.ageSuffix.replace("{a}", String(entry.profile.age)) : ""}</label>
              <input id="pl-dob" type="date" value={d.birth} disabled={!can} max={new Date().toISOString().slice(0, 10)} min="1900-01-01"
                onChange={(x) => setD({ ...d, birth: x.target.value })} className={`${field} mono`} />
            </div>
            <div className="field">
              <label className="lab" htmlFor="pl-height">{dict.body.players.plHeight}</label>
              <div className="relative">
                <input id="pl-height" inputMode="numeric" value={dd.height} disabled={!can} placeholder={dict.body.players.heightExample}
                  onChange={(x) => setDd({ ...dd, height: x.target.value })} className={`${field} mono`} style={{ paddingRight: 36 }} />
                <span className="mu sm absolute right-2.5 top-2">cm</span>
              </div>
            </div>
            <div className="field">
              <label className="lab" htmlFor="pl-weight">{dict.body.players.plWeight}</label>
              <div className="relative">
                <input id="pl-weight" inputMode="decimal" value={dd.weight} disabled={!can} placeholder={dict.body.players.weightExample}
                  onChange={(x) => setDd({ ...dd, weight: x.target.value })} className={`${field} mono`} style={{ paddingRight: 36 }} />
                <span className="mu sm absolute right-2.5 top-2">kg</span>
              </div>
            </div>
          </div>
          {!can && <p className="t-small">{dict.body.players.readOnly}</p>}
          {entry.profile.position && !entry.profile.role_confirmed && (
            <p className="t-small">{dict.body.players.provisional} · {pos} — {dict.body.players.confirm}</p>
          )}
        </div>
        <div className="sect">
          <span className="eb">{dict.body.players.plClubIntl}</span>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="field">
              <label className="lab" htmlFor="pl-club">{dict.body.players.plClub}</label>
              <input id="pl-club" value={dd.club} disabled={!can} maxLength={255} onChange={(x) => setDd({ ...dd, club: x.target.value })} className={field} />
            </div>
            <div className="field">
              <label className="lab" htmlFor="pl-league">{dict.body.players.league}</label>
              <input id="pl-league" value={dd.league} disabled={!can} maxLength={255} placeholder={dict.body.players.notEnteredPlaceholder}
                onChange={(x) => setDd({ ...dd, league: x.target.value })} className={field} />
            </div>
          </div>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)" }}>
            <div className="field">
              <label className="lab" htmlFor="pl-intl">{dict.body.players.intlCountry}</label>
              <select id="pl-intl" value={dd.country} disabled={!can} onChange={(x) => setDd({ ...dd, country: x.target.value })} className={field}>
                <option value="">{dict.body.players.notRecorded}</option>
                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="lab" htmlFor="pl-caps">{dict.body.players.plCaps}</label>
              <input id="pl-caps" inputMode="numeric" value={dd.caps} disabled={!can} placeholder="—"
                onChange={(x) => setDd({ ...dd, caps: x.target.value })} className={`${field} mono`} />
            </div>
            <div className="field">
              <label className="lab" htmlFor="pl-goals">{dict.body.players.plGoals}</label>
              <input id="pl-goals" inputMode="numeric" value={dd.goals} disabled={!can} placeholder="—"
                onChange={(x) => setDd({ ...dd, goals: x.target.value })} className={`${field} mono`} />
            </div>
          </div>
        </div>
        <div className="sect" style={{ borderBottom: 0 }}>
          <div className="field">
            <label className="lab" htmlFor="pl-summary">{dict.body.players.plSummary}</label>
            <textarea id="pl-summary" value={dd.summary} disabled={!can} maxLength={600} rows={2} placeholder={dict.body.players.plSummaryPh}
              onChange={(x) => setDd({ ...dd, summary: x.target.value })} className={field} />
          </div>
          <div className="field">
            <label className="lab" htmlFor="pl-strengths">{dict.body.players.plStrengths}</label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-ctl border border-line2 bg-canvas p-1.5">
              {dd.strengths.filter(Boolean).map((s, i) => (
                <span key={`${s}-${i}`} className="flex items-center gap-1 rounded-full border border-primary/50 px-2 py-0.5 text-xs">{s}
                  <button type="button" aria-label={dict.body.players.removeStrengthAria.replace("{a}", String(i + 1))} disabled={!can}
                    onClick={() => setDd({ ...dd, strengths: dd.strengths.filter((_, j) => j !== i) })} className="text-muted hover:text-danger">✕</button>
                </span>
              ))}
              <input id="pl-strengths" value={strengthInput} disabled={!can} maxLength={60} placeholder={dict.body.players.plStrengthPh}
                onChange={(x) => setStrengthInput(x.target.value)}
                onKeyDown={(x) => { if (x.key === "Enter") { x.preventDefault(); addStrength(); } }}
                className="h-6 min-w-[140px] flex-1 border-0 bg-transparent text-ink outline-none" />
            </div>
          </div>
          <div className="field">
            <span className="lab">{dict.body.players.photo}</span>
            {photoErr && <p className="mt-1 text-xs text-danger">{photoErr}</p>}
            <input aria-label={dict.body.players.photoHolderAria.replace("{a}", entry.display_name)} value={holder} disabled={!can} placeholder={dict.body.players.photoHolderPlaceholder}
              onChange={(x) => setHolder(x.target.value)} className={`${field} mt-1.5`} />
            <select aria-label={dict.body.players.photoBasisAria.replace("{a}", entry.display_name)} value={basis} disabled={!can}
              onChange={(x) => setBasis(x.target.value as BrandRightsBasis)} className={`${field} mt-1.5`}>
              <option value="">{dict.body.players.photoBasisPlaceholder}</option>
              {RIGHTS_BASIS(dict).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="mt-1.5 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmRights} disabled={!can}
              onChange={(x) => setConfirmRights(x.target.checked)} className="mt-0.5" />
              <span>{dict.body.players.photoConfirm}</span></label>
            {photoState.err && <p role="alert" className="mt-1 text-xs text-danger">{photoState.err}</p>}
            {photoState.ok && <p role="status" className="mt-1 text-xs text-ok">{photoState.ok}</p>}
            <button type="button" disabled={!can || !photoReady} onClick={() => void uploadPhoto()} className="vie-btn mt-1.5">
              {photoState.busy ? dict.body.players.uploading : dict.body.players.uploadPhoto}</button>
            <p className="hint mt-1">{dict.body.players.photoNote}</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-canvas p-3 px-4">
        <span className="hint flex-1">{dict.body.players.plEmptyStay}</span>
        {detailsError && <p role="alert" className="text-xs text-danger">{detailsError}</p>}
        {state.ok && !changed && <span role="status" className="text-xs text-ok">{state.ok}</span>}
        {state.err && <span role="alert" className="text-xs text-danger">{state.err}</span>}
        <button type="button" disabled={!changed || state.busy} onClick={discard} className="vie-btn">{dict.body.players.plDiscard}</button>
        <button type="button" disabled={!can || !changed || state.busy || !!detailsError} onClick={() => void save()} className="vie-btn vie-btn-pri">
          {state.busy ? dict.body.players.saving : dict.body.players.plSaveProfile}</button>
      </div>
    </aside>
  );
}

export function PlayersList() {
  const { t: dict } = useLocale();
  const focus = useSearchParams().get("player");
  const [list, setList] = useState<PlayerListEntry[] | null | undefined>(undefined);
  const [countries, setCountries] = useState<Country[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "confirmed" | "unconfirmed">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [measures, setMeasures] = useState<Record<string, PlayerMeasures | null>>({});
  useEffect(() => {
    void api<PlayerListEntry[]>("/v1/player-list").then(setList, () => setList(null));
    void api<Country[]>("/v1/countries").then(setCountries, () => setCountries([]));
  }, []);
  // Tracks and Coverage per player, from each player's measures read
  useEffect(() => {
    if (!list) return;
    let live = true;
    void Promise.all(list.map((e) => api<PlayerMeasures>(`/v1/players/${e.player_id}/measures`).then(
      (m) => ({ id: e.player_id, m }),
      () => ({ id: e.player_id, m: null as PlayerMeasures | null }),
    ))).then((rows) => { if (live) setMeasures(Object.fromEntries(rows.map((r) => [r.id, r.m]))); });
    return () => { live = false; };
  }, [list]);
  const shown = useMemo(() => (list ?? []).filter((e) => {
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      if (!e.display_name.toLowerCase().includes(t) && !(e.canonical_otsi_id ?? "").toLowerCase().includes(t) && !(e.profile.latest_team?.jersey_number != null && String(e.profile.latest_team.jersey_number) === t)) return false;
    }
    if (filter === "confirmed" && !e.canonical_otsi_id) return false;
    if (filter === "unconfirmed" && e.canonical_otsi_id) return false;
    return true;
  }), [list, q, filter]);
  const selected = useMemo(() => {
    if (!shown.length) return null;
    if (focus) { const f = shown.find((e) => e.player_id === focus); if (f) return f; }
    if (selectedId) { const s = shown.find((e) => e.player_id === selectedId); if (s) return s; }
    return shown[0]!;
  }, [shown, focus, selectedId]);
  const onSaved = (p: PlayerProfile) => setList((l) => l?.map((x) => (x.player_id === selected?.player_id ? { ...x, profile: p } : x)));
  return (
    <div className="flex min-w-0 flex-1" data-page="players" data-stage>
      <main className="flex min-w-0 flex-1 flex-col gap-3.5 p-5 px-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="t-page">{dict.body.analysis.players}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="pl-search" className="sr-only">{dict.body.players.searchPlayersAria}</label>
            <input id="pl-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={dict.body.players.plSearchPh}
              className="in h-8" style={{ width: 240 }} />
            <div className="seg" role="group" aria-label={dict.body.players.searchPlayersAria}>
              {(["all", "confirmed", "unconfirmed"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={filter === f ? "on" : ""}>
                  {f === "all" ? dict.body.players.plAll : f === "confirmed" ? dict.body.players.plConfirmed : dict.body.players.plUnconfirmed}
                </button>
              ))}
            </div>
          </div>
        </div>
        <section className="vie-panel" aria-label={dict.body.players.playersListAria}>
          <div className="overflow-x-auto">
            <div className="eb grid items-center gap-3 border-b border-line px-3.5" style={{ gridTemplateColumns: "104px minmax(140px, 1.5fr) 32px minmax(90px, 1fr) 40px 104px 72px 108px", minWidth: 700, height: 34 }}>
              <span>{dict.body.players.plPin}</span><span>{dict.body.players.plPlayer}</span><span>{dict.body.players.plNo}</span>
              <span>{dict.body.players.plClub}</span><span>{dict.body.players.plPos}</span><span>{dict.body.players.plTracks}</span>
              <span>{dict.body.players.plCoverage}</span><span>{dict.body.players.plIdentity}</span>
            </div>
            {list === undefined && <p className="p-4 t-body text-muted">{dict.common.loading}</p>}
            {list === null && <p role="alert" className="p-4 t-body text-danger">{dict.body.reports.playersNotLoaded}</p>}
            {list && shown.length === 0 && <p className="p-4 t-body text-muted">{list.length ? dict.body.players.noMatch : dict.body.players.noPlayersYet}</p>}
            {shown.map((e) => {
              const m = measures[e.player_id];
              const t = e.profile.latest_team;
              const cov = m && m.seen_s > 0 ? Math.round((100 * Math.min(m.measured_s, m.seen_s)) / m.seen_s) : null;
              const isSel = selected?.player_id === e.player_id;
              return (
                <button key={e.player_id} type="button" onClick={() => setSelectedId(e.player_id)}
                  aria-pressed={isSel} data-player={e.player_id}
                  className={`lr grid w-full items-center gap-3 px-3.5 text-left ${isSel ? "sel" : ""}`}
                  style={{ gridTemplateColumns: "104px minmax(140px, 1.5fr) 32px minmax(90px, 1fr) 40px 104px 72px 108px", minWidth: 700, minHeight: 48 }}>
                  <span className="mono t-small text-primary">{e.canonical_otsi_id ?? "—"}</span>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center overflow-hidden rounded-full bg-raised">
                      {e.profile.details?.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.profile.details.photo_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <User className="h-4 w-4 text-muted" aria-hidden />
                      )}
                    </span>
                    <span className="truncate font-normal">{e.display_name}</span>
                  </span>
                  <span className="mono">{t?.jersey_number ?? "—"}</span>
                  <span className="truncate">{t?.team ?? e.profile.details?.club_name ?? "—"}</span>
                  <span>{t?.position ?? e.profile.position ?? "—"}</span>
                  <span className="t-small">{m === undefined ? dict.common.loading : m ? dict.body.players.plTracksIn.replace("{a}", String(m.tracks)).replace("{b}", String(m.videos)) : "—"}</span>
                  <span className="mono">{cov === null ? "—" : `${cov}%`}</span>
                  <span>{e.canonical_otsi_id ? <span className="vie-chip ev ev-c">{dict.body.players.plConfirmed}</span> : <span className="vie-chip ev ev-n">{dict.body.players.plUnconfirmed}</span>}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line p-2.5 px-3.5">
            <span className="t-small">{dict.body.players.plPinNote}</span>
            <Link href="/analysis" className="vie-btn vie-btn-sm">{dict.body.players.plReviewIdentities}</Link>
          </div>
        </section>
        <IntroPreview entry={selected} />
      </main>
      {selected && <ProfileEditor entry={selected} countries={countries} onSaved={onSaved} />}
    </div>
  );
}
