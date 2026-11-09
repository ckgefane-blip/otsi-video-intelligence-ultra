/**
 * Resumable upload of a match video (Block 03, ADR-022). The server plans the parts; the browser sends the missing ones (3 at a time),
 * each with its SHA-256 so a part damaged in transit is refused and re-sent, then completes the upload. The same file picked again
 * resumes the same upload (Idempotency-Key remembered per file in this browser). Nothing here decides that the video is usable: the
 * ingest worker does, after verifying and probing it.
 */
import type { IngestOptions, UploadRights, UploadSession, Video } from "@otsi-vie/contracts";
import { api, ApiProblem } from "./api";

const KEYS = "otsi-vie-upload-keys";
const PARALLEL = 3;
const RETRIES_PER_PART = 4;

export interface Progress { sentBytes: number; totalBytes: number; partsDone: number; partCount: number }

function fileFingerprint(f: File, projectId: string): string {
  return `${projectId}|${f.name}|${f.size}|${f.lastModified}`;
}

function idempotencyKeyFor(f: File, projectId: string): string {
  let map: Record<string, string> = {};
  try { map = JSON.parse(localStorage.getItem(KEYS) ?? "{}"); } catch { /* fresh */ }
  const fp = fileFingerprint(f, projectId);
  if (!map[fp]) {
    map[fp] = `up-${crypto.randomUUID()}`;
    try { localStorage.setItem(KEYS, JSON.stringify(map)); } catch { /* storage unavailable: resume only within this page */ }
  }
  return map[fp];
}

export function forgetUpload(f: File, projectId: string): void {
  try {
    const map = JSON.parse(localStorage.getItem(KEYS) ?? "{}");
    delete map[fileFingerprint(f, projectId)];
    localStorage.setItem(KEYS, JSON.stringify(map));
  } catch { /* nothing to forget */ }
}

async function sha256Hex(b: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function startOrResume(file: File, projectId: string, options?: IngestOptions, rights?: UploadRights | null): Promise<UploadSession> {
  return api<UploadSession>("/v1/uploads", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKeyFor(file, projectId) },
    json: { project_id: projectId, file_name: file.name, byte_size: file.size, ...(options ? { options } : {}), ...(rights ? { rights } : {}) },
  });
}

/** Send every part the server does not have yet, then complete. Throws ApiProblem on a refusal; AbortError when paused. */
export async function sendFile(file: File, projectId: string, options: IngestOptions | undefined, onProgress: (p: Progress) => void, signal: AbortSignal,
  rights?: UploadRights | null): Promise<Video> {
  let session = await startOrResume(file, projectId, options, rights);
  if (session.status === "EXPIRED" || session.status === "ABORTED" || session.status === "FAILED") {
    forgetUpload(file, projectId);                                    // start a fresh upload for this file
    session = await startOrResume(file, projectId, options, rights);
  }
  const done = new Set(session.received_parts);
  const sizeOf = (n: number) => Math.min(session.part_bytes, file.size - (n - 1) * session.part_bytes);
  let sent = [...done].reduce((a, n) => a + sizeOf(n), 0);
  const report = () => onProgress({ sentBytes: sent, totalBytes: file.size, partsDone: done.size, partCount: session.part_count });
  report();
  if (session.status === "UPLOADING" || session.status === "INITIALIZED") {
    const todo = Array.from({ length: session.part_count }, (_, i) => i + 1).filter((n) => !done.has(n));
    const worker = async () => {
      for (let n = todo.shift(); n !== undefined; n = todo.shift()) {
        const blob = file.slice((n - 1) * session.part_bytes, (n - 1) * session.part_bytes + sizeOf(n));
        const bytes = await blob.arrayBuffer();
        const sha = await sha256Hex(bytes);
        for (let attempt = 1; ; attempt++) {
          if (signal.aborted) throw new DOMException("paused", "AbortError");
          try {
            await api(`/v1/uploads/${session.upload_id}/parts/${n}`, {
              method: "PUT", body: bytes, signal, headers: { "content-type": "application/octet-stream", "x-part-sha256": sha },
            });
            break;
          } catch (e) {
            const retryable = !(e instanceof ApiProblem) || e.status >= 500 || e.code === "PART_CHECKSUM_MISMATCH";
            if ((e as Error).name === "AbortError" || !retryable || attempt >= RETRIES_PER_PART) throw e;
            await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          }
        }
        done.add(n);
        sent += bytes.byteLength;
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
  }
  const video = await api<Video>(`/v1/uploads/${session.upload_id}/complete`, { method: "POST" });
  forgetUpload(file, projectId);
  return video;
}

export async function cancelUpload(uploadId: string): Promise<void> {
  await api(`/v1/uploads/${uploadId}`, { method: "DELETE" });
}
