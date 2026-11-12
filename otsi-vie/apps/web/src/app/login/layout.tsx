import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Sign in" };

/** Sign in (SOT Page 27) is a full two-column page, not a centred card: the layout only gives it the screen. */
export default function LoginLayout({ children }: { children: ReactNode }) {
  return <main id="main" className="min-h-screen">{children}</main>;
}
