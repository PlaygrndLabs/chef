import { readSetupStream, SETUP_STREAM, SetupError, setupResponse, type ChefEvent, type SetupProgress } from "@chef/core";

const PROJECT_NAME = /^[a-z][a-z0-9-]{1,30}$/;

export interface ProjectEntry {
  readonly name: string;
  readonly createdAt: number;
}

export interface ProjectActivity {
  readonly at: number;
  readonly note: string;
}

export type ListedProject = ProjectEntry & { readonly updatedAt?: number; readonly note?: string };

export function isProjectName(name: string): boolean {
  return PROJECT_NAME.test(name);
}

export interface ProjectRegistry {
  projects(): Promise<readonly ProjectEntry[]>;
  addProject(entry: ProjectEntry): Promise<boolean>;
  activity?(): Promise<Readonly<Record<string, ProjectActivity>>>;
}

export function activityNote(event: ChefEvent, title: string | null): string | null {
  const named = title ?? "a feature";
  switch (event.type) {
    case "session.created":
      return event.kind === "chore" ? `Started ${title ?? "a task"}` : `Started work on ${named}`;
    case "session.needs":
      return `${title ?? "A feature"} needs ${event.names.join(", ")}`;
    case "main.merged":
      return `Merged ${named} into main`;
    case "main.reverted":
      return "Undid a change on main";
    case "external.pulled":
      return "Pulled new commits from the linked repository";
    default:
      return null;
  }
}

export function listProjects(entries: readonly ProjectEntry[], activity: Readonly<Record<string, ProjectActivity>>): ListedProject[] {
  return entries.map((entry) => {
    const last = activity[entry.name];
    return last ? { ...entry, updatedAt: last.at, note: last.note } : entry;
  });
}

export interface ProjectRemoval {
  readonly removed: readonly string[];
  readonly kept: readonly string[];
}

export type ProjectCall = (project: string, path: string, init: RequestInit) => Promise<Response>;

async function failure(response: Response, fallback: string): Promise<SetupError> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return new SetupError(body.error ?? fallback, response.status >= 500 ? 502 : response.status);
}

function describeLink(git: unknown): string {
  const link = (git ?? {}) as { url?: unknown; branch?: unknown; mode?: unknown; syncBranch?: unknown };
  const sendBack = link.mode === "off" || !link.mode ? "Chef will not send work back" : `finished work goes to ${String(link.syncBranch ?? "chef")} as ${link.mode === "branch" ? "a branch" : "pull requests"}`;
  return `Linked ${String(link.url ?? "the repository")} (${String(link.branch ?? "main")}); ${sendBack}`;
}

async function bootstrap(name: string, call: ProjectCall, progress: SetupProgress): Promise<Readonly<Record<string, unknown>>> {
  const response = await call(name, "bootstrap", { method: "POST", headers: { accept: SETUP_STREAM } });
  if (!(response.headers.get("content-type") ?? "").includes(SETUP_STREAM)) {
    if (!response.ok) throw await failure(response, "could not create the project");
    return (await response.json()) as Readonly<Record<string, unknown>>;
  }
  for await (const event of readSetupStream(response)) {
    if (event.type === "step") progress.step(event.label);
    else if (event.type === "log") progress.log(event.text);
    else if (event.type === "done") return event.result;
    else throw new SetupError(event.error, event.status >= 500 ? 502 : event.status);
  }
  throw new SetupError("project setup stopped before it finished", 502);
}

export async function projectsRequest(request: Request, registry: ProjectRegistry, call: ProjectCall, now: () => number = Date.now): Promise<Response> {
  if (request.method === "GET") return Response.json({ projects: listProjects(await registry.projects(), (await registry.activity?.()) ?? {}) });
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => null)) as { name?: unknown; git?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!isProjectName(name)) return Response.json({ error: "project names are 2 to 31 lower case letters, digits and dashes, starting with a letter" }, { status: 400 });
  if ((await registry.projects()).some((p) => p.name === name)) return Response.json({ error: `there is already a project named ${name}` }, { status: 409 });
  return setupResponse(
    request,
    async (progress) => {
      if (body?.git) {
        progress.step("Link the repository");
        const linked = await call(name, "settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ git: body.git }) });
        if (!linked.ok) throw await failure(linked, "could not link the repository");
        progress.log(describeLink(body.git));
      }
      const result = await bootstrap(name, call, progress);
      await registry.addProject({ name, createdAt: now() });
      progress.log(`Added ${name} to your projects`);
      return { name, ...result };
    },
    201,
    now,
  );
}

export async function removeProjectRequest(request: Request, name: string, registry: ProjectRegistry & { forgetProject(name: string): Promise<void> }, remove: () => Promise<ProjectRemoval>): Promise<Response> {
  if (request.method !== "DELETE") return Response.json({ error: "method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
  if (!(await registry.projects()).some((p) => p.name === name)) return Response.json({ error: `there is no project named ${name}` }, { status: 404 });
  if (body?.confirm !== name) return Response.json({ error: `type ${name} to delete the project` }, { status: 400 });
  let removal: ProjectRemoval;
  try {
    removal = await remove();
  } catch (error) {
    return Response.json({ error: `deleting ${name} stopped: ${error instanceof Error ? error.message : String(error)}. Delete it again to finish.` }, { status: 502 });
  }
  await registry.forgetProject(name);
  return Response.json({ name, ...removal });
}
