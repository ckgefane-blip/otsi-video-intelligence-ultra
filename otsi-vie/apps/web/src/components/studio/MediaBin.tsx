"use client";
/**
 * Page 07 Clip Studio — the studio bin (SOT, Studio.dc.html).
 *
 * Clips: the reel's own clips (Segment 0, the Profile intro, is locked at
 * the top), searchable by label; click a clip to select it. The SOT's
 * bin is the reel's clips, not the suggested moments — clips come from
 * the Reel Builder, so the footer says so and links there. Looks: the
 * organization's saved looks (apply one to this reel). Effects: the
 * transitions on the cuts. Music: the organization's music (use one in
 * this reel). The old bin's suggested moments, Smart Bins and brand
 * graphics live on the Reel Builder / Library pages, where clips are
 * assembled; this bin edits what is already in the reel.
 */
import Link from "next/link";
import { useState } from "react";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { useLocale } from "@/lib/i18n";
import { TransitionsPanel } from "./EditPanels";
import { locate, type Studio } from "./useStudio";

export function MediaBin({ r, st, say, binTab, setBinTab }: { r: ReelState | null; st: Studio; say: (m: string) => void; binTab: number; setBinTab: (t: number) => void }) {
  const { t: dict } = useLocale();
  const s = dict.body.studio;
  const tab = binTab;
  const setTab = setBinTab;
  const [q, setQ] = useState("");
  const TABS = [s.csClips, s.csLooks, s.csEffects, dict.body.reels.music];
  const reel = st.reel;
  const needle = q.trim().toLowerCase();
  const clips = st.items.filter((p) => !needle || (p.clip.label ?? "").toLowerCase().includes(needle));
  const music = (st.brand ?? []).filter((a) => a.kind === "MUSIC" && (!needle || a.name.toLowerCase().includes(needle)));
  const orgLooks = (st.orgTemplates ?? []).filter((t) => !needle || t.name.toLowerCase().includes(needle));
  const reelLooks = (st.templates ?? []).filter((t) => !needle || t.name.toLowerCase().includes(needle));
  const edit = !!reel && !!r?.canEdit && !r.busy;
  const placed = st.items.find((p) => p.clip.id === r?.selectedClip) ?? locate(st.items, st.playhead)?.p ?? null;
  const can = edit;
  const why = () => say(!r?.canEdit ? s.roleViewReel : s.savingPrevChange);

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-line" aria-label={s.csClips}>
      <div className="tabs flex flex-nowrap gap-0 border-b border-line px-1.5" role="tablist" style={{ flexWrap: "nowrap" }}>
        {TABS.map((l, i) => (
          <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className={`tab ${tab === i ? "on" : ""}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="border-b border-line px-3 py-2.5">
        <label htmlFor="cs-bin-search" className="sr-only">{s.csSearchBin}</label>
        <input id="cs-bin-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={s.csSearchClips}
          className="in h-8 w-full" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-2.5">
        {tab === 0 && (
          <>
            {/* the Profile intro is the reel's own first segment. The line reads "— · 16:9" with no player
                (user's audit A27) — the name slot is the player's name when one is recorded, else a dash. */}
            <div className="flex items-center gap-2.5">
              <div className="grid aspect-[16/9] w-24 shrink-0 place-items-center rounded-[5px] border-[1.5px] bg-canvas" style={{ borderColor: "rgb(var(--primary))" }}>
                <svg className="i s" viewBox="0 0 24 24" aria-hidden="true" style={{ color: "rgb(var(--primary))" }} fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              </div>
              <span className="flex flex-col">
                <span className="font-normal">{s.csProfileIntro}</span>
                <span className="t-small text-muted">{reel?.player?.display_name ?? "—"} · {reel?.aspect ?? "16:9"}</span>
              </span>
            </div>
            {/* SOT (Studio.dc.html): with no reel the bin shows this empty state, not a "Choose a reel to edit"
                button — the footer below links to the Reel Builder, where a reel is opened. */}
            {!reel || clips.length === 0 ? (
              <div className="empty px-2 py-4">
                <h3>{s.csNoClipsLoaded}</h3>
                <p>{s.csOpenReelFromBuilder}</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5" aria-label={s.csClips}>
                {clips.map((p) => {
                  const sel = p.clip.id === r?.selectedClip;
                  return (
                    <li key={p.clip.id}>
                      <button type="button" aria-pressed={sel} onClick={() => { r?.setSelectedClip(p.clip.id); st.setPlayhead(p.start); }}
                        className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left ${sel ? "border-primary bg-raised" : "border-line/70 hover:border-primary/60"}`}>
                        <span className="t-tc shrink-0 text-muted">{((p.clip.out_pts_us - p.clip.in_pts_us) / 1e6).toFixed(1)} s</span>
                        <span className="min-w-0 flex-1 truncate">{p.clip.label ?? s.clipIndex.replace("{a}", String(p.index + 1))}</span>
                        <span className="t-small shrink-0 text-muted">#{p.index + 1}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {tab === 1 && (
          <>
            {st.orgTemplates === null && st.templates === null ? <p className="t-body text-muted">{dict.common.loading}</p>
              : orgLooks.length === 0 && reelLooks.length === 0 ? <p className="t-body px-2 py-4 text-center text-muted">{s.noTemplatesFilter}</p> : (
              <ul className="flex flex-col gap-1.5">
                {orgLooks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-lg border border-line2 bg-canvas px-2.5 py-2">
                    <span className="min-w-0 flex-1 truncate t-panel">{t.name}</span>
                    <button type="button" disabled={!edit} onClick={() => st.applyOrgTemplate(t, undefined, say)} className="vie-btn vie-btn-sm shrink-0 disabled:opacity-50">
                      {s.applyLabel}
                    </button>
                  </li>
                ))}
                {reelLooks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-lg border border-line2 bg-canvas px-2.5 py-2">
                    <span className="min-w-0 flex-1 truncate t-panel">{t.name}</span>
                    <button type="button" disabled={!edit} onClick={() => st.applyTemplate(t, say)} className="vie-btn vie-btn-sm shrink-0 disabled:opacity-50">
                      {s.applyLabel}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tab === 2 && (
          reel ? <TransitionsPanel st={st} placed={placed} can={can} why={why} /> : <p className="t-body px-2 py-4 text-center text-muted">{s.chooseReelEdit}</p>
        )}

        {tab === 3 && (
          <>
            {st.brand === null ? <p className="t-body text-muted">{dict.common.loading}</p>
              : music.length === 0 ? <p className="t-body px-2 py-4 text-center text-muted">{s.noMusicYet}</p> : (
              <>
                <button type="button" disabled={!edit || !reel?.settings.music_id}
                  onClick={() => st.setSettings({ music_id: null }, s.musicRemoved)}
                  className="vie-btn vie-btn-sm self-start disabled:opacity-50">{s.noMusicUseMatch}</button>
                <ul className="flex flex-col gap-1.5">
                  {music.map((a) => {
                    const on = reel?.settings.music_id === a.id;
                    return (
                      <li key={a.id} className="flex items-center gap-2 rounded-lg border border-line2 bg-canvas px-2.5 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="t-panel block truncate">{a.name}</span>
                          <span className="t-small block truncate" style={{ color: a.rights_ok ? undefined : "#ff8a8a" }}>
                            {a.rights_ok ? s.rightsHolder.replace("{a}", a.rights_holder) : s.rightsNotInForceLower}
                          </span>
                        </span>
                        <button type="button" aria-pressed={on} disabled={!edit || !a.rights_ok}
                          title={!a.rights_ok ? s.rightsNotInForce : undefined}
                          onClick={() => st.setSettings({ music_id: on ? null : a.id }, on ? s.musicRemoved : s.assetAddedToReel.replace("{a}", a.name))}
                          className={`vie-btn vie-btn-sm shrink-0 disabled:opacity-50 ${on ? "border-primary text-primary" : ""}`}>
                          {on ? `✓ ${s.inReelBadge}` : dict.body.workspace.useLabel}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <span className="t-small flex-1 text-muted">{s.csClipsFromBuilder}</span>
        <Link href="/reels" className="vie-btn vie-btn-sm">{s.csReelBuilder}</Link>
      </div>
    </aside>
  );
}
