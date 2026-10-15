import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnRunning, type CoderTurnInput } from "@chef/core";
import { SandboxCoder, TURN_ANSWER_MS } from "../../src/sandbox-coder.ts";
import type { TurnOutcome } from "../../src/session-agent.ts";

function sandboxes(runTurn: () => Promise<TurnOutcome>) {
  const resets: string[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (name: string) => ({ runTurn, resumeTurn: runTurn, stop: async () => true, reset: async () => void resets.push(name) }),
  } as unknown as DurableObjectNamespace;
  return { resets, coder: new SandboxCoder(namespace, { model: "m", llm: { baseUrl: "https://llm.example", apiKey: "k" } }) };
}

const input = {
  sessionId: "s1",
  featureId: "todo",
  role: "frontend",
  model: "coder-default",
  prompt: "p",
  instructions: "",
  writeScope: [],
  agent: { name: "frontend", description: "", prompt: "" },
  attempt: { index: 1, of: 1 },
  lane: "frontend",
  turnId: "t1",
  workspace: { repo: "r", remote: "https://artifacts.example/r.git", ref: "lane/frontend", commitId: "c1", readToken: "x", tree: {} },
  onEvent: () => undefined,
} as unknown as CoderTurnInput;

describe("sandbox coder", () => {
  afterEach(() => void vi.useRealTimers());

  it("restarts a sandbox that gives no answer about a turn and lets the session try again", async () => {
    vi.useFakeTimers();
    const { resets, coder } = sandboxes(() => new Promise<TurnOutcome>(() => undefined));
    const turn = coder.runTurn(input);
    const failed = expect(turn).rejects.toMatchObject({ retryable: true, message: expect.stringContaining("gave no answer") });
    await vi.advanceTimersByTimeAsync(TURN_ANSWER_MS);
    await failed;
    expect(resets).toEqual(["s1--frontend"]);
  });

  it("passes on a turn that is still running", async () => {
    const { resets, coder } = sandboxes(async () => ({ status: "running" }));
    await expect(coder.runTurn(input)).rejects.toBeInstanceOf(TurnRunning);
    expect(resets).toEqual([]);
  });
});
