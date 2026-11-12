"use client";
/**
 * Page 06 Reel Info → Music (ADR-047): choose the music under the reel, or upload one with its rights declaration (like the logos: no music
 * without the right to use it), listen to it, and set how loud it is and how loud the match sound stays under it. The choice is part of
 * the reel's look: Save Project / Generate Reel send it, and the render mixes it under every clip.
 */
import { MUSIC_MAX_BYTES, MUSIC_TYPES, type BrandAsset, type BrandRightsBasis, type SpotlightSettings } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api, apiBlob } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { BeatStatusRow } from "@/components/studio/BeatGridInfo";

const BASIS: BrandRightsBasis[] = ["OWN_BRAND", "LICENSED", "FREE_LICENCE", "PERMISSION"];
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
  const { t: dict } = useLocale();
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  if (src) return <audio src={src} controls autoPlay className="h-8 w-full" aria-label={dict.body.reelstage.listenAria} />;
  return <button type="button" disabled={busy} onClick={() => { setBusy(true); void apiBlob(`/v1/brand-assets/${id}/file`).then((b) => setSrc(URL.createObjectURL(b)), () => setBusy(false)); }}
    className="rounded-ctl border border-[#1e90ff]/60 px-2 py-1 text-xs">{busy ? dict.common.loading : dict.body.reelstage.listenBtn}</button>;
}

export function MusicPicker({ settings, onChange, onClose }: { settings: SpotlightSettings; onChange(s: SpotlightSettings): void; onClose(): void }) {
  const { t: dict } = useLocale();
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
  const fileErr = file && file.size > MUSIC_MAX_BYTES ? dict.body.reelstage.musicTooBig : file && !type ? dict.body.reelstage.musicWrongType : null;
  const basisWords: Record<BrandRightsBasis, string> = { OWN_BRAND: dict.body.reelstage.basisOwnMusic, LICENSED: dict.body.reelstage.basisLicensed, FREE_LICENCE: dict.body.reelstage.basisFree, PERMISSION: dict.body.reelstage.basisPermission };
  const licenceWords: Record<BrandRightsBasis, string> = { OWN_BRAND: dict.body.reelstage.licenceNoteOwn, LICENSED: dict.body.reelstage.licenceNoteLicensed, FREE_LICENCE: dict.body.reelstage.licenceNoteFree, PERMISSION: dict.body.reelstage.licenceNotePermission };
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
    } catch (e) { setErr(e instanceof Error ? e.message : dict.body.reelstage.logoUploadFail); } finally { setBusy(false); }
  };
  const field = "w-full rounded-ctl border border-[#17406f] bg-[#041022] px-2 py-1.5 t-body";
  const chosen = list?.find((m) => m.id === settings.music_id) ?? null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div role="dialog" aria-modal="true" aria-label={dict.body.reelstage.chooseMusic} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-[min(560px,94vw)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#1e90ff] bg-[#071a33] p-4 text-[#e3eefb]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="t-section">{dict.body.reelstage.musicForReel}</h2>
          <button type="button" aria-label={dict.common.close} onClick={onClose} className="px-2 t-panel">✕</button></div>
        <button type="button" data-pick-music="" onClick={() => onChange({ ...settings, music_id: null })}
          className={`rounded-ctl border px-3 py-2 text-left t-body ${settings.music_id ? "border-[#1e90ff]/40" : "border-ok bg-ok/10"}`}>{dict.body.reelstage.noMusic}</button>
        {list === null ? <p className="t-body text-[#8ea3bf]">{dict.common.loading}</p> : list.length > 0 && (
          <ul className="flex flex-col gap-2">{list.map((m) => (
            <li key={m.id} className={`flex flex-col gap-1 rounded-ctl border px-3 py-2 ${m.id === settings.music_id ? "border-ok bg-ok/10" : "border-[#1e90ff]/60 bg-[#0b2a52]"}`}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1"><span className="block truncate t-panel">{m.name}</span>
                  <span className="block truncate text-xs text-[#8ea3bf]">{m.rights_ok ? dict.body.reelstage.logoRights.replace("{a}", m.rights_holder) : dict.body.reelstage.logoRightsNotOk}</span></span>
                <button type="button" data-pick-music={m.id} disabled={!m.rights_ok || m.id === settings.music_id} onClick={() => onChange({ ...settings, music_id: m.id })}
                  className="rounded-ctl border border-ok/60 bg-ok/15 px-3 py-1 t-panel disabled:opacity-50">{m.id === settings.music_id ? dict.body.reelstage.chosenBtn : dict.body.reelstage.useBtn}</button>
              </div>
              {m.rights_ok && <p className="text-xs text-[#f5d38a]" data-licence-note={m.rights_basis}>{licenceWords[m.rights_basis].replace("{a}", m.rights_holder)}</p>}
              <Listen id={m.id} />
              {m.rights_ok && <BeatStatusRow musicId={m.id} canEdit={true} />}
            </li>))}
          </ul>)}
        <p className="text-xs text-[#8ea3bf]">{dict.body.reelstage.beatLibraryNote}</p>
        {chosen && (
          <div className="flex flex-col gap-2 rounded-ctl border border-[#12335f] p-3 t-body">
            <label className="flex items-center gap-2">{dict.body.reelstage.musicVolume} <input type="range" min={0} max={1} step={0.05} value={settings.music_volume} aria-label={dict.body.reelstage.musicVolume}
              onChange={(e) => onChange({ ...settings, music_volume: Number(e.target.value) })} className="flex-1" /><span className="w-10 text-right">{pct(settings.music_volume)}</span></label>
            <label className="flex items-center gap-2">{dict.body.reelstage.matchSoundUnder} <input type="range" min={0} max={1} step={0.05} value={settings.match_volume} aria-label={dict.body.reelstage.matchSoundUnder}
              onChange={(e) => onChange({ ...settings, match_volume: Number(e.target.value) })} className="flex-1" /><span className="w-10 text-right">{pct(settings.match_volume)}</span></label>
            <p className="text-xs text-[#8ea3bf]">{dict.body.reelstage.musicMixNote}</p>
          </div>
        )}
        <div className="flex flex-col gap-2 rounded-ctl border border-[#12335f] p-3">
          <p className="t-panel">{dict.body.reelstage.uploadMusic}</p>
          <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" aria-label={dict.body.reelstage.musicFileAria} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="t-body" />
          {fileErr && <p className="text-xs text-[#ff8a8a]">{fileErr}</p>}
          <input className={field} placeholder={dict.body.reelstage.musicNamePlaceholder} aria-label={dict.body.reelstage.musicNameAria} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <input className={field} placeholder={dict.body.reelstage.musicHolderPlaceholder} aria-label={dict.body.reelstage.musicHolderAria} value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="off" />
          <select className={field} aria-label={dict.body.reelstage.musicBasisAria} value={basis} onChange={(e) => setBasis(e.target.value as BrandRightsBasis)}>
            <option value="">{dict.body.reelstage.logoBasisEmpty}</option>{BASIS.map((v) => <option key={v} value={v}>{basisWords[v]}</option>)}
          </select>
          <label className="flex items-start gap-2 t-body"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-1" />
            <span>{dict.body.reelstage.musicConfirm}</span></label>
          {err && <p className="text-xs text-[#ff8a8a]">{err}</p>}
          <button type="button" data-upload-music="" disabled={!ready} onClick={() => void upload()}
            className="rounded-ctl border border-ok/60 bg-ok/15 px-3 py-2 t-panel hover:bg-ok/25 disabled:opacity-50">{busy ? dict.body.reelstage.logoUploading : dict.body.reelstage.logoUploadUse}</button>
          <p className="text-xs text-[#8ea3bf]">{dict.body.reelstage.musicFormatNote}</p>
        </div>
        <button type="button" onClick={onClose} className="self-end rounded-ctl border border-[#1e90ff] px-4 py-1.5 t-panel">{dict.body.upload.done}</button>
        <p className="text-xs text-[#8ea3bf]">{dict.body.reelstage.saveReminder}</p>
      </div>
    </div>
  );
}
