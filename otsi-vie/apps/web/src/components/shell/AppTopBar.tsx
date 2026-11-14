"use client";
/**
 * The top bar (SOT rebuild 2026-11-13): the SOT's order, left to right — work context (Project / Match / Player, on every shelled
 * page), search, token counter, theme, Jobs Center, notifications bell, "?" (a link to the Shortcuts page), account.
 *
 * The SOT's search, token, jobs, bell and "?" are page links, not drawers, popovers or modals: the token counter links to the
 * Wallet, Jobs Center to the jobs page, "?" to /shortcuts. The search keeps opening the CommandPalette modal (the task's call:
 * only its label and kbd change); the KeyboardMap modal stays mounted for the "?" key and the palette's shortcuts command.
 */
import { Gift, Search } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useLocale } from "@/lib/i18n";
import styles from "./AppTopBar.module.css";
import { CommandPalette } from "./CommandPalette";
import { ContextBar } from "./ContextBar";
import { InviteCard } from "./InviteCard";
import { JobTray } from "./JobTray";
import { KeyboardMap } from "./KeyboardMap";
import { NotificationBell } from "./NotificationBell";
import { ProfileChip } from "./ProfileChip";
import { ThemeSwitch } from "./ThemeSwitch";
import { TokenCounter } from "./TokenCounter";

export function AppTopBar() {
  const { t } = useLocale();
  const [search, setSearch] = useState(false);
  const [invite, setInvite] = useState(false);
  return (
    <header className={styles.bar} data-section="shell-header">
      <div className={styles.ctx}>
        <Suspense fallback={null}><ContextBar /></Suspense>
      </div>
      <button type="button" className={styles.search} onClick={() => setSearch(true)} aria-label={t.shell.searchAndCommands}
        title={t.shell.searchHint} data-header-search>
        <Search className={styles.searchIcon} aria-hidden />
        <span className={styles.searchText}>{t.shell.searchAndCommands}</span>
        <span className="vie-kbd">Ctrl K</span>
      </button>
      <TokenCounter />
      {/* Invite card (owner decision 2026-11-14): the gift button opens a small card over the current
          page instead of navigating to /invite-share — you do not lose your place. /invite-share stays
          as the address for direct links. */}
      <button type="button" className={styles.gift} onClick={() => setInvite(true)} aria-label={t.body.shell.invite} title={t.body.shell.invite} data-header-invite>
        <Gift className={styles.giftIcon} aria-hidden />
      </button>
      <Link href="/settings/billing" className="btn sm" data-upgrade title={t.body.plans.title}>{t.body.plans.upgrade}</Link>
      <ThemeSwitch />
      <JobTray styles={styles} />
      <NotificationBell styles={styles} />
      <Link href="/shortcuts" className={styles.keys} aria-label={t.desktop.shortcuts} title={t.desktop.shortcuts}>?</Link>
      <ProfileChip styles={styles} />
      <CommandPalette open={search} onOpenChange={setSearch} />
      <InviteCard open={invite} onOpenChange={setInvite} />
      <KeyboardMap />
    </header>
  );
}
