"use client";
/**
 * Shared billing pieces (ADR-144, ultra-only): the pro-forma invoice card, the final receipt card, the
 * order's plain-wording status, and the print hook. The invoice and the receipt are print views only —
 * the browser's print / save-as-PDF does the printing; no PDF library, no PDF generation. Amounts are
 * always in minor units (kobo / cents) and formatted here, never re-derived.
 */
import type { BankTransferOrder, ProFormaInvoice } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";

export const money = (minor: number, currency: string) =>
  currency === "NGN" ? `₦${(minor / 100).toLocaleString("en-NG")}` : `$${(minor / 100).toFixed(2)}`;

export const planMonths = (periodMonths: number, w: { blMonth1: string; blMonths12: string }) =>
  periodMonths === 1 ? w.blMonth1 : w.blMonths12.replace("{a}", String(periodMonths));

/** Print one section at a time: the caller marks a section print-active and this calls window.print()
 *  once the DOM has updated, then clears the mark when the print dialog closes. */
export function usePrintTarget() {
  const [target, setTarget] = useState<"invoice" | "receipt" | null>(null);
  useEffect(() => {
    if (!target) return;
    const done = () => setTarget(null);
    window.addEventListener("afterprint", done);
    window.print();
    const fallback = window.setTimeout(done, 5000);
    return () => {
      window.removeEventListener("afterprint", done);
      window.clearTimeout(fallback);
    };
  }, [target]);
  return { target, print: setTarget };
}

/** The order's status in plain wording (docs/bank-transfer-web-ui.md §1). */
export function OrderStatusLabel({ order }: { order: BankTransferOrder }) {
  const { t } = useLocale();
  const w = t.body.wallet;
  switch (order.status) {
    case "ORDERED":
      return <span>{w.blOrderPlaced}</span>;
    case "AWAITING_CONFIRMATION":
      return <span>{w.blAwaiting}</span>;
    case "PARTIAL":
      return (
        <span>
          {w.blPartPaid.replace("{a}", money(order.amount_received_minor, order.currency)).replace("{b}", money(order.amount_minor, order.currency))}
        </span>
      );
    case "CONFIRMED":
      return <span>{w.blConfirmed}</span>;
    case "REJECTED":
      return <span>{w.blRejected.replace("{a}", order.reject_reason ?? "—")}</span>;
    case "REFUNDED":
      return <span>{w.blRefunded}</span>;
  }
}

/** The pro-forma invoice for one order: reference, bank details, amount, plan + period, expiry. This is
 *  the only place a non-admin caller ever sees bank details — and only for their own order. */
export function InvoiceCard({ invoice, printActive }: { invoice: ProFormaInvoice; printActive?: boolean }) {
  const { t } = useLocale();
  const w = t.body.wallet;
  const [copied, setCopied] = useState(false);
  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(invoice.reference);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch { /* clipboard unavailable: the reference is on screen to copy by hand */ }
  };
  return (
    <section data-print-area="invoice" className={printActive ? "print-active" : ""} aria-labelledby="inv">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 id="inv" className="h3">{w.blYourInvoice}</h2>
        <button type="button" className="btn sm" onClick={() => void copyRef()}>
          {copied ? w.blRefCopied : w.blCopyRef}
        </button>
      </div>
      <dl className="kv">
        <dt>{w.blReference}</dt>
        <dd className="font-normal">{invoice.reference}</dd>
        <dt>{w.blAmountToPay}</dt>
        <dd>{money(invoice.amount_minor, invoice.currency)}</dd>
        <dt>{w.blPlan}</dt>
        <dd>{invoice.plan_code} · {planMonths(invoice.period_months, w)}</dd>
        <dt>{w.blOrderExpires}</dt>
        <dd>{new Date(invoice.expires_at).toLocaleString()}</dd>
      </dl>
      <p className="sm mu mt-2">{invoice.pay_reference_note}</p>
      <h3 className="t-panel mt-3">{w.blBankDetails}</h3>
      <dl className="kv mt-1">
        <dt>{w.blAccountName}</dt>
        <dd>{invoice.bank_account.account_name}</dd>
        <dt>{w.blBank}</dt>
        <dd>{invoice.bank_account.bank_name}</dd>
        <dt>{w.blAccountNumber}</dt>
        <dd>{invoice.bank_account.account_number}</dd>
        {invoice.bank_account.swift_iban && (
          <>
            <dt>{w.blSwift}</dt>
            <dd>{invoice.bank_account.swift_iban}</dd>
          </>
        )}
        <dt>{w.currencyAria}</dt>
        <dd>{invoice.bank_account.currency}</dd>
      </dl>
    </section>
  );
}

/** The final receipt for a confirmed order: what was paid, when it was confirmed, and what it bought.
 *  The wallet PURCHASE ledger row is the same receipt in the ledger; this is the printable view of it. */
export function ReceiptCard({ order, printActive }: { order: BankTransferOrder; printActive?: boolean }) {
  const { t } = useLocale();
  const w = t.body.wallet;
  return (
    <section data-print-area="receipt" className={printActive ? "print-active" : ""} aria-labelledby="rcpt">
      <div className="flex items-center justify-between gap-2 pb-1">
        <h2 id="rcpt" className="h3">{w.blReceiptTitle}</h2>
      </div>
      <p className="t-body">{w.blReceiptPaid}</p>
      <dl className="kv mt-1.5">
        <dt>{w.blReference}</dt>
        <dd className="font-normal">{order.reference}</dd>
        <dt>{w.blAmountToPay}</dt>
        <dd>{money(order.amount_received_minor, order.currency)}</dd>
        <dt>{w.blDateConfirmed}</dt>
        <dd>{order.confirmed_at ? new Date(order.confirmed_at).toLocaleString() : "—"}</dd>
        <dt>{w.blTokensCredited}</dt>
        <dd>{order.tokens_granted}</dd>
        <dt>{w.blPlan}</dt>
        <dd>{order.plan_code} · {planMonths(order.period_months, w)}</dd>
      </dl>
    </section>
  );
}
