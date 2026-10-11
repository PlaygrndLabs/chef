import git, { type HttpClient, type TreeEntry } from "isomorphic-git";
import webHttp from "isomorphic-git/http/web";
import { applyChanges, threeWayMerge, type Author, type Commit, type CommitInput, type MergeInput, type MergeOutcome, type PushedEvent, type RepoHost, type RepoInfo, type RepoToken, type TokenScope, type Tree } from "@kargah/core";
import { MemoryFs } from "./memory-fs.ts";

export interface ControlRepo {
  readonly name: string;
  readonly remote: string;
  readonly defaultBranch: string;
}

export interface ArtifactsControl {
  create(name: string, opts: { defaultBranch: string; description?: string }): Promise<ControlRepo>;
  fork(source: string, name: string): Promise<ControlRepo>;
  info(name: string): Promise<ControlRepo | null>;
  createToken(repo: string, scope: TokenScope, ttlSeconds: number): Promise<{ plaintext: string; expiresAt: number }>;
  revokeToken(repo: string, token: string): Promise<void>;
}

interface ArtifactsRepoHandle {
  info(): Promise<{ name: string; remote: string; defaultBranch?: string; default_branch?: string }>;
  createToken(scope?: TokenScope, ttl?: number): Promise<{ plaintext: string; expiresAt: string | number }>;
  revokeToken(tokenOrId: string): Promise<boolean>;
  fork(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean }): Promise<{ name: string; remote: string; defaultBranch?: string }>;
  [Symbol.dispose]?: () => void;
}

export interface ArtifactsBindingLike {
  create(name: string, opts?: { description?: string; readOnly?: boolean; setDefaultBranch?: string }): Promise<{ name: string; remote: string; defaultBranch: string; token: string }>;
  get(name: string): Promise<ArtifactsRepoHandle>;
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
  };
}

export function tokenSecret(token: string): string {
  return token.split("?expires=")[0] as string;
}

const GITDIR = "/repo.git";

interface Cached {
  readonly fs: MemoryFs;
  readonly remote: string;
}

export class ArtifactsRepoHost implements RepoHost {
  private readonly cache = new Map<string, Cached>();
  private readonly commits = new Map<string, Commit>();
  private readonly listeners = new Set<(event: PushedEvent) => void>();

  constructor(
    private readonly control: ArtifactsControl,
    private readonly options: { readonly http?: HttpClient; readonly readTtlSeconds?: number } = {},
  ) {}

  private get http(): HttpClient {
    return this.options.http ?? webHttp;
  }

  async createRepo(name: string, opts: { defaultBranch?: string; description?: string } = {}): Promise<RepoInfo> {
    const repo = await this.control.create(name, { defaultBranch: opts.defaultBranch ?? "main", ...(opts.description ? { description: opts.description } : {}) });
    return { name: repo.name, remote: repo.remote, defaultBranch: repo.defaultBranch };
  }

  async fork(source: string, name: string): Promise<RepoInfo> {
    const repo = await this.control.fork(source, name);
    return { name: repo.name, remote: repo.remote, defaultBranch: repo.defaultBranch, forkedFrom: source };
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
    return this.withRead(repo, async (secret, cached) => {
      const refs = await git.listServerRefs({ http: this.http, url: cached.remote, prefix: fullRef(ref), onAuth: auth(secret) });
      return refs.find((r) => r.ref === fullRef(ref))?.oid ?? null;
    });
  }

  async readCommit(repo: string, id: string): Promise<Commit | null> {
    const known = this.commits.get(id);
    if (known) return known;
    return this.withRead(repo, async (secret, cached) => {
      if (!(await this.hasObject(cached, id))) await this.fetchAll(cached, secret);
      if (!(await this.hasObject(cached, id))) return null;
      return this.loadCommit(cached, id);
    });
  }

  async log(repo: string, ref: string, limit = 50): Promise<Commit[]> {
    return this.withRead(repo, async (secret, cached) => {
      await this.fetchAll(cached, secret);
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
    await this.fetchAll(cached, tokenSecret(token.secret));
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
    await this.fetchAll(cached, secret);
    if (input.fromRepo) await this.fetchFrom(cached, input.fromRepo);
    const before = await this.localRef(cached, `refs/remotes/origin/${shortRef(input.ref)}`);
    await this.push(cached, token, input.ref, input.commitId, input.force ?? false, before);
    if (input.fromRepo) await this.copyNotes(cached, token, input.fromRepo, input.commitId);
    return { repo: token.repo, ref: input.ref, before, after: input.commitId };
  }

  async merge(token: RepoToken, input: MergeInput): Promise<MergeOutcome> {
    const cached = await this.repo(token.repo);
    await this.fetchAll(cached, tokenSecret(token.secret));
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
    const result = threeWayMerge(baseTree, (await this.loadCommit(cached, ours)).tree, (await this.loadCommit(cached, theirs)).tree, input.resolvers);
    if (result.conflicts.length > 0) return { status: "conflict", paths: result.conflicts };
    const final = await this.writeCommit(cached, result.tree, [ours, theirs], input.message, input.author);
    await this.push(cached, token, input.into, final, false, ours);
    await this.copyNotes(cached, token, input.from.repo, theirs);
    return { status: "merged", commitId: final };
  }

  async addNote(token: RepoToken, input: { namespace: string; commitId: string; note: string }): Promise<void> {
    const cached = await this.repo(token.repo);
    await this.fetchAll(cached, tokenSecret(token.secret));
    await this.writeNotes(cached, token, input.namespace, [[input.commitId, input.note]]);
  }

  async readNote(repo: string, namespace: string, commitId: string): Promise<string | null> {
    return this.withRead(repo, async (secret, cached) => {
      await this.fetchAll(cached, secret);
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

  private async repo(name: string): Promise<Cached> {
    const existing = this.cache.get(name);
    if (existing) return existing;
    const info = await this.control.info(name);
    if (!info) throw new Error(`unknown repo ${name}`);
    const fs = new MemoryFs();
    await git.init({ fs, gitdir: GITDIR, bare: true, defaultBranch: info.defaultBranch });
    await addRemote(fs, "origin", info.remote);
    const cached = { fs, remote: info.remote };
    this.cache.set(name, cached);
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

  private async fetchAll(cached: Cached, secret: string): Promise<void> {
    const refs = await git.listServerRefs({ http: this.http, url: cached.remote, onAuth: auth(secret) });
    if (refs.length === 0) return;
    for (const { ref } of refs) {
      if (!ref.startsWith("refs/heads/") && !ref.startsWith("refs/notes/")) continue;
      await git.fetch({ fs: cached.fs, http: this.http, gitdir: GITDIR, url: cached.remote, ref, remoteRef: ref, remote: "origin", singleBranch: true, tags: false, onAuth: auth(secret) });
      const oid = refs.find((r) => r.ref === ref)?.oid;
      if (oid) await git.writeRef({ fs: cached.fs, gitdir: GITDIR, ref: `refs/remotes/origin/${ref.replace(/^refs\/(heads\/)?/, "")}`, value: oid, force: true });
    }
  }

  private async fetchFrom(cached: Cached, repo: string, ref = "main"): Promise<string | null> {
    const source = await this.repo(repo);
    const remote = `src-${repo}`;
    await addRemote(cached.fs, remote, source.remote);
    return this.withRead(repo, async (secret) => {
      const refs = await git.listServerRefs({ http: this.http, url: source.remote, onAuth: auth(secret) });
      const head = refs.find((r) => r.ref === fullRef(ref))?.oid ?? null;
      for (const r of refs) {
        if (r.ref !== fullRef(ref) && !r.ref.startsWith("refs/notes/")) continue;
        await git.fetch({ fs: cached.fs, http: this.http, gitdir: GITDIR, url: source.remote, ref: r.ref, remoteRef: r.ref, remote, singleBranch: true, tags: false, onAuth: auth(secret) });
        await git.writeRef({ fs: cached.fs, gitdir: GITDIR, ref: `refs/sources/${repo}/${r.ref.replace(/^refs\/(heads\/)?/, "")}`, value: r.oid, force: true });
      }
      return head;
    });
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
    const before = await this.localRef(cached, remoteNotes);
    if (before) await git.writeRef({ fs: cached.fs, gitdir: GITDIR, ref: namespace, value: before, force: true });
    else await git.deleteRef({ fs: cached.fs, gitdir: GITDIR, ref: namespace }).catch(() => undefined);
    for (const [oid, note] of entries) await git.addNote({ fs: cached.fs, gitdir: GITDIR, ref: namespace, oid, note, force: true, author: { name: "kargah", email: "ma.karimi76@gmail.com" } });
    const after = await this.localRef(cached, namespace);
    if (!after) return;
    await this.push(cached, token, namespace, after, false, before);
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
    const local = `refs/kargah/push/${shortRef(ref)}`;
    await git.writeRef({ fs: cached.fs, gitdir: GITDIR, ref: local, value: oid, force: true });
    const result = await git.push({ fs: cached.fs, http: this.http, gitdir: GITDIR, url: cached.remote, ref: local, remoteRef: fullRef(ref), force, onAuth: auth(tokenSecret(token.secret)) });
    if (!result.ok) throw new Error(`push to ${ref} rejected: ${result.error ?? JSON.stringify(result.refs)}`);
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
    const result: Commit = { id: oid, parents: commit.parent, tree: sorted, message: commit.message.trimEnd(), author: { name: commit.author.name, email: commit.author.email }, timestamp: commit.author.timestamp * 1000 };
    this.commits.set(oid, result);
    return result;
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
