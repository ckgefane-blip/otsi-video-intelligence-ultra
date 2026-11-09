/**
 * Next.js configuration. Security headers are set for every route (threat model 3.1 / 3.9). The browser talks to the API only through
 * this app's own origin (`/api/*` is proxied to the API), so the refresh cookie stays first-party and connect-src is 'self'.
 * No third-party scripts, fonts or images are loaded at runtime.
 */
const api = process.env.OTSI_VIE_API_INTERNAL_URL ?? "http://127.0.0.1:4520";
const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts; 'unsafe-eval' only for the dev server's fast refresh
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  `connect-src 'self'${dev ? " ws:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@otsi-vie/contracts"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },                 // never listed by search engines (owner preview)
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      ],
    }, {
      // signed media (videos, player report PDFs): this app's own pages may show them in a frame (the shared report page, ADR-056); the
      // file is not a page of the app, so it gets only the framing rule (last match wins in Next.js)
      source: "/api/v1/media/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
      ],
    }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
};

export default config;
