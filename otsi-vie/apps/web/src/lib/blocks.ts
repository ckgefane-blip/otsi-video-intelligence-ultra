/** Construction blocks (BUILD_SEQUENCE.md), named where the UI says which block connects a section. */
export const BLOCK_NAMES: Record<number, string> = {
  0: "repository, licences, threat model",
  1: "MySQL, tenant isolation, outbox, audit",
  2: "sign-in, organizations and roles",
  3: "upload, media probe and URL import",
  4: "video proxy, timestamps and player timeline",
  5: "player and ball detection",
  6: "tracking, camera cuts and gaps",
  7: "roster, jersey OCR, re-identification and review",
  8: "events, pitch calibration and metrics",
  9: "tactical analysis and player reports",
  10: "reel candidates and the reel editor",
  11: "spotlight compositor and MP4 rendering",
  12: "rights, report export, sharing and delivery",
  13: "billing, quotas and metering",
  14: "all ten pages and the admin console",
  15: "observability, backups, security and release",
};
