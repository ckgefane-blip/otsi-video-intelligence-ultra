"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { LogOut, ShieldCheck, Sliders, Users } from "lucide-react";
import type { Me } from "@otsi-vie/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { PAGE_NAME, useUiMode } from "@/lib/uiMode";
import { LanguageSwitcher } from "./LanguageSwitcher";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const roleLabel = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();

/** shrink a chosen picture to a centred 256 x 256 JPEG (well under the 400 KB limit) before it is sent */
async function squarePhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height), size = 256;
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  if (!g) throw new Error("no canvas");
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("encode"))), "image/jpeg", 0.88));
}

/** the signed-in person's own photo (GET /v1/me/avatar, authenticated), as a local picture address; null while none is set */
function usePhoto(version: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!version) { setSrc(null); return; }
    let live = true, url: string | null = null;
    void apiBlob("/v1/me/avatar", { organization: false }).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => { if (live) setSrc(null); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [version]);
  return src;
}

/**
 * Page 01 section 1, account: the signed-in user (avatar initials, name) and the current organization, from the real session
 * (GET /v1/me). Opens the account menu: email, organizations with the role in each (switch), sign out. Nothing is shown before the
 * session is known — never a placeholder person.
 */
export function ProfileChip({ styles }: { styles: Record<string, string> }) {
  const { status, me, organization, chooseOrganization, signOut, updateMe } = useAuth();
  const ui = useUiMode();
  const router = useRouter();
  const photo = usePhoto(me?.user.avatar_updated_at ?? null);
  const pick = useRef<HTMLInputElement | null>(null);
  const [photoMsg, setPhotoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const cls = (...k: string[]) => k.map((x) => styles[x]).join(" ");
  if (status !== "signed-in" || !me) {
    return (
      <span className={cls("abs", "account", "placeholder")} aria-hidden>
        <span className={styles.avatar} />
      </span>
    );
  }
  return (
    <Dialog.Root>
      <span className={cls("abs", "account")} data-account-wrap>
        <button type="button" className={styles.avatar} data-has-photo={photo ? "1" : "0"} disabled={photoBusy} data-account-photo
          aria-label={photo ? "Change your profile photo" : "Add your profile photo"} title={photo ? "Change your photo" : "Add your photo"} onClick={() => pick.current?.click()}>
          {photo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={photo} alt="" className={styles.photo} draggable={false} /> : initials(me.user.display_name)}
        </button>
        <span className={styles.camera} aria-hidden>{photoBusy ? "…" : "+"}</span>
        <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Choose a profile photo" hidden
          onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            setPhotoBusy(true); setPhotoMsg(null);
            void squarePhoto(f).then((b) => api<Me>("/v1/me/avatar", { method: "PUT", body: b, headers: { "content-type": "image/jpeg" }, organization: false }))
              .then((m) => { updateMe(m); setPhotoMsg({ ok: true, text: "Photo saved." }); },
                (x) => setPhotoMsg({ ok: false, text: x instanceof ApiProblem ? x.message : "That picture could not be used." }))
              .finally(() => setPhotoBusy(false));
          }} />
        <Dialog.Trigger asChild>
          <button type="button" className={styles.nameBtn} aria-label={`Account: ${me.user.display_name}`} data-account>
            <span className={styles.name}>{me.user.display_name}</span>
            <span className={styles.sub}>{organization ? roleLabel(organization.role) : "No organization"}</span>
          </button>
        </Dialog.Trigger>
      </span>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50" />
        <Dialog.Content className="fixed right-4 z-50 w-72 rounded-card border border-line bg-panel p-3 shadow-2xl"
          style={{ top: "calc(max(0.5px, 100vw / 2560) * 104)" }}>
          <Dialog.Title className="text-sm font-semibold">{me.user.display_name}</Dialog.Title>
          <Dialog.Description className="text-xs text-muted">{me.user.email}</Dialog.Description>
          {photo && (
            <button type="button" disabled={photoBusy} data-photo-remove onClick={() => {
              setPhotoBusy(true); setPhotoMsg(null);
              void api<Me>("/v1/me/avatar", { method: "DELETE", organization: false }).then((m) => { updateMe(m); setPhotoMsg({ ok: true, text: "Photo removed." }); },
                (x) => setPhotoMsg({ ok: false, text: x instanceof ApiProblem ? x.message : "The photo was not removed." })).finally(() => setPhotoBusy(false));
            }} className="mt-2 text-xs text-muted underline hover:text-danger">Remove my photo</button>
          )}
          {photoMsg && <p role={photoMsg.ok ? "status" : "alert"} className={`mt-1 text-xs ${photoMsg.ok ? "text-ok" : "text-danger"}`}>{photoMsg.text}</p>}
          {ui.page && (
            <fieldset className="mt-3" data-ui-mode-switch={ui.mode}>
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted">{PAGE_NAME[ui.page]}: how much to show</legend>
              <div role="radiogroup" aria-label={`${PAGE_NAME[ui.page]}: Guided or Pro`} className="mt-1 grid grid-cols-2 gap-1">
                {([["GUIDED", "Guided", "The main actions"], ["PRO", "Pro", "Every control"]] as const).map(([m, l, d]) => (
                  <button key={m} type="button" role="radio" aria-checked={ui.mode === m} disabled={ui.saving} data-ui-mode-option={m} onClick={() => void ui.setMode(m)}
                    className={`rounded-ctl border px-2 py-1.5 text-left text-sm ${ui.mode === m ? "border-primary bg-primary/15" : "border-line hover:border-primary/60"}`}>
                    <span className="block font-medium">{l}</span><span className="block text-[11px] text-muted">{d}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {ui.hides ? `Guided hides ${ui.hides}. Nothing is lost: results and data are the same.` : "This page looks the same in both modes for now."} Remembered for you, per page.
              </p>
              {ui.error && <p role="alert" className="mt-1 text-xs text-danger">{ui.error}</p>}
            </fieldset>
          )}
          <LanguageSwitcher />
          {me.memberships.length > 0 && (
            <fieldset className="mt-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted">Organization</legend>
              {me.memberships.map((m) => (
                <label key={m.organization_id} className="mt-1 flex cursor-pointer items-center gap-2 rounded-ctl px-2 py-1.5 text-sm hover:bg-raised/60">
                  <input type="radio" name="organization" checked={m.organization_id === organization?.organization_id}
                    onChange={() => { chooseOrganization(m.organization_id); router.refresh(); }} />
                  <span className="flex-1">{m.organization_name}</span>
                  <span className="text-xs text-muted">{roleLabel(m.role)}</span>
                </label>
              ))}
            </fieldset>
          )}
          {organization && (organization.role === "OWNER" || organization.role === "ADMIN") && (
            <>
              <Dialog.Close asChild>
                <button type="button" data-admin-open onClick={() => router.push("/settings/admin")}
                  className="mt-3 flex w-full items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60">
                  <Sliders className="h-4 w-4" /> Admin console
                </button>
              </Dialog.Close>
              <Dialog.Close asChild>
                <button type="button" data-team-open onClick={() => router.push("/settings/team")}
                  className="mt-2 flex w-full items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60">
                  <Users className="h-4 w-4" /> Team and roles
                </button>
              </Dialog.Close>
            </>
          )}
          <Dialog.Close asChild>
            <button type="button" data-two-step-open onClick={() => router.push("/settings/security")}
              className="mt-3 flex w-full items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60">
              <ShieldCheck className="h-4 w-4" /> 2-step sign-in
            </button>
          </Dialog.Close>
          <button type="button" data-welcome-replay onClick={() => router.push("/welcome")}
            className="mt-3 flex w-full items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60">
            Welcome tour
          </button>
          <button type="button" onClick={() => void signOut().then(() => router.replace("/login"))}
            className="mt-3 flex w-full items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
