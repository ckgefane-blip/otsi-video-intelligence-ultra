import type { Metadata } from "next";
import { Suspense } from "react";
import { ExportStage } from "@/components/exportstage/ExportStage";

export const metadata: Metadata = { title: "Export & delivery" };

/** Page 10 Export & Delivery on the approved composition: render settings and progress, download; the reel comes from ?reel=. */
export default function Page() {
  return <Suspense><ExportStage /></Suspense>;
}
