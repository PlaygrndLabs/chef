import type { AppHost, AppRun, RepoHost } from "@chef/core";
import type { AppJob, AppState } from "./session-agent.ts";

type AppStub = { runApp(job: AppJob, readToken: string): Promise<AppState> };

const TOKEN_SECONDS = 3600;

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

  async run(input: { readonly target: string; readonly repo: string; readonly ref: string; readonly commitId: string }): Promise<AppRun> {
    const info = await this.repos.info(input.repo);
    if (!info) throw new Error(`unknown repo ${input.repo}`);
    const token = await this.repos.createToken(input.repo, "read", TOKEN_SECONDS);
    let state: AppState;
    try {
      const stub = this.sessions.get(this.sessions.idFromName(input.target)) as unknown as AppStub;
      state = await stub.runApp({ target: input.target, project: this.options.project, remote: info.remote, ref: input.ref, commitId: input.commitId, env: await this.options.env(), idleMinutes: await this.options.idleMinutes() }, token.secret);
    } finally {
      await this.repos.revokeToken(token);
    }
    const status = state.status === "running" || state.status === "no-stack" ? state.status : "failed";
    const url = status === "running" ? await this.options.address(input.target).catch((error: unknown) => {
      console.error(`giving ${input.target} its address failed`, error);
      return null;
    }) : null;
    return { status, url, local: status === "running" && state.port ? `http://127.0.0.1:${state.port}` : null, commitId: state.commitId, ...(state.error ? { error: state.error } : status === "failed" ? { error: "the app did not start" } : {}) };
  }
}
