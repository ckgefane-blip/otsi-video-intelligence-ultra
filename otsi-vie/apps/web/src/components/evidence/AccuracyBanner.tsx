"use client";
/**
 * The accuracy banner (v3 Phase A.6, ADR-063): under the top bar on every app page while the accuracy gates (G05 detection, G06
 * tracking, G07 identity) are not all passed. It tells the person that every number is what the engine recorded and that its accuracy
 * on football has not been measured yet. "Hide for now" hides it for this browser session only; it returns in the next one.
 */
import { ACCURACY_GATES, accuracyMeasured } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";

const KEY = "otsi-vie.accuracy-banner.hidden";

export function AccuracyBanner() {
  const [hidden, setHidden] = useState(true);                 // hidden until read, so it never flashes on a session that hid it
  useEffect(() => {
    try { setHidden(sessionStorage.getItem(KEY) === "1"); } catch { setHidden(false); }
  }, []);
  if (accuracyMeasured() || hidden) return null;
  const open = ACCURACY_GATES.filter((g) => g.status !== "PASSED");
  return (
    <div role="note" aria-label="Accuracy not yet measured" data-accuracy-banner
      className="flex items-center gap-3 border-b border-[#5a4410] bg-[#2a1f08] px-4 py-1.5 text-xs text-[#ffd98a]">
      <span aria-hidden className="font-normal">!</span>
      <span className="flex-1">
        <span className="font-normal">Accuracy not yet measured.</span> Every number and box is what the engine recorded on this footage; how often it is right on football
        has not been measured yet ({open.map((g) => `${g.name} ${g.id}`).join(", ")} open). Check what matters before you rely on it.
      </span>
      <span className="hidden gap-1 md:flex" title={open.map((g) => `${g.id} ${g.name}: ${g.what}`).join("\n")}>
        {open.map((g) => <span key={g.id} className="rounded bg-[#3a2c0c] px-1.5 py-0.5">{g.id} {g.status === "MEASURING" ? "measuring" : "not started"}</span>)}
      </span>
      <button type="button" className="rounded border border-[#5a4410] px-2 py-0.5 hover:bg-[#3a2c0c]" data-accuracy-hide
        onClick={() => { try { sessionStorage.setItem(KEY, "1"); } catch { /* storage blocked: hidden until reload */ } setHidden(true); }}>Hide for now</button>
    </div>
  );
}
