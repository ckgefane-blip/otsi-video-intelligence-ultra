import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportStage } from "@/components/playerreport/ReportStage";
import { parsePlayerRef } from "@/lib/identity";

export const metadata: Metadata = { title: "Player Report" };

/**
 * A player report is addressed by the permanent OTSI Player ID (or, for a provisional player that has none yet, the internal player id).
 * The identity hero reads GET /v1/players/by-otsi-id/:id (or /v1/players/:id); every measurement is not recorded yet and says so.
 */
export default async function Page({ params }: { params: Promise<{ playerRef: string }> }) {
  const { playerRef } = await params;
  if (!parsePlayerRef(playerRef)) notFound();
  return <ReportStage playerRef={playerRef} />;
}
