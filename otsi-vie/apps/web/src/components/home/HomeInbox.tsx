"use client";
/**
 * Home: what needs the person now (v3 Phase A.13, ADR-062).
 *  - NextActionBar: under Upload Video / Paste Link, a third, state-aware action (watch the analysis, review, continue the reel, open the
 *    report, pick a player), from GET /v1/overview/inbox; absent when nothing waits.
 *  - HomeGuidance: until the organization has a finished analysis, the first-run guidance (Platform Capabilities, How It Works) stays as
 *    approved; afterwards those two places show the Review inbox (each row opens the exact page) and Active jobs (the same jobs as the
 *    top-bar tray).
 */
import type { HomeInbox, InboxKind, JobList } from "@otsi-vie/contracts";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ACC, B, Ic, P, T, stageStyles as s, u } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { STATE_COLOR, STATE_LABEL } from "@/lib/jobs";
import { Capabilities } from "./Capabilities";
import { HowItWorks } from "./HowItWorks";

const Ctx = createContext<HomeInbox | null | undefined>(undefined);

/** reads the inbox once per visit (and every 30 s while the page stays open) */
export function HomeInboxProvider({ children }: { children: ReactNode }) {
  const [inbox, setInbox] = useState<HomeInbox | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () => void api<HomeInbox>("/v1/overview/inbox").then((x) => { if (live) setInbox(x); }, () => { if (live) setInbox(null); });
    load();
    const t = window.setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 30000);
    return () => { live = false; window.clearInterval(t); };
  }, []);
  return <Ctx.Provider value={inbox}>{children}</Ctx.Provider>;
}

export function NextActionBar() {
  const inbox = useContext(Ctx);
  const n = inbox?.next;
  if (!n) return null;
  return (
    <Link href={n.href} className={`${s.cta} ${s.framed}`} data-cta="next-action" data-next-kind={n.kind}
      style={{ left: u(59), top: u(552 - 101), width: u(821), height: u(42), background: "rgba(10,60,120,.55)", borderRadius: u(8), ["--bc" as string]: "#1e90ff" }}>
      <Ic o={[59, 552]} x={84} y={573} k="arr" size={22} color="#6cc4ff" />
      <T o={[59, 552]} x={106} y={573} size={21} weight={600} as="span" style={{ maxWidth: u(760), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {n.label}{n.detail ? <span style={{ fontWeight: 400, color: "#b9cbe2" }}>{` · ${n.detail}`}</span> : null}
      </T>
    </Link>
  );
}

const KIND: Record<InboxKind, [string, string]> = {
  IDENTITY: ["user", "#33a8ff"], TEAM_SHEET: ["doc", "#3ee6a8"], STALE_REEL: ["clap", "#f5b82e"], FAILED_JOB: ["xc", "#ff6b6b"],
};

export function HomeGuidance() {
  const inbox = useContext(Ctx);
  if (inbox === undefined) return null;                        // reading: neither, so nothing flickers
  if (!inbox?.completed_match) return <><Capabilities /><HowItWorks /></>;
  return <><ReviewInbox inbox={inbox} /><ActiveJobs /></>;
}

function ReviewInbox({ inbox }: { inbox: HomeInbox }) {
  return (
    <section aria-label="Review inbox" data-section="p01-inbox">
      <P x={1841} y={757} w={681} h={405} />
      <ACC x={1857} y={771} h={26} />
      <T x={1880} y={784} size={27} weight={600} as="h2">Review inbox</T>
      <T x={2504} y={786} size={19} color="#8ea3bf" align="right">{inbox.items.length ? `${inbox.items.length} to do` : "All clear"}</T>
      {inbox.items.length === 0 && (
        <T x={1880} y={850} size={20} color="#b9cbe2" style={{ maxWidth: u(600), whiteSpace: "normal", lineHeight: 1.4 }}>
          Nothing waits for you: no identity suggestion, team sheet, out-of-date reel or failed job.
        </T>
      )}
      {inbox.items.slice(0, 5).map((it, i) => {
        const y = 815 + i * 68, [icon, colour] = KIND[it.kind];
        return (
          <Link key={`${it.kind}-${i}`} href={it.href} className={`${s.cta} ${s.framed}`} data-inbox={it.kind}
            style={{ left: u(1855), top: u(y - 101), width: u(651), height: u(60), background: "#06142a", borderRadius: u(8) }}>
            <Ic o={[1855, y]} x={1885} y={y + 30} k={icon} size={28} color={colour} />
            <T o={[1855, y]} x={1915} y={y + 19} size={19} weight={600} as="span" style={{ maxWidth: u(560), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</T>
            <T o={[1855, y]} x={1915} y={y + 43} size={16} color="#9fb3cc" as="span" style={{ maxWidth: u(560), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.detail ?? ""}</T>
            <Ic o={[1855, y]} x={2486} y={y + 30} k="arr" size={20} color="#33a8ff" />
          </Link>
        );
      })}
    </section>
  );
}

/** the same jobs as the top-bar tray: what runs or waits now, else what finished in the last day */
function ActiveJobs() {
  const [list, setList] = useState<JobList | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void api<JobList>("/v1/jobs").then((x) => { if (live) setList(x); }, () => undefined);
    load();
    const t = window.setInterval(() => { if (document.visibilityState !== "hidden") load(); }, 5000);
    return () => { live = false; window.clearInterval(t); };
  }, []);
  const active = list?.jobs.filter((j) => j.state === "RUNNING" || j.state === "QUEUED" || j.state === "PAUSED") ?? [];
  const shown = (active.length ? active : list?.jobs ?? []).slice(0, 4);
  return (
    <section aria-label="Active jobs" data-section="p01-jobs">
      <P x={39} y={1180} w={2483} h={247} />
      <ACC x={63} y={1213} h={49} />
      <T x={87} y={1238} size={34} weight={700} as="h2">Active jobs</T>
      <T x={86} y={1291} size={22} color="#cfe0f5">{list ? `${list.running} running · ${list.active - list.running} waiting or paused` : "Reading…"}</T>
      <T x={86} y={1325} size={19} color="#8ea3bf">{active.length ? "Manage them from the jobs icon in the top bar." : list?.jobs.length ? "Nothing runs now; the last day's jobs:" : "No engine job in the last day."}</T>
      {shown.map((j, i) => {
        const x = 520 + i * 495, y = 1205;
        const card = (
          <>
            <T o={[x, y]} x={x + 20} y={y + 30} size={21} weight={600} as="span" style={{ maxWidth: u(330), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.kind_label}</T>
            <T o={[x, y]} x={x + 455} y={y + 30} size={18} color={STATE_COLOR[j.state]} align="right" as="span">{STATE_LABEL[j.state]}</T>
            <T o={[x, y]} x={x + 20} y={y + 62} size={17} color="#b9cbe2" as="span" style={{ maxWidth: u(435), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.subject_title ?? "—"}</T>
            <T o={[x, y]} x={x + 20} y={y + 92} size={16} color={j.state === "FAILED" ? "#ff8a8a" : "#8ea3bf"} as="span"
              style={{ maxWidth: u(435), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.state === "FAILED" ? (j.error ?? "Failed") : (j.stage ?? "")}</T>
            <B o={[x, y]} x={x + 20} y={y + 125} w={360} h={8} style={{ background: "#17304f", borderRadius: u(4) }}>
              <i style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, j.progress))}%`, background: STATE_COLOR[j.state], borderRadius: u(4) }} />
            </B>
            <T o={[x, y]} x={x + 455} y={y + 129} size={18} align="right" as="span">{`${Math.round(j.progress)}%`}</T>
          </>
        );
        const style = { left: u(x), top: u(y - 101), width: u(475), height: u(200), background: "#06142a", borderRadius: u(8) };
        return j.href
          ? <Link key={j.id} href={j.href} className={`${s.cta} ${s.framed}`} style={style} data-home-job={j.kind}>{card}</Link>
          : <div key={j.id} className={`${s.cta} ${s.framed}`} style={style} data-home-job={j.kind}>{card}</div>;
      })}
    </section>
  );
}
