/**
 * The app's own identity for its window and taskbar (owner 2026-11-05: a standalone app on this PC, opened by the desktop icon in its own
 * window). Icons: src/app/icon.png (the OTSI VIE tile) and favicon.ico (the logo mark, for 16-48 px where the tile's text cannot be read).
 */
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OTSI VIE",
    short_name: "OTSI VIE",
    description: "OTSI Video Intelligence Engine",
    start_url: "/",
    display: "standalone",
    background_color: "#050d1c",
    theme_color: "#050d1c",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
