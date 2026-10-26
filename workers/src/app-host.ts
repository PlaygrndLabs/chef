import { APP_START_SECONDS, type AppHost, type AppRun, type RepoHost, type SessionRecord } from "@chef/core";
import type { AppJob, AppState } from "./session-agent.ts";

type AppStub = { runApp(job: AppJob, readToken: string): Promise<AppState> };

const TOKEN_SECONDS = 3600;
const ANSWER_MS = (2 * (APP_START_SECONDS + 60) + 180) * 1000;

export class SandboxAppHost implements AppHost {
  constructor(
    private readonly sessions: DurableObjectNamespace,
    private readonly repos: RepoHost,
    private readonly options: {
      readonly project: string;
      readonly env: () => Promise<Readonly<Record<string, string>>>;
      readonly idleMinutes: () => Promise<number>;
      readonly address: (target: string) => Promise<string | null>;
    },
  ) {}

  async run(input: { readonly target: string; readonly repo: string; readonly ref: string; readonly commitId: string; readonly onWorkers?: boolean }): Promise<AppRun> {
    const info = await this.repos.info(input.repo);
    if (!info) throw new Error(`unknown repo ${input.repo}`);
    const token = await this.repos.createToken(input.repo, "read", TOKEN_SECONDS);
    let state: AppState;
    try {
      const stub = this.sessions.get(this.sessions.idFromName(input.target)) as unknown as AppStub;
      const job = { target: input.target, project: this.options.project, remote: info.remote, ref: input.ref, commitId: input.commitId, env: await this.options.env(), idleMinutes: await this.options.idleMinutes(), startSeconds: APP_START_SECONDS, ...(input.onWorkers ? { bundle: true } : {}) };
      state = await answered(stub.runApp(job, token.secret), input);
    } finally {
      await this.repos.revokeToken(token);
    }
    const status = state.status === "running" || state.status === "no-stack" ? state.status : "failed";
    const url = status === "running" ? await this.options.address(input.target).catch((error: unknown) => {
      console.error(`giving ${input.target} its address failed`, error);
      return null;
    }) : null;
    return { status, url, local: status === "running" && state.port ? `http://127.0.0.1:${state.port}` : null, commitId: state.commitId, ...(state.via ? { via: state.via } : {}), ...(state.error ? { error: state.error } : status === "failed" ? { error: "the app did not start" } : {}) };
  }
}

async function answered(run: Promise<AppState>, input: { readonly target: string; readonly commitId: string }): Promise<AppState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<AppState>((resolve) => {
    timer = setTimeout(() => resolve({ status: "failed", target: input.target, project: "", commitId: input.commitId, port: null, idleMinutes: 0, at: Date.now(), error: `the sandbox did not report on the app within ${Math.round(ANSWER_MS / 60_000)} minutes` }), ANSWER_MS);
  });
  try {
    return await Promise.race([run, late]);
  } finally {
    clearTimeout(timer);
  }
}

export type AppBranch = { readonly kind: "main" } | { readonly kind: "session"; readonly id: string; readonly fork: string; readonly head: string };

export function appBranch(sessions: readonly Pick<SessionRecord, "id" | "machine" | "merge" | "forkDeleted" | "head" | "fork">[], id: string): AppBranch | null {
  let current = id;
  for (let depth = 0; current !== "main" && depth <= 20; depth++) {
    const record = sessions.find((s) => s.id === current);
    if (!record) return null;
    if (record.machine.state !== "merged") return record.forkDeleted || !record.head ? null : { kind: "session", id: record.id, fork: record.fork, head: record.head };
    current = record.merge?.into ?? "main";
  }
  return { kind: "main" };
}
