/**
 * The page container inside the Desktop UI shell: it scrolls on its own so the rail, top bar and status bar stay put. A page still
 * built on its full-screen DesignStage composition ([data-stage]) gets the full width with no padding (Drop 2 re-lays those out);
 * every other page gets the 24 px desktop gutter.
 */
import type { ReactNode } from "react";

export function AppMain({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="min-h-0 flex-1 overflow-auto px-6 pb-8 pt-5 has-[[data-stage]]:p-0">
      {children}
    </main>
  );
}
