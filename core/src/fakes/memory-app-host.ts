import type { AppHost, AppRun } from "../ports/app-host.ts";
import { slugify } from "../util/hash.ts";

export class MemoryAppHost implements AppHost {
  readonly runs: (AppRun & { readonly target: string; readonly repo: string })[] = [];

  async run(input: { readonly target: string; readonly repo: string; readonly ref: string; readonly commitId: string }): Promise<AppRun> {
    const run: AppRun = { status: "running", url: `https://${slugify(input.target, 30)}.app.example`, local: `http://${slugify(input.target, 30)}.local.example`, commitId: input.commitId };
    this.runs.push({ ...run, target: input.target, repo: input.repo });
    return run;
  }
}
