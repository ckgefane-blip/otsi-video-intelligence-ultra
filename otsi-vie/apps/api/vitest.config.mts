import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC compiles the NestJS decorators (with metadata) the way tsc does; tests hit a real, freshly migrated MySQL 8.4.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
