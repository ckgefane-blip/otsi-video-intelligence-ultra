/** v3 Phase 0 P9: the video open on one page is where the next page starts, while it still exists; the address always wins. */
import { beforeEach, describe, expect, it } from "vitest";
import { pickVideo, recallVideo, rememberVideo } from "@/lib/currentVideo";

describe("current video", () => {
  beforeEach(() => localStorage.clear());
  it("is remembered per organization and used only while it is still listed", () => {
    const list = [{ id: "a" }, { id: "b" }];
    expect(pickVideo("org1", list, list[0])).toEqual({ id: "a" });
    rememberVideo("org1", "b");
    expect(recallVideo("org1")).toBe("b");
    expect(recallVideo("org2")).toBeNull();
    expect(pickVideo("org1", list, list[0])).toEqual({ id: "b" });
    expect(pickVideo("org1", [{ id: "a" }], { id: "a" })).toEqual({ id: "a" });   // removed since: the fallback
    rememberVideo(null, "x");
    expect(pickVideo(null, list, undefined)).toBeUndefined();
  });
});
