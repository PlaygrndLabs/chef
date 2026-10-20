import { Agent, type Connection, type ConnectionContext, type WSMessage } from "agents";
import { ArtifactsRepoHost, bindingControl, type ArtifactsBindingLike } from "@chef/adapters/artifacts";
import { JevClassifier } from "@chef/adapters/jev";
import { llmFromProvider, meteredFetch, providerBaseUrl, type LlmEndpoint, type MessagesClient } from "@chef/adapters/anthropic";
import { currentSpender, EngineSpend, nextMonth, requester } from "./usage.ts";
import { NO_CLOUDFLARE, NO_LLM, type Resolved } from "@chef/adapters/settings";
import { LlmPlanner } from "@chef/adapters/llm-planner";
import { LlmReviewer } from "@chef/adapters/llm-reviewer";
import { WorkersAiReviewer, type TextGenerator } from "@chef/adapters/workers-ai-reviewer";
import { VectorizeIndex, type EmbedderLike, type VectorizeLike } from "@chef/adapters/vectorize";
import { GptLiveHost, type Connect, type SocketLike } from "@chef/adapters/gpt-live";
import { RealtimeHost, voiceUsage } from "@chef/adapters/realtime";
import { addCost, NO_COST, type SessionCost, type SpendPart, APP_START_SECONDS, AgentSettings, readCap, applyAgentConfig, FEATURE_ROUTE, featureRequest, FEATURE_MAP_ROUTE, featureMapRequest, readFeatureMap, HISTORY_ROUTE, historyResponse, SESSION_HISTORY_ROUTE, sessionHistoryResponse, type AppStatus, ControlError, DEFAULT_BUDGET, DEFAULT_STORED_AGENTS, mergeAgentConfig, envNeeds, NO_CLASSIFIER, isTerminal, loadProfiles, Orchestrator, resolveModel, routerConfigOf, withSkills, type Profiles, readSpec, caughtUp, SetupError, setupResponse, replayFrom, runnable, SessionPump, startVoiceCall, type ExternalSync, type PushedEvent, agentsOf, cloudflareView, engineOf, type CloudflareView, type SandboxFacts, type Tree, type SpokenTurn, type VoiceCall, type ChefEvent } from "@chef/core";
import { applyEnvUpdate, envNames, mergeEnv, revealEnv, viewProjectEnv, type EnvCipher, type StoredEnv } from "@chef/adapters/project-env";
import { projectAgentsRequest } from "@chef/adapters/agents";
import { instructionsRequest, memoryRequest, type GuidanceHost } from "@chef/adapters/guidance";
import { applyProjectUpdate, readProjectSettings, requestsGitHubApp, viewProjectSettings, withLinkBranch, type ProjectSettings } from "@chef/adapters/project-settings";
import { gitHubRepo, GitRemote, remoteBranch } from "@chef/adapters/external-git";
import { exploreProject, withChefSuggestions, type OverviewState } from "@chef/adapters/project-explorer";
import { activityNote } from "@chef/adapters/projects";
import { laneLayout, renderRegistry, renderStub, stubPath } from "@chef/template/gen";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { DurableStore } from "./do-store.ts";
import { agentFiles, templateFiles } from "./embedded.gen.ts";
import { DurableEventBus } from "./event-bus.ts";
import { SandboxCheckRunner, SandboxProofRunner } from "./sandbox-checks.ts";
import { appBranch, SandboxAppHost } from "./app-host.ts";
import { AppRouter, appName, routerName, RouterTakenError } from "./app-router.ts";
import { SandboxCoder } from "./sandbox-coder.ts";
import { appPath, appResponse, type AppAnswer } from "@chef/adapters/app-page";
import { appEntry, newAppKey, OWNER_COOKIE_SECONDS, SHARE_COOKIE_SECONDS } from "@chef/adapters/app-gate";
import { appScope, sessionScope, SHARE_HEADER, type ShareKind } from "./shares.ts";
import { homeOrigin, ORIGIN_HEADER } from "./access.ts";
import { publicOrigin } from "./github-pages.ts";
import { gitHubApp } from "./github.ts";
import { agentStore, currentSettings, envCipher, settingsStub } from "./settings.ts";
import { removeTranscripts } from "./transcripts.ts";
import { validSignature } from "./webhook.ts";
import type { AppState, SandboxRestart, SandboxStatus } from "./session-agent.ts";
import { containerAppName, EngineIdCache } from "./cloudflare-ids.ts";

const SESSION_ROUTE = /^\/api\/projects\/[a-z][a-z0-9-]{1,30}\/sessions\/([a-z0-9-]{1,40})(?:\/([a-z]+))?$/;
const APP_ROUTE = /^\/app\/[a-z][a-z0-9-]{1,30}\/([a-z0-9-]{1,40})\/?$/;
const PROJECT_SETTINGS = "project/settings";
const ORIGIN = "project/origin";
const OVERVIEW = "project/overview";
const FRESH = "project/fresh";
const ENV = "project/env";
const AGENTS = "project/agents/";
const MAIN_APP = "project/main-app";
const SANDBOX_STEP = "project/sandbox-size";
const APP_KEY = "project/app-key";
const ADDRESS = "project/address/";
const REMOVING = "project/removing";
const COST = "project/cost/";

export interface MainAppState {
  readonly status: AppStatus;
  readonly commitId: string;
  readonly url: string | null;
  readonly error?: string;
  readonly at: number;
}
const READING_TIMEOUT_MS = 10 * 60_000;
const POLL_SECONDS = 300;
const MAIN_WAIT_SECONDS = 120;
const STARTING_STALE_MS = (APP_START_SECONDS + 300) * 1000;
const NOTE_REPEAT_MS = 10 * 60_000;

const generated = { "src/registry.gen.ts": (tree: Tree) => renderRegistry(Object.keys(tree)) };

function role(profiles: Profiles, name: string) {
  const profile = profiles[name];
  if (!profile) throw new Error(`agents/${name}.md is missing`);
  return profile;
}

export class ProjectAgent extends Agent<Env> {
  private readonly pump = new SessionPump((work) => this.keepAliveWhile(work));
  private readonly calls = new Map<string, Promise<VoiceCall | null>>();
  private built: { orchestrator: Orchestrator; bus: DurableEventBus; repos: ArtifactsRepoHost; apps: SandboxAppHost; router: AppRouter | null; external: ExternalSync | null; settings: Resolved; fingerprint: string } | null = null;
  private cipher: EnvCipher | null = null;
  private readonly engineIds = new EngineIdCache();
  private runningMain = false;
  private mainAgain = false;
  private readonly waking = new Set<string>();
  private lastNote: { readonly note: string; readonly at: number } | null = null;

  private async build() {
    const settings = await currentSettings(this.env);
    const project = await this.projectSettings();
    const origin = (await this.ctx.storage.get<string>(ORIGIN)) ?? null;
    const app = project.git?.installation !== undefined ? await gitHubApp(this.env) : null;
    const shared = await agentStore(this.env)
      .current()
      .catch(() => DEFAULT_STORED_AGENTS);
    const own = await this.agentSettings().current();
    const agents = { config: mergeAgentConfig(shared.config, own.config) };
    const fingerprint = JSON.stringify([settings, project.git, project.attempts, origin, app?.identity ?? null, shared.version, own.version]);
    if (this.built?.fingerprint === fingerprint) return this.built;
    this.built?.orchestrator.dispose();
    const env = this.env;
    const control = bindingControl(env.ARTIFACTS as unknown as ArtifactsBindingLike);
    const repos = new ArtifactsRepoHost(control);
    const bus = new DurableEventBus(this.ctx.storage, (message) => this.broadcast(message, [...this.calls.keys()]));
    const spend = new EngineSpend(env, this.name, (session, part, micros) => this.addCost(session, part, micros));
    const llm = settings.llm ? llmFromProvider(settings.llm, meteredFetch((model, usage) => spend.record(currentSpender(), model, usage))) : missingLlm;
    const profiles = applyAgentConfig(loadProfiles(agentFiles), agents.config);
    const reviewerRole = role(profiles, "reviewer");
    const plannerRole = role(profiles, "planner");
    const llmReviewer = new LlmReviewer(llm, resolveModel(reviewerRole.model, settings.models), withSkills(reviewerRole.instructions, reviewerRole.skills));
    const store = new DurableStore(this.ctx.storage);
    const clock = { now: () => Date.now() };
    const engine = engineOf(env.PROJECT_WORKER_PREFIX);
    const router = settings.cloudflare ? new AppRouter({ accountId: settings.cloudflare.accountId, apiToken: settings.cloudflare.apiToken }, routerName(engine), engine) : null;
    const apps = new SandboxAppHost(env.SESSION, repos, {
      project: this.name,
      env: async () => Object.fromEntries((await revealEnv(await this.effectiveEnv(), this.envCipher())).map((v) => [v.name, v.value])),
      idleMinutes: async () => (await this.projectSettings()).appIdleMinutes,
      address: (sandbox) => this.address(sandbox),
    });
    const orchestrator = new Orchestrator(
      {
        repos,
        coder: new SandboxCoder(env.SESSION, { project: this.name, model: settings.models.coder, llm: settings.llm ? { baseUrl: providerBaseUrl(settings.llm), apiKey: settings.llm.apiKey } : null }),
        classifier: settings.jev ? new JevClassifier(new TypeSafeClient({ apiKey: settings.jev.apiKey, defaultModel: env.JEV_MODEL, ...(settings.jev.baseUrl ? { baseURL: settings.jev.baseUrl } : {}) }), env.JEV_MODEL, (model, usage) => spend.record(currentSpender(), model, usage, "router")) : NO_CLASSIFIER,
        planner: new LlmPlanner(llm, resolveModel(plannerRole.model, settings.models), withSkills(plannerRole.instructions, plannerRole.skills)),
        reviewer: env.REVIEWER_LORA ? new WorkersAiReviewer(env.AI as unknown as TextGenerator, env.REVIEWER_LORA, llmReviewer) : llmReviewer,
        apps,
        checks: new SandboxCheckRunner(env.SESSION, repos, this.name),
        proofs: new SandboxProofRunner(env.SESSION, repos, this.name),
        bus,
        clock,
        ids: { next: (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}` },
        store,
        memory: new VectorizeIndex(env.MEMORY as unknown as VectorizeLike, env.AI as unknown as EmbedderLike, this.name),
        spend,
        background: (work) => this.detach("starting a session's app", work),
      },
      {
        name: this.name,
        author: { name: "chef", email: "ma.karimi76@gmail.com" },
        profiles,
        router: routerConfigOf(agents.config.router),
        generated,
        specialization: { attempts: project.attempts ?? settings.attempts, testsAlongside: true, stub: (feature) => ({ [stubPath(feature.id)]: renderStub(feature.id, feature.title) }), laneLayout: (feature, roles, tree) => laneLayout(feature.id, feature.title, roles, tree) },
        appLink: (id) => `/app/${this.name}/${id}`,
        environment: async () => envNames(await this.effectiveEnv()),
        instructions: async () => (await settingsStub(env).sharedInstructions())?.text ?? "",
        merge: async () => (await this.projectSettings()).merge,
        steps: async () => (await this.projectSettings()).steps,
      },
    );
    const git = project.git;
    const installation = git?.installation;
    const tokenSource = app && installation !== undefined ? () => app.installationToken(installation) : undefined;
    const external = git ? orchestrator.external(new GitRemote({ url: git.url, branch: git.branch, token: git.token, ...(tokenSource ? { tokenSource } : {}) }, control), { mode: git.mode, syncBranch: git.syncBranch, ...(origin ? { mainAppLink: `${origin}/app/${this.name}/main` } : {}) }) : null;
    bus.subscribe((event) => void this.noteActivity(event, orchestrator).catch((error) => console.error(`noting ${this.name}'s activity failed`, error)));
    this.built = { orchestrator, bus, repos, apps, router, external, settings, fingerprint };
    return this.built;
  }

  private async noteActivity(event: ChefEvent, orchestrator: Orchestrator): Promise<void> {
    if (activityNote(event, null) === null) return;
    const sessionId = "sessionId" in event ? event.sessionId : null;
    const title = sessionId ? await orchestrator.session(sessionId).then((s) => s.plan.feature.title, () => null) : null;
    const note = activityNote(event, title);
    if (note === null || (note === this.lastNote?.note && event.at - this.lastNote.at < NOTE_REPEAT_MS)) return;
    this.lastNote = { note, at: event.at };
    await settingsStub(this.env).noteProjectActivity(this.name, { at: event.at, note });
  }

  override async alarm(): Promise<void> {
    if (await this.ctx.storage.get<boolean>(REMOVING)) return;
    await super.alarm();
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (await this.ctx.storage.get<boolean>(REMOVING)) return Response.json({ error: `${this.name} is being deleted` }, { status: 409 });
    const action = url.pathname.split("/").filter(Boolean).at(-1);
    if (url.pathname.endsWith("/git/webhook")) return this.webhook(request);
    const origin = request.headers.has(ORIGIN_HEADER) ? publicOrigin(request) : (homeOrigin(this.env) ?? url.origin);
    if ((await this.ctx.storage.get<string>(ORIGIN)) !== origin) await this.ctx.storage.put(ORIGIN, origin);
    const { orchestrator, bus, settings, external } = await this.build();
    const sessionHistory = SESSION_HISTORY_ROUTE.exec(url.pathname);
    if (sessionHistory && request.method === "GET") return sessionHistoryResponse(orchestrator, sessionHistory[1] as string, sessionHistory[2] ?? null);
    const session = SESSION_ROUTE.exec(url.pathname);
    if (session) return this.sessionRequest(request, session[1] as string, session[2] ?? null);
    const feature = FEATURE_ROUTE.exec(url.pathname);
    if (feature) {
      const { response, mainChanged } = await featureRequest(request, orchestrator, feature[1] as string);
      if (mainChanged) await this.schedule(0, "runMainApp", undefined, { idempotent: true });
      return response;
    }
    const featureMap = FEATURE_MAP_ROUTE.exec(url.pathname);
    if (featureMap) {
      if (featureMap[1] && !settings.llm) return Response.json({ error: NO_LLM }, { status: 409 });
      const { response, mainChanged } = await featureMapRequest(request, orchestrator, Boolean(featureMap[1]));
      if (mainChanged) await this.schedule(0, "runMainApp", undefined, { idempotent: true });
      return response;
    }
    const app = APP_ROUTE.exec(url.pathname);
    if (app && request.method === "GET") return this.appRequest(app[1] as string, url.searchParams.has("retry"), appPath(url.searchParams.get("path")), url.searchParams.has("state"), request.headers.has(SHARE_HEADER));
    if (action === "app-key" && request.method === "POST") {
      await this.ctx.storage.put(APP_KEY, newAppKey());
      await this.schedule(0, "refreshAddresses");
      return new Response(null, { status: 204 });
    }
    if (action === "settings" && url.pathname.endsWith(`/projects/${this.name}/settings`)) return this.settingsRequest(request);
    if (action === "env" && url.pathname.endsWith(`/projects/${this.name}/env`)) return this.envRequest(request);
    if (action === "instructions" && url.pathname.endsWith(`/projects/${this.name}/instructions`)) return instructionsRequest(request, await this.guidanceHost());
    if (action === "memory" && url.pathname.endsWith(`/projects/${this.name}/memory`)) return memoryRequest(request, await this.guidanceHost());
    if (url.pathname.endsWith(`/projects/${this.name}/agents`) || url.pathname.endsWith(`/projects/${this.name}/agents/restore`)) {
      return projectAgentsRequest(request, { project: this.name, store: this.agentSettings(), shared: agentStore(this.env), defaults: loadProfiles(agentFiles), models: settings.models, jev: settings.jev !== null });
    }
    if (request.method === "GET" && url.pathname.endsWith("/git")) return Response.json({ settings: viewProjectSettings(await this.projectSettings()).git, state: external ? await external.state() : null });
    if (request.method === "POST" && url.pathname.endsWith("/git/sync")) {
      if (!external) return Response.json({ error: "this project has no linked repository" }, { status: 409 });
      await external.retry();
      await this.schedule(0, "syncExternal");
      return Response.json({ ok: true }, { status: 202 });
    }
    const history = HISTORY_ROUTE.exec(url.pathname);
    if (history && request.method === "GET") return historyResponse(orchestrator, history[1] ?? null, url.searchParams.get("limit"));
    if (request.method === "GET" && action === "spec") {
      const main = await orchestrator.mainTree();
      if (await this.mainBehind()) await this.schedule(0, "runMainApp", undefined, { idempotent: true });
      return Response.json({ commitId: main.commitId, features: readSpec(main.tree), map: readFeatureMap(main.tree), layout: await orchestrator.layout(), fresh: await this.fresh(), mainApp: (await this.ctx.storage.get<MainAppState>(MAIN_APP)) ?? null });
    }
    if (request.method === "POST" && action === "main-app") {
      await this.schedule(0, "restartMainApp", undefined, { idempotent: true });
      return Response.json({ ok: true }, { status: 202 });
    }
    if (request.method === "POST" && action === "bootstrap") {
      return setupResponse(request, async (progress) => {
        const existing = (await orchestrator.mainTree()).commitId;
        if (existing) {
          await this.schedule(0, "runMainApp", undefined, { idempotent: true });
          if (external) await this.ensurePolling();
          if ((await this.overview()).status === "none" && !(await this.fresh())) await this.startReading();
          return { commitId: existing, created: false };
        }
        await this.schedule(5, "runMainApp", undefined, { idempotent: true });
        if (external) {
          const pulled = await external.pull(progress);
          if (pulled.status !== "imported") throw new SetupError(`importing the linked repository did not finish: ${pulled.status}`, 409);
          await this.ensurePolling();
          await this.startReading();
          return { commitId: pulled.commitId, created: true, imported: true };
        }
        const commitId = await orchestrator.bootstrap(templateFiles, progress);
        await this.ctx.storage.put(FRESH, true);
        return { commitId, created: true };
      });
    }
    if (action === "overview" && request.method === "GET") {
      if ((await this.overview()).status === "none" && !(await this.fresh()) && (await orchestrator.mainTree()).commitId) await this.startReading();
      return Response.json(await this.overview());
    }
    if (action === "overview" && request.method === "POST") {
      if ((await this.overview()).status !== "reading") await this.startReading();
      return Response.json(await this.overview(), { status: 202 });
    }
    if (request.method === "POST" && action === "prompts") {
      const { prompt } = (await request.json()) as { prompt?: string };
      if (!prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
      if (!settings.llm) return Response.json({ error: NO_LLM }, { status: 409 });
      if (!settings.cloudflare) return Response.json({ error: NO_CLOUDFLARE }, { status: 409 });
      const by = requester(request);
      const blocked = await orchestrator.blocked(by);
      if (blocked) return Response.json({ error: blocked }, { status: 402 });
      if ((await orchestrator.budgetChanged()).length > 0) await this.schedule(1, "drive");
      const result = await orchestrator.submit(prompt.trim(), { by });
      if (result.sessionId) await this.schedule(1, "drive");
      return Response.json(result, { status: 202 });
    }
    if (request.method === "POST" && action === "route") {
      const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string };
      if (!prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
      const by = requester(request);
      const blocked = await orchestrator.blocked(by);
      if (blocked) return Response.json({ error: blocked }, { status: 402 });
      return Response.json(await new EngineSpend(this.env, this.name).scope(by, () => orchestrator.route(prompt.trim())));
    }
    if (action === "budget" && url.pathname.endsWith(`/projects/${this.name}/budget`)) return this.budgetRequest(request);
    if (request.method === "GET" && action === "cloudflare" && url.pathname.endsWith(`/projects/${this.name}/cloudflare`)) return Response.json(await this.cloudflare(null));
    if (request.method === "GET" && action === "sessions") return Response.json(await orchestrator.sessions());
    if (request.method === "GET" && action === "cursor") return Response.json({ seq: await bus.cursor() });
    if (request.method === "GET" && action === "events") return Response.json(await bus.since(Number(url.searchParams.get("after") ?? 0)));
    return Response.json({ error: "not found" }, { status: 404 });
  }

  async removeProject(): Promise<{ readonly removed: readonly string[]; readonly kept: readonly string[] }> {
    await this.ctx.storage.put(REMOVING, true);
    for (const schedule of await this.listSchedules()) await this.cancelSchedule(schedule.id);
    const { orchestrator, repos, router } = await this.build();
    const sessions = await orchestrator.sessions();
    const removed: string[] = [];
    const kept: string[] = [];
    const sandboxes = new Set([this.name, this.mainSandbox()]);
    for (const session of sessions) sandboxes.add(session.id);
    await Promise.all([...sandboxes].map((name) => (this.env.SESSION.get(this.env.SESSION.idFromName(name)) as unknown as { discard(): Promise<void> }).discard().catch(() => undefined)));
    removed.push(`stopped the work of ${sessions.length === 1 ? "1 session" : `${sessions.length} sessions`}`);
    for (let waited = 0; this.runningMain && waited < MAIN_WAIT_SECONDS; waited++) await new Promise((resolve) => setTimeout(resolve, 1000));
    if (router) {
      const addressed = [...(await this.ctx.storage.list<{ readonly url: string }>({ prefix: ADDRESS })).keys()].map((key) => key.slice(ADDRESS.length));
      await router.remove([this.mainSandbox(), ...sessions.map((session) => session.id), ...addressed].map((sandbox) => this.label(sandbox)));
      removed.push("removed the addresses of its running apps");
    }
    if (this.env.TRANSCRIPTS) {
      const transcripts = await removeTranscripts(this.env.TRANSCRIPTS, this.name).catch(() => 0);
      if (transcripts > 0) removed.push(`removed ${transcripts === 1 ? "1 transcript file" : `${transcripts} transcript files`}`);
    }
    const forgotten = await orchestrator.forgetMemory();
    if (forgotten > 0) removed.push(`forgot ${forgotten === 1 ? "1 memory entry" : `${forgotten} memory entries`}`);
    const forks = sessions.filter((session) => !session.forkDeleted).map((session) => session.fork);
    for (const repo of [...forks, this.name]) {
      if (!(await repos.info(repo))) continue;
      await repos.deleteRepo(repo);
      removed.push(`removed the code ${repo}`);
    }
    const git = (await this.projectSettings()).git;
    if (git) kept.push(`the linked repository ${git.url} stays as it is`);
    return { removed, kept };
  }

  private async sessionRequest(request: Request, id: string, action: string | null): Promise<Response> {
    const { orchestrator, bus } = await this.build();
    try {
      if (request.method === "GET" && action === null) {
        const record = await orchestrator.session(id);
        if (!isTerminal(record.machine.state)) await this.sandbox(id).status().catch(() => undefined);
        return Response.json({ record, budget: DEFAULT_BUDGET, cost: await this.costOf(id) });
      }
      if (request.method === "GET" && action === "turns") return Response.json(await orchestrator.turns(id));
      if (request.method === "GET" && action === "changes") return Response.json(await orchestrator.changes(id));
      if (request.method === "GET" && action === "events") return Response.json(await bus.ofSession(id, Number(new URL(request.url).searchParams.get("after") ?? 0)));
      if (request.method === "GET" && action === "cloudflare") return Response.json(await this.cloudflare(id));
      if (request.method === "POST" && action === "drop") {
        const { reason } = (await request.json().catch(() => ({}))) as { reason?: string };
        const record = await orchestrator.drop(id, reason?.trim() || undefined);
        return Response.json({ state: record.machine.state }, { status: 202 });
      }
      if (request.method === "POST" && action === "retry") {
        const blocked = await orchestrator.blocked(requester(request));
        if (blocked) return Response.json({ error: blocked }, { status: 402 });
        const { guidance } = (await request.json().catch(() => ({}))) as { guidance?: string };
        const record = await orchestrator.retry(id, guidance ?? "");
        await this.schedule(1, "drive");
        return Response.json({ state: record.machine.state }, { status: 202 });
      }
      if (request.method === "POST" && action === "merge") {
        const record = await orchestrator.approveMerge(id);
        await this.schedule(1, "drive");
        return Response.json({ state: record.machine.state }, { status: 202 });
      }
      if (request.method === "POST" && action === "version") {
        const by = requester(request);
        const blocked = await orchestrator.blocked(by);
        if (blocked) return Response.json({ error: blocked }, { status: 402 });
        const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string };
        const record = await orchestrator.newVersion(id, prompt ?? null, by);
        await this.schedule(1, "drive");
        return Response.json({ sessionId: record.id, version: record.version ?? null }, { status: 202 });
      }
      if (request.method === "POST" && action === "sandbox") {
        const { main, now } = (await request.json().catch(() => ({}))) as { main?: boolean; now?: boolean };
        await orchestrator.session(id);
        const name = main === true ? this.mainSandbox() : id;
        const outcome = await (this.env.SESSION.get(this.env.SESSION.idFromName(name)) as unknown as { restart(now: boolean): Promise<SandboxRestart> }).restart(now === true);
        if (main === true && outcome === "restarted") await this.schedule(0, "restartMainApp", undefined, { idempotent: true });
        return Response.json({ outcome }, { status: 202 });
      }
      if (request.method === "POST" && action === "steer") {
        const { message } = (await request.json().catch(() => ({}))) as { message?: string };
        if (!message?.trim()) return Response.json({ error: "message is required" }, { status: 400 });
        await orchestrator.steer(id, message.trim());
        return Response.json({ ok: true }, { status: 202 });
      }
    } catch (error) {
      if (error instanceof ControlError) return Response.json({ error: error.message }, { status: 409 });
      if (error instanceof Error && error.message.startsWith("unknown session")) return Response.json({ error: error.message }, { status: 404 });
      throw error;
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async cloudflare(id: string | null): Promise<CloudflareView> {
    const { orchestrator, repos, router, settings } = await this.build();
    const record = id ? await orchestrator.session(id) : null;
    const engine = engineOf(this.env.PROJECT_WORKER_PREFIX);
    const routerWorker = routerName(engine);
    const accountId = settings.cloudflare?.accountId ?? this.env.CF_ACCOUNT_ID ?? null;
    const box = async (name: string): Promise<SandboxFacts> => {
      const objectId = this.env.SESSION.idFromName(name);
      const status = await this.sandbox(name).status().catch((): SandboxStatus => ({ running: false, exit: null }));
      const cost = await this.costOf(name);
      return { name, objectId: objectId.toString(), running: status.running, exit: status.exit, size: status.size ?? null, spent: { micros: cost.sandbox, seconds: cost.sandboxSeconds } };
    };
    const [main, fork, ids, session, mainBox] = await Promise.all([
      repos.info(this.name),
      !record || record.forkDeleted ? Promise.resolve(null) : repos.info(record.fork),
      this.engineIds.ids(settings.cloudflare, engine),
      id ? box(id) : Promise.resolve(null),
      box(this.mainSandbox()),
    ]);
    const mainApp = (await this.ctx.storage.get<MainAppState>(MAIN_APP)) ?? null;
    return cloudflareView({
      accountId,
      engine,
      project: this.name,
      router: routerWorker,
      projectObject: this.ctx.id.toString(),
      namespaces: ids.namespaces,
      containerApp: { name: containerAppName(engine), id: ids.containerApp },
      main: { remote: main?.remote ?? null, commitId: (await orchestrator.mainTree()).commitId },
      session: id && record ? { id, fork: record.fork, remote: fork?.remote ?? null, removed: record.forkDeleted ? (record.machine.state === "dropped" ? "dropped" : "merged") : null, head: record.head, lanes: (record.lanes ?? []).map((l) => ({ role: l.role, branch: l.branch, head: l.head })) } : null,
      agents: record ? agentsOf(record) : { sandbox: [], engine: ["planner", "reviewer"] },
      sandboxes: { session, main: mainBox },
      app: router && id && record ? { name: appName(this.label(id), routerWorker), url: record.app?.url ?? null, status: record.app?.status ?? null, commitId: record.app?.commitId ?? null } : null,
      mainApp: mainApp ? { url: mainApp.url, commitId: mainApp.commitId, status: mainApp.status } : null,
    });
  }

  private async appRequest(id: string, retry: boolean, path: string, asState: boolean, viaShare: boolean): Promise<Response> {
    const state = await this.appAnswer(id, retry);
    const now = Date.now();
    const enter = state.status === "ready" ? await appEntry(state.url, await this.appKey(), { path, now, cookieSeconds: viaShare ? SHARE_COOKIE_SECONDS : OWNER_COOKIE_SECONDS }) : undefined;
    return appResponse(state, { target: id, path, asState, now, ...(enter ? { enter } : {}) });
  }

  async shareTarget(kind: ShareKind, id: string): Promise<{ readonly name: string; readonly scopes: readonly string[] } | { readonly error: string }> {
    const { orchestrator } = await this.build();
    if (kind === "app" && id === "main") return { name: `${this.name} main`, scopes: [appScope(this.name, id)] };
    const record = (await orchestrator.sessions()).find((s) => s.id === id);
    if (!record) return { error: `no session ${id} in ${this.name}` };
    if (kind === "session") return { name: record.plan.feature.title, scopes: [sessionScope(this.name, id), appScope(this.name, id)] };
    return { name: record.plan.feature.title, scopes: [appScope(this.name, id)] };
  }

  private mainSandbox(): string {
    return `${this.name}--main`;
  }

  private label(sandbox: string): string {
    return sandbox === this.mainSandbox() ? `main-${this.name}` : `${sandbox}-${this.name}`;
  }

  private async appKey(): Promise<string> {
    const stored = await this.ctx.storage.get<string>(APP_KEY);
    if (stored) return stored;
    const key = newAppKey();
    await this.ctx.storage.put(APP_KEY, key);
    return key;
  }

  private async address(sandbox: string): Promise<string | null> {
    const { router } = await this.build();
    if (!router) return null;
    const key = await this.appKey();
    const saved = await this.ctx.storage.get<{ readonly url: string; readonly key: string }>(`${ADDRESS}${sandbox}`);
    if (saved?.key === key) return saved.url;
    const url = await router.address({ label: this.label(sandbox), target: sandbox, key });
    await this.ctx.storage.put(`${ADDRESS}${sandbox}`, { url, key });
    return url;
  }

  async refreshAddresses(): Promise<void> {
    for (const key of (await this.ctx.storage.list({ prefix: ADDRESS })).keys()) {
      await this.address(key.slice(ADDRESS.length)).catch((error: unknown) => {
        if (error instanceof RouterTakenError) return null;
        console.error(`renewing the address of ${key} failed`, error);
        return null;
      });
    }
  }

  private async appSource(id: string): Promise<{ readonly sandbox: string; readonly repo: string; readonly commitId: string } | null> {
    const { orchestrator, repos } = await this.build();
    const main = async () => {
      const commitId = await repos.resolveRef(this.name, "main");
      return commitId ? { sandbox: this.mainSandbox(), repo: this.name, commitId } : null;
    };
    const branch = id === "main" ? { kind: "main" as const } : appBranch(await orchestrator.sessions(), id);
    if (!branch) return null;
    return branch.kind === "main" ? main() : { sandbox: branch.id, repo: branch.fork, commitId: branch.head };
  }

  private async appAnswer(id: string, retry: boolean): Promise<AppAnswer> {
    const { router } = await this.build();
    if (!router) return { status: "failed", error: NO_CLOUDFLARE };
    const source = await this.appSource(id);
    if (!source) return { status: "missing" };
    const state = await (this.env.SESSION.get(this.env.SESSION.idFromName(source.sandbox)) as unknown as { appState(): Promise<AppState | null> }).appState();
    if (state?.status === "running") {
      try {
        const url = await this.address(source.sandbox);
        if (url) return { status: "ready", url, commitId: state.commitId };
      } catch (error) {
        return { status: "failed", error: error instanceof Error ? error.message : String(error) };
      }
    }
    if (state?.status === "starting" && Date.now() - state.at < STARTING_STALE_MS) return { status: "starting", since: state.at };
    if (state?.status === "failed" && !retry && state.commitId === source.commitId) return { status: "failed", error: state.error ?? "the app did not start" };
    if (state?.status === "no-stack" && state.commitId === source.commitId) return { status: "no-stack" };
    await this.schedule(0, "wakeApp", source.sandbox, { idempotent: true });
    return { status: "starting", since: Date.now() };
  }

  async sandboxSpent(sandbox: string, micros: number, seconds: number): Promise<void> {
    const by = sandbox === this.mainSandbox() ? null : await this.requesterOf(sandbox);
    await settingsStub(this.env).recordSpend(this.name, by, micros, Date.now(), "sandbox");
    await this.addCost(sandbox, "sandbox", micros, seconds);
  }

  private async requesterOf(session: string): Promise<string | null> {
    const { orchestrator } = await this.build().catch(() => ({ orchestrator: null }));
    const record = await orchestrator?.session(session).catch(() => null);
    return record?.requestedBy ?? null;
  }

  private async addCost(key: string, part: SpendPart, micros: number, seconds = 0): Promise<void> {
    const at = `${COST}${key}`;
    await this.ctx.storage.put(at, addCost((await this.ctx.storage.get<SessionCost>(at)) ?? NO_COST, part, micros, seconds));
  }

  private async costOf(key: string): Promise<SessionCost> {
    return (await this.ctx.storage.get<SessionCost>(`${COST}${key}`)) ?? NO_COST;
  }

  private sandbox(name: string): { status(): Promise<SandboxStatus> } {
    return this.env.SESSION.get(this.env.SESSION.idFromName(name)) as unknown as { status(): Promise<SandboxStatus> };
  }

  async sandboxStep(): Promise<number> {
    return (await this.ctx.storage.get<number>(SANDBOX_STEP)) ?? 0;
  }

  async sandboxNeeds(step: number): Promise<void> {
    if (step > (await this.sandboxStep())) await this.ctx.storage.put(SANDBOX_STEP, step);
  }

  async wakeApp(sandbox: string): Promise<void> {
    this.detach(`starting the app of ${sandbox}`, () => this.wakeNow(sandbox));
  }

  private async wakeNow(sandbox: string): Promise<void> {
    if (sandbox === this.mainSandbox()) return this.mainAppNow(true);
    if (this.waking.has(sandbox)) return;
    this.waking.add(sandbox);
    try {
      const source = await this.appSource(sandbox);
      if (!source) return;
      if (source.sandbox === this.mainSandbox()) return await this.mainAppNow(true);
      const { apps } = await this.build();
      await apps.run({ target: source.sandbox, repo: source.repo, ref: "main", commitId: source.commitId });
    } catch (error) {
      console.error(`starting the app of ${sandbox} failed`, error);
    } finally {
      this.waking.delete(sandbox);
    }
  }

  async projectSettings(): Promise<ProjectSettings> {
    return readProjectSettings(await this.ctx.storage.get<Partial<ProjectSettings>>(PROJECT_SETTINGS));
  }

  private async settingsRequest(request: Request): Promise<Response> {
    const stored = await this.ctx.storage.get<Partial<ProjectSettings>>(PROJECT_SETTINGS);
    if (request.method === "GET") return Response.json(viewProjectSettings(readProjectSettings(stored)));
    if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
    const branched = await withLinkBranch(stored, await request.json().catch(() => null), remoteBranch);
    if (!branched.ok) return Response.json({ error: branched.error }, { status: 400 });
    const body = branched.body;
    const viaApp = requestsGitHubApp(body);
    const repo = viaApp ? gitHubRepo(viaApp) : null;
    let installation: number | null = null;
    if (repo) {
      const app = await gitHubApp(this.env);
      if (!app) return Response.json({ error: "connect GitHub first" }, { status: 409 });
      try {
        installation = await app.installationFor(repo.owner, repo.repo);
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
      }
    }
    const result = applyProjectUpdate(stored, body, () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""), installation);
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    await this.ctx.storage.put(PROJECT_SETTINGS, result.settings);
    const linked = result.settings.git;
    const linkedRepo = linked?.installation !== undefined ? gitHubRepo(linked.url) : null;
    await settingsStub(this.env).linkRepository(this.name, linkedRepo ? `${linkedRepo.owner}/${linkedRepo.repo}` : null);
    const saved = readProjectSettings(result.settings);
    if (saved.git) {
      await this.ensurePolling();
      await this.schedule(0, "syncExternal");
    } else await this.stopPolling();
    return Response.json(viewProjectSettings(saved));
  }

  private async guidanceHost(): Promise<GuidanceHost> {
    const { orchestrator } = await this.build();
    return {
      main: () => orchestrator.mainTree(),
      shared: () => settingsStub(this.env).sharedInstructions(),
      edit: async (edit) => {
        const before = (await orchestrator.mainTree()).commitId;
        const result = await orchestrator.editGuidance(edit);
        if (result.ok && result.commitId && result.commitId !== before) {
          const mainApp = await this.ctx.storage.get<MainAppState>(MAIN_APP);
          if (mainApp?.status === "running" && mainApp.commitId === before) await this.ctx.storage.put<MainAppState>(MAIN_APP, { ...mainApp, commitId: result.commitId });
          await this.schedule(1, "drive");
        }
        return result;
      },
    };
  }

  private async storedEnv(): Promise<StoredEnv> {
    return (await this.ctx.storage.get<StoredEnv>(ENV)) ?? {};
  }

  private async effectiveEnv(): Promise<StoredEnv> {
    return mergeEnv(await settingsStub(this.env).sharedEnv(), await this.storedEnv());
  }

  private envCipher(): EnvCipher {
    this.cipher ??= envCipher(this.env);
    return this.cipher;
  }

  private agentSettings(): AgentSettings {
    return new AgentSettings(new DurableStore(this.ctx.storage), Date.now, AGENTS);
  }

  async budgetChanged(): Promise<void> {
    const { orchestrator } = await this.build();
    if ((await orchestrator.budgetChanged()).length > 0) await this.schedule(1, "drive");
  }

  private async budgetRequest(request: Request): Promise<Response> {
    const settings = settingsStub(this.env);
    if (request.method === "PUT") {
      const cap = readCap(((await request.json().catch(() => null)) as { cap?: unknown } | null)?.cap);
      if (cap === undefined) return Response.json({ error: "a budget is a dollar amount from 0 to 1,000,000, or null for no limit" }, { status: 400 });
      await settings.updateCaps({ projects: { [this.name]: cap } });
      await this.budgetChanged();
    } else if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
    const { caps, ledger } = await settings.spending(Date.now());
    return Response.json({ month: ledger.month, spent: ledger.projects[this.name] ?? 0, cap: caps.projects[this.name] ?? null });
  }

  async sharedEnvironmentChanged(): Promise<void> {
    const { orchestrator } = await this.build();
    if ((await orchestrator.environmentChanged()).length > 0) await this.schedule(1, "drive");
    await this.schedule(0, "restartApps");
  }

  private async envRequest(request: Request): Promise<Response> {
    const stored = await this.storedEnv();
    if (request.method === "GET") return Response.json(await this.envView(stored));
    if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
    const result = await applyEnvUpdate(stored, await request.json().catch(() => null), this.envCipher(), Date.now());
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    await this.ctx.storage.put(ENV, result.env);
    const { orchestrator } = await this.build();
    if ((await orchestrator.environmentChanged()).length > 0) await this.schedule(1, "drive");
    await this.schedule(0, "restartApps");
    return Response.json(await this.envView(result.env));
  }

  private async envView(stored: StoredEnv) {
    const { orchestrator } = await this.build();
    const features = [...readSpec((await orchestrator.mainTree()).tree), ...(await orchestrator.sessions()).filter((s) => !isTerminal(s.machine.state)).map((s) => s.plan.feature)];
    const shared = await settingsStub(this.env).sharedEnv();
    return viewProjectEnv(stored, shared, this.envCipher(), envNeeds(features, envNames(mergeEnv(shared, stored))));
  }

  async restartApps(): Promise<void> {
    const { orchestrator } = await this.build();
    if (await this.ctx.storage.get<MainAppState>(MAIN_APP)) await this.restartMainApp();
    for (const session of await orchestrator.sessions()) if (!isTerminal(session.machine.state) && session.app?.status === "running") await this.wakeApp(session.id);
  }

  private detach(what: string, work: () => Promise<void>): void {
    void this.keepAliveWhile(work).catch((error: unknown) => console.error(`${what} failed`, error));
  }

  override shouldSendProtocolMessages(_connection: Connection, context: ConnectionContext): boolean {
    return !isVoice(context.request.url);
  }

  override async onConnect(connection: Connection, context: ConnectionContext): Promise<void> {
    if (isVoice(context.request.url)) {
      this.calls.set(connection.id, this.startVoice(connection, requester(context.request)));
      return;
    }
    const { bus } = await this.build();
    let after = replayFrom(context.request.url);
    for (;;) {
      const entries = await bus.since(after);
      for (const entry of entries) connection.send(JSON.stringify(entry));
      const last = entries.at(-1);
      if (last) after = last.seq;
      if (!last || entries.length < 500) break;
    }
    connection.send(JSON.stringify(caughtUp(after)));
  }

  override async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    const call = this.calls.get(connection.id);
    if (!call || typeof message === "string") return;
    const audio = message instanceof ArrayBuffer ? new Uint8Array(message) : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
    (await call)?.sendAudio(audio);
  }

  override async onClose(connection: Connection): Promise<void> {
    const call = this.calls.get(connection.id);
    if (!call) return;
    this.calls.delete(connection.id);
    await this.keepAliveWhile(async () => (await call)?.hangUp());
  }

  private async startVoice(connection: Connection, by: string | null): Promise<VoiceCall | null> {
    const send = (event: object) => {
      try {
        connection.send(JSON.stringify(event));
      } catch {
        return;
      }
    };
    const hangUp = () => {
      try {
        connection.close(1000, "done");
      } catch {
        return;
      }
    };
    const fail = (message: string) => {
      send({ type: "error", error: { message } });
      send({ type: "session.closed" });
      hangUp();
      return null;
    };
    const { orchestrator, settings } = await this.build();
    const spend = new EngineSpend(this.env, this.name);
    if (!settings.llm) return fail(NO_LLM);
    const voice = settings.voice;
    if (!voice) return fail("Live talk needs a voice key in Settings > Models.");
    const host =
      voice.kind === "openai"
        ? new GptLiveHost({ apiKey: voice.apiKey, model: settings.models.voice, voice: this.env.VOICE, connect: workersConnect, ...(voice.baseUrl ? { baseUrl: voice.baseUrl } : {}) })
        : new RealtimeHost({ baseUrl: voice.baseUrl, apiKey: voice.apiKey, model: settings.models.voice, voice: this.env.VOICE, connect: workersConnect });
    const target = {
      submitSpoken: async (prompt: string, call: { voiceSessionId: string; delegationId: string }) => {
        const result = await orchestrator.submitSpoken(prompt, { ...call, by });
        if (result.sessionId) await this.schedule(1, "drive");
        return result;
      },
      recordSpoken: (turn: SpokenTurn & { voiceSessionId: string }) => orchestrator.recordSpoken(turn),
    };
    try {
      return await startVoiceCall({
        host,
        target,
        spec: readSpec((await orchestrator.mainTree()).tree),
        context: await orchestrator.voiceContext(),
        ids: { next: (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}` },
        settle: () => new Promise((resolve) => setTimeout(resolve, 600)),
        onEvent: (event) => {
          const usage = voiceUsage(event);
          if (usage) void spend.record(by, settings.models.voice, usage, "voice").catch(() => undefined);
          send(event);
          if (event.type === "error") console.error(`voice call on ${this.name} reported an error`, JSON.stringify(event["error"] ?? null));
          if (event.type === "session.closed") hangUp();
        },
      });
    } catch (error) {
      console.error("starting a voice call failed", error);
      return fail(error instanceof Error ? error.message : String(error));
    }
  }

  async syncExternal(): Promise<void> {
    const { external, orchestrator } = await this.build();
    if (!external || !(await orchestrator.mainTree()).commitId) return;
    try {
      const pulled = await external.pull();
      if (pulled.status === "merged" || pulled.status === "resolved") await this.schedule(1, "drive");
    } catch (error) {
      console.error(`pulling ${this.name}'s linked repository failed`, error);
    }
    await this.pushExternal();
  }

  private async pushExternal(): Promise<void> {
    const { external } = await this.build();
    if (!external) return;
    try {
      await external.push();
    } catch (error) {
      console.error(`pushing ${this.name} to its linked repository failed`, error);
    }
  }

  private async ensurePolling(): Promise<void> {
    await this.scheduleEvery(POLL_SECONDS, "syncExternal");
  }

  private async stopPolling(): Promise<void> {
    for (const schedule of await this.listSchedules()) if (schedule.callback === "syncExternal") await this.cancelSchedule(schedule.id);
  }

  private async webhook(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
    const git = (await this.projectSettings()).git;
    if (!git) return Response.json({ error: "this project has no linked repository" }, { status: 404 });
    const body = await request.text();
    if (!(await validSignature(git.webhookSecret, body, request.headers.get("x-hub-signature-256")))) return Response.json({ error: "bad signature" }, { status: 401 });
    const event = request.headers.get("x-github-event");
    if (event === "ping") return Response.json({ ok: true });
    const ref = (JSON.parse(body) as { ref?: string }).ref;
    if (event === "push" && ref === `refs/heads/${git.branch}`) await this.schedule(0, "syncExternal");
    return Response.json({ ok: true }, { status: 202 });
  }

  private async overview(): Promise<OverviewState> {
    const state = (await this.ctx.storage.get<OverviewState>(OVERVIEW)) ?? { status: "none" };
    if (state.status === "reading" && Date.now() - state.since > READING_TIMEOUT_MS) return { status: "failed", at: Date.now(), error: "reading the code took too long; try again" };
    if (state.status !== "ready" || !(await this.projectSettings()).git) return state;
    const { orchestrator } = await this.build();
    const { tree } = await orchestrator.mainTree();
    return { ...state, overview: withChefSuggestions(state.overview, tree) };
  }

  private async fresh(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>(FRESH)) === true;
  }

  private async startReading(): Promise<void> {
    await this.ctx.storage.put<OverviewState>(OVERVIEW, { status: "reading", since: Date.now() });
    await this.schedule(0, "readProject");
  }

  async readProject(): Promise<void> {
    this.detach(`reading ${this.name}`, () => this.readNow());
  }

  private async readNow(): Promise<void> {
    const { orchestrator, settings } = await this.build();
    let state: OverviewState;
    try {
      if (!settings.llm) throw new Error(NO_LLM);
      const main = await orchestrator.mainTree();
      const spend = new EngineSpend(this.env, this.name);
      const overview = await exploreProject(llmFromProvider(settings.llm, meteredFetch((model, usage) => spend.record(null, model, usage))), { name: this.name, tree: main.tree, model: settings.models.planner });
      state = { status: "ready", commitId: main.commitId, at: Date.now(), overview };
    } catch (error) {
      console.error(`reading ${this.name} failed`, error);
      state = { status: "failed", at: Date.now(), error: error instanceof Error ? error.message : String(error) };
    }
    await this.ctx.storage.put<OverviewState>(OVERVIEW, state);
  }

  async gitPushed(ref: string): Promise<void> {
    const git = (await this.projectSettings()).git;
    if (git && ref === `refs/heads/${git.branch}`) await this.schedule(0, "syncExternal");
  }

  async drive(): Promise<void> {
    const { orchestrator } = await this.build();
    await orchestrator.reclaim();
    const sessions = await this.pump.kick(orchestrator, () => undefined);
    const verifying = await orchestrator.verifyMerges();
    await this.pushExternal();
    if (sessions.some(runnable)) await this.schedule(1, "drive");
    else if (verifying > 0) await this.schedule(5, "drive");
    if (sessions.some((s) => s.overBudget && !isTerminal(s.machine.state))) await this.schedule(nextMonth(Date.now()), "budgetChanged", undefined, { idempotent: true });
    if (await this.mainBehind()) await this.schedule(0, "runMainApp", undefined, { idempotent: true });
  }

  async onMainPushed(event: PushedEvent): Promise<void> {
    const { repos } = await this.build();
    repos.emitPush(event);
    await this.schedule(1, "drive");
    await this.schedule(0, "runMainApp", undefined, { idempotent: true });
  }

  private async mainBehind(): Promise<boolean> {
    const { repos } = await this.build();
    const head = await repos.resolveRef(this.name, "main");
    const mainApp = await this.ctx.storage.get<MainAppState>(MAIN_APP);
    if (head === null) return false;
    return head !== mainApp?.commitId || (mainApp.status === "starting" && !this.runningMain);
  }

  async restartMainApp(): Promise<void> {
    await this.runMainApp(true);
  }

  async runMainApp(force?: boolean): Promise<void> {
    this.detach(`starting ${this.name}'s main app`, () => this.mainAppNow(force === true));
  }

  private async mainAppNow(force: boolean): Promise<void> {
    if (this.runningMain) {
      this.mainAgain = true;
      return;
    }
    this.runningMain = true;
    try {
      let again = force;
      do {
        this.mainAgain = false;
        await this.runMainAppOnce(again);
        again = false;
      } while (this.mainAgain);
    } finally {
      this.runningMain = false;
    }
  }

  private async runMainAppOnce(force: boolean): Promise<void> {
    const { repos, apps, bus } = await this.build();
    const commitId = await repos.resolveRef(this.name, "main");
    const current = await this.ctx.storage.get<MainAppState>(MAIN_APP);
    if (!commitId || (!force && current?.commitId === commitId && current.status !== "starting")) return;
    const record = async (state: Omit<MainAppState, "at">) => {
      await this.ctx.storage.put<MainAppState>(MAIN_APP, { ...state, at: Date.now() });
      await bus.publish({ type: "main-app.updated", project: this.name, at: Date.now(), ...state });
    };
    await record({ status: "starting", commitId, url: current?.url ?? null });
    try {
      const run = await apps.run({ target: this.mainSandbox(), repo: this.name, ref: "main", commitId });
      await record({ status: run.status, commitId, url: run.url ?? current?.url ?? null, ...(run.error ? { error: run.error } : {}) });
    } catch (error) {
      console.error(`starting ${this.name}'s main app failed`, error);
      await record({ status: "failed", commitId, url: current?.url ?? null, error: error instanceof Error ? error.message : String(error) });
    }
  }
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

function isVoice(url: string): boolean {
  return new URL(url).searchParams.get("voice") === "1";
}

const workersConnect: Connect = async (url, headers) => {
  const response = await fetch(url.replace(/^ws/, "http"), { headers: { ...headers, upgrade: "websocket" } });
  const socket = response.webSocket;
  if (!socket) throw new Error(`the voice API refused the WebSocket: ${response.status}`);
  socket.accept();
  return socket as unknown as SocketLike;
};
