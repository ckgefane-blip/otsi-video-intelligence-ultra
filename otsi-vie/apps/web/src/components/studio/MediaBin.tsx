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
import { BeatStatusRow } from "./BeatGridInfo";
import { binCount, useSmartBins } from "@/components/library/SmartBins";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { Btn, IN } from "./kit";
import type { Studio } from "./useStudio";

const TABS: [string, number, number][] = [["Media Bin", 68, 41], ["Graphics", 232, 205], ["Audio", 389, 362], ["Templates", 523, 496]];
const COLS = 3, TW = 184, TH = 104, GX = 9, GY = 52, X0 = 48, Y0 = 396;
const dur = (m: ReelMoment) => `${((m.out_pts_us - m.in_pts_us) / 1e6).toFixed(1)} s`;
export const MOMENT_MIME = "application/x-otsi-moment";

export function MediaBin({ r, st, onPick, say }: { r: ReelState | null; st: Studio; onPick: () => void; say: (m: string) => void }) {
  const tab = st.binTab, setTab = st.setBinTab;
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
  const brandHit = (a: BrandAsset) => !needle || `${a.name} ${KIND[a.kind]}`.toLowerCase().includes(needle);
  const tplHit = (t: ReelTemplate) => !needle || `${t.name} ${t.structure ? "slots" : ""}`.toLowerCase().includes(needle);
  const counts = [shown.length, (st.brand ?? []).filter((a) => a.kind !== "MUSIC" && brandHit(a)).length, (st.brand ?? []).filter((a) => a.kind === "MUSIC" && brandHit(a)).length,
    (st.templates ?? []).filter(tplHit).length];
  const edit = !!st.reel && !!r?.canEdit && !r.busy;
  const empty = !st.reel ? "Choose a reel to edit" : r?.moments === null || (binId && !binHits) ? "Loading…"
    : binId && all.length === 0 ? "None of his suggested moments holds what this bin finds" : all.length === 0 ? "No clips in this folder yet" : shown.length === 0 ? "No moment matches" : null;

  return (
    <section aria-label="Media bin / asset browser" data-section="p07-s02" data-moments={String(shown.length)}>
      <P x={28} y={210} w={627} h={610} />
      <div role="tablist" aria-label="Assets">
        {TABS.map(([l, x], i) => (
          <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className="absolute"
            style={{ left: u(x - 20), top: u(220 - 101), width: u(l.length * 12 + 40), height: u(44), padding: 0, border: 0, background: "transparent", cursor: "pointer", font: "inherit" }}>
            <T o={[x - 20, 220]} x={x} y={240} size={22} weight={tab === i ? 600 : 400} color={tab === i ? "#33a8ff" : "#cfe0f5"} as="span">{needle ? `${l} ${counts[i]}` : l}</T>
          </button>
        ))}
      </div>
      <B x={TABS[tab]![2]} y={264} w={145} h={3} style={{ background: "#1e90ff" }} />
      <B x={30} y={267} w={624} h={1} style={{ background: "#12335f" }} />

      <label className="absolute" style={{ left: u(48), top: u(284 - 101), width: u(512), height: u(52), boxSizing: "border-box", border: `${u(1.5)} solid #17406f`, borderRadius: u(8), background: "#041022" }}>
        <Ic o={[48, 284]} x={75} y={310} k="srch" size={26} color="#cfe0f5" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clips, players, tags..." aria-label="Search the media bin"
          style={{ position: "absolute", left: u(102 - 48), top: 0, width: u(400), height: "100%", background: "transparent", border: 0, outline: "none",
            color: "#e3eefb", fontSize: u(20), fontFamily: "inherit" }} className="placeholder:text-[#9fb3cc]" />
      </label>
      {tab === 0 ? (
        <>
          <Btn x={583} y={284} w={52} h={52} label={hideUsed ? "Show all moments" : "Hide moments already in the reel"} pressed={hideUsed}
            style={{ ...IN, ...(hideUsed ? { background: "#0d3a78" } : {}) }} onClick={() => setHideUsed((h) => !h)}>
            <Ic o={[583, 284]} x={609} y={310} k="flt" size={26} color="#cfe0f5" />
          </Btn>
          <Ic x={60} y={368} k="fold" size={26} color="#cfe0f5" />
          <nav aria-label="Folder">
            <Ic x={88} y={368} k="gt" size={14} color="#8ea3bf" />
            <T x={102} y={368} size={20} color="#e3eefb">Folders</T>
            <Ic x={182} y={368} k="gt" size={14} color="#8ea3bf" />
            {st.reel && bins && bins.length > 0 ? (
              <select value={binId} onChange={(e) => setBinId(e.target.value)} aria-label="Show suggested moments or a Smart Bin" data-bin-select className="absolute"
                style={{ left: u(190), top: u(352 - 101), width: u(440), height: u(34), background: "#041022", border: `${u(1)} solid #17406f`, borderRadius: u(6),
                  color: "#e3eefb", fontSize: u(19), fontFamily: "inherit" }}>
                <option value="">{st.reel.player ? `${st.reel.player.display_name} · suggested moments` : "Suggested moments"}</option>
                {bins.map((b) => <option key={b.id} value={b.id}>{`Smart Bin: ${b.name} (${binCount(b)})`}</option>)}
              </select>
            ) : <T x={196} y={368} size={20} color="#e3eefb">{st.reel?.player ? `${st.reel.player.display_name} · suggested moments` : "All media"}</T>}
          </nav>
          {!st.reel ? (
            <button type="button" onClick={onPick} className="absolute" style={{ left: u(191), top: u(570 - 101), width: u(300), height: u(40), borderRadius: u(8),
              border: `${u(1.5)} solid #1d4f8a`, background: "#0a2447", color: "#e3eefb", fontSize: u(20), cursor: "pointer", fontFamily: "inherit" }}>Choose a reel to edit</button>
          ) : empty ? <T x={341} y={590} size={20} color="#8ea3bf" align="center">{empty}</T> : (
            <ul aria-label="Suggested moments" className="absolute" style={{ left: u(X0), top: u(Y0 - 101), width: u(590), height: u(410), margin: 0, padding: 0, listStyle: "none", overflowY: "auto" }}>
              {shown.map((m, i) => {
                const x = (i % COLS) * (TW + GX), y = Math.floor(i / COLS) * (TH + GY);
                const sel = st.preview?.in_pts_us === m.in_pts_us && st.preview.out_pts_us === m.out_pts_us;
                return (
                  <li key={`${m.in_pts_us}-${m.out_pts_us}`} draggable={edit} onDragStart={(e) => e.dataTransfer.setData(MOMENT_MIME, JSON.stringify(m))}
                    style={{ position: "absolute", left: u(x), top: u(y), width: u(TW), height: u(TH + GY - 8) }} data-moment={m.in_pts_us}>
                    <button type="button" aria-label={`${m.label}, ${dur(m)}${m.in_reel ? ", in the reel" : ""}: show in the preview`} aria-pressed={sel}
                      onClick={() => { st.setPreview(m); r?.setSelectedClip(null); }} onDoubleClick={() => edit && st.add(m)}
                      style={{ position: "absolute", inset: `0 0 ${u(GY - 8)} 0`, padding: 0, cursor: edit ? "grab" : "pointer", borderRadius: u(5),
                        border: sel ? `${u(2)} solid #33a8ff` : 0,
                        background: "radial-gradient(ellipse at 45% 85%,#6fb8ee 0,#2a6fb8 35%,transparent 70%),linear-gradient(180deg,#27487a,#2d7a3a 40%,#1d5a28)" }}>
                      <span style={{ position: "absolute", right: u(8), bottom: u(6), padding: `${u(2)} ${u(8)}`, borderRadius: u(4), background: "rgba(0,10,25,.8)", fontSize: u(17), fontWeight: 600, color: "#fff" }}>{dur(m)}</span>
                      {m.in_reel && <span title="In the reel" style={{ position: "absolute", left: u(8), top: u(6), color: "#3ee6a8", fontSize: u(18) }}>✓</span>}
                    </button>
                    <span style={{ position: "absolute", left: 0, top: u(TH + 6), width: u(TW - 34), fontSize: u(16), color: "#cfe0f5", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.label}</span>
                    {edit && !m.in_reel && (
                      <button type="button" aria-label={`Add ${m.label} to the reel`} onClick={() => st.add(m)}
                        style={{ position: "absolute", right: 0, top: u(TH + 2), width: u(28), height: u(28), padding: 0, borderRadius: u(6), border: `${u(1.5)} solid #1d4f8a`,
                          background: "#0a2447", color: "#fff", cursor: "pointer", fontSize: u(18), lineHeight: 1 }}>+</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <B x={643} y={400} w={5} h={120} style={{ background: "#17406f", borderRadius: u(3) }} />
        </>
      ) : tab === 3 ? <Templates st={st} canEdit={edit} onPick={onPick} say={say} hit={tplHit} /> : <BrandList st={st} canEdit={edit} audio={tab === 2} onPick={onPick} hit={brandHit} />}
    </section>
  );
}

/** ADR-109 (v3 Phase C.10): Organization templates for Spotlight, Style and Branding; save this reel's settings, apply modularly, or delete */
function Templates({ st, canEdit, onPick, say, hit }: { st: Studio; canEdit: boolean; onPick: () => void; say: (m: string) => void; hit: (t: any) => boolean }) {
  const [name, setName] = useState("");
  const [saveKind, setSaveKind] = useState<OrgTemplateKind>("FULL");
  const [kindFilter, setKindFilter] = useState<"ALL" | OrgTemplateKind>("ALL");
  const [sure, setSure] = useState<string | null>(null);

  const orgList = (st.orgTemplates ?? []).filter((t) => {
    if (kindFilter !== "ALL" && t.kind !== kindFilter && t.kind !== "FULL") return false;
    return hit(t);
  });

  const cell = { fontSize: u(17), color: "#cfe0f5", margin: 0 } as const;
  const chip = (dis: boolean, warn = false, active = false) => ({
    padding: `${u(4)} ${u(10)}`, borderRadius: u(6), fontSize: u(14), fontFamily: "inherit", cursor: dis ? "not-allowed" : "pointer",
    border: `${u(1.5)} solid ${warn ? "#c04a4a" : active ? "#33a8ff" : "#1d4f8a"}`,
    background: warn ? "#3a1010" : active ? "#0d3a78" : "#0a2447", color: active ? "#fff" : "#cfe0f5", opacity: dis ? 0.5 : 1
  });

  const taken = !!orgList.some((t) => t.name.toLowerCase() === name.trim().toLowerCase());

  const kindBadge = (k: OrgTemplateKind) => {
    const bg = k === "SPOTLIGHT" ? "#0e4b75" : k === "STYLE" ? "#4a1d75" : k === "BRANDING" ? "#135c3b" : "#705312";
    const text = k === "SPOTLIGHT" ? "#33a8ff" : k === "STYLE" ? "#d292ff" : k === "BRANDING" ? "#3ee6a8" : "#f5d02e";
    return <span style={{ fontSize: u(12), fontWeight: 700, padding: `${u(2)} ${u(6)}`, borderRadius: u(4), background: bg, color: text }}>{k}</span>;
  };

  return (
    <div className="absolute" data-templates={String(orgList.length)} style={{ left: u(48), top: u(350 - 101), width: u(590), height: u(455), display: "flex", flexDirection: "column", gap: u(8) }}>
      {!st.reel ? (
        <button type="button" onClick={onPick} style={{ ...chip(false), alignSelf: "center", marginTop: u(260) }}>Choose a reel to edit</button>
      ) : (
        <>
          {/* Quick kind filter pills */}
          <div style={{ display: "flex", gap: u(6), alignItems: "center" }}>
            <span style={{ fontSize: u(14), color: "#8ea3bf", fontWeight: 600 }}>Filter:</span>
            {(["ALL", "SPOTLIGHT", "STYLE", "BRANDING", "FULL"] as const).map((k) => (
              <button key={k} type="button" data-filter-kind={k} onClick={() => setKindFilter(k)} style={chip(false, false, kindFilter === k)}>
                {k === "ALL" ? "All" : k}
              </button>
            ))}
          </div>

          {/* Save new template row */}
          <form style={{ display: "flex", gap: u(6) }} onSubmit={(e) => {
            e.preventDefault();
            if (canEdit && name.trim() && !taken) {
              st.saveOrgTemplate(name.trim(), saveKind); setName("");
            }
          }}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name new template…" aria-label="Template name" disabled={!canEdit}
              style={{ flex: 1, height: u(38), padding: `0 ${u(10)}`, borderRadius: u(6), border: `${u(1.5)} solid #17406f`, background: "#041022", color: "#e3eefb", fontSize: u(15), fontFamily: "inherit", outline: "none" }} />
            <select value={saveKind} onChange={(e) => setSaveKind(e.target.value as OrgTemplateKind)} disabled={!canEdit}
              aria-label="Template section"
              style={{ height: u(38), padding: `0 ${u(8)}`, borderRadius: u(6), border: `${u(1.5)} solid #17406f`, background: "#0a2447", color: "#e3eefb", fontSize: u(14), fontFamily: "inherit" }}>
              <option value="FULL">Full Look</option>
              <option value="SPOTLIGHT">Spotlight</option>
              <option value="STYLE">Style</option>
              <option value="BRANDING">Branding</option>
            </select>
            <button type="submit" data-save-template disabled={!canEdit || !name.trim() || taken} title={taken ? "A template has that name: choose another name" : "Save this reel's settings as an organization template"}
              style={chip(!canEdit || !name.trim() || taken)}>Save</button>
          </form>

          {taken && <p style={{ ...cell, fontSize: u(14), color: "#ffb86b" }}>A template has that name: choose another name.</p>}

          {st.orgTemplates === null ? <p style={cell}>Loading…</p> : orgList.length === 0 ? (
            <p style={cell}>No templates match this filter. Save this reel's settings above to reuse across the team.</p>
          ) : (
            <ul aria-label="Templates" style={{ margin: 0, padding: 0, listStyle: "none", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: u(6) }}>
              {orgList.map((t) => (
                <li key={t.id} data-template={t.id} style={{ display: "flex", alignItems: "center", gap: u(8), padding: `${u(6)} ${u(10)}`, borderRadius: u(8), border: `${u(1.5)} solid #17406f`, background: "#041022" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: u(8) }}>
                      <span style={{ fontSize: u(16), fontWeight: 600, color: "#e3eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                      {kindBadge(t.kind)}
                      {t.is_builtin && <span style={{ fontSize: u(12), color: "#8ea3bf" }}>Built-in</span>}
                    </span>
                    <span style={{ display: "block", fontSize: u(13), color: "#8ea3bf", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={t.description}>
                      {t.description || (t.is_builtin ? "Built-in preset" : "Organization template")}
                    </span>
                  </span>

                  {sure === t.id ? (
                    <>
                      <button type="button" data-confirm-delete={t.id} onClick={() => { st.deleteOrgTemplate(t, say); setSure(null); }} style={chip(false, true)}>Delete</button>
                      <button type="button" onClick={() => setSure(null)} style={chip(false)}>Keep</button>
                    </>
                  ) : (
                    <div style={{ display: "flex", gap: u(4), alignItems: "center" }}>
                      {t.kind === "FULL" ? (
                        <>
                          <button type="button" data-apply-template={t.id} disabled={!canEdit} onClick={() => st.applyOrgTemplate(t, undefined, say)} title="Apply all settings (Spotlight, Style, Branding)" style={chip(!canEdit)}>All</button>
                          <button type="button" data-apply-spotlight={t.id} disabled={!canEdit} onClick={() => st.applyOrgTemplate(t, ["SPOTLIGHT"], say)} title="Apply Spotlight settings only" style={chip(!canEdit)}>Spotlight</button>
                          <button type="button" data-apply-style={t.id} disabled={!canEdit} onClick={() => st.applyOrgTemplate(t, ["STYLE"], say)} title="Apply Style settings only" style={chip(!canEdit)}>Style</button>
                        </>
                      ) : (
                        <button type="button" data-apply-template={t.id} disabled={!canEdit} onClick={() => st.applyOrgTemplate(t, undefined, say)} title={`Apply ${t.kind} settings`} style={chip(!canEdit)}>Apply</button>
                      )}

                      {!t.is_builtin && (
                        <button type="button" aria-label={`Delete template ${t.name}`} disabled={!canEdit} onClick={() => setSure(t.id)} style={chip(!canEdit)}>✕</button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p style={{ ...cell, fontSize: u(13), color: "#8ea3bf" }}>
            Templates save Spotlight, Style and Branding settings to share across your organization. Apply selectively without overwriting your other settings.
          </p>
        </>
      )}
    </div>
  );
}

type Slot = keyof Pick<SpotlightSettings, "competition_logo_id" | "custom_logo_id" | "music_id" | "intro_id" | "outro_id">;
const SLOTS: Record<BrandAsset["kind"], [Slot, string][]> = {
  COMPETITION_LOGO: [["competition_logo_id", "Use"]], CUSTOM_LOGO: [["custom_logo_id", "Use"]], MUSIC: [["music_id", "Use"]],
  REEL_VIDEO: [["intro_id", "Intro"], ["outro_id", "Outro"]],
};
const KIND: Record<BrandAsset["kind"], string> = { COMPETITION_LOGO: "Competition logo", CUSTOM_LOGO: "Logo", MUSIC: "Music", REEL_VIDEO: "Intro / outro video" };

/** Graphics (logos, intro / outro videos) or Audio (music) of the organization; Use puts the asset into this reel's render */
function BrandList({ st, canEdit, audio, onPick, hit }: { st: Studio; canEdit: boolean; audio: boolean; onPick: () => void; hit: (a: BrandAsset) => boolean }) {
  const s = st.reel?.settings;
  const list = (st.brand ?? []).filter((a) => (a.kind === "MUSIC") === audio && hit(a));
  const cell = { fontSize: u(17), color: "#cfe0f5", margin: 0 } as const;
  const chip = (on: boolean, dis: boolean) => ({ padding: `${u(4)} ${u(12)}`, borderRadius: u(6), fontSize: u(16), fontFamily: "inherit", cursor: dis ? "not-allowed" : "pointer",
    border: `${u(1.5)} solid ${on ? "#3ee6a8" : "#1d4f8a"}`, background: on ? "rgba(62,230,168,.15)" : "#0a2447", color: "#fff", opacity: dis ? 0.5 : 1 });
  const where = st.reel ? `/reels/${st.reel.id}` : "/reels";
  return (
    <div className="absolute" data-brand-list={audio ? "audio" : "graphics"} style={{ left: u(48), top: u(350 - 101), width: u(590), height: u(455), display: "flex", flexDirection: "column", gap: u(10) }}>
      {!st.reel ? (
        <button type="button" onClick={onPick} style={{ ...chip(false, false), alignSelf: "center", marginTop: u(260) }}>Choose a reel to edit</button>
      ) : st.brand === null ? <p style={cell}>Loading…</p> : (
        <>
          {audio && (
            <button type="button" data-use-asset="none" disabled={!canEdit || !s?.music_id} onClick={() => st.setSettings({ music_id: null }, "Music removed")}
              style={{ ...chip(!s?.music_id, !canEdit), textAlign: "left" }}>{s?.music_id ? "No music: use the clips' match sound" : "✓ No music: the clips' match sound"}</button>
          )}
          {list.length === 0 && <p style={cell}>{audio ? "No music uploaded yet." : "No logos or intro / outro videos uploaded yet."}</p>}
          <ul aria-label={audio ? "Music" : "Graphics"} style={{ margin: 0, padding: 0, listStyle: "none", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: u(8) }}>
            {list.map((a) => (
              <li key={a.id} data-asset={a.id} style={{ display: "flex", alignItems: "center", gap: u(10), padding: `${u(8)} ${u(12)}`, borderRadius: u(8), border: `${u(1.5)} solid #17406f`, background: "#041022" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: u(18), fontWeight: 600, color: "#e3eefb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                  <span style={{ display: "block", fontSize: u(15), color: a.rights_ok ? "#8ea3bf" : "#ff8a8a" }}>{KIND[a.kind]} · {a.rights_ok ? `rights: ${a.rights_holder}` : "rights not in force"}</span>
                  {audio && a.rights_ok && <div style={{ marginTop: u(4) }}><BeatStatusRow musicId={a.id} canEdit={canEdit} /></div>}
                </span>
                {SLOTS[a.kind].map(([slot, label]) => {
                  const on = s?.[slot] === a.id, dis = !canEdit || !a.rights_ok;
                  return (
                    <button key={slot} type="button" data-use-asset={`${slot}:${a.id}`} aria-pressed={on} disabled={dis}
                      title={!a.rights_ok ? "Its rights are not in force" : !canEdit ? "Your role cannot edit this reel" : on ? "Take it out of the reel" : "Put it in the reel"}
                      onClick={() => st.setSettings({ [slot]: on ? null : a.id }, on ? `${a.name} removed` : `${a.name} added to the reel`)} style={chip(on, dis)}>
                      {on ? `✓ ${label === "Use" ? "In the reel" : label}` : label}</button>
                  );
                })}
              </li>
            ))}
          </ul>
          <p style={{ ...cell, fontSize: u(15), color: "#8ea3bf" }}>
            Upload {audio ? "music" : "logos and videos"} with their rights in the <a href={where} style={{ color: "#33a8ff", textDecoration: "underline" }}>Reel Builder (Branding)</a>. The render draws what is chosen here.
          </p>
        </>
      )}
    </div>
  );
}
