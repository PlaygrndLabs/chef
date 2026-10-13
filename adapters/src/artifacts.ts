import git, { type HttpClient, type TreeEntry } from "isomorphic-git";
import webHttp from "isomorphic-git/http/web";
import { applyChanges, threeWayMerge, type Author, type Commit, type CommitInput, type MergeInput, type MergeOutcome, type PushedEvent, type RepoHost, type RepoInfo, type RepoToken, type TokenScope, type Tree } from "@chef/core";
import { MemoryFs } from "./memory-fs.ts";

const NOTE_ATTEMPTS = 8;
const HTTP_ATTEMPTS = 3;
const PUSH_ATTEMPTS = 3;

export interface ControlRepo {
  readonly name: string;
  readonly remote: string;
  readonly defaultBranch: string;
}

export interface CommitMeta {
  readonly hash: string;
  readonly treeHash: string;
  readonly message: string;
  readonly author: { readonly name: string; readonly email: string };
  readonly parents: readonly string[];
  readonly authoredAt: number;
}

export interface TreeEntryMeta {
  readonly name: string;
  readonly mode: string;
  readonly hash: string;
  readonly type: string;
}

export interface ArtifactsReader {
  readCommit(repo: string, hash: string): Promise<CommitMeta | null>;
  readTree(repo: string, hash: string): Promise<readonly TreeEntryMeta[] | null>;
  readBlob(repo: string, hash: string): Promise<Uint8Array | null>;
  log(repo: string, ref: string, limit: number): Promise<readonly CommitMeta[]>;
}

export interface ArtifactsControl {
  create(name: string, opts: { defaultBranch: string; description?: string }): Promise<ControlRepo>;
  fork(source: string, name: string): Promise<ControlRepo>;
  info(name: string): Promise<ControlRepo | null>;
  delete(name: string): Promise<boolean>;
  import?(name: string, source: { readonly url: string; readonly branch: string; readonly token?: string }): Promise<ControlRepo>;
  createToken(repo: string, scope: TokenScope, ttlSeconds: number): Promise<{ plaintext: string; expiresAt: number }>;
  revokeToken(repo: string, token: string): Promise<void>;
  readonly read?: ArtifactsReader;
}

interface ArtifactsRepoHandle {
  info(): Promise<{ name: string; remote: string; defaultBranch?: string; default_branch?: string }>;
  createToken(scope?: TokenScope, ttl?: number): Promise<{ plaintext: string; expiresAt: string | number }>;
  revokeToken(tokenOrId: string): Promise<boolean>;
  fork(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean }): Promise<{ name: string; remote: string; defaultBranch?: string }>;
  readCommit?(hash: string): Promise<CommitMeta | null>;
  readTree?(hash: string): Promise<TreeEntryMeta[] | null>;
  readBlob?(hash: string): Promise<Blob | null>;
  log?(opts?: { ref?: string; limit?: number; offset?: number }): Promise<CommitMeta[]>;
  [Symbol.dispose]?: () => void;
}

export interface ArtifactsBindingLike {
  create(name: string, opts?: { description?: string; readOnly?: boolean; setDefaultBranch?: string }): Promise<{ name: string; remote: string; defaultBranch: string; token: string }>;
  get(name: string): Promise<ArtifactsRepoHandle>;
  delete?(name: string): Promise<boolean>;
  import?(params: { source: { url: string; branch?: string; depth?: number }; target: { name: string; opts?: { description?: string; readOnly?: boolean } } }): Promise<{ name: string; remote: string; defaultBranch: string }>;
}

export function bindingControl(binding: ArtifactsBindingLike): ArtifactsControl {
  const withRepo = async <T>(name: string, task: (repo: ArtifactsRepoHandle) => Promise<T>): Promise<T> => {
    const repo = await binding.get(name);
    try {
      return await task(repo);
    } finally {
      repo[Symbol.dispose]?.();
    }
  };
  return {
    async create(name, opts) {
      const created = await binding.create(name, { setDefaultBranch: opts.defaultBranch, ...(opts.description ? { description: opts.description } : {}) });
      return { name: created.name, remote: created.remote, defaultBranch: created.defaultBranch };
    },
    fork: (source, name) =>
      withRepo(source, async (repo) => {
        const forked = await repo.fork(name, { defaultBranchOnly: true, readOnly: false });
        return { name: forked.name, remote: forked.remote, defaultBranch: forked.defaultBranch ?? "main" };
      }),
    async info(name) {
      try {
        return await withRepo(name, async (repo) => {
          const info = await repo.info();
          return { name: info.name, remote: info.remote, defaultBranch: info.defaultBranch ?? info.default_branch ?? "main" };
        });
      } catch {
        return null;
      }
    },
    createToken: (repo, scope, ttl) =>
      withRepo(repo, async (handle) => {
        const token = await handle.createToken(scope, ttl);
        return { plaintext: token.plaintext, expiresAt: typeof token.expiresAt === "number" ? token.expiresAt : Date.parse(token.expiresAt) };
      }),
    revokeToken: (repo, token) => withRepo(repo, async (handle) => void (await handle.revokeToken(token))),
    async delete(name) {
      if (!binding.delete) throw new Error("this Artifacts binding cannot delete repos");
      return binding.delete(name);
    },
    async import(name, source) {
      const importer = binding.import;
      if (!importer) throw new Error("this Artifacts binding cannot import repos");
      const run = async (url: string) => {
        const created = await importer.call(binding, { source: { url, branch: source.branch }, target: { name, opts: { description: `Imported from ${source.url}` } } });
        return { name: created.name, remote: created.remote, defaultBranch: created.defaultBranch };
      };
      try {
        return await run(source.url);
      } catch (error) {
        if (!source.token || (error as { code?: string }).code !== "REMOTE_AUTH_REQUIRED") throw error;
        const withAuth = new URL(source.url);
        withAuth.username = "x-access-token";
        withAuth.password = source.token;
        return run(withAuth.toString());
      }
    },
    read: {
      readCommit: (repo, hash) => withRepo(repo, async (handle) => (handle.readCommit ? handle.readCommit(hash) : null)),
      readTree: (repo, hash) => withRepo(repo, async (handle) => (handle.readTree ? handle.readTree(hash) : null)),
      readBlob: (repo, hash) =>
        withRepo(repo, async (handle) => {
          const blob = handle.readBlob ? await handle.readBlob(hash) : null;
          return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
        }),
      log: (repo, ref, limit) => withRepo(repo, async (handle) => (handle.log ? handle.log({ ref, limit }) : [])),
    },
  };
}

export function tokenSecret(token: string): string {
  return token.split("?expires=")[0] as string;
}

const GITDIR = "/repo.git";
const MAX_REPOS = 3;
const MAX_REPO_BYTES = 48 * 1024 * 1024;
const MAX_COMMIT_BYTES = 24 * 1024 * 1024;
const MAX_BLOB_BYTES = 16 * 1024 * 1024;

interface Cached {
  readonly name: string;
  readonly fs: MemoryFs;
  readonly remote: string;
}

export class Lru<V> {
  private readonly entries = new Map<string, { readonly value: V; readonly size: number }>();
  private total = 0;

  constructor(private readonly maxBytes: number) {}

  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, size: number): void {
    this.delete(key);
    if (size > this.maxBytes) return;
    this.entries.set(key, { value, size });
    this.total += size;
    for (const [oldest, entry] of this.entries) {
      if (this.total <= this.maxBytes) break;
      this.entries.delete(oldest);
      this.total -= entry.size;
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.total -= entry.size;
  }
}

export interface ArtifactsHostOptions {
  readonly http?: HttpClient;
  readonly readTtlSeconds?: number;
  readonly maxRepos?: number;
  readonly maxRepoBytes?: number;
  readonly wait?: (ms: number) => Promise<void>;
}

export class ArtifactsRepoHost implements RepoHost {
  private readonly cache = new Map<string, Cached>();
  private readonly remotes = new Map<string, string>();
  private readonly commits = new Lru<Commit>(MAX_COMMIT_BYTES);
  private readonly blobs = new Lru<string>(MAX_BLOB_BYTES);
  private readonly listeners = new Set<(event: PushedEvent) => void>();

  constructor(
    private readonly control: ArtifactsControl,
    private readonly options: ArtifactsHostOptions = {},
  ) {
    this.http = retryingHttp(options.http ?? webHttp, options.wait);
  }

  private readonly http: HttpClient;

  get cachedRepos(): readonly string[] {
    return [...this.cache.keys()];
  }

  async createRepo(name: string, opts: { defaultBranch?: string; description?: string } = {}): Promise<RepoInfo> {
    const repo = await this.control.create(name, { defaultBranch: opts.defaultBranch ?? "main", ...(opts.description ? { description: opts.description } : {}) });
    this.remotes.set(repo.name, repo.remote);
    return { name: repo.name, remote: repo.remote, defaultBranch: repo.defaultBranch };
  }

  async fork(source: string, name: string): Promise<RepoInfo> {
    const repo = await this.control.fork(source, name);
    this.remotes.set(repo.name, repo.remote);
    return { name: repo.name, remote: repo.remote, defaultBranch: repo.defaultBranch, forkedFrom: source };
  }

  async importRepo(name: string, source: { readonly url: string; readonly branch: string; readonly token?: string }): Promise<RepoInfo> {
    if (!this.control.import) throw new Error("this Artifacts namespace cannot import repos");
    if (source.branch !== "main") throw new Error(`only a main branch is imported directly, not ${source.branch}`);
    const repo = await this.control.import(name, source);
    this.remotes.set(repo.name, repo.remote);
    return { name: repo.name, remote: repo.remote, defaultBranch: repo.defaultBranch };
  }

  async deleteRepo(name: string): Promise<boolean> {
    this.cache.delete(name);
    this.remotes.delete(name);
    return this.control.delete(name);
  }

  async info(repo: string): Promise<RepoInfo | null> {
    const info = await this.control.info(repo);
    return info ? { name: info.name, remote: info.remote, defaultBranch: info.defaultBranch } : null;
  }

  async createToken(repo: string, scope: TokenScope, ttlSeconds: number): Promise<RepoToken> {
    const token = await this.control.createToken(repo, scope, Math.max(60, ttlSeconds));
    return { repo, scope, secret: token.plaintext, expiresAt: token.expiresAt };
  }

  async revokeToken(token: RepoToken): Promise<void> {
    await this.control.revokeToken(token.repo, token.secret);
  }

  async resolveRef(repo: string, ref: string): Promise<string | null> {
    const read = this.control.read;
    if (read) {
      const head = (await read.log(repo, shortRef(ref), 1).catch(() => []))[0];
      if (head) return head.hash;
    }
    if (!this.remotes.has(repo) && !(await this.control.info(repo))) return null;
    return this.withRead(repo, async (secret, cached) => {
      const refs = await git.listServerRefs({ http: this.http, url: cached.remote, prefix: fullRef(ref), onAuth: auth(secret) });
      return refs.find((r) => r.ref === fullRef(ref))?.oid ?? null;
    });
  }

  async readCommit(repo: string, id: string): Promise<Commit | null> {
    const known = this.commits.get(id);
    if (known) return known;
    const viaApi = await this.readCommitViaApi(repo, id);
    if (viaApi) return viaApi;
    return this.withRead(repo, async (secret, cached) => {
      if (!(await this.hasObject(cached, id))) await this.fetchRefs(cached, secret);
      if (!(await this.hasObject(cached, id))) return null;
      return this.loadCommit(cached, id);
    });
  }

  async log(repo: string, ref: string, limit = 50): Promise<Commit[]> {
    const read = this.control.read;
    if (read) {
      const entries = await read.log(repo, shortRef(ref), limit).catch(() => []);
      if (entries.length > 0) {
        const out: Commit[] = [];
        for (const entry of entries) {
          const commit = await this.readCommit(repo, entry.hash);
          if (commit) out.push(commit);
        }
        return out;
      }
    }
    return this.withRead(repo, async (secret, cached) => {
      await this.fetchRefs(cached, secret, [fullRef(ref)]);
      const head = await this.localRef(cached, `refs/remotes/origin/${shortRef(ref)}`);
      if (!head) return [];
      const entries = await git.log({ fs: cached.fs, gitdir: GITDIR, ref: head, depth: limit });
      const out: Commit[] = [];
      for (const entry of entries) out.push(await this.loadCommit(cached, entry.oid));
      return out;
    });
  }

  async commit(token: RepoToken, input: CommitInput): Promise<Commit> {
    const cached = await this.repo(token.repo);
    await this.fetchRefs(cached, tokenSecret(token.secret), [fullRef(input.ref)]);
    const current = await this.localRef(cached, `refs/remotes/origin/${shortRef(input.ref)}`);
    if (current !== input.parent) throw new Error(`non-fast-forward: ${input.ref} is at ${current ?? "nothing"}, not ${input.parent ?? "nothing"}`);
    const base: Tree = input.parent ? (await this.loadCommit(cached, input.parent)).tree : {};
    const tree = applyChanges(base, input.changes);
    const id = await this.writeCommit(cached, tree, input.parent ? [input.parent] : [], input.message, input.author);
    await this.push(cached, token, input.ref, id, false, input.parent);
    return this.loadCommit(cached, id);
  }

  async pushRef(token: RepoToken, input: { ref: string; commitId: string; fromRepo?: string; force?: boolean }): Promise<PushedEvent> {
    const cached = await this.repo(token.repo);
    const secret = tokenSecret(token.secret);
    await this.fetchRefs(cached, secret, [fullRef(input.ref)]);
    if (input.fromRepo) await this.fetchFrom(cached, input.fromRepo);
    else if (!(await this.hasObject(cached, input.commitId))) await this.fetchRefs(cached, secret);
    const before = await this.localRef(cached, `refs/remotes/origin/${shortRef(input.ref)}`);
    await this.push(cached, token, input.ref, input.commitId, input.force ?? false, before);
    if (input.fromRepo) await this.copyNotes(cached, token, input.fromRepo, input.commitId);
    return { repo: token.repo, ref: input.ref, before, after: input.commitId };
  }

  async merge(token: RepoToken, input: MergeInput): Promise<MergeOutcome> {
    const cached = await this.repo(token.repo);
    await this.fetchRefs(cached, tokenSecret(token.secret), [fullRef(input.into)]);
    const theirs = await this.fetchFrom(cached, input.from.repo, input.from.ref);
    if (!theirs) throw new Error(`unknown ref ${input.from.repo}:${input.from.ref}`);
    const ours = await this.localRef(cached, `refs/remotes/origin/${shortRef(input.into)}`);
    if (!ours) {
      await this.push(cached, token, input.into, theirs, false, null);
      await this.copyNotes(cached, token, input.from.repo, theirs);
      return { status: "fast-forward", commitId: theirs };
    }
    if (ours === theirs || (await git.isDescendent({ fs: cached.fs, gitdir: GITDIR, oid: ours, ancestor: theirs, depth: -1 }))) return { status: "up-to-date", commitId: ours };
    if (await git.isDescendent({ fs: cached.fs, gitdir: GITDIR, oid: theirs, ancestor: ours, depth: -1 })) {
      await this.push(cached, token, input.into, theirs, false, ours);
      await this.copyNotes(cached, token, input.from.repo, theirs);
      return { status: "fast-forward", commitId: theirs };
    }
    const [baseId] = await git.findMergeBase({ fs: cached.fs, gitdir: GITDIR, oids: [ours, theirs] });
    const baseTree: Tree = baseId ? (await this.loadCommit(cached, baseId)).tree : {};
    const markers = input.onConflict === "commit-markers";
    const result = threeWayMerge(baseTree, (await this.loadCommit(cached, ours)).tree, (await this.loadCommit(cached, theirs)).tree, input.resolvers, { markConflicts: markers });
    if (result.conflicts.length > 0 && !markers) return { status: "conflict", paths: result.conflicts };
    const final = await this.writeCommit(cached, result.tree, [ours, theirs], input.message, input.author);
    await this.push(cached, token, input.into, final, false, ours);
    await this.copyNotes(cached, token, input.from.repo, theirs);
    if (result.conflicts.length > 0) return { status: "conflicted", commitId: final, paths: result.conflicts };
    return { status: "merged", commitId: final };
  }

  async addNote(token: RepoToken, input: { namespace: string; commitId: string; note: string }): Promise<void> {
    const cached = await this.repo(token.repo);
    await this.fetchRefs(cached, tokenSecret(token.secret), [input.namespace]);
    await this.writeNotes(cached, token, input.namespace, [[input.commitId, input.note]]);
  }

  async readNote(repo: string, namespace: string, commitId: string): Promise<string | null> {
    const viaApi = await this.readNoteViaApi(repo, namespace, commitId);
    if (viaApi !== undefined) return viaApi;
    return this.withRead(repo, async (secret, cached) => {
      await this.fetchRefs(cached, secret, [namespace]);
      return this.localNote(cached, `refs/remotes/origin/${namespace.replace(/^refs\//, "")}`, commitId);
    });
  }

  onPush(listener: (event: PushedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitPush(event: PushedEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  private async readCommitViaApi(repo: string, id: string): Promise<Commit | null> {
    const read = this.control.read;
    if (!read) return null;
    try {
      const meta = await read.readCommit(repo, id);
      if (!meta) return null;
      const tree: Record<string, string> = {};
      const walk = async (hash: string, prefix: string): Promise<void> => {
        const entries = await read.readTree(repo, hash);
        if (!entries) throw new Error(`tree ${hash} is missing`);
        await Promise.all(
          entries.map(async (entry) => {
            if (entry.type === "tree") return walk(entry.hash, `${prefix}${entry.name}/`);
            if (entry.type !== "blob" && entry.type !== "exec") return;
            tree[`${prefix}${entry.name}`] = await this.blobText(repo, entry.hash);
          }),
        );
      };
      await walk(meta.treeHash, "");
      const sorted: Record<string, string> = {};
      for (const key of Object.keys(tree).sort()) sorted[key] = tree[key] as string;
      return this.remember({ id, parents: [...meta.parents], tree: sorted, message: meta.message.trimEnd(), author: { name: meta.author.name, email: meta.author.email }, timestamp: meta.authoredAt * 1000 });
    } catch {
      return null;
    }
  }

  private async blobText(repo: string, hash: string): Promise<string> {
    const known = this.blobs.get(hash);
    if (known !== undefined) return known;
    const bytes = await this.control.read?.readBlob(repo, hash);
    if (!bytes) throw new Error(`blob ${hash} is missing`);
    const text = new TextDecoder().decode(bytes);
    this.blobs.set(hash, text, text.length * 2);
    return text;
  }

  private async readNoteViaApi(repo: string, namespace: string, commitId: string): Promise<string | null | undefined> {
    const read = this.control.read;
    if (!read) return undefined;
    try {
      const head = (await read.log(repo, namespace, 1))[0];
      if (!head) return undefined;
      const root = await read.readTree(repo, head.treeHash);
      if (!root) return undefined;
      const flat = root.find((e) => e.name === commitId);
      if (flat) return new TextDecoder().decode((await read.readBlob(repo, flat.hash)) ?? new Uint8Array());
      const fanout = root.find((e) => e.name === commitId.slice(0, 2) && e.type === "tree");
      if (!fanout) return null;
      const inner = (await read.readTree(repo, fanout.hash))?.find((e) => e.name === commitId.slice(2));
      return inner ? new TextDecoder().decode((await read.readBlob(repo, inner.hash)) ?? new Uint8Array()) : null;
    } catch {
      return undefined;
    }
  }

  private remember(commit: Commit): Commit {
    let size = 256 + commit.message.length * 2;
    for (const [path, content] of Object.entries(commit.tree)) size += (path.length + content.length) * 2;
    this.commits.set(commit.id, commit, size);
    return commit;
  }

  private async remoteOf(name: string): Promise<string> {
    const known = this.remotes.get(name) ?? this.cache.get(name)?.remote;
    if (known) return known;
    const info = await this.control.info(name);
    if (!info) throw new Error(`unknown repo ${name}`);
    this.remotes.set(name, info.remote);
    return info.remote;
  }

  private async repo(name: string): Promise<Cached> {
    const existing = this.cache.get(name);
    if (existing) {
      this.cache.delete(name);
      if (existing.fs.bytes() <= (this.options.maxRepoBytes ?? MAX_REPO_BYTES)) {
        this.cache.set(name, existing);
        return existing;
      }
    }
    const remote = await this.remoteOf(name);
    const info = existing ? null : await this.control.info(name);
    if (!existing && !info) throw new Error(`unknown repo ${name}`);
    const fs = new MemoryFs();
    await git.init({ fs, gitdir: GITDIR, bare: true, defaultBranch: info?.defaultBranch ?? "main" });
    await addRemote(fs, "origin", remote);
    const cached = { name, fs, remote };
    this.cache.set(name, cached);
    for (const oldest of this.cache.keys()) {
      if (this.cache.size <= (this.options.maxRepos ?? MAX_REPOS)) break;
      this.cache.delete(oldest);
    }
    return cached;
  }

  private async withRead<T>(repo: string, task: (secret: string, cached: Cached) => Promise<T>): Promise<T> {
    const cached = await this.repo(repo);
    const token = await this.control.createToken(repo, "read", this.options.readTtlSeconds ?? 300);
    try {
      return await task(tokenSecret(token.plaintext), cached);
    } finally {
      await this.control.revokeToken(repo, token.plaintext).catch(() => undefined);
    }
  }

  private async fetchRefs(cached: Cached, secret: string, wanted?: readonly string[]): Promise<void> {
    try {
      await this.fetchRefsOnce(cached, secret, wanted);
    } catch (error) {
      throw withContext(error, `fetch ${wanted?.map(shortRef).join(", ") ?? "every branch"} from ${cached.name}`);
    }
  }

  private async fetchRefsOnce(cached: Cached, secret: string, wanted?: readonly string[]): Promise<void> {
    const refs = await git.listServerRefs({ http: this.http, url: cached.remote, onAuth: auth(secret) });
    if (refs.length === 0) return;
    for (const { ref, oid } of refs) {
      const isNote = ref.startsWith("refs/notes/");
      if (!ref.startsWith("refs/heads/") && !isNote) continue;
      if (wanted && !isNote && !wanted.includes(ref)) continue;
      const local = `refs/remotes/origin/${ref.replace(/^refs\/(heads\/)?/, "")}`;
      if ((await this.localRef(cached, local)) === oid) continue;
      await git.fetch({ fs: cached.fs, http: this.http, gitdir: GITDIR, url: cached.remote, ref, remoteRef: ref, remote: "origin", singleBranch: true, tags: false, onAuth: auth(secret) });
      await git.writeRef({ fs: cached.fs, gitdir: GITDIR, ref: local, value: oid, force: true });
    }
  }

  private async fetchFrom(cached: Cached, repo: string, ref = "main"): Promise<string | null> {
    const sourceRemote = await this.remoteOf(repo);
    const remote = `src-${repo}`;
    await addRemote(cached.fs, remote, sourceRemote);
    const token = await this.control.createToken(repo, "read", this.options.readTtlSeconds ?? 300);
    const secret = tokenSecret(token.plaintext);
    try {
      const refs = await git.listServerRefs({ http: this.http, url: sourceRemote, onAuth: auth(secret) });
      const head = refs.find((r) => r.ref === fullRef(ref))?.oid ?? null;
      for (const r of refs) {
        if (r.ref !== fullRef(ref) && !r.ref.startsWith("refs/notes/")) continue;
        const local = `refs/sources/${repo}/${r.ref.replace(/^refs\/(heads\/)?/, "")}`;
        if ((await this.localRef(cached, local)) !== r.oid) await git.fetch({ fs: cached.fs, http: this.http, gitdir: GITDIR, url: sourceRemote, ref: r.ref, remoteRef: r.ref, remote, singleBranch: true, tags: false, onAuth: auth(secret) });
        await git.writeRef({ fs: cached.fs, gitdir: GITDIR, ref: local, value: r.oid, force: true });
      }
      return head;
    } finally {
      await this.control.revokeToken(repo, token.plaintext).catch(() => undefined);
    }
  }

  private async copyNotes(cached: Cached, token: RepoToken, fromRepo: string, head: string): Promise<void> {
    const reachable = new Set((await git.log({ fs: cached.fs, gitdir: GITDIR, ref: head })).map((c) => c.oid));
    const namespaces = (await git.listRefs({ fs: cached.fs, gitdir: GITDIR, filepath: `refs/sources/${fromRepo}/notes` })).map((n) => `refs/notes/${n}`);
    for (const namespace of namespaces) {
      const sourceRef = `refs/sources/${fromRepo}/${namespace.replace(/^refs\//, "")}`;
      const notes = await git.listNotes({ fs: cached.fs, gitdir: GITDIR, ref: sourceRef }).catch(() => []);
      const entries: [string, string][] = [];
      for (const { target } of notes) {
        if (!reachable.has(target)) continue;
        const note = await this.localNote(cached, sourceRef, target);
        const existing = await this.localNote(cached, `refs/remotes/origin/${namespace.replace(/^refs\//, "")}`, target);
        if (note !== null && note !== existing) entries.push([target, note]);
      }
      if (entries.length > 0) await this.writeNotes(cached, token, namespace, entries);
    }
  }

  private async writeNotes(cached: Cached, token: RepoToken, namespace: string, entries: readonly [string, string][]): Promise<void> {
    const remoteNotes = `refs/remotes/origin/${namespace.replace(/^refs\//, "")}`;
    for (let attempt = 1; ; attempt++) {
      const before = await this.localRef(cached, remoteNotes);
      if (before) await git.writeRef({ fs: cached.fs, gitdir: GITDIR, ref: namespace, value: before, force: true });
      else await git.deleteRef({ fs: cached.fs, gitdir: GITDIR, ref: namespace }).catch(() => undefined);
      for (const [oid, note] of entries) await git.addNote({ fs: cached.fs, gitdir: GITDIR, ref: namespace, oid, note, force: true, author: { name: "chef", email: "ma.karimi76@gmail.com" } });
      const after = await this.localRef(cached, namespace);
      if (!after) return;
      try {
        await this.push(cached, token, namespace, after, false, before);
        return;
      } catch (error) {
        if (attempt >= NOTE_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt + Math.random() * 100));
        await this.fetchRefs(cached, tokenSecret(token.secret), [namespace]);
      }
    }
  }

  private async localNote(cached: Cached, ref: string, oid: string): Promise<string | null> {
    try {
      const blob = await git.readNote({ fs: cached.fs, gitdir: GITDIR, ref, oid });
      return new TextDecoder().decode(blob);
    } catch {
      return null;
    }
  }

  private async push(cached: Cached, token: RepoToken, ref: string, oid: string, force: boolean, before: string | null): Promise<void> {
    const local = `refs/chef/push/${shortRef(ref)}`;
    const secret = tokenSecret(token.secret);
    await git.writeRef({ fs: cached.fs, gitdir: GITDIR, ref: local, value: oid, force: true });
    for (let attempt = 1; ; attempt++) {
      try {
        const result = await git.push({ fs: cached.fs, http: this.http, gitdir: GITDIR, url: cached.remote, ref: local, remoteRef: fullRef(ref), force, onAuth: auth(secret) });
        if (!result.ok) throw new Error(`push to ${ref} rejected: ${result.error ?? JSON.stringify(result.refs)}`);
        break;
      } catch (error) {
        if (!serverError(error)) throw error;
        const remote = await git.listServerRefs({ http: this.http, url: cached.remote, prefix: fullRef(ref), onAuth: auth(secret) }).catch(() => null);
        const now = remote ? (remote.find((r) => r.ref === fullRef(ref))?.oid ?? null) : undefined;
        if (now === oid) break;
        if (attempt >= PUSH_ATTEMPTS || now === undefined || (!force && now !== before)) throw withContext(error, `push ${shortRef(ref)} to ${cached.name}`);
        await (this.options.wait ?? sleep)(backoff(attempt));
      }
    }
    await git.writeRef({ fs: cached.fs, gitdir: GITDIR, ref: `refs/remotes/origin/${fullRef(ref).replace(/^refs\/(heads\/)?/, "")}`, value: oid, force: true });
    this.emitPush({ repo: token.repo, ref: shortRef(ref), before, after: oid });
  }

  private async localRef(cached: Cached, ref: string): Promise<string | null> {
    try {
      return await git.resolveRef({ fs: cached.fs, gitdir: GITDIR, ref });
    } catch {
      return null;
    }
  }

  private async hasObject(cached: Cached, oid: string): Promise<boolean> {
    try {
      await git.readObject({ fs: cached.fs, gitdir: GITDIR, oid, format: "deflated" });
      return true;
    } catch {
      return false;
    }
  }

  private async loadCommit(cached: Cached, oid: string): Promise<Commit> {
    const known = this.commits.get(oid);
    if (known) return known;
    const { commit } = await git.readCommit({ fs: cached.fs, gitdir: GITDIR, oid });
    const tree: Record<string, string> = {};
    const walk = async (treeOid: string, prefix: string) => {
      const { tree: entries } = await git.readTree({ fs: cached.fs, gitdir: GITDIR, oid: treeOid });
      for (const entry of entries) {
        if (entry.type === "tree") await walk(entry.oid, `${prefix}${entry.path}/`);
        else if (entry.type === "blob") {
          const { blob } = await git.readBlob({ fs: cached.fs, gitdir: GITDIR, oid: entry.oid });
          tree[`${prefix}${entry.path}`] = new TextDecoder().decode(blob);
        }
      }
    };
    await walk(commit.tree, "");
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(tree).sort()) sorted[key] = tree[key] as string;
    return this.remember({ id: oid, parents: commit.parent, tree: sorted, message: commit.message.trimEnd(), author: { name: commit.author.name, email: commit.author.email }, timestamp: commit.author.timestamp * 1000 });
  }

  private async writeCommit(cached: Cached, tree: Tree, parents: readonly string[], message: string, author: Author): Promise<string> {
    const root = await this.writeTree(cached, tree, "");
    return git.writeCommit({
      fs: cached.fs,
      gitdir: GITDIR,
      commit: { message: message.endsWith("\n") ? message : `${message}\n`, tree: root, parent: [...parents], author: gitAuthorStamp(author), committer: gitAuthorStamp(author) },
    });
  }

  private async writeTree(cached: Cached, tree: Tree, prefix: string): Promise<string> {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    for (const path of Object.keys(tree)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) files.set(rest, tree[path] as string);
      else dirs.add(rest.slice(0, slash));
    }
    const entries: TreeEntry[] = [];
    for (const [name, content] of files) {
      const oid = await git.writeBlob({ fs: cached.fs, gitdir: GITDIR, blob: new TextEncoder().encode(content) });
      entries.push({ mode: "100644", path: name, oid, type: "blob" });
    }
    for (const name of dirs) entries.push({ mode: "040000", path: name, oid: await this.writeTree(cached, tree, `${prefix}${name}/`), type: "tree" });
    return git.writeTree({ fs: cached.fs, gitdir: GITDIR, tree: entries });
  }
}

export function retryingHttp(inner: HttpClient, wait: (ms: number) => Promise<void> = sleep): HttpClient {
  return {
    async request(request) {
      const chunks: Uint8Array[] = [];
      if (request.body) for await (const chunk of request.body) chunks.push(chunk);
      const once = request.method === "POST" && /\/git-receive-pack$/.test(new URL(request.url).pathname);
      for (let attempt = 1; ; attempt++) {
        const body = request.body ? { body: replay(chunks) } : {};
        const last = once || attempt >= HTTP_ATTEMPTS;
        try {
          const response = await inner.request({ ...request, ...body });
          if (last || !retryableStatus(response.statusCode)) return response;
        } catch (error) {
          if (last || (error as Error | null)?.name === "AbortError") throw error;
        }
        await wait(backoff(attempt));
      }
    },
  };
}

async function* replay(chunks: readonly Uint8Array[]): AsyncIterableIterator<Uint8Array> {
  yield* chunks;
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function serverError(error: unknown): boolean {
  const status = (error as { data?: { statusCode?: unknown } } | null)?.data?.statusCode;
  return typeof status === "number" && retryableStatus(status);
}

function withContext(error: unknown, label: string): unknown {
  if (error instanceof Error && !error.message.startsWith(label)) error.message = `${label}: ${error.message}`;
  return error;
}

function backoff(attempt: number): number {
  return 250 * 4 ** (attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function addRemote(fs: MemoryFs, remote: string, url: string): Promise<void> {
  await git.addRemote({ fs, gitdir: GITDIR, remote, url, force: true });
  await git.setConfig({ fs, gitdir: GITDIR, path: `remote.${remote}.fetch`, value: `+refs/notes/*:refs/remotes/${remote}/notes/*`, append: true });
}

function fullRef(ref: string): string {
  return ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
}

function shortRef(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

function auth(secret: string) {
  return () => ({ username: "x", password: secret });
}

function gitAuthorStamp(author: Author) {
  return { name: author.name, email: author.email, timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 };
}
