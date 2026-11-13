"use client";
/**
 * v3 Phase A.1 (S01, ADR-069), SOT rebuild 2026-11-13: the persistent context bar Project ▸ Match ▸ Player in the top bar, on every
 * shelled page (the SOT shows it on all 22). It names what the page is about, as recorded (GET /v1/context);
 * the navigation then opens the next page on the same match, player and reel. Click a chip to change it:
 *   Project  its matches (videos) are listed to choose from
 *   Match    the same page on that match; a reel page opens that match's reel (of the same player when there is one), or Analysis
 *            when the match has no reel yet (a reel is made there, from a confirmed player)
 *   Player   the players a person confirmed in this match; the Player Report opens his report, a reel page his reel in this match
 */
import { videoLabel, type ContextVideo, type WorkContext } from "@otsi-vie/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { merge, readCtx, samePageFor, showsBar, subjectOf, writeCtx, type Ctx } from "@/lib/workContext";

type Menu = "project" | "match" | "player" | null;
const qs = (o: Record<string, string | null | undefined>) => new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();

function Chip({ label, value, empty, open, onClick, testId, changeTitle }: { label: string; value: string | null; empty: string; open: boolean; onClick: () => void; testId: string; changeTitle: string }) {
  return (
    <button type="button" aria-haspopup="menu" aria-expanded={open} data-context-chip={testId} onClick={onClick} title={changeTitle}
      className={`flex h-8 max-w-[34ch] items-center gap-2 truncate rounded-md border px-2.5 text-left text-[12px] ${open ? "border-line2 bg-raised" : "border-transparent hover:border-line hover:bg-raised"}`}>
      <span className="t-th">{label}</span>
      <span className={`truncate font-normal ${value ? "text-ink" : "font-normal text-muted"}`}>{value ?? empty}</span>
      <span aria-hidden className="text-muted">▾</span>
    </button>
  );
}

export function ContextBar() {
  const { t } = useLocale();
  const path = usePathname() ?? "/";
  const q = useSearchParams();
  const router = useRouter();
  const [ctx, setCtx] = useState<WorkContext | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [browse, setBrowse] = useState<WorkContext | null>(null);        // another project's matches, while choosing
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const subject = subjectOf(path, q);
  const key = `${path}?${q.toString()}`;

  useEffect(() => {
    if (!showsBar(path)) return;
    const c = merge(readCtx(), subject);
    // a reel page names its own reel; a report page its player; without one, the last context of this browser
    const want = subject.kind === "reel" && !subject.reel && path !== "/reels" ? { ...c, reel: null } : c;
    let live = true;
    void api<WorkContext>(`/v1/context?${qs({ reel: want.reel, video: want.video, player: subject.player ?? want.player })}`).then((x) => {
      if (!live) return;
      setCtx(x);
      writeCtx({ video: x.video?.id ?? null, player: x.player ? x.player.canonical_otsi_id ?? x.player.id : null,
        reel: x.reel?.id ?? null, reelVideo: x.reel ? x.video?.id ?? null : null } satisfies Ctx);
    }, () => { if (live) setCtx(null); });
    return () => { live = false; };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMenu(null); setBrowse(null); }, [key]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) { setMenu(null); setBrowse(null); }
    };
    addEventListener("mousedown", close); addEventListener("keydown", close);
    return () => { removeEventListener("mousedown", close); removeEventListener("keydown", close); };
  }, [menu]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 6000); return () => clearTimeout(t); }, [note]);
  if (!showsBar(path)) return null;

  const say = (t: string) => setNote(t);
  const toggle = (m: Menu) => { setMenu((x) => (x === m ? null : m)); setBrowse(null); };
  const pickProject = async (id: string) => {
    if (id === ctx?.project?.id) { setMenu("match"); return; }
    setBrowse(await api<WorkContext>(`/v1/context?${qs({ project: id })}`));
    setMenu("match");
  };
  /** the same page on another match */
  const pickVideo = async (v: ContextVideo) => {
    setMenu(null); setBrowse(null);
    if (subject.kind === "reel") {
      const there = await api<WorkContext>(`/v1/context?${qs({ video: v.id, player: ctx?.player?.id })}`);
      const reel = there.choices.reels.find((r) => r.player_id === ctx?.player?.id) ?? there.choices.reels[0];
      if (reel) { router.push(samePageFor(path, { reel: reel.id }) ?? `/reels/${reel.id}`); return; }
      writeCtx({ ...readCtx(), video: v.id, reel: null, reelVideo: null });
      router.push(`/analysis?video=${v.id}`);
      say(t.body.shell.ctxNoReel.replace("{a}", videoLabel(v)));
      return;
    }
    writeCtx({ ...readCtx(), video: v.id });
    const to = samePageFor(path, { video: v.id });
    if (to) router.push(to);
    else { const n = await api<WorkContext>(`/v1/context?${qs({ video: v.id, player: ctx?.player?.id })}`); setCtx(n); say(t.body.shell.ctxMatchNote.replace("{a}", videoLabel(v))); }
  };
  const pickPlayer = (pl: WorkContext["choices"]["players"][number]) => {
    setMenu(null);
    const ref = pl.canonical_otsi_id ?? pl.id;
    writeCtx({ ...readCtx(), player: ref });
    if (subject.kind === "player") { router.push(`/reports/players/${encodeURIComponent(ref)}`); return; }
    if (subject.kind === "reel") {
      const reel = ctx?.choices.reels.find((r) => r.player_id === pl.id);
      if (reel) { router.push(samePageFor(path, { reel: reel.id }) ?? `/reels/${reel.id}`); return; }
      say(t.body.shell.ctxNoReelPlayer.replace("{a}", pl.display_name));
    }
    setCtx((c) => (c ? { ...c, player: pl } : c));
  };

  const list = browse ?? ctx;
  const item = "flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left hover:bg-raised";
  return (
    <div ref={box} role="navigation" aria-label={t.body.shell.ctxBarAria} data-context-bar
      className="relative z-20 flex flex-wrap items-center gap-1 text-xs text-[rgb(var(--ink2))]">
      <Chip label={t.body.shell.ctxProject} value={ctx?.project?.name ?? null} empty={t.body.shell.ctxNoneOpen} open={menu === "project"} onClick={() => toggle("project")} testId="project" changeTitle={t.body.shell.ctxChange.replace("{a}", t.body.shell.ctxProject)} />
      <span aria-hidden className="text-[rgb(var(--line2))]">/</span>
      <Chip label={t.body.shell.ctxMatch} value={ctx?.video ? videoLabel(ctx.video) : null} empty={t.body.shell.ctxNoneOpen} open={menu === "match"} onClick={() => toggle("match")} testId="match" changeTitle={t.body.shell.ctxChange.replace("{a}", t.body.shell.ctxMatch)} />
      <span aria-hidden className="text-[rgb(var(--line2))]">/</span>
      <Chip label={t.body.shell.ctxPlayer} value={ctx?.player?.display_name ?? null} empty={ctx?.video ? t.body.shell.ctxNoneChosen : t.body.shell.ctxNonePlayer} open={menu === "player"} onClick={() => toggle("player")} testId="player" changeTitle={t.body.shell.ctxChange.replace("{a}", t.body.shell.ctxPlayer)} />
      {note && <span role="status" className="ml-2 text-amber">{note}</span>}

      {menu && (
        <div role="menu" aria-label={t.body.shell.ctxChoose.replace("{a}", menu === "project" ? t.body.shell.ctxProject : menu === "match" ? t.body.shell.ctxMatch : t.body.shell.ctxPlayer)} data-context-menu={menu}
          className="absolute left-0 top-full mt-1 max-h-[60vh] w-[min(460px,92vw)] overflow-y-auto rounded-md border border-line2 bg-panel p-1.5 text-sm shadow-2xl">
          {menu === "project" && (ctx?.choices.projects.length ? ctx.choices.projects.map((p) => (
            <button key={p.id} role="menuitem" type="button" className={item} onClick={() => void pickProject(p.id)}>
              <span className="truncate">{p.name}</span>{p.id === ctx.project?.id && <span className="text-primary">{t.body.shell.ctxOpen}</span>}
            </button>
          )) : <p className="p-2 text-muted">{t.body.shell.ctxNoProjects}</p>)}
          {menu === "match" && (
            <>
              {browse?.project && <p className="px-2 pb-1 text-xs text-muted">{t.body.shell.ctxMatchesIn.replace("{a}", browse.project.name)}</p>}
              {list?.choices.videos.length ? list.choices.videos.map((v) => (
                <button key={v.id} role="menuitem" type="button" className={item} onClick={() => void pickVideo(v)}>
                  <span className="min-w-0 truncate">{videoLabel(v)}{v.match_label && <span className="text-muted"> · {v.title}</span>}</span>
                  <span className="shrink-0 text-xs text-muted">{v.id === ctx?.video?.id ? t.body.shell.ctxOpen : v.analysed ? t.body.shell.ctxAnalysed : t.body.shell.ctxNotAnalysed}</span>
                </button>
              )) : <p className="p-2 text-muted">{list?.project ? t.body.shell.ctxNoVideos : t.body.shell.ctxChooseProject}</p>}
            </>
          )}
          {menu === "player" && (!ctx?.video ? <p className="p-2 text-muted">{t.body.shell.ctxChooseMatch}</p>
            : ctx.choices.players.length ? ctx.choices.players.map((pl) => (
              <button key={pl.id} role="menuitem" type="button" className={item} onClick={() => pickPlayer(pl)}>
                <span className="truncate">{pl.display_name}</span>
                <span className="shrink-0 font-mono text-xs text-muted">{pl.id === ctx.player?.id ? t.body.shell.ctxOpen : pl.canonical_otsi_id ?? t.body.shell.ctxProvisional}</span>
              </button>
            )) : <p className="p-2 text-muted">{t.body.shell.ctxNoPlayer}</p>)}
        </div>
      )}
    </div>
  );
}
