import type { Metadata } from "next";
import { ReelStage } from "@/components/reelstage/ReelStage";

export const metadata: Metadata = { title: "Reel Builder" };

/** Page 06 without a reel: the reference's empty state, with the organization's reels to open; a reel is created from a confirmed player in the Analysis Workspace. */
export default function Page() {
  return <ReelStage />;
}
