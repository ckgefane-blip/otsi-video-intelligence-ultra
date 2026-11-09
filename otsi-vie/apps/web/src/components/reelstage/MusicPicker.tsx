"use client";
/**
 * Page 06 Reel Info → Music (ADR-047): choose the music under the reel, or upload one with its rights declaration (like the logos: no music
 * without the right to use it), listen to it, and set how loud it is and how loud the match sound stays under it. The choice is part of
 * the reel's look: Save Project / Generate Reel send it, and the render mixes it under every clip.
 */
import { BEAT_LIBRARY_NOTE, MUSIC_MAX_BYTES, MUSIC_TYPES, musicLicenceNote, type BrandAsset, type BrandRightsBasis, type SpotlightSettings } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api, apiBlob } from "@/lib/api";
import { BeatStatusRow } from "@/components/studio/BeatGridInfo";

const BASIS: [BrandRightsBasis, string][] = [["OWN_BRAND", "It is our own music"], ["LICENSED", "We have a licence for it"],
  ["FREE_LICENCE", "A free licence allows it (e.g. Creative Commons BY)"], ["PERMISSION", "The owner gave us written permission"]];
const BY_EXT: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac" };

/** the content type to send: the browser's, or from the file name when the browser does not know it */
function typeOf(f: File): string | null {
  if ((MUSIC_TYPES as readonly string[]).includes(f.type)) return f.type;
  return BY_EXT[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** the organization's music (rights in force or not), loaded once per change */
export function useMusic(): [BrandAsset[] | null, () => void] {
  const [list, setList] = useState<BrandAsset[] | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => { void api<BrandAsset[]>("/v1/brand-assets?kind=MUSIC").then(setList, () => setList([])); }, [n]);
  return [list, () => setN((x) => x + 1)];
}

/** play one uploaded tune (fetched with the user's session) */
function Listen({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  if (src) return <audio src={src} controls autoPlay className="h-8 w-full" aria-label="Listen to the music" />;
  return <button type="button" disabled={busy} onClick={() => { setBusy(true); void apiBlob(`/v1/brand-assets/${id}/file`).then((b) => setSrc(URL.createObjectURL(b)), () => setBusy(false)); }}
    className="rounded-ctl border border-[#1e90ff]/60 px-2 py-1 text-xs">{busy ? "Loading…" : "▶ Listen"}</button>;
}

export function MusicPicker({ settings, onChange, onClose }: { settings: SpotlightSettings; onChange(s: SpotlightSettings): void; onClose(): void }) {
  const [list, reload] = useMusic();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [holder, setHolder] = useState("");
  const [basis, setBasis] = useState<BrandRightsBasis | "">("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const type = file ? typeOf(file) : null;
  const fileErr = file && file.size > MUSIC_MAX_BYTES ? "The music file is larger than 25 MB." : file && !type ? "Choose an MP3, WAV, M4A, OGG or FLAC file." : null;
  const ready = !!file && !fileErr && name.trim().length > 0 && holder.trim().length >= 2 && !!basis && ok && !busy;
  const upload = async () => {
    if (!file || !basis || !type) return;
    setBusy(true); setErr(null);
    try {
      const meta = b64url(JSON.stringify({ name: name.trim(), rights_holder: holder.trim(), rights_basis: basis, confirm_rights: true }));
      const a = await api<BrandAsset>("/v1/brand-assets/music", { method: "POST", body: file, headers: { "content-type": type, "x-asset-meta": meta } });
      reload();
      onChange({ ...settings, music_id: a.id });
      setFile(null); setName(""); setHolder(""); setBasis(""); setOk(false);
    } catch (e) { setErr(e instanceof Error ? e.message : "The upload failed."); } finally { setBusy(false); }
  };
  const field = "w-full rounded-ctl border border-[#17406f] bg-[#041022] px-2 py-1.5 text-sm";
  const chosen = list?.find((m) => m.id === settings.music_id) ?? null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div role="dialog" aria-modal="true" aria-label="Choose music" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-[min(560px,94vw)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#1e90ff] bg-[#071a33] p-4 text-[#e3eefb]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Music for this reel</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="px-2 text-lg">✕</button></div>
        <button type="button" data-pick-music="" onClick={() => onChange({ ...settings, music_id: null })}
          className={`rounded-ctl border px-3 py-2 text-left text-sm ${settings.music_id ? "border-[#1e90ff]/40" : "border-ok bg-ok/10"}`}>No music: the match sound of the clips</button>
        {list === null ? <p className="text-sm text-[#8ea3bf]">Loading…</p> : list.length > 0 && (
          <ul className="flex flex-col gap-2">{list.map((m) => (
            <li key={m.id} className={`flex flex-col gap-1 rounded-ctl border px-3 py-2 ${m.id === settings.music_id ? "border-ok bg-ok/10" : "border-[#1e90ff]/60 bg-[#0b2a52]"}`}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.name}</span>
                  <span className="block truncate text-xs text-[#8ea3bf]">{m.rights_ok ? `Rights: ${m.rights_holder}` : "Rights not in force"}</span></span>
                <button type="button" data-pick-music={m.id} disabled={!m.rights_ok || m.id === settings.music_id} onClick={() => onChange({ ...settings, music_id: m.id })}
                  className="rounded-ctl border border-ok/60 bg-ok/15 px-3 py-1 text-sm font-semibold disabled:opacity-50">{m.id === settings.music_id ? "Chosen" : "Use"}</button>
              </div>
              {m.rights_ok && <p className="text-xs text-[#f5d38a]" data-licence-note={m.rights_basis}>{musicLicenceNote(m.rights_basis, m.rights_holder)}</p>}
              <Listen id={m.id} />
              {m.rights_ok && <BeatStatusRow musicId={m.id} canEdit={true} />}
            </li>))}
          </ul>)}
        <p className="text-xs text-[#8ea3bf]">{BEAT_LIBRARY_NOTE}</p>
        {chosen && (
          <div className="flex flex-col gap-2 rounded-ctl border border-[#12335f] p-3 text-sm">
            <label className="flex items-center gap-2">Music volume <input type="range" min={0} max={1} step={0.05} value={settings.music_volume} aria-label="Music volume"
              onChange={(e) => onChange({ ...settings, music_volume: Number(e.target.value) })} className="flex-1" /><span className="w-10 text-right">{pct(settings.music_volume)}</span></label>
            <label className="flex items-center gap-2">Match sound under it <input type="range" min={0} max={1} step={0.05} value={settings.match_volume} aria-label="Match sound under the music"
              onChange={(e) => onChange({ ...settings, match_volume: Number(e.target.value) })} className="flex-1" /><span className="w-10 text-right">{pct(settings.match_volume)}</span></label>
            <p className="text-xs text-[#8ea3bf]">The music plays under the whole reel (repeated if shorter), fading out at the end. 0% match sound: the music only.</p>
          </div>
        )}
        <div className="flex flex-col gap-2 rounded-ctl border border-[#12335f] p-3">
          <p className="text-sm font-semibold">Upload music</p>
          <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" aria-label="Music file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          {fileErr && <p className="text-xs text-[#ff8a8a]">{fileErr}</p>}
          <input className={field} placeholder="Name, e.g. Club anthem" aria-label="Music name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <input className={field} placeholder="Who owns this music?" aria-label="Music rights holder" value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="off" />
          <select className={field} aria-label="Why you may use the music" value={basis} onChange={(e) => setBasis(e.target.value as BrandRightsBasis)}>
            <option value="">Why may you use it?</option>{BASIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-1" />
            <span>I confirm we have the right to use this music in our reels.</span></label>
          {err && <p className="text-xs text-[#ff8a8a]">{err}</p>}
          <button type="button" data-upload-music="" disabled={!ready} onClick={() => void upload()}
            className="rounded-ctl border border-ok/60 bg-ok/15 px-3 py-2 text-sm font-semibold hover:bg-ok/25 disabled:opacity-50">{busy ? "Uploading…" : "Upload and use"}</button>
          <p className="text-xs text-[#8ea3bf]">MP3, WAV, M4A, OGG or FLAC, up to 25 MB. Your statement is recorded with your name.</p>
        </div>
        <button type="button" onClick={onClose} className="self-end rounded-ctl border border-[#1e90ff] px-4 py-1.5 text-sm font-semibold">Done</button>
        <p className="text-xs text-[#8ea3bf]">Then press Save Project (or Generate Reel) to keep the choice.</p>
      </div>
    </div>
  );
}
