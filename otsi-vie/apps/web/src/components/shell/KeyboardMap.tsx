"use client";
/**
 * v3 Phase A.9 (S14, ADR-071), SOT rebuild page 13 (alphabetical): the
 * keyboard shortcuts modal. "?" on any page (when no field or dialog has
 * the keys), Clip Studio's "?" button and the palette's "Keyboard
 * shortcuts" command open it. It is a fixed cheat sheet in the SOT's two
 * columns (General + Analysis | Video players + Clip Studio), not the
 * searchable full map: every row is a shortcut the engine really has.
 *
 * Rows the SOT lists that are NOT wired in the engine are left out, and
 * the omission is named in the commit, not hidden: Settings (Ctrl/Cmd ,),
 * Confirm / Correct / Reject identity (C / E / X), back / forward 1
 * frame (, .), slower / faster ([ ]), open local footage (O). Mark in /
 * out is I and O (the keys the Studio and Analysis really use); the SOT's
 * "P" is a slip. There is no Blade tool and no Select tool to bind B and
 * V to (the Studio's draw tools are A / D / R).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typing(e)) return;
      e.preventDefault();
      setOpen(true);
    };
    const onOpen = () => setOpen(true);
    addEventListener("keydown", onKey);
    addEventListener(KEYMAP_EVENT, onOpen);
    return () => { removeEventListener("keydown", onKey); removeEventListener(KEYMAP_EVENT, onOpen); };
  }, []);
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
              <div className="lr" style={{ padding: 0, minHeight: 34, border: 0 }}>
                <span style={{ flex: 1 }}>{s.ksCloseDialog}</span>
                <span className="vie-kbd">Esc</span>
              </div>
              <span className="eb" style={{ padding: "14px 0 6px" }}>{s.scopeAnalysis}</span>
              <div className="lr" style={{ padding: 0, minHeight: 34, border: 0 }}>
                <span style={{ flex: 1 }}>{s.ksAddMarker}</span>
                <span className="vie-kbd">M</span>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="eb" style={{ padding: "6px 0" }}>{s.ksVideoPlayers}</span>
              <Row label={s.ksPlayPause} keys={["Space"]} />
              <Row label={s.ksBackForwardSec} keys={["← →"]} />
              <div className="lr" style={{ padding: 0, minHeight: 34, border: 0 }}>
                <span style={{ flex: 1 }}>{s.ksFullscreen}</span>
                <span className="vie-kbd">F</span>
              </div>
              <span className="eb" style={{ padding: "14px 0 6px" }}>{s.scopeStudio}</span>
              <div className="lr" style={{ padding: 0, minHeight: 34, border: 0 }}>
                <span style={{ flex: 1 }}>{s.ksMarkInOut}</span>
                <span className="vie-kbd">I</span>
                <span className="vie-kbd" style={{ marginLeft: 4 }}>O</span>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
