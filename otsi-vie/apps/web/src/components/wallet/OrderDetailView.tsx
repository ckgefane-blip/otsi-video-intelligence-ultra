"use client";
/**
 * The order's own page (ADR-144, ultra-only; docs/bank-transfer-web-ui.md §1–2): the pro-forma invoice
 * with the owner's bank details, the proof section ("I have paid" + optional receipt upload), and the
 * final receipt once the order is confirmed. Both the invoice and the receipt are print views only —
 * the browser's print / save-as-PDF does the printing; no PDF library, no PDF generation.
 */
import type { OrderWithInvoice } from "@otsi-vie/contracts";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiProblem, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { InvoiceCard, OrderStatusLabel, ReceiptCard, money, planMonths, usePrintTarget } from "./BillingShared";

const RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const RECEIPT_MAX = 10 * 1024 * 1024;

export function OrderDetailView({ orderId }: { orderId: string }) {
  const { t } = useLocale();
  const w = t.body.wallet;
  const [data, setData] = useState<OrderWithInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { target, print } = usePrintTarget();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<OrderWithInvoice>(`/v1/billing/orders/${orderId}`));
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : w.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) {
    return <main className="flex min-h-64 flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></main>;
  }
  if (!data) {
    return (
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto px-7 py-3" data-page="settings-billing-order">
        <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error ?? w.loadFailed}</p>
        <Link href="/settings/billing" className="sm text-primary hover:underline">{w.blBackToOrders}</Link>
      </main>
    );
  }
  const { order, invoice } = data;
  const open = order.status === "ORDERED" || order.status === "PARTIAL" || order.status === "AWAITING_CONFIRMATION";

  async function markPaid() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await api(`/v1/billing/orders/${order.id}/proof`, { method: "POST", json: note.trim() ? { note: note.trim() } : {} });
      setNotice(w.blMarkedPaid);
      await load();
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : w.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function uploadReceipt(file: File) {
    if (!RECEIPT_TYPES.includes(file.type)) { setError(w.blReceiptType); return; }
    if (file.size > RECEIPT_MAX) { setError(w.blReceiptSize); return; }
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await api(`/v1/billing/orders/${order.id}/proof`, {
        method: "POST",
        body: file,
        headers: { "content-type": "application/octet-stream", "x-content-type": file.type, "x-file-name": file.name },
      });
      setNotice(w.blProofUploaded);
      await load();
    } catch (e) {
      if (e instanceof ApiProblem && e.code === "PROOF_STORAGE_UNAVAILABLE") {
        setError(w.blNoStorage);
      } else {
        setError(e instanceof ApiProblem ? e.message : w.actionFailed);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto px-7 py-3" data-page="settings-billing-order">
      <div className="flex flex-col gap-0.5">
        <span className="eb">{t.desktop.navSettings}</span>
        <h1 className="h1">{order.reference}</h1>
        <p className="t-body text-muted">
          {order.plan_code} · {planMonths(order.period_months, w)} · {money(order.amount_minor, order.currency)} · <OrderStatusLabel order={order} />
        </p>
      </div>
      <Link href="/settings/billing" className="sm text-primary hover:underline">{w.blBackToOrders}</Link>

      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-ctl border border-ok/50 bg-ok/10 px-3 py-2 t-body text-ok">{notice}</p>}

      <section className="rounded-lg border border-line bg-canvas p-4">
        <InvoiceCard invoice={invoice} printActive={target === "invoice"} />
        <button type="button" className="btn sm mt-3" onClick={() => print("invoice")}>{w.blPrintInvoice}</button>
      </section>

      {order.status === "CONFIRMED" && (
        <section className="rounded-lg border border-line bg-canvas p-4">
          <ReceiptCard order={order} printActive={target === "receipt"} />
          <button type="button" className="btn sm mt-3" onClick={() => print("receipt")}>{w.blPrintReceipt}</button>
        </section>
      )}

      <section className="rounded-lg border border-line bg-canvas p-4" aria-labelledby="proof">
        <h2 id="proof" className="h3">{w.blHavePaid}</h2>
        {!open ? (
          <p className="sm mu mt-1">{w.blOrderClosed}</p>
        ) : (
          <>
            <label className="mt-2 flex flex-col gap-1">
              <span className="t-small text-muted">{w.blPaidNote}</span>
              <input type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn pri sm" disabled={busy} onClick={() => void markPaid()}>
                {busy ? w.requesting : w.blMarkPaid}
              </button>
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReceipt(f); e.target.value = ""; }} />
              <button type="button" className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                {w.blUploadBtn}
              </button>
            </div>
            <p className="sm mu mt-2">{w.blUploadReceipt}</p>
            {order.proof_filename && (
              <p className="sm mu mt-1">
                {w.blProofFile}: {order.proof_filename}
                {order.proof_uploaded_at ? ` · ${new Date(order.proof_uploaded_at).toLocaleString()}` : ""}
                {order.proof_note ? ` · ${order.proof_note}` : ""}
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
