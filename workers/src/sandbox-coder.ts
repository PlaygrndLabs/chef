import type { Coder, CoderTurnInput, CoderTurnResult } from "@kargah/core";

export class SandboxCoder implements Coder {
  constructor(private readonly sessions: DurableObjectNamespace) {}

  async runTurn(input: CoderTurnInput): Promise<CoderTurnResult> {
    const stub = this.sessions.get(this.sessions.idFromName(input.sessionId)) as unknown as {
      runTurn(job: unknown, onEvent: CoderTurnInput["onEvent"]): Promise<CoderTurnResult>;
    };
    return stub.runTurn(
      {
        sessionId: input.sessionId,
        featureId: input.featureId,
        role: input.role,
        model: input.model,
        prompt: input.prompt,
        agent: input.agent,
        writeScope: input.writeScope,
        remote: input.workspace.remote,
        ref: input.workspace.ref,
        commitId: input.workspace.commitId,
        readToken: input.workspace.readToken,
      },
      input.onEvent,
    );
  }
}
