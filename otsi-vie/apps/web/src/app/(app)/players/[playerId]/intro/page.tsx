import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlayerProfileIntroPanel } from "@/components/reels/PlayerProfileIntro";
import { isUuid } from "@/lib/identity";

export const metadata: Metadata = { title: "Player profile intro" };

/**
 * The Player Profile Intro on its own page (SOT, Players.dc.html "Open full 16:9 intro"): the 16:9 opening
 * segment for the player, by internal player id — the same panel the Reel Builder opens at the start of a
 * reel (GET /v1/players/:id/profile-intro).
 */
export default async function Page({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  if (!isUuid(playerId)) notFound();
  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 p-4">
      <PlayerProfileIntroPanel playerId={playerId} />
    </main>
  );
}
