"use client";
/**
 * Page 07 Section 01 — editor header and action toolbar (approved reference 07_CLIP_STUDIO, "title row").
 *
 * Back opens the reel in the Reel Builder. Save Project names the reel (PATCH /v1/reels/:id; every clip edit is already saved by the
 * server as it is made). Undo / Redo replay the opposite saved edit. AI Edit adds every moment the engine suggests for the reel's
 * confirmed player that is not in the reel yet (suggestions, not detected events). Export starts a real render of the reel
 * (POST /v1/reels/:id/renders) in the chosen codec; its progress and the file appear on the Export page.
 * E5 (ADR-068): task layouts Edit · Colour · Review (which inspector tab, Adjustments sections and Media Bin tab are open; kept per
 * browser), the "?" button (since A.9, ADR-071, it opens the app's one keyboard map, components/shell/KeyboardMap.tsx) and
 * Ctrl + Z / Ctrl + Shift + Z / Ctrl + Y.
 */
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { HistoryDialog } from "@/components/reels/HistoryDialog";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { Btn, IN, type Ui } from "./kit";
import { openKeymap } from "@/lib/keymap";
import { typing } from "./shortcuts";
import { LAYOUTS, type Layout, type Studio } from "./useStudio";

export function StudioHeader({ r, st, ui, note }: { r: ReelState | null; st: Studio; ui: Ui; note: string | null }) {
  const { t: dict } = useLocale();
  const layoutText: Record<Layout, { label: string; hint: string }> = {
    EDIT: { label: dict.body.studio.layoutEdit, hint: dict.body.studio.layoutEditHint },
    COLOUR: { label: dict.body.studio.layoutColour, hint: dict.body.studio.layoutColourHint },
    REVIEW: { label: dict.body.studio.layoutReview, hint: dict.body.studio.layoutReviewHint },
  };
  const reel = st.reel;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [menu, setMenu] = useState(false);
  const [hist, setHist] = useState(false);                              // B.1 (ADR-081): the reel's History
  const edit = !!reel && !!r?.canEdit && !r.busy;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === "z" || k === "y")) {
        e.preventDefault();
        const redo = k === "y" || e.shiftKey;
        if (!edit) return ui.say(!reel ? dict.body.studio.chooseReelFirst : !r?.canEdit ? dict.body.studio.roleViewReel : dict.body.studio.savingPrevChange);
        if (redo) { if (st.canRedo) st.redo(); else ui.say(dict.body.studio.nothingRedo); } else if (st.canUndo) st.undo(); else ui.say(dict.body.studio.nothingUndo);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  const missing = (r?.moments ?? []).filter((m) => !m.in_reel);
  const rendering = !!reel?.latest_render && ["QUEUED", "RUNNING"].includes(reel.latest_render.state);
  const render = (codec: "h264" | "av1" | "vp9") => {
    setMenu(false);
    r?.run(async () => {
      await api(`/v1/reels/${reel!.id}/renders`, { method: "POST", json: { codec, bitrate_mbps: 8 },
        headers: { "idempotency-key": `render-${reel!.id}-${reel!.version}-${codec}-${Date.now()}` } });
    }, dict.body.studio.renderingStarted.replace("{a}", codec.toUpperCase()));
  };
  /** act only on a reel the person may edit; otherwise open the chooser or say why */
  const need = (f: () => void) => () => {
    if (!reel) ui.pick();
    else if (!r?.canEdit) ui.say(dict.body.studio.roleViewReel);
    else if (r.busy) ui.say(dict.body.studio.savingPrevChange);
    else f();
  };
  const addSuggested = () => r!.run(async () => {
    for (const m of missing) await api(`/v1/reels/${reel!.id}/clips`, { method: "POST", json: { in_pts_us: m.in_pts_us, out_pts_us: m.out_pts_us, origin: "SUGGESTED", label: m.label } });
  }, dict.body.studio.suggestedMomentsAdded.replace("{a}", String(missing.length)));

  return (
    <section aria-label={dict.body.studio.editorHeader} data-section="p07-s01" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Link href={reel ? `/reels/${reel.id}` : "/reels"} aria-label={dict.body.studio.backToReelBuilder} className="vie-btn" title={dict.body.studio.backToReelBuilder}>
        ←
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="t-page">
          {dict.pages.studio.title} <span className="text-primary">/</span> {dict.body.studio.timelineEditor}
        </h1>
        <p className="t-small truncate">
          {reel ? `${reel.name}${reel.player ? ` · ${reel.player.display_name}` : ""}${dict.body.studio.everyEditSavedSuffix}`
            : dict.body.studio.studioSubtitle}
        </p>
      </div>

      <div role="radiogroup" aria-label={dict.body.studio.taskLayout} className="flex items-center gap-1">
        {(Object.keys(LAYOUTS) as Layout[]).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={st.layout === l} data-layout={l} data-pro title={layoutText[l].hint}
            onClick={() => { st.setLayout(l); ui.say(layoutText[l].hint); }}
            className={`vie-btn vie-btn-sm ${st.layout === l ? "border-primary bg-[#0f4f9a] text-white" : ""}`}>{layoutText[l].label}</button>
        ))}
        <button type="button" aria-label={dict.body.studio.keyboardShortcuts} data-shortcuts onClick={openKeymap} title={dict.body.studio.keyboardShortcutsTitle}
          className="vie-btn vie-btn-sm font-semibold">?</button>
        <button type="button" aria-label={dict.body.studio.historyReel} data-history-open disabled={!reel} onClick={() => setHist(true)} title={dict.body.studio.historyTitle}
          className="vie-btn vie-btn-sm disabled:opacity-50">{dict.body.reels.history}{r?.history?.entries.length ? ` (${r.history.entries.length})` : ""}</button>
      </div>
      <HistoryDialog r={r} open={hist} onOpenChange={setHist} />
      <div className="flex items-center gap-1.5">
        <Btn label={dict.body.studio.saveProjectName} style={IN} dim={!edit}
          onClick={need(() => { setName(reel!.name); setNaming(true); })}>
          {dict.body.reels.saveProject}
        </Btn>
        <Btn label={dict.body.studio.undo} style={IN} dim={!edit || !st.canUndo} onClick={need(() => (st.canUndo ? st.undo() : ui.say(dict.body.studio.nothingUndo)))}>
          ↶ {dict.body.studio.undo}
        </Btn>
        <Btn label={dict.body.studio.redo} style={IN} dim={!edit || !st.canRedo} onClick={need(() => (st.canRedo ? st.redo() : ui.say(dict.body.studio.nothingRedo)))}>
          ↷ {dict.body.studio.redo}
        </Btn>
        <Btn label={dict.body.studio.suggestAddMoments.replace("{a}", String(missing.length))} dim={!edit || missing.length === 0}
          style={{ background: "#2a1ab0", borderRadius: 8, border: "1px solid #5a4af0", color: "#fff" }}
          onClick={need(() => (missing.length ? addSuggested()
            : ui.say(r?.moments?.length ? dict.body.studio.allMomentsInReel : dict.body.studio.noMomentsSuggested)))}>
          ✦ {dict.body.studio.suggestLabel}
        </Btn>
        <span className="relative">
          <Btn label={rendering ? dict.body.studio.renderingDots : dict.body.studio.exportRenderReel} dim={!edit || !reel?.clips.length || rendering}
            style={{ background: "#0a84ff", borderRadius: 8, border: "1px solid transparent", color: "#fff" }} pressed={menu}
            onClick={need(() => (!reel!.clips.length ? ui.say(dict.body.studio.addClipsBeforeExport)
              : rendering ? ui.say(dict.body.studio.renderAlreadyRunning) : setMenu((m) => !m)))}>
            {rendering ? dict.body.studio.renderingLabel : dict.body.studio.exportLabel} ▾
          </Btn>
          {menu && (
            <div role="menu" aria-label={dict.body.studio.exportFormat} className="absolute right-0 top-full z-20 mt-1 w-[230px] rounded-lg border border-line2 bg-panel p-1.5 t-body shadow-xl">
              {([["h264", "MP4 · H.264"], ["av1", "MP4 · AV1"], ["vp9", "WebM · VP9"]] as const).map(([c, l]) => (
                <button key={c} role="menuitem" type="button" onClick={() => render(c)}
                  className="block w-full rounded px-2 py-1.5 text-left hover:bg-raised">{l}</button>
              ))}
            </div>
          )}
        </span>
      </div>
      {(note || r?.msg) && (
        <p className="t-small w-full truncate" style={{ color: note ? "#ffc66d" : r!.msg!.ok ? "#3ee6a8" : "#ff8a8a" }}>
          <span role="status">{note ?? r!.msg!.text}</span>
        </p>
      )}

      <Dialog.Root open={naming} onOpenChange={setNaming}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 t-body shadow-2xl">
            <Dialog.Title className="t-panel">{dict.body.studio.saveProjectLabel}</Dialog.Title>
            <Dialog.Description className="mb-3 t-small">{dict.body.studio.editsSavedNameReel}</Dialog.Description>
            <form onSubmit={(e) => { e.preventDefault(); setNaming(false); r?.run(() => api(`/v1/reels/${reel!.id}`, { method: "PATCH", json: { version: reel!.version, name } }), dict.body.studio.projectSaved); }}>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required aria-label={dict.body.studio.reelName}
                className="mb-3 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
              <div className="flex justify-end gap-2">
                <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</Dialog.Close>
                <button type="submit" className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">{dict.common.save}</button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
