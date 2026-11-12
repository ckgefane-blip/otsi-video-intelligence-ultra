"use client";
/**
 * v3 Phase B.22 (ADR-097): the export preset library. Built-in presets, the organization's (saved and deleted by an owner or admin) and
 * the member's own. A new preset is the files to make (the reel in any of its four frames, the scout, social and archive cuts), the
 * loudness, and optionally the format and quality chosen on the page now (GET / POST / DELETE /v1/export-presets).
 */
import * as Dialog from "@radix-ui/react-dialog";
import { LOUDNESS_TARGETS, type ExportOutput, type ExportPreset } from "@otsi-vie/contracts";
import { useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

const CHOICES: [string, ExportOutput][] = [["Reel 16:9", { profile: "REEL", aspect: "16:9" }], ["Reel 9:16", { profile: "REEL", aspect: "9:16" }],
  ["Reel 1:1", { profile: "REEL", aspect: "1:1" }], ["Reel 4:5", { profile: "REEL", aspect: "4:5" }], ["Reel in its own frame", { profile: "REEL", aspect: null }],
  ["Scout cut 16:9", { profile: "SCOUT", aspect: null }], ["Social cut 9:16", { profile: "SOCIAL", aspect: null }], ["Archive master", { profile: "ARCHIVE", aspect: null }]];
const SCOPE: Record<string, string> = { BUILT_IN: "Built in", ORGANIZATION: "Organization", PERSONAL: "Mine" };
export const describeOutputs = (outs: ExportOutput[]) => outs.map((o) => CHOICES.find(([, c]) => c.profile === o.profile && c.aspect === o.aspect)?.[0] ?? o.profile).join(", ");

export function PresetLibrary({ presets, canAdmin, canSave, codec, bitrate, open, onOpenChange, reload, choose }: {
  presets: ExportPreset[]; canAdmin: boolean; canSave: boolean; codec: string; bitrate: number; open: boolean; onOpenChange(o: boolean): void;
  reload(): Promise<void>; choose(id: string): void;
}) {
  const { t: dict } = useLocale();
  const [name, setName] = useState(""), [scope, setScope] = useState<"PERSONAL" | "ORGANIZATION">("PERSONAL");
  const [picked, setPicked] = useState<Set<number>>(new Set([4])), [lufs, setLufs] = useState<number | null>(null), [withFormat, setWithFormat] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const save = async () => {
    setMsg(null);
    if (!name.trim()) return setMsg("Give the preset a name.");
    if (!picked.size) return setMsg("Choose at least one file.");
    try {
      const p = await api<ExportPreset>("/v1/export-presets", { method: "POST", json: { name: name.trim(), scope, spec: {
        outputs: [...picked].sort((a, b) => a - b).map((i) => CHOICES[i]![1]), loudness_lufs: lufs, codec: withFormat ? codec : null, bitrate_mbps: withFormat ? bitrate : null } } });
      setName(""); await reload(); choose(p.id); setMsg(`Saved "${p.name}" and chose it.`);
    } catch (x) { setMsg(x instanceof ApiProblem ? x.message : "The preset could not be saved."); }
  };
  const remove = async (p: ExportPreset) => {
    try { await api(`/v1/export-presets/${p.id}`, { method: "DELETE" }); await reload(); setMsg(`Deleted "${p.name}".`); }
    catch (x) { setMsg(x instanceof ApiProblem ? x.message : "The preset could not be deleted."); }
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="preset-library" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(640px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-xl">
          <Dialog.Title className="text-base font-normal">{dict.body.exports.exportPresets}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">Choose a preset, or save which files you want as a new one.</Dialog.Description>
          <ul className="mb-4 space-y-1.5" data-preset-list>
            {presets.map((p) => (
              <li key={p.id} data-preset={p.id} data-scope={p.scope} className="flex items-start gap-2">
                <button type="button" onClick={() => { choose(p.id); onOpenChange(false); }} className="flex-1 text-left">
                  <span className="font-normal">{p.name}</span> <span className="rounded bg-raised px-1.5 text-xs text-muted">{SCOPE[p.scope]}</span>
                  <span className="block text-xs text-muted">{p.note || describeOutputs(p.spec.outputs)}{p.spec.loudness_lufs !== null ? ` · ${p.spec.loudness_lufs} LUFS` : ""}</span>
                </button>
                {p.can_delete && <button type="button" data-preset-delete={p.id} aria-label={`Delete the preset ${p.name}`} onClick={() => void remove(p)} className="rounded border border-line px-2">×</button>}
              </li>
            ))}
          </ul>
          {canSave ? (
            <fieldset className="space-y-2 rounded border border-line p-3" data-preset-new>
              <legend className="px-1 text-xs text-muted">{dict.body.exports.newPreset}</legend>
              <input aria-label="Preset name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Club socials" className="w-full rounded border border-line bg-raised px-2 py-1" />
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {CHOICES.map(([l], i) => (
                  <label key={l} className="flex items-center gap-1"><input type="checkbox" data-preset-output={i} checked={picked.has(i)} onChange={() => toggle(i)} />{l}</label>
                ))}
              </div>
              <label className="flex items-center gap-2">Loudness
                <select aria-label="Loudness" value={String(lufs)} onChange={(e) => setLufs(e.target.value === "null" ? null : Number(e.target.value))} className="rounded border border-line bg-raised px-1">
                  {LOUDNESS_TARGETS.map((t) => <option key={String(t.lufs)} value={String(t.lufs)}>{t.lufs === null ? "The reel's own, else each file's level" : t.label}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={withFormat} onChange={() => setWithFormat(!withFormat)} />Keep the format and quality chosen now</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1"><input type="radio" name="scope" checked={scope === "PERSONAL"} onChange={() => setScope("PERSONAL")} />Just for me</label>
                <label className="flex items-center gap-1" title={canAdmin ? undefined : "Only an owner or admin can share a preset with everyone"}>
                  <input type="radio" name="scope" disabled={!canAdmin} checked={scope === "ORGANIZATION"} onChange={() => setScope("ORGANIZATION")} />For the organization</label>
                <button type="button" data-preset-save onClick={() => void save()} className="ml-auto rounded bg-primary px-3 py-1 font-normal text-white">{dict.body.exports.savePreset}</button>
              </div>
            </fieldset>
          ) : <p className="text-xs text-muted">Your role can choose presets, not save them.</p>}
          {msg && <p className="mt-2 text-xs" data-preset-msg>{msg}</p>}
          <div className="mt-3 flex justify-end"><Dialog.Close className="rounded border border-line px-3 py-1.5">Close</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
