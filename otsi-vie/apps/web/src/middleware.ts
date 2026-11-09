/**
 * Route identifiers are validated before anything renders, so a malformed video id or player reference is a real HTTP 404 (the pages
 * validate again). A player is addressed by the exact canonical OTSI Player ID or an internal player UUID — never a jersey or track number.
 */
import { NextResponse, type NextRequest } from "next/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL = /^OTSI-[A-Z]{3}-[0-9]{4}-[0-9]{6}$/;

export function middleware(req: NextRequest) {
  const parts = req.nextUrl.pathname.split("/");
  const valid = parts[1] === "videos" ? UUID.test(parts[2] ?? "") : (() => {
    const ref = decodeURIComponent(parts[3] ?? "");
    return CANONICAL.test(ref) || UUID.test(ref);
  })();
  // a path no route serves: Next.js answers it with the not-found page and status 404
  return valid ? NextResponse.next() : NextResponse.rewrite(new URL("/_invalid-identifier", req.url));
}

export const config = { matcher: ["/videos/:id/:path*", "/reports/players/:ref"] };
