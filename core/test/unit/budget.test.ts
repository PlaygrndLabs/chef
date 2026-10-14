import { describe, expect, it } from "vitest";
import { addSpend, costMicros, emptyLedger, monthOf, NO_CAPS, overCap, readCap, setCaps } from "../../src/usage/budget.ts";

describe("model spend", () => {
  it("prices tokens by model family and charges cache reads a tenth", () => {
    expect(costMicros("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2_000_000);
    expect(costMicros("claude-opus-5-5", { inputTokens: 0, outputTokens: 1_000_000 })).toBe(20_000_000);
    expect(costMicros("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 1_000_000 })).toBe(5_100_000);
    expect(costMicros("some-gateway-model", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(4_000_000);
  });

  it("adds spend to the org, the project and the person, and starts over each month", () => {
    let ledger = emptyLedger("2026-10");
    ledger = addSpend(ledger, "2026-10", "shop", "usr_a", 5);
    ledger = addSpend(ledger, "2026-10", "shop", null, 3);
    ledger = addSpend(ledger, "2026-10", "blog", "usr_a", 2);
    expect(ledger).toEqual({ month: "2026-10", org: 10, projects: { shop: 8, blog: 2 }, members: { usr_a: 7 } });
    expect(addSpend(ledger, "2026-11", "shop", null, 1)).toEqual({ month: "2026-11", org: 1, projects: { shop: 1 }, members: {} });
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
