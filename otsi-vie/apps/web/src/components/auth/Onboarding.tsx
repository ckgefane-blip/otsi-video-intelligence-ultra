"use client";
/**
 * First-run welcome, rebuilt on the new UI (Graphite Studio, Drop 1/Drop 2).
 * The old intro was four pre-rendered videos in the old blue design
 * (00_SPLASH, 01_TRACK_EVERY_PLAYER, 02_TACTICAL_INTELLIGENCE,
 * 03_REELS_AND_REPORTS). Those videos cannot be recoloured, so the tour
 * is now rendered live in React from the new design system: the splash,
 * the three tour screens (Skip / Back / Next / Get Started, arrow keys,
 * Esc), then one more step the videos did not have — the person's own
 * name. The name and the end of the tour are saved on the person's
 * account (PATCH /v1/me), so the header shows who they are and the
 * welcome is shown once. The tour describes what the engine does; it
 * shows no player data and no numbers that were not measured.
 */
import type { Me } from "@otsi-vie/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import { useLocale } from "@/lib/i18n";

const NAME = 4;

interface Card {
  icon: "track" | "id" | "ball" | "events" | "pass" | "heat" | "shape" | "press" | "reel" | "report" | "export" | "share";
  title: string;
  desc: string;
}
interface Slide {
  titleA: string;
  titleB: string;
  sub: string;
  cards: Card[];
}
const SLIDES: Slide[] = [
  {
    titleA: "Track Every",
    titleB: "Player",
    sub: "Automatically detect players, referees, the ball, and key actions from every match.",
    cards: [
      { icon: "track", title: "Player tracking", desc: "Detect and track all players on the pitch" },
      { icon: "id", title: "Identity resolution", desc: "Assign consistent player IDs across videos" },
      { icon: "ball", title: "Ball detection", desc: "Track the ball in real time" },
      { icon: "events", title: "Event indexing", desc: "Link tracking to key events and actions" },
    ],
  },
  {
    titleA: "See Tactical",
    titleB: "Intelligence",
    sub: "Understand team shape, pass networks, heat zones, pressing behavior, and off-ball movement in context.",
    cards: [
      { icon: "pass", title: "Pass Networks", desc: "How the team connects and moves the ball" },
      { icon: "heat", title: "Heat Zones", desc: "Where the action happens on the pitch" },
      { icon: "shape", title: "Team Shape", desc: "Formation, width, length and compactness" },
      { icon: "press", title: "Pressing Analysis", desc: "Pressing intensity and recoveries" },
    ],
  },
  {
    titleA: "Create",
    titleB: "Reels & Reports",
    sub: "Build verified highlight reels, export player reports, and share trusted insights with your team and clients.",
    cards: [
      { icon: "reel", title: "Reel builder", desc: "Turn moments into stories" },
      { icon: "report", title: "Player reports", desc: "Data-rich, visual insights" },
      { icon: "export", title: "Export", desc: "Multiple formats" },
      { icon: "share", title: "Share", desc: "With your team and clients" },
    ],
  },
];

// the name card keeps the sizes it was designed with on the 1672-pixel artwork
const q = (px: number) => `${((px / 1672) * 100).toFixed(3)}cqw`;
const ctl: CSSProperties = { position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", cursor: "pointer", fontFamily: "inherit", padding: 0 };
const Arrow = ({ back }: { back?: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden style={{ width: "1.5cqw", height: "1.5cqw", stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d={back ? "M20 12H4M10 6l-6 6 6 6" : "M4 12h16M14 6l6 6-6 6"} />
  </svg>
);
const Icon = ({ kind }: { kind: Card["icon"] }) => (
  <svg viewBox="0 0 24 24" aria-hidden style={{ width: "2.2cqw", height: "2.2cqw", stroke: "currentColor", fill: "none", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
    {kind === "track" && <><circle cx="12" cy="7" r="3" /><path d="M12 10v5M7 21l2-5h6l2 5M9 15l3-2 3 2" /></>}
    {kind === "id" && <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-3.5 3.8-5 7-5s6 1.5 7 5" /></>}
    {kind === "ball" && <><circle cx="12" cy="12" r="9" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></>}
    {kind === "events" && <><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></>}
    {kind === "pass" && <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M8 6h8M7 8l4 8M17 8l-4 8" /></>}
    {kind === "heat" && <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="12" cy="12" r="4" /><circle cx="8" cy="8" r="1" /><circle cx="16" cy="16" r="1" /></>}
    {kind === "shape" && <><circle cx="12" cy="5" r="2" /><circle cx="6" cy="12" r="2" /><circle cx="18" cy="12" r="2" /><circle cx="12" cy="19" r="2" /><path d="M12 7v3M8 12h8" /></>}
    {kind === "press" && <><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" /></>}
    {kind === "reel" && <><circle cx="12" cy="12" r="9" /><path d="M10 8l6 4-6 4z" /></>}
    {kind === "report" && <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>}
    {kind === "export" && <><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></>}
    {kind === "share" && <><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8 11l8-4M8 13l8 4" /></>}
  </svg>
);

export function Onboarding() {
  const { t } = useLocale();
  const { status, me, updateMe } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const done = !!me?.user.onboarded_at;

  useEffect(() => { if (status === "signed-out") router.replace("/login?next=%2Fwelcome"); }, [status, router]);
  useEffect(() => { if (me && !name) setName(me.user.display_name); }, [me]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the splash is a real loading screen: once the session is known the bar
  // is full and the tour begins (a click does it at once).
  useEffect(() => { if (step === 0 && status === "signed-in" && me) setReady(true); }, [step, status, me]);
  useEffect(() => {
    if (step !== 0 || !ready) return;
    const t = setTimeout(() => setStep(1), 900);
    return () => clearTimeout(t);
  }, [step, ready]);

  const go = useCallback((n: number) => setStep(n), []);
  useEffect(() => {
    if (step === NAME) return;
    const key = (e: KeyboardEvent) => {
      if (e.code === "ArrowRight" || (step === 0 && e.code === "Enter")) go(step === 3 ? NAME : step + 1);
      else if (e.code === "ArrowLeft" && step > 1) go(step - 1);
      else if (e.code === "Escape" && step > 0) go(NAME);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [step, go]);

  if (status !== "signed-in" || !me) return <div className="grid min-h-screen place-items-center bg-canvas t-body text-muted" role="status">{t.body.auth.loading}</div>;

  const finish = () => {
    const n = name.trim();
    if (n.length < 2) { setErr(t.body.auth.nameTooShort); return; }
    setBusy(true); setErr(null);
    void api<Me>("/v1/me", { method: "PATCH", json: { display_name: n, onboarding_done: true }, organization: false })
      .then((m) => { updateMe(m); router.replace("/dashboard"); },
        (x) => { setErr(x instanceof ApiProblem ? x.message : t.body.auth.nameSaveFailed); setBusy(false); });
  };
  const slide = step >= 1 && step <= 3 ? SLIDES[step - 1]! : null;
  const tour = !!slide;
  return (
    <main className="grid min-h-screen place-items-center bg-canvas" style={{ fontFamily: '"Inter","Segoe UI",system-ui,sans-serif' }}>
      <div style={{ position: "relative", width: "min(100vw, 177.78vh)", aspectRatio: "16 / 9", overflow: "hidden", containerType: "inline-size", background: "rgb(var(--canvas))", color: "rgb(var(--ink))" }} data-onboarding-step={step}>
        {step === 0 && (
          <>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2cqw" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "1.2cqw" }}>
                <span aria-hidden style={{ width: "4.4cqw", height: "4.4cqw", borderRadius: "50%", background: "rgb(var(--primary))", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "rgb(var(--primary-ink))", fontWeight: 400, fontSize: "2.4cqw" }}>O</span>
                <span style={{ fontSize: "3.4cqw", fontWeight: 400, letterSpacing: ".04em" }}>OTSI <span style={{ color: "rgb(var(--primary))" }}>VIE</span></span>
              </div>
              <p style={{ margin: 0, fontSize: "1.05cqw", letterSpacing: ".35em", color: "rgb(var(--muted))" }}>VIDEO INTELLIGENCE ENGINE</p>
              <p style={{ margin: 0, fontSize: "2.2cqw", fontWeight: 400 }}>Turn football video into insights.</p>
              <div role="progressbar" aria-label={t.body.auth.loadingWorkspaceAria} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ready ? 100 : 40}
                style={{ width: "29.5%", height: "1.6%", boxSizing: "border-box", border: `${q(2)} solid rgb(var(--primary))`, borderRadius: q(20), background: "rgb(var(--panel))", overflow: "hidden" }}>
                <div style={{ width: ready ? "100%" : "40%", height: "100%", borderRadius: q(20), background: "rgb(var(--primary))", transition: "width .5s ease-out" }} />
              </div>
              <p role="status" style={{ margin: 0, fontSize: q(12), color: "rgb(var(--ink2))" }}>{ready ? t.body.auth.ready : t.body.auth.loadingWorkspace}</p>
            </div>
            <button type="button" aria-label={t.body.auth.startTourAria} onClick={() => go(1)} className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-primary"
              style={{ position: "absolute", inset: 0, background: "transparent", border: 0, padding: 0, cursor: "pointer" }} />
          </>
        )}
        {tour && (
          <>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2.2cqw", padding: "0 6%" }}>
              <h1 style={{ margin: 0, textAlign: "center", fontSize: "4.4cqw", lineHeight: 1.1, fontWeight: 400 }}>
                {slide.titleA} <span style={{ color: "rgb(var(--primary))" }}>{slide.titleB}</span>
              </h1>
              <p style={{ margin: 0, maxWidth: "62%", textAlign: "center", fontSize: "1.35cqw", lineHeight: 1.5, color: "rgb(var(--ink2))" }}>{slide.sub}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1.4cqw", width: "100%" }}>
                {slide.cards.map((c) => (
                  <div key={c.title} style={{ background: "rgb(var(--panel))", border: `${q(1.5)} solid rgb(var(--line))`, borderRadius: q(12), padding: "1.4cqw 1.2cqw", display: "flex", flexDirection: "column", gap: ".8cqw" }}>
                    <span style={{ color: "rgb(var(--primary))" }}><Icon kind={c.icon} /></span>
                    <span style={{ fontSize: "1.15cqw", fontWeight: 400 }}>{c.title}</span>
                    <span style={{ fontSize: "1cqw", lineHeight: 1.5, color: "rgb(var(--muted))" }}>{c.desc}</span>
                  </div>
                ))}
              </div>
            </div>
            <button type="button" onClick={() => go(NAME)} className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-primary"
              style={{ ...ctl, right: "2.8%", top: "7.2%", height: "2.4cqw", background: "none", border: 0, color: "rgb(var(--ink2))", fontSize: q(13), gap: ".9cqw" }}>
              {t.body.auth.skipTour} <span style={{ color: "rgb(var(--primary))", display: "inline-flex" }}><Arrow /></span>
            </button>
            <button type="button" onClick={() => go(step - 1)} className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-primary"
              style={{ ...ctl, left: "3.05%", top: "88.5%", width: "12.44%", height: "6.38%", border: `${q(1.5)} solid rgb(var(--line2))`, borderRadius: ".8cqw", background: "rgb(var(--raised))", color: "rgb(var(--muted))", fontSize: q(13), gap: "1cqw" }}>
              {t.body.auth.back}
            </button>
            <div role="presentation" style={{ position: "absolute", left: "50%", top: "91.3%", transform: "translate(-50%,-50%)", display: "flex", gap: "1.7cqw" }}>
              {SLIDES.map((_, i) => (
                <span key={i} style={{ width: ".9cqw", height: ".9cqw", borderRadius: "50%", background: i === step - 1 ? "rgb(var(--primary))" : "rgb(var(--line))" }} />
              ))}
            </div>
            <button type="button" onClick={() => go(step === 3 ? NAME : step + 1)} className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-primary"
              style={{ ...ctl, left: "84.8%", top: "88.5%", width: "12.38%", height: "6.38%", borderRadius: ".8cqw", border: 0, background: "rgb(var(--primary))", color: "rgb(var(--primary-ink))", fontWeight: 400, gap: ".8cqw", fontSize: q(13) }}>
              {step === 3 ? t.body.auth.getStarted : t.body.auth.next} <Arrow />
            </button>
          </>
        )}
        {step === NAME && (
          // the name step is a real form, not part of the tour footage: Drop 1 tokens, and type tightened to the
          // Filmora scale (page title 16, body 13, label 12, button 13; weights 600 max) via q() at the 1672 design width
          <form onSubmit={(e) => { e.preventDefault(); finish(); }} aria-labelledby="welcome-title" data-welcome-name
            style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: q(640), padding: q(24), boxSizing: "border-box", borderRadius: q(12),
              background: "rgb(var(--panel))", border: `${q(2)} solid rgb(var(--line2))`, boxShadow: "0 0 60px rgb(var(--primary) / 0.18)", color: "rgb(var(--ink))" }}>
            <h1 id="welcome-title" style={{ margin: 0, fontSize: q(16), fontWeight: 400 }}>{t.body.auth.welcome}</h1>
            <p style={{ margin: `${q(4)} 0 ${q(16)}`, fontSize: q(13), color: "rgb(var(--ink2))" }}>{t.body.auth.welcomeNameQ}</p>
            <label htmlFor="welcome-name" style={{ fontSize: q(12), color: "rgb(var(--muted))" }}>{t.body.auth.yourName}</label>
            <input id="welcome-name" name="display_name" autoComplete="name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.body.auth.nameExample}
              style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: q(4), height: q(40), padding: `0 ${q(12)}`, fontSize: q(13), color: "rgb(var(--ink))", background: "rgb(var(--canvas))", border: `${q(1.5)} solid rgb(var(--line2))`, borderRadius: q(8), outline: "none" }} />
            {err && <p role="alert" style={{ margin: `${q(8)} 0 0`, fontSize: q(12), color: "rgb(var(--danger))" }}>{err}</p>}
            <button type="submit" disabled={busy} style={{ marginTop: q(20), width: "100%", height: q(44), fontSize: q(13), fontWeight: 400, color: "rgb(var(--primary-ink))", background: "rgb(var(--primary))", border: 0, borderRadius: q(8), cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
              {busy ? t.body.auth.saving : t.body.auth.startUsing}
            </button>
            <button type="button" onClick={() => setStep(3)} style={{ marginTop: q(12), width: "100%", fontSize: q(12), color: "rgb(var(--primary))", background: "transparent", border: 0, cursor: "pointer" }}>{t.body.auth.backTour}</button>
            {done && <button type="button" onClick={() => router.replace("/dashboard")} style={{ marginTop: q(8), width: "100%", fontSize: q(12), color: "rgb(var(--muted))", background: "transparent", border: 0, cursor: "pointer" }}>{t.body.auth.cancel}</button>}
          </form>
        )}
      </div>
    </main>
  );
}
