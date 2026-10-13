import { describe, expect, it } from "vitest";
import { conversation, tokensOf } from "../../src/router/conversation.ts";
import { todoSpec } from "../harness.ts";

describe("chat context", () => {
  it("keeps the newest turns that fit and counts the ones that drop off", () => {
    const turns = Array.from({ length: 5 }, (_, i) => ({ prompt: `ask ${i} ${"x".repeat(400)}`, reply: `reply ${i}`, at: i }));
    const all = conversation(turns, [todoSpec]);
    expect(all.context).toMatchObject({ turns: 5, dropped: 0, limit: 32_000 });
    expect(all.text.indexOf("ask 0")).toBeLessThan(all.text.indexOf("ask 4"));
    const tight = conversation(turns, [todoSpec], all.context.used - 50);
    expect(tight.context.turns).toBe(4);
    expect(tight.context.dropped).toBe(1);
    expect(tight.text).not.toContain("ask 0");
    expect(tight.text).toContain("Person: ask 4");
    expect(tight.context.used).toBeLessThanOrEqual(tight.context.limit);
    expect(conversation([], []).context.used).toBe(tokensOf("[]"));
  });
});
