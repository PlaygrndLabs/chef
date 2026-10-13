import { Agent, type Connection } from "agents";
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
import { ControlError, DEFAULT_BUDGET, NO_CLASSIFIER, isTerminal, loadProfiles, Orchestrator, PreviewKeeper, readSpec, startVoiceCall, type ExternalSync, type PreviewHost, type PushedEvent, type Tree, type VoiceCall } from "@chef/core";
import { applyProjectUpdate, readProjectSettings, viewProjectSettings, type ProjectSettings } from "@chef/adapters/project-settings";
import { GitRemote } from "@chef/adapters/external-git";
import { renderRegistry, renderStub, stubPath } from "@chef/template/gen";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { DurableStore } from "./do-store.ts";
import { agentFiles, templateFiles } from "./embedded.gen.ts";
import { DurableEventBus } from "./event-bus.ts";
import { SandboxCheckRunner, SandboxPreviewHost, SandboxProofRunner } from "./sandbox-checks.ts";
import { SandboxCoder } from "./sandbox-coder.ts";
import { buildingPage, CloudflareWorkerSpace } from "./preview-space.ts";
import { currentSettings } from "./settings.ts";
import { validSignature } from "./webhook.ts";
import type { SandboxStatus } from "./session-agent.ts";

const SESSION_ROUTE = /^\/api\/projects\/[a-z][a-z0-9-]{1,30}\/sessions\/([a-z0-9-]{1,40})(?:\/([a-z]+))?$/;
const PREVIEW_ROUTE = /^\/preview\/[a-z][a-z0-9-]{1,30}\/([a-z0-9-]{1,80})\/?$/;
const PROJECT_SETTINGS = "project/settings";
const ORIGIN = "project/origin";
const POLL_SECONDS = 300;
const BUSY_SWEEP_SECONDS = 600;

const generated = { "src/registry.gen.ts": (tree: Tree) => renderRegistry(Object.keys(tree)) };

export class ProjectAgent extends Agent<Env> {
  private readonly calls = new Map<string, VoiceCall>();
  private built: { orchestrator: Orchestrator; bus: DurableEventBus; repos: ArtifactsRepoHost; keeper: PreviewKeeper | null; external: ExternalSync | null; settings: Resolved; fingerprint: string } | null = null;

  private async build() {
    const settings = await currentSettings(this.env);
    const project = await this.projectSettings();
    const origin = (await this.ctx.storage.get<string>(ORIGIN)) ?? null;
    const fingerprint = JSON.stringify([settings, project.git, origin]);
    if (this.built?.fingerprint === fingerprint) return this.built;
    this.built?.orchestrator.dispose();
    const env = this.env;
    const control = bindingControl(env.ARTIFACTS as unknown as ArtifactsBindingLike);
    const repos = new ArtifactsRepoHost(control);
    const bus = new DurableEventBus(this.ctx.storage, (message) => this.broadcast(message));
    const llm = settings.llm ? llmFromProvider(settings.llm) : missingLlm;
    const llmReviewer = new LlmReviewer(llm, settings.models.reviewer);
    const store = new DurableStore(this.ctx.storage);
    const clock = { now: () => Date.now() };
    const grant = settings.cloudflare ? { accountId: settings.cloudflare.accountId, worker: `${env.PREVIEW_WORKER}-${this.name}` } : null;
    const keeper =
      settings.cloudflare && grant
        ? new PreviewKeeper(new SandboxPreviewHost(env.SESSION, repos, grant, settings.cloudflare.apiToken), new CloudflareWorkerSpace(grant, settings.cloudflare.apiToken), { repos, store, clock, canonical: this.name, onActivity: () => void this.scheduleSweep() })
        : null;
    const orchestrator = new Orchestrator(
      {
        repos,
        coder: new SandboxCoder(env.SESSION, { model: settings.models.coder, llm: settings.llm ? { baseUrl: providerBaseUrl(settings.llm), apiKey: settings.llm.apiKey } : null }),
        classifier: settings.jev ? new JevClassifier(new TypeSafeClient({ apiKey: settings.jev.apiKey, defaultModel: env.JEV_MODEL }), env.JEV_MODEL) : NO_CLASSIFIER,
        planner: new LlmPlanner(llm, settings.models.planner),
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
        profiles: loadProfiles(agentFiles),
        generated,
        specialization: { attempts: settings.attempts, stub: (feature) => ({ [stubPath(feature.id)]: renderStub(feature.id, feature.title) }) },
        previewLink: (key) => `/preview/${this.name}/${key}`,
      },
    );
    const git = project.git;
    const external = git ? orchestrator.external(new GitRemote({ url: git.url, branch: git.branch, token: git.token }, control), { mode: git.mode, syncBranch: git.syncBranch, ...(origin ? { previewLink: (key: string) => `${origin}/preview/${this.name}/${key}` } : {}) }) : null;
    this.built = { orchestrator, bus, repos, keeper, external, settings, fingerprint };
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
    if (preview && request.method === "GET") return this.previewRequest(preview[1] as string, url.searchParams.has("retry"));
    if (action === "settings" && url.pathname.endsWith(`/projects/${this.name}/settings`)) return this.settingsRequest(request);
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
        return Response.json({ commitId: pulled.commitId, created: true, imported: true });
      }
      return Response.json({ commitId: await orchestrator.bootstrap(templateFiles), created: true });
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

  private async previewRequest(key: string, retry: boolean): Promise<Response> {
    const { keeper } = await this.build();
    if (!keeper) return buildingPage({ status: "failed", key, error: NO_CLOUDFLARE });
    let visit = await keeper.visit(key);
    if (visit.status === "failed" && retry) visit = { status: "rebuild" };
    if (visit.status === "ready") return new Response(null, { status: 302, headers: { location: visit.url, "cache-control": "no-store" } });
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
    const result = applyProjectUpdate(stored, await request.json().catch(() => null), () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""));
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    await this.ctx.storage.put(PROJECT_SETTINGS, result.settings);
    await this.scheduleSweep();
    const saved = readProjectSettings(result.settings);
    if (saved.git) {
      await this.ensurePolling();
      await this.schedule(0, "syncExternal");
    } else await this.stopPolling();
    return Response.json(viewProjectSettings(saved));
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

  override async onConnect(connection: Connection): Promise<void> {
    const { bus } = await this.build();
    for (const entry of await bus.since(0)) connection.send(JSON.stringify(entry));
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

  async drive(): Promise<void> {
    const { orchestrator } = await this.build();
    await orchestrator.reclaim();
    const sessions = await orchestrator.drain(1);
    await this.pushExternal();
    if (sessions.some((s) => !isTerminal(s.machine.state))) await this.schedule(1, "drive");
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
