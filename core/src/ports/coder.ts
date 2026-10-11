import type { FileChanges, Tree } from "../git/tree.ts";

export type CoderEvent =
  | { readonly type: "assistant.message_delta"; readonly delta: string }
  | { readonly type: "tool.execution_start"; readonly tool: string; readonly detail?: string }
  | { readonly type: "session.idle" }
  | { readonly type: "session.error"; readonly message: string };

export interface CoderWorkspace {
  readonly repo: string;
  readonly remote: string;
  readonly ref: string;
  readonly commitId: string;
  readonly readToken: string;
  readonly tree: Tree;
}

export interface CoderTurnInput {
  readonly sessionId: string;
  readonly featureId: string;
  readonly role: string;
  readonly model: string;
  readonly prompt: string;
  readonly instructions: string;
  readonly writeScope: readonly string[];
  readonly workspace: CoderWorkspace;
  readonly signal?: AbortSignal;
  readonly onEvent: (event: CoderEvent) => void;
}

export interface CoderTurnResult {
  readonly changes: FileChanges;
  readonly summary: string;
  readonly model: string;
  readonly runId: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

export interface Coder {
  runTurn(input: CoderTurnInput): Promise<CoderTurnResult>;
}
