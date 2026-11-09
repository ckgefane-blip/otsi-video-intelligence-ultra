import type { Metadata } from "next";
import { ReportStage } from "@/components/playerreport/ReportStage";

export const metadata: Metadata = { title: "Player Report" };

/** Page 08 without a player: the reference's empty state with a player picker; a report is addressed by the OTSI Player ID. */
export default function Page() {
  return <ReportStage />;
}
