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
import { Ic, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { Btn, frame, IN, type Ui } from "./kit";
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
    <section aria-label={dict.body.studio.editorHeader} data-section="p07-s01">
      <Link href={reel ? `/reels/${reel.id}` : "/reels"} aria-label={dict.body.studio.backToReelBuilder} className={`${s.a} ${s.framed}`}
        style={{ left: u(28), top: u(120 - 101), width: u(64), height: u(62), ...IN }}>
        <Ic o={[28, 120]} x={60} y={151} k={dict.body.analysis.shirtBack} size={32} color="#33a8ff" />
      </Link>
      <h1 style={{ margin: 0, fontSize: "inherit" }}>
        <T as="span" x={117} y={139} size={36} weight={700}>{dict.pages.studio.title}</T>{" "}
        <T as="span" x={303} y={139} size={36} weight={700} color="#1e90ff">/</T>{" "}
        <T as="span" x={332} y={139} size={36} weight={700}>{dict.body.studio.timelineEditor}</T>
      </h1>
      <T x={117} y={178} size={22} color="#b9cbe2" style={{ maxWidth: u(1500), overflow: "hidden", textOverflow: "ellipsis" }}>
        {reel ? `${reel.name}${reel.player ? ` · ${reel.player.display_name}` : ""}${dict.body.studio.everyEditSavedSuffix}`
          : dict.body.studio.studioSubtitle}
      </T>

      <div role="radiogroup" aria-label={dict.body.studio.taskLayout} className="absolute" style={{ left: u(1180), top: u(124 - 101), display: "flex", gap: u(6), zIndex: 2 }}>
        {(Object.keys(LAYOUTS) as Layout[]).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={st.layout === l} data-layout={l} data-pro title={layoutText[l].hint}
            onClick={() => { st.setLayout(l); ui.say(layoutText[l].hint); }}
            style={{ height: u(40), padding: `0 ${u(16)}`, borderRadius: u(8), fontSize: u(19), fontFamily: "inherit", cursor: "pointer", color: "#fff",
              border: `${u(1.5)} solid ${st.layout === l ? "#33a8ff" : "#1d4f8a"}`, background: st.layout === l ? "#0f4f9a" : "#0a2447" }}>{layoutText[l].label}</button>
        ))}
        <button type="button" aria-label={dict.body.studio.keyboardShortcuts} data-shortcuts onClick={openKeymap} title={dict.body.studio.keyboardShortcutsTitle}
          style={{ width: u(40), height: u(40), borderRadius: u(8), fontSize: u(20), fontWeight: 700, fontFamily: "inherit", cursor: "pointer", color: "#cfe0f5",
            border: `${u(1.5)} solid #1d4f8a`, background: "#0a2447" }}>?</button>
        <button type="button" aria-label={dict.body.studio.historyReel} data-history-open disabled={!reel} onClick={() => setHist(true)} title={dict.body.studio.historyTitle}
          style={{ height: u(40), padding: `0 ${u(14)}`, borderRadius: u(8), fontSize: u(19), fontFamily: "inherit", cursor: reel ? "pointer" : "default", color: "#cfe0f5",
            border: `${u(1.5)} solid #1d4f8a`, background: "#0a2447", opacity: reel ? 1 : 0.5 }}>{dict.body.reels.history}{r?.history?.entries.length ? ` (${r.history.entries.length})` : ""}</button>
      </div>
      <HistoryDialog r={r} open={hist} onOpenChange={setHist} />
      <Btn x={1677} y={120} w={192} h={62} label={dict.body.studio.saveProjectName} style={IN} dim={!edit}
        onClick={need(() => { setName(reel!.name); setNaming(true); })}>
        <Ic o={[1677, 120]} x={1714} y={151} k="sav" size={28} color="#cfe0f5" />
        <T o={[1677, 120]} x={1743} y={152} size={21} weight={600} as="span">{dict.body.reels.saveProject}</T>
      </Btn>
      <Btn x={1886} y={120} w={128} h={62} label={dict.body.studio.undo} style={IN} dim={!edit || !st.canUndo} onClick={need(() => (st.canUndo ? st.undo() : ui.say(dict.body.studio.nothingUndo)))}>
        <Ic o={[1886, 120]} x={1922} y={151} k="undo" size={28} color={st.canUndo ? "#cfe0f5" : "#6a7f9c"} />
        <T o={[1886, 120]} x={1948} y={152} size={21} weight={600} color={st.canUndo ? undefined : "#6a7f9c"} as="span">{dict.body.studio.undo}</T>
      </Btn>
      <Btn x={2031} y={120} w={129} h={62} label={dict.body.studio.redo} style={IN} dim={!edit || !st.canRedo} onClick={need(() => (st.canRedo ? st.redo() : ui.say(dict.body.studio.nothingRedo)))}>
        <Ic o={[2031, 120]} x={2066} y={151} k="redo" size={28} color={st.canRedo ? "#cfe0f5" : "#6a7f9c"} />
        <T o={[2031, 120]} x={2095} y={152} size={21} weight={st.canRedo ? 600 : 400} color={st.canRedo ? undefined : "#6a7f9c"} as="span">{dict.body.studio.redo}</T>
      </Btn>
      <Btn x={2176} y={120} w={144} h={62} label={dict.body.studio.suggestAddMoments.replace("{a}", String(missing.length))} dim={!edit || missing.length === 0}
        style={{ background: "linear-gradient(90deg,#2a1ab0,#3a2ae0)", borderRadius: u(8), ...frame("#5a4af0") }}
        onClick={need(() => (missing.length ? addSuggested()
          : ui.say(r?.moments?.length ? dict.body.studio.allMomentsInReel : dict.body.studio.noMomentsSuggested)))}>
        <Ic o={[2176, 120]} x={2201} y={151} k="ai" size={28} color="#9fc8ff" />
        <T o={[2176, 120]} x={2224} y={152} size={21} weight={600} as="span">{dict.body.studio.suggestLabel}</T>
      </Btn>
      <Btn x={2344} y={120} w={190} h={62} label={rendering ? dict.body.studio.renderingDots : dict.body.studio.exportRenderReel} dim={!edit || !reel?.clips.length || rendering}
        style={{ background: "#0a84ff", borderRadius: u(8) }} pressed={menu}
        onClick={need(() => (!reel!.clips.length ? ui.say(dict.body.studio.addClipsBeforeExport)
          : rendering ? ui.say(dict.body.studio.renderAlreadyRunning) : setMenu((m) => !m)))}>
        <Ic o={[2344, 120]} x={2381} y={151} k="exp" size={30} />
        <T o={[2344, 120]} x={2411} y={152} size={22} weight={600} as="span">{rendering ? dict.body.studio.renderingLabel : dict.body.studio.exportLabel}</T>
        <Ic o={[2344, 120]} x={2503} y={151} k="chev" size={20} />
      </Btn>
      {menu && (
        <div role="menu" aria-label={dict.body.studio.exportFormat} className="absolute" style={{ left: u(2304), top: u(190 - 101), width: u(230), zIndex: 6, background: "#081a35",
          border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(8), padding: u(6), fontSize: u(19) }}>
          {([["h264", "MP4 · H.264"], ["av1", "MP4 · AV1"], ["vp9", "WebM · VP9"]] as const).map(([c, l]) => (
            <button key={c} role="menuitem" type="button" onClick={() => render(c)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: u(8), background: "transparent", border: 0, color: "#e3eefb", cursor: "pointer", font: "inherit" }}>{l}</button>
          ))}
        </div>
      )}
      {(note || r?.msg) && (
        <T x={1677} y={196} size={16} color={note ? "#ffc66d" : r!.msg!.ok ? "#3ee6a8" : "#ff8a8a"} style={{ maxWidth: u(860), overflow: "hidden", textOverflow: "ellipsis" }}>
          <span role="status">{note ?? r!.msg!.text}</span>
        </T>
      )}

      <Dialog.Root open={naming} onOpenChange={setNaming}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-semibold">{dict.body.studio.saveProjectLabel}</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">{dict.body.studio.editsSavedNameReel}</Dialog.Description>
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
