const PROJECT_NAME = /^[a-z][a-z0-9-]{1,30}$/;

export interface ProjectEntry {
  readonly name: string;
  readonly createdAt: number;
}

export function isProjectName(name: string): boolean {
  return PROJECT_NAME.test(name);
}

export interface ProjectRegistry {
  projects(): Promise<readonly ProjectEntry[]>;
  addProject(entry: ProjectEntry): Promise<boolean>;
}

export type ProjectCall = (project: string, path: string, init: RequestInit) => Promise<Response>;

async function failure(response: Response, fallback: string): Promise<Response> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return Response.json({ error: body.error ?? fallback }, { status: response.status >= 500 ? 502 : response.status });
}

export async function projectsRequest(request: Request, registry: ProjectRegistry, call: ProjectCall, now: () => number = Date.now): Promise<Response> {
  if (request.method === "GET") return Response.json({ projects: await registry.projects() });
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => null)) as { name?: unknown; git?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!isProjectName(name)) return Response.json({ error: "project names are 2 to 31 lower case letters, digits and dashes, starting with a letter" }, { status: 400 });
  if ((await registry.projects()).some((p) => p.name === name)) return Response.json({ error: `there is already a project named ${name}` }, { status: 409 });
  const json = { "content-type": "application/json" };
  if (body?.git) {
    const linked = await call(name, "settings", { method: "PUT", headers: json, body: JSON.stringify({ git: body.git }) });
    if (!linked.ok) return failure(linked, "could not link the repository");
  }
  const created = await call(name, "bootstrap", { method: "POST" });
  if (!created.ok) return failure(created, "could not create the project");
  const result = (await created.json()) as { commitId: string; created: boolean; imported?: boolean };
  await registry.addProject({ name, createdAt: now() });
  return Response.json({ name, ...result }, { status: 201 });
}
