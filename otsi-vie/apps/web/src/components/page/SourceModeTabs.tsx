"use client";
import { Layers, Link2, UploadCloud } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const SOURCE_MODES = [
  { mode: "file", label: "Upload File", icon: UploadCloud, note: "Resumable upload: every part is checksummed, and the whole file is verified and inspected before use." },
  { mode: "url", label: "YouTube / URL", icon: Link2, note: "Import from a direct link to a video file: downloaded only from public addresses, then verified like an upload. Video-platform pages need a licensed integration." },
  { mode: "batch", label: "Batch Upload", icon: Layers, note: "Select or drop several files at once; each one uploads and is verified on its own." },
] as const;

export type SourceMode = (typeof SOURCE_MODES)[number]["mode"];

export function sourceMode(raw: string | null): SourceMode {
  return SOURCE_MODES.some((m) => m.mode === raw) ? (raw as SourceMode) : "file";
}

/** Upload page section 1: the source-mode switcher. The mode lives in the URL (?mode=), so the Home CTAs deep-link to it. */
export function SourceModeTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = sourceMode(params.get("mode"));
  const active = SOURCE_MODES.find((m) => m.mode === current)!;
  return (
    <div>
      <div role="tablist" aria-label="Source" className="grid grid-cols-3 overflow-hidden rounded-ctl border border-line">
        {SOURCE_MODES.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={mode === current}
            onClick={() => router.replace(`${pathname}?mode=${mode}`, { scroll: false })}
            className={`flex items-center justify-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium ${
              mode === current ? "border-primary bg-primary/10 text-primary" : "border-transparent text-ink/85 hover:bg-raised/60"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      <p role="tabpanel" aria-label={active.label} className="mt-2 text-xs text-muted">{active.note}</p>
    </div>
  );
}
