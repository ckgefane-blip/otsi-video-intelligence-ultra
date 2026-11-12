/**
 * The frame of the pages a person sees before the app (Sign-in, the 2-step code, Invite): the OTSI brand logo — the owner's own mark,
 * never a typed stand-in — and one panel, on the Desktop UI tokens. Shared input and button classes keep the three pages identical.
 */
import type { ReactNode } from "react";

export const authField = "mt-1 h-9 w-full rounded-md border border-line2 bg-p0 px-3 t-body text-ink outline-none focus:border-primary";
export const authPrimary = "vie-btn vie-btn-pri mt-4 w-full";
export const authSecondary = "vie-btn mt-3 w-full";
export const authError = "mt-3 rounded-md border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger";

export function AuthLogo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/otsi-logo.png" alt="OTSI" className="h-7 w-auto" draggable={false} />;
}

export function AuthCard({ children, as = "div", ...rest }: { children: ReactNode; as?: "div" | "form" } & Record<string, unknown>) {
  const Tag = as as "div";
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-10">
      <Tag className="vie-panel w-full max-w-[380px] p-6" {...rest}>
        <AuthLogo />
        {children}
      </Tag>
    </div>
  );
}
