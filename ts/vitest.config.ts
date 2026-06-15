import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{core,lib,cli}/src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      // `json` emits coverage-final.json — the Istanbul artifact the coverage
      // analyzer ingests when we dogfood the tool against this repo.
      reporter: ["text", "json"],
      // Transient test output belongs in the gitignored _local workspace, not
      // interleaved with source (see CONVENTIONS §_local).
      reportsDirectory: "../_local/tmp/coverage",
      include: ["{core,lib,cli}/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.integration.test.ts"],
    },
  },
});
