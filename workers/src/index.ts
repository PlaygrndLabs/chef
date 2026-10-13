import { routeAgentRequest } from "agents";
import { guard } from "./access.ts";
import { copilotKitHandler } from "./copilotkit.ts";
import { gitHubRequest, gitHubWebhook } from "./github.ts";
import { claimPassword, credential, settingsRequest } from "./settings.ts";

export { ProjectAgent } from "./project-agent.ts";
export { SandboxOutbound, SessionAgent } from "./session-agent.ts";
export { Settings } from "./settings.ts";
export { UpstreamSync } from "./upstream-sync.ts";

const PROJECT = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/(bootstrap|prompts|sessions|events|cursor|voice|spec|settings|git|git\/sync|sessions\/[a-z0-9-]{1,40}(?:\/(?:drop|retry|steer|turns|changes|sandbox))?)$/;
const PREVIEW = /^\/preview\/([a-z][a-z0-9-]{1,30})\/[a-z0-9-]{1,80}\/?$/;
const WEBHOOK = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/git\/webhook$/;
const COPILOTKIT = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/copilotkit(\/|$)/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const webhook = WEBHOOK.exec(new URL(request.url).pathname);
    if (webhook) return projectStub(env, webhook[1] as string, request);
    if (new URL(request.url).pathname === "/api/github/webhook") return gitHubWebhook(request, env);
    const blocked = await guard(request, await credential(env), claimPassword(env));
    if (blocked) return blocked;
    const url = new URL(request.url);
    if (url.pathname === "/api/settings") return settingsRequest(request, env);
    if (url.pathname === "/api/github" || url.pathname.startsWith("/api/github/")) return gitHubRequest(request, env);
    const copilotKit = COPILOTKIT.exec(url.pathname);
    if (copilotKit) return copilotKitHandler(request, env, copilotKit[1] as string);
    const match = PROJECT.exec(url.pathname) ?? PREVIEW.exec(url.pathname);
    if (match) return projectStub(env, match[1] as string, request);
    const routed = await routeAgentRequest(request, env);
    if (routed) return routed;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function projectStub(env: Env, project: string, request: Request): Promise<Response> {
  const stub = env.PROJECT.get(env.PROJECT.idFromName(project));
  const headers = new Headers(request.headers);
  headers.set("x-partykit-room", project);
  return stub.fetch(new Request(request, { headers }));
}
