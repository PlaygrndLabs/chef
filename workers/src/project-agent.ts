import { Agent, type Connection } from "agents";
import { ArtifactsRepoHost, bindingControl, type ArtifactsBindingLike } from "@kargah/adapters/artifacts";
import { JevClassifier } from "@kargah/adapters/jev";
import { anthropicFromEnv } from "@kargah/adapters/anthropic";
import { LlmPlanner } from "@kargah/adapters/llm-planner";
import { LlmReviewer } from "@kargah/adapters/llm-reviewer";
import { WorkersBuildsPreviewHost } from "@kargah/adapters/workers-previews";
import { isTerminal, loadProfiles, Orchestrator, type PushedEvent, type Tree } from "@kargah/core";
import { renderRegistry } from "@kargah/template/gen";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { DurableStore } from "./do-store.ts";
import { agentFiles, templateFiles } from "./embedded.gen.ts";
import { DurableEventBus } from "./event-bus.ts";
import { SandboxCheckRunner, SandboxProofRunner } from "./sandbox-checks.ts";
import { SandboxCoder } from "./sandbox-coder.ts";

const generated = { "src/registry.gen.ts": (tree: Tree) => renderRegistry(Object.keys(tree)) };

export class ProjectAgent extends Agent<Env> {
  private built: { orchestrator: Orchestrator; bus: DurableEventBus; repos: ArtifactsRepoHost } | null = null;

  private build() {
    if (this.built) return this.built;
    const env = this.env;
    const repos = new ArtifactsRepoHost(bindingControl(env.ARTIFACTS as unknown as ArtifactsBindingLike));
    const bus = new DurableEventBus(this.ctx.storage, (message) => this.broadcast(message));
    const anthropic = anthropicFromEnv(env.ANTHROPIC_API_KEY);
    const orchestrator = new Orchestrator(
      {
        repos,
        coder: new SandboxCoder(env.SESSION),
        classifier: new JevClassifier(new TypeSafeClient({ apiKey: env.TYPESAFE_API_KEY, defaultModel: env.JEV_MODEL }), env.JEV_MODEL),
        planner: new LlmPlanner(anthropic, env.PLANNER_MODEL),
        reviewer: new LlmReviewer(anthropic, env.REVIEWER_MODEL),
        previews: new WorkersBuildsPreviewHost({ accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN, workerName: `${env.PREVIEW_WORKER}` }),
        checks: new SandboxCheckRunner(env.SESSION, repos),
        proofs: new SandboxProofRunner(env.SESSION, repos),
        bus,
        clock: { now: () => Date.now() },
        ids: { next: (prefix) => `${prefix}${crypto.randomUUID().slice(0, 8)}` },
        store: new DurableStore(this.ctx.storage),
      },
      { name: this.name, author: { name: "kargah", email: "ma.karimi76@gmail.com" }, profiles: loadProfiles(agentFiles), generated },
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
    if (request.method === "GET" && action === "sessions") return Response.json(await orchestrator.sessions());
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
