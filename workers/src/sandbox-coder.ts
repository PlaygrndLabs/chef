import { NO_LLM } from "@chef/adapters/settings";
import type { Coder, CoderTurnInput, CoderTurnResult } from "@chef/core";

export class SandboxCoder implements Coder {
  constructor(
    private readonly sessions: DurableObjectNamespace,
    private readonly options: { readonly model: string; readonly llm: { readonly baseUrl: string; readonly apiKey: string } | null },
  ) {}

  async runTurn(input: CoderTurnInput): Promise<CoderTurnResult> {
    const llm = this.options.llm;
    if (!llm) throw new Error(NO_LLM);
    const sandbox = sandboxName(input.sessionId, input.lane);
    const stub = this.sessions.get(this.sessions.idFromName(sandbox)) as unknown as {
      runTurn(job: unknown, onEvent: CoderTurnInput["onEvent"], llmKey: string): Promise<CoderTurnResult>;
    };
    return stub.runTurn(
      {
        sessionId: sandbox,
        featureId: input.featureId,
        role: input.role,
        model: input.model === "coder-default" ? this.options.model : input.model,
        prompt: input.prompt,
        agent: input.agent,
        writeScope: input.writeScope,
        remote: input.workspace.remote,
        ref: input.workspace.ref,
        commitId: input.workspace.commitId,
        readToken: input.workspace.readToken,
        llm: { baseUrl: llm.baseUrl },
      },
      input.onEvent,
      llm.apiKey,
    );
  }

  async release(sessionId: string, lanes: readonly string[] = []): Promise<void> {
    await Promise.all(
      [sessionId, ...lanes.map((lane) => sandboxName(sessionId, lane))].map(async (name) => {
        const stub = this.sessions.get(this.sessions.idFromName(name)) as unknown as { stop(): Promise<boolean> };
        await stub.stop();
      }),
    );
  }
}

export function sandboxName(sessionId: string, lane?: string): string {
  return lane ? `${sessionId}--${lane}` : sessionId;
}
