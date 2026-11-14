"use client";
/**
 * Invite friends (user-to-user Invite, owner decision 2026-11-14): the full /invite-share page, kept as
 * the address for direct links. The gift button in the top bar no longer navigates here — since 2026-11-14
 * it opens the InviteCard over the current page instead (you do not lose your place). The page shows the
 * caller's own invite link and code, a copy button, and what both sides get in plain words — the friend
 * gets +25 tokens on signup (on top of the 100-token free grant), and the inviter gets +100 tokens when
 * the friend analyses their first match or buys their first pack.
 *
 * This is NOT the staff/team invite (invite a person by email to join your club with a role — the /invite
 * page): that one adds a member to an organization, this one brings a new user to OTSI. The link is built
 * from the app's own origin, so it points back at this app's sign-up page.
 */
import { INVITE_BONUS_TOKENS, INVITE_REWARD_TOKENS } from "@otsi-vie/contracts";
import { Check, Link2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiProblem, myInvite } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

export function InviteSharePage() {
  const { t } = useLocale();
  const s = t.body.invite;
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void myInvite()
      .then((r) => { if (live) { setCode(r.code); setLoading(false); } })
      .catch((x) => { if (live) { setError(x instanceof ApiProblem ? x.message : s.loadFailed); setLoading(false); } });
    return () => { live = false; };
  }, [s.loadFailed]);

  const link = code ? `${window.location.origin}/setup?invite=${code}` : "";

  function copy() {
    if (!link) return;
    void navigator.clipboard.writeText(link).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); },
      () => setCopied(false),
    );
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-[18px]" data-page="invite-share">
      <div className="flex flex-col gap-1.5"><h1 className="h1">{s.title}</h1><p className="t-body text-ink2">{s.sub}</p></div>
      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}
      {loading ? (
        <p className="t-body text-muted"><Loader2 className="inline h-4 w-4 animate-spin" aria-hidden /> {s.loading}</p>
      ) : code && (
        <section className="flex max-w-[640px] flex-col gap-4" aria-labelledby="invite-link">
          <div>
            <label className="lab" htmlFor="invite-link-input">{s.linkLabel}</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <input id="invite-link-input" readOnly value={link} aria-label={s.linkLabel} className="in mono flex-1" style={{ minWidth: "16rem" }} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn" onClick={copy} data-invite-copy>
                {copied ? <Check className="h-4 w-4 text-ok" /> : <Link2 className="h-4 w-4" />} {copied ? s.copied : s.copy}
              </button>
            </div>
          </div>
          <div>
            <span className="lab">{s.codeLabel}</span>
            <p className="mt-1.5 t-body"><code className="mono rounded-ctl border border-line bg-raised px-2 py-1">{code}</code></p>
          </div>
          <div className="rounded-ctl border border-primary/50 bg-primary/10 p-3" data-invite-rewards>
            <p className="t-body">{s.inviteeGets.replace("{bonus}", String(INVITE_BONUS_TOKENS))}</p>
            <p className="mt-1 t-body">{s.inviterGets.replace("{reward}", String(INVITE_REWARD_TOKENS))}</p>
          </div>
        </section>
      )}
    </main>
  );
}
