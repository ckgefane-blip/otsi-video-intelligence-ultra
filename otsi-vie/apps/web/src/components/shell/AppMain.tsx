/**
 * The page container. A page rebuilt on its approved full-screen composition renders a DesignStage ([data-stage]) and gets the full
 * window width with no padding; every other page keeps the padded container. Detected from the page itself (CSS :has), so no shared
 * list of routes has to be edited when a page is rebuilt.
 */
import type { ReactNode } from "react";

export function AppMain({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto w-full max-w-[1920px] px-4 pb-8 pt-4 lg:px-5 has-[[data-stage]]:max-w-none has-[[data-stage]]:p-0">
      {children}
    </main>
  );
}
