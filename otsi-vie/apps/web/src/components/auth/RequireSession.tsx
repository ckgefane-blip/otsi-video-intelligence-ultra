"use client";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "./AuthProvider";

/** App pages need a signed-in user who belongs to an organization; otherwise they say so or send the visitor to sign in. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { status, me, organization } = useAuth();
  const router = useRouter();

  // the current address is read in the effect (not with useSearchParams), so the layout needs no Suspense boundary and a page can still
  // answer 404 before anything streams
  useEffect(() => {
    if (status === "signed-out") {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }, [status, router]);
  // a person who has not finished the first-run welcome (their name and the tour) goes there once
  const firstRun = status === "signed-in" && !!me && !me.user.onboarded_at;
  useEffect(() => { if (firstRun) router.replace("/welcome"); }, [firstRun, router]);

  if (firstRun) return <p className="mt-16 text-center text-sm text-muted" role="status" aria-live="polite">Opening your welcome...</p>;
  if (status !== "signed-in") {
    return <p className="mt-16 text-center text-sm text-muted" role="status" aria-live="polite">{status === "loading" ? "Loading your workspace..." : "Redirecting to sign in..."}</p>;
  }
  if (!organization) {
    return (
      <div className="mx-auto mt-16 max-w-lg rounded-card border border-line bg-panel p-6" role="alert">
        <h1 className="text-xl font-normal">No organization</h1>
        <p className="mt-2 text-sm text-muted">Your account is not an active member of any organization. Ask an owner of your organization to invite you.</p>
      </div>
    );
  }
  return <>{children}</>;
}
