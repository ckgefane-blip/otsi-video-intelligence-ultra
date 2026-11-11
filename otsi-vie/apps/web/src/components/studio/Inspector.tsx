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
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { getDictionary, useLocale, type Dictionary } from "@/lib/i18n";
import { tc, type Ui } from "./kit";
import { locate, type Studio } from "./useStudio";
import { Adjustments } from "./Adjustments";
import { ProjectInfo } from "./ProjectInfo";
import { NOT_YET } from "@/lib/devMode";

const field = { background: "#06142a", borderRadius: u(6) };

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
  const ROWS: [string, string, number][] = [["user", dict.body.studio.playerRow, 471], ["ball", dict.body.studio.matchRow, 524], ["ball", dict.body.studio.eventTypeRow, 577], ["clk", dict.body.studio.timestampRow, 631], ["tag", dict.body.studio.tagsRow, 682], ["note", dict.body.studio.notesRow, 737]];
  const TABS: [string, number][] = [[dict.body.studio.clipInspectorTab, 1993], [dict.body.studio.clipEventsTab, 2171], [dict.body.studio.adjustmentsTab, 2318]];
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
    <section aria-label={dict.body.studio.clipInspectorAria} data-section="p07-s04" data-selected={placed?.clip.id ?? (moment ? "moment" : "none")}>
      <P x={1972} y={205} w={562} h={620} />
      <div role="tablist" aria-label={dict.body.studio.inspectorAria}>
        {TABS.map(([l, x], i) => (
          <button key={l} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className="absolute"
            style={{ left: u(x - 11), top: u(215 - 101), width: u(l.length * 12 + 22), height: u(44), padding: 0, border: 0, background: "transparent", cursor: "pointer", font: "inherit" }}>
            <T o={[x - 11, 215]} x={x} y={235} size={22} weight={tab === i ? 600 : 400} color={tab === i ? "#33a8ff" : "#cfe0f5"} as="span">{l}</T>
          </button>
        ))}
      </div>
      <Ic x={2502} y={235} k="exv" size={26} color="#cfe0f5" />
      <B x={TABS[tab]![1] - 11} y={259} w={145} h={3} style={{ background: "#1e90ff" }} />
      <B x={1974} y={262} w={558} h={1} style={{ background: "#12335f" }} />

      {tab === 1 ? (
        <div data-insights={String(insights.length)} className="absolute" style={{ left: u(1990), top: u(280 - 101), width: u(526), height: u(530), overflowY: "auto", fontSize: u(18), color: "#cfe0f5" }}>
          {!span ? <p style={{ margin: u(20), color: "#8ea3bf" }}>{dict.body.studio.selectClip}</p>
            : !insights.length ? <p style={{ margin: u(20), color: "#8ea3bf" }}>{events && events.state === "READY" ? dict.body.studio.noEventInClip : noEvents}</p> : (
            <>
              <p style={{ margin: `${u(6)} ${u(8)} ${u(10)}`, fontSize: u(15), color: "#8ea3bf" }}>
                {dict.body.studio.engineFoundBetween.replace("{a}", tc(span.in)).replace("{b}", tc(span.out))}
              </p>
              <ul aria-label={dict.body.studio.engineEventsInClip} style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {insights.map((i, k) => (
                  <li key={k} data-his={i.his ? "1" : "0"} style={{ display: "flex", alignItems: "center", gap: u(10), padding: `${u(8)} ${u(10)}`, marginBottom: u(6), borderRadius: u(6),
                    background: i.his ? "#0a2447" : "#06142a", border: `${u(1.5)} solid ${i.his ? "#1e90ff" : "#12335f"}` }}>
                    <span style={{ color: "#8ea3bf", width: u(70), flex: "none" }}>{tc(i.at)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{i.label}{i.his && reel?.player ? ` · ${reel.player.display_name}` : ""}</span>
                    <span title={i.evidence === "INFERRED" ? dict.body.studio.workedOut : dict.body.studio.seenByEngine}
                      style={{ fontSize: u(13), padding: `${u(2)} ${u(6)}`, borderRadius: u(4), background: i.evidence === "INFERRED" ? "#3a2a08" : "#08311f", color: i.evidence === "INFERRED" ? "#ffc66d" : "#3ee6a8" }}>
                      {i.evidence === "INFERRED" ? dict.body.tactics.inferredLabel : dict.body.studio.detectedBadge}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : tab === 2 ? (
        <div className="absolute" style={{ left: u(1984), top: u(270 - 101), width: u(538), height: u(548), overflowY: "auto" }}>
          <Adjustments r={r} st={st} ui={ui} placed={placed} suggestAt={main?.at ?? null} />
        </div>
      ) : tab !== 0 ? <T x={2253} y={520} size={20} color="#8ea3bf" align="center">{dict.body.studio.tabNotYet.replace("{a}", TABS[tab]![0]).replace("{b}", NOT_YET)}</T>
        : !chosen && !moment && reel ? (   // B.19 (ADR-093): nothing chosen: the reel itself, and a way to choose the clip at the playhead
        <ProjectInfo reel={reel} match={match} total={st.total} canPick={!!placed} onPick={() => placed && r?.setSelectedClip(placed.clip.id)} />
      ) : (
        <>
          <B x={1993} y={287} w={215} h={104} style={{ borderRadius: u(5), background: "radial-gradient(ellipse at 45% 38%,#e0b090 0,#c98c6a 6%,transparent 7%),radial-gradient(ellipse at 45% 85%,#6fb8ee 0,#2a6fb8 35%,transparent 70%),linear-gradient(180deg,#27487a,#2d7a3a 30%,#1d5a28)" }} />
          <B x={2152} y={361} w={52} h={27} style={{ background: "rgba(0,10,25,.8)", borderRadius: u(4) }} />
          <T x={2178} y={375} size={17} weight={600} align="center">{span ? `${Math.round((span.out - span.in) / 1e6)}s` : "—"}</T>
          <T x={2226} y={303} size={20} weight={600} style={{ maxWidth: u(290), overflow: "hidden", textOverflow: "ellipsis" }}>{title}</T>
          <T x={2226} y={337} size={20} color="#b9cbe2" style={{ maxWidth: u(290), overflow: "hidden", textOverflow: "ellipsis" }}>{line2}</T>
          <T x={2226} y={371} size={20} color="#b9cbe2">{span ? `${tc(span.in)} – ${tc(span.out)}` : "—"}</T>
          <T x={1993} y={431} size={24} weight={600} as="h2">{dict.body.studio.clipDetails}</T>
          {ROWS.map(([k, l, y]) => (
            <div key={l}><Ic x={2006} y={y} k={k} size={24} color="#cfe0f5" /><T x={2030} y={y} size={20} color="#cfe0f5">{l}</T></div>
          ))}
          <B x={2174} y={449} w={340} h={44} style={field} />
          <B x={2185} y={454} w={34} h={34} style={{ background: "radial-gradient(circle at 50% 38%,#e0b090 0,#b98466 24%,#2a3a58 25%)", borderRadius: u(5) }} />
          <T x={2229} y={471} size={20} color={span && reel?.player ? "#e3eefb" : "#8ea3bf"} style={{ maxWidth: u(280), overflow: "hidden", textOverflow: "ellipsis" }}>
            {span && reel?.player ? `${reel.player.display_name}${reel.player.canonical_otsi_id ? ` · ${reel.player.canonical_otsi_id}` : ""}` : span ? dict.body.studio.noPlayerOnReel : dict.body.studio.selectClipLabel}
          </T>
          <B x={2174} y={502} w={340} h={44} style={field} />
          <B x={2178} y={506} w={36} h={36} style={{ background: "radial-gradient(circle,#f2c56b 0,#6cc4ff 50%,#fff 56%)", borderRadius: "50%" }} />
          <T x={2229} y={524} size={20} color={span && match ? "#e3eefb" : "#8ea3bf"} style={{ maxWidth: u(280), overflow: "hidden", textOverflow: "ellipsis" }}>
            {span && match ? `${match.home?.name ?? "—"} vs ${match.away?.name ?? "—"}` : span ? dict.body.studio.videoNotLinked : dict.body.studio.selectClipLabel}
          </T>
          <B x={2174} y={555} w={340} h={44} style={field} />
          <Ic x={2198} y={577} k="pass" size={24} color="#cfe0f5" />
          <div title={main ? dict.body.studio.engineReadingNotReviewed.replace("{a}", main.evidence === "INFERRED" ? dict.body.studio.inferredWord : dict.body.studio.detectedWord) : undefined} data-event-type={main?.label ?? "none"}>
            <T x={2227} y={577} size={20} color={main ? "#e3eefb" : "#8ea3bf"} style={{ maxWidth: u(280), overflow: "hidden", textOverflow: "ellipsis" }}>
              {!span ? dict.body.studio.selectClipLabel : main ? `${main.label} · ${tc(main.at)}` : noEvents}</T>
          </div>
          <div className="absolute" style={{ left: u(2174), top: u(608 - 101), width: u(340), height: u(44), boxSizing: "border-box", border: `${u(1.5)} solid #17406f`, borderRadius: u(8),
            background: "#041022", display: "flex", alignItems: "center", gap: u(8), padding: `0 ${u(14)}`, fontSize: u(20), color: "#8ea3bf" }}>
            {canTrim ? (
              <form style={{ display: "flex", alignItems: "center", gap: u(8), width: "100%" }} onSubmit={(e) => { e.preventDefault(); applyTrim(); }} aria-label={dict.body.studio.trimClip}>
                <input aria-label={dict.body.studio.inPoint} value={inS} onChange={(e) => setIn(e.target.value)} onBlur={applyTrim} inputMode="decimal"
                  style={{ width: u(110), background: "transparent", border: 0, color: "#e3eefb", fontSize: "inherit", fontFamily: "inherit", outline: "none" }} />
                <span>–</span>
                <input aria-label={dict.body.studio.outPoint} value={outS} onChange={(e) => setOut(e.target.value)} onBlur={applyTrim} inputMode="decimal"
                  style={{ width: u(110), background: "transparent", border: 0, color: "#e3eefb", fontSize: "inherit", fontFamily: "inherit", outline: "none" }} />
                <span style={{ fontSize: u(16) }}>s</span>
              </form>
            ) : <span>{span ? `${(span.in / 1e6).toFixed(2)} – ${(span.out / 1e6).toFixed(2)} s` : "—"}</span>}
          </div>
          <T x={2176} y={682} size={19} color="#8ea3bf">{dict.body.studio.noTags}</T>
          <B x={2473} y={662} w={40} h={40} style={{ background: "#0a2447", border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(6), opacity: 0.6 }} />
          <span title={dict.body.studio.tagsNotStored} aria-label={dict.body.studio.addTagNA}><Ic x={2493} y={682} k="plus" size={20} /></span>
          <ClipNotes r={r} st={st} span={placed ? span : null} ui={ui} />
        </>
      )}
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
    <div className="absolute" style={{ left: u(2174), top: u(714 - 101), width: u(340), height: u(92), boxSizing: "border-box", border: `${u(1.5)} solid #17406f`,
      borderRadius: u(8), background: "#041022", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {mine.length > 0 && (
        <ul aria-label={dict.body.studio.notesOnClip} style={{ margin: 0, padding: `${u(4)} ${u(12)} 0`, listStyle: "none", overflowY: "auto", flex: 1, fontSize: u(15), color: "#cfe0f5", lineHeight: 1.25 }}>
          {mine.map((n) => <li key={n.id} title={`${n.author.display_name} · ${tc(n.at_pts_us ?? 0)}`}><span style={{ color: "#8ea3bf" }}>{tc(n.at_pts_us ?? 0)}</span> {n.body}</li>)}
        </ul>
      )}
      <form onSubmit={(e) => { e.preventDefault(); add(); }} style={{ flex: mine.length ? "0 0 auto" : 1, display: "flex" }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={255} disabled={busy} aria-label={dict.body.studio.addClipNoteAria}
          placeholder={span ? (can ? dict.body.studio.addClipNotes : dict.body.studio.roleCannotNotes) : dict.body.studio.addClipNotesShort}
          style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "#e3eefb", fontSize: u(mine.length ? 16 : 20), fontFamily: "inherit",
            padding: `${u(mine.length ? 4 : 10)} ${u(15)}`, alignSelf: mine.length ? "auto" : "flex-start" }} />
      </form>
    </div>
  );
}
