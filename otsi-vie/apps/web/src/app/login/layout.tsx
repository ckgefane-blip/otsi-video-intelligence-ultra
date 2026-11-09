import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <main id="main" className="px-4">{children}</main>;
}
