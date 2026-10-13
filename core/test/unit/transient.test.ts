import { describe, expect, it } from "vitest";
import { transient } from "../../src/orchestrator/orchestrator.ts";

describe("transient errors", () => {
  it("retries a sandbox that a chef update restarted mid-turn", () => {
    expect(transient(new Error("Container service disconnected."))).toBe(true);
    expect(transient(new Error("Error: exec failed (the sandbox container stopped: its main process exited)"))).toBe(true);
    expect(transient(new Error("the sandbox container did not start: timed out"))).toBe(true);
    expect(transient(new Error("Durable Object reset because its code was updated."))).toBe(true);
  });

  it("does not retry real failures", () => {
    expect(transient(new Error("coder runner failed with exit code 1: model refused"))).toBe(false);
    expect(transient(new Error("no agent profile for role designer"))).toBe(false);
  });
});
