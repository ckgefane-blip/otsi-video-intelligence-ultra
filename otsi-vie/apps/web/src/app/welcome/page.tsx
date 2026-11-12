import { redirect } from "next/navigation";

/**
 * The welcome tour is a modal over Home now (SOT, page 31), not a separate page — the (app) layout mounts it and it
 * opens for anyone who has not finished it, and the profile menu replays it. This address only exists for old links.
 */
export default function Page() {
  redirect("/dashboard");
}
