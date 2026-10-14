import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ArtifactsRepoHost, type ArtifactsControl } from "@chef/adapters/artifacts";
import { JevClassifier } from "@chef/adapters/jev";
import { llmFromProvider, providerBaseUrl, type LlmEndpoint, type MessagesClient } from "@chef/adapters/anthropic";
import { NO_LLM, type Resolved } from "@chef/adapters/settings";
import { LlmPlanner } from "@chef/adapters/llm-planner";
import { LlmReviewer } from "@chef/adapters/llm-reviewer";
import { AgentSettings, applyAgentConfig, ControlError, mergeAgentConfig, DEFAULT_BUDGET, envNeeds, NO_CLASSIFIER, isTerminal, Orchestrator, PreviewKeeper, readSpec, resolveModel, SetupError, setupResponse, routerConfigOf, runnable, withSkills, type AgentStore, type ExternalSync, type Profiles } from "@chef/core";
import { applyEnvUpdate, envNames, mergeEnv, revealEnv, viewProjectEnv, type EnvCipher, type StoredEnv } from "@chef/adapters/project-env";
import { projectAgentsRequest } from "@chef/adapters/agents";
import { applyProjectUpdate, readProjectSettings, requestsGitHubApp, viewProjectSettings, type ProjectSettings } from "@chef/adapters/project-settings";
import { GitRemote } from "@chef/adapters/external-git";
import { exploreProject, type OverviewState } from "@chef/adapters/project-explorer";
import { laneLayout, renderStub, stubPath } from "@chef/template/gen";
import { generated, repoProfiles, templateTree } from "../world.ts";
import type { Docker } from "./docker.ts";
import { DockerCheckRunner, DockerCoder, DockerPreviewHost, DockerProofRunner } from "./sandbox.ts";
import { FileEventBus, FileMemoryIndex, FileStore, type LogEntry } from "./storage.ts";

const PROJECT_SETTINGS = "project/settings";
const OVERVIEW = "project/overview";
const ENV = "project/env";
const AGENTS = "project/agents/";
const READING_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 5 * 60_000;
const BUSY_SWEEP_MS = 10 * 60_000;

export interface EngineContext {
  readonly dir: string;
  readonly docker: Docker;
  readonly control: ArtifactsControl;
  readonly settings: () => Resolved;
  readonly agents: AgentStore;
  readonly cipher: () => Promise<EnvCipher>;
  readonly sharedEnv: () => Promise<StoredEnv>;
  readonly vars: Readonly<Record<string, string>>;
  readonly log: (line: string) => void;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

function role(profiles: Profiles, name: string) {
  const profile = profiles[name];
  if (!profile) throw new Error(`agents/${name}.md is missing`);
  return profile;
}

export class LocalProject {
  readonly bus: FileEventBus;
  readonly store: FileStore;
  private readonly memory: FileMemoryIndex;
  private built: { orchestrator: Orchestrator; repos: ArtifactsRepoHost; keeper: PreviewKeeper; external: ExternalSync | null; fingerprint: string } | null = null;
  private readonly loops = new Map<string, Promise<void>>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(
    readonly name: string,
    private readonly ctx: EngineContext,
  ) {
    const dir = join(ctx.dir, "projects", name);
    this.bus = new FileEventBus(join(dir, "events.jsonl"));
    this.store = new FileStore(join(dir, "store.jsonl"));
    this.memory = new FileMemoryIndex(join(dir, "memory.json"));
  }

  async open(): Promise<void> {
    const { keeper, orchestrator } = await this.build();
    await keeper.sweep({ busy: false, idleMs: 0 });
    if ((await this.projectSettings()).git) this.startPolling();
    if ((await orchestrator.sessions()).some(runnable)) this.drive();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.built?.orchestrator.dispose();
  }

  watch(watcher: (entry: LogEntry) => void): () => void {
    return this.bus.watch(watcher);
  }

  private async build() {
    const settings = this.ctx.settings();
    const project = await this.projectSettings();
    const shared = await this.ctx.agents.current();
    const own = await this.ownAgents().current();
    const agents = { config: mergeAgentConfig(shared.config, own.config) };
    const fingerprint = JSON.stringify([settings, project.git, project.attempts, shared.version, own.version]);
    if (this.built?.fingerprint === fingerprint) return this.built;
    this.built?.orchestrator.dispose();
    const { docker, control, vars } = this.ctx;
    const repos = new ArtifactsRepoHost(control);
    const llm = settings.llm ? llmFromProvider(settings.llm) : missingLlm;
    const clock = { now: () => Date.now() };
    const host = new DockerPreviewHost(docker, this.name, async () => revealEnv(await this.effectiveEnv(), await this.ctx.cipher()));
    const profiles = applyAgentConfig(repoProfiles(), agents.config);
    const reviewerRole = role(profiles, "reviewer");
    const plannerRole = role(profiles, "planner");
    const keeper = new PreviewKeeper(host, host, { repos, store: this.store, clock, canonical: this.name, onActivity: () => void this.scheduleSweep() });
    const orchestrator = new Orchestrator(
      {
        repos,
        coder: new DockerCoder(docker, { model: settings.models.coder, llm: settings.llm ? { baseUrl: providerBaseUrl(settings.llm), apiKey: settings.llm.apiKey } : null }),
        classifier: settings.jev ? JevClassifier.fromEnv({ apiKey: settings.jev.apiKey, defaultModel: vars["JEV_MODEL"] as string }) : NO_CLASSIFIER,
        planner: new LlmPlanner(llm, resolveModel(plannerRole.model, settings.models), withSkills(plannerRole.instructions, plannerRole.skills)),
        reviewer: new LlmReviewer(llm, resolveModel(reviewerRole.model, settings.models), withSkills(reviewerRole.instructions, reviewerRole.skills)),
        previews: keeper,
        checks: new DockerCheckRunner(docker, repos),
        proofs: new DockerProofRunner(docker, repos, host),
        bus: this.bus,
        clock,
        ids: { next: (prefix) => `${prefix}${randomUUID().slice(0, 8)}` },
        store: this.store,
        memory: this.memory,
      },
      {
        name: this.name,
        author: { name: "chef", email: "ma.karimi76@gmail.com" },
        profiles,
        router: routerConfigOf(agents.config.router),
        generated,
        specialization: { attempts: project.attempts ?? settings.attempts, stub: (feature) => ({ [stubPath(feature.id)]: renderStub(feature.id, feature.title) }), laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) },
        previewLink: (key) => `/preview/${this.name}/${key}`,
        environment: async () => envNames(await this.effectiveEnv()),
      },
    );
    const git = project.git;
    const external = git ? orchestrator.external(new GitRemote({ url: git.url, branch: git.branch, token: git.token }, control), { mode: git.mode, syncBranch: git.syncBranch }) : null;
    this.built = { orchestrator, repos, keeper, external, fingerprint };
    return this.built;
  }

  async bootstrap(request: Request): Promise<Response> {
    const { orchestrator, external } = await this.build();
    return setupResponse(request, async (progress) => {
      const existing = (await orchestrator.mainTree()).commitId;
      if (existing) return { commitId: existing, created: false };
      if (external) {
        const pulled = await external.pull(progress);
        if (pulled.status !== "imported") throw new SetupError(`importing the linked repository did not finish: ${pulled.status}`, 409);
        this.startPolling();
        await this.startReading();
        return { commitId: pulled.commitId, created: true, imported: true };
      }
      return { commitId: await orchestrator.bootstrap(templateTree(), progress), created: true };
    });
  }

  async request(request: Request, action: string): Promise<Response> {
    const url = new URL(request.url);
    const { orchestrator, external } = await this.build();
    const settings = this.ctx.settings();
    const session = /^sessions\/([a-z0-9-]{1,40})(?:\/([a-z]+))?$/.exec(action);
    if (session) return this.sessionRequest(request, session[1] as string, session[2] ?? null);
    if (action === "settings") return this.settingsRequest(request);
    if (action === "env") return this.envRequest(request);
    if (action === "agents" || action === "agents/restore") return projectAgentsRequest(request, { project: this.name, store: this.ownAgents(), shared: this.ctx.agents, defaults: repoProfiles(), models: settings.models, jev: settings.jev !== null });
    if (action === "bootstrap" && request.method === "POST") return this.bootstrap(request);
    if (action === "git" && request.method === "GET") return json({ settings: viewProjectSettings(await this.projectSettings()).git, state: external ? await external.state() : null });
    if (action === "git/sync" && request.method === "POST") {
      if (!external) return json({ error: "this project has no linked repository" }, 409);
      await external.retry();
      void this.syncExternal();
      return json({ ok: true }, 202);
    }
    if (action === "spec" && request.method === "GET") {
      const main = await orchestrator.mainTree();
      return json({ commitId: main.commitId, features: readSpec(main.tree) });
    }
    if (action === "overview" && request.method === "GET") return json(await this.overview());
    if (action === "overview" && request.method === "POST") {
      if ((await this.overview()).status !== "reading") await this.startReading();
      return json(await this.overview(), 202);
    }
    if (action === "prompts" && request.method === "POST") {
      const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string };
      if (!prompt?.trim()) return json({ error: "prompt is required" }, 400);
      if (!settings.llm) return json({ error: NO_LLM }, 409);
      return json(await this.submit(prompt.trim()), 202);
    }
    if (action === "route" && request.method === "POST") {
      const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string };
      if (!prompt?.trim()) return json({ error: "prompt is required" }, 400);
      return json(await orchestrator.route(prompt.trim()));
    }
    if (action === "sessions" && request.method === "GET") return json(await orchestrator.sessions());
    if (action === "cursor" && request.method === "GET") return json({ seq: await this.bus.cursor() });
    if (action === "events" && request.method === "GET") return json(await this.bus.since(Number(url.searchParams.get("after") ?? 0)));
    return json({ error: "not found" }, 404);
  }

  async submit(prompt: string) {
    const { orchestrator } = await this.build();
    const result = await orchestrator.submit(prompt);
    if (result.sessionId) this.drive();
    return result;
  }

  private async sessionRequest(request: Request, id: string, action: string | null): Promise<Response> {
    const { orchestrator } = await this.build();
    const body = async () => (request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, string | undefined>) : {});
    try {
      if (request.method === "GET" && action === null) return json({ record: await orchestrator.session(id), budget: DEFAULT_BUDGET });
      if (request.method === "GET" && action === "turns") return json(await orchestrator.turns(id));
      if (request.method === "GET" && action === "changes") return json(await orchestrator.changes(id));
      if (request.method === "GET" && action === "sandbox") return json({ running: this.ctx.docker.runningWith(`chef-coder-${id}`), exit: null });
      if (request.method === "POST" && action === "drop") return json({ state: (await orchestrator.drop(id, (await body())["reason"]?.trim() || undefined)).machine.state }, 202);
      if (request.method === "POST" && action === "retry") {
        const record = await orchestrator.retry(id, (await body())["guidance"] ?? "");
        this.drive();
        return json({ state: record.machine.state }, 202);
      }
      if (request.method === "POST" && action === "steer") {
        const message = (await body())["message"]?.trim();
        if (!message) return json({ error: "message is required" }, 400);
        await orchestrator.steer(id, message);
        return json({ ok: true }, 202);
      }
    } catch (error) {
      if (error instanceof ControlError) return json({ error: error.message }, 409);
      if (error instanceof Error && error.message.startsWith("unknown session")) return json({ error: error.message }, 404);
      throw error;
    }
    return json({ error: "not found" }, 404);
  }

  async preview(key: string, retry: boolean): Promise<{ status: "ready"; url: string } | { status: "building" | "missing" } | { status: "failed"; error: string }> {
    const { keeper } = await this.build();
    let visit = await keeper.visit(key);
    if (visit.status === "failed" && retry) visit = { status: "rebuild" };
    if (visit.status === "ready") return { status: "ready", url: visit.url };
    if (visit.status === "rebuild") {
      await keeper.startRebuild(key);
      void keeper.rebuild(key).catch((error: unknown) => this.ctx.log(`rebuilding preview ${key} failed: ${String(error)}`));
      return { status: "building" };
    }
    if (visit.status === "failed") return { status: "failed", error: visit.error };
    return { status: visit.status === "missing" ? "missing" : "building" };
  }

  async projectSettings(): Promise<ProjectSettings> {
    return readProjectSettings(await this.store.get<Partial<ProjectSettings>>(PROJECT_SETTINGS));
  }

  private async settingsRequest(request: Request): Promise<Response> {
    const stored = await this.store.get<Partial<ProjectSettings>>(PROJECT_SETTINGS);
    if (request.method === "GET") return json(viewProjectSettings(readProjectSettings(stored)));
    if (request.method !== "PUT") return json({ error: "method not allowed" }, 405);
    const body: unknown = await request.json().catch(() => null);
    if (requestsGitHubApp(body)) return json({ error: "Connect GitHub needs chef in Cloudflare. On this computer, link the repository with its address and an access token." }, 409);
    const result = applyProjectUpdate(stored, body, () => `${randomUUID()}${randomUUID()}`.replaceAll("-", ""), null);
    if (!result.ok) return json({ error: result.error }, 400);
    await this.store.put(PROJECT_SETTINGS, result.settings);
    await this.scheduleSweep();
    const saved = readProjectSettings(result.settings);
    if (saved.git) {
      this.startPolling();
      void this.syncExternal();
    } else this.stopPolling();
    return json(viewProjectSettings(saved));
  }

  private async storedEnv(): Promise<StoredEnv> {
    return (await this.store.get<StoredEnv>(ENV)) ?? {};
  }

  private ownAgents(): AgentSettings {
    return new AgentSettings(this.store, Date.now, AGENTS);
  }

  private async effectiveEnv(): Promise<StoredEnv> {
    return mergeEnv(await this.ctx.sharedEnv(), await this.storedEnv());
  }

  async sharedEnvironmentChanged(): Promise<void> {
    const { orchestrator, keeper } = await this.build();
    const resumed = await orchestrator.environmentChanged();
    if (resumed.length > 0) this.drive();
    const busy = (await orchestrator.sessions()).some((s) => runnable(s) && !resumed.includes(s.id));
    await keeper.sweep({ busy, idleMs: 0 });
  }

  private async envRequest(request: Request): Promise<Response> {
    const stored = await this.storedEnv();
    if (request.method === "GET") return json(await this.envView(stored));
    if (request.method !== "PUT") return json({ error: "method not allowed" }, 405);
    const result = await applyEnvUpdate(stored, await request.json().catch(() => null), await this.ctx.cipher(), Date.now());
    if (!result.ok) return json({ error: result.error }, 400);
    await this.store.put(ENV, result.env);
    const { orchestrator, keeper } = await this.build();
    const resumed = await orchestrator.environmentChanged();
    if (resumed.length > 0) this.drive();
    const busy = (await orchestrator.sessions()).some((s) => runnable(s) && !resumed.includes(s.id));
    await keeper.sweep({ busy, idleMs: 0 });
    return json(await this.envView(result.env));
  }

  private async envView(stored: StoredEnv) {
    const { orchestrator } = await this.build();
    const features = [...readSpec((await orchestrator.mainTree()).tree), ...(await orchestrator.sessions()).filter((s) => !isTerminal(s.machine.state)).map((s) => s.plan.feature)];
    const shared = await this.ctx.sharedEnv();
    return viewProjectEnv(stored, shared, await this.ctx.cipher(), envNeeds(features, envNames(mergeEnv(shared, stored))));
  }

  private async scheduleSweep(delayMs?: number): Promise<void> {
    if (this.closed) return;
    const { previewIdleMinutes } = await this.projectSettings();
    if (this.sweepTimer) clearTimeout(this.sweepTimer);
    this.sweepTimer = setTimeout(() => void this.sweep(), delayMs ?? previewIdleMinutes * 60_000);
    this.sweepTimer.unref();
  }

  private async sweep(): Promise<void> {
    const { keeper, orchestrator } = await this.build();
    const { previewIdleMinutes } = await this.projectSettings();
    const idleMs = previewIdleMinutes * 60_000;
    const busy = (await orchestrator.sessions()).some((s) => !isTerminal(s.machine.state));
    const outcome = await keeper.sweep({ busy, idleMs });
    if (outcome.status === "busy") await this.scheduleSweep(BUSY_SWEEP_MS);
    if (outcome.status === "awake") await this.scheduleSweep(Math.max(60_000, idleMs - outcome.idleForMs));
  }

  private startPolling(): void {
    if (this.pollTimer || this.closed) return;
    this.pollTimer = setInterval(() => void this.syncExternal(), POLL_MS);
    this.pollTimer.unref();
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async syncExternal(): Promise<void> {
    const { external } = await this.build();
    if (!external) return;
    try {
      const pulled = await external.pull();
      if (pulled.status === "merged" || pulled.status === "resolved") this.drive();
    } catch (error) {
      this.ctx.log(`pulling ${this.name}'s linked repository failed: ${String(error)}`);
    }
    await this.pushExternal();
  }

  private async pushExternal(): Promise<void> {
    const { external } = await this.build();
    if (!external) return;
    try {
      await external.push();
    } catch (error) {
      this.ctx.log(`pushing ${this.name} to its linked repository failed: ${String(error)}`);
    }
  }

  private async overview(): Promise<OverviewState> {
    const state = (await this.store.get<OverviewState>(OVERVIEW)) ?? { status: "none" };
    if (state.status === "reading" && Date.now() - state.since > READING_TIMEOUT_MS) return { status: "failed", at: Date.now(), error: "reading the code took too long; try again" };
    return state;
  }

  private async startReading(): Promise<void> {
    await this.store.put<OverviewState>(OVERVIEW, { status: "reading", since: Date.now() });
    void this.readProject();
  }

  private async readProject(): Promise<void> {
    const { orchestrator } = await this.build();
    const settings = this.ctx.settings();
    let state: OverviewState;
    try {
      if (!settings.llm) throw new Error(NO_LLM);
      const main = await orchestrator.mainTree();
      const overview = await exploreProject(llmFromProvider(settings.llm), { name: this.name, tree: main.tree, model: settings.models.planner });
      state = { status: "ready", commitId: main.commitId, at: Date.now(), overview };
    } catch (error) {
      state = { status: "failed", at: Date.now(), error: error instanceof Error ? error.message : String(error) };
    }
    await this.store.put<OverviewState>(OVERVIEW, state);
  }

  drive(): void {
    if (this.closed) return;
    void (async () => {
      const { orchestrator } = await this.build();
      await orchestrator.reclaim();
      for (const session of await orchestrator.sessions()) if (runnable(session) && !this.loops.has(session.id)) this.loops.set(session.id, this.loop(session.id));
    })().catch((error: unknown) => this.ctx.log(`driving ${this.name} failed: ${describe(error)}`));
  }

  private async loop(id: string): Promise<void> {
    try {
      while (!this.closed) {
        const { orchestrator } = await this.build();
        const before = JSON.stringify((await orchestrator.session(id)).machine);
        await orchestrator.step(id);
        await this.pushExternal();
        const record = await orchestrator.session(id);
        if (isTerminal(record.machine.state)) {
          await orchestrator.reclaim();
          break;
        }
        if (!runnable(record)) break;
        if (JSON.stringify(record.machine) === before) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      this.ctx.log(`session ${id} in ${this.name} stopped: ${describe(error)}`);
    } finally {
      this.loops.delete(id);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

const missingLlm: LlmEndpoint = {
  client: new Proxy({} as MessagesClient, {
    get() {
      throw new Error(NO_LLM);
    },
  }),
  via: "anthropic",
  serverFallbacks: false,
};
