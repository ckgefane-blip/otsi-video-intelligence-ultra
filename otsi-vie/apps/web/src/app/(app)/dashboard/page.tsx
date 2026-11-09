import type { Metadata } from "next";
import { FeaturedReel } from "@/components/home/FeaturedReel";
import { HeroSection } from "@/components/home/HeroSection";
import { HomeGuidance, HomeInboxProvider, NextActionBar } from "@/components/home/HomeInbox";
import { KpiCards } from "@/components/home/KpiCards";
import { RecentMatches } from "@/components/home/RecentMatches";
import { SampleReels } from "@/components/home/SampleReels";
import { TrustStrip } from "@/components/home/TrustStrip";
import { DesignStage } from "@/components/stage/DesignStage";

export const metadata: Metadata = { title: "Home" };

/**
 * Page 01 Home / Overview on the approved composition (corrected reference 01_HOME_OVERVIEW), section by section: 01 header (shared
 * layout), 02 hero and upload controls, 03 featured reel, 04 KPI cards, 05 trust strip, 06 recent matches, 07 sample reels,
 * 08 platform capabilities, 09 how it works. v3 Phase A.13 (ADR-062): a state-aware next action under the upload controls; once the
 * organization has a finished analysis, 08 and 09 become the Review inbox and Active jobs (first-run guidance until then).
 */
export default function Page() {
  return (
    <HomeInboxProvider>
      <DesignStage page="home">
        <HeroSection />
        <NextActionBar />
        <FeaturedReel />
        <KpiCards />
        <TrustStrip />
        <RecentMatches />
        <SampleReels />
        <HomeGuidance />
      </DesignStage>
    </HomeInboxProvider>
  );
}
