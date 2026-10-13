import type { ChefEvent } from "../events/events.ts";
import { applyChanges, changedPaths, diffTrees, threeWayMerge, type Author, type Resolver, type Tree } from "../git/tree.ts";
import { NOTES_NAMESPACE, renderNote } from "../notes/notes.ts";
import type { CheckRunner } from "../ports/check-runner.ts";
import type { Coder } from "../ports/coder.ts";
import type { ExternalRemote } from "../ports/external-git.ts";
import type { RepoHost, RepoToken } from "../ports/repo-host.ts";
import type { Clock, IdSource, KeyValueStore } from "../ports/runtime.ts";
import { customAgent, outOfScope, type Profiles } from "../profiles/profile.ts";
import type { SessionRecord } from "../session/record.ts";
import { readSpec } from "../spec/lint.ts";

export const OUTBOUND_MODES = ["off", "branch", "pull-request", "feature-pull-requests"] as const;

export type OutboundMode = (typeof OUTBOUND_MODES)[number];

export interface ExternalSyncOptions {
  readonly mode: OutboundMode;
  readonly syncBranch: string;
  readonly previewLink?: (key: string) => string;
  readonly maxConflictTurns?: number;
}

export interface ExternalContext {
  readonly canonical: string;
  readonly author: Author;
  readonly resolvers: Readonly<Record<string, Resolver>>;
  readonly repos: RepoHost;
  readonly coder: Coder;
  readonly checks: CheckRunner;
  readonly store: KeyValueStore;
  readonly ids: IdSource;
  readonly clock: Clock;
  readonly profiles: Profiles;
  readonly ttl: number;
  lock<T>(task: () => Promise<T>): Promise<T>;
  emit(event: DistributiveOmit<ChefEvent, "project" | "at">): Promise<void>;
  mainChanged(): Promise<void>;
  regenerate(tree: Tree): Tree;
  sessions(): Promise<SessionRecord[]>;
}

export interface SyncState {
  readonly pulled: string | null;
  readonly pushed: string | null;
  readonly failed: string | null;
  readonly pullRequest: { readonly number: number; readonly url: string } | null;
  readonly published: Readonly<Record<string, string>>;
}

export type PullOutcome =
  | { readonly status: "empty" }
  | { readonly status: "up-to-date" }
  | { readonly status: "imported"; readonly commitId: string }
  | { readonly status: "merged"; readonly commitId: string; readonly mainCommit: string }
  | { readonly status: "resolved"; readonly commitId: string; readonly mainCommit: string }
  | { readonly status: "stuck"; readonly commitId: string; readonly reason: string }
  | { readonly status: "waiting"; readonly commitId: string };

export type PushOutcome = { readonly status: "off" } | { readonly status: "empty" } | { readonly status: "up-to-date" } | { readonly status: "pushed"; readonly commitId: string; readonly pullRequests: readonly string[] };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const STATE = "external/state";
const EMPTY: SyncState = { pulled: null, pushed: null, failed: null, pullRequest: null, published: {} };

export class ExternalSync {
  readonly externalRef: string;

  constructor(
    private readonly ctx: ExternalContext,
    private readonly remote: ExternalRemote,
    private readonly options: ExternalSyncOptions,
  ) {
    if (options.syncBranch === remote.branch) throw new Error(`chef never pushes to ${remote.branch}; pick another sync branch`);
    this.externalRef = `external/${remote.branch}`;
  }

  async state(): Promise<SyncState> {
    return { ...EMPTY, ...(await this.ctx.store.get<SyncState>(STATE)) };
  }

  async retry(): Promise<void> {
    await this.save({ failed: null });
  }

  async pull(): Promise<PullOutcome> {
    const head = await this.remote.head();
    if (!head) return { status: "empty" };
    const state = await this.state();
    if (head === state.pulled) return { status: "up-to-date" };
    if (head === state.failed) return { status: "waiting", commitId: head };
    await this.ensureRepo();
    const merged = await this.ctx.lock(async () => {
      const mainBefore = await this.ctx.repos.resolveRef(this.ctx.canonical, "main");
      return this.withToken(this.ctx.canonical, async (token) => {
        if (!mainBefore) {
          await this.remote.pull({ token, ref: "main" });
          await this.remote.pull({ token, ref: this.externalRef });
          return { status: "imported" as const, commitId: head };
        }
        await this.remote.pull({ token, ref: this.externalRef });
        const outcome = await this.ctx.repos.merge(token, { into: "main", from: { repo: this.ctx.canonical, ref: this.externalRef }, message: `Merge ${this.remote.branch} of ${this.remote.url}`, author: this.ctx.author, resolvers: this.ctx.resolvers });
        if (outcome.status === "conflict") return { status: "conflict" as const, paths: outcome.paths };
        return { status: "merged" as const, commitId: head, mainCommit: outcome.commitId };
      });
    });
    if (merged.status === "conflict") return this.resolve(head, merged.paths);
    await this.save({ pulled: head, failed: null });
    await this.ctx.mainChanged();
    const mainCommit = merged.status === "imported" ? head : merged.mainCommit;
    await this.ctx.emit({ type: "external.pulled", url: this.remote.url, branch: this.remote.branch, commitId: head, mainCommit, status: merged.status });
    return merged;
  }

  async push(): Promise<PushOutcome> {
    if (this.options.mode === "off") return { status: "off" };
    const mainHead = await this.ctx.repos.resolveRef(this.ctx.canonical, "main");
    if (!mainHead) return { status: "empty" };
    const state = await this.state();
    if (mainHead === state.pushed) return { status: "up-to-date" };
    await this.remote.push({ repo: this.ctx.canonical, ref: "main", commitId: mainHead, branch: this.options.syncBranch, force: true });
    await this.ctx.emit({ type: "external.pushed", url: this.remote.url, branch: this.options.syncBranch, commitId: mainHead });
    const pullRequests: string[] = [];
    if (this.options.mode === "pull-request") {
      const opened = await this.rollingPullRequest(mainHead);
      if (opened) pullRequests.push(opened);
    }
    if (this.options.mode === "feature-pull-requests") pullRequests.push(...(await this.featurePullRequests()));
    await this.save({ pushed: mainHead });
    return { status: "pushed", commitId: mainHead, pullRequests };
  }

  async pending(mainHead: string): Promise<{ id: string; title: string }[]> {
    const main = await this.ctx.repos.readCommit(this.ctx.canonical, mainHead);
    const externalHead = await this.ctx.repos.resolveRef(this.ctx.canonical, this.externalRef);
    const external = externalHead ? await this.ctx.repos.readCommit(this.ctx.canonical, externalHead) : null;
    const done = new Set(readSpec(external?.tree ?? {}).filter((f) => f.status === "merged").map((f) => f.id));
    return readSpec(main?.tree ?? {})
      .filter((f) => f.status === "merged" && !done.has(f.id))
      .map((f) => ({ id: f.id, title: f.title }));
  }

  private async rollingPullRequest(mainHead: string): Promise<string | null> {
    if (!this.remote.pullRequest) return null;
    const features = await this.pending(mainHead);
    if (features.length === 0) return null;
    const lines = features.map((f) => `- ${f.title} (\`${f.id}\`)${this.options.previewLink ? `: [preview](${this.options.previewLink(f.id)})` : ""}`);
    const body = [`chef built these features on Cloudflare and keeps this branch in sync with its main line.`, "", ...lines, "", `Merging this pull request brings them into \`${this.remote.branch}\`; chef picks the merge up on its next sync.`].join("\n");
    const pr = await this.remote.pullRequest({ head: this.options.syncBranch, title: features.length === 1 ? `chef: ${features[0]?.title}` : `chef: ${features.length} features`, body });
    await this.save({ pullRequest: pr });
    await this.ctx.emit({ type: "external.pull-request", url: pr.url, number: pr.number, branch: this.options.syncBranch, features: features.map((f) => f.id) });
    return pr.url;
  }

  private async featurePullRequests(): Promise<string[]> {
    if (!this.remote.pullRequest) return [];
    const state = await this.state();
    const externalHead = await this.ctx.repos.resolveRef(this.ctx.canonical, this.externalRef);
    if (!externalHead) return [];
    const external = await this.ctx.repos.readCommit(this.ctx.canonical, externalHead);
    if (!external) return [];
    const opened: string[] = [];
    const published = { ...state.published };
    for (const session of await this.ctx.sessions()) {
      if (session.machine.state !== "merged" || !session.merge || published[session.id] === session.merge.commitId) continue;
      const before = await this.ctx.repos.readCommit(this.ctx.canonical, session.merge.mainBefore);
      const after = await this.ctx.repos.readCommit(this.ctx.canonical, session.merge.commitId);
      if (!before || !after) continue;
      const merged = threeWayMerge(before.tree, external.tree, after.tree, this.ctx.resolvers);
      if (merged.conflicts.length > 0) {
        await this.ctx.emit({ type: "external.stuck", url: this.remote.url, commitId: session.merge.commitId, reason: `${session.featureId} does not apply cleanly on ${this.remote.branch}: ${merged.conflicts.join(", ")}` });
        published[session.id] = session.merge.commitId;
        continue;
      }
      const changes = diffTrees(external.tree, merged.tree);
      if (Object.keys(changes).length === 0) {
        published[session.id] = session.merge.commitId;
        continue;
      }
      const ref = `sync/${session.featureId}`;
      const branch = `${this.options.syncBranch}-${session.featureId}`;
      const commit = await this.withToken(this.ctx.canonical, async (token) => {
        await this.ctx.repos.pushRef(token, { ref, commitId: externalHead, force: true });
        return this.ctx.repos.commit(token, { ref, parent: externalHead, changes, message: `${session.plan.feature.title}\n\nBuilt by chef in session ${session.id}.`, author: this.ctx.author });
      });
      await this.remote.push({ repo: this.ctx.canonical, ref, commitId: commit.id, branch, force: true });
      const link = this.options.previewLink?.(session.featureId);
      const body = [`chef built **${session.plan.feature.title}** and it passed chef's gate.`, "", ...session.plan.feature.acceptance.map((c) => `- ${c.text}`), ...(link ? ["", `Preview: ${link}`] : [])].join("\n");
      const pr = await this.remote.pullRequest({ head: branch, title: `chef: ${session.plan.feature.title}`, body });
      await this.ctx.emit({ type: "external.pull-request", url: pr.url, number: pr.number, branch, features: [session.featureId] });
      published[session.id] = session.merge.commitId;
      opened.push(pr.url);
    }
    await this.save({ published });
    return opened;
  }

  private async resolve(head: string, paths: readonly string[]): Promise<PullOutcome> {
    const syncId = this.ctx.ids.next("x");
    const fork = `${this.ctx.canonical}--sync--${syncId}`;
    await this.ctx.repos.fork(this.ctx.canonical, fork);
    try {
      const conflicted = await this.withToken(fork, (token) => this.ctx.repos.merge(token, { into: "main", from: { repo: this.ctx.canonical, ref: this.externalRef }, message: `Merge ${this.remote.branch} of ${this.remote.url}`, author: this.ctx.author, resolvers: this.ctx.resolvers, onConflict: "commit-markers" }));
      if (conflicted.status === "conflict") return await this.stuck(head, `merging ${this.remote.branch} failed on ${conflicted.paths.join(", ")}`);
      const conflictPaths = conflicted.status === "conflicted" ? conflicted.paths : [];
      await this.ctx.emit({ type: "external.conflict", url: this.remote.url, syncId, commitId: head, paths: conflictPaths.length ? conflictPaths : paths });
      let forkHead = conflicted.commitId;
      let feedback: string | null = null;
      const turns = this.options.maxConflictTurns ?? 3;
      for (let turn = 0; ; turn++) {
        const current = await this.ctx.repos.readCommit(fork, forkHead);
        if (!current) return await this.stuck(head, `the sync fork lost commit ${forkHead}`);
        const unresolved = conflictPaths.filter((p) => current.tree[p]?.includes("<<<<<<<"));
        if (unresolved.length === 0 && feedback === null) {
          const results = await this.ctx.checks.run({ repo: fork, commitId: current.id, tree: current.tree });
          const failed = results.filter((r) => !r.ok);
          if (failed.length === 0) break;
          feedback = failed.map((r) => `## ${r.name}\n${r.log}`).join("\n\n");
        }
        if (turn >= turns) return await this.stuck(head, unresolved.length ? `conflicts left in ${unresolved.join(", ")}` : `checks still fail after resolving the conflicts:\n${feedback ?? ""}`);
        const scope = conflictPaths.length ? conflictPaths : [...paths];
        const changes = await this.resolveTurn(syncId, fork, current.id, current.tree, scope, unresolved, feedback);
        feedback = null;
        if (Object.keys(changes).length === 0) continue;
        forkHead = await this.withToken(fork, async (token) => {
          const commit = await this.ctx.repos.commit(token, { ref: "main", parent: current.id, changes, message: `Resolve conflicts with ${this.remote.branch}`, author: this.ctx.author });
          await this.ctx.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: commit.id, note: renderNote({ chef: 1, project: this.ctx.canonical, feature: "sync", session: syncId, role: "conflict-resolver", kind: "conflict", workItem: null, prompt: `Resolve conflicts with ${this.remote.url} ${head}`, rootPrompt: `Sync ${this.remote.url}`, runId: this.ctx.ids.next("run"), model: "chef-sync", specRevision: 0, paths: changedPaths(changes) }) });
          return commit.id;
        });
      }
      const outcome = await this.ctx.lock(async () => {
        const synced = await this.withToken(fork, (token) => this.ctx.repos.merge(token, { into: "main", from: { repo: this.ctx.canonical, ref: "main" }, message: "Merge main", author: this.ctx.author, resolvers: this.ctx.resolvers }));
        if (synced.status === "conflict") return null;
        return this.withToken(this.ctx.canonical, (token) => this.ctx.repos.merge(token, { into: "main", from: { repo: fork, ref: "main" }, message: `Merge ${this.remote.branch} of ${this.remote.url} with resolved conflicts`, author: this.ctx.author, resolvers: this.ctx.resolvers }));
      });
      if (!outcome || outcome.status === "conflict" || outcome.status === "conflicted") return await this.stuck(head, "main moved while the conflicts were being resolved and they conflict again; chef tries again on the next change");
      await this.save({ pulled: head, failed: null });
      await this.ctx.mainChanged();
      await this.ctx.emit({ type: "external.resolved", url: this.remote.url, syncId, mainCommit: outcome.commitId });
      return { status: "resolved", commitId: head, mainCommit: outcome.commitId };
    } finally {
      await this.ctx.coder.release?.(syncId).catch(() => undefined);
      await this.ctx.repos.deleteRepo(fork).catch(() => false);
    }
  }

  private async resolveTurn(syncId: string, fork: string, commitId: string, tree: Tree, scope: readonly string[], unresolved: readonly string[], feedback: string | null): Promise<Record<string, string | null>> {
    const profile = this.ctx.profiles["conflict-resolver"] ?? this.ctx.profiles["backend"];
    if (!profile) throw new Error("no conflict-resolver profile");
    const info = await this.ctx.repos.info(fork);
    const readToken = await this.ctx.repos.createToken(fork, "read", this.ctx.ttl);
    const prompt = [
      `The main branch of the linked repository ${this.remote.url} was merged into chef's main line and these files conflict:`,
      ...scope.map((p) => `- ${p}${unresolved.includes(p) ? " (still has conflict markers)" : ""}`),
      "Resolve every conflict so both sides' behavior survives, and remove all conflict markers.",
      feedback ? `The checks failed after the last resolution:\n${feedback}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const result = await this.ctx.coder.runTurn({
        sessionId: syncId,
        featureId: "sync",
        role: profile.role,
        model: profile.model,
        prompt,
        instructions: profile.instructions.replaceAll("{feature}", "sync"),
        writeScope: scope,
        agent: customAgent(profile, "sync", scope),
        attempt: { index: 1, of: 1 },
        workspace: { repo: fork, remote: info?.remote ?? "", ref: "main", commitId, readToken: readToken.secret, tree },
        onEvent: () => undefined,
      });
      const allowed = Object.fromEntries(Object.entries(result.changes).filter(([path]) => outOfScope([path], scope).length === 0));
      return diffTrees(tree, this.ctx.regenerate(applyChanges(tree, allowed)));
    } finally {
      await this.ctx.repos.revokeToken(readToken);
    }
  }

  private async ensureRepo(): Promise<void> {
    if (await this.ctx.repos.info(this.ctx.canonical)) return;
    const source = this.remote.importSource;
    if (source && this.ctx.repos.importRepo) {
      try {
        await this.ctx.repos.importRepo(this.ctx.canonical, source);
        return;
      } catch {
        if (await this.ctx.repos.info(this.ctx.canonical)) return;
      }
    }
    await this.ctx.repos.createRepo(this.ctx.canonical, { defaultBranch: "main" });
  }

  private async stuck(head: string, reason: string): Promise<PullOutcome> {
    await this.save({ failed: head });
    await this.ctx.emit({ type: "external.stuck", url: this.remote.url, commitId: head, reason });
    return { status: "stuck", commitId: head, reason };
  }

  private async save(update: Partial<SyncState>): Promise<void> {
    await this.ctx.store.put<SyncState>(STATE, { ...(await this.state()), ...update });
  }

  private async withToken<T>(repo: string, task: (token: RepoToken) => Promise<T>): Promise<T> {
    const token = await this.ctx.repos.createToken(repo, "write", this.ctx.ttl);
    try {
      return await task(token);
    } finally {
      await this.ctx.repos.revokeToken(token);
    }
  }
}
