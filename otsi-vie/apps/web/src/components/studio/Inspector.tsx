"use client";
/**
 * Page 07 Section 04 — clip inspector (approved reference 07_CLIP_STUDIO, "inspector").
 *
 * The selected reel clip (else the Media Bin moment being previewed, else the reel clip under the playhead, v3 Phase 0 P16) as recorded:
 * its label, origin (engine suggestion or manual), length and source in/out;
 * Player is the reel's player, named only because a person confirmed the identity; Match is the source video's linked match. Event
 * type is the engine's main event of his inside the clip (GET /v1/videos/:id/events; a goal before a shot before a key pass...), or says
 * none was detected. AI Insights lists every engine event inside the clip, his marked, each as Detected / Inferred (engine readings, not
 * reviewed). Tags are not stored for clips yet ("No tags"). Notes are real (GET/POST /v1/reels/:id/notes):
 * the clip's notes are those pinned inside its in/out; a new note is pinned at the playhead (or the clip's start). The timestamp field
 * trims the selected clip (source time, seconds). Adjustments (E2, ADR-065, Adjustments.tsx): the clip's speed effect, strap and caption,
 * spotlight, reframe, sound; E5 (ADR-068) look, zoom, drawings and reviewers' comments.
 */
import type { Match, MatchEvents, Video } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import type { ReelState } from "@/components/reels/ReelBuilder";
import { api } from "@/lib/api";
import { getDictionary, useLocale, type Dictionary } from "@/lib/i18n";
import { tc, type Ui } from "./kit";
import { locate, type Studio } from "./useStudio";
import { Adjustments } from "./Adjustments";
import { ProjectInfo } from "./ProjectInfo";
import { NOT_YET } from "@/lib/devMode";

const field = { background: "#06142a", borderRadius: 6 };

/** one engine event inside a clip: what, when, whether it is the reel player's, and how sure the engine is */
interface Insight { at: number; label: string; his: boolean; rank: number; evidence: string }

/** the events of the source video inside [a, b], his first by importance (rank: lower is more important) */
export function insightsIn(ev: MatchEvents | null, a: number, b: number, player: string | null, tracks: Set<string>, d?: Dictionary): Insight[] {
  const dict = d ?? getDictionary("en");
  const SP: Record<string, string> = { KICK_OFF: dict.body.studio.kickOff, PENALTY: dict.body.studio.penalty, CORNER: dict.body.studio.corner, GOAL_KICK: dict.body.studio.goalKick, THROW_IN: dict.body.studio.throwIn, FREE_KICK: dict.body.studio.freeKick };
  if (!ev) return [];
  const him = (pl: string | null | undefined, t: string | null | undefined) => (!!player && pl === player) || (!!t && tracks.has(t));
  const inside = (t: number) => t >= a && t <= b;
  const out: Insight[] = [];
  for (const g of ev.goals) if (inside(g.start_us) || inside(g.scoreboard_us)) out.push({ at: g.start_us, label: dict.body.studio.goalLabel.replace("{a}", String(g.score[0])).replace("{b}", String(g.score[1])), his: him(g.player_id, g.track_id), rank: 0, evidence: "DETECTED" });
  for (const s of ev.shots) if (inside(s.at_us)) out.push({ at: s.at_us, label: dict.body.studio.shotLabelTitle, his: him(s.player_id, s.track_id), rank: 1, evidence: s.evidence });
  for (const p of ev.passes) {
    if (!inside(p.start_us)) continue;
    const from = him(p.from_player_id, p.from_track_id), to = him(p.to_player_id, p.to_track_id);
    const len = p.length_m != null ? dict.body.studio.passLengthM.replace("{a}", String(Math.round(p.length_m))) : "";
    out.push({ at: p.start_us, label: to && !from ? dict.body.studio.passReceived + len : (p.key ? dict.body.studio.keyPassLabel : dict.body.studio.passLabel) + len, his: from || to, rank: from ? (p.key ? 2 : 3) : 7, evidence: p.evidence });
  }
  for (const c of ev.changes) if (inside(c.at_us)) out.push({ at: c.at_us, label: c.how ? dict.body.studio.ballWonPossible.replace("{a}", c.how === "TACKLE" ? dict.body.studio.tackleWord : dict.body.studio.interceptionWord) : dict.body.studio.ballWonLabel,
    his: him(c.won_player_id, c.won_track_id), rank: 4, evidence: c.evidence });
  for (const p of ev.pressures) if (inside(p.start_us)) out.push({ at: p.start_us, label: p.regain ? dict.body.studio.pressureWon : dict.body.studio.pressureLabel, his: him(p.presser_player_id, p.presser_track_id), rank: 5, evidence: "DETECTED" });
  for (const s of ev.set_pieces) if (inside(s.at_us)) out.push({ at: s.at_us, label: s.kind ? SP[s.kind] ?? dict.body.studio.setPieceLabel : dict.body.studio.setPieceLabel, his: him(s.player_id, s.track_id), rank: 6, evidence: "DETECTED" });
  return out.sort((x, y) => x.at - y.at);
}

/** the clip's event type: his most important event inside it */
const mainOf = (list: Insight[]) => list.filter((i) => i.his).sort((x, y) => x.rank - y.rank || x.at - y.at)[0] ?? null;

export function Inspector({ r, st, ui }: { r: ReelState | null; st: Studio; ui: Ui }) {
  const { t: dict } = useLocale();
  const tab = st.inspTab, setTab = st.setInspTab;
  const ROWS = [dict.body.studio.playerRow, dict.body.studio.matchRow, dict.body.studio.eventTypeRow, dict.body.studio.timestampRow, dict.body.studio.tagsRow, dict.body.studio.notesRow];
  const TABS = [dict.body.studio.clipInspectorTab, dict.body.studio.clipEventsTab, dict.body.studio.adjustmentsTab];
  const [match, setMatch] = useState<Match | null>(null);
  const reel = st.reel;
  const [events, setEvents] = useState<MatchEvents | null | undefined>(undefined);
  useEffect(() => {
    setEvents(undefined);
    if (!reel) return;
    void api<MatchEvents>(`/v1/videos/${reel.video_id}/events`).then(setEvents, () => setEvents(null));
  }, [reel?.video_id]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setMatch(null);
    if (!reel) return;
    void api<Video>(`/v1/videos/${reel.video_id}`).then((v) => (v.match_id ? api<Match>(`/v1/matches/${v.match_id}`) : null)).then(setMatch, () => setMatch(null));
  }, [reel?.video_id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = st.items.find((p) => p.clip.id === r?.selectedClip) ?? null;
  const moment = chosen ? null : st.preview;
  // like an editor: with nothing chosen, the inspector shows the clip under the playhead (its player, match and event are carried from it)
  const placed = chosen ?? (moment ? null : locate(st.items, st.playhead)?.p ?? null);
  const span = placed ? { in: placed.clip.in_pts_us, out: placed.clip.out_pts_us } : moment ? { in: moment.in_pts_us, out: moment.out_pts_us } : null;
  const title = placed ? (placed.clip.label ?? dict.body.studio.clipIndex.replace("{a}", String(placed.index + 1))) : moment ? moment.label : dict.body.studio.noClipSelected;
  const line2 = placed ? `${placed.clip.origin === "SUGGESTED" ? dict.body.studio.engineSuggestion : dict.body.studio.addedByHand}${dict.body.studio.clipOfTotal.replace("{a}", String(placed.index + 1)).replace("{b}", String(st.items.length))}${chosen ? "" : dict.body.studio.atPlayheadSuffix}`
    : moment ? (moment.in_reel ? dict.body.studio.suggestedInReel : dict.body.studio.suggestedNotInReel) : dict.body.studio.selectClipMediaBin;
  const [inS, setIn] = useState(""); const [outS, setOut] = useState("");
  useEffect(() => { setIn(span ? (span.in / 1e6).toFixed(2) : ""); setOut(span ? (span.out / 1e6).toFixed(2) : ""); }, [span?.in, span?.out]); // eslint-disable-line react-hooks/exhaustive-deps
  const canTrim = !!placed && !!r?.canEdit && !r.busy;
  const tracks = new Set((reel?.targets ?? []).map((t) => t.track_id));
  const insights = span && events ? insightsIn(events, span.in, span.out, reel?.player?.player_id ?? null, tracks, dict) : [];
  const main = mainOf(insights);
  const noEvents = events === undefined ? dict.common.loading : events === null ? dict.body.studio.eventsNotLoaded : events.state !== "READY" ? dict.body.studio.ballNotFollowed
    : dict.body.studio.noneOfHis;
  const applyTrim = () => {
    const a = Math.round(Number(inS) * 1e6), b = Math.round(Number(outS) * 1e6);
    if (placed && Number.isFinite(a) && Number.isFinite(b) && b > a && (a !== placed.clip.in_pts_us || b !== placed.clip.out_pts_us)) st.trim(placed.clip, a, b);
  };

  return (
    <section aria-label={dict.body.studio.clipInspectorAria} data-section="p07-s04" data-selected={placed?.clip.id ?? (moment ? "moment" : "none")}
      className="vie-panel flex min-h-0 flex-col p-3">
      <div role="tablist" aria-label={dict.body.studio.inspectorAria} className="flex gap-1 border-b border-line">
        {TABS.map((l, i) => (
          <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
            className={`t-body border-b-2 px-2 py-1.5 ${tab === i ? "border-primary font-normal text-primary" : "border-transparent text-muted"}`}>{l}</button>
        ))}
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {tab === 1 ? (
          <div data-insights={String(insights.length)} className="t-body">
            {!span ? <p className="m-5 text-muted">{dict.body.studio.selectClip}</p>
              : !insights.length ? <p className="m-5 text-muted">{events && events.state === "READY" ? dict.body.studio.noEventInClip : noEvents}</p> : (
              <>
                <p className="t-small mx-2 mb-2.5 mt-1.5">
                  {dict.body.studio.engineFoundBetween.replace("{a}", tc(span.in)).replace("{b}", tc(span.out))}
                </p>
                <ul aria-label={dict.body.studio.engineEventsInClip} className="list-none space-y-1.5 p-0">
                  {insights.map((i, k) => (
                    <li key={k} data-his={i.his ? "1" : "0"}
                      className={`flex items-center gap-2.5 rounded-md border px-2.5 py-2 ${i.his ? "border-primary bg-[#0a2447]" : "border-line bg-[#06142a]"}`}>
                      <span className="t-tc w-[70px] shrink-0 text-muted">{tc(i.at)}</span>
                      <span className="min-w-0 flex-1">{i.label}{i.his && reel?.player ? ` · ${reel.player.display_name}` : ""}</span>
                      <span title={i.evidence === "INFERRED" ? dict.body.studio.workedOut : dict.body.studio.seenByEngine}
                        className="rounded px-1.5 py-0.5 text-xs font-normal"
                        style={{ background: i.evidence === "INFERRED" ? "#3a2a08" : "#08311f", color: i.evidence === "INFERRED" ? "#ffc66d" : "#3ee6a8" }}>
                        {i.evidence === "INFERRED" ? dict.body.tactics.inferredLabel : dict.body.studio.detectedBadge}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : tab === 2 ? (
          <Adjustments r={r} st={st} ui={ui} placed={placed} suggestAt={main?.at ?? null} />
        ) : tab !== 0 ? <p className="t-body mt-5 text-center text-muted">{dict.body.studio.tabNotYet.replace("{a}", TABS[tab]!).replace("{b}", NOT_YET)}</p>
          : !chosen && !moment && reel ? (   // B.19 (ADR-093): nothing chosen: the reel itself, and a way to choose the clip at the playhead
          <ProjectInfo reel={reel} match={match} total={st.total} canPick={!!placed} onPick={() => placed && r?.setSelectedClip(placed.clip.id)} />
        ) : (
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="relative h-[104px] w-[215px] shrink-0 overflow-hidden rounded-md border border-line bg-[#0b2a52]">
                <span className="t-tc absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-white">{span ? `${Math.round((span.out - span.in) / 1e6)}s` : "—"}</span>
              </div>
              <div className="min-w-0">
                <p className="t-panel truncate">{title}</p>
                <p className="t-body truncate text-muted">{line2}</p>
                <p className="t-tc mt-1">{span ? `${tc(span.in)} – ${tc(span.out)}` : "—"}</p>
              </div>
            </div>
            <h2 className="t-section">{dict.body.studio.clipDetails}</h2>
            <div>
              <p className="t-label">{ROWS[0]}</p>
              <div className="mt-1 rounded-md px-3 py-2 t-body" style={field}>
                {span && reel?.player ? `${reel.player.display_name}${reel.player.canonical_otsi_id ? ` · ${reel.player.canonical_otsi_id}` : ""}` : span ? dict.body.studio.noPlayerOnReel : dict.body.studio.selectClipLabel}
              </div>
            </div>
            <div>
              <p className="t-label">{ROWS[1]}</p>
              <div className="mt-1 rounded-md px-3 py-2 t-body" style={field}>
                {span && match ? `${match.home?.name ?? "—"} vs ${match.away?.name ?? "—"}` : span ? dict.body.studio.videoNotLinked : dict.body.studio.selectClipLabel}
              </div>
            </div>
            <div>
              <p className="t-label">{ROWS[2]}</p>
              <div className="mt-1 rounded-md px-3 py-2 t-body" style={field}
                title={main ? dict.body.studio.engineReadingNotReviewed.replace("{a}", main.evidence === "INFERRED" ? dict.body.studio.inferredWord : dict.body.studio.detectedWord) : undefined} data-event-type={main?.label ?? "none"}>
                {!span ? dict.body.studio.selectClipLabel : main ? `${main.label} · ${tc(main.at)}` : noEvents}
              </div>
            </div>
            <div>
              <p className="t-label">{ROWS[3]}</p>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-line2 bg-canvas px-3.5 py-2 t-body text-muted">
                {canTrim ? (
                  <form className="flex w-full items-center gap-2" onSubmit={(e) => { e.preventDefault(); applyTrim(); }} aria-label={dict.body.studio.trimClip}>
                    <input aria-label={dict.body.studio.inPoint} value={inS} onChange={(e) => setIn(e.target.value)} onBlur={applyTrim} inputMode="decimal"
                      className="t-tc w-[110px] bg-transparent text-ink outline-none" />
                    <span>–</span>
                    <input aria-label={dict.body.studio.outPoint} value={outS} onChange={(e) => setOut(e.target.value)} onBlur={applyTrim} inputMode="decimal"
                      className="t-tc w-[110px] bg-transparent text-ink outline-none" />
                    <span className="t-small">s</span>
                  </form>
                ) : <span>{span ? `${(span.in / 1e6).toFixed(2)} – ${(span.out / 1e6).toFixed(2)} s` : "—"}</span>}
              </div>
            </div>
            <div>
              <p className="t-label">{ROWS[4]}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="t-body text-muted">{dict.body.studio.noTags}</span>
                <button type="button" disabled title={dict.body.studio.tagsNotStored} aria-label={dict.body.studio.addTagNA}
                  className="t-panel flex h-10 w-10 items-center justify-center rounded-md border border-line2 bg-raised opacity-60">+</button>
              </div>
            </div>
            <div>
              <p className="t-label">{ROWS[5]}</p>
              <ClipNotes r={r} st={st} span={placed ? span : null} ui={ui} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** the selected clip's notes (pinned inside its in/out) and a field to add one at the playhead */
function ClipNotes({ r, st, span, ui }: { r: ReelState | null; st: Studio; span: { in: number; out: number } | null; ui: Ui }) {
  const { t: dict } = useLocale();
  const reel = st.reel;
  const notes = st.notes;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = span ? notes.filter((n) => n.at_pts_us !== null && n.at_pts_us >= span.in && n.at_pts_us <= span.out) : [];
  const can = !!span && !!r?.canEdit;
  const add = () => {
    if (!reel) return ui.pick();
    if (!span) return ui.say(dict.body.studio.selectClipFirst);
    if (!r?.canEdit) return ui.say(dict.body.studio.roleViewNotNotes);
    if (!text.trim()) return;
    const at = locate(st.items, st.playhead)?.src;
    const pts = at !== undefined && at >= span.in && at <= span.out ? Math.round(at) : span.in;
    setBusy(true);
    void st.addNote(text.trim(), pts).then(() => setText(""), () => ui.say(dict.body.studio.noteNotSaved)).finally(() => setBusy(false));
  };
  return (
    <div className="mt-1 flex flex-col overflow-hidden rounded-lg border border-line2 bg-canvas">
      {mine.length > 0 && (
        <ul aria-label={dict.body.studio.notesOnClip} className="t-body max-h-24 list-none overflow-y-auto px-3 pb-0 pt-1 leading-snug">
          {mine.map((n) => <li key={n.id} title={`${n.author.display_name} · ${tc(n.at_pts_us ?? 0)}`}><span className="text-muted">{tc(n.at_pts_us ?? 0)}</span> {n.body}</li>)}
        </ul>
      )}
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={255} disabled={busy} aria-label={dict.body.studio.addClipNoteAria}
          placeholder={span ? (can ? dict.body.studio.addClipNotes : dict.body.studio.roleCannotNotes) : dict.body.studio.addClipNotesShort}
          className="t-body min-w-0 flex-1 bg-transparent px-3.5 py-2.5 outline-none" />
      </form>
    </div>
  );
}
