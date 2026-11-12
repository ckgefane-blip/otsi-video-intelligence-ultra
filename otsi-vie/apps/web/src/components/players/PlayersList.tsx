"use client";
/**
 * The Players list (owner 2026-11-02: "the engine should have a player list where user can enter player profile before creating reel").
 * A person records what the video cannot tell: nationality, preferred foot, birth date (the age is computed) and usual position. Team and
 * shirt number are read from the latest match team sheet, where they are recorded per match (a team sheet's position, for that match, is
 * shown first where there is one). Reels and reports show what is saved here;
 * nothing is guessed. Only the organization that created a player can change the profile (the registry is shared).
 *
 * Drop 1 layout: the same rows, fields and API calls, laid out in the page's flow on the Desktop UI shell (AppRail / AppTopBar /
 * StatusBar from the (app) layout) with the shared `vie-panel` / `vie-btn` classes. No control was removed or rewired.
 */
import type { BrandRightsBasis, Country, PlayerListEntry, PlayerProfile, PlayerProfileDetails, UpdatePlayerProfileDetailsRequest } from "@otsi-vie/contracts";
import { BRAND_MAX_BYTES } from "@otsi-vie/contracts";
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

function Row({ e, countries, focus, onSaved }: { e: PlayerListEntry; countries: Country[]; focus: boolean; onSaved(p: PlayerProfile): void }) {
  const { t: dict } = useLocale();
  const [d, setD] = useState<Draft>(draftOf(e.profile));
  const [state, setState] = useState<{ busy?: boolean; ok?: string; err?: string }>({});
  useEffect(() => setD(draftOf(e.profile)), [e.profile]);
  // ADR-130: the extra profile for the Player Profile Intro — height, weight, strengths, summary, club, league, international career
  const [dd, setDd] = useState<DetailsDraft>(draftDetailsOf(e.profile.details ?? null));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsState, setDetailsState] = useState<{ busy?: boolean; ok?: string; err?: string }>({});
  useEffect(() => setDd(draftDetailsOf(e.profile.details ?? null)), [e.profile]);
  const savedDetails = e.profile.details ?? null;
  const detailsPatch = buildDetailsPatch(savedDetails, dd);
  const detailsChanged = Object.keys(detailsPatch).length > 0;
  const heightOk = dd.height.trim() === "" || (/^\d+$/.test(dd.height.trim()) && Number(dd.height) >= 100 && Number(dd.height) <= 250);
  const weightOk = dd.weight.trim() === "" || (!Number.isNaN(Number(dd.weight)) && Number(dd.weight) >= 30 && Number(dd.weight) <= 200);
  const capsOk = dd.caps.trim() === "" || (/^\d+$/.test(dd.caps.trim()) && Number(dd.caps) >= 0);
  const goalsOk = dd.goals.trim() === "" || (/^\d+$/.test(dd.goals.trim()) && Number(dd.goals) >= 0);
  const strengthsOk = dd.strengths.every((x) => x.length <= 60);
  const detailsError = !heightOk ? dict.body.players.heightError : !weightOk ? dict.body.players.weightError : !capsOk ? dict.body.players.capsError
    : !goalsOk ? dict.body.players.intlGoalsError : !strengthsOk ? dict.body.players.strengthsError : null;
  const saveDetails = async () => {
    setDetailsState({ busy: true });
    try {
      const p = await api<PlayerProfile>(`/v1/players/${e.player_id}/profile-details`, { method: "PATCH", json: detailsPatch });
      onSaved(p); setDetailsState({ ok: dict.body.players.detailsSaved });
    } catch (x) {
      setDetailsState({ err: x instanceof ApiProblem ? x.message : dict.body.players.couldNotSave });
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
      const p = await api<PlayerProfile>(`/v1/players/${e.player_id}/photo`, { method: "POST", body: photo, headers: { "content-type": photo.type, "x-asset-meta": meta } });
      onSaved(p); setPhoto(null); setHolder(""); setBasis(""); setConfirmRights(false);
      setPhotoState({ ok: dict.body.players.photoSaved });
    } catch (x) {
      setPhotoState({ err: x instanceof ApiProblem ? x.message : dict.body.players.photoUploadFailed });
    }
  };
  const saved = draftOf(e.profile);
  const changed = d.nationality !== saved.nationality || d.foot !== saved.foot || d.birth !== saved.birth || d.position !== saved.position;
  const t = e.profile.latest_team;
  const can = e.profile.editable;
  const save = async () => {
    setState({ busy: true });
    try {
      const body: Record<string, string | boolean | null> = {};
      if (d.nationality !== saved.nationality) body.nationality = d.nationality || null;
      if (d.foot !== saved.foot) body.preferred_foot = d.foot || null;
      if (d.birth !== saved.birth) body.birth_date = d.birth || null;
      if (d.position !== saved.position) {
        body.position = d.position || null;
        body.confirm_role = true;
      }
      const p = await api<PlayerProfile>(`/v1/players/${e.player_id}/profile`, { method: "PATCH", json: body });
      onSaved(p); setState({ ok: dict.body.players.savedConfirmed });
    } catch (x) {
      setState({ err: x instanceof ApiProblem ? x.message : dict.body.players.couldNotSave });
    }
  };
  const confirmRole = async () => {
    setState({ busy: true });
    try {
      const p = await api<PlayerProfile>(`/v1/players/${e.player_id}/profile`, { method: "PATCH", json: { confirm_role: true } });
      onSaved(p); setState({ ok: dict.body.players.roleConfirmed });
    } catch (x) {
      setState({ err: x instanceof ApiProblem ? x.message : dict.body.players.roleConfirmFailed });
    }
  };
  const field = "w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 disabled:opacity-60";
  return (
    <li id={`player-${e.player_id}`} data-player={e.player_id}
      className={`vie-panel p-4 ${focus ? "border-primary" : ""}`}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_repeat(4,minmax(0,1fr))_auto] md:items-end">
      <div className="min-w-0">
        <div className="truncate t-panel">{e.display_name}</div>
        <div className="truncate t-small">{e.canonical_otsi_id ?? dict.body.players.noOtsiId}</div>
        <Link href={`/reports/players/${e.canonical_otsi_id ?? e.player_id}`} className="text-xs text-primary hover:underline">{dict.body.players.openReport}</Link>
      </div>
      <div className="min-w-0 t-body">
        <div className="t-small">{dict.body.players.teamNumber}</div>
        {t ? <div className="truncate">{t.team} · {t.jersey_number ?? "—"}</div>
          : <div className="text-muted">{dict.body.players.notOnTeamSheet}</div>}
      </div>
      <label className="t-body">
        <div className="mb-1 flex items-center justify-between">
          <span className="block t-small">{dict.body.players.position}</span>
          {e.profile.position && (
            e.profile.role_confirmed ? (
              <span className="rounded bg-ok/20 px-1 py-0.5 text-xs font-normal text-ok" title={e.profile.role_confirmed_by_name ? dict.body.players.confirmedBy.replace("{a}", e.profile.role_confirmed_by_name) : dict.body.players.confirmedByAnalyst}>{dict.body.players.confirmed}</span>
            ) : (
              <div className="flex items-center gap-1">
                <span className="rounded bg-amber-500/20 px-1 py-0.5 text-xs font-normal text-amber-400">{dict.body.players.provisional}</span>
                {can && <button type="button" onClick={() => void confirmRole()} className="text-xs text-primary hover:underline">{dict.body.players.confirm}</button>}
              </div>
            )
          )}
        </div>
        <select aria-label={dict.body.players.posAria.replace("{a}", e.display_name)} value={d.position} disabled={!can} onChange={(x) => setD({ ...d, position: x.target.value })} className={field}>
          <option value="">{dict.body.players.notRecorded}</option>
          {Object.entries(POSITION_NAMES(dict)).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
        </select>
      </label>
      <label className="t-body"><span className="mb-1 block t-small">{dict.body.players.nationality}</span>
        <select aria-label={dict.body.players.natAria.replace("{a}", e.display_name)} value={d.nationality} disabled={!can} onChange={(x) => setD({ ...d, nationality: x.target.value })} className={field}>
          <option value="">{dict.body.players.notRecorded}</option>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </label>
      <label className="t-body"><span className="mb-1 block t-small">{dict.body.players.preferredFoot}</span>
        <select aria-label={dict.body.players.footAria.replace("{a}", e.display_name)} value={d.foot} disabled={!can} onChange={(x) => setD({ ...d, foot: x.target.value })} className={field}>
          <option value="">{dict.body.players.notRecorded}</option>
          {Object.entries(FOOT_NAMES(dict)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="t-body"><span className="mb-1 block t-small">{dict.body.players.birthDate}{e.profile.age !== null ? dict.body.players.ageSuffix.replace("{a}", String(e.profile.age)) : ""}</span>
        <input type="date" aria-label={dict.body.players.birthAria.replace("{a}", e.display_name)} value={d.birth} disabled={!can} max={new Date().toISOString().slice(0, 10)} min="1900-01-01"
          onChange={(x) => setD({ ...d, birth: x.target.value })} className={field} />
      </label>
      <div className="flex flex-col items-start gap-1 md:items-end">
        <button type="button" disabled={!can || !changed || state.busy} onClick={() => void save()}
          className="vie-btn vie-btn-pri">{state.busy ? dict.body.players.saving : dict.common.save}</button>
        {!can && <span className="t-small">{dict.body.players.readOnly}</span>}
        {state.ok && !changed && <span role="status" className="text-xs text-ok">{state.ok}</span>}
        {state.err && <span role="alert" className="text-xs text-danger">{state.err}</span>}
      </div>
      </div>
      <div className="mt-3 border-t border-line/70 pt-3">
        <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)} className="t-panel text-primary hover:underline">
          {detailsOpen ? dict.body.players.hideProfileDetails : dict.body.players.profileDetails}
        </button>{" "}
        <span className="t-small">
          {savedDetails && (savedDetails.height_cm != null || savedDetails.weight_kg != null || savedDetails.strengths.length || savedDetails.summary || savedDetails.club_name || savedDetails.league || savedDetails.international_country_code || savedDetails.photo_url)
            ? dict.body.players.someEntered
            : dict.body.players.nothingEntered}
        </span>
        {detailsOpen && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="t-body"><span className="mb-1 block t-small">{dict.body.players.height}</span>
              <input inputMode="numeric" aria-label={dict.body.players.heightAria.replace("{a}", e.display_name)} value={dd.height} disabled={!can} placeholder={dict.body.players.heightExample}
                onChange={(x) => setDd({ ...dd, height: x.target.value })} className={field} /></label>
            <label className="t-body"><span className="mb-1 block t-small">{dict.body.players.weight}</span>
              <input inputMode="decimal" aria-label={dict.body.players.weightAria.replace("{a}", e.display_name)} value={dd.weight} disabled={!can} placeholder={dict.body.players.weightExample}
                onChange={(x) => setDd({ ...dd, weight: x.target.value })} className={field} /></label>
            <label className="t-body"><span className="mb-1 block t-small">{dict.body.players.club}</span>
              <input aria-label={dict.body.players.clubAria.replace("{a}", e.display_name)} value={dd.club} disabled={!can} maxLength={255}
                onChange={(x) => setDd({ ...dd, club: x.target.value })} className={field} /></label>
            <label className="t-body"><span className="mb-1 block t-small">{dict.body.players.league}</span>
              <input aria-label={dict.body.players.leagueAria.replace("{a}", e.display_name)} value={dd.league} disabled={!can} maxLength={255}
                onChange={(x) => setDd({ ...dd, league: x.target.value })} className={field} /></label>
            <label className="t-body"><span className="mb-1 block t-small">{dict.body.players.intlCountry}</span>
              <select aria-label={dict.body.players.intlCountryAria.replace("{a}", e.display_name)} value={dd.country} disabled={!can}
                onChange={(x) => setDd({ ...dd, country: x.target.value })} className={field}>
                <option value="">{dict.body.players.notRecorded}</option>
                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="t-body"><span className="mb-1 block t-small">{dict.body.players.intlCaps}</span>
                <input inputMode="numeric" aria-label={dict.body.players.capsAria.replace("{a}", e.display_name)} value={dd.caps} disabled={!can} placeholder={dict.body.players.notEnteredPlaceholder}
                  onChange={(x) => setDd({ ...dd, caps: x.target.value })} className={field} /></label>
              <label className="t-body"><span className="mb-1 block t-small">{dict.body.players.intlGoals}</span>
                <input inputMode="numeric" aria-label={dict.body.players.goalsAria.replace("{a}", e.display_name)} value={dd.goals} disabled={!can} placeholder={dict.body.players.notEnteredPlaceholder}
                  onChange={(x) => setDd({ ...dd, goals: x.target.value })} className={field} /></label>
            </div>
            <label className="t-body sm:col-span-2"><span className="mb-1 block t-small">{dict.body.players.summary}</span>
              <textarea aria-label={dict.body.players.summaryAria.replace("{a}", e.display_name)} value={dd.summary} disabled={!can} maxLength={600} rows={3}
                onChange={(x) => setDd({ ...dd, summary: x.target.value })} className={field} /></label>
            <fieldset className="t-body sm:col-span-2 lg:col-span-1">
              <legend className="mb-1 t-small">{dict.body.players.strengths}</legend>
              <div className="space-y-1.5">
                {dd.strengths.map((s, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input aria-label={dict.body.players.strengthAria.replace("{a}", e.display_name).replace("{b}", String(i + 1))} value={s} disabled={!can} maxLength={60}
                      onChange={(x) => setDd({ ...dd, strengths: dd.strengths.map((y, j) => (j === i ? x.target.value : y)) })} className={field} />
                    <button type="button" aria-label={dict.body.players.removeStrengthAria.replace("{a}", String(i + 1))} disabled={!can || dd.strengths.length <= 1}
                      onClick={() => setDd({ ...dd, strengths: dd.strengths.filter((_, j) => j !== i) })}
                      className="rounded-ctl border border-line px-2 disabled:opacity-40">✕</button>
                  </div>
                ))}
              </div>
              <button type="button" disabled={!can || dd.strengths.length >= 6} onClick={() => setDd({ ...dd, strengths: [...dd.strengths, ""] })}
                className="mt-1.5 rounded-ctl border border-line px-2 py-1 text-xs disabled:opacity-40">{dict.body.players.addStrength}</button>
            </fieldset>
            <div className="t-body sm:col-span-2 lg:col-span-1">
              <span className="mb-1 block t-small">{dict.body.players.photo}</span>
              {savedDetails?.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={savedDetails.photo_url} alt={dict.body.players.photoAlt.replace("{a}", e.display_name)} className="mb-1.5 h-16 w-16 rounded-ctl border border-line object-cover" />
              ) : <p className="mb-1.5 t-small">{dict.body.players.noPhotoYet}</p>}
              <input type="file" accept="image/png,image/jpeg" aria-label={dict.body.players.photoAria.replace("{a}", e.display_name)} disabled={!can}
                onChange={(x) => setPhoto(x.target.files?.[0] ?? null)} className="w-full text-xs" />
              {photoErr && <p className="mt-1 text-xs text-danger">{photoErr}</p>}
              <input aria-label={dict.body.players.photoHolderAria.replace("{a}", e.display_name)} value={holder} disabled={!can} placeholder={dict.body.players.photoHolderPlaceholder}
                onChange={(x) => setHolder(x.target.value)} className={`${field} mt-1.5`} />
              <select aria-label={dict.body.players.photoBasisAria.replace("{a}", e.display_name)} value={basis} disabled={!can}
                onChange={(x) => setBasis(x.target.value as BrandRightsBasis)} className={`${field} mt-1.5`}>
                <option value="">{dict.body.players.photoBasisPlaceholder}</option>
                {RIGHTS_BASIS(dict).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <label className="mt-1.5 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmRights} disabled={!can}
                onChange={(x) => setConfirmRights(x.target.checked)} className="mt-0.5" />
                <span>{dict.body.players.photoConfirm}</span></label>
              {photoState.err && <p role="alert" className="mt-1 text-xs text-danger">{photoState.err}</p>}
              {photoState.ok && <p role="status" className="mt-1 text-xs text-ok">{photoState.ok}</p>}
              <button type="button" disabled={!can || !photoReady} onClick={() => void uploadPhoto()}
                className="vie-btn mt-1.5">
                {photoState.busy ? dict.body.players.uploading : dict.body.players.uploadPhoto}</button>
              <p className="mt-1 t-small">{dict.body.players.photoNote}</p>
            </div>
            <div className="flex flex-col items-start gap-1 sm:col-span-2 lg:col-span-3">
              {detailsError && <p role="alert" className="text-xs text-danger">{detailsError}</p>}
              <button type="button" disabled={!can || !detailsChanged || detailsState.busy || !!detailsError} onClick={() => void saveDetails()}
                className="vie-btn vie-btn-pri">
                {detailsState.busy ? dict.body.players.saving : dict.body.players.saveDetails}</button>
              {!can && <span className="t-small">{dict.body.players.readOnly}</span>}
              {detailsState.ok && !detailsChanged && <span role="status" className="text-xs text-ok">{detailsState.ok}</span>}
              {detailsState.err && <span role="alert" className="text-xs text-danger">{detailsState.err}</span>}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

export function PlayersList() {
  const { t: dict } = useLocale();
  const focus = useSearchParams().get("player");
  const [list, setList] = useState<PlayerListEntry[] | null | undefined>(undefined);
  const [countries, setCountries] = useState<Country[]>([]);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [confirmedOnly, setConfirmedOnly] = useState(true);
  useEffect(() => {
    void api<PlayerListEntry[]>("/v1/player-list").then(setList, () => setList(null));
    void api<Country[]>("/v1/countries").then(setCountries, () => setCountries([]));
  }, []);
  useEffect(() => { if (focus && list) document.getElementById(`player-${focus}`)?.scrollIntoView({ block: "center" }); }, [focus, list]);
  const shown = useMemo(() => (list ?? []).filter((e) => {
    if (q.trim()) {
      const matchText = e.display_name.toLowerCase().includes(q.trim().toLowerCase()) || (e.canonical_otsi_id ?? "").includes(q.trim().toUpperCase());
      if (!matchText) return false;
    }
    if (roleFilter) {
      if (confirmedOnly) {
        if (!e.profile.role_confirmed || e.profile.position !== roleFilter) return false;
      } else {
        if (e.profile.position !== roleFilter) return false;
      }
    } else if (confirmedOnly && e.profile.position && !e.profile.role_confirmed) {
      // If position is set but not confirmed, and confirmedOnly is active when role is selected
    }
    return true;
  }), [list, q, roleFilter, confirmedOnly]);
  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4" data-page="players">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-page">{dict.body.analysis.players}</h1>
          <p className="t-body text-muted">{dict.body.players.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label={dict.body.players.filterPositionAria}
            className="rounded-ctl border border-line bg-canvas px-3 py-2 t-body">
            <option value="">{dict.body.players.allPositions}</option>
            {Object.entries(POSITION_NAMES(dict)).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
          </select>
          <label className="flex items-center gap-1.5 t-small cursor-pointer">
            <input type="checkbox" checked={confirmedOnly} onChange={(e) => setConfirmedOnly(e.target.checked)} className="rounded border-line" />
            <span>{dict.body.players.confirmedRolesOnly}</span>
          </label>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={dict.body.players.searchPlayersAria} placeholder={dict.body.players.searchPlaceholder}
            className="w-full max-w-xs rounded-ctl border border-line bg-canvas px-3 py-2 t-body" />
        </div>
      </div>
      {list === undefined && <p className="text-muted">{dict.common.loading}</p>}
      {list === null && <p role="alert" className="text-danger">{dict.body.reports.playersNotLoaded}</p>}
      {list && shown.length === 0 && <p className="text-muted">{list.length ? dict.body.players.noMatch : dict.body.players.noPlayersYet}</p>}
      <ul aria-label={dict.body.players.playersListAria} className="space-y-3">
        {shown.map((e) => (
          <Row key={e.player_id} e={e} countries={countries} focus={focus === e.player_id}
            onSaved={(p) => setList((l) => l?.map((x) => (x.player_id === e.player_id ? { ...x, profile: p } : x)))} />
        ))}
      </ul>
    </main>
  );
}
