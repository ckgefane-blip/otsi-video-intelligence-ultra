"use client";

import Link from "next/link";
import { useLocale } from "@/lib/i18n";

export default function NotFound() {
  const { t } = useLocale();
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-card border border-line bg-panel p-6 text-center">
      <h1 className="text-2xl font-semibold">{t.body.auth.notFound}</h1>
      <p className="mt-2 text-sm text-muted">{t.body.auth.notFoundDesc}</p>
      <Link href="/dashboard" className="mt-4 inline-block rounded-ctl bg-primary px-4 py-2 font-semibold text-white">{t.body.auth.goHome}</Link>
    </div>
  );
}
