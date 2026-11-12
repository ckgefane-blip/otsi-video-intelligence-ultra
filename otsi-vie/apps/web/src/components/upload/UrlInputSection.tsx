"use client";
/**
 * Page 02 Section 06 — URL input and external-source ingestion, on the Desktop UI flow layout.
 *
 * Paste a link and Add URL: the server imports it into the chosen project (POST /v1/imports), downloading from public addresses only and
 * verifying the file like an upload. While typing, the link's provider is explained from the server's own list (works / needs the
 * person's own access token / not possible, with the lawful alternative). Add URL on a link that cannot work says why instead of
 * sending it. "Which links work?" lists every provider. This section is the surface of the YouTube / URL tab only (it focuses the field);
 * the other two tabs show the file picker instead (owner direction 2026-10-29).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { IMPORT_PROVIDERS, importProviderFor, type ImportProvider } from "@otsi-vie/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useSourceMode } from "./UploadHeaderSection";
import { usePage02 } from "./page02";
import { useUpload } from "./UploadWorkspace";

function providerOf(url: string): ImportProvider | null {
  try { const x = new URL(url.trim()); return importProviderFor(x.hostname, x.pathname); } catch { return null; }
}

export function UrlInputSection() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { importLink, canWrite, projectId } = useUpload();
  const { setProjectDialog, say } = usePage02();
  const [mode] = useSourceMode();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (mode === "url") field.current?.focus(); }, [mode]);
  const provider = providerOf(url);
  const showProvider = !!provider && url.length > 10;

  // the project dialog is a step on the way to importing, not a dead end: once a project exists, finish the import that was asked for
  const [pendingSubmit, setPendingSubmit] = useState(false);
  useEffect(() => {
    if (projectId && pendingSubmit) { setPendingSubmit(false); submit(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const submit = () => {
    setMsg(null);
    if (!canWrite) return say(d.viewUploadsNoImport);
    if (!url.trim()) { field.current?.focus(); return say(d.pasteLinkFirst); }
    if (!projectId) { setPendingSubmit(true); setProjectDialog(true); return say(d.chooseProjectFirstImport); }
    if (provider?.status === "unsupported") return setMsg({ ok: false, text: d.providerCannotImportMsg.replace("{name}", provider.name).replace("{reason}", provider.reason ?? "").replace("{alternative}", provider.alternative ?? "") });
    if (provider?.status === "needs_authorization" && token.length < 8) return setMsg({ ok: false, text: d.providerNeedsTokenBelow.replace("{name}", provider.name) });
    setBusy(true);
    void importLink(url, provider?.status === "needs_authorization" ? token : undefined).then(
      () => { setUrl(""); setToken(""); setMsg({ ok: true, text: d.importStarted }); },
      (x) => setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : d.couldNotStartImport }),
    ).finally(() => setBusy(false));
  };

  if (mode !== "url") return <section aria-label={d.urlInputAria} data-section="p02-s06" data-hidden="true" />;
  return (
    <section aria-label={d.urlInputAria} data-section="p02-s06" className="vie-panel">
      <div className="vie-ph"><h2 className="t-panel">{d.pasteLinkHere}</h2>
        <button type="button" onClick={() => setList(true)} className="text-sm text-primary">{d.whichLinksWork}</button>
      </div>
      <div className="space-y-2 p-3">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex gap-2">
          <input ref={field} value={url} onChange={(e) => { setUrl(e.target.value); setMsg(null); }} type="url" placeholder={d.pasteYoutubeLink} aria-label={d.videoUrl}
            className="min-w-0 flex-1 rounded-ctl border border-line bg-canvas px-3 py-2 text-sm" />
          <button type="submit" aria-label={d.addUrl} aria-busy={busy} disabled={provider?.status === "unsupported"}
            className="vie-btn vie-btn-pri disabled:opacity-50">{busy ? d.adding : d.addUrl}</button>
        </form>
        {showProvider && provider && (
          <div data-provider={provider.id} data-provider-status={provider.status}
            className={`rounded-ctl border p-2 text-xs ${provider.status === "unsupported" ? "border-danger/40 bg-danger/10" : "border-line bg-raised/40"}`}>
            <p className="font-semibold">{provider.name}: {provider.status === "supported" ? d.providerCanImport : provider.status === "needs_authorization" ? d.providerNeedsAuth : d.providerCannotImport}</p>
            <p className="mt-0.5 text-muted">{provider.status === "unsupported" ? `${provider.reason} ${provider.alternative}` : provider.method}</p>
            {provider.status === "needs_authorization" && (
              <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" minLength={8} placeholder={d.yourAccessToken.replace("{name}", provider.name)}
                aria-label={d.accessToken} className="mt-2 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-sm" />
            )}
          </div>
        )}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
        <p className="text-xs text-muted">{d.onlyVideoRights}</p>
      </div>

      <Dialog.Root open={list} onOpenChange={setList}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-semibold">{d.whichLinksWork}</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">{d.onlyVideoRights}</Dialog.Description>
            <ul aria-label={d.linkSupport} className="grid gap-1 text-xs">
              {IMPORT_PROVIDERS.map((p) => (
                <li key={p.id} className="flex gap-2">
                  <span className={`shrink-0 rounded px-1.5 ${p.status === "supported" ? "bg-ok/15 text-ok" : p.status === "needs_authorization" ? "bg-amber/15 text-amber" : "bg-danger/15 text-danger"}`}>
                    {p.status === "supported" ? d.providerWorks : p.status === "needs_authorization" ? d.providerWithToken : d.providerNotPossibleShort}
                  </span>
                  <span><span className="font-medium">{p.name}</span> <span className="text-muted">{p.status === "unsupported" ? p.alternative : p.method}</span></span>
                </li>
              ))}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
