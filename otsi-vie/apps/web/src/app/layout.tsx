import "@fontsource/open-sans/400.css";   // DaVinci Resolve's UI font (SIL OFL), regular only: no bold anywhere
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { DesktopTitleBar } from "@/components/shell/DesktopTitleBar";
import { LocaleProvider } from "@/lib/i18n";
import { THEME_STORAGE_KEY } from "@/lib/theme";

export const metadata: Metadata = {
  title: { default: "OTSI VIE", template: "%s · OTSI VIE" },
  description: "OTSI Video Intelligence Engine — football video intelligence for analysts, scouts and agencies.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#06111F", colorScheme: "dark light" };

// Applies the saved theme before first paint (no flash). Dark is the approved default.
const themeScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:rounded-ctl focus:bg-primary focus:px-3 focus:py-2 focus:text-white">
          Skip to content
        </a>
        <DesktopTitleBar />
        <AuthProvider><LocaleProvider>{children}</LocaleProvider></AuthProvider>
      </body>
    </html>
  );
}
