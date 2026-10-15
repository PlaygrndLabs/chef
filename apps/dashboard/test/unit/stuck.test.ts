import { describe, expect, it } from "vitest";
import { plainReason, whatFailed } from "../../src/lib/progress.ts";

describe("a stuck build's panel", () => {
  it("says why it stopped and what failed last", () => {
    expect(plainReason("attempt budget exhausted (4/4)")).toBe("Chef tried 4 times and could not get past the review and checks.");
    expect(whatFailed({ feedback: "Reviewer rejected the change:\n- Revert src/registry.gen.ts", history: [] })).toBe("Reviewer rejected the change:\n- Revert src/registry.gen.ts");
  });

  it("falls back to the last saved failure, then to the reviewer's reasons", () => {
    expect(whatFailed({ feedback: null, history: ["Merge gate failed:\ntests", "Reviewer rejected the change:\n- wire it into app.js", " "] })).toBe("Reviewer rejected the change:\n- wire it into app.js");
    expect(whatFailed({ feedback: "  ", history: [], verdict: { approve: false, reasons: ["missing test"] } })).toBe("Reviewer rejected the change:\n- missing test");
    expect(whatFailed({ feedback: null, history: [], verdict: { approve: true, reasons: [] } })).toBeNull();
  });
});
