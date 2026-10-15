import { describe, expect, it } from "vitest";
import { ALREADY_FAILING, failuresOf, newFailuresOnly } from "../../src/checks/baseline.ts";

describe("checks that already fail on main", () => {
  const main = failuresOf([
    { name: "lint", ok: false, log: "src/App.jsx: bad" },
    { name: "test", ok: false, log: "1 failing", cases: [{ name: "AC1: old", ok: false }, { name: "AC2: fine", ok: true }] },
    { name: "typecheck", ok: true, log: "ok" },
  ]);

  it("does not let a check that already fails on main block a change", () => {
    const [lint] = newFailuresOnly([{ name: "lint", ok: false, log: "src/App.jsx: bad" }], main);
    expect(lint?.ok).toBe(true);
    expect(lint?.log).toContain(ALREADY_FAILING);
  });

  it("still blocks a check the change breaks, and a test case that only fails with the change", () => {
    const results = newFailuresOnly(
      [
        { name: "typecheck", ok: false, log: "error" },
        { name: "test", ok: false, log: "2 failing", cases: [{ name: "AC1: old", ok: false }, { name: "AC2: fine", ok: false }] },
      ],
      main,
    );
    expect(results.map((r) => r.ok)).toEqual([false, false]);
    expect(newFailuresOnly([{ name: "test", ok: false, log: "1 failing", cases: [{ name: "AC1: old", ok: false }] }], main)[0]?.ok).toBe(true);
  });
});
