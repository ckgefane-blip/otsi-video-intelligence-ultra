import type { Metadata } from "next";
import { FeaturedReel } from "@/components/home/FeaturedReel";
import { HeroSection } from "@/components/home/HeroSection";
import { HomeGuidance, HomeInboxProvider } from "@/components/home/HomeInbox";
import { KpiCards } from "@/components/home/KpiCards";
import { RecentMatches } from "@/components/home/RecentMatches";
import { SampleReels } from "@/components/home/SampleReels";
import { TrustStrip } from "@/components/home/TrustStrip";

export const metadata: Metadata = { title: "Home" };

/**
 * Page 01 Home / Overview — Desktop UI (owner 2026-11-11, Drop 1), on the same components and the same real API as before, laid out in
 * the page's flow instead of the 2560-px DesignStage composition:
 *   row 1  the header, upload controls and next action, over the live hero picture  |  Featured Reel (real player)
 *   row 2  the four KPI cards
 *   row 3  Recent Matches (real thumbnails)  |  Sample Reels (slot 1 plays; empty slots say so)  |  Capabilities or the Review inbox
 *   row 4  How It Works or Active jobs, then the trust strip.
 */
export default function Page() {
  return (
    <HomeInboxProvider>
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4" data-page="home">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <HeroSection />
          <FeaturedReel />
        </div>
        <KpiCards />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.9fr)]">
          <RecentMatches />
          <SampleReels />
          <div className="lg:col-span-2 2xl:col-span-1"><HomeGuidance place="side" /></div>
        </div>
        <HomeGuidance place="bottom" />
        <TrustStrip />
      </div>
    </HomeInboxProvider>
  );
}
