import type { Metadata } from "next";
import { ShortcutsPage } from "@/components/shell/ShortcutsPage";

export const metadata: Metadata = { title: "Keyboard shortcuts" };

/** The Keyboard shortcuts page (SOT, Shortcuts.dc.html): the table the "?" modal shows, as a page. */
export default function Page() {
  return <ShortcutsPage />;
}
