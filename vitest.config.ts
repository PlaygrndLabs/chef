import { defineConfig } from "vitest/config";

const durableObjects = { "cloudflare:workers": new URL("./site/test/support/durable-object.ts", import.meta.url).pathname };

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["{core,adapters,cli,workers,site,apps/*}/test/unit/**/*.test.ts"], environment: "node", alias: durableObjects } },
      { test: { name: "e2e", include: ["{core,adapters,cli,workers}/test/e2e/**/*.test.ts"], environment: "node", testTimeout: 120_000 } },
    ],
  },
});
