"use client";
/**
 * SOT rebuild (Shortcuts.dc.html): the Keyboard shortcuts page. The SOT shows the shortcuts as a modal over
 * Home; the top bar's "?" links here (/shortcuts), so the page renders the same table the "?" modal shows
 * (components/shell/KeyboardMap.tsx) — same rows, same keys, same wiring (lib/keymap.ts). Mark in / out is
 * I and P (the SOT's keys; the Studio and Analysis use them).
 * Nine labels (ksSettings, ksConfirmIdentity, ksCorrectIdentity, ksRejectIdentity, ksFrameStep, ksSpeed,
 * ksOpenLocal, ksBladeTool, ksSelectTool) are defined in sot-rebuild-i18n/pages-b.json — the reconciliation
 * pass adds them to the dictionary; until then typecheck reports them as missing keys.
 */
import { useLocale } from "@/lib/i18n";

function Row({ label, keys, last }: { label: string; keys: string[]; last?: boolean }) {
  return (
    <div className="lr" style={{ padding: 0, minHeight: 34, border: last ? 0 : undefined }}>
      <span style={{ flex: 1 }}>{label}</span>
      {keys.map((k, i) => (
        <span key={k} className="vie-kbd" style={i > 0 ? { marginLeft: 4 } : undefined}>{k}</span>
      ))}
    </div>
  );
}

export function ShortcutsPage() {
  const { t } = useLocale();
  const s = t.body.shell;
  return (
    <main className="mx-auto flex w-full max-w-[820px] flex-col gap-4 p-4" aria-labelledby="ks">
      <h1 id="ks" className="t-page">{s.keysTitle}</h1>
      <div className="grid grid-cols-2 gap-x-7 px-5 pb-[18px] pt-3.5 max-md:grid-cols-1" style={{ background: "transparent", border: 0, borderTop: "1px solid rgb(var(--line))", borderRadius: 0 }}>
        <div className="flex flex-col">
          <span className="eb" style={{ padding: "6px 0" }}>{s.ksGeneral}</span>
          <Row label={s.ksCommandPalette} keys={["Ctrl/Cmd K"]} />
          <Row label={s.keysTitle} keys={["?"]} />
          <Row label={s.ksCollapseRail} keys={["Ctrl/Cmd B"]} />
          <Row label={s.ksJobsCenter} keys={["Ctrl/Cmd J"]} />
          <Row label={s.ksSettings} keys={["Ctrl/Cmd ,"]} />
          <Row label={s.ksCloseDialog} keys={["Esc"]} last />
          <span className="eb" style={{ padding: "14px 0 6px" }}>{s.scopeAnalysis}</span>
          <Row label={s.ksConfirmIdentity} keys={["C"]} />
          <Row label={s.ksCorrectIdentity} keys={["E"]} />
          <Row label={s.ksRejectIdentity} keys={["X"]} />
          <Row label={s.ksAddMarker} keys={["M"]} last />
        </div>
        <div className="flex flex-col">
          <span className="eb" style={{ padding: "6px 0" }}>{s.ksVideoPlayers}</span>
          <Row label={s.ksPlayPause} keys={["Space"]} />
          <Row label={s.ksBackForwardSec} keys={["← →"]} />
          <Row label={s.ksFrameStep} keys={[", ."]} />
          <Row label={s.ksSpeed} keys={["[ ]"]} />
          <Row label={s.ksFullscreen} keys={["F"]} />
          <Row label={s.ksOpenLocal} keys={["O"]} last />
          <span className="eb" style={{ padding: "14px 0 6px" }}>{s.scopeStudio}</span>
          <Row label={s.ksMarkInOut} keys={["I", "P"]} />
          <Row label={s.ksBladeTool} keys={["B"]} />
          <Row label={s.ksSelectTool} keys={["V"]} last />
        </div>
      </div>
    </main>
  );
}
