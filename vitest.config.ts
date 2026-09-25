import { defineConfig } from "vitest/config";

// Separate from vite.config.ts so tests never load the dev-server plugin.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    passWithNoTests: true,
  },
});
