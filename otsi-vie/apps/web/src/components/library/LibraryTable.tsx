"use client";
/**
 * v3 Phase B.12 (ADR-088): the Library's table view, beside the approved card rows (the toggle above the list switches them; the choice
 * is remembered in this browser). Every column is a recorded fact (GET /v1/library/facts and the Library's own list):
 *   🔒        locked: a restricted project (only its people see it), or rights that do not allow making anything new from it now
 *   Rights    the video's current grant; a reel or export takes its video's; "Not recorded" when there is none
 *   Evidence  analysed or not, tracks, person-confirmed tracks
 *   Profile   analysis profile (video, match), frame (reel), export profile (export)
 *   Device    the screen an output is made for; the camera of a source video is not recorded
 * Rows share the card view's selection (checkboxes) and bulk actions, and its click (select the row; a folder opens).
 */
import { deviceOf, evidenceLine, EXPORT_PROFILES, PROFILE_LABEL, rightsLine, type LibraryFacts, type Reel, type Video, type VideoFacts } from "@otsi-vie/contracts";
import { memo, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { u } from "@/components/stage/DesignStage";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { kindLabel, statusLabel, type Asset } from "./useLibrary";

export type LibraryView = "cards" | "table";
const KEY = "otsi.library.view";
export function useLibraryView(): [LibraryView, (v: LibraryView) => void] {
  const [v, setV] = useState<LibraryView>("cards");
  useEffect(() => { try { if (localStorage.getItem(KEY) === "table") setV("table"); } catch { /* storage blocked: cards */ } }, []);
  return [v, (n) => { setV(n); try { localStorage.setItem(KEY, n); } catch { /* not remembered */ } }];
}

/** the facts of every visible video, by video id; null while loading or unreachable */
export function useLibraryFacts(version: unknown): Map<string, VideoFacts> | null {
  const [f, setF] = useState<Map<string, VideoFacts> | null>(null);
  useEffect(() => { void api<LibraryFacts>("/v1/library/facts").then((r) => setF(new Map(r.videos.map((v) => [v.video_id, v]))), () => setF(null)); }, [version]);
  return f;
}

export interface Row { rights: string; locked: string | null; evidence: string; profile: string; device: string }

/** the extra columns of one asset */
export function rowFacts(a: Asset, facts: Map<string, VideoFacts> | null, videoOfMatch: Map<string, string>, d: Dictionary): Row {
  const vid = a.videoId ?? (a.kind === "Video" ? a.id : a.kind === "Match" ? videoOfMatch.get(a.id) ?? null : null);
  const f = vid && facts ? facts.get(vid) ?? null : null;
  const restricted = a.project?.access === "RESTRICTED";
  const media = a.kind === "Video" || a.kind === "Match" || a.kind === "Reel" || a.kind === "Export";
  const r = media && f ? rightsLine(f.rights) : null;
  const locked = restricted ? d.body.library.tableLockedRestricted : r?.locked ? (f?.rights?.produce_block ?? d.body.library.tableNoRights) : null;
  let profile = "—", device = "—";
  if (a.kind === "Video" || a.kind === "Match") { profile = f?.profile ? PROFILE_LABEL[f.profile] ?? f.profile : f?.analysed ? d.body.players.notRecorded : "—"; device = d.body.library.tableCameraNotRecorded; }
  if (a.kind === "Reel") { const reel = a.raw as Reel; profile = d.body.library.tableFrame.replace("{a}", reel.aspect); device = deviceOf(reel.aspect) ?? "—"; }
  if (a.kind === "Export") {
    const reel = a.raw as Reel, fm = reel.formats?.find((x) => x.render_id === a.renderId);
    profile = fm ? EXPORT_PROFILES[fm.profile].label : d.body.library.tableFrame.replace("{a}", reel.aspect); device = deviceOf(fm?.aspect ?? reel.aspect) ?? "—";
  }
  // a video the facts do not cover (not visible, not loaded): a dash, never a guess
  return { rights: !media ? "—" : facts === null ? "…" : r?.text ?? "—", locked, evidence: media ? (facts === null ? "…" : evidenceLine(f)) : "—", profile, device };
}

export function videoOfMatchMap(all: Asset[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of all) if (a.kind === "Video") { const v = a.raw as Video; if (v.match_id && !m.has(v.match_id)) m.set(v.match_id, v.id); }
  return m;
}

const th: React.CSSProperties = { position: "sticky", top: 0, background: "#06162d", textAlign: "left", fontWeight: 600, color: "#cfe0f5", padding: `${u(10)} ${u(10)}`, fontSize: u(18), whiteSpace: "nowrap", zIndex: 1 };
const td: React.CSSProperties = { padding: `${u(10)} ${u(10)}`, fontSize: u(18), color: "#d6e4f7", borderTop: `${u(1)} solid #10294a`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: u(260) };

export const LibraryTable = memo(function LibraryTable({ rows, all, facts, checked, setChecked, selected, onRow }: {
  rows: Asset[]; all: Asset[]; facts: Map<string, VideoFacts> | null; checked: Set<string>; setChecked: (s: Set<string>) => void; selected: string | null; onRow: (a: Asset) => void;
}) {
  const { t: dict } = useLocale();
  const vm = useMemo(() => videoOfMatchMap(all), [all]);
  const allOn = rows.length > 0 && rows.every((a) => checked.has(a.key));
  const toggle = (k: string) => { const n = new Set(checked); if (n.has(k)) n.delete(k); else n.add(k); setChecked(n); };
  return (
    <div className="absolute" data-library-table style={{ left: u(427), top: u(483 - 101), width: u(1554), height: u(880), overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
        <thead>
          <tr>
            <th style={th}><input type="checkbox" aria-label={dict.body.library.selectAllAria} checked={allOn} onChange={() => setChecked(allOn ? new Set() : new Set(rows.map((a) => a.key)))} /></th>
            <th style={th} aria-label={dict.body.library.tableLockedAria}><span aria-hidden>🔒</span></th>
            {[dict.body.library.tableHeadTitle, dict.body.library.tableHeadType, dict.body.library.tableHeadRights, dict.body.library.tableHeadEvidence, dict.body.library.tableHeadProfile, dict.body.library.tableHeadDevice, dict.body.library.tableHeadUpdated, dict.body.library.tableHeadStatus].map((h) => <th key={h} style={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const r = rowFacts(a, facts, vm, dict), on = a.key === selected;
            return (
              <tr key={a.key} data-table-row={a.key} aria-selected={on} onClick={() => onRow(a)} style={{ cursor: "pointer", background: on ? "#04264a" : undefined }}>
                <td style={td} onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={dict.body.library.rowSelect.replace("{a}", a.title)} checked={checked.has(a.key)} onChange={() => toggle(a.key)} /></td>
                <td style={td}>{r.locked ? <span role="img" aria-label={dict.body.library.tableLockedLabel.replace("{a}", r.locked)} title={r.locked}>🔒</span> : ""}</td>
                <td style={{ ...td, maxWidth: u(380) }} title={a.title}><b>{a.title}</b><br /><span style={{ color: "#9fb3cc", fontSize: u(16) }}>{a.sub}</span></td>
                <td style={td}>{kindLabel(a.kind, dict)}</td>
                <td style={td} title={r.locked ?? r.rights}>{r.rights}</td>
                <td style={td}>{r.evidence}</td>
                <td style={td}>{r.profile}</td>
                <td style={td}>{r.device}</td>
                <td style={td}>{a.updated ? new Date(a.updated).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                <td style={td}>{statusLabel(a.status, dict)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

/** the selected rows as a CSV (the same columns), for the person to keep */
export function rowsCsv(rows: Asset[], all: Asset[], facts: Map<string, VideoFacts> | null, d: Dictionary): string {
  const vm = videoOfMatchMap(all);
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = [d.body.library.tableHeadTitle, d.body.library.tableHeadType, d.body.library.tableHeadLocked, d.body.library.tableHeadRights, d.body.library.tableHeadEvidence, d.body.library.tableHeadProfile, d.body.library.tableHeadDevice, d.body.library.tableHeadUpdated, d.body.library.tableHeadStatus];
  return [head.map(q).join(","), ...rows.map((a) => { const r = rowFacts(a, facts, vm, d); return [a.title, kindLabel(a.kind, d), r.locked ?? "", r.rights, r.evidence, r.profile, r.device, a.updated, statusLabel(a.status, d)].map(q).join(","); })].join("\r\n");
}
