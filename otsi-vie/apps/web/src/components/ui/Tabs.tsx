"use client";

import { cx } from "./cx";

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

/** Spec §4 Tabs: text tabs with a 2px primary underline on the active tab. */
export function Tabs({ tabs, activeId, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cx("flex gap-4 border-b border-line", className)}>
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cx(
              "-mb-px border-b-2 px-1 pb-2 text-button transition-colors duration-150 ease-in-out",
              active ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
