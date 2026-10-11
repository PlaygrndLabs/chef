import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cpaInit, upsertVars } from "../../src/cpa/init.ts";

describe("cpa init", () => {
  it("writes a private config and worker vars, and keeps the key on rerun", () => {
    const root = mkdtempSync(join(tmpdir(), "kargah-cpa-"));
    const first = cpaInit(root);
    const config = JSON.parse(readFileSync(first.config, "utf8")) as { port: number; "api-keys": string[] };
    expect(first.created).toBe(true);
    expect(config.port).toBe(8317);
    expect(config["api-keys"][0]).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(first.config).mode & 0o077).toBe(0);
    expect(readFileSync(first.devVars, "utf8")).toContain(`CPA_API_KEY=${config["api-keys"][0]}`);
    const second = cpaInit(root);
    expect(second.created).toBe(false);
    expect(readFileSync(second.devVars, "utf8").match(/CPA_API_KEY=/g)).toHaveLength(1);
  });

  it("replaces only the CPA lines in existing vars", () => {
    expect(upsertVars("TYPESAFE_API_KEY=x\nCPA_API_KEY=old\n", { CPA_API_KEY: "new" })).toBe("TYPESAFE_API_KEY=x\nCPA_API_KEY=new\n");
  });
});
