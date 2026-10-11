import { describe, expect, it } from "vitest";
import { BENCH_ITEMS } from "../../src/bench/items.ts";
import { runBench } from "../../src/bench/run.ts";

describe("benchmark", () => {
  it("phase 3 settings revert less than phase 2 settings on the same features", { timeout: 180_000 }, async () => {
    const items = BENCH_ITEMS.filter((item) => item.id === "shout" || item.id === "reverse");
    const phase2 = await runBench("phase2", items);
    const phase3 = await runBench("phase3", items);

    expect(phase2.mergedFeatures).toBe(2);
    expect(phase3.mergedFeatures).toBe(2);
    expect(phase2.reverts).toBe(2);
    expect(phase3.reverts).toBe(0);
    expect(phase3.revertRate).toBeLessThan(phase2.revertRate);
    expect(phase3.violationsOnMain).toEqual([]);
    const byId = new Map(phase3.items.map((item) => [item.id, item]));
    expect(byId.get("shout")?.rejected).toEqual({ "red-tests": 2 });
    expect(byId.get("reverse")?.picked).toBe("attempt 2");
  });
});
