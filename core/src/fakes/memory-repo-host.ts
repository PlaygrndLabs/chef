import { applyChanges, threeWayMerge, type Commit, type CommitSummary, type Tree } from "../git/tree.ts";
import type { CommitInput, MergeInput, MergeOutcome, PushedEvent, RepoHost, RepoInfo, RepoToken, TokenScope } from "../ports/repo-host.ts";
import type { Clock } from "../ports/runtime.ts";
import { hashHex, stableStringify } from "../util/hash.ts";

export class RepoAccessError extends Error {}

interface RepoState {
  readonly info: RepoInfo;
  readonly refs: Map<string, string>;
  readonly notes: Map<string, Map<string, string>>;
}

interface TokenState {
  readonly token: RepoToken;
  revoked: boolean;
}

export class MemoryRepoHost implements RepoHost {
  readonly objects = new Map<string, Commit>();
  readonly repos = new Map<string, RepoState>();
  readonly issued: RepoToken[] = [];
  private readonly tokens = new Map<string, TokenState>();
  private readonly listeners = new Set<(event: PushedEvent) => void>();
  private counter = 0;

  constructor(
    private readonly clock: Clock,
    private readonly domain = "artifacts.example",
  ) {}

  async createRepo(name: string, opts: { defaultBranch?: string } = {}): Promise<RepoInfo> {
    if (this.repos.has(name)) throw new RepoAccessError(`repo ${name} already exists`);
    const info: RepoInfo = { name, remote: `https://${this.domain}/git/${name}.git`, defaultBranch: opts.defaultBranch ?? "main" };
    this.repos.set(name, { info, refs: new Map(), notes: new Map() });
    return info;
  }

  async fork(source: string, name: string): Promise<RepoInfo> {
    const from = this.repo(source);
    if (this.repos.has(name)) throw new RepoAccessError(`repo ${name} already exists`);
    const info: RepoInfo = { name, remote: `https://${this.domain}/git/${name}.git`, defaultBranch: from.info.defaultBranch, forkedFrom: source };
    const notes = new Map<string, Map<string, string>>();
    for (const [ns, map] of from.notes) notes.set(ns, new Map(map));
    const refs = new Map<string, string>();
    const head = from.refs.get(from.info.defaultBranch);
    if (head) refs.set(from.info.defaultBranch, head);
    this.repos.set(name, { info, refs, notes });
    return info;
  }

  async deleteRepo(name: string): Promise<boolean> {
    if (!this.repos.delete(name)) return false;
    for (const state of this.tokens.values()) if (state.token.repo === name) state.revoked = true;
    return true;
  }

  async info(repo: string): Promise<RepoInfo | null> {
    return this.repos.get(repo)?.info ?? null;
  }

  async createToken(repo: string, scope: TokenScope, ttlSeconds: number): Promise<RepoToken> {
    this.repo(repo);
    const token: RepoToken = { repo, scope, secret: `art_${scope}_${hashHex(`${repo}:${++this.counter}`)}`, expiresAt: this.clock.now() + ttlSeconds * 1000 };
    this.tokens.set(token.secret, { token, revoked: false });
    this.issued.push(token);
    return token;
  }

  async revokeToken(token: RepoToken): Promise<void> {
    const state = this.tokens.get(token.secret);
    if (state) state.revoked = true;
  }

  async resolveRef(repo: string, ref: string): Promise<string | null> {
    return this.repos.get(repo)?.refs.get(ref) ?? null;
  }

  async readCommit(repo: string, id: string): Promise<Commit | null> {
    if (!this.repos.has(repo)) return null;
    return this.objects.get(id) ?? null;
  }

  async history(repo: string, ref: string, limit = 50): Promise<CommitSummary[]> {
    return (await this.log(repo, ref, limit)).map(({ tree: _tree, ...summary }) => summary);
  }

  async log(repo: string, ref: string, limit = 50): Promise<Commit[]> {
    const out: Commit[] = [];
    let id = this.repo(repo).refs.get(ref) ?? null;
    while (id && out.length < limit) {
      const commit = this.objects.get(id);
      if (!commit) break;
      out.push(commit);
      id = commit.parents[0] ?? null;
    }
    return out;
  }

  async commit(token: RepoToken, input: CommitInput): Promise<Commit> {
    const repo = this.authorize(token, "write");
    const current = repo.refs.get(input.ref) ?? null;
    if (current !== input.parent) throw new RepoAccessError(`non-fast-forward: ${input.ref} is at ${current ?? "nothing"}, not ${input.parent ?? "nothing"}`);
    const base: Tree = input.parent ? (this.objects.get(input.parent)?.tree ?? {}) : {};
    const commit = this.store({ parents: input.parent ? [input.parent] : [], tree: applyChanges(base, input.changes), message: input.message, author: input.author });
    this.setRef(repo, input.ref, commit.id);
    return commit;
  }

  async pushRef(token: RepoToken, input: { ref: string; commitId: string; fromRepo?: string; force?: boolean }): Promise<PushedEvent> {
    const repo = this.authorize(token, "write");
    if (!this.objects.has(input.commitId)) throw new RepoAccessError(`unknown commit ${input.commitId}`);
    const current = repo.refs.get(input.ref) ?? null;
    if (current && !input.force && !this.isAncestor(current, input.commitId)) throw new RepoAccessError(`non-fast-forward push to ${input.ref}`);
    if (input.fromRepo) this.copyNotes(this.repo(input.fromRepo), repo, input.commitId);
    return this.setRef(repo, input.ref, input.commitId);
  }

  async merge(token: RepoToken, input: MergeInput): Promise<MergeOutcome> {
    const repo = this.authorize(token, "write");
    const source = this.repo(input.from.repo);
    const theirs = source.refs.get(input.from.ref);
    if (!theirs) throw new RepoAccessError(`unknown ref ${input.from.repo}:${input.from.ref}`);
    const ours = repo.refs.get(input.into) ?? null;
    this.copyNotes(source, repo, theirs);
    if (!ours) {
      this.setRef(repo, input.into, theirs);
      return { status: "fast-forward", commitId: theirs };
    }
    if (ours === theirs || this.isAncestor(theirs, ours)) return { status: "up-to-date", commitId: ours };
    if (!input.noFastForward && this.isAncestor(ours, theirs)) {
      this.setRef(repo, input.into, theirs);
      return { status: "fast-forward", commitId: theirs };
    }
    const baseId = this.mergeBase(ours, theirs);
    const baseTree = baseId ? (this.objects.get(baseId)?.tree ?? {}) : {};
    const markers = input.onConflict === "commit-markers";
    const result = threeWayMerge(baseTree, this.tree(ours), this.tree(theirs), input.resolvers, { markConflicts: markers });
    if (result.conflicts.length > 0 && !markers) return { status: "conflict", paths: result.conflicts };
    const commit = this.store({ parents: [ours, theirs], tree: result.tree, message: input.message, author: input.author });
    this.setRef(repo, input.into, commit.id);
    if (result.conflicts.length > 0) return { status: "conflicted", commitId: commit.id, paths: result.conflicts };
    return { status: "merged", commitId: commit.id };
  }

  async addNote(token: RepoToken, input: { namespace: string; commitId: string; note: string }): Promise<void> {
    const repo = this.authorize(token, "write");
    let map = repo.notes.get(input.namespace);
    if (!map) repo.notes.set(input.namespace, (map = new Map()));
    map.set(input.commitId, input.note);
  }

  async readNote(repo: string, namespace: string, commitId: string): Promise<string | null> {
    return this.repos.get(repo)?.notes.get(namespace)?.get(commitId) ?? null;
  }

  onPush(listener: (event: PushedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isAncestor(ancestor: string, descendant: string): boolean {
    return this.ancestors(descendant).has(ancestor);
  }

  ancestors(id: string): Set<string> {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      for (const parent of this.objects.get(next)?.parents ?? []) stack.push(parent);
    }
    return seen;
  }

  private mergeBase(a: string, b: string): string | null {
    const fromA = this.ancestors(a);
    const queue = [b];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      if (fromA.has(next)) return next;
      queue.push(...(this.objects.get(next)?.parents ?? []));
    }
    return null;
  }

  private tree(id: string): Tree {
    return this.objects.get(id)?.tree ?? {};
  }

  private store(input: Omit<Commit, "id" | "timestamp">): Commit {
    const timestamp = this.clock.now();
    const id = hashHex(stableStringify({ ...input, timestamp, n: this.objects.size })) + hashHex(stableStringify(input.tree)).slice(0, 16);
    const commit: Commit = { id, timestamp, ...input };
    this.objects.set(id, commit);
    return commit;
  }

  private setRef(repo: RepoState, ref: string, id: string): PushedEvent {
    const before = repo.refs.get(ref) ?? null;
    repo.refs.set(ref, id);
    const event: PushedEvent = { repo: repo.info.name, ref, before, after: id };
    for (const listener of [...this.listeners]) listener(event);
    return event;
  }

  private copyNotes(from: RepoState, to: RepoState, head: string): void {
    const reachable = this.ancestors(head);
    for (const [ns, map] of from.notes) {
      let target = to.notes.get(ns);
      if (!target) to.notes.set(ns, (target = new Map()));
      for (const [commitId, note] of map) if (reachable.has(commitId)) target.set(commitId, note);
    }
  }

  private repo(name: string): RepoState {
    const repo = this.repos.get(name);
    if (!repo) throw new RepoAccessError(`unknown repo ${name}`);
    return repo;
  }

  private authorize(token: RepoToken, scope: TokenScope): RepoState {
    const state = this.tokens.get(token.secret);
    if (!state || state.revoked) throw new RepoAccessError("token is not valid");
    if (state.token.expiresAt < this.clock.now()) throw new RepoAccessError("token expired");
    if (scope === "write" && state.token.scope !== "write") throw new RepoAccessError(`token for ${state.token.repo} is read-only`);
    return this.repo(state.token.repo);
  }
}
