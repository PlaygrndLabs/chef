import { agentsView, parseAgentConfig, parseProjectAgentConfig, projectAgentsView, type AgentConfig, type AgentStore, type AgentsView, type Profiles } from "@chef/core";

export interface AgentsContext {
  readonly store: AgentStore;
  readonly defaults: Profiles;
  readonly models: Readonly<Record<"planner" | "reviewer" | "coder", string>>;
  readonly jev: boolean;
}

export interface ProjectAgentsContext extends AgentsContext {
  readonly project: string;
  readonly shared: AgentStore;
}

type Parse = (body: unknown) => Promise<{ ok: true; config: AgentConfig } | { ok: false; error: string }>;

async function handle(request: Request, store: AgentStore, view: () => Promise<AgentsView>, parse: Parse): Promise<Response> {
  const restoring = new URL(request.url).pathname.endsWith("/restore");
  if (request.method === "GET" && !restoring) return Response.json(await view());
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (request.method === "POST" && restoring) {
    const version = body?.["version"];
    if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return Response.json({ error: "say which version to restore" }, { status: 400 });
    const result = await store.restore(version);
    return result.ok ? Response.json(await view()) : Response.json({ error: result.error }, { status: result.status });
  }
  if (request.method !== "PUT" || restoring) return Response.json({ error: "method not allowed" }, { status: 405 });
  const parsed = await parse(body?.["config"]);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const expected = typeof body?.["version"] === "number" ? body["version"] : null;
  const summary = typeof body?.["summary"] === "string" ? body["summary"] : "";
  const result = await store.save(parsed.config, summary, expected);
  return result.ok ? Response.json(await view()) : Response.json({ error: result.error }, { status: result.status });
}

export function agentsRequest(request: Request, ctx: AgentsContext): Promise<Response> {
  const view = async () => agentsView(ctx.defaults, await ctx.store.current(), await ctx.store.history(), ctx.models, ctx.jev);
  return handle(request, ctx.store, view, async (body) => parseAgentConfig(body, ctx.defaults));
}

export function projectAgentsRequest(request: Request, ctx: ProjectAgentsContext): Promise<Response> {
  const view = async () => projectAgentsView(ctx.project, ctx.defaults, await ctx.shared.current(), await ctx.store.current(), await ctx.store.history(), ctx.models, ctx.jev);
  return handle(request, ctx.store, view, async (body) => parseProjectAgentConfig(body, ctx.defaults, (await ctx.shared.current()).config));
}
