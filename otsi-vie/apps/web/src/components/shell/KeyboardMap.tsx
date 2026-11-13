"use client";
/**
 * v3 Phase A.9 (S14, ADR-071), SOT rebuild page 13 (alphabetical): the
 * keyboard shortcuts modal. "?" on any page (when no field or dialog has
 * the keys), Clip Studio's "?" button and the palette's "Keyboard
 * shortcuts" command open it. It is a fixed cheat sheet in the SOT's two
 * columns (General + Analysis | Video players + Clip Studio): every row
 * is a shortcut the engine really has, wired where its tool lives
 * (lib/keymap.ts). SOT rebuild: all nine rows the SOT lists are shown
 * and wired — Settings (Ctrl/Cmd ,), Confirm / Correct / Reject
 * identity (C / E / X), back / forward 1 frame (, .), slower / faster
 * ([ ]), Open local footage (O), Blade (B) and Select (V). Mark in /
 * out is I and P (the SOT's keys).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { KEYMAP_EVENT, typing } from "@/lib/keymap";
import { useLocale } from "@/lib/i18n";

function Row({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="lr" style={{ padding: 0, minHeight: 34 }}>
      <span style={{ flex: 1 }}>{label}</span>
      {keys.map((k, i) => (
        <span key={k} className="vie-kbd" style={i > 0 ? { marginLeft: 4 } : undefined}>{k}</span>
      ))}
    </div>
  );
}

export function KeyboardMap() {
  const { t } = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e)) return;
      // Ctrl/Cmd , opens Settings (SOT, General) — from any page, like Ctrl/Cmd K and J
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === ",") { e.preventDefault(); router.push("/settings/preferences"); return; }
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      setOpen(true);
    };
    const onOpen = () => setOpen(true);
    addEventListener("keydown", onKey);
    addEventListener(KEYMAP_EVENT, onOpen);
    return () => { removeEventListener("keydown", onKey); removeEventListener(KEYMAP_EVENT, onOpen); };
  }, [router]);
  const s = t.body.shell;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content data-keyboard-map role="dialog" aria-modal="true" aria-labelledby="ks"
          className="modal fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2" style={{ maxWidth: 760 }}>
          <div className="vie-ph" style={{ minHeight: 48 }}>
            <Dialog.Title id="ks" className="t-page">{s.keysTitle}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="vie-ib h-[30px] w-[30px]" aria-label={t.common.close}><X className="h-4 w-4" aria-hidden /></button>
            </Dialog.Close>
          </div>
          <div className="grid grid-cols-2 gap-x-7 px-5 pb-[18px] pt-3.5">
            <div className="flex flex-col">
              <span className="eb" style={{ padding: "6px 0" }}>{s.ksGeneral}</span>
              <Row label={s.ksCommandPalette} keys={["Ctrl/Cmd K"]} />
              <Row label={s.keysTitle} keys={["?"]} />
              <Row label={s.ksCollapseRail} keys={["Ctrl/Cmd B"]} />
              <Row label={s.ksJobsCenter} keys={["Ctrl/Cmd J"]} />
              <Row label={s.ksSettings} keys={["Ctrl/Cmd ,"]} />
              <div className="lr" style={{ padding: 0, minHeight: 34, border: 0 }}>
                <span style={{ flex: 1 }}>{s.ksCloseDialog}</span>
                <span className="vie-kbd">Esc</span>
              </div>
              <span className="eb" style={{ padding: "14px 0 6px" }}>{s.scopeAnalysis}</span>
              <Row label={s.ksConfirmIdentity} keys={["C"]} />
              <Row label={s.ksCorrectIdentity} keys={["E"]} />
              <Row label={s.ksRejectIdentity} keys={["X"]} />
              <div className="lr" style={{ padding: 0, minHeight: 34, border: 0 }}>
                <span style={{ flex: 1 }}>{s.ksAddMarker}</span>
                <span className="vie-kbd">M</span>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="eb" style={{ padding: "6px 0" }}>{s.ksVideoPlayers}</span>
              <Row label={s.ksPlayPause} keys={["Space"]} />
              <Row label={s.ksBackForwardSec} keys={["← →"]} />
              <Row label={s.ksFrameStep} keys={[", ."]} />
              <Row label={s.ksSpeed} keys={["[ ]"]} />
              <Row label={s.ksFullscreen} keys={["F"]} />
              <Row label={s.ksOpenLocal} keys={["O"]} />
              <span className="eb" style={{ padding: "14px 0 6px" }}>{s.scopeStudio}</span>
              <Row label={s.ksMarkInOut} keys={["I", "P"]} />
              <Row label={s.ksBladeTool} keys={["B"]} />
              <div className="lr" style={{ padding: 0, minHeight: 34, border: 0 }}>
                <span style={{ flex: 1 }}>{s.ksSelectTool}</span>
                <span className="vie-kbd">V</span>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
