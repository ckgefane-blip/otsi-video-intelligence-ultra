import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-card border border-line bg-panel p-6 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-sm text-muted">That page, video or player does not exist, or you cannot see it.</p>
      <Link href="/dashboard" className="mt-4 inline-block rounded-ctl bg-primary px-4 py-2 font-semibold text-white">Go to Home</Link>
    </div>
  );
}
