"use client";
/**
 * v3 Phase C.3 (ADR-103) & C.4 (ADR-104):
 * - C.3: OpenTimelineIO (`.otio`) timeline and `.otsi-reel` manifest export carrying faithful evidence flags.
 * - C.4: Portable Archive bundle (`otsi-archive/v1`) with `manifest.json` and `audit-extract.json`; rights re-checked at pack time and at every open/download.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { InterchangeExport, OtsiReelEvidenceFlags, Reel } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { ArchivePanel } from "./ArchiveBundle";

export interface EvidenceFlagLine {
  key: keyof OtsiReelEvidenceFlags;
  label: string;
  value: string;
  tone: "ok" | "warn";
}

export function describeEvidenceFlags(e: OtsiReelEvidenceFlags): EvidenceFlagLine[] {
  return [
    {
      key: "player_identity",
      label: "Player identity",
      value: e.player_identity === "CONFIRMED"
        ? "Confirmed by a person on every followed track"
        : e.player_identity === "STALE"
          ? "Stale — a followed track's identity changed since this reel was pinned"
          : "None — no player chosen",
      tone: e.player_identity === "CONFIRMED" && e.target_tracks_current ? "ok" : "warn",
    },
    {
      key: "match_clock",
      label: "Match clock",
      value: e.match_clock === "CONFIRMED"
        ? "Confirmed halves"
        : e.match_clock === "PROPOSED"
          ? "Proposed halves (not confirmed by a person)"
          : "Not set (video time only)",
      tone: e.match_clock === "CONFIRMED" ? "ok" : "warn",
    },
    {
      key: "match_score",
      label: "Match score",
      value: "Not measured on reels",
      tone: "warn",
    },
    {
      key: "events_evidence",
      label: "Player events",
      value: e.events_evidence === "INFERRED"
        ? `Inferred by rule (accuracy ${e.accuracy_gate.toLowerCase()})`
        : "No recorded events of this player in the clips",
      tone: "warn",
    },
    {
      key: "rights_state",
      label: "Video rights",
      value: e.sharing_allowed
        ? `${e.rights_state} · sharing allowed`
        : e.rights_state === "UNRECORDED"
          ? "Unrecorded — stays inside your organization"
          : `${e.rights_state} · sharing not allowed`,
      tone: e.sharing_allowed ? "ok" : "warn",
    },
  ];
}

function saveJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function InterchangeDialog({ reel, presetId, canWrite = true, open, onOpenChange }: {
  reel: Reel | null;
  presetId: string;
  canWrite?: boolean;
  open: boolean;
  onOpenChange(o: boolean): void;
}) {
  const [data, setData] = useState<InterchangeExport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<"manifest" | "otio" | "archive">("manifest");

  useEffect(() => {
    if (!open || !reel) return;
    let live = true;
    setData(null);
    setErr(null);
    api<InterchangeExport>(`/v1/reels/${reel.id}/interchange?preset=${encodeURIComponent(presetId)}`)
      .then((x) => { if (live) setData(x); }, (x) => { if (live) setErr(x instanceof ApiProblem ? x.message : "The timeline interchange could not be built."); });
    return () => { live = false; };
  }, [open, reel, presetId]);

  const lines = data ? describeEvidenceFlags(data.manifest.evidence) : [];
  const totalEvents = data ? data.manifest.clips.reduce((s, c) => s + c.events.length, 0) : 0;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="interchange" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(680px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-normal">Timeline interchange (.otio, .otsi-reel &amp; Archive bundle)</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">
            Export this reel as an OpenTimelineIO timeline (<code>.otio</code>) for non-linear editors, as a portable <code>.otsi-reel</code> manifest carrying the engine&apos;s evidence flags, or pack a rights-checked Archive bundle (<code>otsi-archive/v1</code>) with <code>manifest.json</code> and <code>audit-extract.json</code>.
          </Dialog.Description>
          {err ? (
            <p role="alert" data-interchange-error className="mb-3 text-xs text-[#ff8a8a]">{err}</p>
          ) : !data ? (
            <p className="mb-3 text-xs text-muted">Reading the reel and its evidence…</p>
          ) : (
            <>
              <div data-interchange-summary className="mb-3 rounded border border-line bg-raised p-2.5 text-xs">
                <div className="font-normal">{data.manifest.reel.name} · v{data.manifest.reel.version} · {data.manifest.reel.aspect}</div>
                <div className="text-muted">
                  {data.manifest.clips.length} clip{data.manifest.clips.length === 1 ? "" : "s"} · {(data.manifest.reel.duration_us / 1e6).toFixed(1)} s · {data.manifest.targets.length} followed track{data.manifest.targets.length === 1 ? "" : "s"} · {totalEvents} engine-inferred event{totalEvents === 1 ? "" : "s"} · Preset: {data.manifest.preset.name}
                </div>
              </div>
              <h3 className="mb-1.5 text-xs font-normal uppercase tracking-wide text-muted">Evidence flags carried in the export</h3>
              <ul data-interchange-evidence className="mb-3 space-y-1 text-xs">
                {lines.map((l) => (
                  <li key={l.key} data-evidence-flag={l.key} data-tone={l.tone} className="flex justify-between gap-3 rounded border border-line/60 px-2.5 py-1">
                    <span className="font-normal">{l.label}</span>
                    <span style={{ color: l.tone === "ok" ? "#3ee6a8" : "#f5b82e" }}>{l.value}</span>
                  </li>
                ))}
              </ul>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <button type="button" data-view-manifest onClick={() => setView("manifest")}
                  className={`rounded border px-2.5 py-1 ${view === "manifest" ? "border-[#1e90ff] bg-[#08213f] font-normal text-white" : "border-line text-muted"}`}>
                  .otsi-reel ({data.manifest.schema})
                </button>
                <button type="button" data-view-otio onClick={() => setView("otio")}
                  className={`rounded border px-2.5 py-1 ${view === "otio" ? "border-[#1e90ff] bg-[#08213f] font-normal text-white" : "border-line text-muted"}`}>
                  OpenTimelineIO ({data.otio.OTIO_SCHEMA})
                </button>
                <button type="button" data-view-archive onClick={() => setView("archive")}
                  className={`rounded border px-2.5 py-1 ${view === "archive" ? "border-[#1e90ff] bg-[#08213f] font-normal text-white" : "border-line text-muted"}`}>
                  Archive bundle (otsi-archive/v1)
                </button>
              </div>
              {view === "archive" && reel ? (
                <div className="mb-3">
                  <ArchivePanel subjectKind="REEL" subjectId={reel.id} canWrite={canWrite} />
                </div>
              ) : (
                <pre data-interchange-json data-interchange-view={view}
                  className="mb-3 max-h-56 overflow-auto rounded border border-line bg-[#041022] p-2.5 text-xs text-[#cfe0f5]">
                  {JSON.stringify(view === "manifest" ? data.manifest : data.otio, null, 2)}
                </pre>
              )}
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {data && view !== "archive" && (
              <>
                <button type="button" data-download-otio onClick={() => saveJson(`${data.filename_base}.otio`, data.otio)}
                  className="rounded border border-[#1e90ff] bg-[#08213f] px-3 py-1.5 font-normal text-[#33a8ff]">
                  Save {data.filename_base}.otio
                </button>
                <button type="button" data-download-manifest onClick={() => saveJson(`${data.filename_base}.otsi-reel`, data.manifest)}
                  className="rounded bg-primary px-3 py-1.5 font-normal text-white">
                  Save {data.filename_base}.otsi-reel
                </button>
              </>
            )}
            <Dialog.Close className="rounded border border-line px-3 py-1.5">Close</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
