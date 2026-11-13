import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Invitation" };

/** SOT: the invite is edge-to-edge — the brand panel touches the viewport edges, so the layout adds no padding or centring. */
export default function InviteLayout({ children }: { children: ReactNode }) {
  return <main id="main" className="min-h-screen">{children}</main>;
}
