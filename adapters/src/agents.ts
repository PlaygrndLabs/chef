import { agentsView, parseAgentConfig, type AgentStore, type Profiles } from "@chef/core";

export interface AgentsContext {
  readonly store: AgentStore;
  readonly defaults: Profiles;
  readonly models: Readonly<Record<"planner" | "reviewer" | "coder", string>>;
  readonly jev: boolean;
}

export async function agentsRequest(request: Request, ctx: AgentsContext): Promise<Response> {
  const view = async () => agentsView(ctx.defaults, await ctx.store.current(), await ctx.store.history(), ctx.models, ctx.jev);
  const restoring = new URL(request.url).pathname.endsWith("/restore");
  if (request.method === "GET" && !restoring) return Response.json(await view());
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (request.method === "POST" && restoring) {
    const version = body?.["version"];
    if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return Response.json({ error: "say which version to restore" }, { status: 400 });
    const result = await ctx.store.restore(version);
    return result.ok ? Response.json(await view()) : Response.json({ error: result.error }, { status: result.status });
  }
  if (request.method !== "PUT" || restoring) return Response.json({ error: "method not allowed" }, { status: 405 });
  const parsed = parseAgentConfig(body?.["config"], ctx.defaults);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  const expected = typeof body?.["version"] === "number" ? body["version"] : null;
  const summary = typeof body?.["summary"] === "string" ? body["summary"] : "";
  const result = await ctx.store.save(parsed.config, summary, expected);
  return result.ok ? Response.json(await view()) : Response.json({ error: result.error }, { status: result.status });
}
