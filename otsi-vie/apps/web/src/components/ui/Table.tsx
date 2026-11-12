"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  cellClassName?: string;
}

export interface TableProps<T> {
  columns: Array<TableColumn<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  sortKey?: string | undefined;
  sortDirection?: "asc" | "desc" | undefined;
  onSort?: (key: string) => void;
  emptyMessage?: string;
  className?: string;
}

/**
 * Spec §4 Table: 12px muted uppercase header, 48px rows, 1px line dividers,
 * hover raised, sortable headers. Virtualisation past 100 rows is a page
 * concern, not the kit's — the kit renders the rows it is given.
 */
export function Table<T>({ columns, rows, rowKey, sortKey, sortDirection, onSort, emptyMessage, className }: TableProps<T>) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line">
            {columns.map((col) => (
              <th key={col.key} scope="col" className="px-3 py-2 text-left text-table-header uppercase text-muted">
                {col.sortable && onSort ? (
                  <button type="button" onClick={() => onSort(col.key)} className="inline-flex items-center gap-1 hover:text-ink" aria-sort={sortKey === col.key ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}>
                    {col.header}
                    {sortKey === col.key ? (
                      sortDirection === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />
                    ) : (
                      <ArrowUpDown className="h-3 w-3" aria-hidden />
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="h-12 border-b border-line last:border-b-0 hover:bg-raised">
              {columns.map((col) => (
                <td key={col.key} className={cx("px-3 py-2 text-body text-ink", col.cellClassName)}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && emptyMessage && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-body-small text-muted">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
