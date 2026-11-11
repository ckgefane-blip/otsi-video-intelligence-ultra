"use client";
/**
 * Page 02 Section 06 — URL input and external-source ingestion (approved reference 02_UPLOAD_INGEST, the link bar in the drop zone).
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
import { B, Ic, T, u } from "@/components/stage/DesignStage";
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
    <section aria-label={d.urlInputAria} data-section="p02-s06">
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="absolute" style={{ left: u(631), top: u(649 - 101), width: u(886), height: u(64), boxSizing: "border-box", borderRadius: u(8),
          background: "rgba(4,16,34,.85)", border: `${u(1.5)} solid #1e90ff` }}>
          <Ic o={[632.5, 650.5]} x={672} y={681} k="link" size={30} color="#cfe0f5" />
          <input ref={field} value={url} onChange={(e) => { setUrl(e.target.value); setMsg(null); }} type="url" placeholder={d.pasteYoutubeLink} aria-label={d.videoUrl}
            style={{ position: "absolute", left: u(716 - 632.5), top: 0, width: u(780), height: "100%", background: "transparent", border: 0, outline: "none", color: "#e3eefb",
              fontSize: u(22), fontFamily: "inherit" }} />
        </label>
        <button type="submit" aria-label={d.addUrl} aria-busy={busy} className="absolute"
          style={{ left: u(1534), top: u(649 - 101), width: u(170), height: u(64), padding: 0, borderRadius: u(8), background: "#041022", border: `${u(2)} solid #1e90ff`,
            color: "#fff", font: "inherit", cursor: "pointer", opacity: provider?.status === "unsupported" ? 0.6 : 1 }}>
          <T o={[1536, 651]} x={1559} y={681} size={23} weight={600} as="span">{busy ? d.adding : d.addUrl}</T>
          <Ic o={[1536, 651]} x={1668} y={681} k="arrow" size={24} />
        </button>
      </form>
      <button type="button" onClick={() => setList(true)} className="absolute"
        style={{ left: u(1704 - 160), top: u(853 - 101 - 12), width: u(160), height: u(24), zIndex: 5, padding: 0, border: 0, background: "transparent", color: "#33a8ff",
          fontSize: u(16), fontFamily: "inherit", cursor: "pointer", textAlign: "right" }}>{d.whichLinksWork}</button>

      {(showProvider || msg) && (
        <div className="absolute" style={{ left: u(631), top: u(725 - 101), width: u(1073), zIndex: 4, background: "#081a35", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(8),
          padding: `${u(10)} ${u(14)}`, fontSize: u(17), color: "#cfe0f5" }}>
          {showProvider && provider && (
            <div data-provider={provider.id} data-provider-status={provider.status}>
              <strong style={{ color: provider.status === "unsupported" ? "#ff8a8a" : provider.status === "supported" ? "#3ee6a8" : "#ffc66d" }}>
                {provider.name}: {provider.status === "supported" ? d.providerCanImport : provider.status === "needs_authorization" ? d.providerNeedsAuth : d.providerCannotImport}
              </strong>
              <span style={{ marginLeft: u(8), color: "#9fb3cc" }}>{provider.status === "unsupported" ? `${provider.reason} ${provider.alternative}` : provider.method}</span>
              {provider.status === "needs_authorization" && (
                <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" minLength={8} placeholder={d.yourAccessToken.replace("{name}", provider.name)}
                  aria-label={d.accessToken} style={{ display: "block", marginTop: u(8), width: "100%", background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(6),
                    color: "#e3eefb", padding: `${u(6)} ${u(10)}`, fontSize: u(17), fontFamily: "inherit" }} />
              )}
            </div>
          )}
          {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: showProvider ? `${u(6)} 0 0` : 0, color: msg.ok ? "#3ee6a8" : "#ff8a8a" }}>{msg.text}</p>}
        </div>
      )}

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
