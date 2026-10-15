import { NO_LLM } from "@chef/adapters/settings";
import { TurnRunning, usesChefTemplate, type Coder, type CoderEvent, type CoderTurnInput, type CoderTurnResult, type ResumeTurnInput } from "@chef/core";
import type { TurnOutcome } from "./session-agent.ts";

interface SandboxStub {
  runTurn(job: unknown, onEvent: (event: CoderEvent) => void, llmKey: string): Promise<TurnOutcome>;
  resumeTurn(id: string, onEvent: (event: CoderEvent) => void, llmKey: string): Promise<TurnOutcome>;
  stop(): Promise<boolean>;
}

export class SandboxCoder implements Coder {
  constructor(
    private readonly sessions: DurableObjectNamespace,
    private readonly options: { readonly model: string; readonly llm: { readonly baseUrl: string; readonly apiKey: string } | null },
  ) {}

  async runTurn(input: CoderTurnInput): Promise<CoderTurnResult> {
    const llm = this.llm();
    const sandbox = sandboxName(input.sessionId, input.lane);
    const outcome = await this.stub(sandbox).runTurn(
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
        ...(input.turnId ? { turnId: input.turnId } : {}),
        ...(usesChefTemplate(input.workspace.tree) ? {} : { ownStructure: true }),
      },
      input.onEvent,
      llm.apiKey,
    );
    const result = settle(outcome, input.turnId ?? sandbox);
    if (!result) throw new Error("the sandbox container stopped while the coder was working");
    return result;
  }

  async resumeTurn(input: ResumeTurnInput): Promise<CoderTurnResult | null> {
    return settle(await this.stub(sandboxName(input.sessionId, input.lane)).resumeTurn(input.turnId, input.onEvent, this.llm().apiKey), input.turnId);
  }

  async release(sessionId: string, lanes: readonly string[] = []): Promise<void> {
    await Promise.all([sessionId, ...lanes.map((lane) => sandboxName(sessionId, lane))].map((name) => this.stub(name).stop()));
  }

  private llm(): { readonly baseUrl: string; readonly apiKey: string } {
    if (!this.options.llm) throw new Error(NO_LLM);
    return this.options.llm;
  }

  private stub(name: string): SandboxStub {
    return this.sessions.get(this.sessions.idFromName(name)) as unknown as SandboxStub;
  }
}

function settle(outcome: TurnOutcome, turnId: string): CoderTurnResult | null {
  if (outcome.status === "running") throw new TurnRunning(turnId);
  return outcome.status === "done" ? outcome.result : null;
}

export function sandboxName(sessionId: string, lane?: string): string {
  return lane ? `${sessionId}--${lane}` : sessionId;
}
