"use client";
/**
 * Page 01 Section 01 — global header and navigation, shared by every page, as in the approved design (corrected reference
 * 01_HOME_OVERVIEW at 2560 x 1440): wordmark, the ten destinations in the approved order, the job tray (v3 Phase A.3, ADR-060: an icon with
 * the number of active jobs, next to the account), display chip, and the signed-in account.
 * v3 Phase A.8 (S03, ADR-070): a search button between the navigation and the divider opens the search and command palette (also Ctrl/Cmd+K);
 * the header has no room for a field at the approved tab widths, so the field opens over the page.
 * v3 Phase A.9 (S14, ADR-071): the keyboard map, "?" on every page.
 * v3 Phase A.1 (ADR-069): each destination opens on the work context (the match, player and reel last open, lib/workContext.ts).
 * v3 Phase A.15 (S13, ADR-075): the notifications bell between search and the job tray; the divider made room for it and the display chip
 * is narrower (its label is smaller).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { EMPTY_CTX, navHref, onCtx, readCtx } from "@/lib/workContext";
import { navItems } from "@/lib/pages";
import styles from "./AppHeader.module.css";
import { CommandPalette } from "./CommandPalette";
import { JobTray } from "./JobTray";
import { KeyboardMap } from "./KeyboardMap";
import { NotificationBell } from "./NotificationBell";
import { ProfileChip } from "./ProfileChip";

/** Each destination's tab, in design pixels: left edge and width (label-centred cells; Home's frame is the reference's 328 / 169). */
const TABS: Record<string, [number, number]> = {
  Home: [328, 169], Upload: [501, 167.75], Processing: [672.75, 168.75], Analysis: [845.5, 171.25], Tactical: [1020.75, 170],
  "Reel Builder": [1194.75, 169.5], "Clip Studio": [1368.25, 170.25], "Player Report": [1542.5, 170.25], Library: [1716.75, 169.5], Export: [1890.75, 169.5],
};

/** The display class this screen gives the design stage (physical pixels): a fact about this device, not a setting. */
function useDisplayClass(): { label: string; detail: string } {
  const [d, setD] = useState({ label: "QHD", detail: "" });
  useEffect(() => {
    const measure = () => {
      const w = Math.round(window.screen.width * window.devicePixelRatio), h = Math.round(window.screen.height * window.devicePixelRatio);
      const label = w >= 3840 ? "4K" : w >= 2560 ? "QHD" : w >= 1920 ? "FHD" : "HD";
      setD({ label, detail: `Display ${w} × ${h}; this layout is designed for 2560 × 1440 (QHD)` });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return d;
}

export function AppHeader() {
  const items = navItems(usePathname() ?? "/");
  const [ctx, setCtx] = useState(EMPTY_CTX);
  useEffect(() => { setCtx(readCtx()); return onCtx(() => setCtx(readCtx())); }, []);
  const display = useDisplayClass();
  const [search, setSearch] = useState(false);
  return (
    <header className={styles.bar} data-section="shell-header">
      <div className={styles.stage}>
        <Link href="/dashboard" className={styles.brand} aria-label="OTSI VIE home" data-owner-asset="logo">
          {/* the OTSI brand logo (owner-supplied asset, 2026-10-30) followed by the product name */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/otsi-logo.png" alt="OTSI" className={styles.logo} draggable={false} />
          <span className={`${styles.word} ${styles.wordVie}`}>VIE</span>
          <span className={styles.tagline}>VIDEO INTELLIGENCE ENGINE</span>
        </Link>
        <nav aria-label="Main" className={styles.nav}>
          {items.map((item) => {
            const [x, w] = TABS[item.label] ?? [0, 0];
            return (
              <Link key={item.label} href={navHref(item.label, item.href, ctx)} aria-current={item.active ? "page" : undefined} className={styles.tab}
                style={{ left: `calc(${x} * var(--u))`, width: `calc(${w} * var(--u))` }}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button type="button" className={`${styles.abs} ${styles.search}`} onClick={() => setSearch(true)} aria-label="Search and commands (Ctrl+K)"
          title="Search matches, players, reels and projects, or run a command (Ctrl+K)" data-header-search>
          <Search className={styles.searchIcon} aria-hidden />
        </button>
        <NotificationBell styles={styles} />
        <JobTray styles={styles} />
        <span className={`${styles.abs} ${styles.chip}`} title={display.detail} data-display-class={display.label}>{display.label}</span>
        <ProfileChip styles={styles} />
        <CommandPalette open={search} onOpenChange={setSearch} />
        <KeyboardMap />
      </div>
    </header>
  );
}
