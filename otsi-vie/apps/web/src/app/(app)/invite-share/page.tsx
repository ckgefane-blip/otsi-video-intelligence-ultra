import type { Metadata } from "next";
import { InviteSharePage } from "@/components/shell/InviteSharePage";

export const metadata: Metadata = { title: "Invite friends" };

/** Invite friends (user-to-user Invite): the full page, kept as the address for direct links. The gift button opens the InviteCard instead. */
export default function Page() {
  return <InviteSharePage />;
}
