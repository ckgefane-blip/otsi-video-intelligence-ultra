"use client";
/**
 * Page 07 Section 02 — media bin / asset browser (approved reference 07_CLIP_STUDIO, "media bin").
 *
 * The bin holds the moments the engine suggests for the reel's confirmed player (GET /v1/reels/:id/moments: stretches where the player
 * is visible on confirmed tracks — suggestions, not detected events). Search filters them by label; the filter button hides moments
 * already in the reel. Click shows a moment in the preview; drag it onto the Video Clips lane, double-click it or use + to add it.
 * Graphics lists the organization's logos and intro / outro videos, Audio its music (GET /v1/brand-assets, each uploaded in the Reel
 * Builder with a rights declaration): "Use" puts one into this reel's look (PATCH /v1/reels/:id settings), which the renderer draws.
 * An asset whose rights are not in force cannot be chosen. Templates (ADR-055) are the organization's saved reel looks (aspect and every
 * spotlight, overlay, branding and music setting): Save keeps this reel's look under a name, Apply gives this reel a template's look (a
 * logo, music or video that is gone or whose rights lapsed is left out, and the message names it), Update saves this reel's look into it.
 * E4 (ADR-067): one asset browser: the search filters every tab at once (moments by label, graphics and music by name and kind, templates by
 * name and look) and each tab says how many match. A template can also keep this reel's clips as slots; "Fill" gives the reel the look and
 * the best unused moment of each slot's kind of this reel's player (asked first: it replaces the clips).
 * B.11 (ADR-087): the folder path's last step chooses what the bin shows: the player's suggested moments, or only those that hold what
 * one of the person's Smart Bins finds on this reel's video (a goal, a pass of his, a marker...). The bin fills itself from the search.
 */
import { binMoments, type BrandAsset, type ReelMoment, type ReelTemplate, type SmartBinItems, type SpotlightSettings, type OrgTemplate, type OrgTemplateKind } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { BeatStatusRow } from "./BeatGridInfo";
import { binCount, useSmartBins } from "@/components/library/SmartBins";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { Btn } from "./kit";
import type { Studio } from "./useStudio";

const dur = (m: ReelMoment) => `${((m.out_pts_us - m.in_pts_us) / 1e6).toFixed(1)} s`;
export const MOMENT_MIME = "application/x-otsi-moment";

export function MediaBin({ r, st, onPick, say }: { r: ReelState | null; st: Studio; onPick: () => void; say: (m: string) => void }) {
  const { t: dict } = useLocale();
  const tab = st.binTab, setTab = st.setBinTab;
  const TABS = [dict.body.studio.mediaBinTab, dict.body.studio.graphicsTab, dict.body.studio.audioTab, dict.body.studio.templatesTab];
  const [q, setQ] = useState("");
  const [hideUsed, setHideUsed] = useState(false);
  // B.11: a Smart Bin narrows the moments to those holding what it finds on this reel's video
  const { bins } = useSmartBins();
  const [binId, setBinId] = useState("");
  const [binHits, setBinHits] = useState<SmartBinItems | null>(null);
  const videoId = st.reel?.video_id ?? null;
  useEffect(() => {
    setBinHits(null);
    if (binId && videoId) void api<SmartBinItems>(`/v1/smart-bins/${binId}/items?video=${videoId}`).then(setBinHits, () => setBinHits(null));
  }, [binId, videoId]);
  const inBin = binId ? (binHits && videoId ? binMoments(r?.moments ?? [], binHits.hits, videoId) : []) : null;
  const all = inBin ?? r?.moments ?? [];
  const needle = q.trim().toLowerCase();
  const shown = all.filter((m) => (!hideUsed || !m.in_reel) && m.label.toLowerCase().includes(needle));
  // E4: one search over every tab
  const brandHit = (a: BrandAsset) => !needle || `${a.name} ${brandKind(dict)[a.kind]}`.toLowerCase().includes(needle);
  const tplHit = (t: ReelTemplate) => !needle || `${t.name} ${t.structure ? "slots" : ""}`.toLowerCase().includes(needle);
  const counts = [shown.length, (st.brand ?? []).filter((a) => a.kind !== "MUSIC" && brandHit(a)).length, (st.brand ?? []).filter((a) => a.kind === "MUSIC" && brandHit(a)).length,
    (st.templates ?? []).filter(tplHit).length];
  const edit = !!st.reel && !!r?.canEdit && !r.busy;
  const empty = !st.reel ? dict.body.studio.chooseReelEdit : r?.moments === null || (binId && !binHits) ? dict.common.loading
    : binId && all.length === 0 ? dict.body.studio.noneBinFinds : all.length === 0 ? dict.body.studio.noClipsFolder : shown.length === 0 ? dict.body.studio.noMomentMatches : null;

  return (
    <section aria-label={dict.body.studio.mediaBinBrowserAria} data-section="p07-s02" data-moments={String(shown.length)}
      className="vie-panel flex min-h-0 flex-col p-3">
      <div role="tablist" aria-label={dict.body.studio.assets} className="flex gap-1 border-b border-line">
        {TABS.map((l, i) => (
          <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
            className={`t-body border-b-2 px-2 py-1.5 ${tab === i ? "border-primary font-normal text-primary" : "border-transparent text-muted"}`}>
            {needle ? `${l} ${counts[i]}` : l}
          </button>
        ))}
      </div>

      <label className="mt-2 flex items-center gap-2 rounded-ctl border border-line2 bg-canvas px-2 py-1.5">
        <span aria-hidden className="text-muted">⌕</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={dict.body.studio.searchBin} aria-label={dict.body.studio.searchMediaBin}
          className="t-body min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" />
      </label>
      {tab === 0 ? (
        <>
          <div className="mt-2 flex items-center gap-2">
            <Btn label={hideUsed ? dict.body.studio.showAllMoments : dict.body.studio.hideUsedMoments} pressed={hideUsed}
              onClick={() => setHideUsed((h) => !h)} className="vie-btn-sm shrink-0">
              ⧩
            </Btn>
            <nav aria-label={dict.body.studio.folderAria} className="flex min-w-0 flex-1 items-center gap-1 t-body">
              <span aria-hidden className="text-muted">▸</span>
              <span className="shrink-0">{dict.body.studio.foldersLabel}</span>
              <span aria-hidden className="shrink-0 text-muted">▸</span>
              {st.reel && bins && bins.length > 0 ? (
                <select value={binId} onChange={(e) => setBinId(e.target.value)} aria-label={dict.body.studio.showBinHint} data-bin-select
                  className="t-body min-w-0 flex-1 truncate rounded-ctl border border-line2 bg-canvas px-2 py-1">
                  <option value="">{st.reel.player ? dict.body.studio.playerSuggestedMoments.replace("{a}", st.reel.player.display_name) : dict.body.studio.suggestedMoments}</option>
                  {bins.map((b) => <option key={b.id} value={b.id}>{dict.body.studio.smartBinOption.replace("{a}", b.name).replace("{b}", String(binCount(b)))}</option>)}
                </select>
              ) : <span className="min-w-0 truncate">{st.reel?.player ? dict.body.studio.playerSuggestedMoments.replace("{a}", st.reel.player.display_name) : dict.body.studio.allMedia}</span>}
            </nav>
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
            {!st.reel ? (
              <button type="button" onClick={onPick} className="vie-btn mx-auto mt-24 block">{dict.body.studio.chooseReelEdit}</button>
            ) : empty ? <p className="t-body mt-24 text-center text-muted">{empty}</p> : (
              <ul aria-label={dict.body.studio.suggestedMoments} className="grid grid-cols-2 gap-2">
                {shown.map((m) => {
                  const sel = st.preview?.in_pts_us === m.in_pts_us && st.preview.out_pts_us === m.out_pts_us;
                  return (
                    <li key={`${m.in_pts_us}-${m.out_pts_us}`} draggable={edit} onDragStart={(e) => e.dataTransfer.setData(MOMENT_MIME, JSON.stringify(m))}
                      data-moment={m.in_pts_us}>
                      <button type="button" aria-label={dict.body.studio.momentPreviewAria.replace("{a}", m.label).replace("{b}", dur(m)).replace("{c}", m.in_reel ? dict.body.studio.inReelSuffix : "")} aria-pressed={sel}
                        onClick={() => { st.setPreview(m); r?.setSelectedClip(null); }} onDoubleClick={() => edit && st.add(m)}
                        className={`relative block aspect-[16/9] w-full cursor-pointer overflow-hidden rounded-md border ${sel ? "border-primary" : "border-transparent"} bg-[#0b2a52]`}>
                        <span className="t-tc absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 text-white">{dur(m)}</span>
                        {m.in_reel && <span title={dict.body.studio.inReelBadge} className="t-panel absolute left-1 top-1 text-ok">✓</span>}
                      </button>
                      <span className="mt-1 flex items-start gap-1">
                        <span className="t-small min-w-0 flex-1 truncate">{m.label}</span>
                        {edit && !m.in_reel && (
                          <button type="button" aria-label={dict.body.studio.addMomentToReel.replace("{a}", m.label)} onClick={() => st.add(m)}
                            className="t-panel flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line2 bg-raised leading-none">+</button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      ) : tab === 3 ? <Templates st={st} canEdit={edit} onPick={onPick} say={say} hit={tplHit} /> : <BrandList st={st} canEdit={edit} audio={tab === 2} onPick={onPick} hit={brandHit} />}
    </section>
  );
}

/** a flow chip button: `on` = active, `dis` = cannot act, `warn` = destructive */
const chip = (on: boolean, dis: boolean, warn = false) =>
  `t-button rounded-md border px-2.5 py-1 ${warn ? "border-danger bg-[#3a1010]" : on ? "border-primary bg-[#0d3a78] text-white" : "border-line2 bg-raised"} ${dis ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`;

/** ADR-109 (v3 Phase C.10): Organization templates for Spotlight, Style and Branding; save this reel's settings, apply modularly, or delete */
function Templates({ st, canEdit, onPick, say, hit }: { st: Studio; canEdit: boolean; onPick: () => void; say: (m: string) => void; hit: (t: any) => boolean }) {
  const { t: dict } = useLocale();
  const [name, setName] = useState("");
  const [saveKind, setSaveKind] = useState<OrgTemplateKind>("FULL");
  const [kindFilter, setKindFilter] = useState<"ALL" | OrgTemplateKind>("ALL");
  const [sure, setSure] = useState<string | null>(null);

  const orgList = (st.orgTemplates ?? []).filter((t) => {
    if (kindFilter !== "ALL" && t.kind !== kindFilter && t.kind !== "FULL") return false;
    return hit(t);
  });

  const taken = !!orgList.some((t) => t.name.toLowerCase() === name.trim().toLowerCase());

  const kindLabel = (k: OrgTemplateKind) => k === "SPOTLIGHT" ? dict.body.studio.spotlightLabel : k === "STYLE" ? dict.body.studio.styleLabel : k === "BRANDING" ? dict.body.studio.brandingLabel : dict.body.studio.fullLook;
  const kindBadge = (k: OrgTemplateKind) => {
    const bg = k === "SPOTLIGHT" ? "#0e4b75" : k === "STYLE" ? "#4a1d75" : k === "BRANDING" ? "#135c3b" : "#705312";
    const text = k === "SPOTLIGHT" ? "#33a8ff" : k === "STYLE" ? "#d292ff" : k === "BRANDING" ? "#3ee6a8" : "#f5d02e";
    return <span className="px-1.5 py-0.5 text-xs font-normal" style={{ borderRadius: 4, background: bg, color: text }}>{kindLabel(k)}</span>;
  };

  return (
    <div data-templates={String(orgList.length)} className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {!st.reel ? (
        <button type="button" onClick={onPick} className={`${chip(false, false)} self-center`}>{dict.body.studio.chooseReelEdit}</button>
      ) : (
        <>
          {/* Quick kind filter pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="t-label font-normal">{dict.body.studio.filterLabel}</span>
            {(["ALL", "SPOTLIGHT", "STYLE", "BRANDING", "FULL"] as const).map((k) => (
              <button key={k} type="button" data-filter-kind={k} onClick={() => setKindFilter(k)} className={chip(kindFilter === k, false)}>
                {k === "ALL" ? dict.body.processing.filterAll : kindLabel(k)}
              </button>
            ))}
          </div>

          {/* Save new template row */}
          <form className="flex gap-1.5" onSubmit={(e) => {
            e.preventDefault();
            if (canEdit && name.trim() && !taken) {
              st.saveOrgTemplate(name.trim(), saveKind); setName("");
            }
          }}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={dict.body.studio.nameNewTemplate} aria-label={dict.body.studio.templateName} disabled={!canEdit}
              className="t-body h-9 min-w-0 flex-1 rounded-md border border-line2 bg-canvas px-2.5 outline-none" />
            <select value={saveKind} onChange={(e) => setSaveKind(e.target.value as OrgTemplateKind)} disabled={!canEdit}
              aria-label={dict.body.studio.templateSection}
              className="t-button h-9 rounded-md border border-line2 bg-raised px-2">
              <option value="FULL">{dict.body.studio.fullLook}</option>
              <option value="SPOTLIGHT">{dict.body.studio.spotlightLabel}</option>
              <option value="STYLE">{dict.body.studio.styleLabel}</option>
              <option value="BRANDING">{dict.body.studio.brandingLabel}</option>
            </select>
            <button type="submit" data-save-template disabled={!canEdit || !name.trim() || taken} title={taken ? dict.body.studio.templateNameTakenDot : dict.body.studio.saveTemplateHint}
              className={chip(false, !canEdit || !name.trim() || taken)}>{dict.common.save}</button>
          </form>

          {taken && <p className="t-small" style={{ color: "#ffb86b" }}>{dict.body.studio.templateNameTaken}</p>}

          {st.orgTemplates === null ? <p className="t-body">{dict.common.loading}</p> : orgList.length === 0 ? (
            <p className="t-body">{dict.body.studio.noTemplatesFilter}</p>
          ) : (
            <ul aria-label={dict.body.studio.templates} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
              {orgList.map((t) => (
                <li key={t.id} data-template={t.id} className="flex items-center gap-2 rounded-lg border border-line2 bg-canvas px-2.5 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="t-panel min-w-0 truncate">{t.name}</span>
                      {kindBadge(t.kind)}
                      {t.is_builtin && <span className="t-small shrink-0">{dict.body.studio.builtIn}</span>}
                    </span>
                    <span className="t-small block truncate" title={t.description}>
                      {t.description || (t.is_builtin ? dict.body.studio.builtInPreset : dict.body.studio.organizationTemplate)}
                    </span>
                  </span>

                  {sure === t.id ? (
                    <>
                      <button type="button" data-confirm-delete={t.id} onClick={() => { st.deleteOrgTemplate(t, say); setSure(null); }} className={chip(false, false, true)}>{dict.body.studio.deleteBtn}</button>
                      <button type="button" onClick={() => setSure(null)} className={chip(false, false)}>{dict.body.studio.keepLabel}</button>
                    </>
                  ) : (
                    <span className="flex items-center gap-1">
                      {t.kind === "FULL" ? (
                        <>
                          <button type="button" data-apply-template={t.id} disabled={!canEdit} onClick={() => st.applyOrgTemplate(t, undefined, say)} title={dict.body.studio.applyAllSettings} className={chip(false, !canEdit)}>{dict.body.processing.filterAll}</button>
                          <button type="button" data-apply-spotlight={t.id} disabled={!canEdit} onClick={() => st.applyOrgTemplate(t, ["SPOTLIGHT"], say)} title={dict.body.studio.applySpotlightOnly} className={chip(false, !canEdit)}>{dict.body.studio.spotlightLabel}</button>
                          <button type="button" data-apply-style={t.id} disabled={!canEdit} onClick={() => st.applyOrgTemplate(t, ["STYLE"], say)} title={dict.body.studio.applyStyleOnly} className={chip(false, !canEdit)}>{dict.body.studio.styleLabel}</button>
                        </>
                      ) : (
                        <button type="button" data-apply-template={t.id} disabled={!canEdit} onClick={() => st.applyOrgTemplate(t, undefined, say)} title={dict.body.studio.applyKindSettings.replace("{a}", kindLabel(t.kind))} className={chip(false, !canEdit)}>{dict.body.studio.applyLabel}</button>
                      )}

                      {!t.is_builtin && (
                        <button type="button" aria-label={dict.body.studio.deleteTemplateAria.replace("{a}", t.name)} disabled={!canEdit} onClick={() => setSure(t.id)} className={chip(false, !canEdit)}>✕</button>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="t-small">{dict.body.studio.templatesSaveNote}
          </p>
        </>
      )}
    </div>
  );
}

type Slot = keyof Pick<SpotlightSettings, "competition_logo_id" | "custom_logo_id" | "music_id" | "intro_id" | "outro_id">;
const brandSlots = (d: Dictionary): Record<BrandAsset["kind"], [Slot, string][]> => ({
    COMPETITION_LOGO: [["competition_logo_id", d.body.workspace.useLabel]], CUSTOM_LOGO: [["custom_logo_id", d.body.workspace.useLabel]], MUSIC: [["music_id", d.body.workspace.useLabel]],
    REEL_VIDEO: [["intro_id", d.body.studio.introLabel], ["outro_id", d.body.studio.outroLabel]],
  });
const brandKind = (d: Dictionary): Record<BrandAsset["kind"], string> => ({ COMPETITION_LOGO: d.body.studio.competitionLogo, CUSTOM_LOGO: d.body.studio.logoLabel, MUSIC: d.body.reels.music, REEL_VIDEO: d.body.studio.introOutroVideo });

/** Graphics (logos, intro / outro videos) or Audio (music) of the organization; Use puts the asset into this reel's render */
function BrandList({ st, canEdit, audio, onPick, hit }: { st: Studio; canEdit: boolean; audio: boolean; onPick: () => void; hit: (a: BrandAsset) => boolean }) {
  const { t: dict } = useLocale();
  const s = st.reel?.settings;
  const list = (st.brand ?? []).filter((a) => (a.kind === "MUSIC") === audio && hit(a));
  const chipOn = (on: boolean, dis: boolean) =>
    `t-button rounded-md border px-3 py-1 ${on ? "border-ok bg-ok/15 text-white" : "border-line2 bg-raised"} ${dis ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`;
  const where = st.reel ? `/reels/${st.reel.id}` : "/reels";
  return (
    <div data-brand-list={audio ? "audio" : "graphics"} className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {!st.reel ? (
        <button type="button" onClick={onPick} className={`${chipOn(false, false)} self-center`}>{dict.body.studio.chooseReelEdit}</button>
      ) : st.brand === null ? <p className="t-body">{dict.common.loading}</p> : (
        <>
          {audio && (
            <button type="button" data-use-asset="none" disabled={!canEdit || !s?.music_id} onClick={() => st.setSettings({ music_id: null }, dict.body.studio.musicRemoved)}
              className={`${chipOn(!s?.music_id, !canEdit)} text-left`}>{s?.music_id ? dict.body.studio.noMusicUseMatch : dict.body.studio.noMusicCheck}</button>
          )}
          {list.length === 0 && <p className="t-body">{audio ? dict.body.studio.noMusicYet : dict.body.studio.noLogosYet}</p>}
          <ul aria-label={audio ? dict.body.reels.music : dict.body.studio.graphicsTab} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {list.map((a) => (
              <li key={a.id} data-asset={a.id} className="flex items-center gap-2.5 rounded-lg border border-line2 bg-canvas px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="t-panel block truncate">{a.name}</span>
                  <span className="t-body block truncate" style={{ color: a.rights_ok ? undefined : "#ff8a8a" }}>{brandKind(dict)[a.kind]} · {a.rights_ok ? dict.body.studio.rightsHolder.replace("{a}", a.rights_holder) : dict.body.studio.rightsNotInForceLower}</span>
                  {audio && a.rights_ok && <span className="mt-1 block"><BeatStatusRow musicId={a.id} canEdit={canEdit} /></span>}
                </span>
                {brandSlots(dict)[a.kind].map(([slot, label]) => {
                  const on = s?.[slot] === a.id, dis = !canEdit || !a.rights_ok;
                  return (
                    <button key={slot} type="button" data-use-asset={`${slot}:${a.id}`} aria-pressed={on} disabled={dis}
                      title={!a.rights_ok ? dict.body.studio.rightsNotInForce : !canEdit ? dict.body.studio.roleCannotEditReel : on ? dict.body.studio.takeOutReel : dict.body.studio.putInReel}
                      onClick={() => st.setSettings({ [slot]: on ? null : a.id }, on ? dict.body.studio.assetRemoved.replace("{a}", a.name) : dict.body.studio.assetAddedToReel.replace("{a}", a.name))} className={chipOn(on, dis)}>
                      {on ? `✓ ${label === dict.body.workspace.useLabel ? dict.body.studio.inReelBadge : label}` : label}</button>
                  );
                })}
              </li>
            ))}
          </ul>
          <p className="t-small">
            {dict.body.studio.uploadWithRights.replace("{a}", audio ? dict.body.studio.musicWord : dict.body.studio.logosVideosLower)} <a href={where} className="text-primary underline">{dict.body.studio.reelBuilderBranding}</a>{dict.body.studio.renderDrawsChosen}
          </p>
        </>
      )}
    </div>
  );
}
