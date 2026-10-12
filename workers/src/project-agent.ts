import { Agent, type Connection } from "agents";
import { ArtifactsRepoHost, bindingControl, type ArtifactsBindingLike } from "@kargah/adapters/artifacts";
import { JevClassifier } from "@kargah/adapters/jev";
import { llmFromEnv } from "@kargah/adapters/anthropic";
import { LlmPlanner } from "@kargah/adapters/llm-planner";
import { LlmReviewer } from "@kargah/adapters/llm-reviewer";
import { WorkersAiReviewer, type TextGenerator } from "@kargah/adapters/workers-ai-reviewer";
import { VectorizeIndex, type EmbedderLike, type VectorizeLike } from "@kargah/adapters/vectorize";
import { GptLiveHost, type Connect, type SocketLike } from "@kargah/adapters/gpt-live";
import { RealtimeHost } from "@kargah/adapters/realtime";
import { isTerminal, loadProfiles, Orchestrator, readSpec, startVoiceCall, type PushedEvent, type Tree, type VoiceCall } from "@kargah/core";
import { renderRegistry, renderStub, stubPath } from "@kargah/template/gen";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { DurableStore } from "./do-store.ts";
import { agentFiles, templateFiles } from "./embedded.gen.ts";
import { DurableEventBus } from "./event-bus.ts";
import { SandboxCheckRunner, SandboxPreviewHost, SandboxProofRunner } from "./sandbox-checks.ts";
import { SandboxCoder } from "./sandbox-coder.ts";

const generated = { "src/registry.gen.ts": (tree: Tree) => renderRegistry(Object.keys(tree)) };

export class ProjectAgent extends Agent<Env> {
  private readonly calls = new Map<string, VoiceCall>();
  private built: { orchestrator: Orchestrator; bus: DurableEventBus; repos: ArtifactsRepoHost } | null = null;

  private build() {
    if (this.built) return this.built;
    const env = this.env;
    const repos = new ArtifactsRepoHost(bindingControl(env.ARTIFACTS as unknown as ArtifactsBindingLike));
    const bus = new DurableEventBus(this.ctx.storage, (message) => this.broadcast(message));
    const llm = llmFromEnv(env);
    const llmReviewer = new LlmReviewer(llm, env.REVIEWER_MODEL);
    const orchestrator = new Orchestrator(
      {
        repos,
        coder: new SandboxCoder(env.SESSION, { model: env.CODER_MODEL, llmBaseUrl: env.CPA_BASE_URL }),
        classifier: new JevClassifier(new TypeSafeClient({ apiKey: env.TYPESAFE_API_KEY, defaultModel: env.JEV_MODEL }), env.JEV_MODEL),
        planner: new LlmPlanner(llm, env.PLANNER_MODEL),
        reviewer: env.REVIEWER_LORA ? new WorkersAiReviewer(env.AI as unknown as TextGenerator, env.REVIEWER_LORA, llmReviewer) : llmReviewer,
        previews: new SandboxPreviewHost(env.SESSION, repos, { accountId: env.CF_ACCOUNT_ID, worker: `${env.PREVIEW_WORKER}-${this.name}` }),
        checks: new SandboxCheckRunner(env.SESSION, repos),
        proofs: new SandboxProofRunner(env.SESSION, repos),
        bus,
        clock: { now: () => Date.now() },
        ids: { next: (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}` },
        store: new DurableStore(this.ctx.storage),
        memory: new VectorizeIndex(env.MEMORY as unknown as VectorizeLike, env.AI as unknown as EmbedderLike, this.name),
      },
      {
        name: this.name,
        author: { name: "kargah", email: "ma.karimi76@gmail.com" },
        profiles: loadProfiles(agentFiles),
        generated,
        specialization: { attempts: Number(env.ATTEMPTS), stub: (feature) => ({ [stubPath(feature.id)]: renderStub(feature.id, feature.title) }) },
      },
    );
    this.built = { orchestrator, bus, repos };
    return this.built;
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.split("/").filter(Boolean).at(-1);
    const { orchestrator, bus } = this.build();
    if (request.method === "POST" && action === "bootstrap") {
      const existing = (await orchestrator.mainTree()).commitId;
      if (existing) return Response.json({ commitId: existing, created: false });
      return Response.json({ commitId: await orchestrator.bootstrap(templateFiles), created: true });
    }
    if (request.method === "POST" && action === "prompts") {
      const { prompt } = (await request.json()) as { prompt?: string };
      if (!prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
      const result = await orchestrator.submit(prompt.trim());
      if (result.sessionId) await this.schedule(1, "drive");
      return Response.json(result, { status: 202 });
    }
    if (request.method === "POST" && action === "voice") {
      const { sdp } = (await request.json()) as { sdp?: string };
      if (!sdp) return Response.json({ error: "sdp is required" }, { status: 400 });
      const host = this.env.OPENAI_API_KEY
        ? new GptLiveHost({ apiKey: this.env.OPENAI_API_KEY, model: this.env.VOICE_MODEL, voice: this.env.VOICE, connect: workersConnect })
        : new RealtimeHost({ baseUrl: `${this.env.CPA_BASE_URL.replace(/\/$/, "")}/v1`, apiKey: this.env.CPA_API_KEY, model: this.env.REALTIME_MODEL, voice: this.env.VOICE, connect: workersConnect });
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

  override async onConnect(connection: Connection): Promise<void> {
    const { bus } = this.build();
    for (const entry of await bus.since(0)) connection.send(JSON.stringify(entry));
  }

  async drive(): Promise<void> {
    const { orchestrator } = this.build();
    const sessions = await orchestrator.drain(1);
    if (sessions.some((s) => !isTerminal(s.machine.state))) await this.schedule(1, "drive");
  }

  async onMainPushed(event: PushedEvent): Promise<void> {
    const { repos } = this.build();
    repos.emitPush(event);
    await this.schedule(1, "drive");
  }
}

const workersConnect: Connect = async (url, headers) => {
  const response = await fetch(url.replace(/^ws/, "http"), { headers: { ...headers, upgrade: "websocket" } });
  const socket = response.webSocket;
  if (!socket) throw new Error(`the voice API refused the WebSocket: ${response.status}`);
  socket.accept();
  return socket as unknown as SocketLike;
};
