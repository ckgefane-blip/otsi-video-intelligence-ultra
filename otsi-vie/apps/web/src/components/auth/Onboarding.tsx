"use client";
/**
 * First-run welcome (owner videos 00_SPLASH, 01_TRACK_EVERY_PLAYER, 02_TACTICAL_INTELLIGENCE, 03_REELS_AND_REPORTS, 2560x1440, 10 s each):
 * the splash, the three-screen tour (Skip / Back / Next / Get Started, pause/play, arrow keys, Esc), then one more step the videos do not have —
 * the person's own name. The name and the end of the tour are saved on the person's account (PATCH /v1/me), so the header shows who they are
 * and the welcome is shown once. The controls were taken out of the footage and are drawn here, each where that screen's own page placed it
 * (every screen places them differently). The splash's drawn loading bar is covered by a real one. Nothing in the videos is real data.
 */
import type { Me } from "@otsi-vie/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useAuth } from "./AuthProvider";

const NAME = 4;
const TOUR = ["01_TRACK_EVERY_PLAYER", "02_TACTICAL_INTELLIGENCE", "03_REELS_AND_REPORTS"];
interface Screen {
  file: string; alt: string;
  skip?: CSSProperties; back?: CSSProperties & { arrow?: boolean }; next?: CSSProperties & { label: string };
  dots?: { top: string; size: string }; pause?: CSSProperties;
}
// positions and sizes as the owner's video pages set them (percent of the stage, cqw = 1 % of its width)
const SCREENS: Screen[] = [
  { file: "00_SPLASH", alt: "OTSI VIE: turn football video into insights" },
  { file: "01_TRACK_EVERY_PLAYER", alt: "Track every player",
    skip: { right: "2.8%", top: "7.2%", height: "2.4cqw" },
    back: { left: "3.05%", top: "88.5%", width: "12.44%", height: "6.38%" },
    next: { left: "84.8%", top: "88.5%", width: "12.38%", height: "6.38%", label: "Next" },
    dots: { top: "91.3%", size: ".9cqw" }, pause: { left: "57.5%", top: "90%" } },
  { file: "02_TACTICAL_INTELLIGENCE", alt: "Tactical intelligence",
    skip: { left: "88.52%", top: "7.44%", width: "8.97%", height: "5%", background: "rgba(8,24,48,.55)", border: "1px solid rgba(120,160,210,.5)", borderRadius: ".7cqw", color: "#e4eef8" },
    back: { left: "18.3%", top: "89.2%", width: "9.6%", height: "5.4%", arrow: true },
    next: { left: "72.8%", top: "89.2%", width: "10.7%", height: "5.4%", label: "Next" },
    dots: { top: "91.9%", size: ".8cqw" }, pause: { left: "55.5%", top: "90.7%" } },
  { file: "03_REELS_AND_REPORTS", alt: "Create reels and reports",
    skip: { right: "2.4%", top: "6.7%", height: "2.4cqw" },
    back: { left: "3.05%", top: "90%", width: "9.93%", height: "5.5%", arrow: true },
    next: { left: "84.27%", top: "90%", width: "13.28%", height: "5.5%", label: "Get Started" },
    dots: { top: "92.8%", size: ".8cqw" }, pause: { left: "56%", top: "91.3%" } },
];
// the name card keeps the sizes it was designed with on the 1672-pixel artwork
const q = (px: number) => `${((px / 1672) * 100).toFixed(3)}cqw`;
const src = (f: string) => `/onboarding/${f}.mp4`;
const poster = (f: string) => `/onboarding/${f}_poster.webp`;
const ctl: CSSProperties = { position: "absolute", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", cursor: "pointer", fontFamily: "inherit", color: "#fff", padding: 0 };
const Arrow = ({ back }: { back?: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden style={{ width: "1.5cqw", height: "1.5cqw", stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
    <path d={back ? "M20 12H4M10 6l-6 6 6 6" : "M4 12h16M14 6l6 6-6 6"} />
  </svg>
);

export function Onboarding() {
  const { status, me, updateMe } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const done = !!me?.user.onboarded_at;

  useEffect(() => { if (status === "signed-out") router.replace("/login?next=%2Fwelcome"); }, [status, router]);
  useEffect(() => { if (me && !name) setName(me.user.display_name); }, [me]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the splash is a real loading screen: the session is known, the three tour posters are fetched and the first tour video can play through.
  // The bar shows how many of those five things are done; the tour begins when it is full and the splash video has played (a click does it at once).
  const [loaded, setLoaded] = useState(0);
  const [splashOver, setSplashOver] = useState(false);
  useEffect(() => {
    if (step !== 0 || status !== "signed-in") return;
    let live = true;
    const one = () => { if (live) setLoaded((n) => n + 1); };
    setLoaded(1);                                                        // the session (who you are) is ready
    const t = setTimeout(() => live && setSplashOver(true), 10_500);    // the splash video is 10 s; never wait longer if it cannot play
    for (const f of TOUR) { const im = new Image(); im.onload = im.onerror = one; im.src = poster(f); }
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto";
    let counted = false;
    v.oncanplaythrough = v.onerror = () => { if (!counted) { counted = true; one(); } };
    v.src = src(TOUR[0]!);
    v.load();
    return () => { live = false; clearTimeout(t); v.removeAttribute("src"); v.load(); };
  }, [step, status]);
  const progress = Math.min(1, loaded / (TOUR.length + 2));
  useEffect(() => { if (step === 0 && progress >= 1 && splashOver) { const t = setTimeout(() => setStep(1), 300); return () => clearTimeout(t); } }, [step, progress, splashOver]);

  // play/pause follows the screen; a hidden tab pauses; reduced motion starts paused
  useEffect(() => { setPaused(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches); }, [step]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    // only a refusal to autoplay shows the play button; a start cut short by moving on to the next screen (AbortError) is not a pause
    if (paused) v.pause(); else void v.play().catch((e: unknown) => { if (video.current === v && (e as Error)?.name === "NotAllowedError") setPaused(true); });
  }, [paused, step]);
  useEffect(() => {
    const vis = () => { const v = video.current; if (!v) return; if (document.hidden) v.pause(); else if (!paused) void v.play().catch(() => {}); };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, [paused]);
  const go = useCallback((n: number) => setStep(n), []);
  useEffect(() => {
    if (step === NAME) return;
    const key = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (e.code === "ArrowRight" || (step === 0 && e.code === "Enter")) go(step === 3 ? NAME : step + 1);
      else if (e.code === "ArrowLeft" && step > 1) go(step - 1);
      else if (e.code === "Escape" && step > 0) go(NAME);
      else if (e.code === "Space" && tag !== "BUTTON" && tag !== "INPUT") { e.preventDefault(); setPaused((p) => !p); }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [step, go]);

  if (status !== "signed-in" || !me) return <div className="grid min-h-screen place-items-center bg-[#000b18] text-sm text-muted" role="status">Loading…</div>;


  const finish = () => {
    const n = name.trim();
    if (n.length < 2) { setErr("Enter at least 2 characters."); return; }
    setBusy(true); setErr(null);
    void api<Me>("/v1/me", { method: "PATCH", json: { display_name: n, onboarding_done: true }, organization: false })
      .then((m) => { updateMe(m); router.replace("/dashboard"); },
        (x) => { setErr(x instanceof ApiProblem ? x.message : "Your name could not be saved."); setBusy(false); });
  };
  const s = SCREENS[Math.min(step, 3)]!;
  const tour = step >= 1 && step <= 3;
  return (
    <main className="grid min-h-screen place-items-center bg-[#000b18]" style={{ fontFamily: '"Inter","Segoe UI",system-ui,sans-serif' }}>
      <div style={{ position: "relative", width: "min(100vw, 177.78vh)", aspectRatio: "16 / 9", overflow: "hidden", containerType: "inline-size", background: "#000b18" }} data-onboarding-step={step}>
        {step === NAME ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster("00_SPLASH")} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", userSelect: "none", filter: "brightness(.45) blur(2px)" }} />
        ) : (
          <video key={s.file} ref={video} src={src(s.file)} poster={poster(s.file)} muted playsInline autoPlay={!paused} loop={step !== 0} preload="auto" aria-label={s.alt}
            data-onboarding-video={s.file} onPlay={() => setPaused(false)} onEnded={() => { if (step === 0) setSplashOver(true); }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        )}
        {step === 0 && (
          <>
            {/* the video draws a pretend bar that fills by itself: covered, and a real one shows what has actually loaded */}
            {/* the drawn bar drifts with the camera push-in, from 86 % to 91 % of the height over the 10 s: the cover spans its whole path */}
            <div style={{ position: "absolute", left: "33.2%", top: "84.6%", width: "33.6%", height: "11.6%", background: "#020c17", borderRadius: "1.2cqw",
              boxShadow: "0 0 1.6cqw 1.2cqw #020c17", pointerEvents: "none" }} aria-hidden />
            <div role="progressbar" aria-label="Loading your workspace" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
              style={{ position: "absolute", left: "35.25%", top: "88.6%", width: "29.5%", height: "1.6%", boxSizing: "border-box", border: `${q(2)} solid #1e90ff`, borderRadius: q(20), background: "#04182b", overflow: "hidden", pointerEvents: "none" }}>
              <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: q(20), background: "linear-gradient(90deg,#14c3ff,#1e90ff)", boxShadow: "0 0 12px #1e90ff", transition: "width .5s ease-out" }} />
            </div>
            <p role="status" style={{ position: "absolute", left: 0, width: "100%", top: "91.6%", margin: 0, textAlign: "center", fontSize: "1.1cqw", color: "#cfdcf0", pointerEvents: "none" }}>
              {progress >= 1 ? "Ready" : "Loading workspace…"}
            </p>
            <button type="button" aria-label="Start the tour" onClick={() => go(1)} className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#33a8ff]"
              style={{ position: "absolute", inset: 0, background: "transparent", border: 0, padding: 0, cursor: "pointer" }} />
          </>
        )}
        {tour && (
          <>
            {s.skip && (
              <button type="button" onClick={() => go(NAME)} className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#33a8ff]"
                style={{ ...ctl, background: "none", border: 0, color: "#d6e6f5", fontSize: "1.1cqw", gap: ".9cqw", ...s.skip }}>
                Skip tour <span style={{ color: "#33a8ff", display: "inline-flex" }}><Arrow /></span>
              </button>
            )}
            {s.back && (
              <button type="button" onClick={() => go(step - 1)} className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#33a8ff]"
                style={{ ...ctl, border: "1px solid rgba(80,130,190,.45)", borderRadius: ".8cqw", background: "rgba(8,24,48,.75)", color: "#9bb0c6", fontSize: "1.2cqw", gap: "1cqw", ...{ ...s.back, arrow: undefined } }}>
                {s.back.arrow && <Arrow back />}Back
              </button>
            )}
            {s.dots && (
              <div role="presentation" style={{ position: "absolute", left: "50%", top: s.dots.top, transform: "translate(-50%,-50%)", display: "flex", gap: "1.7cqw" }}>
                {TOUR.map((f, i) => (
                  <span key={f} style={{ width: s.dots!.size, height: s.dots!.size, borderRadius: "50%", background: i === step - 1 ? "#1aa8ff" : "#2d3c52", boxShadow: i === step - 1 ? "0 0 .9cqw #1aa8ff" : undefined }} />
                ))}
              </div>
            )}
            {s.pause && (
              <button type="button" aria-label={paused ? "Play video" : "Pause video"} aria-pressed={paused} onClick={() => setPaused((p) => !p)}
                className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#33a8ff]"
                style={{ ...ctl, width: "2.2cqw", height: "2.2cqw", borderRadius: "50%", border: "1px solid rgba(80,130,190,.45)", background: "rgba(8,24,48,.6)", color: "#cfe3f7", ...s.pause }}>
                <svg viewBox="0 0 10 10" aria-hidden style={{ width: "1cqw", height: "1cqw", fill: "currentColor" }}>
                  {paused ? <path d="M2 1l7 4-7 4z" /> : <><rect x="1" y="1" width="3" height="8" /><rect x="6" y="1" width="3" height="8" /></>}
                </svg>
              </button>
            )}
            {s.next && (
              <button type="button" onClick={() => go(step === 3 ? NAME : step + 1)} className="focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[#33a8ff]"
                style={{ ...ctl, borderRadius: ".8cqw", border: 0, background: "linear-gradient(180deg,#14b3ff,#0a7fe8)", boxShadow: "0 0 1.8cqw rgba(30,160,255,.6),inset 0 0 0 1px rgba(150,220,255,.6)",
                  gap: ".8cqw", fontSize: "1.3cqw", ...{ ...s.next, label: undefined } }}>
                {s.next.label} <Arrow />
              </button>
            )}
            {/* the next screen's video loads while this one plays, so Next opens it at once */}
            {step < 3 && <video src={src(TOUR[step]!)} preload="auto" muted aria-hidden style={{ display: "none" }} />}
          </>
        )}
        {step === NAME && (
          <form onSubmit={(e) => { e.preventDefault(); finish(); }} aria-labelledby="welcome-title" data-welcome-name
            style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: q(640), padding: q(40), boxSizing: "border-box", borderRadius: q(18),
              background: "linear-gradient(180deg,#081a35,#06122a)", border: `${q(2)} solid #12335f`, boxShadow: "0 0 60px rgba(30,144,255,.25)", color: "#fff" }}>
            <h1 id="welcome-title" style={{ margin: 0, fontSize: q(44), fontWeight: 700 }}>Welcome to OTSI <span style={{ color: "#fff" }}>VIE</span></h1>
            <p style={{ margin: `${q(10)} 0 ${q(26)}`, fontSize: q(22), color: "#cfe0f5" }}>What should we call you? This is the name your team will see.</p>
            <label htmlFor="welcome-name" style={{ fontSize: q(19), color: "#8ea3bf" }}>Your name</label>
            <input id="welcome-name" name="display_name" autoComplete="name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Edmond Osio"
              style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: q(8), height: q(62), padding: `0 ${q(18)}`, fontSize: q(26), color: "#fff", background: "#041022", border: `${q(1.5)} solid #17406f`, borderRadius: q(10), outline: "none" }} />
            {err && <p role="alert" style={{ margin: `${q(10)} 0 0`, fontSize: q(19), color: "#ff8a8a" }}>{err}</p>}
            <button type="submit" disabled={busy} style={{ marginTop: q(30), width: "100%", height: q(66), fontSize: q(26), fontWeight: 700, color: "#fff", background: "#0a84ff", border: 0, borderRadius: q(10), cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
              {busy ? "Saving…" : "Start using OTSI VIE"}
            </button>
            <button type="button" onClick={() => setStep(3)} style={{ marginTop: q(14), width: "100%", fontSize: q(19), color: "#33a8ff", background: "transparent", border: 0, cursor: "pointer" }}>← Back to the tour</button>
            {done && <button type="button" onClick={() => router.replace("/dashboard")} style={{ marginTop: q(6), width: "100%", fontSize: q(19), color: "#8ea3bf", background: "transparent", border: 0, cursor: "pointer" }}>Cancel</button>}
          </form>
        )}
      </div>
    </main>
  );
}
