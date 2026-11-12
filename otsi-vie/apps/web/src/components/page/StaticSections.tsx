/**
 * Sections whose content is product copy or navigation, not data: they are complete as rendered. Each capability names the block that
 * builds it, so the copy never implies a feature that does not work yet.
 */
import { ArrowRight, BarChart3, Clapperboard, FileText, Link2, ScanSearch, Share2, Target, Upload, Users, Workflow } from "lucide-react";
import Link from "next/link";

export function HomeHero() {
  return (
    <div className="flex h-full flex-col justify-between gap-6 rounded-ctl bg-gradient-to-br from-raised/80 via-panel to-canvas p-5" data-owner-asset="hero-visual">
      <div>
        <p className="text-xs font-normal uppercase tracking-[0.25em] text-muted">Turn football video into insights</p>
        <p className="mt-2 t-page">
          Professional Football <span className="block text-primary">Video Intelligence</span>
        </p>
        <p className="mt-3 max-w-xl text-[15px] text-ink/85">
          Upload matches, analyze every visible player, create reels and share insights, built for analysts, scouts and agencies.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/upload?mode=file" className="flex items-center gap-3 rounded-ctl bg-primary px-5 py-3 font-normal text-white shadow-glow hover:brightness-110">
          <Upload className="h-5 w-5" />
          <span>Upload Video</span>
        </Link>
        <Link href="/upload?mode=url" className="flex items-center gap-3 rounded-ctl border border-line bg-panel px-5 py-3 font-normal hover:border-primary/60">
          <Link2 className="h-5 w-5" />
          <span>Paste Link</span>
        </Link>
      </div>
      <p className="text-[11px] text-muted">The stadium visual of the approved design is an owner-supplied, licensed asset (not yet provided).</p>
    </div>
  );
}

const CAPABILITIES = [
  { icon: ScanSearch, title: "AI Player Detection", text: "Detect and track every visible player, the ball and officials.", block: 5 },
  { icon: Target, title: "Tactical Analysis", text: "Team shape, transitions and pressing, with evidence states.", block: 9 },
  { icon: Clapperboard, title: "Custom Reels", text: "Player highlight reels with a verified spotlight.", block: 11 },
  { icon: FileText, title: "Detailed Reports", text: "Shareable player reports carrying the OTSI Player ID.", block: 9 },
  { icon: BarChart3, title: "Team & Player Stats", text: "Distances and speeds only with pitch calibration and uncertainty.", block: 8 },
  { icon: Users, title: "Collaborate & Share", text: "Work with your team and clients under rights controls.", block: 12 },
];

export function Capabilities() {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {CAPABILITIES.map(({ icon: Icon, title, text, block }) => (
        <li key={title} className="flex gap-3 rounded-ctl border border-line/70 bg-raised/50 p-3">
          <Icon className="mt-0.5 h-6 w-6 shrink-0 text-cyan" />
          <span>
            <span className="block text-sm font-normal">{title}</span>
            <span className="block text-xs text-muted">{text}</span>
            <span className="mt-1 block text-[11px] text-muted/80">In development · Block {String(block).padStart(2, "0")}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const STEPS = [
  { icon: Upload, title: "Upload Video", text: "Upload a match or training video, or link an authorised source.", href: "/upload?mode=file" },
  { icon: Workflow, title: "Analyze with AI", text: "Players, ball and key events are detected and tracked when visible.", href: "/processing" },
  { icon: Target, title: "Select a Player", text: "Choose a player by OTSI Player ID; unknown tracks stay unidentified.", href: "/analysis" },
  { icon: Clapperboard, title: "Generate Reel", text: "Build a highlight reel with filters and branding.", href: "/reels" },
  { icon: Share2, title: "Export & Share", text: "Deliver reports and reels to your team or clients.", href: "/exports" },
];

export function HowItWorks() {
  return (
    <ol className="grid grid-cols-1 gap-3 md:grid-cols-5">
      {STEPS.map(({ icon: Icon, title, text, href }, i) => (
        <li key={title} className="relative">
          <Link href={href} className="flex h-full flex-col gap-2 rounded-ctl border border-line/70 bg-raised/40 p-3 hover:border-primary/60">
            <span className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-sm font-normal text-white">{i + 1}</span>
              <Icon className="h-5 w-5 text-cyan" />
            </span>
            <span className="text-sm font-normal">{title}</span>
            <span className="text-xs text-muted">{text}</span>
          </Link>
          {i < STEPS.length - 1 && <ArrowRight aria-hidden className="absolute -right-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-primary md:block" />}
        </li>
      ))}
    </ol>
  );
}

const FORMATS = [
  ["MP4", "H.264/H.265"], ["MOV", "Apple ProRes"], ["AVI", "H.264"], ["MKV", "H.264/H.265"],
  ["MPEG", "MPEG-2"], ["FLV", "H.264"], ["TS", "MPEG-TS"], ["WEBM", "VP9"],
] as const;

export function SupportedFormats() {
  return (
    <div>
      <ul className="grid grid-cols-4 gap-2 xl:grid-cols-8">
        {FORMATS.map(([ext, codec]) => (
          <li key={ext} className="rounded-ctl border border-line/70 bg-raised/50 px-2 py-2">
            <span className="block text-sm font-normal">{ext}</span>
            <span className="block text-[11px] text-muted">{codec}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">Accepted containers. Every file is verified by its content (signature, probe and test decode), whatever its name; files up to 64 GB.</p>
    </div>
  );
}
