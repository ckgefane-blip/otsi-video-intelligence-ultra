"use client";
/**
 * The first-run welcome tour (SOT, page 31, alphabetical). A modal over the Home page, six steps: Your name, Work context,
 * Upload & processing, Confirming identity, Reels & reports, Evidence labels. The name is the first step, not the last — it is
 * what the team sees, in the audit log and on shared links. The tour is shown once per account (users.onboarded_at); the name
 * and the end of the tour are saved on the person's account (PATCH /v1/me), so the header shows who they are. "Skip tour" and
 * the close button end the tour without a name; "Get started" on the last step saves the name when one was given. The tour
 * describes what the engine does; it shows no player data and no numbers that were not measured. Replaying the tour (the
 * profile menu's "Welcome tour") reopens the modal from any app page: it listens for the `otsi-replay-tour` event.
 */
import type { Me } from "@otsi-vie/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import { useLocale } from "@/lib/i18n";

export const REPLAY_TOUR_EVENT = "otsi-replay-tour";

const STEPS = ["name", "context", "upload", "identity", "reels", "evidence"] as const;

export function WelcomeTour() {
  const { t } = useLocale();
  const { status, me, updateMe } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const done = !!me?.user.onboarded_at;

  // the tour opens once, for a person who has not finished it; a replay reopens it from any app page
  useEffect(() => { if (status === "signed-in" && me && !done) { setOpen(true); setStep(0); } }, [status, me, done]);
  useEffect(() => { if (me && !name) setName(me.user.display_name); }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const replay = () => { setErr(null); setStep(0); setOpen(true); };
    window.addEventListener(REPLAY_TOUR_EVENT, replay);
    return () => window.removeEventListener(REPLAY_TOUR_EVENT, replay);
  }, []);

  const go = useCallback((n: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, n))), []);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement | null)?.tagName === "INPUT";
      if (e.code === "ArrowRight" && !inField) go(step + 1);
      else if (e.code === "ArrowLeft" && !inField && step > 0) go(step - 1);
      else if (e.code === "Escape") skip();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, go]);

  if (status !== "signed-in" || !me || !open) return null;

  const saveName = (n: string) => n.trim().length >= 2;
  const finish = () => {
    const n = name.trim();
    if (n && !saveName(n)) { setErr(t.body.auth.nameTooShort); return; }
    setBusy(true); setErr(null);
    const json: Record<string, unknown> = { onboarding_done: true };
    if (n) json.display_name = n;
    void api<Me>("/v1/me", { method: "PATCH", json, organization: false })
      .then((m) => { updateMe(m); setOpen(false); router.replace("/dashboard"); },
        (x) => { setErr(x instanceof ApiProblem ? x.message : t.body.auth.nameSaveFailed); setBusy(false); });
  };
  const skip = () => {
    setBusy(true); setErr(null);
    const n = name.trim();
    const json: Record<string, unknown> = { onboarding_done: true };
    if (saveName(n)) json.display_name = n;
    void api<Me>("/v1/me", { method: "PATCH", json, organization: false })
      .then((m) => { updateMe(m); setOpen(false); router.replace("/dashboard"); },
        () => { setOpen(false); router.replace("/dashboard"); });
  };

  const stepName = [t.body.auth.yourName, t.body.auth.tourStepContext, t.body.auth.tourStepUpload, t.body.auth.tourStepIdentity, t.body.auth.tourStepReels, t.body.auth.tourStepEvidence][step]!;
  const title = step === 0 ? t.body.auth.welcome : stepName;
  const body = step === 0 ? t.body.auth.tourIntro
    : step === 1 ? t.body.auth.tourContextBody : step === 2 ? t.body.auth.tourUploadBody
    : step === 3 ? t.body.auth.tourIdentityBody : step === 4 ? t.body.auth.tourReelsBody : t.body.auth.tourEvidenceBody;
  return (
    <>
      <div aria-hidden className="fixed inset-0 z-40 bg-black/70" />
      <div role="dialog" aria-modal="true" aria-labelledby="wt" className="fixed left-1/2 top-1/2 z-50 flex w-[calc(100%-48px)] max-w-[780px] -translate-x-1/2 -translate-y-1/2 flex-wrap overflow-hidden rounded-xl border border-line2 bg-panel shadow-2xl">
        <ol aria-label={t.body.auth.tourTitle} className="flex w-[230px] shrink-0 flex-col gap-1 border-r border-line bg-p0 px-[18px] py-[22px]">
          <li className="eb px-2 pb-2.5">{t.body.auth.tourTitle}</li>
          {[t.body.auth.yourName, t.body.auth.tourStepContext, t.body.auth.tourStepUpload, t.body.auth.tourStepIdentity, t.body.auth.tourStepReels, t.body.auth.tourStepEvidence].map((s, i) => (
            <li key={s} className={`flex h-[34px] items-center gap-2.5 rounded-md px-2 ${i === step ? "bg-raised font-medium" : "text-muted"}`}>
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${i === step ? "bg-primary font-semibold text-primary-ink" : "border border-line2"}`}>{i + 1}</span>
              <span className={i === step ? "" : "text-muted"}>{s}</span>
            </li>
          ))}
        </ol>
        <div className="flex min-w-0 flex-1 flex-col gap-[18px] px-7 py-7">
          <div className="flex items-center justify-between">
            <span className="t-small text-muted">{step + 1} / {STEPS.length}</span>
            <button type="button" aria-label={t.body.auth.tourClose} onClick={skip} className="grid h-[30px] w-[30px] place-items-center rounded-md border border-transparent bg-transparent text-ink2 hover:border-line hover:bg-raised hover:text-ink">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <h2 id="wt" className="h1">{title}</h2>
            <p className="sub">{body}</p>
          </div>
          {step === 0 && (
            <div className="field">
              <label className="lab" htmlFor="tour-name">{t.body.auth.tourDisplayName}</label>
              <input id="tour-name" className="in h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.body.auth.tourNameExample} maxLength={80} autoComplete="name" autoFocus />
              <span className="hint">{t.body.auth.tourNameHint}</span>
            </div>
          )}
          {err && <p role="alert" className="text-xs text-danger">{err}</p>}
          <div className="mt-2 flex items-center gap-2">
            {/* SOT: "Skip tour" is the filled secondary button (.btn), not the ghost (.btn.gh) */}
            <button type="button" onClick={skip} className="btn">{t.body.auth.skipTour}</button>
            <span className="flex-1" />
            <button type="button" onClick={() => go(step - 1)} disabled={step === 0} className="btn">{t.body.auth.back}</button>
            {step === STEPS.length - 1
              ? <button type="button" onClick={finish} disabled={busy} className="btn pri">{busy ? t.body.auth.saving : t.body.auth.getStarted}</button>
              : <button type="button" onClick={() => go(step + 1)} className="btn pri">{t.body.auth.next}</button>}
          </div>
        </div>
      </div>
    </>
  );
}
