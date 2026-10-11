import { diffTrees, threeWayMerge, type Author, type Resolver } from "../git/tree.ts";
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

  async revert(input: { to: string; merged: string; message: string; author: Author; expectedHead: string; resolvers?: Readonly<Record<string, Resolver>> }): Promise<{ commitId: string; cascaded: boolean }> {
    const token = await this.repos.createToken(this.canonical, "write", this.ttlSeconds);
    try {
      const head = await this.repos.resolveRef(this.canonical, "main");
      if (head !== input.expectedHead) throw new Error(`main moved from ${input.expectedHead} to ${head}`);
      const before = await this.repos.readCommit(this.canonical, input.to);
      const merged = await this.repos.readCommit(this.canonical, input.merged);
      const current = head ? await this.repos.readCommit(this.canonical, head) : null;
      if (!before || !merged || !current) throw new Error("cannot revert: commit missing");
      const inverse = threeWayMerge(merged.tree, current.tree, before.tree, input.resolvers ?? {});
      const cascaded = inverse.conflicts.length > 0;
      const target = cascaded ? before.tree : inverse.tree;
      const message = cascaded ? `${input.message}\n\nReverting only ${input.merged} conflicted in ${inverse.conflicts.join(", ")}, so main returns to ${input.to}.` : input.message;
      const commit = await this.repos.commit(token, { ref: "main", parent: head, changes: diffTrees(current.tree, target), message, author: input.author });
      return { commitId: commit.id, cascaded };
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
