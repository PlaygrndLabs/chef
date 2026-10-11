import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, initialMachine, InvalidTransition, transition, type SessionEvent } from "../../src/session/machine.ts";

const run = (events: SessionEvent[], budget = DEFAULT_BUDGET) => events.reduce((m, e) => transition(m, e, budget, 0), initialMachine(0));

describe("session machine", () => {
  it("walks the happy path", () => {
    const m = run([{ type: "start" }, { type: "planned", withTests: true }, { type: "tests_committed" }, { type: "coded" }, { type: "review_approved" }, { type: "gate_passed" }]);
    expect(m.state).toBe("merged");
  });

  it("skips testing when the plan has no tests", () => {
    expect(run([{ type: "start" }, { type: "planned", withTests: false }]).state).toBe("coding");
  });

  it("returns to coding with feedback after a failed gate", () => {
    const m = run([{ type: "start" }, { type: "planned", withTests: false }, { type: "coded" }, { type: "review_approved" }, { type: "gate_failed", log: "tests red" }]);
    expect(m.state).toBe("coding");
    expect(m.feedback).toContain("tests red");
    expect(m.usage.attempts).toBe(2);
  });

  it("goes stuck when attempts run out", () => {
    const budget = { ...DEFAULT_BUDGET, maxAttempts: 1 };
    const m = run([{ type: "start" }, { type: "planned", withTests: false }, { type: "coded" }, { type: "review_rejected", reasons: ["no"] }], budget);
    expect(m.state).toBe("stuck");
    expect(m.reason).toMatch(/attempt budget/);
  });

  it("rejects transitions that do not exist", () => {
    expect(() => transition(initialMachine(0), { type: "coded" }, DEFAULT_BUDGET, 0)).toThrow(InvalidTransition);
  });
});
