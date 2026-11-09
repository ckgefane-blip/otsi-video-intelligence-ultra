import type { Metadata } from "next";
import { Suspense } from "react";
import { LibraryStage } from "@/components/library/LibraryStage";

export const metadata: Metadata = { title: "Library" };

/**
 * Page 09 Library / Project Center on the approved composition (corrected reference 09_LIBRARY_PROJECT_CENTER): 01 header and New Project,
 * 02 asset tabs, 03 search and filters, 04 saved searches, 05 asset table, 06 status and collaboration, 07 preview, 08 metadata,
 * 09 quick actions, 10 collaborators. ?tab= opens a tab (e.g. matches).
 */
export default function Page() {
  return <Suspense><LibraryStage /></Suspense>;
}
