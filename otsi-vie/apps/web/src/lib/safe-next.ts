/** Only same-app paths are accepted as a return address after sign-in (no open redirect: no "//host", "/\host" or absolute URLs). */
export function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : "/dashboard";
}
