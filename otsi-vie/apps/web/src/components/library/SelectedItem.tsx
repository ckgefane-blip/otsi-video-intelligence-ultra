"use client";
/**
 * Page 09 Sections 07–10 — selected-item preview, metadata, quick actions and collaborator access (approved reference
 * 09_LIBRARY_PROJECT_CENTER, "right panel").
 *
 * The preview plays the asset's real file: a rendered reel's MP4 (GET /v1/renders/:id/playback), otherwise the source video's playback
 * copy. Details are what was recorded (competition, match, featured player, creator, dates, length, file size, resolution); tags are
 * not recorded, so "—". Download gives the rendered MP4 only; Share copies the in-app link; Edit renames a reel or project; Open
 * in Analysis opens the source video. Duplicate copies a reel (POST /v1/reels/:id/duplicate: same player, pinned identities, settings and
 * clips; renders, links and notes are not copied). Send to Client opens the reel's Export & Delivery page (ADR-058). Nothing is a dead
 * control: Send to Client and Duplicate on anything but a reel and anything that needs a selection say why when clicked.
 * Collaborators (ADR-057) shows who can see the item: its project's people and whether only they (and Owners / Admins) may see it, or
 * everyone in the organization. Manage Access opens the project's access list (AccessDialog); the server enforces it on every route.
 * A.12 (ADR-078): Media Info, in the heading, opens everything recorded about the item's source video (MediaInfoDialog).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { PERMISSION_NAMES, type LibraryFolder, type Match, type Member, type Playback, type Project, type Reel } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { B, Ic, P, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { api, ApiProblem } from "@/lib/api";
import { MediaInfoDialog } from "@/components/media/MediaInfoDialog";
import { AccessDialog } from "./AccessDialog";
import type { Asset } from "./useLibrary";

const IN = { background: "#041022", borderRadius: u(8), ["--bc" as string]: "#17406f" };
const ROWS: [string, string, number][] = [["ball", "Competition", 688], ["calendar", "Match", 737], ["user", "Players Featured", 786], ["cir", "Created By", 832],
  ["clock", "Curated", 873], ["clock", "Duration", 913], ["img", "File Size", 952], ["img", "Resolution", 988], ["tagdot", "Tags", 1031]];
const mb = (b: number | null) => (b === null ? "—" : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const dur = (us: number | null) => (us ? `${Math.floor(us / 6e7)}:${String(Math.round(us / 1e6) % 60).padStart(2, "0")}` : "—");

function Action({ x, y, icon, ix, tx, label, onClick, why, primary, say }: { x: number; y: number; icon: string; ix: number; tx: number; label: string; onClick?: (() => void) | undefined; why: string; primary?: boolean; say: (t: string) => void }) {
  return (
    <button type="button" aria-label={label} title={onClick ? label : why} aria-disabled={!onClick || undefined} onClick={onClick ?? (() => say(why))} className={`${s.a} ${s.framed}`}
      style={{ left: u(x), top: u(y - 101), width: u(240), height: u(52), padding: 0, border: 0, color: "inherit", font: "inherit", cursor: "pointer",
        opacity: onClick ? 1 : 0.55, ...(primary ? { background: "#08294d", borderRadius: u(8), ["--bc" as string]: "#1e6fc0" } : IN) }}>
      <Ic o={[x, y]} x={ix} y={y + 26} k={icon} size={24} color={primary ? "#33a8ff" : "#cfe0f5"} />
      <T o={[x, y]} x={tx} y={y + 26} size={21} weight={600} color={primary ? "#33a8ff" : undefined} as="span">{label}</T>
    </button>
  );
}

export function SelectedItem({ a, match, onClose, reload, canWrite }: { a: Asset | null; match: Match | null; onClose: () => void; reload: () => Promise<void>; canWrite: boolean }) {
  const [play, setPlay] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [access, setAccess] = useState(false);
  const [info, setInfo] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => { setPlay(null); setNote(null); }, [a?.key]);
  const [members, setMembers] = useState<Member[] | null>(null);
  useEffect(() => { void api<Member[]>("/v1/members").then(setMembers, () => setMembers(null)); }, []);
  const flash = (t: string) => { setNote(t); setTimeout(() => setNote(null), 2500); };
  const reel = a?.kind === "Reel" || a?.kind === "Export" ? (a.raw as Reel) : null;
  const renderId = a?.renderId ?? (reel?.last_good_render?.has_output ? reel.last_good_render.id : null);
  const videoId = a?.videoId ?? null;
  const canPlay = !!renderId || !!videoId;
  const start = async () => {
    try {
      if (renderId) setPlay((await api<{ url: string }>(`/v1/renders/${renderId}/playback`)).url);
      else if (videoId) { const p = await api<Playback>(`/v1/videos/${videoId}/playback`); if (p.available && p.url) setPlay(p.url); else flash(`No playback yet: ${p.reason ?? "being prepared"}`); }
    } catch { flash("Playback unavailable"); }
  };
  const download = renderId ? async () => {
    try { location.href = (await api<{ download_url: string }>(`/v1/renders/${renderId}/playback`)).download_url; } catch { flash("Download unavailable"); }
  } : undefined;
  const renamable = !!a && canWrite && (a.kind === "Reel" || a.kind === "Folder" || a.kind === "Project" || a.kind === "Video");
  const whyNoRename = !a ? "Select an asset in the table first" : !canWrite ? "Your role can view the library but not rename"
    : a.kind === "Match" ? "Match details are edited on the Analysis page" : a.kind === "Export" ? "Rename the reel; the rendered file keeps its name" : "This asset cannot be renamed";
  const pickFirst = "Select an asset in the table first";
  const rename = async () => {
    try {
      if (a!.kind === "Reel") await api(`/v1/reels/${a!.id}`, { method: "PATCH", json: { version: (a!.raw as Reel).version, name } });
      else if (a!.kind === "Video") await api(`/v1/videos/${a!.id}`, { method: "PATCH", json: { title: name } });
      else if (a!.kind === "Folder") await api(`/v1/library/folders/${a!.id}`, { method: "PATCH", json: { version: (a!.raw as LibraryFolder).version, name } });
      else await api(`/v1/projects/${a!.id}`, { method: "PATCH", json: { version: (a!.raw as Project).version, name } });
      setNaming(false); await reload();
    } catch (x) { flash(x instanceof ApiProblem ? x.message : "Rename failed"); }
  };
  const vals: string[] = a ? [
    a.competition ?? "—", match ? `${match.home?.name ?? "—"} vs ${match.away?.name ?? "—"}` : "—", a.player ?? "—",
    (a.createdBy && members?.find((m) => m.user_id === a.createdBy)?.display_name) ?? "—",
    a.created ? new Date(a.created).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—", dur(a.durationUs), mb(a.bytes),
    a.width && a.height ? `${a.width} × ${a.height}` : "—", "—",
  ] : ROWS.map(() => "—");

  return (
    <>
      <P x={2003} y={121} w={537} h={1299} />
      <T x={2027} y={156} size={25} weight={600} color="#33a8ff" as="h2">Selected Item</T>
      <button type="button" onClick={() => (videoId ? setInfo(true) : flash(a ? "This asset has no source video" : pickFirst))} className="absolute" data-action="media-info"
        title={a?.kind === "Video" ? "Everything recorded about this file" : "Everything recorded about the source video"}
        style={{ left: u(2330), top: u(156 - 101 - 13), width: u(145), height: u(26), padding: 0, border: 0, background: "transparent", color: "#33a8ff", fontSize: u(18),
          fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", textAlign: "right", opacity: videoId ? 1 : 0.6 }}>Media Info</button>
      <MediaInfoDialog videoId={videoId} name={a?.kind === "Video" ? a.title : `source of ${a?.title ?? ""}`} open={info} onOpenChange={setInfo} />
      <button type="button" aria-label="Clear the selection" onClick={a ? onClose : () => flash("Nothing is selected")} className="absolute"
        style={{ left: u(2490), top: u(142 - 101), width: u(30), height: u(30), padding: 0, border: 0, background: "transparent", cursor: "pointer" }}>
        <Ic o={[2490, 142]} x={2505} y={157} k="x" size={24} />
      </button>
      <B x={2003} y={185} w={537} h={1} style={{ background: "#12335f" }} />

      <section aria-label="Selected-item video preview" data-section="p09-s07">
        <B x={2025} y={208} w={493} h={260} style={{ borderRadius: u(8), overflow: "hidden",
          background: "radial-gradient(ellipse at 70% 30%,#e3b898 0,#c98c6a 6%,transparent 7%),radial-gradient(ellipse at 60% 110%,#7cc2f2 0,#3a86c8 40%,transparent 70%),linear-gradient(135deg,#27487a,#0e2040)" }}>
          {play && <video src={play} controls autoPlay playsInline aria-label={`${a?.title ?? ""} preview`} style={{ width: "100%", height: "100%", background: "#000", display: "block" }} />}
        </B>
        {!play && (
          <button type="button" aria-label={canPlay ? `Play ${a!.title}` : "Nothing to play"}
            onClick={() => (canPlay ? void start() : flash(a ? "This asset has no video to play" : pickFirst))} className="absolute"
            style={{ left: u(2232), top: u(307 - 101), width: u(72), height: u(72), padding: 0, border: 0, borderRadius: "50%", background: "rgba(10,20,40,.7)", cursor: "pointer" }}>
            <span style={{ position: "absolute", left: u(26), top: u(21), width: u(26), height: u(32), background: "#fff", clipPath: "polygon(0 0,100% 50%,0 100%)" }} />
          </button>
        )}
        {!play && <><B x={2432} y={423} w={74} h={32} style={{ background: "rgba(0,10,25,.8)", borderRadius: u(6) }} /><T x={2469} y={439} size={22} weight={600} align="center">{dur(a?.durationUs ?? null)}</T></>}
      </section>

      <section aria-label="Selected-item metadata" data-section="p09-s08">
        <T x={2025} y={503} size={26} weight={700} style={{ maxWidth: u(370), overflow: "hidden", textOverflow: "ellipsis" }}>{a?.title ?? "No asset selected"}</T>
        <button type="button" aria-label="Edit the name" title={renamable ? "Rename" : whyNoRename} aria-disabled={!renamable || undefined}
          onClick={() => { if (!renamable) return flash(whyNoRename); setName(a!.title); setNaming(true); }} className={`${s.a} ${s.framed}`}
          style={{ left: u(2406), top: u(484 - 101), width: u(111), height: u(42), padding: 0, border: 0, color: "inherit", font: "inherit", cursor: "pointer", ...IN }}>
          <Ic o={[2406, 484]} x={2432} y={505} k="edit" size={22} />
          <T o={[2406, 484]} x={2476} y={505} size={19} as="span">Edit</T>
        </button>
        {a && (
          <>
            <B x={2025} y={538} w={a.kind.length * 11 + 30} h={35} style={{ background: "#0a84ff", borderRadius: u(6) }} />
            <T x={2025 + (a.kind.length * 11 + 30) / 2} y={556} size={18} align="center">{a.kind}</T>
            <B x={2035 + a.kind.length * 11 + 30} y={538} w={a.status.length * 10 + 30} h={35} style={{ background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6) }} />
            <T x={2035 + a.kind.length * 11 + 30 + (a.status.length * 10 + 30) / 2} y={556} size={18} align="center">{a.status}</T>
          </>
        )}
        <T x={2027} y={599} size={22} color="#d6e4f7" style={{ maxWidth: u(490), overflow: "hidden", textOverflow: "ellipsis" }}>{a ? a.sub : "Select an asset in the table to see its details."}</T>
        <dl style={{ margin: 0 }}>
          {ROWS.map(([k, l, y], i) => (
            <div key={l}>
              <Ic x={2040} y={y === 737 ? 736 : y} k={k} size={26} color="#cfe0f5" />
              <T x={2073} y={y === 737 ? 736 : y} size={20} color="#cfe0f5" as="span">{l}</T>
              <T x={2244} y={y} size={20} color="#e3eefb" as="span" style={{ maxWidth: u(270), overflow: "hidden", textOverflow: "ellipsis" }}>{vals[i]}</T>
            </div>
          ))}
        </dl>
      </section>

      <section aria-label="Selected-item quick actions" data-section="p09-s09">
        <button type="button" aria-label="Download the rendered MP4" title={download ? "Download" : "Only rendered reels can be downloaded"} aria-disabled={!download || undefined}
          onClick={download ?? (() => flash(a ? "Only rendered reels can be downloaded: render it in the Reel Builder or Clip Studio" : pickFirst))}
          className="absolute" style={{ left: u(2025), top: u(1075 - 101), width: u(494), height: u(58), padding: 0, border: 0, borderRadius: u(8), background: "#0a84ff",
            color: "#fff", font: "inherit", cursor: "pointer", opacity: download ? 1 : 0.6 }}>
          <B o={[2025, 1075]} x={2467} y={1085} w={1.5} h={38} style={{ background: "#4fa8ff" }} />
          <Ic o={[2025, 1075]} x={2194} y={1104} k="dl" size={28} />
          <T o={[2025, 1075]} x={2231} y={1104} size={24} weight={600} as="span">Download</T>
          <Ic o={[2025, 1075]} x={2494} y={1104} k="chev" size={22} />
        </button>
        <Action x={2025} y={1145} icon="link" ix={2115} tx={2144} label="Share" why={pickFirst} say={flash}
          onClick={a?.href ? () => { void navigator.clipboard?.writeText(`${location.origin}${a.href}`).then(() => flash("Link copied (members of your organization can open it)"), () => flash("Copy failed")); } : undefined} />
        <Action x={2279} y={1145} icon="doc" ix={2369} tx={2398} label="Duplicate" say={flash}
          why={!a ? pickFirst : !reel ? "Only a reel can be duplicated: a copy of a video or match would be the same footage twice" : "Your role can view reels but not copy them"}
          onClick={reel && canWrite ? () => {
            void api<Reel>(`/v1/reels/${reel.id}/duplicate`, { method: "POST" }).then(async (c) => { await reload(); flash(`Copied as "${c.name}"`); },
              (x) => flash(x instanceof ApiProblem ? x.message : "The reel could not be copied"));
          } : undefined} />
        <Action x={2025} y={1208} icon="send" ix={2073} tx={2107} label="Send to Client" say={flash} why={!a ? pickFirst : "Only a reel is sent to a client: open it in Export & Delivery"}
          onClick={reel ? () => { window.location.href = `/exports?reel=${reel.id}`; } : undefined} />
        {videoId ? (
          <Link href={`/videos/${videoId}/analyze`} className={`${s.a} ${s.framed}`} aria-label="Open in Analysis"
            style={{ left: u(2279), top: u(1208 - 101), width: u(240), height: u(52), background: "#08294d", borderRadius: u(8), ["--bc" as string]: "#1e6fc0", color: "inherit", textDecoration: "none" }}>
            <Ic o={[2279, 1208]} x={2319} y={1234} k="bars3" size={24} color="#33a8ff" />
            <T o={[2279, 1208]} x={2351} y={1234} size={21} weight={600} color="#33a8ff" as="span">Open in Analysis</T>
          </Link>
        ) : <Action x={2279} y={1208} icon="bars3" ix={2319} tx={2351} label="Open in Analysis" why={a ? "This asset has no source video" : pickFirst} primary say={flash} />}
        {note && <T x={2272} y={1268} size={16} color="#33a8ff" align="center">{note}</T>}
      </section>

      <section aria-label="Collaborator access control" data-section="p09-s10">
        <B x={2003} y={1281} w={537} h={1} style={{ background: "#12335f" }} />
        <T x={2029} y={1311} size={22} weight={600} as="h2">Collaborators</T>
        <B x={2178} y={1297} w={36} h={30} style={{ background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6) }} />
        <T x={2196} y={1312} size={17} align="center">{a?.project ? a.project.collaborators.length : "—"}</T>
        <T x={2510} y={1310} size={18} color="#33a8ff" align="right" style={{ opacity: a?.project ? 1 : 0.6 }}>
          <button type="button" data-manage-access onClick={() => (!a ? flash(pickFirst) : !a.project ? flash(a.kind === "Folder" ? "A folder only groups items: each item keeps its own project's access" : "A match belongs to no single project: open one of its videos' projects") : setAccess(true))}
            style={{ background: "transparent", border: 0, padding: 0, color: "inherit", font: "inherit", cursor: "pointer" }}>Manage Access</button>
        </T>
        {!a?.project ? <T x={2029} y={1369} size={18} color="#8ea3bf">{a ? "Not in a project" : "Select an asset"}</T> : (
          <ul aria-label="People on this item's project" className="absolute" style={{ left: u(2029), top: u(1349 - 101), width: u(490), height: u(40), margin: 0, padding: 0, listStyle: "none", display: "flex", alignItems: "center", gap: u(8) }}>
            {a.project.collaborators.slice(0, 6).map((m) => (
              <li key={m.user_id} title={`${m.display_name} · ${PERMISSION_NAMES[m.permission]}`} aria-label={`${m.display_name}, ${PERMISSION_NAMES[m.permission]}`}
                style={{ width: u(38), height: u(38), borderRadius: "50%", background: "#2b5ff0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: u(15), fontWeight: 700 }}>
                {m.display_name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </li>
            ))}
            {a.project.collaborators.length > 6 && <li style={{ fontSize: u(16), color: "#cfe0f5" }}>+{a.project.collaborators.length - 6}</li>}
            <li style={{ fontSize: u(15), color: "#8ea3bf", marginLeft: u(6) }}>{a.project.access === "RESTRICTED" ? "🔒 only these people and Owners / Admins" : "everyone in your organization"}</li>
          </ul>
        )}
      </section>

      <AccessDialog projectId={a?.project?.id ?? null} projectName={a?.project?.name ?? ""} open={access} onOpenChange={setAccess} onChanged={reload} />
      <Dialog.Root open={naming} onOpenChange={setNaming}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-semibold">Rename</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">{a?.kind === "Folder" ? "Folder name" : a?.kind === "Project" ? "Project name" : a?.kind === "Video" ? "Video name" : "Reel name"}</Dialog.Description>
            <form onSubmit={(e) => { e.preventDefault(); void rename(); }}>
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={a?.kind === "Project" ? 2 : 1} maxLength={200} aria-label="Name"
                className="mb-3 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
              <div className="flex justify-end gap-2">
                <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">Cancel</Dialog.Close>
                <button type="submit" className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">Save</button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
