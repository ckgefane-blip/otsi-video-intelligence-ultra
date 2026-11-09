import type { Metadata } from "next";
import { TeamSettings } from "@/components/account/TeamSettings";

export const metadata: Metadata = { title: "Team and roles" };

/** Account menu > Team and roles: invitations, roles and removal (owners and admins). Not one of the ten numbered pages. */
export default function Page() {
  return <TeamSettings />;
}
