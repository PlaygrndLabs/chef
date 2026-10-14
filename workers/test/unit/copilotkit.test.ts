import { describe, expect, it } from "vitest";
import { ChefAgent, type ChefLink } from "@chef/adapters/agui";
import type { SubmitResult } from "@chef/core";
import { chatRuntime } from "../../src/copilotkit.ts";

type RunRequest = Parameters<ReturnType<typeof chatRuntime>["runner"]["run"]>[0];
type RunAgentInput = RunRequest["input"];
interface BaseEvent {
  readonly type: string;
}

function link(submitted: string[]): ChefLink {
  return {
    cursor: () => Promise.resolve(0),
    submit: (prompt) => {
      submitted.push(prompt);
      return Promise.resolve({ decision: { intent: "new_feature", featureId: null, reason: "new" }, sessionId: `s${submitted.length}`, sessionIds: [`s${submitted.length}`] } as unknown as SubmitResult);
    },
    events: () => Promise.resolve([]),
  };
}

function input(runId: string, prompts: readonly string[]): RunAgentInput {
  return { threadId: "chat", runId, messages: prompts.map((content, i) => ({ id: `m${i}`, role: "user" as const, content })), tools: [], context: [], state: {}, forwardedProps: {} };
}

function runOf(agent: ChefAgent, run: RunAgentInput): RunRequest {
  const copy = agent.clone();
  copy.threadId = run.threadId;
  copy.setMessages(run.messages);
  return { threadId: run.threadId, agent: copy, input: run };
}

function accepted(events: readonly BaseEvent[], prompt: string): boolean {
  return events.some((e) => e.type === "STATE_SNAPSHOT" && (e as unknown as { snapshot: { prompt: string } }).snapshot.prompt === prompt);
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
}

process.env["COPILOTKIT_TELEMETRY_DISABLED"] = "true";

describe("main chat runs", () => {
  it("takes a new message while the last one is still streaming its builds", async () => {
    const submitted: string[] = [];
    const chat = link(submitted);
    const runtime = chatRuntime(chat, 60_000);
    const agent = new ChefAgent({ link: chat, pollMs: 60_000 });
    const first: BaseEvent[] = [];
    let firstDone = false;
    runtime.runner.run(runOf(agent, input("r1", ["add edit feature."]))).subscribe({ next: (e) => first.push(e), complete: () => (firstDone = true) });
    await until(() => accepted(first, "add edit feature."));

    await runtime.runner.stop({ threadId: "chat", runId: "r1" });
    const second: BaseEvent[] = [];
    runtime.runner.run(runOf(agent, input("r2", ["add edit feature.", "add reorder feat."]))).subscribe({ next: (e) => second.push(e) });

    await until(() => accepted(second, "add reorder feat."));
    expect(submitted).toEqual(["add edit feature.", "add reorder feat."]);
    await until(() => firstDone);
  });

  it("takes a new message even before the stop for the last one arrives", async () => {
    const submitted: string[] = [];
    const chat = link(submitted);
    const runtime = chatRuntime(chat, 60_000);
    const agent = new ChefAgent({ link: chat, pollMs: 60_000 });
    const first: BaseEvent[] = [];
    let firstDone = false;
    runtime.runner.run(runOf(agent, { ...input("r1", ["make a todo app."]), threadId: "chat2" })).subscribe({ next: (e) => first.push(e), complete: () => (firstDone = true) });
    await until(() => accepted(first, "make a todo app."));

    const second: BaseEvent[] = [];
    runtime.runner.run(runOf(agent, { ...input("r2", ["make a todo app.", "add edit feature."]), threadId: "chat2" })).subscribe({ next: (e) => second.push(e) });

    await until(() => accepted(second, "add edit feature."));
    await until(() => firstDone);
  });
});
