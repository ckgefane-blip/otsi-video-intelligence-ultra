"use client";
/**
 * Invite friends, as a card (owner decision 2026-11-14): the gift button in the top bar opens this small
 * card over the page you are on, instead of navigating to the full /invite-share page — you do not lose
 * your place. /invite-share stays as the address for direct links; this card is what the gift button opens.
 *
 * The card shows the invite CODE first, big, with a Copy code button — the code is what a friend actually
 * uses (they type it into their own app). The localhost link only opens on this computer, so it is shown
 * small below the code with a note saying so; it is not the main thing. The two reward lines are kept
 * exactly as on the page. Each Copy button shows its own "copied" confirmation at the button itself
 * (owner rule: the message appears next to the button that caused it).
 *
 * Closes with the ✕ button, Esc, or a click outside (Radix Dialog). Focus returns to the gift button
 * on close (Radix restores focus to the trigger).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { INVITE_BONUS_TOKENS, INVITE_REWARD_TOKENS } from "@otsi-vie/contracts";
import { Check, Copy, Link2, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiProblem, myInvite } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

export function InviteCard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useLocale();
  const s = t.body.invite;
  const [code, setCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The code is fetched when the card opens (it is created on first read and then stable, so a
  // cached code is reused on later opens); the copied flags reset each time it closes.
  useEffect(() => {
    if (!open) { setCopiedCode(false); setCopiedLink(false); return; }
    if (code) return;
    let live = true;
    setLoading(true);
    setError(null);
    void myInvite()
      .then((r) => { if (live) { setCode(r.code); setLoading(false); } })
      .catch((x) => { if (live) { setError(x instanceof ApiProblem ? x.message : s.loadFailed); setLoading(false); } });
    return () => { live = false; };
    // s.loadFailed is a stable dictionary string; the fetch is keyed on the open state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, code]);

  const link = code ? `${window.location.origin}/setup?invite=${code}` : "";

  function copyText(text: string, which: "code" | "link") {
    if (!text) return;
    const setCopied = which === "code" ? setCopiedCode : setCopiedLink;
    void navigator.clipboard.writeText(text).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); },
      () => setCopied(false),
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/85" />
        <Dialog.Content data-invite-card aria-label={s.title}
          className="modal fixed left-1/2 top-24 z-50 w-[min(480px,calc(100vw-32px))] -translate-x-1/2"
          style={{ width: "min(480px, calc(100vw - 32px))" }}>
          <Dialog.Title className="h1 px-5 pt-4">{s.title}</Dialog.Title>
          <Dialog.Description className="sr-only">{s.sub}</Dialog.Description>
          <Dialog.Close asChild>
            <button type="button" className="btn sm absolute right-3 top-3" aria-label={t.common.close} data-invite-close>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </Dialog.Close>
          <div className="flex flex-col gap-4 px-5 pb-5 pt-3">
            {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}
            {loading ? (
              <p className="t-body text-muted"><Loader2 className="inline h-4 w-4 animate-spin" aria-hidden /> {s.loading}</p>
            ) : code && (
              <>
                <section aria-labelledby="invite-card-code">
                  <span id="invite-card-code" className="lab">{s.codeLabel}</span>
                  <p className="mt-1.5 flex flex-wrap items-center gap-2">
                    <code data-invite-code className="mono rounded-ctl border border-line bg-raised px-3 py-1.5 text-2xl font-bold tracking-wider">{code}</code>
                    <button type="button" className="btn" onClick={() => copyText(code, "code")} data-invite-copy-code>
                      {copiedCode ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />} {copiedCode ? s.codeCopied : s.copyCode}
                    </button>
                  </p>
                </section>
                <section>
                  <label className="lab" htmlFor="invite-card-link-input">{s.linkLabel}</label>
                  <p className="t-small mt-1 text-muted">{s.linkLocalNote}</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <input id="invite-card-link-input" readOnly value={link} aria-label={s.linkLabel} className="in mono flex-1 text-sm" style={{ minWidth: "12rem" }} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" className="btn sm" onClick={() => copyText(link, "link")} data-invite-copy-link>
                      {copiedLink ? <Check className="h-4 w-4 text-ok" /> : <Link2 className="h-4 w-4" />} {copiedLink ? s.copied : s.copy}
                    </button>
                  </div>
                </section>
                <div className="rounded-ctl border border-primary/50 bg-primary/10 p-3" data-invite-rewards>
                  <p className="t-body">{s.inviteeGets.replace("{bonus}", String(INVITE_BONUS_TOKENS))}</p>
                  <p className="mt-1 t-body">{s.inviterGets.replace("{reward}", String(INVITE_REWARD_TOKENS))}</p>
                </div>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
