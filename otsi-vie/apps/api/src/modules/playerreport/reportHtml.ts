/**
 * The player report as one HTML page for the PDF (ADR-056). It loads nothing from outside (no fonts, images or scripts): the printer
 * blocks every request. Every text from the database is escaped. Sections and wording follow page 08: identity, what the footage measured,
 * heat map, events, comparison, sentences from measured values and, only when published, the analyst's assessment (marked as opinion).
 * Notes and tags are internal and are not in the report (a report may be shared outside the organization).
 */
import { DEFAULT_REPORT_DESIGN, HIGH_SPEED_KMH, SPRINT_KMH, type ReportDesign, type ReportSection, type PlayerAssessment, type PlayerComparison, type PlayerEvents, type PlayerIdentity, type PlayerInsights, type PlayerMeasures,
  type PlayerProfile } from "@otsi-vie/contracts";

export interface ReportInput {
  player: PlayerIdentity;
  profile: PlayerProfile | null;
  measures: PlayerMeasures;
  comparison: PlayerComparison;
  insights: PlayerInsights;
  assessment: PlayerAssessment;
  events: PlayerEvents;
  organization: string;
  generatedAt: Date;
  /** B.24 (ADR-099): the designer's sections, title and cover note (default: everything, as before) */
  design?: ReportDesign;
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const min = (s: number) => `${Math.round(s / 60)} min`;
const FOOT: Record<string, string> = { LEFT: "Left", RIGHT: "Right", BOTH: "Both" };

function kpis(m: PlayerMeasures): [string, string, string][] {
  const e = m.events, dash = "—";
  return [
    ["Seen on camera", m.seen_s > 0 ? min(m.seen_s) : dash, "in tracks a person confirmed as him (not minutes played)"],
    ["Distance (est.)", m.distance_m !== null ? (m.distance_m >= 1000 ? `${(m.distance_m / 1000).toFixed(2)} km` : `${m.distance_m} m`) : dash, m.distance_m !== null ? `over ${min(m.measured_s)} measured` : "not measured"],
    ["Top speed", m.top_speed_kmh !== null ? `${m.top_speed_kmh} km/h` : dash, m.top_speed_kmh !== null ? "held for 2 s" : "not measured"],
    ["Sprints", m.sprint_m !== null ? String(m.sprints) : dash, m.sprint_m !== null ? `${m.sprint_m} m at ${SPRINT_KMH}+ km/h; ${m.high_speed_m ?? 0} m at ${HIGH_SPEED_KMH}+ km/h` : "not measured"],
    ["Passes", e ? String(e.passes) : dash, e ? `${e.passes_received} received` : "the ball was not followed"],
    ["Key passes", e ? String(e.key_passes) : dash, e ? "found by the engine" : "the ball was not followed"],
    ["Balls won", e ? String(e.balls_won) : dash, e ? `${e.pressures} pressures` : "the ball was not followed"],
    ["Shots", e ? String(e.shots) : dash, e ? "found by the engine" : "the ball was not followed"],
    ["xG / xA", dash, "not measured by the engine"],
  ];
}

function heat(m: PlayerMeasures): string {
  const h = m.heat;
  if (!h) return `<p class="muted">No heat map: his position on the pitch was not measured.</p>`;
  const max = Math.max(...h.seconds, 0.0001);
  let cells = "";
  for (let r = 0; r < h.rows; r++) for (let c = 0; c < h.cols; c++) {
    const v = (h.seconds[r * h.cols + c] ?? 0) / max;
    cells += `<i style="background:rgba(255,${Math.round(200 - 160 * v)},40,${v === 0 ? 0 : (0.15 + 0.8 * v).toFixed(2)})"></i>`;
  }
  return `<div class="pitch" style="grid-template-columns:repeat(${h.cols},1fr)">${cells}<b class="half"></b><b class="circle"></b></div>
    <p class="muted">${min(h.measured_s)} measured of ${min(h.seen_s)} seen, as filmed (teams change ends at half-time).</p>`;
}

function events(ev: PlayerEvents): string {
  if (!ev.videos) return `<p class="muted">No video of his has the ball followed yet: no events.</p>`;
  const count = (k: string) => ev.items.filter((e) => e.kind === k).length;
  const rows = [["Passes", count("PASS")], ["Key passes", ev.items.filter((e) => e.kind === "PASS" && e.key).length], ["Passes received", count("PASS_RECEIVED")],
    ["Balls won", count("BALL_WON")], ["Pressures", count("PRESSURE")], ["Set pieces", count("SET_PIECE")], ["Shots", count("SHOT")], ["Goals", count("GOAL")]];
  return `<table class="grid"><tbody>${rows.map(([l, n]) => `<tr><td>${l}</td><td class="num">${n}</td></tr>`).join("")}</tbody></table>
    <p class="muted">Found by the engine in ${ev.videos} video${ev.videos === 1 ? "" : "s"} on tracks a person confirmed as him; engine readings, not reviewed.</p>`;
}

function comparison(c: PlayerComparison): string {
  const fmt = (v: number | null, unit: string) => (v === null ? "—" : `${v}${unit ? ` ${unit}` : ""}`);
  return `<p class="muted">Against ${esc(c.group_name.toLowerCase())} of your organization: ${c.n} player${c.n === 1 ? "" : "s"} with enough time seen.${c.player_below_minimum ? " He was seen for less than the minimum: his rates are rough." : ""}</p>
    <table class="grid"><thead><tr><th></th><th class="num">Him</th><th class="num">Group average</th><th class="num">Players</th></tr></thead><tbody>
    ${c.metrics.map((m) => `<tr><td>${esc(m.label)}</td><td class="num">${fmt(m.player, m.unit)}</td><td class="num">${fmt(m.group_mean, m.unit)}</td><td class="num">${m.group_n}</td></tr>`).join("")}
    </tbody></table><p class="muted">${esc(c.basis)}</p>`;
}

function assessment(a: PlayerAssessment): string {
  const p = a.published;
  if (!p) return `<p class="muted">No published scouting assessment.</p>`;
  return `<p class="opinion">Analyst opinion · published by ${esc(a.published_by_name)} on ${esc(a.published_at?.slice(0, 10))}</p>
    ${p.role ? `<p><b>Role:</b> ${esc(p.role)}</p>` : ""}${p.summary ? `<p>${esc(p.summary)}</p>` : ""}
    ${p.traits.length ? `<p>${p.traits.map((t) => `<span class="chip">${esc(t)}</span>`).join(" ")}</p>` : ""}
    ${p.rating !== null ? `<p><b>Overall rating:</b> ${p.rating} / 10</p>` : ""}
    ${p.criteria.length ? `<table class="grid"><tbody>${p.criteria.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.score} / 10</td></tr>`).join("")}</tbody></table>` : ""}
    ${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ""}`;
}

export function reportHtml(x: ReportInput): string {
  const pr = x.profile, team = pr?.latest_team;
  const d = x.design ?? DEFAULT_REPORT_DESIGN, has = (s: ReportSection) => d.sections.includes(s), note = d.note?.trim() || null;
  const heatPart = has("heat") ? `<section data-part="heat"><h2>Heat map</h2>${heat(x.measures)}</section>` : "";
  const eventsPart = has("events") ? `<section data-part="events"><h2>Events</h2>${events(x.events)}</section>` : "";
  const pair = heatPart && eventsPart ? `<div class="cols">${heatPart}${eventsPart}</div>` : heatPart + eventsPart;
  const facts: [string, string][] = [["OTSI Player ID", x.player.canonical_otsi_id ?? "Provisional player: no ID yet"], ["Team", team?.team ?? "—"],
    ["Shirt", team?.jersey_number !== null && team?.jersey_number !== undefined ? String(team.jersey_number) : "—"], ["Position", team?.position ?? pr?.position ?? "—"],
    ["Nationality", pr?.nationality?.name ?? "—"], ["Age", pr?.age !== null && pr?.age !== undefined ? String(pr.age) : "—"], ["Preferred foot", pr?.preferred_foot ? FOOT[pr.preferred_foot] ?? "—" : "—"]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Player report · ${esc(x.player.display_name)}</title><style>
  *{box-sizing:border-box} body{font-family:"Segoe UI",Arial,"Noto Sans","DejaVu Sans",sans-serif;color:#13213a;font-size:10.5px;margin:0}
  h1{font-size:22px;margin:0 0 2px} h2{font-size:13px;margin:14px 0 6px;padding-bottom:3px;border-bottom:2px solid #1e90ff;color:#0a2b55}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0a2b55;padding-bottom:8px}
  .brand{font-weight:700;color:#1e90ff;letter-spacing:.5px} .muted{color:#5b6b82;margin:4px 0} .facts{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 12px;margin-top:8px}
  .facts div span{display:block;color:#5b6b82;font-size:9px} .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
  .kpi{border:1px solid #c9d6e8;border-left:3px solid #1e90ff;border-radius:4px;padding:5px 7px} .kpi b{display:block;font-size:15px} .kpi span{color:#5b6b82;font-size:9px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px} .grid{width:100%;border-collapse:collapse} .grid td,.grid th{padding:3px 5px;border-bottom:1px solid #e1e8f2;text-align:left}
  .grid th{color:#5b6b82;font-weight:600} .num{text-align:right!important;white-space:nowrap}
  .pitch{position:relative;display:grid;aspect-ratio:105/68;background:#2c7a37;border:2px solid #fff;outline:1px solid #2c7a37;border-radius:3px;overflow:hidden}
  .pitch i{display:block} .pitch .half{position:absolute;left:50%;top:0;bottom:0;border-left:1.5px solid rgba(255,255,255,.8)}
  .pitch .circle{position:absolute;left:50%;top:50%;width:18%;aspect-ratio:1;transform:translate(-50%,-50%);border:1.5px solid rgba(255,255,255,.8);border-radius:50%}
  .ins{margin:0;padding:0;list-style:none} .ins li{border:1px solid #c9d6e8;border-radius:4px;padding:5px 7px;margin-bottom:4px} .ins small{display:block;color:#5b6b82}
  .opinion{font-style:italic;color:#7a4a00;margin:2px 0 6px} .chip{display:inline-block;border:1px solid #9cc3f0;border-radius:9px;padding:1px 7px;margin:0 3px 3px 0}
  .notes{white-space:pre-wrap} .foot{margin-top:14px;border-top:1px solid #c9d6e8;padding-top:6px;color:#5b6b82;font-size:8.5px}
  section{break-inside:avoid}
  </style></head><body>
  <div class="top"><div><div class="brand">OTSI VIE · PLAYER REPORT</div><h1>${esc(x.player.display_name)}</h1>${d.title ? `<div class="muted" data-part="title"><b>${esc(d.title)}</b></div>` : ""}
    <div class="muted">${esc(x.organization)} · generated ${esc(x.generatedAt.toISOString().slice(0, 16).replace("T", " "))} UTC</div></div>
    <div class="muted" style="text-align:right">${x.measures.tracks} confirmed track${x.measures.tracks === 1 ? "" : "s"}<br>in ${x.measures.videos} video${x.measures.videos === 1 ? "" : "s"}${x.measures.mean_confidence !== null ? `<br>detector confidence ${Math.round(x.measures.mean_confidence * 100)} %` : ""}</div></div>
  <div class="facts">${facts.map(([l, v]) => `<div><span>${l}</span>${esc(v)}</div>`).join("")}</div>
  ${note ? `<section data-part="note"><h2>Note</h2><p class="opinion notes">${esc(note)}</p><p class="muted">Written by a person for this report, not engine output.</p></section>` : ""}
  ${has("measures") ? `<section data-part="measures"><h2>What the footage measured</h2><div class="kpis">${kpis(x.measures).map(([l, v, n]) => `<div class="kpi">${l}<b>${esc(v)}</b><span>${esc(n)}</span></div>`).join("")}</div></section>` : ""}
  ${pair}
  ${has("comparison") ? `<section data-part="comparison"><h2>Comparison</h2>${comparison(x.comparison)}</section>` : ""}
  ${has("insights") ? `<section data-part="insights"><h2>From his measurements</h2>${x.insights.items.length ? `<ul class="ins">${x.insights.items.map((i) => `<li>${esc(i.text)}<small>${esc(i.source)}</small></li>`).join("")}</ul>` : `<p class="muted">Not enough measured to say anything yet.</p>`}
    <p class="muted">${esc(x.insights.basis)}</p></section>` : ""}
  ${has("assessment") ? `<section data-part="assessment"><h2>Scouting assessment</h2>${assessment(x.assessment)}</section>` : ""}
  <div class="foot">Engine readings from tracks a person confirmed as this player: not a verified stat sheet. Unmeasured values are shown as "—", never estimated.
    Development output of OTSI VIE: commercial distribution is not activated.</div>
  </body></html>`;
}
