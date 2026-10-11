import { routeAgentRequest } from "agents";

export { ProjectAgent } from "./project-agent.ts";
export { SandboxOutbound, SessionAgent } from "./session-agent.ts";
export { UpstreamSync } from "./upstream-sync.ts";

const PROJECT = /^\/api\/projects\/([a-z][a-z0-9-]{1,30})\/(bootstrap|prompts|sessions|events|voice)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = PROJECT.exec(url.pathname);
    if (match) {
      const stub = env.PROJECT.get(env.PROJECT.idFromName(match[1] as string));
      const headers = new Headers(request.headers);
      headers.set("x-partykit-room", match[1] as string);
      return stub.fetch(new Request(request, { headers }));
    }
    const routed = await routeAgentRequest(request, env);
    if (routed) return routed;
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
