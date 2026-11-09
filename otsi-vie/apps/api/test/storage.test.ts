/** LocalStore.writePart when the sender goes away mid-part (2026-11-05: an unhandled write error ended the whole API process). */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, describe, expect, it } from "vitest";
import { LocalStore } from "../src/core/storage";

const ID = "01a1ad38-fe98-7525-8311-1021df809e39";
const dirs: string[] = [];
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

/** a request body that sends `chunks` pieces of 8 KiB and then breaks like a dropped connection, right while the last piece is still
 * being written to disk (each piece is below the file stream's buffer, so its write is in flight when the drop arrives) */
function dropping(chunks: number): Readable {
  return Readable.from((async function* () {
    for (let i = 0; i < chunks; i++) yield Buffer.alloc(8192, i);
    throw Object.assign(new Error("aborted"), { code: "ECONNRESET" });
  })());
}

describe("writePart", () => {
  it("a dropped sender fails the part, leaves no file and never an uncaught error", async () => {
    const root = await mkdtemp(path.join(process.env.TEMP ?? os.tmpdir(), "otsi-store-")); dirs.push(root);
    const store = new LocalStore(root);
    const uncaught: unknown[] = [];
    const onErr = (e: unknown) => uncaught.push(e);
    process.on("uncaughtException", onErr);
    try {
      for (const n of [1, 2, 3]) await expect(store.writePart(ID, n, dropping(n), 16 * 1024 * 1024)).rejects.toThrow("aborted");
      await new Promise((r) => setTimeout(r, 200));                   // late write callbacks would surface here
      expect(uncaught).toEqual([]);
      expect(await readdir(store.uploadDir(ID))).toEqual([]);
      // the same part sent again in full is stored
      const whole = Readable.from([Buffer.alloc(1000, 7)]);
      expect((await store.writePart(ID, 1, whole, 1000)).bytes).toBe(1000);
      expect(await readdir(store.uploadDir(ID))).toEqual(["part-000001"]);
    } finally { process.off("uncaughtException", onErr); }
  });
});
