import type { Metadata } from "next";
import { Suspense } from "react";
import { PlayersList } from "@/components/players/PlayersList";

export const metadata: Metadata = { title: "Players" };

/** The Players list: each player's profile (nationality, foot, birth date), recorded by a person before reels and reports use it. */
export default function Page() {
  return <Suspense><PlayersList /></Suspense>;
}
