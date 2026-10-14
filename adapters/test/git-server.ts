import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalGitHost } from "./git-host.ts";

export class LocalGitServer extends LocalGitHost {
  readonly pushes: { repo: string; token: string }[] = [];
  readonly reads: string[] = [];

  constructor() {
    const pushes: { repo: string; token: string }[] = [];
    const reads: string[] = [];
    super(mkdtempSync(join(tmpdir(), "chef-git-")), { onPush: (repo, token) => pushes.push({ repo, token }), onRead: (what) => reads.push(what) });
    this.pushes = pushes;
    this.reads = reads;
  }

  async stop(): Promise<void> {
    await this.close();
    rmSync(this.root, { recursive: true, force: true });
  }
}
