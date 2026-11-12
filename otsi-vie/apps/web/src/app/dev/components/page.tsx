import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Gallery } from "./Gallery";

export const metadata: Metadata = { title: "Component gallery (dev only)" };

/**
 * Dev-only component gallery (UI/UX spec §12 step 1). Shows every kit
 * component using Appendix A real data only, or clearly-labelled sample
 * states. Not linked from any production navigation. Returns 404 in
 * production builds so it can never ship.
 */
export default function DevComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
