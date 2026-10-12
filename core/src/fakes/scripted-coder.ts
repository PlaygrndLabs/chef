import type { FileChanges } from "../git/tree.ts";
import type { Coder, CoderTurnInput, CoderTurnResult } from "../ports/coder.ts";

export type Script = (input: CoderTurnInput, attempt: number) => { changes: FileChanges; summary?: string } | Promise<{ changes: FileChanges; summary?: string }>;

export class ScriptedCoder implements Coder {
  readonly turns: CoderTurnInput[] = [];
  readonly released: string[] = [];
  private readonly attempts = new Map<string, number>();
  private runs = 0;

  constructor(private readonly script: Script) {}

  async runTurn(input: CoderTurnInput): Promise<CoderTurnResult> {
    this.turns.push(input);
    const key = `${input.sessionId}:${input.role}`;
    const attempt = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempt);
    input.onEvent({ type: "tool.execution_start", tool: "view", detail: input.workspace.repo });
    const { changes, summary } = await this.script(input, attempt);
    for (const path of Object.keys(changes)) input.onEvent({ type: "assistant.message_delta", delta: `editing ${path}\n` });
    input.onEvent({ type: "session.idle" });
    const size = JSON.stringify(changes).length;
    return { changes, summary: summary ?? `${input.role} turn ${attempt}`, model: input.model, runId: `run-${++this.runs}`, usage: { inputTokens: 1000 + input.prompt.length, outputTokens: size } };
  }

  async release(sessionId: string): Promise<void> {
    this.released.push(sessionId);
  }
}
