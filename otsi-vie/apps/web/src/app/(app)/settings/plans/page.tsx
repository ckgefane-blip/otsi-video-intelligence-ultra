import { redirect } from "next/navigation";

/** Settings > Plans and pricing now lives on Settings > Plans & billing (/settings/billing): one pricing and ordering page (merge 2026-11-13). */
export default function PlansPage() {
  redirect("/settings/billing");
}
