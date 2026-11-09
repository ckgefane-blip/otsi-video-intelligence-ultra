"use client";
/**
 * v3 Phase C.4 (ADR-104): Archive bundle with manifest (`otsi-archive/v1`) and audit extract (`audit-extract.json`);
 * rights are re-checked at pack time (`POST /v1/archives`) and at every open (`GET /v1/archives/:id`) or download (`GET /v1/archives/:id/download`).
 *
 * Used both as a panel inside Export & Delivery (`InterchangeDialog` Archive bundle tab) and as a standalone dialog from Library (`ArchiveDialog`)
 * for a Reel, Video, or Match.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { ArchiveBundleSummary, ArchiveBundleView, ArchiveRightsCheck, ArchiveStatusView, ArchiveSubjectKind } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";

export interface ArchiveRightsLine {
  video_id: string;
  title: string;
  label: string;
  tone: "ok" | "warn";
}

export function describeArchiveRights(check: ArchiveRightsCheck): {
  headline: string;
  tone: "ok" | "warn";
  videos: ArchiveRightsLine[];
} {
  const headline = check.allowed
    ? `Rights verified at ${check.checked_at.slice(0, 19).replace("T", " ")} UTC (${check.rule_version}) — packing and opening allowed`
    : check.reason_text ?? "Rights check blocked this archive bundle.";
  return {
    headline,
    tone: check.allowed ? "ok" : "warn",
    videos: check.videos.map((v) => ({
      video_id: v.video_id,
      title: v.title,
      label: v.allowed
        ? `${v.rights_state} · ${v.allowed_uses.join(", ")} · consent ${v.guardian_consent_state ?? "N/A"}`
        : `${v.rights_state} · ${v.reason_text ?? v.reason_code ?? "blocked"}`,
      tone: v.allowed ? "ok" : "warn",
    })),
  };
}

export function formatArchiveBytes(b: number): string {
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)} MB`;
  if (b >= 1_000) return `${(b / 1_000).toFixed(1)} KB`;
  return `${b} B`;
}

export function ArchivePanel({ subjectKind, subjectId, canWrite = true }: {
  subjectKind: ArchiveSubjectKind;
  subjectId: string;
  canWrite?: boolean;
}) {
  const [status, setStatus] = useState<ArchiveStatusView | null>(null);
  const [opened, setOpened] = useState<ArchiveBundleView | null>(null);
  const [subView, setSubView] = useState<"manifest" | "audit">("manifest");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadStatus = () => {
    setErr(null);
    api<ArchiveStatusView>(`/v1/archives/status?subject_kind=${encodeURIComponent(subjectKind)}&subject_id=${encodeURIComponent(subjectId)}`)
      .then((s) => setStatus(s), (e) => setErr(e instanceof ApiProblem ? e.message : "Could not check archive rights."));
  };

  useEffect(() => {
    setStatus(null);
    setOpened(null);
    setErr(null);
    loadStatus();
  }, [subjectKind, subjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pack = async () => {
    setBusy(true);
    setErr(null);
    try {
      const packed = await api<ArchiveBundleView>("/v1/archives", {
        method: "POST",
        json: { subject_kind: subjectKind, subject_id: subjectId },
      });
      setOpened(packed);
      loadStatus();
    } catch (e) {
      setErr(e instanceof ApiProblem ? e.message : "The archive bundle could not be packed.");
      loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const openArchive = async (a: ArchiveBundleSummary) => {
    setBusy(true);
    setErr(null);
    try {
      const full = await api<ArchiveBundleView>(`/v1/archives/${a.id}`);
      setOpened(full);
      loadStatus();
    } catch (e) {
      setOpened(null);
      setErr(e instanceof ApiProblem ? e.message : "The archive bundle could not be opened.");
      loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const rightsSummary = status ? describeArchiveRights(status.rights_now) : null;

  return (
    <div data-archive-panel data-subject-kind={subjectKind} className="space-y-3 text-xs">
      {err && (
        <p role="alert" data-archive-error className="rounded border border-[#a83a4a] bg-[#2a0c14] px-2.5 py-1.5 text-[#ff9aa8]">
          {err}
        </p>
      )}
      {!status ? (
        <p className="text-muted">Checking live video rights and existing archive bundles…</p>
      ) : (
        <>
          <div data-archive-rights data-allowed={String(status.rights_now.allowed)} className="rounded border border-line bg-raised p-2.5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold">Live rights check ({status.rights_now.rule_version})</span>
              <span style={{ color: rightsSummary?.tone === "ok" ? "#3ee6a8" : "#f5b82e" }} className="font-semibold">
                {status.rights_now.allowed ? "Allowed" : "Blocked"}
              </span>
            </div>
            <p className="mb-2 text-muted">{rightsSummary?.headline}</p>
            {rightsSummary && rightsSummary.videos.length > 0 && (
              <ul className="space-y-1">
                {rightsSummary.videos.map((v) => (
                  <li key={v.video_id} data-archive-video={v.video_id} className="flex justify-between gap-2 rounded border border-line/60 px-2 py-1">
                    <span className="truncate font-medium">{v.title}</span>
                    <span style={{ color: v.tone === "ok" ? "#3ee6a8" : "#f5b82e" }}>{v.label}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <span className="text-muted">Rights are re-checked at pack time and every time an archive is opened or downloaded.</span>
              <button
                type="button"
                data-pack-archive
                disabled={!canWrite || busy || !status.rights_now.allowed}
                title={!canWrite ? "Your role can view archives but not pack new ones" : status.rights_now.reason_text ?? "Pack a portable archive bundle (.zip)"}
                onClick={() => void pack()}
                className="shrink-0 rounded bg-primary px-3 py-1.5 font-semibold text-white disabled:opacity-40"
              >
                {busy ? "Packing…" : `Pack ${subjectKind.toLowerCase()} archive`}
              </button>
            </div>
          </div>

          <div>
            <h4 className="mb-1.5 font-semibold uppercase tracking-wide text-muted">
              Packed archive bundles ({status.archives.length})
            </h4>
            {status.archives.length === 0 ? (
              <p data-archive-empty className="text-muted">
                No archive bundle has been packed for this {subjectKind.toLowerCase()} yet.
              </p>
            ) : (
              <ul data-archive-list className="space-y-1.5">
                {status.archives.map((a) => (
                  <li key={a.id} data-archive-row={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">
                        {a.title} · {formatArchiveBytes(a.bytes)} · {a.file_count} files · {a.audit_count} audit events
                      </div>
                      <div className="truncate text-muted">
                        Packed {a.created_at.slice(0, 16).replace("T", " ")} UTC by {a.created_by_name} · SHA-256 {a.sha256.slice(0, 12)}… ·{" "}
                        <span style={{ color: a.rights_now.allowed ? "#3ee6a8" : "#f5b82e" }}>
                          {a.rights_now.allowed ? "Rights valid now" : `Blocked now: ${a.rights_now.reason_codes.join(", ")}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-open-archive={a.id}
                        disabled={busy}
                        onClick={() => void openArchive(a)}
                        className="rounded border border-line bg-[#08213f] px-2.5 py-1 font-semibold text-[#33a8ff]"
                      >
                        Open &amp; verify
                      </button>
                      {a.download_url ? (
                        <a
                          href={a.download_url}
                          data-download-archive={a.id}
                          className="rounded bg-primary px-2.5 py-1 font-semibold text-white no-underline"
                        >
                          Download .zip
                        </a>
                      ) : (
                        <span className="rounded border border-line/50 px-2 py-1 text-muted" title={a.rights_now.reason_text ?? "Rights blocked"}>
                          Download blocked
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {opened && (
            <div data-archive-opened={opened.id} className="rounded border border-[#1e90ff] bg-[#041022] p-2.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-semibold">Opened archive · {opened.manifest.schema}</span>{" "}
                  <span className="text-muted">({opened.manifest.files.map((f) => f.name).join(", ")})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-archive-view="manifest"
                    onClick={() => setSubView("manifest")}
                    className={`rounded border px-2 py-0.5 ${subView === "manifest" ? "border-[#1e90ff] bg-[#08213f] font-semibold text-white" : "border-line text-muted"}`}
                  >
                    manifest.json
                  </button>
                  <button
                    type="button"
                    data-archive-view="audit"
                    onClick={() => setSubView("audit")}
                    className={`rounded border px-2 py-0.5 ${subView === "audit" ? "border-[#1e90ff] bg-[#08213f] font-semibold text-white" : "border-line text-muted"}`}
                  >
                    audit-extract.json ({opened.audit_extract.length})
                  </button>
                </div>
              </div>
              <pre data-archive-json className="max-h-48 overflow-auto rounded border border-line bg-[#020813] p-2 text-xs text-[#cfe0f5]">
                {JSON.stringify(subView === "manifest" ? opened.manifest : opened.audit_extract, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ArchiveDialog({ target, canWrite = true, onClose }: {
  target: { kind: ArchiveSubjectKind; id: string; title: string } | null;
  canWrite?: boolean;
  onClose(): void;
}) {
  return (
    <Dialog.Root open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="archive" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(680px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-semibold">
            Archive {target?.kind.toLowerCase()} &ldquo;{target?.title}&rdquo;
          </Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            Portable archive bundle (<code>otsi-archive/v1</code>) with <code>manifest.json</code> and chronological <code>audit-extract.json</code>. Video rights are checked at pack time and re-checked every time the archive is opened or downloaded.
          </Dialog.Description>
          {target && (
            <ArchivePanel subjectKind={target.kind} subjectId={target.id} canWrite={canWrite} />
          )}
          <div className="mt-3 flex justify-end">
            <Dialog.Close className="rounded border border-line px-3 py-1.5 text-xs">Close</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
