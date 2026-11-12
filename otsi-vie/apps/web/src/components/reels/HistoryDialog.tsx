"use client";
/**
 * v3 Phase B.1 (ADR-081, S11): the reel's History, the same in Reel Builder and Clip Studio. Every change is listed newest first with who made
 * it and when; Undo and Redo name what they will do; "Back to before this" undoes that change and every later one in one step. Undo and Redo
 * are new entries (nothing is erased): an undone change says so, and one that can no longer be redone (a new change was made after it) says that.
 *
 * ADR-139 Group C: the plain helpers take the dictionary as a parameter (never a hook inside a plain function).
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { ReelEditEntry } from "@otsi-vie/contracts";
import type { ReelState } from "./ReelBuilder";
import { useLocale, type Dictionary } from "@/lib/i18n";

type ReelsDict = Dictionary["body"]["reels"];

const when = (iso: string, d: ReelsDict) => {
  const dt = new Date(iso), now = Date.now(), s = Math.round((now - dt.getTime()) / 1000);
  if (s < 60) return d.whenJustNow;
  if (s < 3600) return d.whenMinAgo.replace("{a}", String(Math.floor(s / 60)));
  return dt.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const badge = (e: ReelEditEntry, d: ReelsDict) =>
  e.kind === "UNDO" ? { text: d.badgeUndo, cls: "border-[#f5b82e] text-[#ffe6a8]" }
    : e.kind === "REDO" ? { text: d.badgeRedo, cls: "border-[#33a8ff] text-[#bfe1ff]" }
      : e.state === "UNDONE" ? { text: d.badgeUndone, cls: "border-line text-muted" }
        : e.state === "DROPPED" ? { text: d.badgeDropped, cls: "border-line text-muted" }
          : null;

export function HistoryDialog({ r, open, onOpenChange }: { r: ReelState | null; open: boolean; onOpenChange(o: boolean): void }) {
  const { t: dict } = useLocale();
  const d = dict.body.reels;
  const h = r?.history ?? null;
  const can = !!r?.canEdit && !r?.busy;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="history" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(720px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 t-body shadow-xl">
          <Dialog.Title className="t-section">{d.historyTitle}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            {d.historyDesc}
          </Dialog.Description>
          <div className="mb-3 flex flex-wrap gap-2">
            <button type="button" data-history-undo disabled={!can || !h?.can_undo} onClick={() => r?.undo()}
              className="rounded-ctl border border-line px-3 py-1.5 font-semibold disabled:opacity-40">{h?.undo_label ? d.historyUndoBtn.replace("{a}", h.undo_label) : d.historyNothingUndo}</button>
            <button type="button" data-history-redo disabled={!can || !h?.can_redo} onClick={() => r?.redo()}
              className="rounded-ctl border border-line px-3 py-1.5 font-semibold disabled:opacity-40">{h?.redo_label ? d.historyRedoBtn.replace("{a}", h.redo_label) : d.historyNothingRedo}</button>
          </div>
          {!h ? <p className="text-xs text-muted">{d.historyReading}</p> : h.entries.length === 0 ? (
            <p className="text-xs text-muted" data-history-empty>{d.historyEmpty}</p>
          ) : (
            <ol className="space-y-1" data-history-list>
              {h.entries.map((e) => {
                const b = badge(e, d);
                return (
                  <li key={e.id} data-edit={e.kind} data-state={e.state ?? undefined} className="flex items-center gap-2 rounded-ctl border border-line/60 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${e.state === "UNDONE" || e.state === "DROPPED" ? "text-muted line-through" : ""}`}>{e.label}</span>
                      <span className="block text-xs text-muted">{e.actor?.name ?? dict.body.workspace.someoneLabel} · {when(e.created_at, d)}</span>
                    </span>
                    {b && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${b.cls}`}>{b.text}</span>}
                    {e.kind === "EDIT" && e.state === "ACTIVE" && (
                      <button type="button" data-back-to={e.id} disabled={!can} onClick={() => r?.undo(e.id)} title={d.historyBackToTitle}
                        className="shrink-0 rounded-ctl border border-line px-2 py-1 text-xs disabled:opacity-40">{d.historyBackTo}</button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {r?.msg && !r.msg.ok && <p className="mt-2 text-xs text-[#ff8a8a]" role="alert">{r.msg.text}</p>}
          <div className="mt-3 text-right">
            <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.close}</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
