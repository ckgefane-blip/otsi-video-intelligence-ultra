/**
 * A team's short code for a scoreboard (owner 2026-11-02: Cyrillic team names showed as "—"). The club's own short name when one is
 * recorded; otherwise letters of any script: the first three letters of a one-word name, the initials of a longer one. Short words such
 * as "FC" / "ФК" are dropped when the name has a longer word. No name: "—".
 */
export function teamCode(name: string | null | undefined, short?: string | null): string {
  if (short && short.trim()) return short.trim().toUpperCase().slice(0, 4);
  const words = (name ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const main = words.some((w) => w.length > 2) ? words.filter((w) => w.length > 2) : words;
  if (!main.length) return "—";
  const c = main.length === 1 ? main[0]!.slice(0, 3) : main.map((w) => w[0]).join("").slice(0, 3);
  return c.toLocaleUpperCase();
}
