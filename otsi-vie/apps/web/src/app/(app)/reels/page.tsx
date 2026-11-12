import type { Metadata } from "next";
import { ReelList } from "@/components/reels/ReelBuilder";

export const metadata: Metadata = { title: "Reel Builder" };

/** Page 06 — the organization's reels; opening one goes to its Reel Builder. A reel is created from a confirmed player in the Analysis Workspace. */
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-3xl p-4">
      <ReelList />
    </main>
  );
}
