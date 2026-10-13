import { describe, expect, it } from "vitest";
import { parseTap } from "../../src/checks/tap.ts";
import { testNames } from "../../src/orchestrator/orchestrator.ts";
import { customAgent, parseProfile } from "../../src/profiles/profile.ts";
import { initialMachine, isTerminal, transition, DEFAULT_BUDGET } from "../../src/session/machine.ts";

const profile = parseProfile(`---
role: backend
model: coder-default
description: Implements a feature.
writeScope:
  - features/{feature}/**
tools: [view, edit]
---
Implement {feature} so its locked tests pass.`);

describe("specialization building blocks", () => {
  it("turns a profile into a coder subagent with its write scope", () => {
    const agent = customAgent(profile, "todo-add", ["features/todo-add/**"]);
    expect(agent).toEqual({
      name: "chef-backend",
      displayName: "chef backend",
      description: "Implements a feature.",
      prompt: "Implement todo-add so its locked tests pass.\n\nYou may only change files matching:\nfeatures/todo-add/**",
      tools: ["view", "edit"],
      model: "coder-default",
      skills: [],
    });
    expect(customAgent({ ...profile, tools: null }, "x", []).prompt).toContain("You may not change any file.");
  });

  it("reads test cases from node TAP output, nested or not", () => {
    const tap = ["TAP version 13", "# Subtest: AC1: adds", "ok 1 - AC1: adds", "not ok 2 - AC2: lists \\# items", "  ok 1 - inner", "not ok 3 - /tmp/x/features/a/a.test.ts", "ok 4 - skipped one # SKIP"].join("\n");
    expect(parseTap(tap)).toEqual([
      { name: "AC1: adds", ok: true },
      { name: "AC2: lists # items", ok: false },
      { name: "inner", ok: true },
      { name: "/tmp/x/features/a/a.test.ts", ok: false },
      { name: "skipped one", ok: true },
    ]);
  });

  it("finds test names in a test file", () => {
    expect(testNames(`test("AC1: adds", () => {});\nit('AC2: lists', async () => {});\ntest(\`AC3: rejects\`, () => {});`)).toEqual(["AC1: adds", "AC2: lists", "AC3: rejects"]);
  });

  it("drops a losing attempt and explains each rejection rule", () => {
    const gating = { ...initialMachine(0), state: "gating" as const };
    const dropped = transition(gating, { type: "dropped", reason: "attempt s2 was picked" }, DEFAULT_BUDGET, 1);
    expect(dropped.state).toBe("dropped");
    expect(dropped.reason).toBe("attempt s2 was picked");
    expect(isTerminal("dropped")).toBe(true);
    const coding = { ...initialMachine(0), state: "coding" as const };
    const locked = transition(coding, { type: "turn_rejected", rule: "locked-tests", paths: ["features/a/a.test.ts"], scope: [] }, DEFAULT_BUDGET, 1);
    expect(locked.feedback).toContain("locked");
    const testing = { ...initialMachine(0), state: "testing" as const };
    const red = transition(testing, { type: "turn_rejected", rule: "red-tests", paths: ["features/a/a.test.ts"], scope: [], detail: "- AC1: adds" }, DEFAULT_BUDGET, 1);
    expect(red.state).toBe("testing");
    expect(red.feedback).toContain("pass before the feature is implemented");
    expect(red.feedback).toContain("- AC1: adds");
    const committed = transition(red, { type: "tests_committed" }, DEFAULT_BUDGET, 2);
    expect(committed.state).toBe("coding");
    expect(committed.feedback).toBeNull();
  });
});
