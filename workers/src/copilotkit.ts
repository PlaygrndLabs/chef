import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { KargahAgent, type KargahLink } from "@kargah/adapters/agui";
import type { KargahEvent, SubmitResult } from "@kargah/core";

function projectLink(stub: DurableObjectStub, project: string): KargahLink {
  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    headers.set("x-partykit-room", project);
    const response = await stub.fetch(new Request(`https://kargah.internal/api/projects/${project}/${path}`, { ...init, headers }));
    if (!response.ok) throw new Error(`${path} failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
    return (await response.json()) as T;
  };
  return {
    cursor: async () => (await call<{ seq: number }>("cursor")).seq,
    submit: (prompt) => call<SubmitResult>("prompts", { method: "POST", body: JSON.stringify({ prompt }), headers: { "content-type": "application/json" } }),
    events: (after) => call<{ seq: number; event: KargahEvent }[]>(`events?after=${after}`),
  };
}

export async function copilotHandler(request: Request, env: Env, project: string): Promise<Response> {
  const link = projectLink(env.PROJECT.get(env.PROJECT.idFromName(project)), project);
  const runtime = new CopilotRuntime({ agents: () => ({ default: new KargahAgent({ link, pollMs: 1000 }) }) });
  return createCopilotRuntimeHandler({ runtime, basePath: `/api/projects/${project}/copilotkit` })(request);
}
