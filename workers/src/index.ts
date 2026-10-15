import { getAgentByName, routeAgentRequest } from "agents";
import { guard, trusted, type Caller } from "./access.ts";
import { copilotKitHandler } from "./copilotkit.ts";
import { gitHubRequest, gitHubWebhook } from "./github.ts";
import { projectsRequest, removeProjectRequest } from "@chef/adapters/projects";
import { agentsRequest } from "@chef/adapters/agents";
import { sharedInstructionsRequest } from "@chef/adapters/guidance";
import { loadProfiles } from "@chef/core";
import { agentFiles } from "./embedded.gen.ts";
import { projectOf } from "./routes.ts";
import { access, agentStore, currentSettings, keysRequest, settingsRequest, settingsStub, sharedEnvRequest, sharesRequest } from "./settings.ts";
import { limited, OPEN_SHARE, reaches, SHARE_HEADER, SHARE_PAGE, SHARE_ROUTE, SHARES_ROUTE, targetOf } from "./shares.ts";
import { usageRequest } from "./usage.ts";

export { ProjectAgent } from "./project-agent.ts";
export { SandboxOutbound, SessionAgent } from "./session-agent.ts";
export { Settings } from "./settings.ts";
export { UpstreamSync } from "./upstream-sync.ts";

const WEBHOOK = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/git\/webhook$/;
const PROJECT_ROOT = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})$/;
const COPILOTKIT = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/copilotkit(\/|$)/;

export default {
  async fetch(incoming: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const webhook = WEBHOOK.exec(new URL(incoming.url).pathname);
    if (webhook) return projectStub(env, webhook[1] as string, trusted(incoming, null));
    if (new URL(incoming.url).pathname === "/api/github/webhook") return gitHubWebhook(trusted(incoming, null), env);
    if (new URL(incoming.url).pathname === SHARE_PAGE && incoming.method === "GET") return env.ASSETS.fetch(new Request(new URL("/", incoming.url), incoming));
    const caller = await guard(incoming, access(env, (work) => ctx.waitUntil(work)));
    if (caller instanceof Response) return caller;
    const url = new URL(incoming.url);
    if (caller.kind === "grant" && limited(caller.grant)) {
      const target = targetOf(caller.grant);
      if (url.pathname === OPEN_SHARE && incoming.method === "GET" && target) return Response.json({ ...target, name: caller.grant.name, expiresAt: caller.grant.expiresAt });
      if (!reaches(caller.grant, incoming.method, url.pathname)) return Response.json({ error: "this link opens only what was shared with it" }, { status: 403 });
    }
    const request = shared(trusted(incoming, caller), caller);
    if (url.pathname === "/api/keys" || url.pathname.startsWith("/api/keys/")) return keysRequest(request, env, caller);
    if (SHARES_ROUTE.test(url.pathname) || SHARE_ROUTE.test(url.pathname)) return sharesRequest(request, env, async (project, kind, id) => (await getAgentByName(env.PROJECT, project)).shareTarget(kind, id));
    if (url.pathname === "/api/settings") return settingsRequest(request, env);
    if (url.pathname === "/api/env") return sharedEnvRequest(request, env, async (project) => (await getAgentByName(env.PROJECT, project)).sharedEnvironmentChanged());
    if (url.pathname === "/api/usage") return usageRequest(request, env, async (project) => (await getAgentByName(env.PROJECT, project)).budgetChanged());
    if (url.pathname === "/api/instructions") {
      const settings = settingsStub(env);
      return sharedInstructionsRequest(request, { get: () => settings.sharedInstructions(), put: (value) => settings.saveSharedInstructions(value) });
    }
    if (url.pathname === "/api/agents" || url.pathname === "/api/agents/restore") {
      const settings = await currentSettings(env);
      return agentsRequest(request, { store: agentStore(env), defaults: loadProfiles(agentFiles), models: settings.models, jev: settings.jev !== null }).catch(() => Response.json({ error: "Chef is finishing an update, so try again in a minute" }, { status: 503 }));
    }
    if (url.pathname === "/api/projects") return projectsRequest(request, settingsStub(env), (project, path, init) => projectStub(env, project, new Request(`${url.origin}/api/projects/${project}/${path}`, init)));
    const root = PROJECT_ROOT.exec(url.pathname);
    if (root && request.method === "DELETE") return removeProjectRequest(request, root[1] as string, settingsStub(env), () => removeProject(env, root[1] as string));
    if (url.pathname === "/api/github" || url.pathname.startsWith("/api/github/")) return gitHubRequest(request, env);
    const copilotKit = COPILOTKIT.exec(url.pathname);
    if (copilotKit) return copilotKitHandler(request, env, copilotKit[1] as string);
    const project = projectOf(url.pathname);
    if (project) return projectStub(env, project, request);
    const routed = await routeAgentRequest(request, env);
    if (routed) return routed;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function shared(request: Request, caller: Caller): Request {
  if (caller.kind !== "grant" || caller.grant.kind !== "share") return request;
  const headers = new Headers(request.headers);
  headers.set(SHARE_HEADER, "1");
  return new Request(request, { headers });
}

async function removeProject(env: Env, name: string) {
  const project = await getAgentByName(env.PROJECT, name);
  const removal = await project.removeProject();
  await project.destroy().catch(() => undefined);
  return removal;
}

function projectStub(env: Env, project: string, request: Request): Promise<Response> {
  const stub = env.PROJECT.get(env.PROJECT.idFromName(project));
  const headers = new Headers(request.headers);
  headers.set("x-partykit-room", project);
  return stub.fetch(new Request(request, { headers }));
}
