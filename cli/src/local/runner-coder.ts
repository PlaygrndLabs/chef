import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Coder, CoderEvent, CoderTurnInput, CoderTurnResult, FileChanges } from "@kargah/core";

export interface RunnerCoderOptions {
  readonly runner: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly nodeModules?: string;
}

interface TurnOutput {
  readonly changes: FileChanges;
  readonly summary: string;
  readonly model: string;
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number };
}

export class RunnerCoder implements Coder {
  private runs = 0;

  constructor(private readonly options: RunnerCoderOptions) {}

  async runTurn(input: CoderTurnInput): Promise<CoderTurnResult> {
    const root = mkdtempSync(join(tmpdir(), "kargah-coder-"));
    try {
      const remote = join(root, "origin");
      for (const [path, content] of Object.entries(input.workspace.tree)) {
        mkdirSync(dirname(join(remote, path)), { recursive: true });
        writeFileSync(join(remote, path), content);
      }
      const git = (...args: string[]) => execFileSync("git", args, { cwd: remote, encoding: "utf8" }).trim();
      git("init", "--quiet", "--initial-branch=main");
      git("add", "-A");
      git("-c", "user.email=ma.karimi76@gmail.com", "-c", "user.name=kargah", "commit", "--quiet", "--allow-empty", "-m", "turn base");
      const model = input.model === "coder-default" ? this.options.model : input.model;
      const job = { sessionId: input.sessionId, featureId: input.featureId, role: input.role, model, prompt: input.prompt, agent: input.agent, writeScope: input.writeScope, remote, ref: "main", commitId: git("rev-parse", "HEAD"), llm: { baseUrl: this.options.baseUrl } };
      const output = await this.spawn(job, join(root, "workspace"), input.onEvent, input.signal);
      return { changes: output.changes, summary: output.summary, model: output.model, runId: `${input.sessionId}-local-${++this.runs}`, usage: output.usage ?? { inputTokens: 0, outputTokens: 0 } };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  private spawn(job: object, workspace: string, onEvent: (event: CoderEvent) => void, signal?: AbortSignal): Promise<TurnOutput> {
    return new Promise((resolve, reject) => {
      const child = spawn("node", [this.options.runner], {
        env: { ...process.env, KARGAH_WORKSPACE: workspace, ...(this.options.nodeModules ? { KARGAH_NODE_MODULES: this.options.nodeModules } : {}), KARGAH_LLM_KEY: this.options.apiKey, KARGAH_JOB: Buffer.from(JSON.stringify(job)).toString("base64") },
        ...(signal ? { signal } : {}),
      });
      let result: TurnOutput | null = null;
      let buffer = "";
      let tail = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as { type: string } & Record<string, unknown>;
          if (event.type === "kargah.result") result = event as unknown as TurnOutput;
          else onEvent(event as unknown as CoderEvent);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => (tail = `${tail}${chunk.toString("utf8")}`.slice(-4000)));
      child.on("error", reject);
      child.on("close", (code) => {
        const output = result as TurnOutput | null;
        if (code === 0 && output) resolve(output);
        else reject(new Error(`coder runner exited with ${code}: ${tail.slice(-1000)}`));
      });
    });
  }
}
