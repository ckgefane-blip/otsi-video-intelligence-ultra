import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Shared video", robots: { index: false, follow: false } };

export default function SharedLayout({ children }: { children: ReactNode }) {
  return <main id="main" className="px-4">{children}</main>;
}
