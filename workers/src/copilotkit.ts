import { CopilotRuntime, InMemoryAgentRunner, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { ChefAgent, type ChefLink } from "@chef/adapters/agui";
import type { ChefEvent, SubmitResult } from "@chef/core";

function projectLink(stub: DurableObjectStub, project: string): ChefLink {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    headers.set("x-partykit-room", project);
    const response = await stub.fetch(new Request(`https://chef.internal/api/projects/${project}/${path}`, { ...init, headers }));
    if (!response.ok) throw new Error(`${path} failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
    return (await response.json()) as T;
  };
  return {
    cursor: async () => (await call<{ seq: number }>("cursor")).seq,
    submit: (prompt) => call<SubmitResult>("prompts", { method: "POST", body: JSON.stringify({ prompt }), headers: { "content-type": "application/json" } }),
    events: (after) => call<{ seq: number; event: ChefEvent }[]>(`events?after=${after}`),
  };
}

export function chatRuntime(link: ChefLink, pollMs = 1000): CopilotRuntime {
  return new CopilotRuntime({ agents: () => ({ default: new ChefAgent({ link, pollMs }) }), runner: new InMemoryAgentRunner({ onConcurrentRun: "supersede" }) });
}

export async function copilotKitHandler(request: Request, env: Env, project: string): Promise<Response> {
  const runtime = chatRuntime(projectLink(env.PROJECT.get(env.PROJECT.idFromName(project)), project));
  return createCopilotRuntimeHandler({ runtime, basePath: `/api/projects/${project}/copilotkit` })(request);
}
