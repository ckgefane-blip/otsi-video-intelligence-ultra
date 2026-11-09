import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReelStage } from "@/components/reelstage/ReelStage";
import { isUuid } from "@/lib/identity";

export const metadata: Metadata = { title: "Reel Builder" };

/** Page 06 for one reel on the approved composition: the user builds the reel by clicking; the engine suggests moments and renders the spotlight MP4. */
export default async function Page({ params }: { params: Promise<{ reelId: string }> }) {
  const { reelId } = await params;
  if (!isUuid(reelId)) notFound();
  return <ReelStage reelId={reelId} />;
}
