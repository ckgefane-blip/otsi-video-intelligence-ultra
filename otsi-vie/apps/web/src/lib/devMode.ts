/**
 * ADR-080 (v3 Phase 0.12, S09): what is not built yet is said plainly to the people building the app, never to a customer.
 * Dev mode is on when the app is built with NEXT_PUBLIC_OTSI_DEV_MODE=1 (local development and tests); the live app leaves it off, so a
 * customer reads "Not available yet" with no internal detail. The control still explains itself and still does nothing it cannot do.
 */
export const DEV_MODE = process.env.NEXT_PUBLIC_OTSI_DEV_MODE === "1";

/** the reason a control cannot act because the feature does not exist: the detail in Dev mode, "Not available yet" for a customer */
export function notBuilt(detail?: string): string {
  return DEV_MODE ? `Not built yet${detail ? `: ${detail}` : ""}` : "Not available yet";
}

/** the same as words inside a sentence: "not built yet" (Dev mode) or "not available yet" */
export const NOT_YET = DEV_MODE ? "not built yet" : "not available yet";
