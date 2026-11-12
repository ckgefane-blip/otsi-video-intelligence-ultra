import type { Metadata } from "next";
import { ReelStage } from "@/components/reelstage/ReelStage";

export const metadata: Metadata = { title: "Reel Builder" };

/** Page 06 — the Reel Builder (SOT, Reels.dc.html). One page, like Filmora and DaVinci: the full builder is there even with nothing
 *  loaded. Without a reel it shows the builder's empty state and the organization's reels to open (and opens the first reel on its
 *  own); with a reel id it is that reel's builder. A reel is created from a confirmed player in the Analysis Workspace. */
export default function Page() {
  return <ReelStage />;
}
