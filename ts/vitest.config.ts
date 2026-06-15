import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{core,lib,cli}/src/**/*.test.ts"],
    environment: "node",
  },
});
