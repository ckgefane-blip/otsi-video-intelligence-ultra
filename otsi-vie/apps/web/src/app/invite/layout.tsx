import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Invitation" };

export default function InviteLayout({ children }: { children: ReactNode }) {
  return <main id="main" className="grid min-h-screen place-items-center px-4 py-10">{children}</main>;
}
