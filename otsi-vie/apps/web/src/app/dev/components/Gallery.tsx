"use client";

import { Clapperboard, FileText, Inbox, Play, Upload, Users, Video } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  EmptyState,
  JobStatus,
  Panel,
  Skeleton,
  SkeletonPanel,
  SkeletonText,
  StatCard,
  Table,
  Tabs,
  Toast,
  TrustBadge,
} from "@/components/ui";

/**
 * Dev-only gallery for the spec §4 component kit (spec §12 step 1).
 * Data: Appendix A ONLY — the two real matches, the one real player
 * (Chinazom Godwin #4), the one real reel, the real KPIs, 10 tokens,
 * 0 active jobs. Anything that is not Appendix A data is labelled
 * "Sample". No invented names, numbers, or matches.
 */
const MATCHES = [
  { name: "Nart v Ercakhu – round 2", duration: "2:18:10", date: "10 Nov 2026", status: "Analysed" },
  { name: "FC Ercakhu v FC Dynamo", duration: "2:36:15", date: "31 Oct 2026", status: "Analysed" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-section-title text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function Gallery() {
  const [tab, setTab] = useState("matches");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const [sortKey, setSortKey] = useState<string | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const rows = [...MATCHES].sort((a, b) => {
    if (!sortKey) return 0;
    const av = String(a[sortKey as keyof typeof a]);
    const bv = String(b[sortKey as keyof typeof b]);
    return (sortDirection === "asc" ? av.localeCompare(bv) : bv.localeCompare(av));
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-page-title text-ink">Component gallery — dev only</h1>
      <p className="mt-1 text-body text-muted">
        UI/UX spec §4 kit. Data below is Appendix A only (2 matches, 1 player, 1 reel, 10 tokens, 0 active jobs).
        Anything marked Sample is a component state, not real data. This page is not linked from production navigation
        and returns 404 in production builds.
      </p>
      <p className="mt-2 text-body-small text-amber">Token balance: 10 tokens — low balance (below 90).</p>

      <div className="mt-6">
        <Section title="Buttons">
          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button disabled>Disabled</Button>
            </div>
          </Panel>
        </Section>

        <Section title="StatCards — real KPIs">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={<Video className="h-5 w-5" />} value="2" label="Matches Analyzed" href="/library" />
            <StatCard icon={<Users className="h-5 w-5" />} value="1" label="Players Tracked" href="/players" />
            <StatCard icon={<Clapperboard className="h-5 w-5" />} value="1" label="Reels Generated" href="/reels" />
            <StatCard icon={<FileText className="h-5 w-5" />} value="0" label="Reports Created" href="/reports" />
          </div>
        </Section>

        <Section title="TrustBadge — evidence, data only">
          <Panel>
            <div className="flex flex-wrap gap-2">
              <TrustBadge kind="confirmed" />
              <TrustBadge kind="detected" />
              <TrustBadge kind="inferred" />
              <TrustBadge kind="not-measured" />
            </div>
            <p className="mt-3 text-body-small text-muted">
              Chinazom Godwin #4, DM, FC Ercakhu — <TrustBadge kind="confirmed" /> identity · Recent Form —{" "}
              <TrustBadge kind="not-measured" /> · Nart-match xA — <TrustBadge kind="not-measured" />
            </p>
          </Panel>
        </Section>

        <Section title="JobStatus — jobs only, never an evidence badge">
          <Panel>
            <div className="flex flex-wrap gap-2">
              <JobStatus status="queued" />
              <JobStatus status="running" />
              <JobStatus status="done" />
              <JobStatus status="failed" />
              <JobStatus status="cancelled" />
            </div>
            <p className="mt-3 text-body-small text-muted">
              Sample: Running with progress — <JobStatus status="running" progress={72} /> (no running jobs exist;
              0 active jobs).
            </p>
          </Panel>
        </Section>

        <Section title="Table + Tabs — real matches">
          <Panel title="Recent Matches" actionLabel="View all" actionHref="/library">
            <Tabs
              tabs={[{ id: "matches", label: "Recent Matches" }, { id: "sessions", label: "Recent Sessions" }]}
              activeId={tab}
              onChange={setTab}
            />
            {tab === "matches" ? (
              <div className="mt-3">
                <Table
                  columns={[
                    { key: "name", header: "Match", render: (r) => r.name, sortable: true },
                    { key: "duration", header: "Duration", render: (r) => <span className="text-timecode tabular-nums">{r.duration}</span> },
                    { key: "date", header: "Date", render: (r) => r.date, sortable: true },
                    { key: "status", header: "Status", render: (r) => <span className="text-ok">{r.status}</span> },
                  ]}
                  rows={rows}
                  rowKey={(r) => r.name}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={(key) => {
                    if (sortKey === key) setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                    else { setSortKey(key); setSortDirection("asc"); }
                  }}
                />
              </div>
            ) : (
              <EmptyState
                icon={<Inbox className="h-12 w-12" />}
                title="No sessions yet"
                description="Open a match to start a session."
                actionLabel="Open Library"
                actionHref="/library"
              />
            )}
          </Panel>
        </Section>

        <Section title="EmptyState — real state">
          <Panel title="Jobs Center">
            <EmptyState
              icon={<Upload className="h-12 w-12" />}
              title="No active jobs"
              description="Upload footage to start an analysis."
              actionLabel="Upload footage"
              actionHref="/upload"
            />
          </Panel>
        </Section>

        <Section title="Skeleton">
          <Panel>
            <div className="flex flex-col gap-2">
              <SkeletonText className="w-2/3" />
              <SkeletonText className="w-1/2" />
              <Skeleton className="h-10 w-40" />
              <SkeletonPanel />
            </div>
          </Panel>
        </Section>

        <Section title="Toast + Dialog — live demos">
          <Panel>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setToast(true)}>Show toast</Button>
              <Button variant="secondary" onClick={() => setDialogOpen(true)}>Open dialog</Button>
            </div>
            <p className="mt-3 text-body-small text-muted">
              Sample: the dialog confirms removing a clip from the reel “Chinazom Godwin — highlights”
              (58 clips, 9:57, Rendered). Nothing is removed — the demo only closes.
            </p>
          </Panel>
        </Section>

        <Section title="Player — real data">
          <Panel title="Chinazom Godwin #4">
            <p className="text-body text-ink">
              DM · FC Ercakhu · Nigeria · Age 20 · 57 confirmed tracks in 2 videos · 9 min on camera · 20 events ·
              69% evidence coverage · Goals 0 · Assists 0
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-body-small text-muted">
              Reel: “Chinazom Godwin — highlights”, 58 clips, 9:57, Rendered <Play className="h-4 w-4 text-primary" aria-hidden />
            </p>
          </Panel>
        </Section>
      </div>

      {toast && (
        <Toast
          title="Reel rendered"
          message="Chinazom Godwin — highlights is ready."
          tone="success"
          actionLabel="Open in Reel Builder"
          actionHref="/reels"
          onClose={() => setToast(false)}
        />
      )}
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Remove clip from reel?"
        description="This removes the selected clip from “Chinazom Godwin — highlights”. The reel keeps its other 57 clips."
        primaryAction={{ label: "Remove", onClick: () => setDialogOpen(false) }}
        primaryVariant="danger"
        secondaryAction={{ label: "Keep clip", onClick: () => setDialogOpen(false) }}
      />
    </main>
  );
}
