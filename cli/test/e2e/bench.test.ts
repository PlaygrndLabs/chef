import { describe, expect, it } from "vitest";
import { BENCH_ITEMS } from "../../src/bench/items.ts";
import { runBench, runReplay } from "../../src/bench/run.ts";

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
  it("a replay seeded with the learned memory does not repeat a reverted mistake and lint catches vacuous tests", { timeout: 300_000 }, async () => {
    const items = BENCH_ITEMS.filter((item) => ["shout", "slug", "word-count", "reverse"].includes(item.id));
    const [learning, replay] = await runReplay(items);

    expect(learning.mergedFeatures).toBe(4);
    expect(learning.reverts).toBe(1);
    expect(learning.memory.lessons).toEqual([expect.stringMatching(/^memory\/lessons\/reverse-[0-9a-f]{12}\.md$/)]);
    expect(learning.memory.rulesAdded).toHaveLength(1);
    expect(learning.memory.featureMapFailures).toBe(0);

    expect(replay.mergedFeatures).toBe(4);
    expect(replay.reverts).toBe(0);
    expect(replay.memory.lessonRecalls).toBeGreaterThan(0);
    expect(replay.memory.featureMapFailures).toBe(0);
    const byId = new Map(replay.items.map((item) => [item.id, item]));
    for (const id of ["shout", "slug", "word-count"]) expect(byId.get(id)?.rejected).toEqual({ "project-lint": 1 });
    expect(byId.get("reverse")?.rejected).toEqual({});
  });
});
