import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin/AdminConsole";

export const metadata: Metadata = { title: "Admin Console" };

/**
 * Account / Governance > Admin console: Members, Model Registry, Worker Concurrency & Audit Logs.
 * Available to Owners and Admins (v3 Phase D.3, ADR-111).
 */
export default function AdminPage() {
  return <AdminConsole />;
}
