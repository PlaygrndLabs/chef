import type { Author, Resolver } from "../git/tree.ts";
import type { MergeOutcome, RepoHost } from "../ports/repo-host.ts";

export class PreviewPublisher {
  constructor(
    private readonly repos: RepoHost,
    private readonly canonical: string,
    private readonly ttlSeconds: number,
  ) {}

  async publish(featureId: string, commitId: string, fromRepo: string): Promise<string> {
    const branch = `preview/${featureId}`;
    const token = await this.repos.createToken(this.canonical, "write", this.ttlSeconds);
    try {
      await this.repos.pushRef(token, { ref: branch, commitId, fromRepo, force: true });
    } finally {
      await this.repos.revokeToken(token);
    }
    return branch;
  }
}

export class MainWriter {
  constructor(
    private readonly repos: RepoHost,
    private readonly canonical: string,
    private readonly ttlSeconds: number,
  ) {}

  async mergeFork(fork: string, input: { message: string; author: Author; resolvers: Readonly<Record<string, Resolver>> }): Promise<MergeOutcome> {
    const token = await this.repos.createToken(this.canonical, "write", this.ttlSeconds);
    try {
      return await this.repos.merge(token, { into: "main", from: { repo: fork, ref: "main" }, ...input });
    } finally {
      await this.repos.revokeToken(token);
    }
  }

  async revert(input: { to: string; message: string; author: Author; expectedHead: string }): Promise<string> {
    const token = await this.repos.createToken(this.canonical, "write", this.ttlSeconds);
    try {
      const head = await this.repos.resolveRef(this.canonical, "main");
      if (head !== input.expectedHead) throw new Error(`main moved from ${input.expectedHead} to ${head}`);
      const target = await this.repos.readCommit(this.canonical, input.to);
      const current = head ? await this.repos.readCommit(this.canonical, head) : null;
      if (!target || !current) throw new Error("cannot revert: commit missing");
      const changes: Record<string, string | null> = {};
      for (const path of new Set([...Object.keys(current.tree), ...Object.keys(target.tree)])) {
        if (current.tree[path] !== target.tree[path]) changes[path] = target.tree[path] ?? null;
      }
      const commit = await this.repos.commit(token, { ref: "main", parent: head, changes, message: input.message, author: input.author });
      return commit.id;
    } finally {
      await this.repos.revokeToken(token);
    }
  }
}

export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
