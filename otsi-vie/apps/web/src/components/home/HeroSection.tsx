/**
 * Page 01 Section 02 — cinematic hero and upload controls (approved reference 01_HOME_OVERVIEW, "hero", corrected clean state).
 *
 * The illustration on the right is live (HeroLive): a real frame of the organization's own footage showing a random CONFIRMED player,
 * changing every few seconds, with his card and his measured speed, distance, passes and key passes ("—" for what was not measured).
 * Never an invented player or number.
 * The two controls open the real upload page in the matching source mode (file upload / link import).
 */
import Link from "next/link";
import { B, Ic, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { HeroLive } from "./HeroLive";
import { UploadMax } from "./UploadMax";

const STARS = Array.from({ length: 9 }, (_, i) => ({ x: 180 + i * 130, y: 130 + Math.abs(i - 4) * 16 }));

export function HeroSection() {
  return (
    <section aria-label="Hero: football video intelligence" data-section="p01-s02">
      {/* band: stadium glow from the top, turf glow at the bottom */}
      <B x={0} y={101} w={2560} h={500}
        style={{ background: "radial-gradient(ellipse at 55% 0,#3a8ae0 0,#12376e 25%,transparent 55%),linear-gradient(180deg,#071a38 0,#06122a 60%,#0d3a1c 92%,#06122a)" }} />
      {STARS.map((p) => (
        <B key={p.x} x={p.x} y={p.y} w={12} h={12} style={{ background: "#cfe8ff", borderRadius: "50%", boxShadow: `0 0 ${u(14)} #fff` }} />
      ))}

      <T x={60} y={154} size={22} ls={5} color="#b9cbe2">TURN FOOTBALL VIDEO INTO INSIGHTS</T>
      <h1 style={{ margin: 0, fontSize: "inherit" }}>
        <T as="span" x={60} y={216} size={80} weight={700} ls={-1}>Professional Football</T>{" "}
        <T as="span" x={60} y={292} size={80} weight={700} ls={-1} color="#0a9bff">Video Intelligence</T>
      </h1>
      <T x={60} y={358} size={29} color="#e3eefb">Upload matches, analyze every player, create reels and share</T>
      <T x={60} y={396} size={29} color="#e3eefb">insights — built for analysts, scouts and agencies.</T>

      {/* upload controls */}
      <Link href="/upload?mode=file" className={`${s.cta} ${s.ctaPrimary}`} data-cta="upload"
        style={{ left: u(59), top: u(442 - 101), width: u(384), height: u(96), background: "linear-gradient(90deg,#0a84ff,#08a0ff)", borderRadius: u(10), boxShadow: `0 0 ${u(24)} #0a84ff` }}>
        <Ic o={[59, 442]} x={131} y={490} k="up" size={56} color="#fff" />
        <T o={[59, 442]} x={185} y={474} size={29} weight={600} as="span">Upload Video</T>
        <T o={[59, 442]} x={185} y={508} size={22} color="#dbeaff" as="span">MP4, MOV, up to <UploadMax /></T>
      </Link>
      <Link href="/upload?mode=url" className={`${s.cta} ${s.framed}`} data-cta="paste-link"
        style={{ left: u(466), top: u(442 - 101), width: u(414), height: u(96), background: "rgba(5,16,36,.8)", borderRadius: u(10), ["--bc" as string]: "#17406f" }}>
        <Ic o={[466, 442]} x={522} y={490} k="link" size={50} color="#cfe0f5" />
        <T o={[466, 442]} x={577} y={474} size={29} weight={600} as="span">Paste Link</T>
        <T o={[466, 442]} x={577} y={508} size={22} color="#b9cbe2" as="span">YouTube, Hudl, Wyscout...</T>
      </Link>

      {/* illustration: a real frame of a random confirmed player from the organization's own footage, changing every few seconds */}
      <div data-illustration>
        <HeroLive />
      </div>
    </section>
  );
}
