"use client";
/**
 * v3 Phase A.9 (S14, ADR-071): the keyboard map. "?" on any page (when no field or dialog has the keys), Clip Studio's "?" button and the
 * palette's "Keyboard shortcuts" command open it. This page's keys first, then the keys that work everywhere, then the other pages';
 * a search finds a command by words or a key by its letter.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { KEYMAP_EVENT, keymapFor, typing, type KeyScope } from "@/lib/keymap";
import { useLocale, type Dictionary } from "@/lib/i18n";

/** the scope heading as the person reads it (ADR-139) */
const scopeLabel = (t: Dictionary, s: KeyScope): string => ({
  everywhere: t.body.shell.scopeEverywhere, studio: t.body.shell.scopeStudio, analysis: t.body.shell.scopeAnalysis,
  reels: t.body.shell.scopeReels, reports: t.body.shell.scopeReports, library: t.body.shell.scopeLibrary,
  exports: t.body.shell.scopeExports,
}[s]);

/** what a key does, as the person reads it, keyed by scope + keys; the English `does` in lib/keymap.ts stays for matching */
const doesLabel = (t: Dictionary, scope: KeyScope, keys: string, fallback: string): string => {
  const s = t.body.shell;
  const m: Record<string, string> = {
    "everywhere|Ctrl + K": s.kmEverywhereSearch, "everywhere|?": s.kmEverywhereMap, "everywhere|Escape": s.kmEverywhereEscape,
    "studio|Space": s.kmStudioSpace, "studio|J": s.kmJ, "studio|K": s.kmK, "studio|L": s.kmL,
    "studio|← / →": s.kmStudioArrows, "studio|Shift + ← / →": s.kmStudioShiftArrows,
    "studio|Home / End": s.kmStudioHomeEnd, "studio|S": s.kmStudioSplit, "studio|C": s.kmStudioCut,
    "studio|Delete": s.kmStudioDelete, "studio|Alt + [ / Alt + ]": s.kmStudioTrim, "studio|Ctrl + Z": s.kmUndo,
    "studio|Ctrl + Shift + Z or Ctrl + Y": s.kmRedo, "studio|M": s.kmStudioMarker, "studio|B": s.kmStudioSnap,
    "studio|Shift + B": s.kmStudioApplyB, "studio|I / O": s.kmStudioIO, "studio|Alt + X": s.kmStudioClearIO,
    "studio|A / D / R": s.kmStudioDraw, "studio|Escape": s.kmStudioEscape,
    "analysis|Space": s.kmAnalysisSpace, "analysis|J": s.kmJ, "analysis|K": s.kmK, "analysis|L": s.kmL,
    "analysis|← / →": s.kmAnalysisArrows, "analysis|Shift + ← / →": s.kmStudioShiftArrows,
    "analysis|N": s.kmAnalysisN,
    "reels|Ctrl + Z": s.kmReelsUndo, "reels|Ctrl + Shift + Z or Ctrl + Y": s.kmReelsRedo,
    "reports|[ / ]": s.kmReportsKeys, "library|[ / ]": s.kmLibraryKeys, "exports|[ / ]": s.kmExportsKeys,
  };
  return m[`${scope}|${keys}`] ?? fallback;
};

/** the group heading as the person reads it */
const groupLabel = (t: Dictionary, g: string): string => ({
  Play: t.body.shell.keyGroupPlay, Edit: t.body.shell.keyGroupEdit, Mark: t.body.shell.keyGroupMark,
  Draw: t.body.shell.keyGroupDraw, Name: t.body.shell.keyGroupName, App: t.body.shell.keyGroupApp,
  Compare: t.body.shell.keyGroupCompare,
})[g] ?? g;

export function KeyboardMap() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const path = usePathname() ?? "/";
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
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const groups = useMemo(() => keymapFor(path, q), [path, q]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content data-keyboard-map
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(720px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
          <Dialog.Title className="text-base font-semibold">{t.body.shell.keysTitle}</Dialog.Title>
          <Dialog.Description className="mb-2 text-xs text-muted">{t.body.shell.keysDesc}</Dialog.Description>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label={t.body.shell.keysFindAria} placeholder={t.body.shell.keysFindPh}
            className="mb-3 h-9 rounded-ctl border border-line bg-canvas px-3 text-sm outline-none placeholder:text-muted" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {groups.length === 0 && <p className="py-4 text-center text-xs text-muted">{t.body.shell.keysNoMatch.replace("{a}", q.trim())}</p>}
            {groups.map((g) => (
              <section key={g.scope} className="mb-3" data-keymap-scope={g.scope} aria-label={scopeLabel(t, g.scope)}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{scopeLabel(t, g.scope)}{g.here ? t.body.shell.keysThisPage : ""}</h3>
                <table className="w-full"><tbody>
                  {g.rows.map((x) => (
                    <tr key={`${x.keys}-${x.does}`} className="border-t border-line/60">
                      <td className="w-[38%] py-1 pr-2"><kbd className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs">{x.keys}</kbd></td>
                      <td className="py-1">{doesLabel(t, g.scope, x.keys, x.does)}</td>
                      <td className="w-16 py-1 text-right text-[11px] text-muted">{groupLabel(t, x.group)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </section>
            ))}
          </div>
          <div className="flex justify-end pt-2"><Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{t.common.close}</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
