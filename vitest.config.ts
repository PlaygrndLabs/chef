import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["{core,adapters,cli,workers,site,apps/*}/test/unit/**/*.test.ts"], environment: "node" } },
      { test: { name: "e2e", include: ["{core,adapters,cli,workers}/test/e2e/**/*.test.ts"], environment: "node", testTimeout: 120_000 } },
    ],
  },
});
