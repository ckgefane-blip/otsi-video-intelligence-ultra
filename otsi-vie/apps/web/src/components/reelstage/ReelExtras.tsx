"use client";
/**
 * Page 06 Branding → "Intro, outro, tags" (ADR-050, owner 2026-11-02): the event tags written on each clip, the opening match card, and an
 * intro / outro video the organization uploads with its rights declaration (like the logos and the music: none without the right to use
 * it). The choice is part of the reel's look: Save Project / Generate Reel send it, and the render plays the intro first, then the match
 * card, the clips (each with its tag), the end screen and the outro.
 */
import { VIDEO_MAX_BYTES, VIDEO_MAX_S, VIDEO_TYPES, type BrandAsset, type BrandRightsBasis, type SpotlightSettings } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api, apiBlob } from "@/lib/api";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { useLocale } from "@/lib/i18n";

const BASIS: BrandRightsBasis[] = ["OWN_BRAND", "LICENSED", "FREE_LICENCE", "PERMISSION"];
const BY_EXT: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

function typeOf(f: File): string | null {
  if ((VIDEO_TYPES as readonly string[]).includes(f.type)) return f.type;
  return BY_EXT[f.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** the organization's intro / outro videos, loaded once per change */
export function useReelVideos(): [BrandAsset[] | null, () => void] {
  const [list, setList] = useState<BrandAsset[] | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => { void api<BrandAsset[]>("/v1/brand-assets?kind=REEL_VIDEO").then(setList, () => setList([])); }, [n]);
  return [list, () => setN((x) => x + 1)];
}

/** watch one uploaded video (fetched with the user's session) */
function Watch({ id }: { id: string }) {
  const { t: dict } = useLocale();
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  if (src) return <VideoPlayer src={src} autoPlay label={dict.body.reelstage.watchAria} className="max-h-40 w-full" />;
  return <button type="button" disabled={busy} onClick={() => { setBusy(true); void apiBlob(`/v1/brand-assets/${id}/file`).then((b) => setSrc(URL.createObjectURL(b)), () => setBusy(false)); }}
    className="rounded-ctl border border-[#1e90ff]/60 px-2 py-1 t-small">{busy ? dict.common.loading : dict.body.reelstage.watchBtn}</button>;
}

function Switch({ on, label, note, onFlip }: { on: boolean; label: string; note: string; onFlip(): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onFlip} className="flex items-start gap-3 rounded-ctl border border-[#12335f] p-3 text-left">
      <span className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 ${on ? "bg-[#1e90ff]" : "bg-[#17406f]"}`}>
        <span className={`h-4 w-4 rounded-full bg-white transition-transform ${on ? "translate-x-4" : ""}`} /></span>
      <span><span className="block t-body font-normal">{label}</span><span className="block text-xs text-[#8ea3bf]">{note}</span></span>
    </button>
  );
}

export function ReelExtras({ settings, onChange, onClose }: { settings: SpotlightSettings; onChange(s: SpotlightSettings): void; onClose(): void }) {
  const { t: dict } = useLocale();
  const [list, reload] = useReelVideos();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [holder, setHolder] = useState("");
  const [basis, setBasis] = useState<BrandRightsBasis | "">("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const type = file ? typeOf(file) : null;
  const fileErr = file && file.size > VIDEO_MAX_BYTES ? dict.body.reelstage.videoTooBig : file && !type ? dict.body.reelstage.videoWrongType : null;
  const basisWords: Record<BrandRightsBasis, string> = { OWN_BRAND: dict.body.reelstage.basisOwnVideo, LICENSED: dict.body.reelstage.basisLicensed, FREE_LICENCE: dict.body.reelstage.basisFree, PERMISSION: dict.body.reelstage.basisPermission };
  const ready = !!file && !fileErr && name.trim().length > 0 && holder.trim().length >= 2 && !!basis && ok && !busy;
  const upload = async () => {
    if (!file || !basis || !type) return;
    setBusy(true); setErr(null);
    try {
      const meta = b64url(JSON.stringify({ name: name.trim(), rights_holder: holder.trim(), rights_basis: basis, confirm_rights: true }));
      await api<BrandAsset>("/v1/brand-assets/video", { method: "POST", body: file, headers: { "content-type": type, "x-asset-meta": meta } });
      reload();
      setFile(null); setName(""); setHolder(""); setBasis(""); setOk(false);
    } catch (e) { setErr(e instanceof Error ? e.message : dict.body.reelstage.logoUploadFail); } finally { setBusy(false); }
  };
  const field = "w-full rounded-ctl border border-[#17406f] bg-[#041022] px-2 py-1.5 t-body";
  const nameOf = (id: string | null) => (id ? (list?.find((v) => v.id === id)?.name ?? dict.body.reelstage.chosenFallback) : dict.body.reelstage.noneFallback);
  const pick = (side: "intro_id" | "outro_id", id: string | null) => onChange({ ...settings, [side]: id });
  return (
    <div role="dialog" aria-modal="true" aria-label={dict.body.reelstage.extrasAria} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-[min(600px,94vw)] flex-col gap-3 overflow-y-auto rounded-xl border border-[#1e90ff] bg-[#071a33] p-4 text-[#e3eefb]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="t-panel font-normal">{dict.body.reelstage.extrasAria}</h2>
          <button type="button" aria-label={dict.common.close} onClick={onClose} className="px-2 t-panel">✕</button></div>
        <Switch on={settings.event_tags} label={dict.body.reelstage.eventTags} onFlip={() => onChange({ ...settings, event_tags: !settings.event_tags })}
          note={dict.body.reelstage.eventTagsNote} />
        <Switch on={settings.match_card} label={dict.body.reelstage.matchCard} onFlip={() => onChange({ ...settings, match_card: !settings.match_card })}
          note={dict.body.reelstage.matchCardNote} />
        <Switch on={settings.profile_intro} label={dict.body.reels.profileIntroLabel} onFlip={() => onChange({ ...settings, profile_intro: !settings.profile_intro })}
          note={dict.body.reelstage.profileIntroNote2} />
        <div className="flex flex-col gap-1 rounded-ctl border border-[#12335f] p-3 t-body">
          <p><span className="font-normal">{dict.body.reelstage.introLabel}</span> {nameOf(settings.intro_id)} {settings.intro_id && <button type="button" onClick={() => pick("intro_id", null)} className="ml-2 text-xs text-[#33a8ff] underline">{dict.body.reelstage.noIntro}</button>}</p>
          <p><span className="font-normal">{dict.body.reelstage.outroLabel}</span> {nameOf(settings.outro_id)} {settings.outro_id && <button type="button" onClick={() => pick("outro_id", null)} className="ml-2 text-xs text-[#33a8ff] underline">{dict.body.reelstage.noOutro}</button>}</p>
        </div>
        {list === null ? <p className="t-body text-[#8ea3bf]">{dict.common.loading}</p> : list.length > 0 && (
          <ul className="flex flex-col gap-2">{list.map((v) => (
            <li key={v.id} className={`flex flex-col gap-1 rounded-ctl border px-3 py-2 ${v.id === settings.intro_id || v.id === settings.outro_id ? "border-ok bg-ok/10" : "border-[#1e90ff]/60 bg-[#0b2a52]"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1"><span className="block truncate t-body font-normal">{v.name}</span>
                  <span className="block truncate text-xs text-[#8ea3bf]">{v.rights_ok ? dict.body.reelstage.logoRights.replace("{a}", v.rights_holder) : dict.body.reelstage.logoRightsNotOk}</span></span>
                <button type="button" data-use-intro={v.id} disabled={!v.rights_ok || v.id === settings.intro_id} onClick={() => pick("intro_id", v.id)}
                  className="rounded-ctl border border-ok/60 bg-ok/15 px-3 py-1 t-body font-normal disabled:opacity-50">{v.id === settings.intro_id ? dict.body.reelstage.introCheck : dict.body.reelstage.useAsIntro}</button>
                <button type="button" data-use-outro={v.id} disabled={!v.rights_ok || v.id === settings.outro_id} onClick={() => pick("outro_id", v.id)}
                  className="rounded-ctl border border-ok/60 bg-ok/15 px-3 py-1 t-body font-normal disabled:opacity-50">{v.id === settings.outro_id ? dict.body.reelstage.outroCheck : dict.body.reelstage.useAsOutro}</button>
              </div>
              <Watch id={v.id} />
            </li>))}
          </ul>)}
        <div className="flex flex-col gap-2 rounded-ctl border border-[#12335f] p-3">
          <p className="t-body font-normal">{dict.body.reelstage.uploadVideoTitle}</p>
          <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm" aria-label={dict.body.reelstage.videoFileAria} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="t-body" />
          {fileErr && <p className="text-xs text-[#ff8a8a]">{fileErr}</p>}
          <input className={field} placeholder={dict.body.reelstage.videoNamePlaceholder} aria-label={dict.body.reelstage.videoNameAria} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          <input className={field} placeholder={dict.body.reelstage.videoHolderPlaceholder} aria-label={dict.body.reelstage.videoHolderAria} value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="off" />
          <select className={field} aria-label={dict.body.reelstage.videoBasisAria} value={basis} onChange={(e) => setBasis(e.target.value as BrandRightsBasis)}>
            <option value="">{dict.body.reelstage.logoBasisEmpty}</option>{BASIS.map((v) => <option key={v} value={v}>{basisWords[v]}</option>)}
          </select>
          <label className="flex items-start gap-2 t-body"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} className="mt-1" />
            <span>{dict.body.reelstage.videoConfirm}</span></label>
          {err && <p className="text-xs text-[#ff8a8a]">{err}</p>}
          <button type="button" data-upload-video="" disabled={!ready} onClick={() => void upload()}
            className="rounded-ctl border border-ok/60 bg-ok/15 px-3 py-2 t-body font-normal hover:bg-ok/25 disabled:opacity-50">{busy ? dict.body.reelstage.logoUploading : dict.body.reelstage.uploadBtn}</button>
          <p className="text-xs text-[#8ea3bf]">{dict.body.reelstage.videoFormatNote.replace("{a}", String(VIDEO_MAX_S))}</p>
        </div>
        <button type="button" onClick={onClose} className="self-end rounded-ctl border border-[#1e90ff] px-4 py-1.5 t-body font-normal">{dict.body.upload.done}</button>
        <p className="text-xs text-[#8ea3bf]">{dict.body.reelstage.saveReminder}</p>
      </div>
    </div>
  );
}
