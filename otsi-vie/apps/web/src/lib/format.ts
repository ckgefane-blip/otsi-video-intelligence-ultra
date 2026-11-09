/** Display formats for measured values. A value that was not measured is shown as "—", never as zero. */

export const NOT_MEASURED = "—";

export function formatDuration(us: number | null | undefined): string {
  if (!us || us <= 0) return NOT_MEASURED;
  const s = Math.round(us / 1_000_000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return NOT_MEASURED;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatFps(r: { num: number; den: number } | null | undefined, variable?: boolean | null): string {
  if (!r) return NOT_MEASURED;
  const fps = r.num / r.den;
  const s = Number.isInteger(fps) ? String(fps) : fps.toFixed(2);
  return `${s} fps${variable ? " (variable)" : ""}`;
}

export function formatResolution(w: number | null | undefined, h: number | null | undefined): string {
  return w && h ? `${w} × ${h}` : NOT_MEASURED;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** What a video's state means to the person looking at it. */
export function videoStatusLabel(v: { state: string; job: { state: string; progress: number; stage_message: string | null } | null; upload: { received_bytes: number; expected_bytes: number } | null }): { label: string; tone: "ok" | "busy" | "warn" | "bad" | "idle" } {
  switch (v.state) {
    case "INGESTED": return { label: "Ready", tone: "ok" };
    case "QUARANTINED": return { label: "Quarantined", tone: "bad" };
    case "FAILED": return { label: "Refused", tone: "bad" };
    case "VALIDATING":
      if (v.job?.state === "RUNNING") return { label: v.job.stage_message ?? `Checking ${Math.round(v.job.progress)}%`, tone: "busy" };
      return { label: "Waiting to be checked", tone: "busy" };
    default:
      return v.upload ? { label: `Uploading ${Math.floor((100 * v.upload.received_bytes) / v.upload.expected_bytes)}%`, tone: "warn" } : { label: "Not uploaded", tone: "idle" };
  }
}
