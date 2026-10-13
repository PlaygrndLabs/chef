import type { ChefEvent } from "../events/events.ts";
import { applyChanges, changedPaths, diffTrees, type Author, type Commit, type FileChanges, type Resolver, type Tree } from "../git/tree.ts";
import { NOTES_NAMESPACE, PROOF_NAMESPACE, parseNote, renderNote, type TurnNote } from "../notes/notes.ts";
import type { CheckResult, CheckRunner, ProofRecord, ProofRunner } from "../ports/check-runner.ts";
import type { Classifier } from "../ports/classifier.ts";
import type { Coder } from "../ports/coder.ts";
import type { EventBus } from "../ports/event-bus.ts";
import { chorePlan, choreId, withTestItem, type Plan, type Planner, type WorkItem } from "../ports/planner.ts";
import type { PreviewHost } from "../ports/preview-host.ts";
import type { PushedEvent, RepoHost, RepoToken } from "../ports/repo-host.ts";
import type { MemoryHit, MemoryIndex } from "../ports/memory-index.ts";
import type { PickCandidate, Reviewer } from "../ports/reviewer.ts";
import type { Clock, IdSource, KeyValueStore } from "../ports/runtime.ts";
import { customAgent, outOfScope, scopeFor, type Profiles } from "../profiles/profile.ts";
import type { RouteDecision } from "../router/decision.ts";
import { DEFAULT_ROUTER_CONFIG, Router, withoutCommand, type RouterConfig } from "../router/router.ts";
import { addTokens, DEFAULT_BUDGET, initialMachine, isTerminal, transition, type Budget, type RejectionRule, type SessionEvent } from "../session/machine.ts";
import type { SessionRecord } from "../session/record.ts";
import { lintSpecFiles, readSpec } from "../spec/lint.ts";
import { renderFeature } from "../spec/parse.ts";
import { featureFlow, specPath, type FeatureSpec } from "../spec/schema.ts";
import { missingEnv, renderEnvironment, type EnvVar } from "../env/env.ts";
import { Archiver, MainWriter, Mutex, PreviewPublisher } from "./capabilities.ts";
import { featureMemoryPath, lessonPath, memoryDocs, renderFeatureMemory, renderLesson, renderRecall, MEMORY_DIR } from "../memory/memory.ts";
import { featureMapProblems, gardenFeatureMap, mineRules, type Correction } from "../gardener/gardener.ts";
import { projectRuleProblems, renderRule, rulePath } from "../checks/project-rules.ts";
import { hashHex } from "../util/hash.ts";
import type { ExternalRemote } from "../ports/external-git.ts";
import { ExternalSync, type ExternalSyncOptions } from "../sync/external.ts";

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
  readonly memory: MemoryIndex;
}

export type Generators = Readonly<Record<string, (tree: Tree) => string>>;

export interface Specialization {
  readonly lockTests: boolean;
  readonly attempts: number;
  readonly stub: ((feature: FeatureSpec) => FileChanges) | null;
}

export const DEFAULT_SPECIALIZATION: Specialization = { lockTests: true, attempts: 1, stub: null };

export interface ProjectConfig {
  readonly name: string;
  readonly author: Author;
  readonly profiles: Profiles;
  readonly generated: Generators;
  readonly specialization?: Partial<Specialization>;
  readonly budget?: Budget;
  readonly router?: RouterConfig;
  readonly tokenTtlSeconds?: number;
  readonly previewLink?: (key: string) => string;
  readonly environment?: () => Promise<readonly EnvVar[]>;
}

export interface SubmitResult {
  readonly decision: RouteDecision;
  readonly sessionId: string | null;
  readonly sessionIds: readonly string[];
  readonly featureId?: string;
  readonly answer?: { readonly text: string; readonly sources: readonly string[] };
}

export interface GateOutcome {
  readonly ok: boolean;
  readonly checks: readonly CheckResult[];
  readonly requeue?: boolean;
  readonly reverted?: { readonly commitId: string; readonly revertId: string; readonly log: string };
}

export class ControlError extends Error {}

interface Control {
  readonly type: "drop";
  readonly reason: string;
}

export interface SessionTurn {
  readonly commitId: string;
  readonly message: string;
  readonly timestamp: number | null;
  readonly note: { readonly role: string; readonly kind: string; readonly prompt: string; readonly model: string; readonly paths: readonly string[] } | null;
}

export interface SessionChanges {
  readonly base: string | null;
  readonly head: string | null;
  readonly files: readonly { readonly path: string; readonly before: string | null; readonly after: string | null }[];
}

export class Orchestrator {
  readonly canonical: string;
  private readonly router: Router;
  private readonly previews: PreviewPublisher;
  private readonly main: MainWriter;
  private readonly archiver: Archiver;
  private readonly mergeQueue = new Mutex();
  private readonly pickQueue = new Mutex();
  private readonly specialization: Specialization;
  private readonly budget: Budget;
  private readonly ttl: number;
  private readonly resolvers: Readonly<Record<string, Resolver>>;
  private readonly unsubscribe: () => void;
  private readonly running = new Set<string>();
  private readonly syncAfterRun = new Set<string>();

  constructor(
    private readonly deps: Deps,
    private readonly config: ProjectConfig,
  ) {
    this.canonical = config.name;
    this.router = new Router({ classifier: deps.classifier, planner: deps.planner }, config.router ?? DEFAULT_ROUTER_CONFIG);
    this.ttl = config.tokenTtlSeconds ?? 900;
    this.previews = new PreviewPublisher(deps.repos, this.canonical, this.ttl);
    this.main = new MainWriter(deps.repos, this.canonical, this.ttl);
    this.archiver = new Archiver(deps.repos, this.canonical, this.ttl);
    this.budget = config.budget ?? DEFAULT_BUDGET;
    this.specialization = { ...DEFAULT_SPECIALIZATION, ...config.specialization };
    const resolvers: Record<string, Resolver> = {};
    for (const [path, generate] of Object.entries(config.generated)) resolvers[path] = ({ merged }) => generate(merged);
    this.resolvers = resolvers;
    this.unsubscribe = deps.repos.onPush((event) => this.onPush(event));
  }

  dispose(): void {
    this.unsubscribe();
  }

  external(remote: ExternalRemote, options: ExternalSyncOptions): ExternalSync {
    return new ExternalSync(
      {
        canonical: this.canonical,
        author: this.config.author,
        resolvers: this.resolvers,
        repos: this.deps.repos,
        coder: this.deps.coder,
        checks: this.deps.checks,
        store: this.deps.store,
        ids: this.deps.ids,
        clock: this.deps.clock,
        profiles: this.config.profiles,
        ttl: this.ttl,
        lock: (task) => this.mergeQueue.run(task),
        emit: (event) => this.emit(event),
        mainChanged: () => this.syncMemory(),
        regenerate: (tree) => this.regenerate(tree),
        sessions: () => this.sessions(),
      },
      remote,
      options,
    );
  }

  async bootstrap(template: Tree): Promise<string> {
    await this.deps.repos.createRepo(this.canonical, { defaultBranch: "main" });
    const token = await this.deps.repos.createToken(this.canonical, "write", this.ttl);
    try {
      const tree = this.regenerate(template);
      const commit = await this.deps.repos.commit(token, { ref: "main", parent: null, changes: tree, message: "Create project from chef template", author: this.config.author });
      await this.syncMemory();
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

  async submit(prompt: string, options: { readonly attempts?: number } = {}): Promise<SubmitResult> {
    const { tree } = await this.mainTree();
    const spec = readSpec(tree);
    const decision = await this.router.route(prompt, spec);
    await this.emit({ type: "route.decided", prompt, decision });
    if (decision.intent === "question") {
      const answer = await this.answer(prompt);
      await this.emit({ type: "question.answered", prompt, answer: answer.text, sources: answer.sources });
      return { decision, sessionId: null, sessionIds: [], answer };
    }
    const chore = decision.intent === "chore";
    const hotfix = decision.hotfix === true;
    const plan = chore ? await this.planChore(prompt, spec) : await this.planFeature(prompt, decision, spec);
    const attempts = chore || hotfix ? 1 : Math.max(1, Math.floor(options.attempts ?? this.specialization.attempts));
    const ids = Array.from({ length: attempts }, () => this.deps.ids.next("s"));
    const group = ids[0] as string;
    const parent = (await this.sessions()).filter((s) => s.featureId === plan.feature.id && s.machine.state !== "dropped").at(-1)?.id ?? null;
    for (const [index, sessionId] of ids.entries()) {
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
        merge: null,
        attempt: { group, index: index + 1, of: attempts },
        ...(chore ? { kind: "chore" as const } : {}),
        ...(hotfix ? { hotfix: true } : {}),
        parent,
        history: [],
        previewKey: attempts > 1 ? `${plan.feature.id}--${sessionId}` : plan.feature.id,
        createdAt: now,
        updatedAt: now,
      };
      await this.save(record);
      await this.emit({ type: "session.created", sessionId, featureId: record.featureId, fork: record.fork, reason: decision.reason, attempt: record.attempt, parent, ...(chore ? { kind: "chore" as const } : {}), ...(hotfix ? { hotfix: true } : {}) });
    }
    return { decision, sessionId: group, sessionIds: ids, featureId: plan.feature.id };
  }

  private async planFeature(prompt: string, decision: RouteDecision, spec: readonly FeatureSpec[]): Promise<Plan> {
    const roles = Object.values(this.config.profiles)
      .filter((p) => p.plannable)
      .map((p) => ({ role: p.role, description: p.description }));
    const intent = decision.intent === "change_feature" ? "change_feature" : "new_feature";
    const planned = await this.deps.planner.plan({ prompt: withoutCommand(prompt), intent, changeKind: decision.changeKind, featureId: decision.featureId, spec, roles, env: await this.environment() });
    return this.config.profiles["test"] ? withTestItem(planned, "test") : planned;
  }

  private async planChore(prompt: string, spec: readonly FeatureSpec[]): Promise<Plan> {
    if (!this.config.profiles["chore"]) throw new ControlError("this project has no chore role, so add one on the Agents page");
    const taken = new Set([...spec.map((f) => f.id), ...(await this.sessions()).map((s) => s.featureId)]);
    const text = withoutCommand(prompt);
    return chorePlan(choreId(text, taken), text, "chore");
  }

  async route(prompt: string): Promise<RouteDecision> {
    const { tree } = await this.mainTree();
    return this.router.route(prompt, readSpec(tree));
  }

  async submitSpoken(prompt: string, call: { readonly voiceSessionId: string; readonly delegationId: string }): Promise<SubmitResult> {
    const result = await this.submit(prompt);
    await this.emit({ type: "voice.request", voiceSessionId: call.voiceSessionId, delegationId: call.delegationId, prompt, intent: result.decision.intent, sessionId: result.sessionId, featureId: result.featureId ?? result.decision.featureId });
    return result;
  }

  async session(id: string): Promise<SessionRecord> {
    const record = await this.deps.store.get<SessionRecord>(`session/${id}`);
    if (!record) throw new Error(`unknown session ${id}`);
    return record;
  }

  async sessions(): Promise<SessionRecord[]> {
    return [...(await this.deps.store.list<SessionRecord>("session/")).values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  async drop(id: string, reason = "dropped by a person"): Promise<SessionRecord> {
    const record = await this.session(id);
    if (record.machine.state === "merged" || record.machine.state === "dropped") throw new ControlError(`session ${id} is already ${record.machine.state}`);
    if (this.running.has(id)) {
      await this.deps.store.put<Control>(`control/${id}`, { type: "drop", reason });
      return record;
    }
    await this.apply(record, { type: "dropped", reason });
    await this.save(record);
    return record;
  }

  async retry(id: string, guidance: string): Promise<SessionRecord> {
    const record = await this.session(id);
    if (record.machine.state !== "stuck") throw new ControlError(`only a stuck session can be retried, and ${id} is ${record.machine.state}`);
    if (!record.head) throw new ControlError(`session ${id} never started, so send the request again instead`);
    await this.apply(record, { type: "retried", guidance });
    await this.save(record);
    return record;
  }

  async steer(id: string, message: string): Promise<void> {
    const record = await this.session(id);
    if (isTerminal(record.machine.state)) throw new ControlError(`session ${id} is ${record.machine.state}, so retry it instead`);
    const notes = (await this.deps.store.get<string[]>(`steer/${id}`)) ?? [];
    await this.deps.store.put(`steer/${id}`, [...notes, message].slice(-10));
    await this.emit({ type: "session.steered", sessionId: id, featureId: record.featureId, message });
  }

  async turns(id: string, limit = 30): Promise<SessionTurn[]> {
    const record = await this.session(id);
    const ids = record.commits.slice(-limit).reverse();
    return Promise.all(
      ids.map(async (commitId) => {
        const repo = this.repoOf(record);
        const commit = await this.deps.repos.readCommit(repo, commitId);
        const note = parseNote(await this.deps.repos.readNote(repo, NOTES_NAMESPACE, commitId));
        return { commitId, message: commit?.message ?? "", timestamp: commit?.timestamp ?? null, note: note ? { role: note.role, kind: note.kind, prompt: note.prompt, model: note.model, paths: note.paths } : null };
      }),
    );
  }

  async changes(id: string, maxChars = 100_000): Promise<SessionChanges> {
    const record = await this.session(id);
    const from = record.merge?.mainBefore ?? record.baseMain;
    if (!record.head || !from) return { base: from, head: record.head, files: [] };
    const head = await this.commitOf(this.repoOf(record), record.head);
    const base = await this.commitOf(this.canonical, from);
    const clip = (text: string | undefined) => (text === undefined ? null : text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text);
    const files = changedPaths(diffTrees(base.tree, head.tree)).map((path) => ({ path, before: clip(base.tree[path]), after: clip(head.tree[path]) }));
    return { base: base.id, head: head.id, files };
  }

  async drain(maxRounds = 200): Promise<SessionRecord[]> {
    for (let round = 0; round < maxRounds; round++) {
      const active = (await this.sessions()).filter(runnable);
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
      const control = await this.deps.store.get<Control | null>(`control/${id}`);
      if (control) {
        await this.deps.store.put(`control/${id}`, null);
        if (record.machine.state !== "merged" && record.machine.state !== "dropped") {
          await this.apply(record, { type: "dropped", reason: control.reason });
          return await this.save(record);
        }
      }
      if (isTerminal(record.machine.state)) return;
      try {
        if (record.head && record.machine.state !== "queued") await this.adoptForkHead(record);
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
      await this.emit({ type: "agent.started", sessionId: record.id, featureId: record.featureId, role: "planner", kind: "spec_change", model: record.plan.model });
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
    const item = this.nextItem(record, ["test"]) ?? (record.machine.reason === "review_rejected" ? (record.plan.items.find((i) => i.kind === "test") ?? null) : null);
    if (!item) return this.apply(record, { type: "tests_committed" });
    const outcome = await this.coderTurn(record, item, record.machine.feedback);
    if (outcome === "rejected") return;
    record.cursor = record.plan.items.indexOf(item) + 1;
    await this.apply(record, { type: "tests_committed" });
  }

  private async coding(record: SessionRecord): Promise<void> {
    const conflict = record.machine.reason === "conflict";
    let item = this.nextItem(record, BUILD_KINDS);
    if (!item && record.lastCodeItem) item = record.plan.items.find((i) => i.id === record.lastCodeItem) ?? null;
    if (!item) item = record.plan.items.find((i) => BUILD_KINDS.includes(i.kind)) ?? null;
    if (!item) return this.apply(record, { type: "fail", reason: "plan has no code work item" });
    const fixer = record.kind !== "chore" && this.config.profiles["conflict-resolver"] ? "conflict-resolver" : item.role;
    const turnItem: WorkItem = conflict ? { ...item, id: `${item.id}-conflict`, kind: "conflict", role: fixer } : item;
    const outcome = await this.coderTurn(record, turnItem, record.machine.feedback);
    if (outcome === "rejected") return;
    record.lastCodeItem = item.id;
    const index = record.plan.items.indexOf(item);
    if (index >= record.cursor) record.cursor = index + 1;
    if (this.nextItem(record, BUILD_KINDS)) return;
    await this.apply(record, { type: "coded" });
  }

  private async reviewing(record: SessionRecord): Promise<void> {
    const head = await this.commitOf(record.fork, record.head);
    const base = await this.commitOf(this.canonical, record.baseMain);
    await this.emit({ type: "agent.started", sessionId: record.id, featureId: record.featureId, role: "reviewer", kind: "review", model: this.deps.reviewer.model ?? "reviewer" });
    const verdict = await this.deps.reviewer.review({ feature: record.plan.feature, diff: diffTrees(base.tree, head.tree), checksLog: record.machine.feedback ?? "", ...(record.kind === "chore" ? { chore: true } : {}) });
    record.verdict = { ...verdict, commitId: head.id };
    await this.emit({ type: "review.verdict", sessionId: record.id, featureId: record.featureId, approve: verdict.approve, reasons: verdict.reasons, model: verdict.model, head: head.id, base: base.id });
    if (verdict.approve) await this.apply(record, { type: "review_approved" });
    else await this.apply(record, { type: "review_rejected", reasons: verdict.reasons, retest: this.specialization.lockTests && verdict.retest === true && record.plan.items.some((i) => i.kind === "test") });
  }

  async environmentChanged(): Promise<string[]> {
    const env = await this.environment();
    const resumed: string[] = [];
    for (const record of await this.sessions()) {
      if (isTerminal(record.machine.state) || !record.needs?.length) continue;
      const missing = missingEnv(await this.featureOf(record), env);
      if (sameNames(missing, record.needs)) continue;
      record.needs = missing;
      await this.emit({ type: "session.needs", sessionId: record.id, featureId: record.featureId, names: missing });
      await this.save(record);
      if (missing.length === 0) resumed.push(record.id);
    }
    return resumed;
  }

  private async waitForEnvironment(record: SessionRecord): Promise<boolean> {
    const missing = missingEnv(await this.featureOf(record), await this.environment());
    if (sameNames(missing, record.needs ?? [])) return missing.length > 0;
    record.needs = missing;
    await this.emit({ type: "session.needs", sessionId: record.id, featureId: record.featureId, names: missing });
    return missing.length > 0;
  }

  private async featureOf(record: SessionRecord): Promise<FeatureSpec> {
    const head = record.head ? await this.deps.repos.readCommit(record.fork, record.head) : null;
    return (head ? readSpec(head.tree).find((f) => f.id === record.featureId) : undefined) ?? record.plan.feature;
  }

  private async environment(): Promise<readonly EnvVar[]> {
    return this.config.environment ? this.config.environment() : [];
  }

  private async gating(record: SessionRecord): Promise<void> {
    if (await this.waitForEnvironment(record)) return;
    if (await this.heldForHotfix(record)) return;
    if (record.attempt.of > 1) {
      const winner = await this.pickAttempt(record);
      if (winner !== record.id) {
        if (winner !== null) await this.apply(record, { type: "dropped", reason: `attempt ${winner} was picked` });
        return;
      }
    }
    const outcome = await this.gate(record);
    if (outcome.requeue) return;
    await this.emit({ type: "gate.result", sessionId: record.id, featureId: record.featureId, ok: outcome.ok, checks: outcome.checks });
    if (record.machine.state !== "gating") return;
    if (outcome.ok) {
      await this.apply(record, { type: "gate_passed" });
      await this.emit({ type: "main.merged", sessionId: record.id, featureId: record.featureId, commitId: outcome.reverted?.commitId ?? (record.baseMain as string) });
      if (outcome.reverted) await this.reopen(record, outcome.reverted.revertId, outcome.reverted.log);
    } else {
      await this.apply(record, { type: "gate_failed", log: formatChecks(outcome.checks.filter((c) => !c.ok)) });
    }
  }

  private async heldForHotfix(record: SessionRecord): Promise<boolean> {
    const hotfix = record.hotfix ? null : ((await this.sessions()).find((s) => s.hotfix && s.id !== record.id && !isTerminal(s.machine.state))?.id ?? null);
    if ((record.heldBy ?? null) === hotfix) return hotfix !== null;
    record.heldBy = hotfix;
    await this.emit({ type: "session.held", sessionId: record.id, featureId: record.featureId, by: hotfix });
    return hotfix !== null;
  }

  async gate(record: SessionRecord): Promise<GateOutcome> {
    const synced = await this.syncFromMain(record);
    if (synced === "conflict") return { ok: false, checks: [], requeue: true };
    const head = await this.commitOf(record.fork, record.head);
    const checks: CheckResult[] = [...(await this.deps.checks.run({ repo: record.fork, commitId: head.id, tree: head.tree }))];
    checks.push(await this.scopeCheck(record));
    if (this.specialization.lockTests) checks.push(await this.lockedCheck(record));
    checks.push(await this.verdictCheck(record));
    checks.push(await this.proofCheck(record, head));
    if (checks.some((c) => !c.ok)) return { ok: false, checks };
    return this.mergeQueue.run(async () => {
      const mainHead = await this.deps.repos.resolveRef(this.canonical, "main");
      if (!mainHead || mainHead !== record.baseMain) {
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
      record.merge = { commitId: outcome.commitId, mainBefore: mainHead };
      const verified = await this.verifyMain(outcome.commitId);
      if (verified.ok) {
        await this.syncMemory();
        return { ok: true, checks };
      }
      const { revertId } = await this.revertLocked(record.featureId, outcome.commitId, mainHead, verified.log, [record.rootPrompt]);
      await this.syncMemory();
      return { ok: true, checks, reverted: { commitId: outcome.commitId, revertId, log: verified.log } };
    });
  }

  private async verifyMain(commitId: string): Promise<{ ok: boolean; log: string }> {
    const commit = await this.commitOf(this.canonical, commitId);
    const results = await this.deps.checks.run({ repo: this.canonical, commitId, tree: commit.tree });
    const map = featureMapProblems(commit.tree);
    const failed = [...results, { name: "feature-map", ok: map.length === 0, log: map.join("\n") || "feature map matches the code" }].filter((c) => !c.ok);
    return { ok: failed.length === 0, log: failed.length ? `main went red after merging ${commitId.slice(0, 12)}\n\n${formatChecks(failed)}` : "main green" };
  }

  private async revertLocked(featureId: string, mergedCommit: string, mainBefore: string, log: string, prompts: readonly string[]): Promise<{ revertId: string; undone: string[] }> {
    const head = await this.deps.repos.resolveRef(this.canonical, "main");
    if (!head) throw new Error("main has no head to revert");
    const before = await this.ancestors(mainBefore, new Set());
    const later = [...(await this.ancestors(head, before))].filter((id) => id !== mergedCommit);
    const mergedTree = (await this.commitOf(this.canonical, mergedCommit)).tree;
    const lesson = { [lessonPath(featureId, mergedCommit)]: renderLesson({ feature: readSpec(mergedTree).find((f) => f.id === featureId), featureId, mergedCommit, log, prompts }) };
    const reverted = await this.main.revert({ to: mainBefore, merged: mergedCommit, expectedHead: head, message: `Revert ${featureId}: main went red`, author: this.config.author, resolvers: this.resolvers, extra: lesson });
    await this.emit({ type: "memory.recorded", featureId, path: Object.keys(lesson)[0] as string, kind: "lesson" });
    await this.emit({ type: "main.reverted", featureId, revertedCommit: mergedCommit, commitId: reverted.commitId, log });
    return { revertId: reverted.commitId, undone: reverted.cascaded ? later : [] };
  }

  private async ancestors(from: string, stop: ReadonlySet<string>, limit = 5000): Promise<Set<string>> {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length > 0 && seen.size < limit) {
      const id = queue.pop() as string;
      if (seen.has(id) || stop.has(id)) continue;
      seen.add(id);
      const commit = await this.deps.repos.readCommit(this.canonical, id);
      if (commit) queue.push(...commit.parents);
    }
    return seen;
  }

  private async reopen(record: SessionRecord, revertId: string, log: string, charged = true): Promise<void> {
    record.baseMain = revertId;
    record.merge = null;
    record.syncPending = false;
    await this.apply(record, { type: "reopened", log, charged });
    await this.reforkAfterRevert(record, revertId);
  }

  async revertMerge(mergedCommit: string, log: string): Promise<string | null> {
    const owner = (await this.sessions()).find((s) => s.merge?.commitId === mergedCommit) ?? null;
    const outcome = await this.mergeQueue.run(async () => {
      const before = owner?.merge?.mainBefore ?? (await this.mainParentBefore(mergedCommit));
      if (!before) return null;
      const note = parseNote(await this.deps.repos.readNote(this.canonical, NOTES_NAMESPACE, mergedCommit));
      return this.revertLocked(owner?.featureId ?? note?.feature ?? "unknown", mergedCommit, before, log, owner ? [owner.rootPrompt] : note ? [note.rootPrompt] : []);
    });
    if (!outcome) return null;
    await this.syncMemory();
    if (owner) {
      await this.reopen(owner, outcome.revertId, log);
      await this.save(owner);
    }
    const undone = new Set(outcome.undone);
    for (const other of await this.sessions()) {
      if (!other.merge || !undone.has(other.merge.commitId) || this.running.has(other.id)) continue;
      await this.reopen(other, outcome.revertId, `Main was returned to before ${mergedCommit.slice(0, 12)} because reverting it alone conflicted with this feature's merge. Merge this feature again.\n\n${log}`, false);
      await this.save(other);
    }
    return outcome.revertId;
  }

  private async reforkAfterRevert(record: SessionRecord, revertId: string): Promise<void> {
    if (record.forkDeleted) {
      await this.deps.repos.fork(this.canonical, record.fork);
      record.forkDeleted = false;
    }
    const token = await this.deps.repos.createToken(record.fork, "write", this.ttl);
    try {
      const outcome = await this.deps.repos.merge(token, { into: "main", from: { repo: this.canonical, ref: "main" }, message: "Sync main after revert", author: this.config.author, resolvers: this.resolvers });
      if (outcome.status === "conflict") return;
      const revertCommit = await this.commitOf(this.canonical, revertId);
      const merged = await this.commitOf(record.fork, outcome.commitId);
      const restore = Object.fromEntries(Object.entries(diffTrees(merged.tree, (await this.commitOf(record.fork, record.head)).tree)).filter(([path]) => !path.startsWith(MEMORY_DIR)));
      record.head = outcome.commitId;
      if (Object.keys(restore).length > 0 || revertCommit.id === outcome.commitId) {
        const path = specPath(record.featureId);
        const restoredSpec = restore[path] ? readSpec({ [path]: restore[path] as string }).find((f) => f.id === record.featureId) : undefined;
        const changes = restoredSpec?.status === "merged" ? { ...restore, [path]: renderFeature({ ...restoredSpec, status: "building" }) } : restore;
        const commit = await this.deps.repos.commit(token, { ref: "main", parent: record.head, changes, message: `Restore ${record.featureId} work after revert`, author: this.config.author });
        await this.deps.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: commit.id, note: renderNote(this.note(record, { role: "sync", kind: "sync", workItem: null, prompt: `Restore ${record.featureId} after revert ${revertId}`, runId: this.deps.ids.next("run"), model: "chef-sync", paths: changedPaths(changes) })) });
        record.head = commit.id;
        record.commits.push(commit.id);
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
    const tree = applyChanges(head.tree, { [path]: renderFeature(updated) });
    const memoryPath = featureMemoryPath(record.featureId);
    const turns: { role: string; message: string }[] = [];
    for (const commitId of record.commits) {
      const note = parseNote(await this.deps.repos.readNote(record.fork, NOTES_NAMESPACE, commitId));
      const commit = await this.deps.repos.readCommit(record.fork, commitId);
      if (note && commit && note.kind !== "sync") turns.push({ role: note.role, message: commit.message });
    }
    const memory = renderFeatureMemory(tree[memoryPath], { feature: updated, sessionId: record.id, parent: record.parent, rootPrompt: record.rootPrompt, attempt: record.attempt, turns, feedback: record.history });
    const corrections = [...(await this.deps.store.list<Correction | null>("corrections/")).entries()].filter(([key, c]) => !key.startsWith("corrections/pending/") && c !== null).map(([, c]) => c as Correction);
    const mined = mineRules(corrections, tree);
    const changes: Record<string, string | null> = { [path]: renderFeature(updated), ...gardenFeatureMap(tree), [memoryPath]: memory };
    for (const { rule } of mined) changes[rulePath(rule.id)] = renderRule(rule);
    await this.commitTurn(record, {
      changes,
      role: "gardener",
      kind: "spec_change",
      workItem: null,
      prompt: `Mark ${record.featureId} merged and garden the feature map, memory and lint rules`,
      model: "chef-gardener",
      runId: this.deps.ids.next("run"),
      message: `spec: mark ${record.featureId} merged`,
    });
    await this.emit({ type: "memory.recorded", featureId: record.featureId, path: memoryPath, kind: "feature" });
    for (const { rule, sessions } of mined) await this.emit({ type: "lint.rule.added", sessionId: record.id, featureId: record.featureId, ruleId: rule.id, message: rule.message, sessions, evidence: rule.evidence });
  }

  private async syncMemory(): Promise<void> {
    const { tree } = await this.mainTree();
    const docs = memoryDocs(tree);
    const indexed = (await this.deps.store.get<Record<string, string>>("memory-index/2")) ?? {};
    const next: Record<string, string> = {};
    const changed = docs.filter((doc) => {
      next[doc.path] = hashHex(`${doc.kind}\n${doc.feature ?? ""}\n${doc.text}`);
      return indexed[doc.path] !== next[doc.path];
    });
    const removed = Object.keys(indexed).filter((path) => !(path in next));
    if (changed.length) await this.deps.memory.upsert(changed);
    if (removed.length) await this.deps.memory.remove(removed);
    await this.deps.store.put("memory-index/2", next);
  }

  private async recall(record: SessionRecord, feature: FeatureSpec, item: WorkItem): Promise<MemoryHit[]> {
    const query = [feature.id, feature.title, ...feature.acceptance.map((c) => c.text), item.prompt].join("\n");
    const hits = await this.deps.memory.query(query, 8, ["lesson", "feature"]);
    const ranked = [...hits].sort((a, b) => Number(b.doc.feature === record.featureId) - Number(a.doc.feature === record.featureId) || b.score - a.score);
    return ranked.slice(0, 3);
  }

  private async answer(question: string): Promise<{ text: string; sources: string[] }> {
    const hits = await this.deps.memory.query(question, 5);
    const sources = hits.map((h) => h.doc.path);
    if (this.deps.planner.answer) return { text: await this.deps.planner.answer({ question, context: hits }), sources };
    const text = hits.length ? hits.map((h) => `${h.doc.path}: ${(h.doc.text.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "").trim()}`).join("\n") : "Nothing in the project memory answers that yet.";
    return { text, sources };
  }

  private async recordCorrection(record: SessionRecord, role: string, before: Tree, changes: FileChanges): Promise<void> {
    const pendingKey = `corrections/pending/${record.id}/${role}`;
    const pending = await this.deps.store.get<{ signature: string; before: Record<string, string | null>; passing: string[] } | null>(pendingKey);
    if (!pending && !record.machine.feedback) return;
    const after: Record<string, string | null> = {};
    const previous: Record<string, string | null> = {};
    for (const [path, content] of Object.entries(changes)) {
      after[path] = content;
      previous[path] = before[path] ?? null;
    }
    const correction: Correction = {
      id: this.deps.ids.next("c"),
      featureId: record.featureId,
      sessionId: record.id,
      role,
      signature: pending?.signature ?? record.machine.reason,
      before: pending?.before ?? previous,
      after,
      passing: pending?.passing ?? [],
    };
    await this.deps.store.put(`corrections/${correction.id}`, correction);
    if (pending) await this.deps.store.put(pendingKey, null);
    await this.emit({ type: "correction.recorded", sessionId: record.id, featureId: record.featureId, role, signature: correction.signature, correctionId: correction.id });
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

  private async lockedCheck(record: SessionRecord): Promise<CheckResult> {
    const problems: string[] = [];
    const locked = new Set<string>();
    for (const commitId of record.commits) {
      const commit = await this.commitOf(record.fork, commitId);
      if (commit.parents.length !== 1) continue;
      const note = parseNote(await this.deps.repos.readNote(record.fork, NOTES_NAMESPACE, commitId));
      if (!note || note.kind === "sync" || note.kind === "merge") continue;
      if (note.role === "test") {
        for (const path of note.paths) locked.add(path);
        continue;
      }
      const parent = await this.commitOf(record.fork, commit.parents[0] as string);
      const touched = changedPaths(diffTrees(parent.tree, commit.tree)).filter((p) => locked.has(p) && !hasMarkers(parent.tree[p]));
      if (touched.length > 0) problems.push(`${commitId.slice(0, 12)} (${note.role}) changed locked tests: ${touched.join(", ")}`);
    }
    return { name: "locked-tests", ok: problems.length === 0, log: problems.join("\n") || `${locked.size} locked test files untouched by coders` };
  }

  private async lockedPaths(record: SessionRecord): Promise<Set<string>> {
    const locked = new Set<string>();
    for (const commitId of record.commits) {
      const note = parseNote(await this.deps.repos.readNote(record.fork, NOTES_NAMESPACE, commitId));
      if (note?.role === "test") for (const path of note.paths) locked.add(path);
    }
    return locked;
  }

  private async verdictCheck(record: SessionRecord): Promise<CheckResult> {
    const verdict = record.verdict;
    if (!verdict) return { name: "review", ok: false, log: "no reviewer verdict" };
    if (!verdict.approve) return { name: "review", ok: false, log: verdict.reasons.join("\n") };
    const index = record.commits.indexOf(verdict.commitId);
    if (index < 0) return { name: "review", ok: false, log: "verdict is for a commit outside this session" };
    const coders = new Set<string>();
    for (const commitId of record.commits) {
      const note = parseNote(await this.deps.repos.readNote(record.fork, NOTES_NAMESPACE, commitId));
      if (note && CODER_KINDS.has(note.kind)) coders.add(note.model);
    }
    if (coders.has(verdict.model)) return { name: "review", ok: false, log: `reviewer ran on ${verdict.model}, the same model that wrote the code; configure a different reviewer model` };
    return { name: "review", ok: true, log: `approved by ${verdict.model}; code written by ${[...coders].join(", ") || "no coder"}` };
  }

  private async pickAttempt(record: SessionRecord): Promise<string | null> {
    const winner = await this.pickQueue.run(async () => {
      const key = `attempts/${record.attempt.group}`;
      const decided = await this.deps.store.get<{ winner: string }>(key);
      if (decided) return decided.winner;
      const siblings = (await this.sessions()).filter((s) => s.attempt.group === record.attempt.group).map((s) => (s.id === record.id ? record : s));
      const live = siblings.filter((s) => !isTerminal(s.machine.state));
      if (live.some((s) => s.machine.state !== "gating")) return null;
      const candidates = await this.crossTests(live);
      const verdict = candidates.length === 1 ? { sessionId: record.id, reasons: ["only attempt still running"], model: "chef" } : await this.deps.reviewer.pick({ feature: record.plan.feature, candidates });
      await this.deps.store.put(key, { winner: verdict.sessionId });
      await this.emit({ type: "attempt.picked", featureId: record.featureId, group: record.attempt.group, winner: verdict.sessionId, candidates: candidates.map((c) => ({ sessionId: c.sessionId, passed: c.crossTests.passed, total: c.crossTests.total })), reasons: verdict.reasons, model: verdict.model });
      return verdict.sessionId;
    });
    if (winner === record.id && record.previewKey !== record.featureId) {
      record.previewKey = record.featureId;
      await this.publishPreview(record);
    }
    return winner;
  }

  private async crossTests(candidates: readonly SessionRecord[]): Promise<PickCandidate[]> {
    const prefix = (record: SessionRecord) => `features/${record.featureId}/`;
    const heads = await Promise.all(candidates.map(async (c) => ({ record: c, head: await this.commitOf(c.fork, c.head), base: await this.commitOf(this.canonical, c.baseMain) })));
    const testsOf = (entry: (typeof heads)[number]) => Object.entries(entry.head.tree).filter(([path]) => path.startsWith(prefix(entry.record)) && path.endsWith(".test.ts"));
    return Promise.all(
      heads.map(async (entry) => {
        const extra: Record<string, string> = {};
        for (const other of heads) {
          if (other === entry) continue;
          for (const [path, content] of testsOf(other)) extra[path.replace(/\.test\.ts$/, `.attempt${other.record.attempt.index}.test.ts`)] = content;
        }
        const tree = focusTests(this.regenerate(applyChanges(entry.head.tree, extra)), entry.record.featureId);
        const names = Object.entries(tree).filter(([path]) => path.startsWith(prefix(entry.record)) && path.endsWith(".test.ts")).flatMap(([, content]) => testNames(content));
        const results = await this.deps.checks.run({ repo: entry.record.fork, commitId: `${entry.head.id}+cross`, tree });
        const test = results.find((r) => r.name === "test");
        const score = scoreCases(test, names);
        return { sessionId: entry.record.id, diff: diffTrees(entry.base.tree, entry.head.tree), crossTests: { sessionId: entry.record.id, ...score, log: test?.log ?? "no test check" } };
      }),
    );
  }

  private async proofCheck(record: SessionRecord, head: Commit): Promise<CheckResult> {
    if (!record.preview || record.preview.commitId !== head.id) await this.publishPreview(record);
    const preview = record.preview;
    if (!preview) return { name: "proof", ok: false, log: "no preview deployment" };
    if (record.kind === "chore") return this.choreProof(record, head, preview.url);
    const flow = featureFlow(readSpec(head.tree).find((f) => f.id === record.featureId) ?? record.plan.feature);
    const proof = await this.deps.proofs.prove({ repo: record.fork, feature: record.featureId, flow, url: preview.url, commitId: head.id, tree: head.tree });
    await this.withToken(record.fork, (token) => this.deps.repos.addNote(token, { namespace: PROOF_NAMESPACE, commitId: head.id, note: `${JSON.stringify(proof, null, 2)}\n` }));
    const stored = await this.deps.repos.readNote(record.fork, PROOF_NAMESPACE, head.id);
    const ok = proof.ok && stored !== null;
    return { name: "proof", ok, log: proof.steps.map((s) => `${s.ok ? "ok" : "FAIL"} ${s.name}: ${s.detail}`).join("\n") || "no proof steps" };
  }

  private async choreProof(record: SessionRecord, head: Commit, url: string): Promise<CheckResult> {
    const live = readSpec(head.tree)
      .filter((f) => f.status === "merged" && head.tree[`features/${featureFlow(f)}/flow.ts`] !== undefined)
      .slice(0, CHORE_PROOFS);
    const proofs: ProofRecord[] = [];
    for (const feature of live) proofs.push(await this.deps.proofs.prove({ repo: record.fork, feature: feature.id, flow: featureFlow(feature), url, commitId: head.id, tree: head.tree }));
    const ok = proofs.every((p) => p.ok);
    await this.withToken(record.fork, (token) => this.deps.repos.addNote(token, { namespace: PROOF_NAMESPACE, commitId: head.id, note: `${JSON.stringify({ chore: record.featureId, url, commitId: head.id, ok, proofs }, null, 2)}\n` }));
    const log = proofs.flatMap((p) => p.steps.map((s) => `${s.ok ? "ok" : "FAIL"} ${p.feature} ${s.name}: ${s.detail}`)).join("\n");
    return { name: "proof", ok, log: log || "no live features to prove yet" };
  }

  private async adoptForkHead(record: SessionRecord): Promise<void> {
    const forkHead = await this.deps.repos.resolveRef(record.fork, "main");
    if (!forkHead || forkHead === record.head) return;
    const adopted: string[] = [];
    let cursor: string | undefined = forkHead;
    while (cursor && cursor !== record.head && adopted.length < ADOPT_LIMIT) {
      adopted.unshift(cursor);
      cursor = (await this.commitOf(record.fork, cursor)).parents[0];
    }
    if (cursor !== record.head) return;
    record.head = forkHead;
    record.commits.push(...adopted.filter((id) => !record.commits.includes(id)));
    await this.publishPreview(record);
  }

  private async syncFromMain(record: SessionRecord): Promise<"synced" | "up-to-date" | "conflict"> {
    const mainHead = await this.deps.repos.resolveRef(this.canonical, "main");
    if (!mainHead || mainHead === record.baseMain) return "up-to-date";
    const outcome = await this.withToken(record.fork, (token) =>
      this.deps.repos.merge(token, { into: "main", from: { repo: this.canonical, ref: "main" }, message: `Merge main into ${record.fork}`, author: this.config.author, resolvers: this.resolvers, onConflict: "commit-markers" }),
    );
    if (outcome.status === "conflict") throw new Error(`merge of main into ${record.fork} failed on ${outcome.paths.join(", ")}`);
    record.baseMain = mainHead;
    if (outcome.status === "up-to-date") return "up-to-date";
    record.head = outcome.commitId;
    if (outcome.status === "merged" || outcome.status === "conflicted") {
      const paths = outcome.status === "conflicted" ? outcome.paths : [];
      record.commits.push(outcome.commitId);
      await this.withToken(record.fork, (token) => this.deps.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: outcome.commitId, note: renderNote(this.note(record, { role: "sync", kind: "sync", workItem: null, prompt: `Merge main ${mainHead}`, runId: this.deps.ids.next("run"), model: "chef-sync", paths })) }));
    }
    if (outcome.status === "conflicted") {
      await this.emit({ type: "sync.conflict", sessionId: record.id, featureId: record.featureId, paths: outcome.paths, mainCommit: mainHead });
      await this.apply(record, { type: "conflict", paths: outcome.paths });
      return "conflict";
    }
    await this.emit({ type: "sync.merged", sessionId: record.id, featureId: record.featureId, commitId: outcome.commitId, mainCommit: mainHead });
    await this.publishPreview(record);
    return "synced";
  }

  private async coderTurn(record: SessionRecord, item: WorkItem, feedback: string | null): Promise<"committed" | "empty" | "rejected"> {
    const profile = this.config.profiles[item.role];
    if (!profile) throw new Error(`no agent profile for role ${item.role}`);
    const head = await this.commitOf(record.fork, record.head);
    const feature = readSpec(head.tree).find((f) => f.id === record.featureId) ?? record.plan.feature;
    const scope = scopeFor(profile, feature);
    const agent = customAgent(profile, record.featureId, scope);
    const readToken = await this.deps.repos.createToken(record.fork, "read", this.ttl);
    const info = await this.deps.repos.info(record.fork);
    const recalled = await this.recall(record, feature, item);
    if (recalled.length) await this.emit({ type: "memory.recalled", sessionId: record.id, featureId: record.featureId, paths: recalled.map((h) => h.doc.path) });
    const steering = (await this.deps.store.get<string[]>(`steer/${record.id}`)) ?? [];
    if (steering.length) await this.deps.store.put(`steer/${record.id}`, []);
    const notes = steering.length ? `A person added notes for this turn:\n${steering.map((n) => `- ${n}`).join("\n")}` : null;
    const prompt = [item.prompt, feedback, notes, renderEnvironment(await this.environment(), feature), renderRecall(recalled)].filter(Boolean).join("\n\n");
    await this.emit({ type: "agent.started", sessionId: record.id, featureId: record.featureId, role: item.role, kind: item.kind, model: profile.model });
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
        agent,
        attempt: { index: record.attempt.index, of: record.attempt.of },
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
    if (outside.length > 0) return this.reject(record, item.role, "write-scope", outside, scope, undefined, result.changes);
    if (this.specialization.lockTests && item.role !== "test") {
      const locked = await this.lockedPaths(record);
      const touched = paths.filter((p) => locked.has(p) && !hasMarkers(head.tree[p]));
      if (touched.length > 0) return this.reject(record, item.role, "locked-tests", touched, scope, undefined, result.changes);
    }
    const tree = applyChanges(head.tree, result.changes);
    const linted = projectRuleProblems(tree, paths);
    if (linted.length > 0) return this.reject(record, item.role, "project-lint", [...new Set(linted.map((p) => p.path))], scope, linted.map((p) => `${p.path}:${p.line} ${p.message}`).join("\n"), result.changes);
    if (item.kind === "test" && !record.lastCodeItem) {
      const red = await this.redCheck(record, head, tree, feature);
      if (red) return this.reject(record, item.role, "red-tests", red.paths, scope, red.detail, result.changes, red.passing);
    }
    const changes = diffTrees(head.tree, this.regenerate(tree));
    if (Object.keys(changes).length === 0) return "empty";
    if (item.kind !== "conflict") await this.recordCorrection(record, item.role, head.tree, changes);
    await this.commitTurn(record, { changes, role: item.role, kind: item.kind, workItem: item.id, prompt, model: result.model, runId: result.runId, message: `${item.kind}(${record.featureId}): ${firstLine(result.summary || item.prompt)}` });
    return "committed";
  }

  private async reject(record: SessionRecord, role: string, rule: RejectionRule, paths: readonly string[], scope: readonly string[], detail?: string, changes: FileChanges = {}, passing: readonly string[] = []): Promise<"rejected"> {
    await this.emit({ type: "turn.rejected", sessionId: record.id, featureId: record.featureId, role, rule, paths });
    await this.deps.store.put(`corrections/pending/${record.id}/${role}`, { signature: rule, before: { ...changes }, passing: [...passing] });
    await this.apply(record, { type: "turn_rejected", rule, paths, scope, ...(detail ? { detail } : {}) });
    return "rejected";
  }

  private async redCheck(record: SessionRecord, head: Commit, candidate: Tree, feature: FeatureSpec): Promise<{ paths: string[]; detail: string; passing: string[] } | null> {
    const stub = this.specialization.stub;
    if (!stub) return null;
    const tests = changedPaths(diffTrees(head.tree, candidate)).filter((p) => p.endsWith(".test.ts") && candidate[p] !== undefined);
    if (tests.length === 0) return null;
    const fresh = tests.flatMap((p) => {
      const before = new Set(testNames(head.tree[p] ?? ""));
      return testNames(candidate[p] ?? "").filter((n) => !before.has(n));
    });
    if (fresh.length === 0) return null;
    const missing = Object.fromEntries(Object.entries(stub(feature)).filter(([path]) => candidate[path] === undefined));
    const tree = focusTests(this.regenerate(applyChanges(candidate, missing)), record.featureId);
    const results = await this.deps.checks.run({ repo: record.fork, commitId: `${head.id}+red`, tree });
    const test = results.find((r) => r.name === "test");
    if (!test) return null;
    if (!test.cases) return test.ok ? { paths: tests, detail: "The test suite passes without an implementation.", passing: fresh } : null;
    const passing = test.cases.filter((c) => c.ok && fresh.includes(c.name)).map((c) => c.name);
    if (passing.length === 0) return null;
    return { paths: tests, detail: `Passing without an implementation:\n${passing.map((n) => `- ${n}`).join("\n")}`, passing };
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
      chef: 1,
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
    const branch = await this.previews.publish(record.previewKey, record.head, record.fork);
    const deployment = await this.deps.previews.deploy({ repo: this.canonical, branch, commitId: record.head });
    const link = this.config.previewLink?.(record.previewKey);
    record.preview = { url: deployment.url, commitId: record.head, ...(link ? { link } : {}) };
    record.firstPreviewCommit ??= record.head;
    await this.emit({ type: "preview.updated", sessionId: record.id, featureId: record.featureId, url: deployment.url, commitId: record.head, ...(link ? { link } : {}) });
  }

  private onPush(event: PushedEvent): void {
    if (event.repo !== this.canonical || event.ref !== "main") return;
    void this.markSyncPending(event.after);
  }

  private async markSyncPending(mainHead: string): Promise<void> {
    for (const record of await this.sessions()) {
      if (isTerminal(record.machine.state) || record.machine.state === "queued" || record.baseMain === mainHead) continue;
      if (this.running.has(record.id)) {
        this.syncAfterRun.add(record.id);
        continue;
      }
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
    if (RETRY_EVENTS.has(event.type) && record.machine.feedback) record.history = [...record.history, record.machine.feedback.slice(0, 400)].slice(-20);
    record.updatedAt = this.deps.clock.now();
    await this.emit({ type: "session.state", sessionId: record.id, featureId: record.featureId, from, to: record.machine.state, reason: record.machine.reason });
    if (record.machine.state === "stuck") await this.emit({ type: "session.stuck", sessionId: record.id, featureId: record.featureId, reason: record.machine.reason });
  }

  private async save(record: SessionRecord): Promise<void> {
    const stored = await this.deps.store.get<SessionRecord>(`session/${record.id}`);
    if (stored?.syncPending && !this.running.has(record.id)) record.syncPending = true;
    if (this.syncAfterRun.delete(record.id)) record.syncPending = true;
    const state = record.machine.state;
    if (!isTerminal(state)) record.released = null;
    else if (record.released !== state && (await this.release(record))) record.released = state;
    await this.deps.store.put(`session/${record.id}`, record);
  }

  async reclaim(): Promise<number> {
    let released = 0;
    for (const record of await this.sessions()) {
      if (!isTerminal(record.machine.state) || record.released === record.machine.state || this.running.has(record.id)) continue;
      await this.save(record);
      released++;
    }
    return released;
  }

  private async release(record: SessionRecord): Promise<boolean> {
    await this.deps.coder.release?.(record.id).catch(() => undefined);
    const state = record.machine.state;
    if ((state !== "merged" && state !== "dropped") || record.forkDeleted) return true;
    try {
      if (state === "dropped" && record.head) await this.archiver.archive(record.id, record.head, record.fork);
      await this.deps.repos.deleteRepo(record.fork);
      record.forkDeleted = true;
      await this.emit({ type: "fork.deleted", sessionId: record.id, featureId: record.featureId, fork: record.fork, archived: state === "dropped" && record.head ? `archive/${record.id}` : null });
      return true;
    } catch (error) {
      await this.emit({ type: "fork.kept", sessionId: record.id, featureId: record.featureId, fork: record.fork, reason: (error as Error).message });
      return false;
    }
  }

  private repoOf(record: SessionRecord): string {
    return record.forkDeleted ? this.canonical : record.fork;
  }

  private async emit(event: DistributiveOmit<ChefEvent, "project" | "at">): Promise<void> {
    await this.deps.bus.publish({ ...event, project: this.config.name, at: this.deps.clock.now() } as ChefEvent);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const RETRY_EVENTS: ReadonlySet<SessionEvent["type"]> = new Set(["review_rejected", "gate_failed", "turn_rejected", "reopened", "conflict"]);

const CODER_KINDS: ReadonlySet<TurnNote["kind"]> = new Set(["test", "code", "fix", "refactor", "chore", "conflict"]);

const BUILD_KINDS: readonly WorkItem["kind"][] = ["code", "fix", "refactor", "chore"];

const CHORE_PROOFS = 6;

const ADOPT_LIMIT = 20;

function hasMarkers(content: string | undefined): boolean {
  return content?.includes("<<<<<<<") ?? false;
}

export function testNames(source: string): string[] {
  return [...source.matchAll(/\b(?:test|it)\(\s*(["'`])((?:(?!\1).)*)\1/g)].map((m) => m[2] as string);
}

function focusTests(tree: Tree, featureId: string): Tree {
  const own = `features/${featureId}/`;
  return Object.fromEntries(Object.entries(tree).filter(([path]) => !path.endsWith(".test.ts") || path.startsWith(own)));
}

function scoreCases(test: CheckResult | undefined, names: readonly string[]): { passed: number; total: number } {
  if (!test) return { passed: 0, total: 0 };
  if (!test.cases) return { passed: test.ok ? 1 : 0, total: 1 };
  const expected = new Set(names);
  const passed = test.cases.filter((c) => c.ok && expected.has(c.name)).length;
  return { passed: Math.min(passed, names.length), total: names.length };
}

function formatChecks(checks: readonly CheckResult[]): string {
  return checks.map((c) => `## ${c.name}: ${c.ok ? "ok" : "FAILED"}\n${c.log}`).join("\n\n");
}

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").slice(0, 72);
}

export function specProblems(tree: Tree): string[] {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(tree)) if (path.startsWith("spec/features/")) files[path] = content;
  return lintSpecFiles(files).problems.map((p) => `${p.path}: ${p.message}`);
}

export function runnable(record: SessionRecord): boolean {
  return !isTerminal(record.machine.state) && !record.needs?.length;
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}
