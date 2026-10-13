import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { AgentSettings, ControlError, DEFAULT_BUDGET, DEFAULT_SPECIALIZATION, envNeeds, isTerminal, parseFeature, readSpec, runnable, type FeatureSpec, type SplitPart } from "@chef/core";
import { MemoryStore, type Script } from "@chef/core/fakes";
import { agentsRequest, projectAgentsRequest } from "@chef/adapters/agents";
import { instructionsRequest, memoryRequest, sharedInstructionsRequest, type GuidanceHost, type SharedInstructions } from "@chef/adapters/guidance";
import { ChefAgent, type ChefLink } from "@chef/adapters/agui";
import { applyUpdate, describeSettings, NO_SETTINGS, resolveSettings, type AppSettings, type SettingsEnv } from "@chef/adapters/settings";
import { aesCipher, applyEnvUpdate, envKeyBytes, envNames, mergeEnv, newEnvKey, viewEnv, viewProjectEnv, type StoredEnv } from "@chef/adapters/project-env";
import { applyProjectUpdate, readProjectSettings, viewProjectSettings, type ProjectSettings } from "@chef/adapters/project-settings";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { createNodeFetchHandler } from "@copilotkit/runtime/v2/node";
import { benchScript } from "./bench/agent.ts";
import { BENCH_ITEMS, promptFor, specFor } from "./bench/items.ts";
import { demoScript } from "./demo.ts";
import { readTree } from "./fs.ts";
import { localWorld, REPO_ROOT, repoProfiles, templateTree } from "./world.ts";

export const TODO_PROMPT = "Add an item to a todo list";
export const TODO_CLOUD_PROMPT = "Add an item to a todo list that also syncs to TodoCloud";
export const TODO_SPLIT_PROMPT = "Let people shout and reverse their todo items";

function splits(): Map<string, readonly SplitPart[]> {
  return new Map([[TODO_SPLIT_PROMPT, BENCH_ITEMS.filter((item) => item.id === "shout" || item.id === "reverse").map((item): SplitPart => ({ kind: "new", prompt: promptFor(item), parent: "todo-add" }))]]);
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
};

function presets(): Map<string, FeatureSpec> {
  const todo = parseFeature(readFileSync(join(REPO_ROOT, "core", "test", "fixtures", "todo-add.md"), "utf8"));
  if (!todo.ok) throw new Error(todo.errors.join("\n"));
  return new Map<string, FeatureSpec>([[TODO_PROMPT, todo.spec], [TODO_CLOUD_PROMPT, { ...todo.spec, env: ["TODOCLOUD_API_KEY"] }], ...BENCH_ITEMS.map((item) => [promptFor(item), specFor(item)] as const)]);
}

function script(): Script {
  const todo = demoScript(readTree(join(REPO_ROOT, "core", "test", "fixtures", "todo")));
  const bench = benchScript(BENCH_ITEMS);
  return (input, attempt) => {
    if (input.role === "chore") return { changes: { "README.md": `${input.workspace.tree["README.md"] ?? ""}\n${input.prompt}\n` }, summary: input.prompt };
    return input.featureId === "todo-add" ? todo(input, attempt) : bench(input, attempt);
  };
}

export interface LocalServer {
  readonly url: string;
  readonly server: Server;
  close(): Promise<void>;
}

export async function serve(options: { readonly port: number; readonly project?: string; readonly real: boolean; readonly attempts?: number; readonly assets?: string; readonly settings?: SettingsEnv; readonly log?: (line: string) => void }): Promise<LocalServer> {
  const log = options.log ?? (() => {});
  let env: StoredEnv = {};
  let shared: StoredEnv = {};
  let instructions: SharedInstructions | null = null;
  const cipher = await aesCipher(envKeyBytes(newEnvKey()));
  const w = localWorld({ script: script(), presets: presets(), splits: splits(), real: options.real, config: { environment: async () => envNames(mergeEnv(shared, env)), instructions: async () => instructions?.text ?? "", ...(options.attempts ? { specialization: { ...DEFAULT_SPECIALIZATION, attempts: options.attempts } } : {}) } });
  await w.orchestrator.bootstrap(templateTree());
  let driving: Promise<void> | null = null;
  const drive = () => {
    driving ??= (async () => {
      while ((await w.orchestrator.sessions()).some(runnable)) await w.orchestrator.drain(1);
    })()
      .catch((error: unknown) => log(`drive failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        driving = null;
      });
  };
  const link: ChefLink = {
    cursor: async () => w.bus.log.length,
    submit: async (prompt) => {
      const result = await w.orchestrator.submit(prompt);
      if (result.sessionId) drive();
      return result;
    },
    events: async (after) => w.bus.log.slice(after, after + 500).map((event, i) => ({ seq: after + i + 1, event })),
  };
  let project: { readonly name: string; readonly createdAt: number } | null = options.project ? { name: options.project, createdAt: Date.now() } : null;
  process.env["COPILOTKIT_TELEMETRY_DISABLED"] ??= "true";
  const runtime = new CopilotRuntime({ agents: () => ({ default: new ChefAgent({ link, pollMs: 200 }) }) });
  const copilotFor = (name: string) => createCopilotRuntimeHandler({ runtime, basePath: `/api/projects/${name}/copilotkit` });
  let copilot = project ? copilotFor(project.name) : null;
  const projects = async (request: Request): Promise<Response> => {
    if (request.method === "GET") return Response.json({ projects: project ? [project] : [] });
    const { name } = (await request.json().catch(() => ({}))) as { name?: string };
    if (!name || !/^[a-z][a-z0-9-]{1,30}$/.test(name)) return Response.json({ error: "project names are 2 to 31 lower case letters, digits and dashes, starting with a letter" }, { status: 400 });
    if (project) return Response.json({ error: project.name === name ? `there is already a project named ${name}` : "the local server runs a single project" }, { status: 409 });
    project = { name, createdAt: Date.now() };
    copilot = copilotFor(name);
    return Response.json({ name, commitId: (await w.orchestrator.mainTree()).commitId, created: true }, { status: 201 });
  };
  const assets = options.assets ?? join(REPO_ROOT, "apps", "dashboard", "dist");
  if (!existsSync(join(assets, "index.html"))) log(`no dashboard build in ${assets}; run pnpm build`);

  const sessionRequest = async (request: Request, id: string, sub: string | null): Promise<Response> => {
    const body = async () => (request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, string | undefined>) : {});
    try {
      if (request.method === "GET" && sub === null) return Response.json({ record: await w.orchestrator.session(id), budget: DEFAULT_BUDGET });
      if (request.method === "GET" && sub === "turns") return Response.json(await w.orchestrator.turns(id));
      if (request.method === "GET" && sub === "changes") return Response.json(await w.orchestrator.changes(id));
      if (request.method === "GET" && sub === "sandbox") return Response.json({ running: false, exit: "local runs have no sandbox container" });
      if (request.method === "POST" && sub === "drop") return Response.json({ state: (await w.orchestrator.drop(id, (await body())["reason"]?.trim() || undefined)).machine.state }, { status: 202 });
      if (request.method === "POST" && sub === "retry") {
        const record = await w.orchestrator.retry(id, (await body())["guidance"] ?? "");
        drive();
        return Response.json({ state: record.machine.state }, { status: 202 });
      }
      if (request.method === "POST" && sub === "steer") {
        const message = (await body())["message"]?.trim();
        if (!message) return Response.json({ error: "message is required" }, { status: 400 });
        await w.orchestrator.steer(id, message);
        return Response.json({ ok: true }, { status: 202 });
      }
    } catch (error) {
      if (error instanceof ControlError) return Response.json({ error: error.message }, { status: 409 });
      if (error instanceof Error && error.message.startsWith("unknown session")) return Response.json({ error: error.message }, { status: 404 });
      throw error;
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };

  const envView = async () => {
    const features = [...readSpec((await w.orchestrator.mainTree()).tree), ...(await w.orchestrator.sessions()).filter((s) => !isTerminal(s.machine.state)).map((s) => s.plan.feature)];
    return viewProjectEnv(env, shared, cipher, envNeeds(features, envNames(mergeEnv(shared, env))));
  };
  const sharedEnvRequest = async (request: Request): Promise<Response> => {
    if (request.method === "GET") return Response.json(await viewEnv(shared, cipher, []));
    if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
    const result = await applyEnvUpdate(shared, await request.json().catch(() => null), cipher, Date.now());
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    shared = result.env;
    if ((await w.orchestrator.environmentChanged()).length > 0) drive();
    return Response.json(await viewEnv(shared, cipher, []));
  };
  let projectSettings: Partial<ProjectSettings> = {};
  const projectSettingsRequest = async (request: Request): Promise<Response> => {
    if (request.method === "GET") return Response.json(viewProjectSettings(readProjectSettings(projectSettings)));
    const result = applyProjectUpdate(projectSettings, await request.json().catch(() => null), () => "local-webhook-secret");
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    projectSettings = result.settings;
    return Response.json(viewProjectSettings(readProjectSettings(projectSettings)));
  };
  const envRequest = async (request: Request): Promise<Response> => {
    if (request.method === "GET") return Response.json(await envView());
    if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
    const result = await applyEnvUpdate(env, await request.json().catch(() => null), cipher, Date.now());
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    env = result.env;
    if ((await w.orchestrator.environmentChanged()).length > 0) drive();
    return Response.json(await envView());
  };

  let saved: AppSettings = NO_SETTINGS;
  const settings = async (request: Request, env: SettingsEnv): Promise<Response> => {
    if (request.method === "GET") return Response.json(describeSettings(saved, env));
    const result = applyUpdate(saved, await request.json().catch(() => null));
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    saved = result.settings;
    return Response.json(describeSettings(saved, env));
  };

  const guidance: GuidanceHost = { main: () => w.orchestrator.mainTree(), edit: (edit) => w.orchestrator.editGuidance(edit), shared: async () => instructions };
  const sharedInstructions = { get: async () => instructions, put: async (value: SharedInstructions) => void (instructions = value) };

  const agentStore = new MemoryStore();
  const agents = new AgentSettings(agentStore);
  const projectAgents = new AgentSettings(agentStore, Date.now, "project/agents/");
  const api = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === "/api/settings" && options.settings) return settings(request, options.settings);
    if (url.pathname === "/api/env") return sharedEnvRequest(request);
    if (url.pathname === "/api/instructions") return sharedInstructionsRequest(request, sharedInstructions);
    if (url.pathname === "/api/agents" || url.pathname === "/api/agents/restore") {
      const resolved = resolveSettings(saved, options.settings ?? {});
      return agentsRequest(request, { store: agents, defaults: repoProfiles(), models: resolved.models, jev: resolved.jev !== null });
    }
    if (url.pathname === "/api/projects") return projects(request);
    const base = project ? `/api/projects/${project.name}` : null;
    if (base && copilot && url.pathname.startsWith(`${base}/copilotkit`)) return copilot(request);
    if (url.pathname.startsWith("/api/")) {
      const action = base && url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length + 1) : null;
      if (request.method === "POST" && action === "prompts") {
        const { prompt } = (await request.json()) as { prompt?: string };
        if (!prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
        return Response.json(await link.submit(prompt.trim()), { status: 202 });
      }
      if (request.method === "POST" && action === "route") {
        const { prompt } = (await request.json().catch(() => ({}))) as { prompt?: string };
        if (!prompt?.trim()) return Response.json({ error: "prompt is required" }, { status: 400 });
        return Response.json(await w.orchestrator.route(prompt.trim()));
      }
      if (request.method === "GET" && action === "sessions") return Response.json(await w.orchestrator.sessions());
      if (action === "settings") return projectSettingsRequest(request);
      if (action === "env") return envRequest(request);
      if (action === "instructions") return instructionsRequest(request, guidance);
      if (action === "memory") return memoryRequest(request, guidance);
      if (project && (action === "agents" || action === "agents/restore")) {
        const resolved = resolveSettings(saved, options.settings ?? {});
        return projectAgentsRequest(request, { project: project.name, store: projectAgents, shared: agents, defaults: repoProfiles(), models: resolved.models, jev: resolved.jev !== null });
      }
      if (request.method === "GET" && action === "spec") {
        const main = await w.orchestrator.mainTree();
        return Response.json({ commitId: main.commitId, features: readSpec(main.tree) });
      }
      const session = action ? /^sessions\/([a-z0-9-]{1,40})(?:\/([a-z]+))?$/.exec(action) : null;
      if (session) return sessionRequest(request, session[1] as string, session[2] ?? null);
      if (request.method === "GET" && action === "events") return Response.json(await link.events(Number(url.searchParams.get("after") ?? 0)));
      if (request.method === "GET" && action === "cursor") return Response.json({ seq: await link.cursor() });
      return Response.json({ error: "not found" }, { status: 404 });
    }
    const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(assets, path);
    if (!file.startsWith(assets) || !existsSync(file) || !statSync(file).isFile()) return new Response("not found", { status: 404 });
    return new Response(readFileSync(file), { headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream" } });
  };

  const server = createServer(createNodeFetchHandler(api));
  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
