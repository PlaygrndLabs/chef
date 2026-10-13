import { Agent, type Connection, type ConnectionContext } from "agents";
import { ArtifactsRepoHost, bindingControl, type ArtifactsBindingLike } from "@chef/adapters/artifacts";
import { JevClassifier } from "@chef/adapters/jev";
import { llmFromProvider, providerBaseUrl, type LlmEndpoint, type MessagesClient } from "@chef/adapters/anthropic";
import { NO_CLOUDFLARE, NO_LLM, type Resolved } from "@chef/adapters/settings";
import { LlmPlanner } from "@chef/adapters/llm-planner";
import { LlmReviewer } from "@chef/adapters/llm-reviewer";
import { WorkersAiReviewer, type TextGenerator } from "@chef/adapters/workers-ai-reviewer";
import { VectorizeIndex, type EmbedderLike, type VectorizeLike } from "@chef/adapters/vectorize";
import { GptLiveHost, type Connect, type SocketLike } from "@chef/adapters/gpt-live";
import { RealtimeHost } from "@chef/adapters/realtime";
import { AgentSettings, applyAgentConfig, ControlError, DEFAULT_BUDGET, DEFAULT_STORED_AGENTS, mergeAgentConfig, envNeeds, NO_CLASSIFIER, isTerminal, loadProfiles, Orchestrator, resolveModel, routerConfigOf, withSkills, type Profiles, PreviewKeeper, readSpec, replayFrom, runnable, startVoiceCall, type ExternalSync, type PreviewHost, type PushedEvent, type Tree, type VoiceCall } from "@chef/core";
import { applyEnvUpdate, envNames, mergeEnv, revealEnv, viewProjectEnv, type EnvCipher, type StoredEnv } from "@chef/adapters/project-env";
import { projectAgentsRequest } from "@chef/adapters/agents";
import { applyProjectUpdate, readProjectSettings, requestsGitHubApp, viewProjectSettings, type ProjectSettings } from "@chef/adapters/project-settings";
import { gitHubRepo, GitRemote } from "@chef/adapters/external-git";
import { exploreProject, type OverviewState } from "@chef/adapters/project-explorer";
import { renderRegistry, renderStub, stubPath } from "@chef/template/gen";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { DurableStore } from "./do-store.ts";
import { agentFiles, templateFiles } from "./embedded.gen.ts";
import { DurableEventBus } from "./event-bus.ts";
import { previewName, SandboxCheckRunner, SandboxPreviewHost, SandboxProofRunner } from "./sandbox-checks.ts";
import { SandboxCoder } from "./sandbox-coder.ts";
import { buildingPage, previewPath } from "@chef/adapters/preview-page";
import { CloudflareWorkerSpace } from "./preview-space.ts";
import { gitHubApp } from "./github.ts";
import { agentStore, currentSettings, envCipher, settingsStub } from "./settings.ts";
import { validSignature } from "./webhook.ts";
import type { SandboxStatus } from "./session-agent.ts";

const SESSION_ROUTE = /^\/api\/projects\/[a-z][a-z0-9-]{1,30}\/sessions\/([a-z0-9-]{1,40})(?:\/([a-z]+))?$/;
const PREVIEW_ROUTE = /^\/preview\/[a-z][a-z0-9-]{1,30}\/([a-z0-9-]{1,80})\/?$/;
const PROJECT_SETTINGS = "project/settings";
const ORIGIN = "project/origin";
const OVERVIEW = "project/overview";
const ENV = "project/env";
const AGENTS = "project/agents/";
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
  private readonly calls = new Map<string, VoiceCall>();
  private built: { orchestrator: Orchestrator; bus: DurableEventBus; repos: ArtifactsRepoHost; keeper: PreviewKeeper | null; space: CloudflareWorkerSpace | null; external: ExternalSync | null; settings: Resolved; fingerprint: string } | null = null;
  private cipher: EnvCipher | null = null;

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
    const bus = new DurableEventBus(this.ctx.storage, (message) => this.broadcast(message));
    const llm = settings.llm ? llmFromProvider(settings.llm) : missingLlm;
    const profiles = applyAgentConfig(loadProfiles(agentFiles), agents.config);
    const reviewerRole = role(profiles, "reviewer");
    const plannerRole = role(profiles, "planner");
    const llmReviewer = new LlmReviewer(llm, resolveModel(reviewerRole.model, settings.models), withSkills(reviewerRole.instructions, reviewerRole.skills));
    const store = new DurableStore(this.ctx.storage);
    const clock = { now: () => Date.now() };
    const grant = settings.cloudflare ? { accountId: settings.cloudflare.accountId, worker: `${env.PREVIEW_WORKER}-${this.name}` } : null;
    const space = settings.cloudflare && grant ? new CloudflareWorkerSpace(grant, settings.cloudflare.apiToken) : null;
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
      },
      {
        name: this.name,
        author: { name: "chef", email: "ma.karimi76@gmail.com" },
        profiles,
        router: routerConfigOf(agents.config.router),
        generated,
        specialization: { attempts: project.attempts ?? settings.attempts, stub: (feature) => ({ [stubPath(feature.id)]: renderStub(feature.id, feature.title) }) },
        previewLink: (key) => `/preview/${this.name}/${key}`,
        environment: async () => envNames(await this.effectiveEnv()),
      },
    );
    const git = project.git;
    const installation = git?.installation;
    const tokenSource = app && installation !== undefined ? () => app.installationToken(installation) : undefined;
    const external = git ? orchestrator.external(new GitRemote({ url: git.url, branch: git.branch, token: git.token, ...(tokenSource ? { tokenSource } : {}) }, control), { mode: git.mode, syncBranch: git.syncBranch, ...(origin ? { previewLink: (key: string) => `${origin}/preview/${this.name}/${key}` } : {}) }) : null;
    this.built = { orchestrator, bus, repos, keeper, space, external, settings, fingerprint };
    return this.built;
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.split("/").filter(Boolean).at(-1);
    if (url.pathname.endsWith("/git/webhook")) return this.webhook(request);
    if ((await this.ctx.storage.get<string>(ORIGIN)) !== url.origin) await this.ctx.storage.put(ORIGIN, url.origin);
    const { orchestrator, bus, settings, external } = await this.build();
    const session = SESSION_ROUTE.exec(url.pathname);
    if (session) return this.sessionRequest(request, session[1] as string, session[2] ?? null);
    const preview = PREVIEW_ROUTE.exec(url.pathname);
    if (preview && request.method === "GET") return this.previewRequest(preview[1] as string, url.searchParams.has("retry"), previewPath(url.searchParams.get("path")));
    if (action === "settings" && url.pathname.endsWith(`/projects/${this.name}/settings`)) return this.settingsRequest(request);
    if (action === "env" && url.pathname.endsWith(`/projects/${this.name}/env`)) return this.envRequest(request);
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
      return Response.json({ commitId: main.commitId, features: readSpec(main.tree) });
    }
    if (request.method === "POST" && action === "bootstrap") {
      const existing = (await orchestrator.mainTree()).commitId;
      if (existing) return Response.json({ commitId: existing, created: false });
      if (external) {
        const pulled = await external.pull();
        if (pulled.status !== "imported") return Response.json({ error: `importing the linked repository did not finish: ${pulled.status}` }, { status: 409 });
        await this.ensurePolling();
        await this.startReading();
        return Response.json({ commitId: pulled.commitId, created: true, imported: true });
      }
      return Response.json({ commitId: await orchestrator.bootstrap(templateFiles), created: true });
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
      const result = await orchestrator.submit(prompt.trim());
      if (result.sessionId) await this.schedule(1, "drive");
      return Response.json(result, { status: 202 });
    }
    if (request.method === "POST" && action === "route") {
      const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string };
      if (!prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
      return Response.json(await orchestrator.route(prompt.trim()));
    }
    if (request.method === "POST" && action === "voice") {
      const { sdp } = (await request.json()) as { sdp?: string };
      if (!sdp) return Response.json({ error: "sdp is required" }, { status: 400 });
      if (!settings.llm) return Response.json({ error: NO_LLM }, { status: 409 });
      const voice = settings.voice;
      if (!voice) return Response.json({ error: "voice needs an OpenAI API key or a custom Realtime provider in Settings" }, { status: 409 });
      const host =
        voice.kind === "openai"
          ? new GptLiveHost({ apiKey: voice.apiKey, model: this.env.VOICE_MODEL, voice: this.env.VOICE, connect: workersConnect })
          : new RealtimeHost({ baseUrl: voice.baseUrl, apiKey: voice.apiKey, model: this.env.REALTIME_MODEL, voice: this.env.VOICE, connect: workersConnect });
      const target = {
        submitSpoken: async (prompt: string, call: { voiceSessionId: string; delegationId: string }) => {
          const result = await orchestrator.submitSpoken(prompt, call);
          if (result.sessionId) await this.schedule(1, "drive");
          return result;
        },
      };
      const call = await startVoiceCall({
        host,
        target,
        spec: readSpec((await orchestrator.mainTree()).tree),
        sdp,
        ids: { next: (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}` },
        settle: () => new Promise((resolve) => setTimeout(resolve, 600)),
        onEvent: (event) => {
          if (event.type === "session.closed") this.calls.delete(call.sessionId);
        },
      });
      this.calls.set(call.sessionId, call);
      return Response.json({ sessionId: call.sessionId, sdp: call.sdp }, { status: 201 });
    }
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
      if (request.method === "GET" && action === "sandbox") {
        const stub = this.env.SESSION.get(this.env.SESSION.idFromName(id)) as unknown as { status(): Promise<SandboxStatus> };
        return Response.json(await stub.status());
      }
      if (request.method === "POST" && action === "drop") {
        const { reason } = (await request.json().catch(() => ({}))) as { reason?: string };
        const record = await orchestrator.drop(id, reason?.trim() || undefined);
        return Response.json({ state: record.machine.state }, { status: 202 });
      }
      if (request.method === "POST" && action === "retry") {
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
    if (!keeper || !space || !(await keeper.live())) return;
    try {
      const patch = await space.applyEnvironment(await revealEnv(await this.effectiveEnv(), this.envCipher()), { create: false });
      if (!patch || Object.keys(patch).length === 0) return;
      for (const branch of await keeper.liveBranches()) await space.refreshPreview(previewName(branch), patch).catch((error: unknown) => console.error(`updating the environment of preview ${branch} failed`, error));
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

  override async onConnect(connection: Connection, context: ConnectionContext): Promise<void> {
    const { bus } = await this.build();
    for (let after = replayFrom(context.request.url); ; ) {
      const entries = await bus.since(after);
      for (const entry of entries) connection.send(JSON.stringify(entry));
      const last = entries.at(-1);
      if (!last || entries.length < 500) break;
      after = last.seq;
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
      const overview = await exploreProject(llmFromProvider(settings.llm), { name: this.name, tree: main.tree, model: settings.models.planner });
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
  }

  async onMainPushed(event: PushedEvent): Promise<void> {
    const { repos } = await this.build();
    repos.emitPush(event);
    await this.schedule(1, "drive");
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

const workersConnect: Connect = async (url, headers) => {
  const response = await fetch(url.replace(/^ws/, "http"), { headers: { ...headers, upgrade: "websocket" } });
  const socket = response.webSocket;
  if (!socket) throw new Error(`the voice API refused the WebSocket: ${response.status}`);
  socket.accept();
  return socket as unknown as SocketLike;
};
