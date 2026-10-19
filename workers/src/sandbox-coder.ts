import { NO_LLM } from "@chef/adapters/settings";
import { TurnRunning, usesChefTemplate, type Coder, type CoderEvent, type CoderTurnInput, type CoderTurnResult, type ResumeTurnInput } from "@chef/core";
import type { TurnOutcome } from "./session-agent.ts";

interface SandboxStub {
  runTurn(job: unknown, onEvent: (event: CoderEvent) => void, llmKey: string): Promise<TurnOutcome>;
  resumeTurn(id: string, onEvent: (event: CoderEvent) => void, llmKey: string, lane?: string): Promise<TurnOutcome>;
  stop(): Promise<boolean>;
  reset(): Promise<void>;
}

export const TURN_ANSWER_MS = 6 * 60_000;

export class SandboxCoder implements Coder {
  constructor(
    private readonly sessions: DurableObjectNamespace,
    private readonly options: { readonly project: string; readonly model: string; readonly llm: { readonly baseUrl: string; readonly apiKey: string } | null },
  ) {}

  async runTurn(input: CoderTurnInput): Promise<CoderTurnResult> {
    const llm = this.llm();
    const sandbox = sandboxName(input.sessionId, input.lane);
    const call = this.stub(input.sessionId).runTurn(
      {
        sessionId: sandbox,
        project: this.options.project,
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
        ...(input.lane ? { lane: input.lane } : {}),
      },
      input.onEvent,
      llm.apiKey,
    );
    const outcome = input.turnId ? await this.answered(input.sessionId, call) : await call;
    const result = settle(outcome, input.turnId ?? sandbox);
    if (!result) throw new Error("the sandbox container stopped while the coder was working");
    return result;
  }

  async resumeTurn(input: ResumeTurnInput): Promise<CoderTurnResult | null> {
    return settle(await this.answered(input.sessionId, this.stub(input.sessionId).resumeTurn(input.turnId, input.onEvent, this.llm().apiKey, input.lane)), input.turnId);
  }

  private async answered(sandbox: string, call: Promise<TurnOutcome>): Promise<TurnOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const silent = new Promise<"silent">((resolve) => {
      timer = setTimeout(() => resolve("silent"), TURN_ANSWER_MS);
    });
    try {
      const outcome = await Promise.race([call, silent]);
      if (outcome !== "silent") return outcome;
    } finally {
      clearTimeout(timer);
    }
    await this.stub(sandbox).reset().catch((error: unknown) => console.error(`restarting the sandbox ${sandbox} failed`, error));
    throw Object.assign(new Error(`the sandbox ${sandbox} gave no answer for ${TURN_ANSWER_MS / 60_000} minutes, so Chef restarted it`), { retryable: true });
  }

  async release(sessionId: string): Promise<void> {
    await this.stub(sessionId).stop();
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
