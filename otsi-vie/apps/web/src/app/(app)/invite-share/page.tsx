import type { Metadata } from "next";
import { InviteSharePage } from "@/components/shell/InviteSharePage";

export const metadata: Metadata = { title: "Invite friends" };

/** Invite friends (user-to-user Invite): the gift button in the top bar links here. */
export default function Page() {
  return <InviteSharePage />;
}
