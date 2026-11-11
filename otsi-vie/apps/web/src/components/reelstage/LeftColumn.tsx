"use client";
/**
 * Page 06 Sections 02-04 — introduction and workflow, Aspect Ratio, Reel Info (approved reference 06_REEL_BUILDER, left column).
 *
 * The four steps reflect the reel's real state (a player a person confirmed, clips added, the render result); a step is only marked done
 * when it is. Clicking a step jumps to its panel. Aspect ratio and the title are real, saved with the reel. Music opens the music picker
 * (ADR-047: uploaded with a rights declaration, mixed under the reel). Description has no place in the reel yet, so it is disabled with its
 * reason; Duration is automatic (the clips' total). Matches (ADR-131) chooses which matches the reel covers: this match, or a new
 * all-matches reel — the Description box is shorter to make room for the row.
 */
import { REEL_STEP_KEY, type Reel, type ReelAspectT } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { Hit } from "@/components/workspace/shared";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { MusicPicker, useMusic } from "./MusicPicker";
import { ReelSourceChoice } from "@/components/reels/ReelBuilder";
import { input, secs, useStage } from "./shared";
import { notBuilt } from "@/lib/devMode";

const STEPS: [string, number, string][] = [["Select Player", 403, "p06-target"], ["Choose Moments", 496, "p06-moments"], ["Edit & Style", 588, "p06-spotlight"], ["Export", 681, "p06-output"]];

export function LeftColumn() {
  const { t: dict } = useLocale();
  const { r, name, setName, jump, draft, setDraft } = useStage();
  const [musicOpen, setMusicOpen] = useState(false);
  const [music] = useMusic();
  const tune = draft?.music_id ? (music?.find((m) => m.id === draft.music_id)?.name ?? "Music chosen") : null;
  const reel = r?.reel ?? null;
  const render = reel?.latest_render ?? null;
  const done = [!!reel?.player && !reel.stale, (reel?.clips.length ?? 0) > 0, false, render?.state === "SUCCEEDED"];
  const sub = [reel?.player ? reel.player.display_name : "No player selected",
    reel && reel.clips.length ? `${reel.clips.length} clip${reel.clips.length === 1 ? "" : "s"}, ${secs(reel.duration_us)}` : "No moments selected",
    "Spotlight, overlays, music", render ? (render.state === "SUCCEEDED" ? "Rendered" : render.state === "FAILED" ? "Render failed" : "Rendering…") : "Render and share"];
  // B.13 (ADR-089): the step a person last worked on in this reel is remembered in this browser; the reel reopens there
  const [worked, setWorked] = useState<number | null>(null);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!reel || opened.current === reel.id) return;
    opened.current = reel.id;
    let n: number | null = null;
    try { const v = Number(localStorage.getItem(REEL_STEP_KEY(reel.id))); if (Number.isInteger(v) && v >= 0 && v < STEPS.length) n = v; } catch { /* not remembered */ }
    setWorked(n);
    if (n !== null) setTimeout(() => jump(STEPS[n]![2]), 300);
  }, [reel, jump]);
  const goStep = (i: number) => { setWorked(i); if (reel) { try { localStorage.setItem(REEL_STEP_KEY(reel.id), String(i)); } catch { /* not remembered */ } } jump(STEPS[i]![2]); };
  const firstOpen = done.findIndex((d) => !d) === -1 ? 3 : done.findIndex((d) => !d);
  const current = worked ?? firstOpen;
  const aspect = reel?.aspect ?? "16:9";
  const canEdit = !!r?.canEdit && !r.busy && !!reel;
  const setAspect = (a: ReelAspectT) => { if (r && reel && a !== reel.aspect) r.run(() => api<Reel>(`/v1/reels/${reel.id}`, { method: "PATCH", json: { version: reel.version, aspect: a } })); };
  return (
    <>
      <section aria-label="Reel workflow" data-section="p06-s02">
        <P x={20} y={122} w={398} h={654} />
        <Link href="/reels" aria-label={dict.body.reels.backToReels} className="absolute" style={{ left: u(40), top: u(136 - 101), width: u(200), height: u(36) }}>
          <Ic o={[40, 136]} x={58} y={154} k="back" size={26} color="#33a8ff" />
          <T o={[40, 136]} x={87} y={154} size={22} color="#33a8ff" as="span">{dict.body.reels.backToReels}</T>
        </Link>
        <T x={45} y={209} size={46} weight={700} as="h1">Reel Builder</T>
        <T x={45} y={253} size={36} weight={700} color="#1e90ff" as="h2">Spotlight Composer</T>
        {["Create cinematic, data-driven", "highlight reels with AI-powered", "spotlight effects."].map((l, i) => <T key={l} x={45} y={[298, 328.5, 359][i]!} size={23} color="#cfe0f5">{l}</T>)}
        <B x={45} y={391} w={356} h={1} style={{ background: "#12335f" }} />
        <B x={21} y={392 + current * 92.5} w={397} h={94} style={{ background: "linear-gradient(90deg,#0b2b57,#08213f)", borderRadius: u(8) }} />
        <ol aria-label="Reel steps" data-worked-step={worked ?? ""} style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {STEPS.map(([n, top], i) => (
            <li key={n} data-reel-step={n} data-done={done[i] ? "1" : "0"} aria-current={current === i ? "step" : undefined}>
              <B x={44} y={top} w={66} h={66} style={{ borderRadius: "50%", background: current === i ? "#0a84ff" : "#122339", border: current === i ? "none" : `${u(1.5)} solid #1b3350`,
                fontSize: u(28), fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{done[i] ? "" : i + 1}</B>
              {done[i] && <Ic x={77} y={top + 33} k="chk" size={32} color="#3ee6a8" />}
              <T x={134} y={top + 33 - 14} size={22} weight={600}>{n}</T>
              <T x={134} y={top + 33 + 20} size={20} color="#9fb3cc" style={{ maxWidth: u(270), overflow: "hidden", textOverflow: "ellipsis" }}>{sub[i]}</T>
              <Hit x={21} y={top - 11} w={397} h={92} label={`${n}: ${sub[i]}`} onClick={() => goStep(i)} />
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="Aspect ratio" data-section="p06-s03" data-aspect={aspect}>
        <P x={20} y={787} w={398} h={193} />
        <T x={40} y={817} size={22} weight={600} as="h3">{dict.body.reels.aspectRatio}</T>
        <div role="radiogroup" aria-label="Aspect ratio">
          {([["16:9", "YouTube, Web", 36, 92, "cam"], ["9:16", "Reels, Shorts", 132, 90, "ph"], ["1:1", "Instagram", 226, 88, "sq"], ["4:5", "Feed posts", 318, 86, "sq"]] as const).map(([a, d, x, w, icon]) => {
            const on = aspect === a;
            return (
              <div key={a} role="radio" aria-checked={on}>
                <B x={x} y={846} w={w} h={118} style={{ borderRadius: u(10), background: on ? "#0a2b55" : "#0a1d38", border: on ? `${u(3)} solid #1e90ff` : `${u(1.5)} solid #17406f`, boxSizing: "border-box" }} />
                <Ic x={x + w / 2} y={878} k={icon} size={34} color={on ? "#33a8ff" : "#cfe0f5"} />
                <T x={x + w / 2} y={915} size={20} weight={600} align="center">{a}</T>
                <T x={x + w / 2} y={941} size={14} color="#8ea3bf" align="center">{d}</T>
                <Hit x={x} y={846} w={w} h={118} label={`Aspect ratio ${a}`} pressed={on} {...(canEdit ? { onClick: () => setAspect(a) } : { reason: reel ? "You cannot edit this reel" : "Open a reel first" })} />
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Reel info" data-section="p06-s04">
        <P x={20} y={992} w={398} h={423} />
        <T x={40} y={1027} size={24} weight={600} as="h3">{dict.body.reels.reelInfo}</T>
        <T x={40} y={1052} size={19} color="#8ea3bf">{dict.body.reels.reelTitle}</T>
        <input aria-label="Reel title" placeholder="Enter a reel title" value={name} maxLength={200} disabled={!canEdit} onChange={(e) => setName(e.target.value)}
          className="absolute" style={{ left: u(38), top: u(1066 - 101), width: u(363), height: u(53), boxSizing: "border-box", padding: `0 ${u(13)}`, color: "#fff", fontSize: u(20), outline: "none", ...input }} />
        <T x={40} y={1147} size={19} color="#8ea3bf">{dict.body.reels.reelDescription}</T>
        <textarea aria-label="Reel description" placeholder="Describe this reel (optional)" disabled title={notBuilt("a reel has no description field")}
          className="absolute" style={{ left: u(38), top: u(1160 - 101), width: u(363), height: u(52), boxSizing: "border-box", padding: u(13), color: "#fff", fontSize: u(20), resize: "none", opacity: 0.7, ...input }} />
        <T x={40} y={1252} size={19} color="#8ea3bf">{dict.body.reels.duration}</T>
        <B x={128} y={1226} w={273} h={52} style={input}>
          <span style={{ position: "absolute", left: u(18), top: "50%", transform: "translateY(-50%)", fontSize: u(20), whiteSpace: "nowrap" }}>Auto (Best Moments)</span>
        </B>
        <Ic x={381} y={1252} k="chev" size={20} color="#8ea3bf" />
        <div aria-label="The reel's duration is the total of its clips" title="Automatic: the total of the clips you add" className="absolute" style={{ left: u(128), top: u(1226 - 101), width: u(273), height: u(52) }} />
        <T x={40} y={1318} size={19} color="#8ea3bf">{dict.body.reels.music}</T>
        <B x={128} y={1294} w={273} h={52} style={input} />
        <Ic x={153} y={1320} k="note" size={28} color={tune ? "#3ee6a8" : "#cfe0f5"} />
        <T x={181} y={1320} size={20} color={tune ? "#fff" : "#cfe0f5"} style={{ maxWidth: u(190), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tune ?? "Choose music"}</T>
        <Ic x={381} y={1320} k="chev" size={20} color="#8ea3bf" />
        <Hit x={128} y={1294} w={273} h={52} label={tune ? `Music: ${tune}. Change it` : "Choose music: upload your own, with the right to use it"}
          {...(r?.canEdit && reel && draft ? { onClick: () => setMusicOpen(true) } : { reason: reel ? "You cannot edit this reel" : "Open a reel first" })} />
        {musicOpen && draft && <MusicPicker settings={draft} onChange={setDraft} onClose={() => setMusicOpen(false)} />}
        {/* ADR-131: which matches this reel covers — "All matches" makes a NEW cross-match reel and opens it; this reel is untouched.
            For a cross-match reel the row is a read-only summary (length + rule version). The row ends at y1414, inside the panel.
            Hidden when no reel is open: ReelSourceChoice needs the ReelBuilder context, which only exists with a reel open. */}
        {r && (<>
          <T x={40} y={1360} size={19} color="#8ea3bf">{dict.body.reels.matches}</T>
          <div className="absolute" style={{ left: u(38), top: u(1378 - 101), width: u(363) }}>
            <ReelSourceChoice compact />
          </div>
        </>)}
      </section>
    </>
  );
}
