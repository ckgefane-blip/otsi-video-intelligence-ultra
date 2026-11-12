"use client";
/**
 * Desktop UI v2 top bar (owner-approved Source of Truth, 2026-11-11), above every app page: the work context (project / match /
 * player, ADR-069), search and commands (Ctrl/Cmd+K, ADR-070), notifications (ADR-075), the Jobs Center (ADR-060), the keyboard map
 * ("?", ADR-071) and the account. Every widget is the existing one: only its place changed (the header's tab strip moved to AppRail).
 */
import type { WalletBalance } from "@otsi-vie/contracts";
import { Search } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { KEYMAP_EVENT } from "@/lib/keymap";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import styles from "./AppTopBar.module.css";
import { CommandPalette } from "./CommandPalette";
import { ContextBar } from "./ContextBar";
import { JobTray } from "./JobTray";
import { KeyboardMap } from "./KeyboardMap";
import { NotificationBell } from "./NotificationBell";
import { ProfileChip } from "./ProfileChip";

/** Live token balance in the top bar (GET /v1/wallet), amber while below 90. */
function TokenPill() {
  const { t } = useLocale();
  const [balance, setBalance] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api<WalletBalance>("/v1/wallet").then((x) => live && setBalance(x.spendable_balance), () => live && setBalance(null));
    return () => { live = false; };
  }, []);
  const value = balance === undefined ? "…" : balance === null ? "—" : String(balance);
  const low = typeof balance === "number" && balance < 90;
  return (
    <span
      data-tokens
      title={t.desktop.tokens}
      style={{ color: low ? "rgb(var(--amber))" : "rgb(var(--ink2))", fontSize: 11, lineHeight: "16px", whiteSpace: "nowrap" }}
    >
      {t.desktop.tokens} {value}
    </span>
  );
}

export function AppTopBar() {
  const { t } = useLocale();
  const [search, setSearch] = useState(false);
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
      <NotificationBell styles={styles} />
      <JobTray styles={styles} />
      <button type="button" className={styles.keys} aria-label={t.desktop.shortcuts} title={t.desktop.shortcuts}
        onClick={() => window.dispatchEvent(new Event(KEYMAP_EVENT))} data-keymap-open>?</button>
      <TokenPill />
      <ProfileChip styles={styles} />
      <CommandPalette open={search} onOpenChange={setSearch} />
      <KeyboardMap />
    </header>
  );
}
