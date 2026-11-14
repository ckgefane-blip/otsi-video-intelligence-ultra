"use client";
/**
 * A success/error message that belongs to one action, rendered next to the button that caused it
 * (owner rule, 2026-11-14): the result must appear where the person clicked, never only at the top
 * of the page where it cannot be seen. Load errors still go to the top of the page — they have no
 * button. `useFieldMessages` holds one message per action slot; `FieldMessage` renders one.
 */
import { useState } from "react";

export type FieldMsg = { ok: boolean; text: string };

export function useFieldMessages() {
  const [msgs, setMsgs] = useState<Record<string, FieldMsg>>({});
  const set = (slot: string, msg: FieldMsg | null) =>
    setMsgs((cur) => {
      const next = { ...cur };
      if (msg) next[slot] = msg;
      else delete next[slot];
      return next;
    });
  return { msgs, set };
}

export function FieldMessage({ msg }: { msg: FieldMsg | undefined }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={msg.ok
      ? "rounded-ctl border border-ok/50 bg-ok/10 px-3 py-2 t-body text-ok"
      : "rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger"}>
      {msg.text}
    </p>
  );
}
