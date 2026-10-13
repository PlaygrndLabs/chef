import type { ExternalRemote, PullRequestRef } from "../ports/external-git.ts";
import type { RepoToken } from "../ports/repo-host.ts";
import type { MemoryRepoHost } from "./memory-repo-host.ts";

export class MemoryExternalRemote implements ExternalRemote {
  readonly url: string;
  readonly pullRequests = new Map<string, PullRequestRef & { title: string; body: string }>();
  readonly pushes: { branch: string; commitId: string }[] = [];

  constructor(
    private readonly host: MemoryRepoHost,
    readonly repo: string,
    readonly branch = "main",
  ) {
    this.url = `https://git.example/${repo}.git`;
  }

  async head(branch = this.branch): Promise<string | null> {
    return this.host.resolveRef(this.repo, branch);
  }

  async pull(input: { readonly token: RepoToken; readonly ref: string }): Promise<string | null> {
    const head = await this.head();
    if (!head) return null;
    await this.host.pushRef(input.token, { ref: input.ref, commitId: head, force: true });
    return head;
  }

  async push(input: { readonly repo: string; readonly ref: string; readonly commitId: string; readonly branch: string; readonly force: boolean }): Promise<void> {
    if (input.branch === this.branch) throw new Error(`refusing to push to ${this.branch}`);
    const token = await this.host.createToken(this.repo, "write", 600);
    await this.host.pushRef(token, { ref: input.branch, commitId: input.commitId, force: input.force });
    this.pushes.push({ branch: input.branch, commitId: input.commitId });
  }

  async pullRequest(input: { readonly head: string; readonly title: string; readonly body: string }): Promise<PullRequestRef> {
    const existing = this.pullRequests.get(input.head);
    const pr = { number: existing?.number ?? this.pullRequests.size + 1, url: `https://git.example/${this.repo}/pull/${existing?.number ?? this.pullRequests.size + 1}`, title: input.title, body: input.body };
    this.pullRequests.set(input.head, pr);
    return { number: pr.number, url: pr.url };
  }

  async commit(changes: Record<string, string | null>, message: string): Promise<string> {
    const token = await this.host.createToken(this.repo, "write", 600);
    const parent = await this.head();
    const commit = await this.host.commit(token, { ref: this.branch, parent, changes, message, author: { name: "someone", email: "someone@example.com" } });
    return commit.id;
  }

  async merge(branch: string): Promise<string> {
    const token = await this.host.createToken(this.repo, "write", 600);
    const outcome = await this.host.merge(token, { into: this.branch, from: { repo: this.repo, ref: branch }, message: `Merge ${branch}`, author: { name: "someone", email: "someone@example.com" } });
    if (outcome.status === "conflict") throw new Error("conflict");
    return outcome.commitId;
  }
}
