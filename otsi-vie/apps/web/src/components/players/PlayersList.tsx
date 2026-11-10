"use client";
/**
 * The Players list (owner 2026-11-02: "the engine should have a player list where user can enter player profile before creating reel").
 * A person records what the video cannot tell: nationality, preferred foot, birth date (the age is computed) and usual position. Team and
 * shirt number are read from the latest match team sheet, where they are recorded per match (a team sheet's position, for that match, is
 * shown first where there is one). Reels and reports show what is saved here;
 * nothing is guessed. Only the organization that created a player can change the profile (the registry is shared).
 */
import type { BrandRightsBasis, Country, PlayerListEntry, PlayerProfile, PlayerProfileDetails, UpdatePlayerProfileDetailsRequest } from "@otsi-vie/contracts";
import { BRAND_MAX_BYTES } from "@otsi-vie/contracts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, ApiProblem } from "@/lib/api";

export const POSITION_NAMES: Record<string, string> = {
  GK: "Goalkeeper", RB: "Right back", CB: "Centre back", LB: "Left back", RWB: "Right wing-back", LWB: "Left wing-back", DM: "Defensive midfielder",
  CM: "Central midfielder", AM: "Attacking midfielder", RM: "Right midfielder", LM: "Left midfielder", RW: "Right winger", LW: "Left winger",
  CF: "Centre forward", ST: "Striker", DF: "Defender", MF: "Midfielder", FW: "Forward",
};
export const FOOT_NAMES: Record<string, string> = { LEFT: "Left", RIGHT: "Right", BOTH: "Both", UNKNOWN: "Unknown" };

type Draft = { nationality: string; foot: string; birth: string; position: string };
const draftOf = (p: PlayerProfile): Draft => ({ nationality: p.nationality?.code ?? "", foot: p.preferred_foot ?? "", birth: p.birth_date ?? "", position: p.position ?? "" });

/** base64url, as the brand music / video uploads send it in `x-asset-meta` (MusicPicker, ReelExtras) */
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const RIGHTS_BASIS: [BrandRightsBasis, string][] = [["OWN_BRAND", "It is our own photo"], ["LICENSED", "We have a licence for it"],
  ["FREE_LICENCE", "A free licence allows it"], ["PERMISSION", "The owner gave us written permission"]];

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
  const detailsError = !heightOk ? "Height is 100–250 cm." : !weightOk ? "Weight is 30–200 kg." : !capsOk ? "Caps is a whole number, 0 or more."
    : !goalsOk ? "International goals is a whole number, 0 or more." : !strengthsOk ? "Each strength is at most 60 characters." : null;
  const saveDetails = async () => {
    setDetailsState({ busy: true });
    try {
      const p = await api<PlayerProfile>(`/v1/players/${e.player_id}/profile-details`, { method: "PATCH", json: detailsPatch });
      onSaved(p); setDetailsState({ ok: "Profile details saved." });
    } catch (x) {
      setDetailsState({ err: x instanceof ApiProblem ? x.message : "Could not save. Try again." });
    }
  };
  // the player's photo (ADR-130): raw file bytes, like the brand music / video uploads — never multipart FormData.
  // POST /v1/players/:id/photo, PNG or JPEG, at most 512 KB (the brand-logo limit); the answer is the updated profile.
  const [photo, setPhoto] = useState<File | null>(null);
  const [holder, setHolder] = useState("");
  const [basis, setBasis] = useState<BrandRightsBasis | "">("");
  const [confirmRights, setConfirmRights] = useState(false);
  const [photoState, setPhotoState] = useState<{ busy?: boolean; ok?: string; err?: string }>({});
  const photoErr = photo && photo.size > BRAND_MAX_BYTES ? "The picture is larger than 512 KB."
    : photo && !/^image\/(png|jpeg)$/.test(photo.type) ? "Choose a PNG or JPEG picture." : null;
  const photoReady = !!photo && !photoErr && holder.trim().length >= 2 && !!basis && confirmRights && !photoState.busy;
  const uploadPhoto = async () => {
    if (!photo || !basis) return;
    setPhotoState({ busy: true });
    try {
      const meta = b64url(JSON.stringify({ rights_holder: holder.trim(), rights_basis: basis, confirm_rights: true }));
      const p = await api<PlayerProfile>(`/v1/players/${e.player_id}/photo`, { method: "POST", body: photo, headers: { "content-type": photo.type, "x-asset-meta": meta } });
      onSaved(p); setPhoto(null); setHolder(""); setBasis(""); setConfirmRights(false);
      setPhotoState({ ok: "Photo saved." });
    } catch (x) {
      setPhotoState({ err: x instanceof ApiProblem ? x.message : "The upload failed." });
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
      onSaved(p); setState({ ok: "Saved & confirmed." });
    } catch (x) {
      setState({ err: x instanceof ApiProblem ? x.message : "Could not save. Try again." });
    }
  };
  const confirmRole = async () => {
    setState({ busy: true });
    try {
      const p = await api<PlayerProfile>(`/v1/players/${e.player_id}/profile`, { method: "PATCH", json: { confirm_role: true } });
      onSaved(p); setState({ ok: "Role confirmed." });
    } catch (x) {
      setState({ err: x instanceof ApiProblem ? x.message : "Could not confirm role." });
    }
  };
  const field = "w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 disabled:opacity-60";
  return (
    <li id={`player-${e.player_id}`} data-player={e.player_id}
      className={`rounded-card border bg-panel p-4 ${focus ? "border-primary" : "border-line"}`}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_repeat(4,minmax(0,1fr))_auto] md:items-end">
      <div className="min-w-0">
        <div className="truncate text-base font-semibold">{e.display_name}</div>
        <div className="truncate text-xs text-muted">{e.canonical_otsi_id ?? "Provisional: no OTSI Player ID yet"}</div>
        <Link href={`/reports/players/${e.canonical_otsi_id ?? e.player_id}`} className="text-xs text-primary hover:underline">Open report ›</Link>
      </div>
      <div className="min-w-0 text-sm">
        <div className="text-xs text-muted">Team · No. (from the team sheet)</div>
        {t ? <div className="truncate">{t.team} · {t.jersey_number ?? "—"}</div>
          : <div className="text-muted">Not on a team sheet yet</div>}
      </div>
      <label className="text-sm">
        <div className="mb-1 flex items-center justify-between">
          <span className="block text-xs text-muted">Position</span>
          {e.profile.position && (
            e.profile.role_confirmed ? (
              <span className="rounded bg-ok/20 px-1 py-0.5 text-[10px] font-semibold text-ok" title={e.profile.role_confirmed_by_name ? `Confirmed by ${e.profile.role_confirmed_by_name}` : "Confirmed by analyst"}>✓ Confirmed</span>
            ) : (
              <div className="flex items-center gap-1">
                <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[10px] font-semibold text-amber-400">Provisional</span>
                {can && <button type="button" onClick={() => void confirmRole()} className="text-[10px] text-primary hover:underline">Confirm</button>}
              </div>
            )
          )}
        </div>
        <select aria-label={`${e.display_name} position`} value={d.position} disabled={!can} onChange={(x) => setD({ ...d, position: x.target.value })} className={field}>
          <option value="">Not recorded</option>
          {Object.entries(POSITION_NAMES).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
        </select>
      </label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Nationality</span>
        <select aria-label={`${e.display_name} nationality`} value={d.nationality} disabled={!can} onChange={(x) => setD({ ...d, nationality: x.target.value })} className={field}>
          <option value="">Not recorded</option>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Preferred foot</span>
        <select aria-label={`${e.display_name} preferred foot`} value={d.foot} disabled={!can} onChange={(x) => setD({ ...d, foot: x.target.value })} className={field}>
          <option value="">Not recorded</option>
          {Object.entries(FOOT_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-sm"><span className="mb-1 block text-xs text-muted">Birth date{e.profile.age !== null ? ` (age ${e.profile.age})` : ""}</span>
        <input type="date" aria-label={`${e.display_name} birth date`} value={d.birth} disabled={!can} max={new Date().toISOString().slice(0, 10)} min="1900-01-01"
          onChange={(x) => setD({ ...d, birth: x.target.value })} className={field} />
      </label>
      <div className="flex flex-col items-start gap-1 md:items-end">
        <button type="button" disabled={!can || !changed || state.busy} onClick={() => void save()}
          className="rounded-ctl border border-primary/70 bg-primary/20 px-4 py-1.5 text-sm font-semibold hover:bg-primary/30 disabled:opacity-40">{state.busy ? "Saving…" : "Save"}</button>
        {!can && <span className="text-xs text-muted">Created by another organization: read only</span>}
        {state.ok && !changed && <span role="status" className="text-xs text-ok">{state.ok}</span>}
        {state.err && <span role="alert" className="text-xs text-danger">{state.err}</span>}
      </div>
      </div>
      <div className="mt-3 border-t border-line/70 pt-3">
        <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)} className="text-sm font-semibold text-primary hover:underline">
          {detailsOpen ? "Hide profile details for the intro" : "Profile details for the intro"}
        </button>{" "}
        <span className="text-xs text-muted">
          {savedDetails && (savedDetails.height_cm != null || savedDetails.weight_kg != null || savedDetails.strengths.length || savedDetails.summary || savedDetails.club_name || savedDetails.league || savedDetails.international_country_code || savedDetails.photo_url)
            ? "Some details entered — shown on the Player Profile Intro as “Entered by user”."
            : "Nothing entered yet — the intro shows “Not entered”."}
        </span>
        {detailsOpen && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm"><span className="mb-1 block text-xs text-muted">Height (cm)</span>
              <input inputMode="numeric" aria-label={`${e.display_name} height in centimetres`} value={dd.height} disabled={!can} placeholder="e.g. 182"
                onChange={(x) => setDd({ ...dd, height: x.target.value })} className={field} /></label>
            <label className="text-sm"><span className="mb-1 block text-xs text-muted">Weight (kg)</span>
              <input inputMode="decimal" aria-label={`${e.display_name} weight in kilograms`} value={dd.weight} disabled={!can} placeholder="e.g. 73"
                onChange={(x) => setDd({ ...dd, weight: x.target.value })} className={field} /></label>
            <label className="text-sm"><span className="mb-1 block text-xs text-muted">Current club (only where no team sheet names one)</span>
              <input aria-label={`${e.display_name} club`} value={dd.club} disabled={!can} maxLength={255}
                onChange={(x) => setDd({ ...dd, club: x.target.value })} className={field} /></label>
            <label className="text-sm"><span className="mb-1 block text-xs text-muted">League</span>
              <input aria-label={`${e.display_name} league`} value={dd.league} disabled={!can} maxLength={255}
                onChange={(x) => setDd({ ...dd, league: x.target.value })} className={field} /></label>
            <label className="text-sm"><span className="mb-1 block text-xs text-muted">International country</span>
              <select aria-label={`${e.display_name} international country`} value={dd.country} disabled={!can}
                onChange={(x) => setDd({ ...dd, country: x.target.value })} className={field}>
                <option value="">Not entered</option>
                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm"><span className="mb-1 block text-xs text-muted">International caps</span>
                <input inputMode="numeric" aria-label={`${e.display_name} international caps`} value={dd.caps} disabled={!can} placeholder="Not entered"
                  onChange={(x) => setDd({ ...dd, caps: x.target.value })} className={field} /></label>
              <label className="text-sm"><span className="mb-1 block text-xs text-muted">International goals</span>
                <input inputMode="numeric" aria-label={`${e.display_name} international goals`} value={dd.goals} disabled={!can} placeholder="Not entered"
                  onChange={(x) => setDd({ ...dd, goals: x.target.value })} className={field} /></label>
            </div>
            <label className="text-sm sm:col-span-2"><span className="mb-1 block text-xs text-muted">Player summary (at most 600 characters)</span>
              <textarea aria-label={`${e.display_name} summary`} value={dd.summary} disabled={!can} maxLength={600} rows={3}
                onChange={(x) => setDd({ ...dd, summary: x.target.value })} className={field} /></label>
            <fieldset className="text-sm sm:col-span-2 lg:col-span-1">
              <legend className="mb-1 text-xs text-muted">Player strengths (up to 6, each at most 60 characters)</legend>
              <div className="space-y-1.5">
                {dd.strengths.map((s, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input aria-label={`${e.display_name} strength ${i + 1}`} value={s} disabled={!can} maxLength={60}
                      onChange={(x) => setDd({ ...dd, strengths: dd.strengths.map((y, j) => (j === i ? x.target.value : y)) })} className={field} />
                    <button type="button" aria-label={`Remove strength ${i + 1}`} disabled={!can || dd.strengths.length <= 1}
                      onClick={() => setDd({ ...dd, strengths: dd.strengths.filter((_, j) => j !== i) })}
                      className="rounded-ctl border border-line px-2 disabled:opacity-40">✕</button>
                  </div>
                ))}
              </div>
              <button type="button" disabled={!can || dd.strengths.length >= 6} onClick={() => setDd({ ...dd, strengths: [...dd.strengths, ""] })}
                className="mt-1.5 rounded-ctl border border-line px-2 py-1 text-xs disabled:opacity-40">+ Add strength</button>
            </fieldset>
            <div className="text-sm sm:col-span-2 lg:col-span-1">
              <span className="mb-1 block text-xs text-muted">Photo (shown on the intro)</span>
              {savedDetails?.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={savedDetails.photo_url} alt={`Photo of ${e.display_name}`} className="mb-1.5 h-16 w-16 rounded-ctl border border-line object-cover" />
              ) : <p className="mb-1.5 text-xs text-muted">No photo yet.</p>}
              <input type="file" accept="image/png,image/jpeg" aria-label={`${e.display_name} photo`} disabled={!can}
                onChange={(x) => setPhoto(x.target.files?.[0] ?? null)} className="w-full text-xs" />
              {photoErr && <p className="mt-1 text-xs text-danger">{photoErr}</p>}
              <input aria-label={`${e.display_name} photo rights holder`} value={holder} disabled={!can} placeholder="Who owns this photo?"
                onChange={(x) => setHolder(x.target.value)} className={`${field} mt-1.5`} />
              <select aria-label={`${e.display_name} photo rights basis`} value={basis} disabled={!can}
                onChange={(x) => setBasis(x.target.value as BrandRightsBasis)} className={`${field} mt-1.5`}>
                <option value="">Why may we use it?</option>
                {RIGHTS_BASIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <label className="mt-1.5 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmRights} disabled={!can}
                onChange={(x) => setConfirmRights(x.target.checked)} className="mt-0.5" />
                <span>I confirm we have the right to show this photo in our reels.</span></label>
              {photoState.err && <p role="alert" className="mt-1 text-xs text-danger">{photoState.err}</p>}
              {photoState.ok && <p role="status" className="mt-1 text-xs text-ok">{photoState.ok}</p>}
              <button type="button" disabled={!can || !photoReady} onClick={() => void uploadPhoto()}
                className="mt-1.5 rounded-ctl border border-primary/70 bg-primary/20 px-3 py-1.5 text-xs font-semibold hover:bg-primary/30 disabled:opacity-40">
                {photoState.busy ? "Uploading…" : "Upload photo"}</button>
              <p className="mt-1 text-[11px] text-muted">PNG or JPEG, up to 512 KB. Your statement is recorded with your name.</p>
            </div>
            <div className="flex flex-col items-start gap-1 sm:col-span-2 lg:col-span-3">
              {detailsError && <p role="alert" className="text-xs text-danger">{detailsError}</p>}
              <button type="button" disabled={!can || !detailsChanged || detailsState.busy || !!detailsError} onClick={() => void saveDetails()}
                className="rounded-ctl border border-primary/70 bg-primary/20 px-4 py-1.5 text-sm font-semibold hover:bg-primary/30 disabled:opacity-40">
                {detailsState.busy ? "Saving…" : "Save profile details"}</button>
              {!can && <span className="text-xs text-muted">Created by another organization: read only</span>}
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
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6" data-page="players">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Players</h1>
          <p className="text-sm text-muted">Enter what you know about each player once. Reels and reports show it. The video never fills these in.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by position"
            className="rounded-ctl border border-line bg-canvas px-3 py-2 text-sm">
            <option value="">All positions</option>
            {Object.entries(POSITION_NAMES).map(([k, v]) => <option key={k} value={k}>{v} ({k})</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
            <input type="checkbox" checked={confirmedOnly} onChange={(e) => setConfirmedOnly(e.target.checked)} className="rounded border-line" />
            <span>Confirmed roles only</span>
          </label>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" placeholder="Search by name or OTSI Player ID…"
            className="w-full max-w-xs rounded-ctl border border-line bg-canvas px-3 py-2 text-sm" />
        </div>
      </div>
      {list === undefined && <p className="text-muted">Loading…</p>}
      {list === null && <p role="alert" className="text-danger">The players could not be loaded.</p>}
      {list && shown.length === 0 && <p className="text-muted">{list.length ? "No player matches the search." : "No players yet. Add players to a match team sheet, or confirm who a player is in Analysis."}</p>}
      <ul aria-label="Players" className="space-y-3">
        {shown.map((e) => (
          <Row key={e.player_id} e={e} countries={countries} focus={focus === e.player_id}
            onSaved={(p) => setList((l) => l?.map((x) => (x.player_id === e.player_id ? { ...x, profile: p } : x)))} />
        ))}
      </ul>
    </main>
  );
}
