import type { ChefEvent } from "../events/events.ts";
import { applyChanges, changedPaths, diffTrees, type Author, type Commit, type CommitSummary, type FileChanges, type Resolver, type Tree } from "../git/tree.ts";
import { NOTES_NAMESPACE, PROOF_NAMESPACE, parseNote, renderNote, type TurnNote } from "../notes/notes.ts";
import type { CheckResult, CheckRunner, ProofRecord, ProofRunner } from "../ports/check-runner.ts";
import type { Classifier } from "../ports/classifier.ts";
import { TurnRunning, type Coder, type CoderEvent, type CoderTurnResult } from "../ports/coder.ts";
import type { EventBus } from "../ports/event-bus.ts";
import { chorePlan, choreId, choreTitle, withTestItem, type Plan, type Planner, type SplitPart, type WorkItem } from "../ports/planner.ts";
import type { AppHost, AppRun } from "../ports/app-host.ts";
import type { PushedEvent, RepoHost, RepoToken } from "../ports/repo-host.ts";
import type { MemoryDoc, MemoryHit, MemoryIndex } from "../ports/memory-index.ts";
import type { PickCandidate, Reviewer } from "../ports/reviewer.ts";
import type { Clock, IdSource, KeyValueStore } from "../ports/runtime.ts";
import { customAgent, outOfScope, scopeFor, type Profiles } from "../profiles/profile.ts";
import type { RouteDecision } from "../router/decision.ts";
import { DEFAULT_ROUTER_CONFIG, Router, withoutCommand, type RouterConfig } from "../router/router.ts";
import { chatContext, needsCompacting, plainSummary, readChatMemory, renderConversation, splitForCompacting, type ChatMemory } from "../router/conversation.ts";
import { addTokens, DEFAULT_BUDGET, initialMachine, isTerminal, transition, type Budget, type RejectionRule, type SessionEvent } from "../session/machine.ts";
import { laneBrief, laneItem, laneOwner, lanesBusy, lanesNamedIn, planLanes, type Lane, type LaneLayoutFor, type LaneStatus } from "../session/lanes.ts";
import type { PendingTurn, SessionApp, SessionRecord } from "../session/record.ts";
import { lintSpecFiles, readSpec } from "../spec/lint.ts";
import { renderFeature } from "../spec/parse.ts";
import { featureFlow, specPath, type FeatureSpec } from "../spec/schema.ts";
import { applyMapEdit, describeEntries, FEATURES_DIR, isMapRequest, mapAsSpec, mapChanges, mergedEntryChanges, nameOf, wasMapped, placeMapped, readFeatureMap, renderMapOutline, type FeatureMap, type MapEdit, type MapEntry } from "../features/index.ts";
import { arrange, arrangedSpec, arrangementProblem, markRemoved, placed, subtreeOf, type FeatureArrangement, type FeatureLayout, type KnownFeature } from "../spec/layout.ts";
import { missingEnv, renderEnvironment, type EnvVar } from "../env/env.ts";
import { Archiver, MainWriter, Mutex } from "./capabilities.ts";
import { featureMemoryPath, lessonPath, memoryDocs, renderFeatureMemory, renderLesson, renderRecall, MEMORY_DIR } from "../memory/memory.ts";
import { applyGuidanceEdit, projectGuidance, renderGuidance, withGuidance, type EditResult, type GuidanceEdit } from "../guidance/guidance.ts";
import { featureMapProblems, gardenFeatureMap, mineRules, type Correction } from "../gardener/gardener.ts";
import { projectRuleProblems, renderRule, rulePath } from "../checks/project-rules.ts";
import { failuresOf, newFailuresOnly, type MainFailures } from "../checks/baseline.ts";
import { matchesScope } from "../util/glob.ts";
import { hashHex } from "../util/hash.ts";
import type { ExternalRemote } from "../ports/external-git.ts";
import { ExternalSync, type ExternalSyncOptions } from "../sync/external.ts";
import { quietSetup, type SetupProgress } from "../setup/progress.ts";
import type { SpendGate } from "../usage/budget.ts";
import { entryPath, structureGuidance, usesChefTemplate } from "../structure/structure.ts";

export interface Deps {
  readonly repos: RepoHost;
  readonly coder: Coder;
  readonly classifier: Classifier;
  readonly planner: Planner;
  readonly reviewer: Reviewer;
  readonly apps: AppHost;
  readonly checks: CheckRunner;
  readonly proofs: ProofRunner;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly store: KeyValueStore;
  readonly memory: MemoryIndex;
  readonly spend?: SpendGate;
  readonly background?: (work: () => Promise<void>) => void;
}

export type Generators = Readonly<Record<string, (tree: Tree) => string>>;

export interface Specialization {
  readonly lockTests: boolean;
  readonly attempts: number;
  readonly stub: ((feature: FeatureSpec) => FileChanges) | null;
  readonly parallelRoles: boolean;
  readonly testsAlongside: boolean;
  readonly laneLayout: LaneLayoutFor | null;
}

export const DEFAULT_SPECIALIZATION: Specialization = { lockTests: true, attempts: 1, stub: null, parallelRoles: true, testsAlongside: false, laneLayout: null };

export interface ProjectConfig {
  readonly name: string;
  readonly author: Author;
  readonly profiles: Profiles;
  readonly generated: Generators;
  readonly specialization?: Partial<Specialization>;
  readonly budget?: Budget;
  readonly router?: RouterConfig;
  readonly tokenTtlSeconds?: number;
  readonly appLink?: (sessionId: string) => string;
  readonly environment?: () => Promise<readonly EnvVar[]>;
  readonly instructions?: () => Promise<string>;
  readonly merge?: () => Promise<MergeMode>;
  readonly steps?: () => Promise<Steps>;
}

export interface Steps {
  readonly plan: boolean;
  readonly tests: boolean;
  readonly review: boolean;
}

export const ALL_STEPS: Steps = { plan: true, tests: true, review: true };

export const MERGE_MODES = ["auto", "manual"] as const;

export type MergeMode = (typeof MERGE_MODES)[number];

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
}

interface PendingVerify {
  readonly commitId: string;
  readonly mainBefore: string;
  readonly sessionId: string;
  readonly at: number;
}

export class ControlError extends Error {}

const LAYOUT_KEY = "layout/features";
const VERIFY_PREFIX = "verify/";
const CHAT_KEY = "chat/turns";
const VOICE_CHAT_CHARS = 8_000;

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

export interface HistoryEntry {
  readonly id: string;
  readonly parents: readonly string[];
  readonly message: string;
  readonly author: string;
  readonly timestamp: number;
  readonly note: { readonly feature: string; readonly session: string; readonly role: string; readonly kind: string; readonly prompt: string } | null;
}

export interface MainHistory {
  readonly head: string | null;
  readonly commits: readonly HistoryEntry[];
  readonly more: boolean;
}

export interface SessionHistory {
  readonly branch: string;
  readonly from: string | null;
  readonly head: string | null;
  readonly merged: string | null;
  readonly upstream: { readonly session: string; readonly feature: string; readonly branch: string } | null;
  readonly into: string | null;
  readonly commits: readonly HistoryEntry[];
}

export interface CommitChanges {
  readonly commit: HistoryEntry;
  readonly files: SessionChanges["files"];
}

export class Orchestrator {
  readonly canonical: string;
  private readonly router: Router;
  private readonly main: MainWriter;
  private readonly archiver: Archiver;
  private readonly mergeQueue = new Mutex();
  private readonly verifyQueue = new Mutex();
  private readonly verifying = new Map<string, Promise<void>>();
  private readonly pickQueue = new Mutex();
  private readonly specialization: Specialization;
  private readonly budget: Budget;
  private readonly ttl: number;
  private readonly resolvers: Readonly<Record<string, Resolver>>;
  private readonly unsubscribe: () => void;
  private readonly running = new Set<string>();
  private readonly syncAfterRun = new Set<string>();
  private readonly mainFailures = new Map<string, Promise<MainFailures>>();

  constructor(
    private readonly deps: Deps,
    private readonly config: ProjectConfig,
  ) {
    this.canonical = config.name;
    this.router = new Router({ classifier: deps.classifier, planner: deps.planner }, config.router ?? DEFAULT_ROUTER_CONFIG);
    this.ttl = config.tokenTtlSeconds ?? 900;
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

  async bootstrap(template: Tree, progress: SetupProgress = quietSetup): Promise<string> {
    progress.step("Create the project's git repository");
    await this.deps.repos.createRepo(this.canonical, { defaultBranch: "main" });
    progress.log(`Created repository ${this.canonical} with branch main`);
    const token = await this.deps.repos.createToken(this.canonical, "write", this.ttl);
    try {
      progress.step("Copy Chef's starter app");
      const tree = this.regenerate(template);
      const paths = Object.keys(tree).sort();
      for (const path of paths.slice(0, SETUP_LOG_FILES)) progress.log(`+ ${path}`);
      if (paths.length > SETUP_LOG_FILES) progress.log(`+ ${paths.length - SETUP_LOG_FILES} more files`);
      progress.step("Save the first commit");
      const commit = await this.deps.repos.commit(token, { ref: "main", parent: null, changes: tree, message: "Create project from chef template", author: this.config.author });
      progress.log(`Committed ${paths.length} files to main as ${commit.id.slice(0, 7)}`);
      progress.step("Index the project memory");
      const indexed = await this.syncMemory();
      progress.log(indexed === 1 ? "Indexed 1 document" : `Indexed ${indexed} documents`);
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

  async submit(prompt: string, options: { readonly attempts?: number; readonly by?: string | null; readonly spoken?: boolean } = {}): Promise<SubmitResult> {
    const by = options.by ?? null;
    const spoken = options.spoken === true;
    return this.deps.spend ? this.deps.spend.scope(by, () => this.submitAs(prompt, options.attempts, by, spoken)) : this.submitAs(prompt, options.attempts, by, spoken);
  }

  private async submitAs(prompt: string, attemptsWanted: number | undefined, by: string | null, spoken: boolean): Promise<SubmitResult> {
    if (isMapRequest(prompt)) return this.mapRequest(prompt);
    const { tree } = await this.mainTree();
    const spec = arrangedSpec(readSpec(tree), await this.layout());
    const map = readFeatureMap(tree);
    const routing = [...spec, ...mapAsSpec(map, new Set(spec.map((f) => f.id)))];
    const outline = map.features.length ? renderMapOutline(map) : "";
    const chat = renderConversation(await this.chatMemory());
    const decision = await this.router.route(prompt, routing);
    await this.emit({ type: "route.decided", prompt, decision, ...(spoken ? { spoken: true } : {}) });
    if (decision.intent === "question") {
      const answer = await this.answer(prompt);
      await this.emit({ type: "question.answered", prompt, answer: answer.text, sources: answer.sources });
      await this.remember(prompt, answer.text);
      return { decision, sessionId: null, sessionIds: [], answer };
    }
    let started: { readonly result: SubmitResult; readonly reply: string };
    try {
      started = await this.start(prompt, decision, { routing, spec, outline, chat }, attemptsWanted, by);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.emit({ type: "route.failed", prompt, error: reason });
      await this.remember(prompt, `I could not start this, so nothing is being built for it: ${reason}. Send it again to retry.`);
      throw error;
    }
    await this.remember(prompt, started.reply);
    return started.result;
  }

  private async start(prompt: string, decision: RouteDecision, context: { readonly routing: readonly FeatureSpec[]; readonly spec: readonly FeatureSpec[]; readonly outline: string; readonly chat: string }, attemptsWanted: number | undefined, by: string | null): Promise<{ readonly result: SubmitResult; readonly reply: string }> {
    const { routing, spec, outline, chat } = context;
    const chore = decision.intent === "chore";
    const hotfix = decision.hotfix === true;
    const known = new Set(routing.map((f) => f.id));
    const building = (await this.sessions()).filter((s) => !isTerminal(s.machine.state) && !known.has(s.featureId)).map((s) => s.plan.feature);
    const withBuilding = [...routing, ...building.filter((f, i) => building.findIndex((g) => g.id === f.id) === i)];
    const planned = chore || (await this.steps()).plan;
    const parts = planned && !chore ? await this.router.split(prompt, withBuilding, decision, chat, outline) : null;
    const plans = parts ? uniqueIds(await Promise.all(parts.map((part) => this.planPart(part, decision, spec, withBuilding, parts.length > 1 ? part.prompt : prompt, chat, outline)))) : [chore ? await this.planChore(prompt, spec) : await this.planFeature(prompt, decision, spec, null, chat, outline)];
    const attempts = chore || hotfix ? 1 : Math.max(1, Math.floor(attemptsWanted ?? this.specialization.attempts));
    const created: string[] = [];
    for (const [at, plan] of plans.entries()) {
      const part = parts?.[at];
      const ask = parts && parts.length > 1 && part ? part.prompt : null;
      const own = part ? partDecision(decision, part, plan.feature.id) : decision;
      created.push(...(await this.createSessions(prompt, own, plan, attempts, { chore, hotfix, ask, by })));
    }
    const first = plans[0]?.feature.id;
    const reply = `${chore ? "Started a chore" : plans.length > 1 ? "Split it into features" : decision.intent === "change_feature" ? "Changing the feature" : "Started the feature"}: ${plans.map((p) => `${p.feature.title} (${p.feature.id})`).join(", ")}`;
    return { reply, result: { decision, sessionId: created[0] ?? null, sessionIds: created, ...(first ? { featureId: first } : {}) } };
  }

  async chatMemory(): Promise<ChatMemory> {
    return readChatMemory(await this.deps.store.get(CHAT_KEY));
  }

  private async remember(prompt: string, reply: string): Promise<void> {
    const current = await this.chatMemory();
    const memory: ChatMemory = { ...current, turns: [...current.turns, { prompt, reply, at: this.deps.clock.now() }] };
    const kept = needsCompacting(memory) ? await this.compact(memory) : memory;
    await this.deps.store.put(CHAT_KEY, kept);
    await this.emit({ type: "chat.context", ...chatContext(kept, kept.summarized ?? 0) });
  }

  private async compact(memory: ChatMemory): Promise<ChatMemory> {
    const { older, recent } = splitForCompacting(memory);
    if (older.length === 0) return memory;
    const summary = await (this.deps.planner.compact?.({ summary: memory.summary, turns: older }) ?? Promise.reject(new Error("no compact"))).catch(() => plainSummary(memory.summary, older));
    return { summary, turns: recent, summarized: (memory.summarized ?? 0) + older.length };
  }

  private async planPart(part: SplitPart, decision: RouteDecision, spec: readonly FeatureSpec[], known: readonly FeatureSpec[], prompt: string, chat: string, map = ""): Promise<Plan> {
    if (part.kind === "change") {
      const existing = known.find((f) => f.id === part.featureId);
      const plan = await this.planFeature(prompt, { ...decision, intent: "change_feature", featureId: part.featureId, changeKind: part.changeKind }, spec, null, chat, map);
      return withParent(plan, existing?.parent ?? null);
    }
    const plan = await this.planFeature(prompt, { ...decision, intent: "new_feature", featureId: null, changeKind: null }, spec, part.parent, chat, map);
    return withParent(plan, part.parent);
  }

  private async mapRequest(prompt: string): Promise<SubmitResult> {
    const decision: RouteDecision = { intent: "question", featureId: null, changeKind: null, via: "rules", confidence: 1, reason: "map the project's current features" };
    await this.emit({ type: "route.decided", prompt, decision });
    let text: string;
    try {
      const { added } = await this.mapFeatures();
      text = added.length ? `I explored the code and added ${added.length === 1 ? "1 feature to the feature list with how to reach it" : `${added.length} features to the feature list, each with how to reach it`}:\n${describeEntries(added)}` : "The feature list already has every feature I could find in the code.";
    } catch (error) {
      text = `I could not map the features: ${error instanceof Error ? error.message : String(error)}`;
    }
    const sources = [FEATURES_DIR];
    await this.emit({ type: "question.answered", prompt, answer: text, sources });
    await this.remember(prompt, text);
    return { decision, sessionId: null, sessionIds: [], answer: { text, sources } };
  }

  async featureMap(): Promise<{ readonly commitId: string | null; readonly map: FeatureMap }> {
    const { commitId, tree } = await this.mainTree();
    return { commitId, map: readFeatureMap(tree) };
  }

  async mapFeatures(): Promise<{ readonly added: readonly MapEntry[]; readonly commitId: string | null }> {
    if (!this.deps.planner.mapFeatures) throw new ControlError("the planner in use cannot explore code");
    const { commitId, tree } = await this.mainTree();
    if (!commitId) throw new ControlError("the project has no main branch yet");
    const mapped = await this.deps.planner.mapFeatures({ project: this.config.name, tree, map: renderMapOutline(readFeatureMap(tree), { paths: true }), ...(await this.guidanceField()) });
    const outcome = await this.mergeQueue.run(async () => {
      const main = await this.mainTree();
      if (!main.commitId) throw new ControlError("the project has no main branch yet");
      const placed = placeMapped(readFeatureMap(main.tree), mapped);
      const changes = mapChanges(wasMapped(main.tree) ? placed : { ...placed, start: placed.start ?? "" });
      if (Object.keys(changes).length === 0) return { added: [], commitId: null };
      const message = placed.entries.length === 0 ? "Feature list: how to start the project" : `Feature list: map ${placed.entries.length === 1 ? "1 current feature" : `${placed.entries.length} current features`}`;
      return { added: placed.entries, commitId: await this.commitMain(main.commitId, changes, message), message };
    });
    if (outcome.commitId && "message" in outcome) await this.emit({ type: "features.changed", commitId: outcome.commitId, message: outcome.message, ids: outcome.added.map((e) => e.id) });
    return { added: outcome.added, commitId: outcome.commitId };
  }

  async editFeatureMap(edit: MapEdit): Promise<{ readonly commitId: string | null; readonly id: string | null }> {
    const outcome = await this.mergeQueue.run(async () => {
      const { commitId, tree } = await this.mainTree();
      if (!commitId) throw new ControlError("the project has no main branch yet");
      const result = applyMapEdit(tree, edit);
      if (!result.ok) throw new ControlError(result.error);
      if (Object.keys(result.changes).length === 0) return { commitId, id: result.id, message: "" };
      return { commitId: await this.commitMain(commitId, result.changes, result.message), id: result.id, message: result.message };
    });
    if (outcome.message) await this.emit({ type: "features.changed", commitId: outcome.commitId, message: outcome.message, ids: outcome.id ? [outcome.id] : [] });
    return { commitId: outcome.commitId, id: outcome.id };
  }

  private async commitMain(parent: string, changes: FileChanges, message: string): Promise<string> {
    const token = await this.deps.repos.createToken(this.canonical, "write", this.ttl);
    try {
      return (await this.deps.repos.commit(token, { ref: "main", parent, changes, message, author: this.config.author })).id;
    } finally {
      await this.deps.repos.revokeToken(token);
    }
  }

  private async createSessions(prompt: string, decision: RouteDecision, plan: Plan, attempts: number, options: { readonly chore: boolean; readonly hotfix: boolean; readonly ask: string | null; readonly by: string | null }): Promise<string[]> {
    const { chore, hotfix, ask, by } = options;
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
        app: null,
        firstAppCommit: null,
        verdict: null,
        lastCodeItem: null,
        syncPending: false,
        merge: null,
        attempt: { group, index: index + 1, of: attempts },
        ...(chore ? { kind: "chore" as const } : {}),
        ...(hotfix ? { hotfix: true } : {}),
        ...(ask ? { ask } : {}),
        ...(by ? { requestedBy: by } : {}),
        parent,
        history: [],
        createdAt: now,
        updatedAt: now,
      };
      await this.save(record);
      await this.emit({ type: "session.created", sessionId, featureId: record.featureId, fork: record.fork, reason: decision.reason, attempt: record.attempt, parent, ...(chore ? { kind: "chore" as const } : {}), ...(hotfix ? { hotfix: true } : {}) });
    }
    return ids;
  }

  private async planFeature(prompt: string, decision: RouteDecision, spec: readonly FeatureSpec[], parent: string | null = null, chat = "", map = ""): Promise<Plan> {
    const roles = Object.values(this.config.profiles)
      .filter((p) => p.plannable)
      .map((p) => ({ role: p.role, description: p.description }));
    const intent = decision.intent === "change_feature" ? "change_feature" : "new_feature";
    const request = withoutCommand(prompt);
    const { tree } = await this.mainTree();
    const steps = await this.steps();
    if (!steps.plan) {
      const direct = await this.directPlan(request, decision, spec, tree);
      return steps.tests && this.config.profiles["test"] ? withTestItem(direct, "test", usesChefTemplate(tree)) : direct;
    }
    const result = await this.deps.planner.plan({ prompt: request, intent, changeKind: decision.changeKind, featureId: decision.featureId, ...(parent ? { parent } : {}), ...(chat ? { conversation: chat } : {}), ...(map ? { map } : {}), spec, roles, env: await this.environment(), ...(usesChefTemplate(tree) ? {} : { ownStructure: true }), ...(await this.guidanceField(tree)) });
    const mappedOnly = decision.featureId && !spec.some((f) => f.id === decision.featureId) ? decision.featureId : null;
    const planned = described(mappedOnly ? renamed(result, mappedOnly) : result, request);
    if (!steps.tests) return { ...planned, items: planned.items.filter((i) => i.kind !== "test") };
    return this.config.profiles["test"] ? withTestItem(planned, "test", usesChefTemplate(tree)) : planned;
  }

  private async directPlan(request: string, decision: RouteDecision, spec: readonly FeatureSpec[], tree: Tree): Promise<Plan> {
    const role = this.config.profiles["backend"]?.plannable ? "backend" : (Object.values(this.config.profiles).find((p) => p.plannable)?.role ?? "backend");
    const existing = decision.intent === "change_feature" ? spec.find((f) => f.id === decision.featureId) : undefined;
    if (existing) {
      return { feature: existing, specChanged: false, items: [{ id: `${existing.id}-direct`, featureId: existing.id, kind: decision.changeKind === "bug" ? "fix" : decision.changeKind === "refactor" ? "refactor" : "code", role, prompt: request, acceptance: existing.acceptance.map((c) => c.id) }], model: "chef" };
    }
    const taken = new Set([...spec.map((f) => f.id), ...(await this.sessions()).map((s) => s.featureId)]);
    const named = request.replace(/^\s*(?:make|add|build|create|implement|write|let|allow)\s+(?:(?:an?|the|me|us)\s+)?/i, "");
    const unique = choreId(named || request, new Set([...taken].map((t) => `chore-${t}`))).replace(/^chore-/, "");
    const template = usesChefTemplate(tree);
    const entrypoint = template ? `GET /${unique}` : "/";
    const title = choreTitle(request);
    const feature: FeatureSpec = { id: unique, title, status: "building", entrypoint, revision: 1, shared: [], env: [], acceptance: [{ id: "AC1", text: request.trim().slice(0, 500) || title }], body: request.trim() };
    const prompt = template ? `${request.trim()}\n\nA person opens this feature at ${entrypoint.slice(4)}, so give it a React page with that path in its pages.tsx.` : request.trim();
    return {
      feature,
      specChanged: true,
      items: [
        { id: `${unique}-spec`, featureId: unique, kind: "spec_change", role: "planner", prompt: `Record the spec for ${unique}`, acceptance: ["AC1"] },
        { id: `${unique}-direct`, featureId: unique, kind: "code", role, prompt, acceptance: ["AC1"] },
      ],
      model: "chef",
    };
  }

  private async steps(): Promise<Steps> {
    return this.config.steps ? this.config.steps() : ALL_STEPS;
  }

  private async planChore(prompt: string, spec: readonly FeatureSpec[]): Promise<Plan> {
    if (!this.config.profiles["chore"]) throw new ControlError("this project has no chore role, so add one on the Agents page");
    const taken = new Set([...spec.map((f) => f.id), ...(await this.sessions()).map((s) => s.featureId)]);
    const text = withoutCommand(prompt);
    return chorePlan(choreId(text, taken), text, "chore");
  }

  async route(prompt: string): Promise<RouteDecision> {
    const { tree } = await this.mainTree();
    return this.router.route(prompt, arrangedSpec(readSpec(tree), await this.layout()));
  }

  async submitSpoken(prompt: string, call: { readonly voiceSessionId: string; readonly delegationId: string; readonly by?: string | null }): Promise<SubmitResult> {
    const result = await this.submit(prompt, { by: call.by ?? null, spoken: true });
    await this.emit({ type: "voice.request", voiceSessionId: call.voiceSessionId, delegationId: call.delegationId, prompt, intent: result.decision.intent, sessionId: result.sessionId, featureId: result.featureId ?? result.decision.featureId });
    return result;
  }

  async voiceContext(): Promise<string> {
    const chat = renderConversation(await this.chatMemory());
    const builds = buildsDoc(await this.sessions());
    return [chat ? `Your chat with the person so far:\n${chat.length > VOICE_CHAT_CHARS ? `…${chat.slice(-VOICE_CHAT_CHARS)}` : chat}` : "", builds?.text ?? ""].filter(Boolean).join("\n\n");
  }

  async recordSpoken(turn: { readonly voiceSessionId: string; readonly speaker: "you" | "chef"; readonly text: string; readonly startedAt: number }): Promise<void> {
    await this.emit({ type: "voice.turn", voiceSessionId: turn.voiceSessionId, speaker: turn.speaker, text: turn.text.slice(0, 4000), startedAt: turn.startedAt });
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

  async newVersion(id: string, prompt: string | null = null, by: string | null = null): Promise<SessionRecord> {
    const source = await this.session(id);
    if (isTerminal(source.machine.state)) throw new ControlError(`session ${id} is ${source.machine.state}, so ask for a change instead`);
    if (source.kind === "chore") throw new ControlError("a chore has no versions");
    const live = await this.versionsOf(source);
    const ask = prompt?.trim() || null;
    const [created] = await this.createSessions(ask ?? source.rootPrompt, source.decision, source.plan, 1, { chore: false, hotfix: false, ask, by });
    const record = await this.session(created as string);
    if (source.version === undefined) {
      source.version = 1;
      await this.save(source);
    }
    record.version = Math.max(1, ...live.map((s) => s.version ?? 1)) + 1;
    await this.save(record);
    await this.emit({ type: "session.versioned", sessionId: record.id, featureId: record.featureId, from: source.id, version: record.version });
    if (ask) await this.steer(record.id, ask);
    return record;
  }

  private async versionsOf(record: SessionRecord): Promise<SessionRecord[]> {
    return (await this.sessions()).filter((s) => s.featureId === record.featureId && (s.id === record.id || s.version !== undefined) && !isTerminal(s.machine.state));
  }

  private async rivalsOf(record: SessionRecord): Promise<SessionRecord[]> {
    if (record.version === undefined) return [];
    return (await this.versionsOf(record)).filter((s) => s.id !== record.id && s.version !== undefined);
  }

  async approveMerge(id: string): Promise<SessionRecord> {
    const record = await this.session(id);
    if (record.machine.state !== "gating" || !record.ready || record.ready.approved) throw new ControlError(`session ${id} is not waiting to be merged`);
    record.ready = { ...record.ready, approved: true };
    await this.emit({ type: "session.ready", sessionId: id, featureId: record.featureId, commitId: null });
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

  async layout(): Promise<FeatureLayout> {
    return (await this.deps.store.get<FeatureLayout>(LAYOUT_KEY)) ?? {};
  }

  async arrange(featureId: string, change: FeatureArrangement): Promise<FeatureLayout> {
    const layout = await this.layout();
    const problem = arrangementProblem(featureId, change, await this.knownFeatures(layout));
    if (problem) throw new ControlError(problem);
    const next = arrange(layout, featureId, change);
    await this.deps.store.put(LAYOUT_KEY, next);
    const place = placed({ id: featureId, title: "", parent: null }, next);
    await this.emit({ type: "feature.arranged", featureId, title: next[featureId]?.title ?? null, parent: place.parent });
    return next;
  }

  async removeFeature(featureId: string): Promise<{ readonly featureIds: readonly string[]; readonly commitId: string | null; readonly reverted: boolean }> {
    const layout = await this.layout();
    const known = await this.knownFeatures(layout);
    if (!known.some((f) => f.id === featureId)) throw new ControlError(`unknown feature ${featureId}`);
    const featureIds = subtreeOf(featureId, known);
    for (const record of await this.sessions()) if (featureIds.includes(record.featureId) && !isTerminal(record.machine.state)) await this.drop(record.id, "the feature was deleted");
    const outcome = await this.mergeQueue.run(async () => {
      const head = await this.deps.repos.resolveRef(this.canonical, "main");
      if (!head) return { commitId: null, reverted: false };
      const tree = (await this.commitOf(this.canonical, head)).tree;
      const mapped = readFeatureMap(tree).features.filter((f) => featureIds.includes(f.name)).map((f) => `${FEATURES_DIR}/${f.id}/`);
      const slices = usesChefTemplate(tree);
      const doomed = Object.keys(tree).filter((path) => featureIds.some((id) => path === specPath(id) || (slices && path.startsWith(`features/${id}/`))) || mapped.some((dir) => path.startsWith(dir)));
      if (doomed.length === 0) return { commitId: null, reverted: false };
      const removed = this.regenerate(applyChanges(tree, Object.fromEntries(doomed.map((path) => [path, null]))));
      const changes = diffTrees(tree, slices ? applyChanges(removed, gardenFeatureMap(removed)) : removed);
      const token = await this.deps.repos.createToken(this.canonical, "write", this.ttl);
      try {
        const commit = await this.deps.repos.commit(token, { ref: "main", parent: head, changes, message: `Remove ${featureIds.join(", ")}`, author: this.config.author });
        const verified = await this.verifyMain(commit.id, head);
        if (verified.ok) return { commitId: commit.id, reverted: false };
        await this.revertLocked(featureId, commit.id, head, verified.log, [`Delete ${featureId}`]);
        return { commitId: commit.id, reverted: true };
      } finally {
        await this.deps.repos.revokeToken(token);
      }
    });
    await this.syncMemory();
    if (outcome.reverted) return { featureIds, ...outcome };
    await this.deps.store.put(LAYOUT_KEY, markRemoved(await this.layout(), featureIds, this.deps.clock.now()));
    await this.emit({ type: "features.removed", featureIds, commitId: outcome.commitId });
    return { featureIds, ...outcome };
  }

  private async knownFeatures(layout: FeatureLayout): Promise<KnownFeature[]> {
    const known = new Map<string, KnownFeature>();
    for (const record of await this.sessions()) known.set(record.featureId, { id: record.featureId, title: record.plan.feature.title, parent: record.plan.feature.parent ?? null });
    const { tree } = await this.mainTree();
    for (const f of readSpec(tree)) known.set(f.id, { id: f.id, title: f.title, parent: f.parent ?? null });
    for (const f of readFeatureMap(tree).features) known.set(f.name, { id: f.name, title: f.title, parent: f.parent ? nameOf(f.parent) : null });
    return [...known.values()].filter((f) => layout[f.id]?.removedAt === undefined).map((f) => placed(f, layout));
  }

  async turns(id: string, limit = 30): Promise<SessionTurn[]> {
    const record = await this.session(id);
    const ids = record.commits.slice(-limit).reverse();
    return Promise.all(
      ids.map(async (commitId) => {
        const repo = await this.repoOf(record);
        const commit = await this.deps.repos.readCommit(repo, commitId);
        const note = parseNote(await this.deps.repos.readNote(repo, NOTES_NAMESPACE, commitId));
        return { commitId, message: commit?.message ?? "", timestamp: commit?.timestamp ?? null, note: note ? { role: note.role, kind: note.kind, prompt: note.prompt, model: note.model, paths: note.paths } : null };
      }),
    );
  }

  async changes(id: string, maxChars = 100_000): Promise<SessionChanges> {
    const record = await this.session(id);
    const from = record.merge?.mainBefore ?? (record.upstream ? (record.upstreamBase ?? null) : record.baseMain);
    if (!record.head || !from) return { base: from, head: record.head, files: [] };
    const repo = await this.repoOf(record);
    const head = await this.commitOf(repo, record.head);
    const base = await this.commitOf(record.upstream || record.merge?.into ? repo : this.canonical, from);
    const clip = (text: string | undefined) => (text === undefined ? null : text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text);
    const files = changedPaths(diffTrees(base.tree, head.tree)).map((path) => ({ path, before: clip(base.tree[path]), after: clip(head.tree[path]) }));
    return { base: base.id, head: head.id, files };
  }

  async history(limit = 50): Promise<MainHistory> {
    const head = await this.deps.repos.resolveRef(this.canonical, "main");
    if (!head) return { head: null, commits: [], more: false };
    const commits = await this.deps.repos.history(this.canonical, "main", limit + 1);
    return { head, commits: await Promise.all(commits.slice(0, limit).map((c) => this.historyEntry(c))), more: commits.length > limit };
  }

  async commitChanges(id: string, maxChars = 100_000): Promise<CommitChanges | null> {
    return this.changesIn(this.canonical, id, maxChars);
  }

  async sessionHistory(id: string): Promise<SessionHistory> {
    const record = await this.session(id);
    const repo = await this.repoOf(record);
    const commits = (await Promise.all([...record.commits].reverse().map((c) => this.deps.repos.readCommit(repo, c)))).filter((c): c is Commit => c !== null);
    const upstream = record.upstream ? await this.session(record.upstream).catch(() => null) : null;
    return {
      branch: record.fork,
      from: commits.at(-1)?.parents[0] ?? record.upstreamBase ?? record.baseMain,
      head: record.head,
      merged: record.merge?.commitId ?? null,
      upstream: upstream ? { session: upstream.id, feature: upstream.featureId, branch: upstream.fork } : null,
      into: record.merge?.into ?? null,
      commits: await Promise.all(commits.map((c) => this.historyEntry(c, repo))),
    };
  }

  async sessionCommit(id: string, commitId: string, maxChars = 100_000): Promise<CommitChanges | null> {
    const record = await this.session(id);
    if (!record.commits.includes(commitId)) return null;
    return this.changesIn(await this.repoOf(record), commitId, maxChars);
  }

  private async changesIn(repo: string, id: string, maxChars: number): Promise<CommitChanges | null> {
    const commit = await this.deps.repos.readCommit(repo, id);
    if (!commit) return null;
    const parent = commit.parents[0] ? await this.deps.repos.readCommit(repo, commit.parents[0]) : null;
    const before = parent?.tree ?? {};
    const clip = (text: string | undefined) => (text === undefined ? null : text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text);
    const files = changedPaths(diffTrees(before, commit.tree)).map((path) => ({ path, before: clip(before[path]), after: clip(commit.tree[path]) }));
    return { commit: await this.historyEntry(commit, repo), files };
  }

  private async historyEntry(commit: CommitSummary, repo = this.canonical): Promise<HistoryEntry> {
    const note = parseNote(await this.deps.repos.readNote(repo, NOTES_NAMESPACE, commit.id).catch(() => null));
    return { id: commit.id, parents: commit.parents, message: commit.message, author: commit.author.name, timestamp: commit.timestamp, note: note ? { feature: note.feature, session: note.session, role: note.role, kind: note.kind, prompt: note.prompt } : null };
  }

  async drain(maxRounds = 200): Promise<SessionRecord[]> {
    for (let round = 0; round < maxRounds; round++) {
      const active = (await this.sessions()).filter(runnable);
      if (active.length === 0) {
        if (this.deps.background || (await this.pendingVerifies()).length === 0) break;
        await this.verifyMerges();
        continue;
      }
      await Promise.all(active.map((s) => this.step(s.id)));
    }
    return this.sessions();
  }

  async run(id: string, maxSteps = 100): Promise<SessionRecord> {
    for (let i = 0; i < maxSteps; i++) {
      const record = await this.session(id);
      if (isTerminal(record.machine.state)) {
        if (this.deps.background || (await this.pendingVerifies()).length === 0) return record;
        await this.verifyMerges();
        continue;
      }
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
      if (await this.waitForBudget(record)) return await this.save(record);
      try {
        await this.settleApp(record);
        if (record.head && record.machine.state !== "queued") await this.adoptForkHead(record);
        if (record.syncPending && record.head && record.machine.state !== "queued" && !record.upstream) {
          record.syncPending = false;
          const synced = await this.syncFromMain(record);
          if (synced === "conflict") return await this.save(record);
        }
        if (record.upstream && record.head && record.machine.state !== "queued" && (await this.followUpstream(record)) === "conflict") return await this.save(record);
        await (this.deps.spend ? this.deps.spend.scope(record.requestedBy ?? null, () => this.advance(record)) : this.advance(record));
        if (await this.deps.store.get<number | null>(`retry/${id}`)) await this.deps.store.put(`retry/${id}`, null);
      } catch (error) {
        if (error instanceof TurnRunning) return await this.save(record);
        const retries = (await this.deps.store.get<number | null>(`retry/${id}`)) ?? 0;
        if (transient(error) && retries < TRANSIENT_RETRIES) {
          await this.deps.store.put(`retry/${id}`, retries + 1);
          return;
        }
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
    const found = await this.upstreamOf(record);
    if (found === "wait") return;
    const upstream = found ? await this.branchFrom(found, record) : null;
    if (!upstream) await this.deps.repos.fork(this.canonical, record.fork);
    record.head = await this.deps.repos.resolveRef(record.fork, "main");
    record.baseMain = upstream ? upstream.baseMain : record.head;
    record.upstream = upstream?.id ?? null;
    record.upstreamBase = upstream ? record.head : null;
    await this.apply(record, { type: "start" });
  }

  private async branchFrom(upstream: SessionRecord, record: SessionRecord): Promise<SessionRecord | null> {
    try {
      await this.deps.repos.fork(upstream.fork, record.fork);
      return upstream;
    } catch (error) {
      if (isTerminal((await this.session(upstream.id)).machine.state)) return null;
      throw error;
    }
  }

  private async upstreamOf(record: SessionRecord): Promise<SessionRecord | "wait" | null> {
    const parent = record.plan.feature.parent;
    if (!parent || parent === record.featureId || record.kind === "chore") return null;
    const open = (await this.sessions()).filter((s) => s.featureId === parent && s.id !== record.id && !isTerminal(s.machine.state));
    if (open.length !== 1) return null;
    const [only] = open as [SessionRecord];
    return only.head ? only : "wait";
  }

  private async activeUpstream(record: SessionRecord): Promise<SessionRecord | "dropped" | "stuck" | null> {
    let id = record.upstream ?? null;
    for (let depth = 0; id && depth < 20; depth++) {
      const upstream = await this.session(id).catch(() => null);
      if (!upstream) return null;
      if (upstream.machine.state === "dropped") return "dropped";
      if (upstream.machine.state === "stuck") return "stuck";
      if (upstream.machine.state !== "merged") return upstream;
      id = upstream.merge?.into ?? null;
    }
    return null;
  }

  private async followUpstream(record: SessionRecord): Promise<"synced" | "up-to-date" | "conflict"> {
    const upstream = await this.activeUpstream(record);
    if (upstream === "dropped" || upstream === "stuck") return "up-to-date";
    if (upstream === null) {
      record.upstream = null;
      record.upstreamBase = null;
      return this.syncFromMain(record);
    }
    if (upstream.id !== record.upstream) {
      record.upstream = upstream.id;
      record.upstreamBase = null;
    }
    return this.syncFromUpstream(record, upstream);
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
    const rest = record.plan.items.slice(record.cursor);
    const withTests = rest.some((i) => i.kind === "test");
    const alongside = withTests && this.specialization.parallelRoles && this.specialization.testsAlongside && record.kind !== "chore" && rest.some((i) => BUILD_KINDS.includes(i.kind));
    await this.apply(record, { type: "planned", withTests: withTests && !alongside });
  }

  private async testing(record: SessionRecord): Promise<void> {
    const item = this.nextItem(record, ["test"]) ?? (record.machine.reason === "review_rejected" || record.machine.reason === "tests_disputed" ? (record.plan.items.find((i) => i.kind === "test") ?? null) : null);
    if (!item) return this.apply(record, { type: "tests_committed" });
    const outcome = await this.coderTurn(record, item, record.machine.feedback);
    if (outcome === "rejected") return;
    record.cursor = record.plan.items.indexOf(item) + 1;
    await this.apply(record, { type: "tests_committed" });
  }

  private async coding(record: SessionRecord): Promise<void> {
    if (await this.waitForParentFeature(record)) return;
    const conflict = record.machine.reason === "conflict";
    if (!conflict && (await this.laneRound(record))) return;
    let item = this.nextItem(record, BUILD_KINDS);
    if (!item && record.lastCodeItem) item = record.plan.items.find((i) => i.id === record.lastCodeItem) ?? null;
    if (!item) item = record.plan.items.find((i) => BUILD_KINDS.includes(i.kind)) ?? null;
    if (!item) return this.apply(record, { type: "fail", reason: "plan has no code work item" });
    const fixer = record.kind !== "chore" && this.config.profiles["conflict-resolver"] ? "conflict-resolver" : item.role;
    const turnItem: WorkItem = conflict ? { ...item, id: `${item.id}-conflict`, kind: "conflict", role: fixer } : item;
    const turn = await this.startTurn(record, turnItem, record.machine.feedback);
    const outcome = await this.finishTurn(record, turnItem, turn);
    if (outcome === "rejected") return;
    record.lastCodeItem = item.id;
    const index = record.plan.items.indexOf(item);
    if (index >= record.cursor) record.cursor = index + 1;
    if (this.nextItem(record, BUILD_KINDS) || lanesBusy(record.lanes)) return;
    await this.coded(record, outcome === "empty" ? [said(item.role, turn.result.summary)] : []);
  }

  private async waitForParentFeature(record: SessionRecord): Promise<boolean> {
    const parent = record.plan.feature.parent;
    const upstream = parent && record.upstream ? await this.activeUpstream(record) : null;
    const live = upstream && typeof upstream !== "string" ? upstream : null;
    const tree = live ? (await this.commitOf(record.fork, record.head)).tree : null;
    const waiting = live !== null && tree !== null && (usesChefTemplate(tree) ? !tree[`features/${parent}/index.ts`] : !live.lastCodeItem);
    const by = waiting ? (live?.id ?? null) : null;
    if ((record.heldBy ?? null) === by) return by !== null;
    record.heldBy = by;
    await this.emit({ type: "session.held", sessionId: record.id, featureId: record.featureId, by });
    return by !== null;
  }

  private async laneRound(record: SessionRecord): Promise<boolean> {
    const leftover = (record.lanes ?? []).filter((lane) => lane.unmerged);
    if (leftover.length) {
      await this.mergeLanes(record, leftover);
      if (record.machine.state === "coding" && record.machine.reason !== "conflict" && !lanesBusy(record.lanes)) await this.coded(record);
      return true;
    }
    if (!record.lanes) {
      if (!this.specialization.parallelRoles || record.kind === "chore") return false;
      const rest = record.plan.items.slice(record.cursor);
      const kinds = this.specialization.testsAlongside ? LANE_KINDS : BUILD_KINDS;
      const lanes = planLanes(rest, kinds);
      const last = rest.filter((i) => kinds.includes(i.kind)).at(-1);
      if (lanes.length < 2 || !last) return false;
      record.cursor = record.plan.items.indexOf(last) + 1;
      record.lastCodeItem = last.id;
      record.lanes = await this.layLanes(record, lanes);
      await this.emit({ type: "lanes.started", sessionId: record.id, featureId: record.featureId, lanes: record.lanes.map((l) => ({ role: l.role, branch: l.branch, items: l.items.length })) });
    } else if (!lanesBusy(record.lanes)) {
      const builders = record.lanes.filter((lane) => !lane.items.every((id) => record.plan.items.find((i) => i.id === id)?.kind === "test"));
      const named = lanesNamedIn(record.machine.feedback ?? "", builders, record.featureId);
      for (const lane of named.length ? named : builders) lane.rework = true;
    }
    const lanes = record.lanes;
    const active = lanes.filter((lane) => laneItem(lane) !== null);
    const shared = record.machine.feedback;
    const steering = (await this.deps.store.get<string[]>(`steer/${record.id}`)) ?? [];
    if (steering.length) await this.deps.store.put(`steer/${record.id}`, []);
    for (const lane of active) await this.resetLane(record, lane);
    const items = active.map((lane) => record.plan.items.find((i) => i.id === laneItem(lane)) as WorkItem);
    const started = await Promise.allSettled(active.map((lane, i) => this.startTurn(record, items[i] as WorkItem, lane.feedback ?? shared, { lane, steering })));
    const committed: Lane[] = [];
    const unchanged: string[] = [];
    let rejected = false;
    let failure: unknown = null;
    for (const [i, lane] of active.entries()) {
      const outcome = started[i] as PromiseSettledResult<StartedTurn>;
      if (outcome.status === "rejected") {
        failure ??= outcome.reason;
        continue;
      }
      let result: "committed" | "empty" | "rejected";
      try {
        result = await this.finishTurn(record, items[i] as WorkItem, outcome.value, lane);
      } catch (error) {
        failure ??= error;
        continue;
      }
      if (result === "rejected") {
        rejected = true;
        continue;
      }
      lane.feedback = null;
      if (lane.done < lane.items.length) lane.done++;
      else lane.rework = false;
      if (result === "committed") {
        lane.unmerged = true;
        committed.push(lane);
      } else {
        unchanged.push(said(lane.role, outcome.value.result.summary));
        await this.laneUpdate(record, lane, "unchanged");
      }
    }
    if (committed.length) await this.mergeLanes(record, committed);
    if (failure) {
      await this.save(record);
      throw failure;
    }
    if (record.machine.state === "coding" && record.machine.reason !== "conflict" && !lanesBusy(lanes)) await this.coded(record, committed.length || rejected ? [] : unchanged);
    return true;
  }

  private async layLanes(record: SessionRecord, lanes: Lane[]): Promise<Lane[]> {
    const layoutFor = this.specialization.laneLayout;
    if (!layoutFor) return lanes;
    const head = await this.commitOf(record.fork, record.head);
    if (!usesChefTemplate(head.tree)) return lanes;
    const feature = readSpec(head.tree).find((f) => f.id === record.featureId) ?? record.plan.feature;
    const layout = layoutFor(feature, lanes.map((l) => l.role).filter((role) => role !== "test"), head.tree);
    if (!layout) return lanes;
    const changes = diffTrees(head.tree, this.regenerate(applyChanges(head.tree, layout.changes)));
    if (Object.keys(changes).length > 0) {
      await this.commitTurn(record, { changes, role: "chef", kind: "scaffold", workItem: null, prompt: `Give each of the ${lanes.map((l) => l.role).join(", ")} roles its own files in ${feature.id}`, model: "chef", runId: this.deps.ids.next("run"), message: `scaffold(${feature.id}): one part per role` });
    }
    return lanes.map((lane) => {
      const part = layout.parts[lane.role] ?? null;
      return { ...lane, part, owns: part ? [part] : [] };
    });
  }

  private async resetLane(record: SessionRecord, lane: Lane): Promise<void> {
    const head = record.head;
    if (!head) return;
    if ((await this.deps.repos.resolveRef(record.fork, lane.branch)) !== head) await this.withToken(record.fork, (token) => this.deps.repos.pushRef(token, { ref: lane.branch, commitId: head, force: true }));
    lane.head = head;
  }

  private async mergeLanes(record: SessionRecord, lanes: readonly Lane[]): Promise<void> {
    const conflicts = new Set<string>();
    await this.withToken(record.fork, async (token) => {
      for (const lane of lanes) {
        const outcome = await this.deps.repos.merge(token, { into: "main", from: { repo: record.fork, ref: lane.branch }, message: `Merge ${lane.role} into ${record.featureId}`, author: this.config.author, resolvers: this.resolvers, onConflict: "commit-markers" });
        if (outcome.status === "conflict") throw new Error(`merge of ${lane.branch} into ${record.fork} failed on ${outcome.paths.join(", ")}`);
        if (outcome.status === "up-to-date") {
          lane.unmerged = false;
          continue;
        }
        record.head = outcome.commitId;
        const paths = outcome.status === "conflicted" ? outcome.paths : [];
        if (outcome.status !== "fast-forward") {
          record.commits.push(outcome.commitId);
          await this.deps.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: outcome.commitId, note: renderNote(this.note(record, { role: "sync", kind: "merge", workItem: null, prompt: `Merge ${lane.branch}`, runId: this.deps.ids.next("run"), model: "chef-sync", paths })) });
        }
        lane.unmerged = false;
        for (const path of paths) conflicts.add(path);
        await this.laneUpdate(record, lane, paths.length ? "conflict" : "merged", outcome.commitId, paths);
      }
    });
    await this.runApp(record);
    if (conflicts.size > 0 && record.machine.state === "coding") await this.apply(record, { type: "conflict", paths: [...conflicts].sort(), between: (record.lanes ?? []).map((l) => l.role) });
  }

  private async laneUpdate(record: SessionRecord, lane: Lane, status: LaneStatus, commitId?: string, paths: readonly string[] = []): Promise<void> {
    await this.emit({ type: "lane.updated", sessionId: record.id, featureId: record.featureId, role: lane.role, branch: lane.branch, status, ...(commitId ? { commitId } : {}), ...(paths.length ? { paths } : {}) });
  }

  private async coded(record: SessionRecord, unchanged: readonly string[] = []): Promise<void> {
    if (unchanged.length && record.machine.reason === "gate_failed" && this.specialization.lockTests && record.plan.items.some((i) => i.kind === "test")) return this.apply(record, { type: "tests_disputed", said: unchanged });
    const tested = record.kind !== "chore" && record.plan.items.some((i) => i.kind === "test");
    const [starts, failed] = await Promise.all([this.appStarts(record), tested ? this.quickChecks(record) : Promise.resolve([])]);
    if (!starts) return;
    if (failed.length) {
      await this.emit({ type: "gate.result", sessionId: record.id, featureId: record.featureId, ok: false, checks: record.checked?.results ?? failed });
      return this.apply(record, { type: "gate_failed", log: formatChecks(failed) });
    }
    await this.apply(record, { type: "coded" });
  }

  private async quickChecks(record: SessionRecord): Promise<CheckResult[]> {
    const head = await this.commitOf(record.fork, record.head);
    const results = await this.forkChecks(record, head);
    record.checked = { commitId: head.id, results };
    return results.filter((c) => !c.ok);
  }

  private async forkChecks(record: SessionRecord, head: Commit): Promise<CheckResult[]> {
    const features = await this.changedFeatures(record, head);
    const results = await this.deps.checks.run({ repo: record.fork, commitId: head.id, tree: head.tree, ...(features ? { features } : {}) });
    return this.newFailures(results, record.baseMain);
  }

  private async changedFeatures(record: SessionRecord, head: Commit): Promise<string[] | null> {
    if (record.kind === "chore" || !usesChefTemplate(head.tree) || !record.baseMain) return null;
    const base = await this.commitOf(this.canonical, record.baseMain);
    const paths = changedPaths(diffTrees(base.tree, head.tree)).filter((p) => !p.startsWith("spec/") && !p.startsWith(".chef/") && !p.endsWith(".md") && !(p in this.config.generated));
    const features = new Set<string>();
    for (const path of paths) {
      const feature = /^features\/([^/]+)\//.exec(path)?.[1];
      if (!feature) return null;
      features.add(feature);
    }
    return features.size > 0 ? [...features].sort() : null;
  }

  private async appStarts(record: SessionRecord): Promise<boolean> {
    const app = await this.appAtHead(record);
    if (app?.status !== "failed" || app.commitId !== record.head) return true;
    await this.apply(record, { type: "app_failed", log: app.error ?? "the app did not start" });
    return false;
  }

  private async appAtHead(record: SessionRecord): Promise<SessionApp | null> {
    await this.settleApp(record);
    if (record.head && (record.app?.commitId !== record.head || record.app.status === "starting")) await this.runApp(record, true);
    return record.app;
  }

  private async reviewing(record: SessionRecord): Promise<void> {
    if (!(await this.appStarts(record))) return;
    const head = await this.commitOf(record.fork, record.head);
    if (!(await this.steps()).review) {
      record.verdict = { approve: true, reasons: ["Review is off for this project."], model: "chef", skipped: true, commitId: head.id };
      return this.apply(record, { type: "review_approved" });
    }
    const base = await this.commitOf(this.canonical, record.baseMain);
    await this.emit({ type: "agent.started", sessionId: record.id, featureId: record.featureId, role: "reviewer", kind: "review", model: this.deps.reviewer.model ?? "reviewer" });
    const diff = diffTrees(base.tree, head.tree);
    const scope = this.reviewScope(record, head.tree);
    const verdict = await this.deps.reviewer.review({ feature: record.plan.feature, diff, ...(record.kind === "chore" ? { chore: true } : { existing: unchangedIn(head.tree, diff, scope), ...(record.plan.items.some((i) => i.kind === "test") ? {} : { untested: true }) }), checksLog: record.machine.feedback ?? "", scope, ...(usesChefTemplate(head.tree) ? {} : { ownStructure: true }), ...(await this.guidanceField(head.tree)) });
    record.verdict = { ...verdict, commitId: head.id };
    await this.emit({ type: "review.verdict", sessionId: record.id, featureId: record.featureId, approve: verdict.approve, reasons: verdict.reasons, model: verdict.model, head: head.id, base: base.id });
    if (verdict.approve) await this.apply(record, { type: "review_approved" });
    else await this.apply(record, { type: "review_rejected", reasons: verdict.reasons, retest: this.specialization.lockTests && verdict.retest === true && record.plan.items.some((i) => i.kind === "test") });
  }

  private reviewScope(record: SessionRecord, tree: Tree): string[] {
    const feature = readSpec(tree).find((f) => f.id === record.featureId) ?? record.plan.feature;
    const roles = new Set(record.plan.items.map((i) => i.role));
    const template = usesChefTemplate(tree);
    const scope = [...roles].flatMap((role) => {
      const profile = this.config.profiles[role];
      return profile ? scopeFor(profile, feature, template) : [];
    });
    return [...new Set(scope.filter((pattern) => !pattern.startsWith("!")))];
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

  async budgetChanged(): Promise<string[]> {
    const resumed: string[] = [];
    for (const record of await this.sessions()) {
      if (isTerminal(record.machine.state) || !record.overBudget) continue;
      if (await this.waitForBudget(record)) continue;
      await this.save(record);
      resumed.push(record.id);
    }
    return resumed;
  }

  async blocked(by: string | null): Promise<string | null> {
    return this.deps.spend ? this.deps.spend.blocked(by) : null;
  }

  private async waitForBudget(record: SessionRecord): Promise<boolean> {
    const reason = this.deps.spend ? await this.deps.spend.blocked(record.requestedBy ?? null) : null;
    if (reason === (record.overBudget ?? null)) return reason !== null;
    record.overBudget = reason;
    await this.emit({ type: "session.budget", sessionId: record.id, featureId: record.featureId, reason });
    return reason !== null;
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

  async guidance(tree?: Tree): Promise<string> {
    const shared = this.config.instructions ? await this.config.instructions() : "";
    const main = (await this.mainTree()).tree;
    return [renderGuidance(shared, projectGuidance(main)), structureGuidance(tree ?? main)].filter(Boolean).join("\n\n");
  }

  private async guidanceField(tree?: Tree): Promise<{ guidance?: string }> {
    const guidance = await this.guidance(tree);
    return guidance ? { guidance } : {};
  }

  async editGuidance(edit: GuidanceEdit): Promise<EditResult & { readonly commitId?: string }> {
    const outcome = await this.mergeQueue.run(async () => {
      const { commitId, tree } = await this.mainTree();
      if (!commitId) return { ok: false as const, status: 409 as const, error: "the project has no main branch yet" };
      const result = applyGuidanceEdit(tree, edit);
      if (!result.ok || Object.keys(result.changes).length === 0) return { ...result, commitId };
      const token = await this.deps.repos.createToken(this.canonical, "write", this.ttl);
      try {
        const commit = await this.deps.repos.commit(token, { ref: "main", parent: commitId, changes: result.changes, message: result.message, author: this.config.author });
        return { ...result, commitId: commit.id };
      } finally {
        await this.deps.repos.revokeToken(token);
      }
    });
    if (outcome.ok && Object.keys(outcome.changes).some((path) => path.startsWith(MEMORY_DIR))) await this.syncMemory();
    return outcome;
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
    const upstream = await this.activeUpstream(record);
    if (upstream === "dropped") return await this.apply(record, { type: "fail", reason: "The build this one branched from was stopped, so its work has nowhere to go. Start it over to build it on main." });
    if (upstream === "stuck") {
      const by = record.upstream ?? null;
      if ((record.heldBy ?? null) !== by) {
        record.heldBy = by;
        await this.emit({ type: "session.held", sessionId: record.id, featureId: record.featureId, by });
      }
      return;
    }
    const outcome = upstream ? await this.gateInto(record, upstream) : await this.gate(record);
    if (outcome.requeue) return;
    record.ready = null;
    await this.emit({ type: "gate.result", sessionId: record.id, featureId: record.featureId, ok: outcome.ok, checks: outcome.checks });
    if (record.machine.state !== "gating") return;
    if (outcome.ok) {
      await this.apply(record, { type: "gate_passed" });
      for (const rival of await this.rivalsOf(record)) await this.drop(rival.id, `version ${record.version ?? 1} was merged instead`);
      if (record.merge?.into && upstream) {
        await this.emit({ type: "branch.merged", sessionId: record.id, featureId: record.featureId, into: record.merge.into, intoFeature: upstream.featureId, commitId: record.merge.commitId });
        return;
      }
      await this.emit({ type: "main.merged", sessionId: record.id, featureId: record.featureId, commitId: record.baseMain as string });
    } else {
      await this.apply(record, { type: "gate_failed", log: formatChecks(outcome.checks.filter((c) => !c.ok)) });
    }
  }

  private failingOnMain(commitId: string): Promise<MainFailures> {
    const known = this.mainFailures.get(commitId);
    if (known) return known;
    const found = this.commitOf(this.canonical, commitId).then(async (commit) => failuresOf(await this.deps.checks.run({ repo: this.canonical, commitId, tree: commit.tree })));
    found.catch(() => this.mainFailures.delete(commitId));
    this.mainFailures.set(commitId, found);
    return found;
  }

  private async newFailures(results: readonly CheckResult[], mainCommit: string | null): Promise<CheckResult[]> {
    if (!mainCommit || results.every((r) => r.ok)) return [...results];
    return newFailuresOnly(results, await this.failingOnMain(mainCommit));
  }

  private async gateChecks(record: SessionRecord, head: Commit): Promise<CheckResult[]> {
    const checks: CheckResult[] = record.checked?.commitId === head.id ? [...record.checked.results] : await this.forkChecks(record, head);
    checks.push(await this.scopeCheck(record));
    if (this.specialization.lockTests) checks.push(await this.lockedCheck(record));
    checks.push(await this.verdictCheck(record));
    checks.push(await this.proofCheck(record, head));
    return checks;
  }

  private async mergeMode(): Promise<MergeMode> {
    return this.config.merge ? this.config.merge() : "auto";
  }

  private async heldForHotfix(record: SessionRecord): Promise<boolean> {
    const hotfix = record.hotfix ? null : ((await this.sessions()).find((s) => s.hotfix && s.id !== record.id && !isTerminal(s.machine.state))?.id ?? null);
    if ((record.heldBy ?? null) === hotfix) return hotfix !== null;
    record.heldBy = hotfix;
    await this.emit({ type: "session.held", sessionId: record.id, featureId: record.featureId, by: hotfix });
    return hotfix !== null;
  }

  private async waitForPerson(record: SessionRecord, head: string, checks: CheckResult[]): Promise<GateOutcome> {
    if (record.ready?.commitId === head) return { ok: false, checks, requeue: true };
    record.ready = { commitId: head, checks, approved: false };
    await this.emit({ type: "gate.result", sessionId: record.id, featureId: record.featureId, ok: true, checks });
    await this.emit({ type: "session.ready", sessionId: record.id, featureId: record.featureId, commitId: head });
    return { ok: false, checks, requeue: true };
  }

  private async gateInto(record: SessionRecord, upstream: SessionRecord): Promise<GateOutcome> {
    const synced = await this.syncFromUpstream(record, upstream);
    if (synced === "conflict") return { ok: false, checks: [], requeue: true };
    const head = await this.commitOf(record.fork, record.head);
    const checks = record.ready?.commitId === head.id ? record.ready.checks : await this.gateChecks(record, head);
    if (checks.some((c) => !c.ok)) return { ok: false, checks };
    if (record.ready?.approved !== true && (await this.rivalsOf(record)).length > 0) return this.waitForPerson(record, head.id, checks);
    return this.mergeQueue.run(async () => {
      if (this.running.has(upstream.id)) return { ok: false, checks, requeue: true };
      this.running.add(upstream.id);
      try {
        const parent = await this.session(upstream.id);
        const before = await this.deps.repos.resolveRef(parent.fork, "main");
        if (isTerminal(parent.machine.state) || Object.keys(parent.turns ?? {}).length > 0 || !before || before !== parent.head) {
          record.ready = { commitId: head.id, checks, approved: true };
          return { ok: false, checks, requeue: true };
        }
        if (before !== record.upstreamBase) {
          record.ready = { commitId: head.id, checks, approved: true };
          return { ok: false, checks, requeue: true };
        }
        await this.markMerged(record);
        const outcome = await this.withToken(parent.fork, (token) => this.deps.repos.merge(token, { into: "main", from: { repo: record.fork, ref: "main" }, message: `Merge ${record.featureId} (${record.id}) into ${parent.featureId}`, author: this.config.author, resolvers: this.resolvers, noFastForward: true }));
        if (outcome.status !== "merged") return { ok: false, checks, requeue: true };
        await this.withToken(parent.fork, (token) => this.deps.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: outcome.commitId, note: renderNote(this.note(record, { role: "sync", kind: "merge", workItem: null, prompt: `Merge ${record.featureId} into ${parent.featureId}`, runId: this.deps.ids.next("run"), model: "chef-sync", paths: [] })) }));
        parent.head = outcome.commitId;
        parent.commits.push(outcome.commitId);
        await this.save(parent);
        await this.runApp(parent);
        await this.save(parent);
        record.merge = { commitId: outcome.commitId, mainBefore: before, into: parent.id };
        return { ok: true, checks };
      } finally {
        this.running.delete(upstream.id);
      }
    });
  }

  private async syncFromUpstream(record: SessionRecord, upstream: SessionRecord): Promise<"synced" | "up-to-date" | "conflict"> {
    const head = await this.deps.repos.resolveRef(upstream.fork, "main");
    if (!head || head === record.upstreamBase) return "up-to-date";
    const outcome = await this.withToken(record.fork, (token) =>
      this.deps.repos.merge(token, { into: "main", from: { repo: upstream.fork, ref: "main" }, message: `Merge ${upstream.featureId} into ${record.fork}`, author: this.config.author, resolvers: this.resolvers, onConflict: "commit-markers" }),
    );
    if (outcome.status === "conflict") throw new Error(`merge of ${upstream.fork} into ${record.fork} failed on ${outcome.paths.join(", ")}`);
    record.upstreamBase = head;
    record.baseMain = upstream.baseMain;
    if (outcome.status === "up-to-date") return "up-to-date";
    record.head = outcome.commitId;
    if (outcome.status === "merged" || outcome.status === "conflicted") {
      const paths = outcome.status === "conflicted" ? outcome.paths : [];
      record.commits.push(outcome.commitId);
      await this.withToken(record.fork, (token) => this.deps.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: outcome.commitId, note: renderNote(this.note(record, { role: "sync", kind: "sync", workItem: null, prompt: `Merge ${upstream.featureId} ${head}`, runId: this.deps.ids.next("run"), model: "chef-sync", paths })) }));
    }
    if (outcome.status === "conflicted") {
      await this.emit({ type: "sync.conflict", sessionId: record.id, featureId: record.featureId, paths: outcome.paths, mainCommit: head });
      await this.apply(record, { type: "conflict", paths: outcome.paths });
      return "conflict";
    }
    await this.emit({ type: "sync.merged", sessionId: record.id, featureId: record.featureId, commitId: outcome.commitId, mainCommit: head });
    await this.runApp(record);
    return "synced";
  }

  async gate(record: SessionRecord): Promise<GateOutcome> {
    const synced = await this.syncFromMain(record);
    if (synced === "conflict") return { ok: false, checks: [], requeue: true };
    const head = await this.commitOf(record.fork, record.head);
    const approved = record.ready?.approved === true;
    const checks = approved && record.ready?.commitId === head.id ? record.ready.checks : await this.gateChecks(record, head);
    if (checks.some((c) => !c.ok)) return { ok: false, checks };
    if (!approved && ((await this.mergeMode()) === "manual" || (await this.rivalsOf(record)).length > 0)) return this.waitForPerson(record, head.id, checks);
    const waiting: GateOutcome = { ok: false, checks, requeue: true };
    if (await this.verifyBusy()) {
      record.ready = { commitId: head.id, checks, approved: true };
      return waiting;
    }
    return this.mergeQueue.run(async () => {
      if ((await this.pendingVerifies()).length > 0) {
        record.ready = { commitId: head.id, checks, approved: true };
        return waiting;
      }
      const mainHead = await this.deps.repos.resolveRef(this.canonical, "main");
      if (!mainHead || (mainHead !== record.baseMain && !(await this.apartFromMain(record, head, mainHead)))) {
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
      const pending: PendingVerify = { commitId: outcome.commitId, mainBefore: mainHead, sessionId: record.id, at: this.deps.clock.now() };
      await this.deps.store.put(`${VERIFY_PREFIX}${outcome.commitId}`, pending);
      await this.syncMemory();
      return { ok: true, checks };
    });
  }

  private async apartFromMain(record: SessionRecord, head: Commit, mainHead: string): Promise<boolean> {
    if (!record.baseMain) return false;
    const base = (await this.commitOf(this.canonical, record.baseMain)).tree;
    const main = (await this.commitOf(this.canonical, mainHead)).tree;
    const ours = new Set(Object.keys(diffTrees(base, head.tree)).filter((path) => !(path in this.resolvers)));
    return Object.keys(diffTrees(base, main)).every((path) => path in this.resolvers || !ours.has(path));
  }

  async verifyMerges(): Promise<number> {
    const background = this.deps.background;
    for (const entry of await this.pendingVerifies()) {
      if (this.running.has(entry.sessionId)) continue;
      const work = this.verifyOne(entry);
      if (background) background(() => work);
      else await work;
    }
    return (await this.pendingVerifies()).length;
  }

  private async verifyBusy(): Promise<boolean> {
    for (const entry of await this.pendingVerifies()) if (!this.running.has(entry.sessionId)) await this.verifyOne(entry);
    return (await this.pendingVerifies()).length > 0;
  }

  private verifyOne(entry: PendingVerify): Promise<void> {
    const known = this.verifying.get(entry.commitId);
    if (known) return known;
    const work = this.verifyQueue.run(() => this.verifyMerge(entry)).finally(() => this.verifying.delete(entry.commitId));
    this.verifying.set(entry.commitId, work);
    return work;
  }

  private async pendingVerifies(): Promise<PendingVerify[]> {
    return [...(await this.deps.store.list<PendingVerify | null>(VERIFY_PREFIX)).values()].filter((p): p is PendingVerify => p !== null).sort((a, b) => a.at - b.at);
  }

  private async verifyMerge(entry: PendingVerify): Promise<void> {
    if (!(await this.deps.store.get<PendingVerify | null>(`${VERIFY_PREFIX}${entry.commitId}`))) return;
    const owner = await this.session(entry.sessionId).catch(() => null);
    if (owner?.merge?.commitId === entry.commitId) {
      const verified = await this.verifyMain(entry.commitId, entry.mainBefore);
      if (!verified.ok) await this.revertMerge(entry.commitId, verified.log);
    }
    await this.deps.store.delete(`${VERIFY_PREFIX}${entry.commitId}`);
  }

  private async verifyMain(commitId: string, mainBefore: string): Promise<{ ok: boolean; log: string }> {
    const commit = await this.commitOf(this.canonical, commitId);
    const results = await this.newFailures(await this.deps.checks.run({ repo: this.canonical, commitId, tree: commit.tree }), mainBefore);
    const map = usesChefTemplate(commit.tree) ? featureMapProblems(commit.tree) : [];
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
    const listed = record.kind === "chore" ? {} : mergedEntryChanges(head.tree, arrangedSpec([current ?? record.plan.feature], await this.layout())[0] ?? record.plan.feature);
    if (!current || current.status === "merged") {
      if (Object.keys(listed).length) await this.commitTurn(record, { changes: listed, role: "gardener", kind: "spec_change", workItem: null, prompt: `Mark ${record.featureId} current in the feature list`, model: "chef-gardener", runId: this.deps.ids.next("run"), message: `features: mark ${record.featureId} current` }, undefined, false);
      return;
    }
    const updated: FeatureSpec = { ...current, status: "merged" };
    const tree = applyChanges(head.tree, { [path]: renderFeature(updated) });
    const memoryPath = featureMemoryPath(record.featureId);
    const turns: { role: string; message: string }[] = [];
    for (const commitId of record.commits) {
      const note = parseNote(await this.deps.repos.readNote(record.fork, NOTES_NAMESPACE, commitId));
      const commit = await this.deps.repos.readCommit(record.fork, commitId);
      if (note && commit && note.kind !== "sync" && note.kind !== "merge") turns.push({ role: note.role, message: commit.message });
    }
    const memory = renderFeatureMemory(tree[memoryPath], { feature: updated, sessionId: record.id, parent: record.parent, rootPrompt: record.rootPrompt, attempt: record.attempt, turns, feedback: record.history });
    const corrections = [...(await this.deps.store.list<Correction | null>("corrections/")).entries()].filter(([key, c]) => !key.startsWith("corrections/pending/") && c !== null).map(([, c]) => c as Correction);
    const mined = mineRules(corrections, tree);
    const changes: Record<string, string | null> = { [path]: renderFeature(updated), ...(usesChefTemplate(tree) ? gardenFeatureMap(tree) : {}), ...listed, [memoryPath]: memory };
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
    }, undefined, false);
    await this.emit({ type: "memory.recorded", featureId: record.featureId, path: memoryPath, kind: "feature" });
    for (const { rule, sessions } of mined) await this.emit({ type: "lint.rule.added", sessionId: record.id, featureId: record.featureId, ruleId: rule.id, message: rule.message, sessions, evidence: rule.evidence });
  }

  async forgetMemory(): Promise<number> {
    const paths = Object.keys((await this.deps.store.get<Record<string, string>>("memory-index")) ?? {});
    if (paths.length) await this.deps.memory.remove(paths);
    await this.deps.store.put("memory-index", {});
    return paths.length;
  }

  private async syncMemory(): Promise<number> {
    const { tree } = await this.mainTree();
    const docs = memoryDocs(tree);
    const indexed = (await this.deps.store.get<Record<string, string>>("memory-index")) ?? {};
    const next: Record<string, string> = {};
    const changed = docs.filter((doc) => {
      next[doc.path] = hashHex(`${doc.kind}\n${doc.feature ?? ""}\n${doc.text}`);
      return indexed[doc.path] !== next[doc.path];
    });
    const removed = Object.keys(indexed).filter((path) => !(path in next));
    if (changed.length) await this.deps.memory.upsert(changed);
    if (removed.length) await this.deps.memory.remove(removed);
    await this.deps.store.put("memory-index", next);
    return changed.length;
  }

  private async recall(record: SessionRecord, feature: FeatureSpec, item: WorkItem): Promise<MemoryHit[]> {
    const query = [feature.id, feature.title, ...feature.acceptance.map((c) => c.text), item.prompt].join("\n");
    const hits = await this.deps.memory.query(query, 8, ["lesson", "feature", "note"]);
    const ranked = [...hits].sort((a, b) => Number(b.doc.feature === record.featureId) - Number(a.doc.feature === record.featureId) || b.score - a.score);
    return ranked.slice(0, 3);
  }

  private async answer(question: string): Promise<{ text: string; sources: string[] }> {
    const hits = await this.deps.memory.query(question, 5);
    const sources = hits.map((h) => h.doc.path);
    const builds = buildsDoc(await this.sessions());
    if (this.deps.planner.answer) {
      const map = readFeatureMap((await this.mainTree()).tree);
      const outline = map.features.length || map.start ? renderMapOutline(map, { paths: true }) : "";
      return { text: await this.deps.planner.answer({ question, context: builds ? [...hits, { doc: builds, score: 0 }] : hits, ...(outline ? { map: outline } : {}) }), sources };
    }
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
    for (const commitId of record.commits) {
      const commit = await this.commitOf(record.fork, commitId);
      if (commit.parents.length !== 1) continue;
      const note = parseNote(await this.deps.repos.readNote(record.fork, NOTES_NAMESPACE, commitId));
      if (!note) {
        problems.push(`${commitId.slice(0, 12)} has no ${NOTES_NAMESPACE} note`);
        continue;
      }
      if (SKIPPED_KINDS.has(note.kind)) continue;
      const parent = await this.commitOf(record.fork, commit.parents[0] as string);
      const template = usesChefTemplate(parent.tree);
      const generated = this.generatedPaths(parent.tree);
      const paths = changedPaths(diffTrees(parent.tree, commit.tree)).filter((p) => !generated.has(p));
      const profile = this.config.profiles[note.role];
      if (!profile) {
        problems.push(`${commitId.slice(0, 12)} was written by unknown role ${note.role}`);
        continue;
      }
      const feature = readSpec(commit.tree).find((f) => f.id === record.featureId) ?? record.plan.feature;
      const outside = outOfScope(paths, scopeFor(profile, feature, template));
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
      if (!note || SKIPPED_KINDS.has(note.kind)) continue;
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
    if (verdict.skipped) return { name: "review", ok: true, log: "review is off for this project" };
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
        const merged = this.regenerate(applyChanges(entry.head.tree, extra));
        const tree = usesChefTemplate(merged) ? focusTests(merged, entry.record.featureId) : merged;
        const names = Object.entries(tree).filter(([path]) => path.startsWith(prefix(entry.record)) && path.endsWith(".test.ts")).flatMap(([, content]) => testNames(content));
        const results = await this.deps.checks.run({ repo: entry.record.fork, commitId: `${entry.head.id}+cross`, tree });
        const test = results.find((r) => r.name === "test");
        const score = scoreCases(test, names);
        return { sessionId: entry.record.id, diff: diffTrees(entry.base.tree, entry.head.tree), crossTests: { sessionId: entry.record.id, ...score, log: test?.log ?? "no test check" } };
      }),
    );
  }

  private async proofCheck(record: SessionRecord, head: Commit): Promise<CheckResult> {
    if (record.app?.status !== "running" || record.app.commitId !== head.id) await this.runApp(record, true);
    const app = record.app;
    const template = usesChefTemplate(head.tree);
    if (!template && app?.status === "no-stack") return { name: "proof", ok: true, log: "this branch has no wrangler config or compose file, so it has no running app to prove; the repository's own checks are the proof" };
    if (app?.status !== "running" || !app.local) return { name: "proof", ok: false, log: appTrouble(app) };
    if (!template) return this.answerProof(record, head, app.local);
    if (record.kind === "chore") return this.choreProof(record, head, app.local);
    const flow = featureFlow(readSpec(head.tree).find((f) => f.id === record.featureId) ?? record.plan.feature);
    if (head.tree[`features/${flow}/flow.ts`] === undefined) return this.flowlessProof(record, head, app.local);
    const proof = await this.deps.proofs.prove({ repo: record.fork, feature: record.featureId, flow, url: app.local, commitId: head.id, tree: head.tree });
    await this.withToken(record.fork, (token) => this.deps.repos.addNote(token, { namespace: PROOF_NAMESPACE, commitId: head.id, note: `${JSON.stringify(proof, null, 2)}\n` }));
    const stored = await this.deps.repos.readNote(record.fork, PROOF_NAMESPACE, head.id);
    const merged = await this.proveMerged(record, head, app.local);
    const ok = proof.ok && stored !== null && merged.every((p) => p.ok);
    const own = proof.steps.map((s) => `${s.ok ? "ok" : "FAIL"} ${s.name}: ${s.detail}`).join("\n") || "no proof steps";
    return { name: "proof", ok, log: merged.length ? `${own}\n\nMerged features proved again on this branch:\n${proofLines(merged)}` : own };
  }

  private async proveMerged(record: SessionRecord, head: Commit, url: string): Promise<ProofRecord[]> {
    const live = readSpec(head.tree)
      .filter((f) => f.status === "merged" && f.id !== record.featureId && head.tree[`features/${featureFlow(f)}/flow.ts`] !== undefined)
      .slice(0, MERGED_PROOFS);
    const proofs: ProofRecord[] = [];
    for (const feature of live) proofs.push(await this.deps.proofs.prove({ repo: record.fork, feature: feature.id, flow: featureFlow(feature), url, commitId: head.id, tree: head.tree }));
    return proofs;
  }

  private async answerProof(record: SessionRecord, head: Commit, url: string): Promise<CheckResult> {
    const feature = readSpec(head.tree).find((f) => f.id === record.featureId) ?? record.plan.feature;
    const path = record.kind === "chore" ? "/" : entryPath(feature.entrypoint);
    const probe = this.deps.proofs.probe;
    if (!probe) return { name: "proof", ok: true, log: "this project has its own structure, so there is no Chef flow to drive, and this proof runner cannot open its app; the repository's own checks are the proof" };
    const proof = await probe.call(this.deps.proofs, { repo: record.fork, feature: record.featureId, url, path, commitId: head.id });
    await this.withToken(record.fork, (token) => this.deps.repos.addNote(token, { namespace: PROOF_NAMESPACE, commitId: head.id, note: `${JSON.stringify(proof, null, 2)}\n` }));
    const stored = await this.deps.repos.readNote(record.fork, PROOF_NAMESPACE, head.id);
    const log = proof.steps.map((s) => `${s.ok ? "ok" : "FAIL"} ${s.name}: ${s.detail}`).join("\n") || "no proof steps";
    return { name: "proof", ok: proof.ok && stored !== null, log: `this project has its own structure, so there is no Chef flow to drive; Chef checked that the running app answers at ${path}\n${log}` };
  }

  private async flowlessProof(record: SessionRecord, head: Commit, url: string): Promise<CheckResult> {
    const feature = readSpec(head.tree).find((f) => f.id === record.featureId) ?? record.plan.feature;
    const path = entryPath(feature.entrypoint);
    const probe = this.deps.proofs.probe;
    const own = probe ? await probe.call(this.deps.proofs, { repo: record.fork, feature: record.featureId, url, path, commitId: head.id }) : null;
    const merged = await this.proveMerged(record, head, url);
    await this.withToken(record.fork, (token) => this.deps.repos.addNote(token, { namespace: PROOF_NAMESPACE, commitId: head.id, note: `${JSON.stringify({ feature: record.featureId, url, path, commitId: head.id, ok: (own?.ok ?? true) && merged.every((p) => p.ok), answer: own, proofs: merged }, null, 2)}\n` }));
    const answered = own ? `${own.steps.map((s) => `${s.ok ? "ok" : "FAIL"} ${s.name}: ${s.detail}`).join("\n") || "no proof steps"}` : "this proof runner cannot open the app, so the checks are the proof";
    const log = `${record.featureId} has no flow.ts, since tests are off for this project; Chef checked that the running app answers at ${path}\n${answered}`;
    return { name: "proof", ok: (own?.ok ?? true) && merged.every((p) => p.ok), log: merged.length ? `${log}\n\nMerged features proved again on this branch:\n${proofLines(merged)}` : log };
  }

  private async choreProof(record: SessionRecord, head: Commit, url: string): Promise<CheckResult> {
    const proofs = await this.proveMerged(record, head, url);
    const ok = proofs.every((p) => p.ok);
    await this.withToken(record.fork, (token) => this.deps.repos.addNote(token, { namespace: PROOF_NAMESPACE, commitId: head.id, note: `${JSON.stringify({ chore: record.featureId, url, commitId: head.id, ok, proofs }, null, 2)}\n` }));
    return { name: "proof", ok, log: proofLines(proofs) || "no live features to prove yet" };
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
    for (const commitId of adopted) await this.recoverNote(record.fork, commitId);
    record.head = forkHead;
    record.commits.push(...adopted.filter((id) => !record.commits.includes(id)));
    await this.runApp(record);
  }

  private async recoverNote(fork: string, commitId: string): Promise<void> {
    if (await this.deps.repos.readNote(fork, NOTES_NAMESPACE, commitId)) return;
    const commit = await this.commitOf(fork, commitId);
    const key = pendingNoteKey(fork, commit.parents[0] ?? null);
    const pending = await this.deps.store.get<PendingNote | null>(key);
    if (pending?.message !== commit.message) return;
    await this.withToken(fork, (token) => this.deps.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId, note: pending.note }));
    await this.deps.store.put(key, null);
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
    await this.runApp(record);
    return "synced";
  }

  private async coderTurn(record: SessionRecord, item: WorkItem, feedback: string | null): Promise<"committed" | "empty" | "rejected"> {
    return this.finishTurn(record, item, await this.startTurn(record, item, feedback));
  }

  private async startTurn(record: SessionRecord, item: WorkItem, feedback: string | null, context: { readonly lane?: Lane; readonly steering?: readonly string[] } = {}): Promise<StartedTurn> {
    const { lane } = context;
    const profile = this.config.profiles[item.role];
    if (!profile) throw new Error(`no agent profile for role ${item.role}`);
    const head = await this.commitOf(record.fork, lane?.head ?? record.head);
    const feature = readSpec(head.tree).find((f) => f.id === record.featureId) ?? record.plan.feature;
    const scope = scopeFor(profile, feature, usesChefTemplate(head.tree));
    const tag = lane ? { lane: lane.role } : {};
    const onEvent = (event: CoderEvent) => void this.emit({ type: "coder.event", sessionId: record.id, featureId: record.featureId, event, ...tag });
    const slot = lane?.role ?? MAIN_TURN;
    const pending = record.turns?.[slot];
    let restarts = 0;
    if (pending?.item === item.id && this.deps.coder.resumeTurn) {
      const resumed = await this.resumeTurn(record, slot, pending, onEvent);
      if (resumed) return { head, feature, scope, prompt: resumed.prompt, result: resumed.result };
      restarts = pending.restarts + 1;
    }
    const guidance = await this.guidance(head.tree);
    const agent = customAgent(profile, record.featureId, scope, guidance);
    const readToken = await this.deps.repos.createToken(record.fork, "read", this.ttl);
    const info = await this.deps.repos.info(record.fork);
    const recalled = await this.recall(record, feature, item);
    if (recalled.length) await this.emit({ type: "memory.recalled", sessionId: record.id, featureId: record.featureId, paths: recalled.map((h) => h.doc.path) });
    const steering = context.steering ?? (await this.deps.store.get<string[]>(`steer/${record.id}`)) ?? [];
    if (steering.length && !context.steering) await this.deps.store.put(`steer/${record.id}`, []);
    const notes = steering.length ? `A person added notes for this turn:\n${steering.map((n) => `- ${n}`).join("\n")}` : null;
    const brief = lane && record.lanes ? laneBrief(lane, record.lanes, record.plan.items, record.featureId) : null;
    const prompt = [item.prompt, brief, feedback, notes, renderEnvironment(await this.environment(), feature, usesChefTemplate(head.tree)), renderRecall(recalled)].filter(Boolean).join("\n\n");
    const turnId = this.deps.coder.resumeTurn ? await this.holdTurn(record, slot, { id: this.deps.ids.next("turn"), item: item.id, startedAt: this.deps.clock.now(), restarts }, prompt) : undefined;
    await this.emit({ type: "agent.started", sessionId: record.id, featureId: record.featureId, role: item.role, kind: item.kind, model: profile.model, ...tag });
    if (lane) await this.laneUpdate(record, lane, "working");
    let result;
    try {
      result = await this.deps.coder.runTurn({
        sessionId: record.id,
        featureId: record.featureId,
        role: item.role,
        model: profile.model,
        prompt,
        instructions: withGuidance(profile.instructions.replaceAll("{feature}", record.featureId), guidance),
        writeScope: scope,
        agent,
        attempt: { index: record.attempt.index, of: record.attempt.of },
        ...tag,
        ...(turnId ? { turnId } : {}),
        workspace: { repo: record.fork, remote: info?.remote ?? "", ref: lane?.branch ?? "main", commitId: head.id, readToken: readToken.secret, tree: head.tree },
        onEvent,
      });
    } catch (error) {
      if (!(error instanceof TurnRunning)) this.dropTurn(record, slot);
      throw error;
    } finally {
      await this.deps.repos.revokeToken(readToken);
    }
    this.dropTurn(record, slot);
    return { head, feature, scope, prompt, result };
  }

  private async holdTurn(record: SessionRecord, slot: string, turn: PendingTurn, prompt: string): Promise<string> {
    record.turns = { ...(record.turns ?? {}), [slot]: turn };
    await this.deps.store.put(`turn/${record.id}/${slot}`, { id: turn.id, prompt });
    await this.save(record);
    return turn.id;
  }

  private dropTurn(record: SessionRecord, slot: string): void {
    if (!record.turns?.[slot]) return;
    const { [slot]: _dropped, ...rest } = record.turns;
    record.turns = Object.keys(rest).length ? rest : null;
  }

  private async resumeTurn(record: SessionRecord, slot: string, turn: PendingTurn, onEvent: (event: CoderEvent) => void): Promise<{ readonly result: CoderTurnResult; readonly prompt: string } | null> {
    const resume = this.deps.coder.resumeTurn;
    if (!resume) return null;
    const held = await this.deps.store.get<{ id: string; prompt: string } | null>(`turn/${record.id}/${slot}`);
    const prompt = held?.id === turn.id ? held.prompt : "";
    if (this.deps.clock.now() - turn.startedAt > TURN_LIMIT_MS) {
      this.dropTurn(record, slot);
      throw new Error(`the ${slot === MAIN_TURN ? "coder" : slot} turn ran for over ${TURN_LIMIT_MS / 60_000} minutes without finishing`);
    }
    let result: CoderTurnResult | null;
    try {
      result = await resume.call(this.deps.coder, { turnId: turn.id, sessionId: record.id, ...(slot === MAIN_TURN ? {} : { lane: slot }), onEvent });
    } catch (error) {
      if (!(error instanceof TurnRunning)) this.dropTurn(record, slot);
      throw error;
    }
    this.dropTurn(record, slot);
    if (result) return { result, prompt };
    if (turn.restarts + 1 >= TURN_RESTARTS) throw new Error(`the sandbox stopped ${TURN_RESTARTS} times while this turn was running`);
    onEvent({ type: "session.error", message: "The sandbox stopped while this turn was running, so the turn starts again." });
    return null;
  }

  private async finishTurn(record: SessionRecord, item: WorkItem, turn: StartedTurn, lane?: Lane): Promise<"committed" | "empty" | "rejected"> {
    const { head, feature, scope, prompt, result } = turn;
    record.machine = addTokens(record.machine, result.usage.inputTokens + result.usage.outputTokens);
    await this.deps.spend?.record(record.requestedBy ?? null, result.model, result.usage);
    const generated = this.generatedPaths(head.tree);
    const paths = changedPaths(result.changes).filter((p) => !generated.has(p));
    const outside = outOfScope(paths, scope);
    if (outside.length > 0) return this.reject(record, item.role, "write-scope", outside, scope, undefined, result.changes, [], lane);
    if (lane) {
      const taken = paths.map((path) => [path, laneOwner(record.lanes ?? [], path)] as const).filter(([, owner]) => owner && owner !== lane);
      if (taken.length > 0) return this.reject(record, item.role, "lane-owner", taken.map(([path]) => path), scope, taken.map(([path, owner]) => `- ${path} belongs to ${owner?.role}`).join("\n"), result.changes, [], lane);
    }
    if (this.specialization.lockTests && item.role !== "test") {
      const locked = await this.lockedPaths(record);
      const touched = paths.filter((p) => locked.has(p) && !hasMarkers(head.tree[p]));
      if (touched.length > 0) return this.reject(record, item.role, "locked-tests", touched, scope, undefined, result.changes, [], lane);
    }
    const tree = applyChanges(head.tree, result.changes);
    const linted = projectRuleProblems(tree, paths);
    if (linted.length > 0) return this.reject(record, item.role, "project-lint", [...new Set(linted.map((p) => p.path))], scope, linted.map((p) => `${p.path}:${p.line} ${p.message}`).join("\n"), result.changes, [], lane);
    if (item.kind === "test" && (!record.lastCodeItem || lane)) {
      const red = await this.redCheck(record, head, tree, feature);
      if (red) return this.reject(record, item.role, "red-tests", red.paths, scope, red.detail, result.changes, red.passing, lane);
    }
    const changes = diffTrees(head.tree, this.regenerate(tree));
    if (Object.keys(changes).length === 0) return "empty";
    if (item.kind !== "conflict") await this.recordCorrection(record, item.role, head.tree, changes);
    await this.commitTurn(record, { changes, role: item.role, kind: item.kind, workItem: item.id, prompt, model: result.model, runId: result.runId, message: `${item.kind}(${record.featureId}): ${firstLine(result.summary || item.prompt)}` }, lane);
    if (lane) {
      lane.owns = [...new Set([...(lane.owns ?? []), ...paths.filter((path) => !path.endsWith(".test.ts") && path !== `features/${record.featureId}/index.ts` && laneOwner(record.lanes ?? [], path) === null)])];
      await this.laneUpdate(record, lane, "committed", lane.head ?? undefined);
    }
    return "committed";
  }

  private async reject(record: SessionRecord, role: string, rule: RejectionRule, paths: readonly string[], scope: readonly string[], detail?: string, changes: FileChanges = {}, passing: readonly string[] = [], lane?: Lane): Promise<"rejected"> {
    await this.emit({ type: "turn.rejected", sessionId: record.id, featureId: record.featureId, role, rule, paths, ...(lane ? { lane: lane.role } : {}) });
    await this.deps.store.put(`corrections/pending/${record.id}/${role}`, { signature: rule, before: { ...changes }, passing: [...passing] });
    const before = record.machine;
    await this.apply(record, { type: "turn_rejected", rule, paths, scope, ...(detail ? { detail } : {}) });
    if (lane) {
      lane.feedback = record.machine.feedback;
      if (record.machine.state === "coding") record.machine = { ...record.machine, feedback: before.feedback, reason: before.reason };
      await this.laneUpdate(record, lane, "rejected");
    }
    return "rejected";
  }

  private async redCheck(record: SessionRecord, head: Commit, candidate: Tree, feature: FeatureSpec): Promise<{ paths: string[]; detail: string; passing: string[] } | null> {
    const stub = this.specialization.stub;
    if (!stub || !usesChefTemplate(candidate)) return null;
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

  private async commitTurn(record: SessionRecord, turn: { changes: FileChanges; role: string; kind: TurnNote["kind"]; workItem: string | null; prompt: string; model: string; runId: string; message: string }, lane?: Lane, app = true): Promise<void> {
    await this.withToken(record.fork, async (token) => {
      const parent = lane ? lane.head : record.head;
      const note = renderNote(this.note(record, { ...turn, paths: changedPaths(turn.changes) }));
      const pending = pendingNoteKey(record.fork, parent);
      await this.deps.store.put<PendingNote>(pending, { message: turn.message, note });
      const commit = await this.deps.repos.commit(token, { ref: lane?.branch ?? "main", parent, changes: turn.changes, message: turn.message, author: this.config.author });
      await this.deps.repos.addNote(token, { namespace: NOTES_NAMESPACE, commitId: commit.id, note });
      await this.deps.store.put(pending, null);
      if (lane) lane.head = commit.id;
      else record.head = commit.id;
      record.commits.push(commit.id);
      await this.emit({ type: "commit.created", sessionId: record.id, featureId: record.featureId, repo: record.fork, commitId: commit.id, role: turn.role, message: turn.message, ...(lane ? { lane: lane.role } : {}) });
    });
    if (!lane && app) await this.runApp(record);
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

  private async runApp(record: SessionRecord, wait = false): Promise<void> {
    const commitId = record.head;
    if (!commitId) return;
    const url = record.app?.url ?? null;
    await this.showApp(record, { status: "starting", url, local: null, commitId });
    await this.deps.store.put(`app/${record.id}/wanted`, commitId);
    const background = this.deps.background;
    if (wait || !background) {
      const run = await this.startApp(record.id, record.fork, commitId, url);
      await this.showApp(record, run);
      if (run.status === "running") record.firstAppCommit ??= commitId;
      return;
    }
    const { id, featureId } = record;
    background(async () => {
      const run = await this.startApp(id, record.fork, commitId, url);
      if ((await this.deps.store.get<string | null>(`app/${id}/wanted`)) !== commitId) return;
      await this.deps.store.put(`app/${id}`, run);
      const link = this.config.appLink?.(id);
      await this.emit({ type: "app.updated", sessionId: id, featureId, status: run.status, url: run.url, commitId: run.commitId, ...(run.error ? { error: run.error } : {}), ...(link ? { link } : {}) });
    });
  }

  private async startApp(target: string, repo: string, commitId: string, url: string | null): Promise<AppRun> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.deps.apps.run({ target, repo, ref: "main", commitId });
      } catch (error) {
        if (transient(error) && attempt < APP_TRIES) continue;
        return { status: "failed", url, local: null, commitId, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }

  private async settleApp(record: SessionRecord): Promise<void> {
    if (record.app?.status !== "starting") return;
    const run = await this.deps.store.get<AppRun | null>(`app/${record.id}`);
    if (!run || run.commitId !== record.app.commitId) return;
    const link = this.config.appLink?.(record.id);
    record.app = { ...run, ...(link ? { link } : {}) };
    if (run.status === "running") record.firstAppCommit ??= run.commitId;
  }

  private async showApp(record: SessionRecord, app: Omit<SessionApp, "link">): Promise<void> {
    const link = this.config.appLink?.(record.id);
    record.app = { ...app, ...(link ? { link } : {}) };
    await this.emit({ type: "app.updated", sessionId: record.id, featureId: record.featureId, status: app.status, url: app.url, commitId: app.commitId, ...(app.error ? { error: app.error } : {}), ...(link ? { link } : {}) });
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

  private generatedPaths(tree: Tree): Set<string> {
    return new Set(usesChefTemplate(tree) ? Object.keys(this.config.generated) : []);
  }

  private regenerate(tree: Tree): Tree {
    if (!usesChefTemplate(tree)) return tree;
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
    record.revision = (record.revision ?? 0) + 1;
    if (RETRY_EVENTS.has(event.type) && record.machine.feedback) record.history = [...record.history, record.machine.feedback.slice(0, 400)].slice(-20);
    record.updatedAt = this.deps.clock.now();
    await this.emit({ type: "session.state", sessionId: record.id, featureId: record.featureId, from, to: record.machine.state, reason: record.machine.reason });
    if (record.machine.state === "stuck") await this.emit({ type: "session.stuck", sessionId: record.id, featureId: record.featureId, reason: record.machine.reason });
  }

  private async save(record: SessionRecord): Promise<void> {
    const stored = await this.deps.store.get<SessionRecord>(`session/${record.id}`);
    if (stored && isTerminal(stored.machine.state) && (stored.revision ?? 0) > (record.revision ?? 0)) {
      Object.assign(record, stored);
      return;
    }
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
    await this.deps.coder.release?.(record.id, (record.lanes ?? []).map((l) => l.role)).catch(() => undefined);
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

  private async repoOf(record: SessionRecord, depth = 0): Promise<string> {
    if (!record.forkDeleted) return record.fork;
    const into = record.merge?.into;
    if (!into || depth > 20) return this.canonical;
    const upstream = await this.session(into).catch(() => null);
    return upstream ? this.repoOf(upstream, depth + 1) : this.canonical;
  }

  private async emit(event: DistributiveOmit<ChefEvent, "project" | "at">): Promise<void> {
    await this.deps.bus.publish({ ...event, project: this.config.name, at: this.deps.clock.now() } as ChefEvent);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const RETRY_EVENTS: ReadonlySet<SessionEvent["type"]> = new Set(["review_rejected", "gate_failed", "app_failed", "turn_rejected", "reopened", "conflict"]);

const SKIPPED_KINDS: ReadonlySet<TurnNote["kind"]> = new Set(["sync", "merge", "scaffold"]);

interface StartedTurn {
  readonly head: Commit;
  readonly feature: FeatureSpec;
  readonly scope: readonly string[];
  readonly prompt: string;
  readonly result: Awaited<ReturnType<Coder["runTurn"]>>;
}

const CODER_KINDS: ReadonlySet<TurnNote["kind"]> = new Set(["test", "code", "fix", "refactor", "chore", "conflict"]);

const BUILD_KINDS: readonly WorkItem["kind"][] = ["code", "fix", "refactor", "chore"];
const LANE_KINDS: readonly WorkItem["kind"][] = [...BUILD_KINDS, "test"];

const MERGED_PROOFS = 6;

const SAID_CHARS = 1500;

function said(role: string, summary: string): string {
  const text = summary.trim() || "(no reply)";
  return `${role}: ${text.length > SAID_CHARS ? `${text.slice(0, SAID_CHARS)}…` : text}`;
}

const ADOPT_LIMIT = 20;
const APP_TRIES = 3;

type PendingNote = { readonly message: string; readonly note: string };

function pendingNoteKey(fork: string, parent: string | null): string {
  return `note/${fork}/${parent ?? "root"}`;
}

const SETUP_LOG_FILES = 60;

function withParent(plan: Plan, parent: string | null): Plan {
  const { parent: _drop, ...feature } = plan.feature;
  return { ...plan, feature: parent && parent !== feature.id ? { ...feature, parent } : feature };
}

function uniqueIds(plans: readonly Plan[]): Plan[] {
  const taken = new Set<string>();
  return plans.map((plan) => {
    let id = plan.feature.id;
    for (let n = 2; taken.has(id); n++) id = `${plan.feature.id.slice(0, 36)}-${n}`;
    taken.add(id);
    return renamed(plan, id);
  });
}

function renamed(plan: Plan, id: string): Plan {
  if (id === plan.feature.id) return plan;
  return { ...plan, feature: { ...plan.feature, id }, items: plan.items.map((item) => ({ ...item, id: item.id.replace(plan.feature.id, id), featureId: id })) };
}

function partDecision(decision: RouteDecision, part: SplitPart, featureId: string): RouteDecision {
  return part.kind === "change" ? { ...decision, intent: "change_feature", featureId, changeKind: part.changeKind } : { ...decision, intent: "new_feature", featureId: null, changeKind: null };
}

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

function proofLines(proofs: readonly ProofRecord[]): string {
  return proofs.flatMap((p) => p.steps.map((s) => `${s.ok ? "ok" : "FAIL"} ${p.feature} ${s.name}: ${s.detail}`)).join("\n");
}

function formatChecks(checks: readonly CheckResult[]): string {
  return checks.map((c) => `## ${c.name}: ${c.ok ? "ok" : "FAILED"}\n${c.log}`).join("\n\n");
}

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").slice(0, 72);
}

export function described(plan: Plan, request: string): Plan {
  if (plan.feature.body.trim() || !request.trim()) return plan;
  return { ...plan, feature: { ...plan.feature, body: request.trim() } };
}

export function specProblems(tree: Tree): string[] {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(tree)) if (path.startsWith("spec/features/")) files[path] = content;
  return lintSpecFiles(files).problems.map((p) => `${p.path}: ${p.message}`);
}

const TRANSIENT_RETRIES = 5;
const MAIN_TURN = "main";
const TURN_LIMIT_MS = 90 * 60_000;
const TURN_RESTARTS = 3;

export function transient(error: unknown): boolean {
  if ((error as { retryable?: unknown } | null)?.retryable === true) return true;
  return /reset because its code was updated|network connection lost|durable object .*(reset|overloaded|no longer active)|container service disconnected|sandbox container (stopped|did not start)|HTTP Error: (429|5\d\d)|git clone failed: .*(hung up|early EOF|RPC failed|returned error: (429|5\d\d)|connection reset|timed out)/i.test((error as Error | null)?.message ?? "");
}

export function runnable(record: SessionRecord): boolean {
  return !isTerminal(record.machine.state) && !record.needs?.length && !record.overBudget && !(record.ready && !record.ready.approved);
}

function appTrouble(app: SessionApp | null): string {
  if (app?.status === "no-stack") return "this branch has no wrangler config or compose file (compose.yaml or docker-compose.yml), so Chef cannot start its app to prove the feature";
  if (app?.error) return `the app did not start: ${app.error}`;
  return "the app is not running";
}

function unchangedIn(tree: Tree, diff: FileChanges, scope: readonly string[]): FileChanges {
  return Object.fromEntries(Object.entries(tree).filter(([path]) => !(path in diff) && matchesScope(path, scope)));
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

const BUILDS_SHOWN = 8;

export function buildsDoc(sessions: readonly SessionRecord[]): MemoryDoc | null {
  const recent = sessions.slice(-BUILDS_SHOWN);
  if (!recent.length) return null;
  const lines = recent.map((s) => {
    const why = s.machine.state === "stuck" ? `: ${s.machine.reason}${s.machine.feedback ? `\n  What failed: ${s.machine.feedback.replace(/\s+/g, " ").slice(0, 800)}` : ""}` : "";
    return `- ${s.featureId} (session ${s.id}, asked "${s.rootPrompt.slice(0, 120)}"): ${s.machine.state}${why}`;
  });
  return { path: "builds (current state)", kind: "note", feature: null, text: `Builds, oldest first:\n${lines.join("\n")}` };
}
