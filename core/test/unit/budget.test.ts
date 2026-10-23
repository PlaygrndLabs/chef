import { describe, expect, it } from "vitest";
import { addCost, addSpend, archiveProject, costMicros, emptyMonth, ledgerOf, monthOf, NO_CAPS, NO_COST, overCap, PARTS, PROJECT_COST, projectUsage, readCap, setCaps, SPEND_PARTS, sumOf } from "../../src/usage/budget.ts";

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

  it("adds spend to the project and the person by part, and totals them for the org", () => {
    let month = emptyMonth("2026-10");
    month = addSpend(month, "shop", "usr_a", 5);
    month = addSpend(month, "shop", null, 3);
    month = addSpend(month, "blog", "usr_a", 2);
    month = addSpend(month, "blog", null, 4, "voice");
    expect(month).toEqual({ month: "2026-10", projects: { shop: { model: 8 }, blog: { model: 2, voice: 4 } }, members: { usr_a: { model: 7 } } });
    expect(ledgerOf(month)).toEqual({ month: "2026-10", org: 14, projects: { shop: 8, blog: 6 }, members: { usr_a: 7 }, parts: { model: 10, voice: 4 }, projectParts: { shop: { model: 8 }, blog: { model: 2, voice: 4 } } });
    expect(monthOf(Date.UTC(2026, 9, 31, 23, 59))).toBe("2026-10");
  });

  it("moves a deleted project's spend under its deleted name, so a new project of the same name starts at zero", () => {
    let month = addSpend(addSpend(emptyMonth("2026-10"), "shop", "usr_a", 5), "blog", null, 2, "sandbox");
    month = archiveProject(month, "shop");
    expect(month.projects).toEqual({ blog: { sandbox: 2 }, "shop (deleted)": { model: 5 } });
    month = archiveProject(addSpend(month, "shop", null, 3, "sandbox"), "shop");
    expect(month.projects).toEqual({ blog: { sandbox: 2 }, "shop (deleted)": { model: 5, sandbox: 3 } });
    expect(ledgerOf(month).org).toBe(10);
    expect(month.members).toEqual({ usr_a: { model: 5 } });
    expect(archiveProject(month, "gone")).toBe(month);
  });

  it("names every part once, in a group that decides its column", () => {
    expect(SPEND_PARTS).toEqual(["model", "router", "voice", "sandbox"]);
    expect(SPEND_PARTS.every((part) => PARTS[part].label.length > 0)).toBe(true);
    expect(sumOf({ model: 3, router: 1, sandbox: 2 }, "models")).toBe(4);
    expect(sumOf({ model: 3, router: 1, sandbox: 2 }, "cloudflare")).toBe(2);
    expect(sumOf({ model: 3, router: 1, sandbox: 2 })).toBe(6);
  });

  it("names the first budget that is reached", () => {
    const ledger = { month: "2026-10", org: 40_000_000, projects: { shop: 10_000_000 }, members: { usr_a: 5_000_000 }, parts: {}, projectParts: {} };
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
  it("shows this month's cost of each build, main's app and the project chat, newest build first", () => {
    const ledger = ledgerOf(addSpend(addSpend(emptyMonth("2026-10"), "shop", null, 32), "shop", null, 12, "sandbox"));
    const session = (id: string, createdAt: number) => ({ id, featureId: `f-${id}`, createdAt, plan: { feature: { title: `Build ${id}` } }, machine: { state: "merged" as const } });
    const s1 = addCost(addCost(addCost(NO_COST, "2026-09", "model", 50), "2026-10", "model", 20), "2026-10", "sandbox", 5, 60);
    const costs = new Map([
      ["s1", s1],
      ["shop--main", addCost(NO_COST, "2026-10", "sandbox", 7, 90)],
      [PROJECT_COST, addCost(NO_COST, "2026-10", "router", 12)],
    ]);
    const usage = projectUsage({ project: "shop", caps: { ...NO_CAPS, projects: { shop: 100 } }, ledger, sessions: [session("s1", 1), session("s2", 2)], costs, main: "shop--main" });
    expect(usage).toMatchObject({ month: "2026-10", spent: 44, cap: 100, parts: { model: 32, sandbox: 12 }, main: { sandbox: 7 }, mainSeconds: 90, outside: { router: 12 } });
    expect(usage.builds.map((b) => [b.id, b.month, b.total])).toEqual([
      ["s2", {}, {}],
      ["s1", { model: 20, sandbox: 5 }, { model: 70, sandbox: 5 }],
    ]);
  });
});
