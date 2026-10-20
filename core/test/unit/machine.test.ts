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

  it("sends a review asking for tests back to testing, then carries the review into coding", () => {
    const rejected = run([{ type: "start" }, { type: "planned", withTests: true }, { type: "tests_committed" }, { type: "coded" }, { type: "review_rejected", reasons: ["no test named after AC2"], retest: true }]);
    expect(rejected.state).toBe("testing");
    expect(rejected.usage.attempts).toBe(2);
    const coding = transition(rejected, { type: "tests_committed" }, DEFAULT_BUDGET, 0);
    expect(coding.state).toBe("coding");
    expect(coding.feedback).toContain("no test named after AC2");
  });

  it("sends disputed tests from coding back to testing without charging another attempt, then carries the gate log into coding", () => {
    const disputed = run([{ type: "start" }, { type: "planned", withTests: true }, { type: "tests_committed" }, { type: "coded" }, { type: "review_approved" }, { type: "gate_failed", log: "AC6 red" }, { type: "tests_disputed", said: ["backend: the test contradicts the spec"] }]);
    expect(disputed.state).toBe("testing");
    expect(disputed.usage.attempts).toBe(2);
    expect(disputed.feedback).toContain("AC6 red");
    expect(disputed.feedback).toContain("- backend: the test contradicts the spec");
    const coding = transition(disputed, { type: "tests_committed" }, DEFAULT_BUDGET, 0);
    expect(coding.state).toBe("coding");
    expect(coding.feedback).toContain("AC6 red");
  });

  it("goes stuck when attempts run out", () => {
    const budget = { ...DEFAULT_BUDGET, maxAttempts: 1 };
    const m = run([{ type: "start" }, { type: "planned", withTests: false }, { type: "coded" }, { type: "review_rejected", reasons: ["no"] }], budget);
    expect(m.state).toBe("stuck");
    expect(m.reason).toMatch(/attempt budget/);
  });

  it("sends an app that does not start back to coding with its log, and ends stuck with that reason", () => {
    const m = run([{ type: "start" }, { type: "planned", withTests: false }, { type: "app_failed", log: "Could not resolve ../page.ts" }]);
    expect(m.state).toBe("coding");
    expect(m.feedback).toContain("Could not resolve ../page.ts");
    expect(m.usage.attempts).toBe(2);
    const fromReview = run([{ type: "start" }, { type: "planned", withTests: false }, { type: "coded" }, { type: "app_failed", log: "web stopped" }]);
    expect(fromReview.state).toBe("coding");
    const stuck = run([{ type: "start" }, { type: "planned", withTests: false }, { type: "app_failed", log: "web stopped" }], { ...DEFAULT_BUDGET, maxAttempts: 1 });
    expect(stuck.state).toBe("stuck");
    expect(stuck.reason).toMatch(/attempt budget exhausted.*the app still does not start/);
  });

  it("asks for a different approach when a failure comes back, and goes stuck the third time", () => {
    const failing = (log: string): SessionEvent[] => [{ type: "coded" }, { type: "review_approved" }, { type: "gate_failed", log }];
    const twice = run([{ type: "start" }, { type: "planned", withTests: false }, ...failing("AC1 red after 120ms"), ...failing("AC1 red after 87ms")], { ...DEFAULT_BUDGET, maxAttempts: 10 });
    expect(twice.state).toBe("coding");
    expect(twice.feedback).toContain("same failure as an earlier try");
    const thrice = run([{ type: "start" }, { type: "planned", withTests: false }, ...failing("AC1 red"), ...failing("AC2 red"), ...failing("AC1 red"), ...failing("AC1 red")], { ...DEFAULT_BUDGET, maxAttempts: 10 });
    expect(thrice.state).toBe("stuck");
    expect(thrice.reason).toMatch(/same failure repeated \(3\/3\)/);
  });

  it("matches gate failures by their failing tests, not their whole log", () => {
    const failing = (log: string): SessionEvent[] => [{ type: "coded" }, { type: "review_approved" }, { type: "gate_failed", log, signature: "tests: AC1" }];
    const m = run([{ type: "start" }, { type: "planned", withTests: false }, ...failing("run one"), ...failing("run two"), ...failing("run three")], { ...DEFAULT_BUDGET, maxAttempts: 10 });
    expect(m.state).toBe("stuck");
  });

  it("stops roles that keep clashing on the same lines even though it costs no try, but not merges of a moving main", () => {
    const clash: SessionEvent = { type: "conflict", paths: ["src/app.ts"], between: ["frontend", "backend"] };
    const m = run([{ type: "start" }, { type: "planned", withTests: false }, clash, clash, clash]);
    expect(m.state).toBe("stuck");
    expect(m.usage.attempts).toBe(1);
    const main: SessionEvent = { type: "conflict", paths: ["src/app.ts"] };
    expect(run([{ type: "start" }, { type: "planned", withTests: false }, main, main, main, main]).state).toBe("coding");
  });

  it("does not stop on time or tokens, and a retry starts with a clean failure history", () => {
    const stuck = run([{ type: "start" }, { type: "planned", withTests: false }, { type: "app_failed", log: "web stopped" }, { type: "app_failed", log: "web stopped" }, { type: "app_failed", log: "web stopped" }]);
    expect(stuck.state).toBe("stuck");
    const retried = transition({ ...stuck, usage: { ...stuck.usage, tokens: 50_000_000 } }, { type: "retried", guidance: "" }, DEFAULT_BUDGET, 10 * 3_600_000);
    expect(retried.state).toBe("coding");
    expect(retried.usage.failures ?? []).toEqual([]);
    const later = transition({ ...retried, usage: { ...retried.usage, tokens: 50_000_000 } }, { type: "app_failed", log: "web stopped" }, DEFAULT_BUDGET, 100 * 3_600_000);
    expect(later.state).toBe("coding");
  });

  it("rejects transitions that do not exist", () => {
    expect(() => transition(initialMachine(0), { type: "coded" }, DEFAULT_BUDGET, 0)).toThrow(InvalidTransition);
  });
});
