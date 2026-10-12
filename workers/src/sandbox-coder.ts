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
    const stub = this.sessions.get(this.sessions.idFromName(input.sessionId)) as unknown as {
      runTurn(job: unknown, onEvent: CoderTurnInput["onEvent"], llmKey: string): Promise<CoderTurnResult>;
    };
    return stub.runTurn(
      {
        sessionId: input.sessionId,
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

  async release(sessionId: string): Promise<void> {
    const stub = this.sessions.get(this.sessions.idFromName(sessionId)) as unknown as { stop(): Promise<boolean> };
    await stub.stop();
  }
}
