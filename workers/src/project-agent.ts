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
import { RealtimeHost } from "@chef/adapters/realtime";
import { AgentSettings, readCap, applyAgentConfig, FEATURE_ROUTE, featureRequest, type LiveStatus, ControlError, DEFAULT_BUDGET, DEFAULT_STORED_AGENTS, mergeAgentConfig, envNeeds, NO_CLASSIFIER, isTerminal, loadProfiles, Orchestrator, resolveModel, routerConfigOf, withSkills, type Profiles, PreviewKeeper, readSpec, caughtUp, SetupError, setupResponse, replayFrom, runnable, startVoiceCall, type ExternalSync, type PreviewHost, type PushedEvent, agentsOf, cloudflareView, engineOf, previewBranch, previewName, type CloudflareView, type SandboxFacts, type Tree, type SpokenTurn, type VoiceCall } from "@chef/core";
import { applyEnvUpdate, envNames, mergeEnv, revealEnv, viewProjectEnv, type EnvCipher, type StoredEnv } from "@chef/adapters/project-env";
import { projectAgentsRequest } from "@chef/adapters/agents";
import { instructionsRequest, memoryRequest, type GuidanceHost } from "@chef/adapters/guidance";
import { applyProjectUpdate, readProjectSettings, requestsGitHubApp, viewProjectSettings, type ProjectSettings } from "@chef/adapters/project-settings";
import { gitHubRepo, GitRemote } from "@chef/adapters/external-git";
import { exploreProject, type OverviewState } from "@chef/adapters/project-explorer";
import { laneLayout, renderRegistry, renderStub, stubPath } from "@chef/template/gen";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { DurableStore } from "./do-store.ts";
import { agentFiles, templateFiles } from "./embedded.gen.ts";
import { DurableEventBus } from "./event-bus.ts";
import { SandboxCheckRunner, SandboxLiveHost, SandboxPreviewHost, SandboxProofRunner } from "./sandbox-checks.ts";
import { SandboxCoder, sandboxName } from "./sandbox-coder.ts";
import { buildingPage, previewPath } from "@chef/adapters/preview-page";
import { CloudflareWorkerSpace, WorkerTakenError } from "./preview-space.ts";
import { siteOrigin } from "./access.ts";
import { gitHubApp } from "./github.ts";
import { agentStore, currentSettings, envCipher, settingsStub } from "./settings.ts";
import { validSignature } from "./webhook.ts";
import type { SandboxStatus } from "./session-agent.ts";
import { containerAppName, EngineIdCache } from "./cloudflare-ids.ts";

const SESSION_ROUTE = /^\/api\/projects\/[a-z][a-z0-9-]{1,30}\/sessions\/([a-z0-9-]{1,40})(?:\/([a-z]+))?$/;
const PREVIEW_ROUTE = /^\/preview\/[a-z][a-z0-9-]{1,30}\/([a-z0-9-]{1,80})\/?$/;
const PROJECT_SETTINGS = "project/settings";
const ORIGIN = "project/origin";
const OVERVIEW = "project/overview";
const ENV = "project/env";
const AGENTS = "project/agents/";
const LIVE = "project/live";

export interface LiveState {
  readonly status: LiveStatus;
  readonly commitId: string;
  readonly url: string | null;
  readonly error?: string;
  readonly at: number;
}
const READING_TIMEOUT_MS = 10 * 60_000;
const POLL_SECONDS = 300;
const BUSY_SWEEP_SECONDS = 600;

const generated = { "src/registry.gen.ts": (tree: Tree) => renderRegistry(Object.keys(tree)) };

function role(profiles: Profiles, name: string) {
  const profile = profiles[name];
  if (!profile) throw new Error(`agents/${name}.md is missing`);
  return profile;
}

export class ProjectAgent extends Agent<Env> {
  private readonly calls = new Map<string, Promise<VoiceCall | null>>();
  private built: { orchestrator: Orchestrator; bus: DurableEventBus; repos: ArtifactsRepoHost; keeper: PreviewKeeper | null; space: CloudflareWorkerSpace | null; live: SandboxLiveHost | null; external: ExternalSync | null; settings: Resolved; fingerprint: string } | null = null;
  private cipher: EnvCipher | null = null;
  private readonly engineIds = new EngineIdCache();
  private deploying = false;
  private deployAgain = false;

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
    const fingerprint = JSON.stringify([settings, project.git, project.attempts, origin, app?.credentials.id ?? null, shared.version, own.version]);
    if (this.built?.fingerprint === fingerprint) return this.built;
    this.built?.orchestrator.dispose();
    const env = this.env;
    const control = bindingControl(env.ARTIFACTS as unknown as ArtifactsBindingLike);
    const repos = new ArtifactsRepoHost(control);
    const bus = new DurableEventBus(this.ctx.storage, (message) => this.broadcast(message, [...this.calls.keys()]));
    const spend = new EngineSpend(env, this.name);
    const llm = settings.llm ? llmFromProvider(settings.llm, meteredFetch((model, usage) => spend.record(currentSpender(), model, usage))) : missingLlm;
    const profiles = applyAgentConfig(loadProfiles(agentFiles), agents.config);
    const reviewerRole = role(profiles, "reviewer");
    const plannerRole = role(profiles, "planner");
    const llmReviewer = new LlmReviewer(llm, resolveModel(reviewerRole.model, settings.models), withSkills(reviewerRole.instructions, reviewerRole.skills));
    const store = new DurableStore(this.ctx.storage);
    const clock = { now: () => Date.now() };
    const grant = settings.cloudflare ? { accountId: settings.cloudflare.accountId, worker: `${env.PROJECT_WORKER_PREFIX}${this.name}` } : null;
    const space = settings.cloudflare && grant ? new CloudflareWorkerSpace(grant, settings.cloudflare.apiToken) : null;
    const live = settings.cloudflare && grant ? new SandboxLiveHost(env.SESSION, repos, grant, settings.cloudflare.apiToken) : null;
    const keeper =
      settings.cloudflare && grant && space
        ? new PreviewKeeper(new SandboxPreviewHost(env.SESSION, repos, grant, settings.cloudflare.apiToken, () => this.prepareEnvironment(space)), space, { repos, store, clock, canonical: this.name, onActivity: () => void this.scheduleSweep() })
        : null;
    const orchestrator = new Orchestrator(
      {
        repos,
        coder: new SandboxCoder(env.SESSION, { model: settings.models.coder, llm: settings.llm ? { baseUrl: providerBaseUrl(settings.llm), apiKey: settings.llm.apiKey } : null }),
        classifier: settings.jev ? new JevClassifier(new TypeSafeClient({ apiKey: settings.jev.apiKey, defaultModel: env.JEV_MODEL }), env.JEV_MODEL) : NO_CLASSIFIER,
        planner: new LlmPlanner(llm, resolveModel(plannerRole.model, settings.models), withSkills(plannerRole.instructions, plannerRole.skills)),
        reviewer: env.REVIEWER_LORA ? new WorkersAiReviewer(env.AI as unknown as TextGenerator, env.REVIEWER_LORA, llmReviewer) : llmReviewer,
        previews: keeper ?? noPreviews,
        checks: new SandboxCheckRunner(env.SESSION, repos),
        proofs: new SandboxProofRunner(env.SESSION, repos),
        bus,
        clock,
        ids: { next: (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}` },
        store,
        memory: new VectorizeIndex(env.MEMORY as unknown as VectorizeLike, env.AI as unknown as EmbedderLike, this.name),
        spend,
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
        instructions: async () => (await settingsStub(env).sharedInstructions())?.text ?? "",
      },
    );
    const git = project.git;
    const installation = git?.installation;
    const tokenSource = app && installation !== undefined ? () => app.installationToken(installation) : undefined;
    const external = git ? orchestrator.external(new GitRemote({ url: git.url, branch: git.branch, token: git.token, ...(tokenSource ? { tokenSource } : {}) }, control), { mode: git.mode, syncBranch: git.syncBranch, ...(origin ? { previewLink: (key: string) => `${origin}/preview/${this.name}/${key}` } : {}) }) : null;
    this.built = { orchestrator, bus, repos, keeper, space, live, external, settings, fingerprint };
    return this.built;
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.split("/").filter(Boolean).at(-1);
    if (url.pathname.endsWith("/git/webhook")) return this.webhook(request);
    const origin = siteOrigin(this.env) ?? url.origin;
    if ((await this.ctx.storage.get<string>(ORIGIN)) !== origin) await this.ctx.storage.put(ORIGIN, origin);
    const { orchestrator, bus, settings, external, space } = await this.build();
    const session = SESSION_ROUTE.exec(url.pathname);
    if (session) return this.sessionRequest(request, session[1] as string, session[2] ?? null);
    const feature = FEATURE_ROUTE.exec(url.pathname);
    if (feature) {
      const { response, mainChanged } = await featureRequest(request, orchestrator, feature[1] as string);
      if (mainChanged) await this.schedule(0, "deployLive", undefined, { idempotent: true });
      return response;
    }
    const preview = PREVIEW_ROUTE.exec(url.pathname);
    if (preview && request.method === "GET") return this.previewRequest(preview[1] as string, url.searchParams.has("retry"), previewPath(url.searchParams.get("path")));
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
    if (request.method === "GET" && action === "spec") {
      const main = await orchestrator.mainTree();
      if (await this.liveBehind()) await this.schedule(0, "deployLive", undefined, { idempotent: true });
      return Response.json({ commitId: main.commitId, features: readSpec(main.tree), layout: await orchestrator.layout(), live: (await this.ctx.storage.get<LiveState>(LIVE)) ?? null });
    }
    if (request.method === "POST" && action === "live") {
      if (!space) return Response.json({ error: NO_CLOUDFLARE }, { status: 409 });
      const current = await this.ctx.storage.get<LiveState>(LIVE);
      if (current?.status === "failed") await this.ctx.storage.put<LiveState>(LIVE, { ...current, commitId: "" });
      await this.schedule(0, "deployLive", undefined, { idempotent: true });
      return Response.json({ ok: true }, { status: 202 });
    }
    if (request.method === "POST" && action === "bootstrap") {
      return setupResponse(request, async (progress) => {
        const existing = (await orchestrator.mainTree()).commitId;
        if (existing) return { commitId: existing, created: false };
        if (space) {
          progress.step("Reserve the live address");
          try {
            await space.ensure();
            progress.log(`The live app will be at ${await space.liveUrl()}`);
          } catch (error) {
            if (error instanceof WorkerTakenError) throw new SetupError(error.message, 409);
            throw error;
          }
        }
        await this.schedule(5, "deployLive", undefined, { idempotent: true });
        if (external) {
          const pulled = await external.pull(progress);
          if (pulled.status !== "imported") throw new SetupError(`importing the linked repository did not finish: ${pulled.status}`, 409);
          await this.ensurePolling();
          await this.startReading();
          return { commitId: pulled.commitId, created: true, imported: true };
        }
        return { commitId: await orchestrator.bootstrap(templateFiles, progress), created: true };
      });
    }
    if (action === "overview" && request.method === "GET") return Response.json(await this.overview());
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
    if (request.method === "GET" && action === "sessions") return Response.json(await orchestrator.sessions());
    if (request.method === "GET" && action === "cursor") return Response.json({ seq: await bus.cursor() });
    if (request.method === "GET" && action === "events") return Response.json(await bus.since(Number(url.searchParams.get("after") ?? 0)));
    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async sessionRequest(request: Request, id: string, action: string | null): Promise<Response> {
    const { orchestrator } = await this.build();
    try {
      if (request.method === "GET" && action === null) return Response.json({ record: await orchestrator.session(id), budget: DEFAULT_BUDGET });
      if (request.method === "GET" && action === "turns") return Response.json(await orchestrator.turns(id));
      if (request.method === "GET" && action === "changes") return Response.json(await orchestrator.changes(id));
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

  private async cloudflare(id: string): Promise<CloudflareView> {
    const { orchestrator, repos, keeper, settings } = await this.build();
    const record = await orchestrator.session(id);
    const engine = engineOf(this.env.PROJECT_WORKER_PREFIX);
    const projectWorker = `${this.env.PROJECT_WORKER_PREFIX}${this.name}`;
    const accountId = settings.cloudflare?.accountId ?? this.env.CF_ACCOUNT_ID ?? null;
    const lanes = record.lanes ?? [];
    const box = async (name: string): Promise<SandboxFacts> => {
      const objectId = this.env.SESSION.idFromName(name);
      const status = await (this.env.SESSION.get(objectId) as unknown as { status(): Promise<SandboxStatus> }).status().catch(() => ({ running: false, exit: null }));
      return { name, objectId: objectId.toString(), running: status.running, exit: status.exit };
    };
    const branch = previewBranch(record.previewKey);
    const name = previewName(branch, projectWorker);
    const [main, fork, ids, session, laneBoxes, previewBox, deployed, awake] = await Promise.all([
      repos.info(this.name),
      record.forkDeleted ? Promise.resolve(null) : repos.info(record.fork),
      this.engineIds.ids(settings.cloudflare, engine),
      box(id),
      Promise.all(lanes.map(async (lane) => [lane.role, await box(sandboxName(id, lane.role))] as const)),
      keeper ? box(`preview-${name}`) : Promise.resolve(null),
      keeper ? keeper.current({ repo: this.name, branch }) : Promise.resolve(null),
      keeper ? keeper.live() : Promise.resolve(false),
    ]);
    const live = (await this.ctx.storage.get<LiveState>(LIVE)) ?? null;
    return cloudflareView({
      accountId,
      engine,
      project: this.name,
      projectWorker,
      projectObject: this.ctx.id.toString(),
      namespaces: ids.namespaces,
      containerApp: { name: containerAppName(engine), id: ids.containerApp },
      main: { remote: main?.remote ?? null, commitId: (await orchestrator.mainTree()).commitId },
      session: { id, fork: record.fork, remote: fork?.remote ?? null, removed: record.forkDeleted ? (record.machine.state === "dropped" ? "dropped" : "merged") : null, head: record.head, lanes: lanes.map((l) => ({ role: l.role, branch: l.branch, head: l.head })) },
      agents: agentsOf(record),
      sandboxes: { session, lanes: Object.fromEntries(laneBoxes), preview: previewBox },
      preview: keeper ? { name, branch, url: record.preview?.url ?? null, versionId: deployed?.versionId ?? null, commitId: deployed?.commitId ?? record.preview?.commitId ?? null, awake } : null,
      live: live ? { url: live.url, commitId: live.commitId, status: live.status } : null,
    });
  }

  private async previewRequest(key: string, retry: boolean, path: string): Promise<Response> {
    const { keeper } = await this.build();
    if (!keeper) return buildingPage({ status: "failed", key, error: NO_CLOUDFLARE });
    let visit = await keeper.visit(key);
    if (visit.status === "failed" && retry) visit = { status: "rebuild" };
    if (visit.status === "ready") return new Response(null, { status: 302, headers: { location: `${visit.url.replace(/\/$/, "")}${path}`, "cache-control": "no-store" } });
    if (visit.status === "rebuild") {
      await keeper.startRebuild(key);
      await this.schedule(0, "rebuildPreview", key);
      return buildingPage({ status: "building", key });
    }
    if (visit.status === "failed") return buildingPage({ status: "failed", key, error: visit.error });
    return buildingPage({ status: visit.status, key });
  }

  async rebuildPreview(key: string): Promise<void> {
    const { keeper } = await this.build();
    await keeper?.rebuild(key);
  }

  async projectSettings(): Promise<ProjectSettings> {
    return readProjectSettings(await this.ctx.storage.get<Partial<ProjectSettings>>(PROJECT_SETTINGS));
  }

  private async settingsRequest(request: Request): Promise<Response> {
    const stored = await this.ctx.storage.get<Partial<ProjectSettings>>(PROJECT_SETTINGS);
    if (request.method === "GET") return Response.json(viewProjectSettings(readProjectSettings(stored)));
    if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
    const body: unknown = await request.json().catch(() => null);
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
    await this.scheduleSweep();
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
          const live = await this.ctx.storage.get<LiveState>(LIVE);
          if (live?.status === "ready" && live.commitId === before) await this.ctx.storage.put<LiveState>(LIVE, { ...live, commitId: result.commitId });
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
    await this.schedule(0, "pushEnvironment");
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
    await this.schedule(0, "pushEnvironment");
    return Response.json(await this.envView(result.env));
  }

  private async envView(stored: StoredEnv) {
    const { orchestrator } = await this.build();
    const features = [...readSpec((await orchestrator.mainTree()).tree), ...(await orchestrator.sessions()).filter((s) => !isTerminal(s.machine.state)).map((s) => s.plan.feature)];
    const shared = await settingsStub(this.env).sharedEnv();
    return viewProjectEnv(stored, shared, this.envCipher(), envNeeds(features, envNames(mergeEnv(shared, stored))));
  }

  private async prepareEnvironment(space: CloudflareWorkerSpace): Promise<void> {
    await space.ensure();
    const vars = await revealEnv(await this.effectiveEnv(), this.envCipher());
    if (vars.length === 0) return;
    try {
      await space.applyEnvironment(vars, { create: true });
    } catch (error) {
      throw new Error(`giving the preview this project's keys failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async pushEnvironment(): Promise<void> {
    const { keeper, space } = await this.build();
    if (space && (await this.ctx.storage.get<LiveState>(LIVE))?.status === "ready") {
      await space.applyLiveEnvironment(await revealEnv(await this.effectiveEnv(), this.envCipher())).catch((error: unknown) => console.error(`updating ${this.name}'s live environment failed`, error));
    }
    if (!keeper || !space || !(await keeper.live())) return;
    try {
      const patch = await space.applyEnvironment(await revealEnv(await this.effectiveEnv(), this.envCipher()), { create: false });
      if (!patch || Object.keys(patch).length === 0) return;
      for (const branch of await keeper.liveBranches()) await space.refreshPreview(previewName(branch, `${this.env.PROJECT_WORKER_PREFIX}${this.name}`), patch).catch((error: unknown) => console.error(`updating the environment of preview ${branch} failed`, error));
    } catch (error) {
      console.error(`updating ${this.name}'s preview environment failed`, error);
    }
  }

  private async scheduleSweep(): Promise<void> {
    const { previewIdleMinutes } = await this.projectSettings();
    await this.schedule(previewIdleMinutes * 60, "sweepPreviews", undefined, { idempotent: true });
  }

  async sweepPreviews(): Promise<void> {
    const { keeper, orchestrator } = await this.build();
    if (!keeper) return;
    const { previewIdleMinutes } = await this.projectSettings();
    const idleMs = previewIdleMinutes * 60_000;
    const busy = (await orchestrator.sessions()).some((s) => !isTerminal(s.machine.state));
    const outcome = await keeper.sweep({ busy, idleMs });
    if (outcome.status === "busy") await this.schedule(BUSY_SWEEP_SECONDS, "sweepPreviews", undefined, { idempotent: true });
    if (outcome.status === "awake") await this.schedule(Math.max(60, Math.ceil((idleMs - outcome.idleForMs) / 1000)), "sweepPreviews", undefined, { idempotent: true });
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
    await (await call)?.hangUp();
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
    if (!settings.llm) return fail(NO_LLM);
    const voice = settings.voice;
    if (!voice) return fail("Live talk needs a voice key in Settings > Models.");
    const host =
      voice.kind === "openai"
        ? new GptLiveHost({ apiKey: voice.apiKey, model: settings.models.voice, voice: this.env.VOICE, connect: workersConnect })
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
        ids: { next: (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}` },
        settle: () => new Promise((resolve) => setTimeout(resolve, 600)),
        onEvent: (event) => {
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
    const { external } = await this.build();
    if (!external) return;
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
    return state;
  }

  private async startReading(): Promise<void> {
    await this.ctx.storage.put<OverviewState>(OVERVIEW, { status: "reading", since: Date.now() });
    await this.schedule(0, "readProject");
  }

  async readProject(): Promise<void> {
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
    const sessions = await orchestrator.drain(1);
    await this.pushExternal();
    if (sessions.some(runnable)) await this.schedule(1, "drive");
    if (sessions.some((s) => s.overBudget && !isTerminal(s.machine.state))) await this.schedule(nextMonth(Date.now()), "budgetChanged", undefined, { idempotent: true });
    if (await this.liveBehind()) await this.schedule(0, "deployLive", undefined, { idempotent: true });
  }

  async onMainPushed(event: PushedEvent): Promise<void> {
    const { repos } = await this.build();
    repos.emitPush(event);
    await this.schedule(1, "drive");
    await this.schedule(0, "deployLive", undefined, { idempotent: true });
  }

  private async liveBehind(): Promise<boolean> {
    const { repos, space } = await this.build();
    if (!space) return false;
    const head = await repos.resolveRef(this.name, "main");
    const live = await this.ctx.storage.get<LiveState>(LIVE);
    return head !== null && head !== live?.commitId;
  }

  async deployLive(): Promise<void> {
    if (this.deploying) {
      this.deployAgain = true;
      return;
    }
    this.deploying = true;
    try {
      do {
        this.deployAgain = false;
        await this.deployLiveOnce();
      } while (this.deployAgain);
    } finally {
      this.deploying = false;
    }
  }

  private async deployLiveOnce(): Promise<void> {
    const { repos, space, live, bus } = await this.build();
    if (!space || !live) return;
    const commitId = await repos.resolveRef(this.name, "main");
    const current = await this.ctx.storage.get<LiveState>(LIVE);
    if (!commitId || (current?.commitId === commitId && current.status !== "deploying")) return;
    const record = async (state: Omit<LiveState, "at">) => {
      await this.ctx.storage.put<LiveState>(LIVE, { ...state, at: Date.now() });
      await bus.publish({ type: "live.updated", project: this.name, at: Date.now(), ...state });
    };
    await record({ status: "deploying", commitId, url: current?.url ?? null });
    try {
      await space.ensure();
      await live.deploy({ repo: this.name, commitId });
      await space.applyLiveEnvironment(await revealEnv(await this.effectiveEnv(), this.envCipher()));
      await record({ status: "ready", commitId, url: await space.liveUrl() });
    } catch (error) {
      console.error(`deploying ${this.name}'s live app failed`, error);
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

const noPreviews: PreviewHost = {
  deploy: async () => {
    throw new Error(NO_CLOUDFLARE);
  },
  current: async () => null,
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
