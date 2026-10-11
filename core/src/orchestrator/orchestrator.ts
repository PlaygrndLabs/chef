import type { KargahEvent } from "../events/events.ts";
import { applyChanges, changedPaths, diffTrees, type Author, type Commit, type FileChanges, type Resolver, type Tree } from "../git/tree.ts";
import { NOTES_NAMESPACE, PROOF_NAMESPACE, parseNote, renderNote, type TurnNote } from "../notes/notes.ts";
import type { CheckResult, CheckRunner, ProofRunner } from "../ports/check-runner.ts";
import type { Classifier } from "../ports/classifier.ts";
import type { Coder } from "../ports/coder.ts";
import type { EventBus } from "../ports/event-bus.ts";
import type { Planner, WorkItem } from "../ports/planner.ts";
import type { PreviewHost } from "../ports/preview-host.ts";
import type { PushedEvent, RepoHost, RepoToken } from "../ports/repo-host.ts";
import type { Reviewer } from "../ports/reviewer.ts";
import type { Clock, IdSource, KeyValueStore } from "../ports/runtime.ts";
import { outOfScope, scopeFor, type Profiles } from "../profiles/profile.ts";
import type { RouteDecision } from "../router/decision.ts";
import { DEFAULT_ROUTER_CONFIG, Router, type RouterConfig } from "../router/router.ts";
import { addTokens, DEFAULT_BUDGET, initialMachine, isTerminal, transition, type Budget, type SessionEvent } from "../session/machine.ts";
import type { SessionRecord } from "../session/record.ts";
import { lintSpecFiles, readSpec } from "../spec/lint.ts";
import { renderFeature } from "../spec/parse.ts";
import { featureFlow, specPath, type FeatureSpec } from "../spec/schema.ts";
import { MainWriter, Mutex, PreviewPublisher } from "./capabilities.ts";

export interface Deps {
  readonly repos: RepoHost;
  readonly coder: Coder;
  readonly classifier: Classifier;
  readonly planner: Planner;
  readonly reviewer: Reviewer;
  readonly previews: PreviewHost;
  readonly checks: CheckRunner;
  readonly proofs: ProofRunner;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly store: KeyValueStore;
}

export type Generators = Readonly<Record<string, (tree: Tree) => string>>;

export interface ProjectConfig {
  readonly name: string;
  readonly author: Author;
  readonly profiles: Profiles;
  readonly generated: Generators;
  readonly budget?: Budget;
  readonly router?: RouterConfig;
  readonly tokenTtlSeconds?: number;
}

export interface SubmitResult {
  readonly decision: RouteDecision;
  readonly sessionId: string | null;
}

export interface GateOutcome {
  readonly ok: boolean;
  readonly checks: readonly CheckResult[];
  readonly requeue?: boolean;
}

export class Orchestrator {
  readonly canonical: string;
  private readonly router: Router;
  private readonly previews: PreviewPublisher;
  private readonly main: MainWriter;
  private readonly mergeQueue = new Mutex();
  private readonly budget: Budget;
  private readonly ttl: number;
  private readonly resolvers: Readonly<Record<string, Resolver>>;
  private readonly unsubscribe: () => void;
  private readonly running = new Set<string>();

  constructor(
    private readonly deps: Deps,
    private readonly config: ProjectConfig,
  ) {
    this.canonical = config.name;
    this.router = new Router({ classifier: deps.classifier, planner: deps.planner }, config.router ?? DEFAULT_ROUTER_CONFIG);
    this.ttl = config.tokenTtlSeconds ?? 900;
    this.previews = new PreviewPublisher(deps.repos, this.canonical, this.ttl);
    this.main = new MainWriter(deps.repos, this.canonical, this.ttl);
    this.budget = config.budget ?? DEFAULT_BUDGET;
    const resolvers: Record<string, Resolver> = {};
    for (const [path, generate] of Object.entries(config.generated)) resolvers[path] = ({ merged }) => generate(merged);
    this.resolvers = resolvers;
    this.unsubscribe = deps.repos.onPush((event) => this.onPush(event));
  }

  dispose(): void {
    this.unsubscribe();
  }

  async bootstrap(template: Tree): Promise<string> {
    await this.deps.repos.createRepo(this.canonical, { defaultBranch: "main" });
    const token = await this.deps.repos.createToken(this.canonical, "write", this.ttl);
    try {
      const tree = this.regenerate(template);
      const commit = await this.deps.repos.commit(token, { ref: "main", parent: null, changes: tree, message: "Create project from kargah template", author: this.config.author });
      return commit.id;
    } finally {
      await this.deps.repos.revokeToken(token);
    }
  }

  async mainTree(): Promise<{ commitId: string | null; tree: Tree }> {
    const commitId = await this.deps.repos.resolveRef(this.canonical, "main");
    const commit = commitId ? await this.deps.repos.readCommit(this.canonical, commitId) : null;
    return { commitId, tree: commit?.tree ?? {} };
  }

  async submit(prompt: string): Promise<SubmitResult> {
    const { tree } = await this.mainTree();
    const spec = readSpec(tree);
    const decision = await this.router.route(prompt, spec);
    await this.emit({ type: "route.decided", prompt, decision });
    if (decision.intent === "question") return { decision, sessionId: null };
    const plan = await this.deps.planner.plan({ prompt, intent: decision.intent, changeKind: decision.changeKind, featureId: decision.featureId, spec });
    const sessionId = this.deps.ids.next("s");
    const now = this.deps.clock.now();
    const record: SessionRecord = {
      id: sessionId,
      project: this.config.name,
      featureId: plan.feature.id,
      fork: `${this.config.name}--${plan.feature.id}--${sessionId}`,
      rootPrompt: prompt,
      decision,
      plan,
      cursor: 0,
      machine: initialMachine(now),
      head: null,
      baseMain: null,
      commits: [],
      preview: null,
      firstPreviewCommit: null,
      verdict: null,
      lastCodeItem: null,
      syncPending: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.save(record);
    await this.emit({ type: "session.created", sessionId, featureId: record.featureId, fork: record.fork, reason: decision.reason });
    return { decision, sessionId };
  }

  async session(id: string): Promise<SessionRecord> {
    const record = await this.deps.store.get<SessionRecord>(`session/${id}`);
    if (!record) throw new Error(`unknown session ${id}`);
    return record;
  }

  async sessions(): Promise<SessionRecord[]> {
    return [...(await this.deps.store.list<SessionRecord>("session/")).values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async drain(maxRounds = 200): Promise<SessionRecord[]> {
    for (let round = 0; round < maxRounds; round++) {
      const active = (await this.sessions()).filter((s) => !isTerminal(s.machine.state));
      if (active.length === 0) break;
      await Promise.all(active.map((s) => this.step(s.id)));
    }
    return this.sessions();
  }

  async run(id: string, maxSteps = 100): Promise<SessionRecord> {
    for (let i = 0; i < maxSteps; i++) {
      const record = await this.session(id);
      if (isTerminal(record.machine.state)) return record;
      await this.step(id);
    }
    return this.session(id);
  }

  async step(id: string): Promise<void> {
    if (this.running.has(id)) return;
    this.running.add(id);
    try {
      const record = await this.session(id);
      if (isTerminal(record.machine.state)) return;
      try {
        if (record.syncPending && record.head && record.machine.state !== "queued") {
          record.syncPending = false;
          const synced = await this.syncFromMain(record);
          if (synced === "conflict") return await this.save(record);
        }
        await this.advance(record);
      } catch (error) {
        await this.apply(record, { type: "fail", reason: `orchestrator error: ${(error as Error).message}` });
      }
      await this.save(record);
    } finally {
      this.running.delete(id);
    }
  }

  private async advance(record: SessionRecord): Promise<void> {
    switch (record.machine.state) {
      case "queued":
        return this.startSession(record);
      case "planning":
        return this.planning(record);
      case "testing":
        return this.testing(record);
      case "coding":
        return this.coding(record);
      case "reviewing":
        return this.reviewing(record);
      case "gating":
        return this.gating(record);
      default:
        return;
    }
  }

  private async startSession(record: SessionRecord): Promise<void> {
    await this.deps.repos.fork(this.canonical, record.fork);
    record.head = await this.deps.repos.resolveRef(record.fork, "main");
    record.baseMain = record.head;
    await this.apply(record, { type: "start" });
  }

  private async planning(record: SessionRecord): Promise<void> {
    const item = this.nextItem(record, ["spec_change"]);
    if (item) {
      const runId = this.deps.ids.next("run");
      await this.commitTurn(record, {
        changes: { [specPath(record.plan.feature.id)]: renderFeature(record.plan.feature) },
        role: "planner",
        kind: "spec_change",
        workItem: item.id,
        prompt: record.rootPrompt,
        model: record.plan.model,
        runId,
        message: `spec: ${record.plan.feature.id} revision ${record.plan.feature.revision}`,
      });
      record.cursor = record.plan.items.indexOf(item) + 1;
    }
    const withTests = record.plan.items.slice(record.cursor).some((i) => i.kind === "test");
    await this.apply(record, { type: "planned", withTests });
  }

  private async testing(record: SessionRecord): Promise<void> {
    const item = this.nextItem(record, ["test"]);
    if (!item) return this.apply(record, { type: "tests_committed" });
    const outcome = await this.coderTurn(record, item, record.machine.feedback);
    if (outcome === "rejected") return;
    record.cursor = record.plan.items.indexOf(item) + 1;
    await this.apply(record, { type: "tests_committed" });
  }

  private async coding(record: SessionRecord): Promise<void> {
    const conflict = record.machine.reason === "conflict";
    let item = this.nextItem(record, ["code", "fix", "refactor"]);
    if (!item && record.lastCodeItem) item = record.plan.items.find((i) => i.id === record.lastCodeItem) ?? null;
    if (!item) item = record.plan.items.find((i) => i.kind === "code" || i.kind === "fix" || i.kind === "refactor") ?? null;
    if (!item) return this.apply(record, { type: "fail", reason: "plan has no code work item" });
    const turnItem: WorkItem = conflict ? { ...item, id: `${item.id}-conflict`, kind: "conflict", role: this.config.profiles["conflict-resolver"] ? "conflict-resolver" : item.role } : item;
    const outcome = await this.coderTurn(record, turnItem, record.machine.feedback);
    if (outcome === "rejected") return;
    record.lastCodeItem = item.id;
    const index = record.plan.items.indexOf(item);
    if (index >= record.cursor) record.cursor = index + 1;
    if (this.nextItem(record, ["code", "fix", "refactor"])) return;
    await this.apply(record, { type: "coded" });
  }

  private async reviewing(record: SessionRecord): Promise<void> {
    const head = await this.commitOf(record.fork, record.head);
    const base = await this.commitOf(this.canonical, record.baseMain);
    const verdict = await this.deps.reviewer.review({ feature: record.plan.feature, diff: diffTrees(base.tree, head.tree), checksLog: record.machine.feedback ?? "" });
    record.verdict = { ...verdict, commitId: head.id };
    await this.emit({ type: "review.verdict", sessionId: record.id, featureId: record.featureId, approve: verdict.approve, reasons: verdict.reasons });
    if (verdict.approve) await this.apply(record, { type: "review_approved" });
    else await this.apply(record, { type: "review_rejected", reasons: verdict.reasons });
  }

  private async gating(record: SessionRecord): Promise<void> {
    const outcome = await this.gate(record);
    if (outcome.requeue) return;
    await this.emit({ type: "gate.result", sessionId: record.id, featureId: record.featureId, ok: outcome.ok, checks: outcome.checks });
    if (record.machine.state !== "gating") return;
    if (outcome.ok) {
      await this.apply(record, { type: "gate_passed" });
      await this.emit({ type: "main.merged", sessionId: record.id, featureId: record.featureId, commitId: record.head as string });
    } else {
      await this.apply(record, { type: "gate_failed", log: formatChecks(outcome.checks.filter((c) => !c.ok)) });
    }
  }

  async gate(record: SessionRecord): Promise<GateOutcome> {
    const synced = await this.syncFromMain(record);
    if (synced === "conflict") return { ok: false, checks: [], requeue: true };
    const head = await this.commitOf(record.fork, record.head);
    const checks: CheckResult[] = [...(await this.deps.checks.run({ repo: record.fork, commitId: head.id, tree: head.tree }))];
    checks.push(await this.scopeCheck(record));
    checks.push(this.verdictCheck(record));
    checks.push(await this.proofCheck(record, head));
    if (checks.some((c) => !c.ok)) return { ok: false, checks };
    return this.mergeQueue.run(async () => {
      const mainHead = await this.deps.repos.resolveRef(this.canonical, "main");
      if (mainHead !== record.baseMain) {
        record.syncPending = true;
        return { ok: false, checks, requeue: true };
      }
      await this.markMerged(record);
      const outcome = await this.main.mergeFork(record.fork, { message: `Merge ${record.featureId} (${record.id})`, author: this.config.author, resolvers: this.resolvers });
      if (outcome.status === "conflict") {
        record.syncPending = true;
        return { ok: false, checks, requeue: true };
      }
      record.baseMain = outcome.commitId;
      return { ok: true, checks };
    });
  }

  async revertMerge(mergedCommit: string, log: string): Promise<string | null> {
    return this.mergeQueue.run(async () => {
      const head = await this.deps.repos.resolveRef(this.canonical, "main");
      const commit = head ? await this.deps.repos.readCommit(this.canonical, mergedCommit) : null;
      if (!head || !commit) return null;
      const before = await this.mainParentBefore(mergedCommit);
      if (!before) return null;
      const note = parseNote(await this.deps.repos.readNote(this.canonical, NOTES_NAMESPACE, mergedCommit));
      const revertId = await this.main.revert({ to: before, expectedHead: head, message: `Revert ${note?.feature ?? mergedCommit}: main went red`, author: this.config.author });
      await this.emit({ type: "main.reverted", featureId: note?.feature ?? "unknown", revertedCommit: mergedCommit, commitId: revertId, log });
      const sessions = await this.sessions();
      const owner = sessions.find((s) => s.head === mergedCommit || s.commits.includes(mergedCommit));
      if (owner) {
        owner.baseMain = revertId;
        owner.syncPending = false;
        await this.apply(owner, { type: "reopened", log });
        await this.reforkAfterRevert(owner, revertId);
        await this.save(owner);
      }
      return revertId;
    });
  }

  private async reforkAfterRevert(record: SessionRecord, revertId: string): Promise<void> {
    const token = await this.deps.repos.createToken(record.fork, "write", this.ttl);
    try {
      const outcome = await this.deps.repos.merge(token, { into: "main", from: { repo: this.canonical, ref: "main" }, message: "Sync main after revert", author: this.config.author, resolvers: this.resolvers });
      if (outcome.status === "conflict") return;
      const revertCommit = await this.commitOf(this.canonical, revertId);
      const merged = await this.commitOf(record.fork, outcome.commitId);
      const restore = diffTrees(merged.tree, (await this.commitOf(record.fork, record.head)).tree);
      record.head = outcome.commitId;
      if (Object.keys(restore).length > 0 || revertCommit.id === outcome.commitId) {
        const commit = await this.deps.repos.commit(token, { ref: "main", parent: record.head, changes: restore, message: `Restore ${record.featureId} work after revert`, author: this.config.author });
        record.head = commit.id;
      }
    } finally {
      await this.deps.repos.revokeToken(token);
    }
  }

  private async mainParentBefore(mergedCommit: string): Promise<string | null> {
    const commit = await this.deps.repos.readCommit(this.canonical, mergedCommit);
    if (!commit) return null;
    const history = await this.deps.repos.log(this.canonical, "main", 1000);
    const index = history.findIndex((c) => c.id === mergedCommit);
    if (index < 0) return null;
    const previous = history[index + 1];
    if (previous) return previous.id;
    return commit.parents[0] ?? null;
  }

  private async markMerged(record: SessionRecord): Promise<void> {
    const head = await this.commitOf(record.fork, record.head);
    const path = specPath(record.featureId);
    const current = readSpec(head.tree).find((f) => f.id === record.featureId);
    if (!current || current.status === "merged") return;
    const updated: FeatureSpec = { ...current, status: "merged" };
    await this.commitTurn(record, {
      changes: { [path]: renderFeature(updated) },
      role: "gardener",
      kind: "spec_change",
      workItem: null,
      prompt: `Mark ${record.featureId} merged`,
      model: "kargah-gate",
      runId: this.deps.ids.next("run"),
      message: `spec: mark ${record.featureId} merged`,
    });
  }

  private async scopeCheck(record: SessionRecord): Promise<CheckResult> {
    const problems: string[] = [];
    const generated = new Set(Object.keys(this.config.generated));
    for (const commitId of record.commits) {
      const commit = await this.commitOf(record.fork, commitId);
      if (commit.parents.length !== 1) continue;
      const note = parseNote(await this.deps.repos.readNote(record.fork, NOTES_NAMESPACE, commitId));
      if (!note) {
        problems.push(`${commitId.slice(0, 12)} has no ${NOTES_NAMESPACE} note`);
        continue;
      }
      if (note.kind === "sync" || note.kind === "merge") continue;
      const parent = await this.commitOf(record.fork, commit.parents[0] as string);
      const paths = changedPaths(diffTrees(parent.tree, commit.tree)).filter((p) => !generated.has(p));
      const profile = this.config.profiles[note.role];
      if (!profile) {
        problems.push(`${commitId.slice(0, 12)} was written by unknown role ${note.role}`);
        continue;
      }
      const feature = readSpec(commit.tree).find((f) => f.id === record.featureId) ?? record.plan.feature;
      const outside = outOfScope(paths, scopeFor(profile, feature));
      if (outside.length > 0) problems.push(`${commitId.slice(0, 12)} (${note.role}) wrote outside its scope: ${outside.join(", ")}`);
    }
    return { name: "write-scope", ok: problems.length === 0, log: problems.join("\n") || `${record.commits.length} commits inside their roles' scopes` };
  }

  private verdictCheck(record: SessionRecord): CheckResult {
    const verdict = record.verdict;
    if (!verdict) return { name: "review", ok: false, log: "no reviewer verdict" };
    if (!verdict.approve) return { name: "review", ok: false, log: verdict.reasons.join("\n") };
    const index = record.commits.indexOf(verdict.commitId);
    if (index < 0) return { name: "review", ok: false, log: "verdict is for a commit outside this session" };
    return { name: "review", ok: true, log: `approved by ${verdict.model}` };
  }

  private async proofCheck(record: SessionRecord, head: Commit): Promise<CheckResult> {
    if (!record.preview || record.preview.commitId !== head.id) await this.publishPreview(record);
    const preview = record.preview;
    if (!preview) return { name: "proof", ok: false, log: "no preview deployment" };
    const flow = featureFlow(readSpec(head.tree).find((f) => f.id === record.featureId) ?? record.plan.feature);
    const proof = await this.deps.proofs.prove({ feature: record.featureId, flow, url: preview.url, commitId: head.id, tree: head.tree });
    await this.withToken(record.fork, (token) => this.deps.repos.addNote(token, { namespace: PROOF_NAMESPACE, commitId: head.id, note: `${JSON.stringify(proof, null, 2)}\n` }));
    const stored = await this.deps.repos.readNote(record.fork, PROOF_NAMESPACE, head.id);
    const ok = proof.ok && stored !== null;
    return { name: "proof", ok, log: proof.steps.map((s) => `${s.ok ? "ok" : "FAIL"} ${s.name}: ${s.detail}`).join("\n") || "no proof steps" };
  }

  private async syncFromMain(record: SessionRecord): Promise<"synced" | "up-to-date" | "conflict"> {
    const mainHead = await this.deps.repos.resolveRef(this.canonical, "main");
    if (!mainHead || mainHead === record.baseMain) return "up-to-date";
    const outcome = await this.withToken(record.fork, (token) =>
      this.deps.repos.merge(token, { into: "main", from: { repo: this.canonical, ref: "main" }, message: `Merge main into ${record.fork}`, author: this.config.author, resolvers: this.resolvers }),
    );
    if (outcome.status === "conflict") {
      await this.emit({ type: "sync.conflict", sessionId: record.id, featureId: record.featureId, paths: outcome.paths, mainCommit: mainHead });
      if (record.machine.state === "coding" || record.machine.state === "testing" || record.machine.state === "planning" || record.machine.state === "reviewing" || record.machine.state === "gating") {
        record.baseMain = mainHead;
        await this.forceMainIntoFork(record, mainHead, outcome.paths);
        await this.apply(record, { type: "conflict", paths: outcome.paths });
      }
      return "conflict";
    }
    record.baseMain = mainHead;
    if (outcome.status === "up-to-date") return "up-to-date";
    record.head = outcome.commitId;
    if (outcome.status === "merged") {
      record.commits.push(outcome.commitId);
      await this.withToken(record.fork, (token) => this.deps.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: outcome.commitId, note: renderNote(this.note(record, { role: "sync", kind: "sync", workItem: null, prompt: `Merge main ${mainHead}`, runId: this.deps.ids.next("run"), model: "kargah-sync", paths: [] })) }));
    }
    await this.emit({ type: "sync.merged", sessionId: record.id, featureId: record.featureId, commitId: outcome.commitId, mainCommit: mainHead });
    await this.publishPreview(record);
    return "synced";
  }

  private async forceMainIntoFork(record: SessionRecord, mainHead: string, conflicts: readonly string[]): Promise<void> {
    const main = await this.commitOf(this.canonical, mainHead);
    const ours = await this.commitOf(record.fork, record.head);
    const merged: Record<string, string | null> = {};
    for (const path of conflicts) merged[path] = mergeMarkers(ours.tree[path], main.tree[path]);
    const forkHead = await this.deps.repos.resolveRef(record.fork, "main");
    const token = await this.deps.repos.createToken(record.fork, "write", this.ttl);
    try {
      const tree = applyChanges(main.tree, Object.fromEntries(Object.entries(diffTrees(main.tree, ours.tree)).filter(([path]) => !conflicts.includes(path))));
      const changes = { ...diffTrees(ours.tree, tree), ...merged };
      const commit = await this.deps.repos.commit(token, { ref: "main", parent: forkHead, changes, message: `Merge main into ${record.fork} with conflicts in ${conflicts.join(", ")}`, author: this.config.author });
      await this.deps.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: commit.id, note: renderNote(this.note(record, { role: "sync", kind: "sync", workItem: null, prompt: `Merge main ${mainHead}`, runId: this.deps.ids.next("run"), model: "kargah-sync", paths: changedPaths(changes) })) });
      record.head = commit.id;
      record.commits.push(commit.id);
    } finally {
      await this.deps.repos.revokeToken(token);
    }
  }

  private async coderTurn(record: SessionRecord, item: WorkItem, feedback: string | null): Promise<"committed" | "empty" | "rejected"> {
    const profile = this.config.profiles[item.role];
    if (!profile) throw new Error(`no agent profile for role ${item.role}`);
    const head = await this.commitOf(record.fork, record.head);
    const feature = readSpec(head.tree).find((f) => f.id === record.featureId) ?? record.plan.feature;
    const scope = scopeFor(profile, feature);
    const readToken = await this.deps.repos.createToken(record.fork, "read", this.ttl);
    const info = await this.deps.repos.info(record.fork);
    const prompt = feedback ? `${item.prompt}\n\n${feedback}` : item.prompt;
    let result;
    try {
      result = await this.deps.coder.runTurn({
        sessionId: record.id,
        featureId: record.featureId,
        role: item.role,
        model: profile.model,
        prompt,
        instructions: profile.instructions.replaceAll("{feature}", record.featureId),
        writeScope: scope,
        workspace: { repo: record.fork, remote: info?.remote ?? "", ref: "main", commitId: head.id, readToken: readToken.secret, tree: head.tree },
        onEvent: (event) => void this.emit({ type: "coder.event", sessionId: record.id, featureId: record.featureId, event }),
      });
    } finally {
      await this.deps.repos.revokeToken(readToken);
    }
    record.machine = addTokens(record.machine, result.usage.inputTokens + result.usage.outputTokens);
    const generated = new Set(Object.keys(this.config.generated));
    const paths = changedPaths(result.changes).filter((p) => !generated.has(p));
    const outside = outOfScope(paths, scope);
    if (outside.length > 0) {
      await this.apply(record, { type: "turn_rejected", paths: outside, scope });
      return "rejected";
    }
    const tree = applyChanges(head.tree, result.changes);
    const changes = diffTrees(head.tree, this.regenerate(tree));
    if (Object.keys(changes).length === 0) return "empty";
    await this.commitTurn(record, { changes, role: item.role, kind: item.kind, workItem: item.id, prompt, model: result.model, runId: result.runId, message: `${item.kind}(${record.featureId}): ${firstLine(result.summary || item.prompt)}` });
    return "committed";
  }

  private async commitTurn(record: SessionRecord, turn: { changes: FileChanges; role: string; kind: TurnNote["kind"]; workItem: string | null; prompt: string; model: string; runId: string; message: string }): Promise<void> {
    await this.withToken(record.fork, async (token) => {
      const commit = await this.deps.repos.commit(token, { ref: "main", parent: record.head, changes: turn.changes, message: turn.message, author: this.config.author });
      const note = this.note(record, { ...turn, paths: changedPaths(turn.changes) });
      await this.deps.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: commit.id, note: renderNote(note) });
      record.head = commit.id;
      record.commits.push(commit.id);
      await this.emit({ type: "commit.created", sessionId: record.id, featureId: record.featureId, repo: record.fork, commitId: commit.id, role: turn.role, message: turn.message });
    });
    await this.publishPreview(record);
  }

  private note(record: SessionRecord, turn: { role: string; kind: TurnNote["kind"]; workItem: string | null; prompt: string; model: string; runId: string; paths: readonly string[] }): TurnNote {
    return {
      kargah: 1,
      project: record.project,
      feature: record.featureId,
      session: record.id,
      role: turn.role,
      kind: turn.kind,
      workItem: turn.workItem,
      prompt: turn.prompt,
      rootPrompt: record.rootPrompt,
      runId: turn.runId,
      model: turn.model,
      specRevision: record.plan.feature.revision,
      paths: [...turn.paths],
    };
  }

  private async publishPreview(record: SessionRecord): Promise<void> {
    if (!record.head) return;
    const branch = await this.previews.publish(record.featureId, record.head, record.fork);
    const deployment = await this.deps.previews.deploy({ repo: this.canonical, branch, commitId: record.head });
    record.preview = { url: deployment.url, commitId: record.head };
    record.firstPreviewCommit ??= record.head;
    await this.emit({ type: "preview.updated", sessionId: record.id, featureId: record.featureId, url: deployment.url, commitId: record.head });
  }

  private onPush(event: PushedEvent): void {
    if (event.repo !== this.canonical || event.ref !== "main") return;
    void this.markSyncPending(event.after);
  }

  private async markSyncPending(mainHead: string): Promise<void> {
    for (const record of await this.sessions()) {
      if (isTerminal(record.machine.state) || record.machine.state === "queued" || record.baseMain === mainHead || this.running.has(record.id)) continue;
      const fresh = await this.session(record.id);
      fresh.syncPending = true;
      await this.save(fresh);
    }
  }

  private nextItem(record: SessionRecord, kinds: readonly WorkItem["kind"][]): WorkItem | null {
    return record.plan.items.slice(record.cursor).find((i) => kinds.includes(i.kind)) ?? null;
  }

  private regenerate(tree: Tree): Tree {
    let next = tree;
    for (const [path, generate] of Object.entries(this.config.generated)) next = applyChanges(next, { [path]: generate(next) });
    return next;
  }

  private async commitOf(repo: string, id: string | null): Promise<Commit> {
    if (!id) throw new Error(`${repo} has no commit`);
    const commit = await this.deps.repos.readCommit(repo, id);
    if (!commit) throw new Error(`${repo} is missing commit ${id}`);
    return commit;
  }

  private async withToken<T>(repo: string, task: (token: RepoToken) => Promise<T>): Promise<T> {
    const token = await this.deps.repos.createToken(repo, "write", this.ttl);
    try {
      return await task(token);
    } finally {
      await this.deps.repos.revokeToken(token);
    }
  }

  private async apply(record: SessionRecord, event: SessionEvent): Promise<void> {
    const from = record.machine.state;
    record.machine = transition(record.machine, event, this.budget, this.deps.clock.now());
    record.updatedAt = this.deps.clock.now();
    await this.emit({ type: "session.state", sessionId: record.id, featureId: record.featureId, from, to: record.machine.state, reason: record.machine.reason });
    if (record.machine.state === "stuck") await this.emit({ type: "session.stuck", sessionId: record.id, featureId: record.featureId, reason: record.machine.reason });
  }

  private async save(record: SessionRecord): Promise<void> {
    const stored = await this.deps.store.get<SessionRecord>(`session/${record.id}`);
    if (stored?.syncPending && !this.running.has(record.id)) record.syncPending = true;
    await this.deps.store.put(`session/${record.id}`, record);
  }

  private async emit(event: DistributiveOmit<KargahEvent, "project" | "at">): Promise<void> {
    await this.deps.bus.publish({ ...event, project: this.config.name, at: this.deps.clock.now() } as KargahEvent);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function formatChecks(checks: readonly CheckResult[]): string {
  return checks.map((c) => `## ${c.name}: ${c.ok ? "ok" : "FAILED"}\n${c.log}`).join("\n\n");
}

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").slice(0, 72);
}

function mergeMarkers(ours: string | undefined, theirs: string | undefined): string {
  return `<<<<<<< session\n${ours ?? ""}\n=======\n${theirs ?? ""}\n>>>>>>> main\n`;
}

export function specProblems(tree: Tree): string[] {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(tree)) if (path.startsWith("spec/features/")) files[path] = content;
  return lintSpecFiles(files).problems.map((p) => `${p.path}: ${p.message}`);
}
