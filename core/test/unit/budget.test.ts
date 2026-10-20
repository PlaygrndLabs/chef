import { describe, expect, it } from "vitest";
import { addSpend, costMicros, emptyLedger, monthOf, NO_CAPS, NO_COST, overCap, projectUsage, readCap, setCaps } from "../../src/usage/budget.ts";

describe("model spend", () => {
  it("prices tokens by model family and charges cache reads a tenth", () => {
    expect(costMicros("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2_000_000);
    expect(costMicros("claude-opus-5-5", { inputTokens: 0, outputTokens: 1_000_000 })).toBe(20_000_000);
    expect(costMicros("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 1_000_000 })).toBe(5_100_000);
    expect(costMicros("some-gateway-model", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(4_000_000);
  });

  it("prices routing and live talk, with audio at its own rate", () => {
    expect(costMicros("jev-1.13.0", { inputTokens: 1_000_000, outputTokens: 500 })).toBe(42_000);
    expect(costMicros("gpt-realtime", { inputTokens: 1_000_000, outputTokens: 1_000_000, audioInputTokens: 1_000_000, audioOutputTokens: 1_000_000 })).toBe(96_000_000);
    expect(costMicros("gpt-live-1", { inputTokens: 2_000_000, outputTokens: 0, audioInputTokens: 1_000_000 })).toBe(36_000_000);
  });

  it("adds spend to the org, the project and the person, and starts over each month", () => {
    let ledger = emptyLedger("2026-10");
    ledger = addSpend(ledger, "2026-10", "shop", "usr_a", 5);
    ledger = addSpend(ledger, "2026-10", "shop", null, 3);
    ledger = addSpend(ledger, "2026-10", "blog", "usr_a", 2);
    ledger = addSpend(ledger, "2026-10", "blog", null, 4, "voice");
    expect(ledger).toEqual({ month: "2026-10", org: 14, projects: { shop: 8, blog: 6 }, members: { usr_a: 7 }, parts: { model: 10, voice: 4 }, projectParts: { shop: { model: 8 }, blog: { model: 2, voice: 4 } } });
    expect(addSpend(ledger, "2026-11", "shop", null, 1, "router")).toEqual({ month: "2026-11", org: 1, projects: { shop: 1 }, members: {}, parts: { router: 1 }, projectParts: { shop: { router: 1 } } });
    expect(monthOf(Date.UTC(2026, 9, 31, 23, 59))).toBe("2026-10");
  });

  it("names the first budget that is reached", () => {
    const ledger = { month: "2026-10", org: 40_000_000, projects: { shop: 10_000_000 }, members: { usr_a: 5_000_000 } };
    expect(overCap(NO_CAPS, ledger, "2026-10", "shop", "usr_a")).toBeNull();
    expect(overCap({ ...NO_CAPS, org: 40_000_000 }, ledger, "2026-10", "shop", null)).toBe("The organization reached its monthly budget of $40.00.");
    expect(overCap({ ...NO_CAPS, projects: { shop: 10_000_000 } }, ledger, "2026-10", "shop", null)).toBe("This project reached its monthly budget of $10.00.");
    expect(overCap({ ...NO_CAPS, projects: { shop: 10_000_000 } }, ledger, "2026-10", "blog", null)).toBeNull();
    expect(overCap({ ...NO_CAPS, members: { usr_a: 5_000_000 } }, ledger, "2026-10", "shop", "usr_a")).toBe("The person who asked for this reached their monthly budget of $5.00.");
    expect(overCap({ ...NO_CAPS, members: { usr_a: 5_000_000 } }, ledger, "2026-10", "shop", "usr_b")).toBeNull();
    expect(overCap({ ...NO_CAPS, org: 40_000_000 }, ledger, "2026-11", "shop", null)).toBeNull();
  });

  it("reads budgets in dollars and clears them with null", () => {
    expect(readCap(12.5)).toBe(12_500_000);
    expect(readCap(null)).toBeNull();
    expect(readCap(-1)).toBeUndefined();
    expect(readCap("5")).toBeUndefined();
    const caps = setCaps(NO_CAPS, { org: 100, projects: { shop: 10 }, members: { usr_a: 1 } });
    expect(setCaps(caps, { projects: { shop: null }, members: { usr_b: 2 } })).toEqual({ org: 100, projects: {}, members: { usr_a: 1, usr_b: 2 } });
  });
});

describe("project usage", () => {
  it("lists every build's cost newest first, with the month's parts and main's sandbox", () => {
    const ledger = addSpend(addSpend(emptyLedger("2026-10"), "2026-10", "shop", null, 30), "2026-10", "shop", null, 12, "sandbox");
    const session = (id: string, createdAt: number) => ({ id, featureId: `f-${id}`, createdAt, plan: { feature: { title: `Build ${id}` } }, machine: { state: "merged" as const } });
    const costs = new Map([
      ["s1", { model: 20, sandbox: 5, sandboxSeconds: 60 }],
      ["shop--main", { model: 0, sandbox: 7, sandboxSeconds: 90 }],
    ]);
    const usage = projectUsage({ project: "shop", caps: { ...NO_CAPS, projects: { shop: 100 } }, ledger, sessions: [session("s1", 1), session("s2", 2)], costs, main: "shop--main" });
    expect(usage).toMatchObject({ month: "2026-10", spent: 42, cap: 100, parts: { model: 30, sandbox: 12 }, main: { sandbox: 7 } });
    expect(usage.builds.map((b) => [b.id, b.title, b.cost])).toEqual([
      ["s2", "Build s2", NO_COST],
      ["s1", "Build s1", { model: 20, sandbox: 5, sandboxSeconds: 60 }],
    ]);
  });
});
