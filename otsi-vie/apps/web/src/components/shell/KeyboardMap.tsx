"use client";
/**
 * v3 Phase A.9 (S14, ADR-071): the keyboard map. "?" on any page (when no field or dialog has the keys), Clip Studio's "?" button and the
 * palette's "Keyboard shortcuts" command open it. This page's keys first, then the keys that work everywhere, then the other pages';
 * a search finds a command by words or a key by its letter.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { KEYMAP_EVENT, keymapFor, SCOPE_LABEL, typing } from "@/lib/keymap";

export function KeyboardMap() {
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
          <Dialog.Title className="text-base font-semibold">Keyboard shortcuts</Dialog.Title>
          <Dialog.Description className="mb-2 text-xs text-muted">Keys work when no text field is focused. This page&apos;s keys come first.</Dialog.Description>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a shortcut" placeholder="Find a command, or type a key (e.g. S)"
            className="mb-3 h-9 rounded-ctl border border-line bg-canvas px-3 text-sm outline-none placeholder:text-muted" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {groups.length === 0 && <p className="py-4 text-center text-xs text-muted">No shortcut matches “{q.trim()}”.</p>}
            {groups.map((g) => (
              <section key={g.scope} className="mb-3" data-keymap-scope={g.scope} aria-label={SCOPE_LABEL[g.scope]}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{SCOPE_LABEL[g.scope]}{g.here ? " · this page" : ""}</h3>
                <table className="w-full"><tbody>
                  {g.rows.map((x) => (
                    <tr key={`${x.keys}-${x.does}`} className="border-t border-line/60">
                      <td className="w-[38%] py-1 pr-2"><kbd className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-xs">{x.keys}</kbd></td>
                      <td className="py-1">{x.does}</td>
                      <td className="w-16 py-1 text-right text-[11px] text-muted">{x.group}</td>
                    </tr>
                  ))}
                </tbody></table>
              </section>
            ))}
          </div>
          <div className="flex justify-end pt-2"><Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">Close</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
